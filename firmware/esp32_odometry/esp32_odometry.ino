// esp32_odometry.ino
//
// ESP32 odometry source for the Gauzensplat live-capture server.
//
// Speaks the SAME wire protocol as the Python reference client
// (tools/live_capture_server/odometry_client.py) so it drops into an
// existing server session without any server changes.  Protocol contract:
// tools/live_capture_server/protocol.py  (PROTOCOL_VERSION = 1).
//
// Endpoint:   ws://<server>:8765/ws/odometry
// Sequence:   hello -> hello_ack(accepted) -> N x (ping/pong + clock_sample)
//             -> stream odometry frames (each answered with an ack).
//
// Pose source: Adafruit BNO055 IMU.
//   - yaw_rad : fused absolute Euler yaw (BNO055 sensor fusion, low drift).
//   - x_m/y_m : dead-reckoned by integrating gravity-compensated linear
//               acceleration.  IMU-only position DRIFTS quadratically; a
//               zero-velocity update (ZUPT) when the board is still curbs it,
//               but for accurate x/y you want wheel encoders. See notes below.
//
// Libraries (install via Arduino Library Manager):
//   - Links2004/arduinoWebSockets   (WebSocketsClient)
//   - bblanchon/ArduinoJson         (v6 or v7)
//   - Adafruit BNO055 + Adafruit Unified Sensor
//
// Board: ESP32 (any dev board). I2C: SDA=21, SCL=22 (defaults).

#define ARDUINOJSON_USE_LONG_LONG 1   // int64 timestamps (harmless on v7)

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <math.h>

// ---------------------------------------------------------------------------
// Configuration  — EDIT THESE
// ---------------------------------------------------------------------------
static const char*   WIFI_SSID  = "YOUR_WIFI_SSID";
static const char*   WIFI_PASS  = "YOUR_WIFI_PASSWORD";

static const char*   SERVER_HOST = "192.168.1.50";   // laptop running server.py
static const uint16_t SERVER_PORT = 8765;
static const char*   WS_PATH      = "/ws/odometry";

// Must match the session the phone created on the server (see server logs /
// sessions_index.json).  The ESP32 attaches to an EXISTING session.
static const char*   SESSION_ID = "sess_replace_me";
static const char*   DEVICE_ID  = "esp32-imu-01";

static const int     PROTOCOL_VERSION = 1;
static const int     CLOCK_SYNC_ROUNDS = 5;
static const float   ODOM_RATE_HZ = 20.0f;           // odometry send rate

// ZUPT / drift-control thresholds (units: m/s^2 and rad/s).
static const float   ACC_STILL_THRESH  = 0.20f;      // |linear accel| below -> "still"
static const float   GYRO_STILL_THRESH = 0.05f;      // |gyro z|      below -> "still"

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
WebSocketsClient ws;
Adafruit_BNO055 bno = Adafruit_BNO055(55, 0x28, &Wire);

enum Phase { CONNECTING, HELLO_SENT, CLOCK_SYNC, STREAMING };
volatile Phase phase = CONNECTING;

int64_t  serverOffsetNs = 0;         // add to client ns -> server ns
int64_t  bestRttNs      = INT64_MAX;
int      clockRound     = 0;
int64_t  pingT0Ns       = 0;

uint32_t sessionStartUs = 0;         // esp_timer micros at session start
uint32_t odomSeq        = 0;
uint32_t lastOdomMs     = 0;
uint32_t lastIntegUs    = 0;

// dead-reckoned planar pose
double posX = 0.0, posY = 0.0;       // meters
double velX = 0.0, velY = 0.0;       // m/s
float  yawRad = 0.0f;

// esp_timer_get_time() is microseconds since boot; scale to ns for the
// protocol.  Absolute epoch is irrelevant — offset/rtt are relative.
static inline int64_t nowNs() { return (int64_t)esp_timer_get_time() * 1000LL; }

// ---------------------------------------------------------------------------
// Sending helpers
// ---------------------------------------------------------------------------
static void sendJson(JsonDocument& doc) {
  String out;
  serializeJson(doc, out);
  ws.sendTXT(out);
}

static void sendHello() {
  JsonDocument doc;
  doc["type"] = "hello";
  doc["protocol_version"] = PROTOCOL_VERSION;
  doc["client_type"] = "esp32";
  doc["device_session_id"] = String("odo-") + DEVICE_ID;
  doc["app_version"] = "esp32-ino-1.0";
  sendJson(doc);
  phase = HELLO_SENT;
  Serial.println("[esp32] hello sent");
}

static void sendPing(int seq) {
  pingT0Ns = nowNs();
  JsonDocument doc;
  doc["type"] = "ping";
  doc["protocol_version"] = PROTOCOL_VERSION;
  doc["seq"] = seq;
  doc["t0_client_ns"] = pingT0Ns;
  sendJson(doc);
}

// mirrors clock_sync.estimate(): rtt=(t3-t0)-(t2-t1), offset=((t1-t0)+(t2-t3))/2
static void handlePong(JsonDocument& doc) {
  int64_t t0 = pingT0Ns;
  int64_t t1 = doc["t1_server_ns"].as<int64_t>();
  int64_t t2 = doc["t2_server_ns"].as<int64_t>();
  int64_t t3 = nowNs();
  int64_t rtt = (t3 - t0) - (t2 - t1);
  int64_t offset = ((t1 - t0) + (t2 - t3)) / 2;
  if (rtt >= 0 && rtt < bestRttNs) { bestRttNs = rtt; serverOffsetNs = offset; }

  JsonDocument s;
  s["type"] = "clock_sample";
  s["protocol_version"] = PROTOCOL_VERSION;
  s["session_id"] = SESSION_ID;
  s["device_id"] = DEVICE_ID;
  s["seq"] = clockRound;
  s["t0_client_ns"] = t0;
  s["t1_server_ns"] = t1;
  s["t2_server_ns"] = t2;
  s["t3_client_ns"] = t3;
  s["offset_ns"] = offset;
  s["rtt_ns"] = rtt;
  sendJson(s);

  clockRound++;
  if (clockRound < CLOCK_SYNC_ROUNDS) {
    sendPing(clockRound);
  } else {
    Serial.printf("[esp32] clock synced: offset ~%.3f ms, rtt ~%.3f ms\n",
                  serverOffsetNs / 1e6, bestRttNs / 1e6);
    phase = STREAMING;
    sessionStartUs = (uint32_t)esp_timer_get_time();
    lastIntegUs = sessionStartUs;
  }
}

// ---------------------------------------------------------------------------
// IMU -> pose
// ---------------------------------------------------------------------------
static void updatePose() {
  uint32_t nowUs = (uint32_t)esp_timer_get_time();
  float dt = (nowUs - lastIntegUs) / 1e6f;
  lastIntegUs = nowUs;
  if (dt <= 0.0f || dt > 0.5f) return;   // skip absurd steps

  // Fused yaw (Euler .x is heading in degrees on the BNO055).
  sensors_event_t orient;
  bno.getEvent(&orient, Adafruit_BNO055::VECTOR_EULER);
  yawRad = orient.orientation.x * (float)M_PI / 180.0f;

  // Gravity-compensated linear acceleration (sensor/body frame, m/s^2).
  imu::Vector<3> la = bno.getVector(Adafruit_BNO055::VECTOR_LINEARACCEL);
  imu::Vector<3> gy = bno.getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);

  bool still = (sqrt(la.x() * la.x() + la.y() * la.y()) < ACC_STILL_THRESH) &&
               (fabs(gy.z() * (float)M_PI / 180.0f) < GYRO_STILL_THRESH);
  if (still) { velX = 0.0; velY = 0.0; return; }   // ZUPT: kill accumulated drift

  // Rotate body accel into the world frame using fused yaw, integrate twice.
  float c = cosf(yawRad), s = sinf(yawRad);
  double ax = c * la.x() - s * la.y();
  double ay = s * la.x() + c * la.y();
  velX += ax * dt; velY += ay * dt;
  posX += velX * dt; posY += velY * dt;
}

static void sendOdometry() {
  updatePose();
  uint32_t deviceTimeUs = (uint32_t)esp_timer_get_time() - sessionStartUs;

  JsonDocument doc;
  doc["type"] = "odometry";
  doc["protocol_version"] = PROTOCOL_VERSION;
  doc["session_id"] = SESSION_ID;
  doc["device_id"] = DEVICE_ID;
  doc["sequence"] = odomSeq++;
  doc["device_time_us"] = deviceTimeUs;
  JsonObject p = doc["payload"].to<JsonObject>();
  p["x_m"] = posX;
  p["y_m"] = posY;
  p["yaw_rad"] = yawRad;
  p["linear_velocity"] = sqrt(velX * velX + velY * velY);
  p["angular_velocity"] = nullptr;   // not tracked; server accepts null
  sendJson(doc);
}

// ---------------------------------------------------------------------------
// WebSocket events
// ---------------------------------------------------------------------------
static void onWsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("[esp32] ws connected");
      sendHello();
      break;
    case WStype_DISCONNECTED:
      Serial.println("[esp32] ws disconnected");
      phase = CONNECTING;
      break;
    case WStype_TEXT: {
      JsonDocument doc;
      if (deserializeJson(doc, payload, length)) return;
      const char* t = doc["type"] | "";
      if (!strcmp(t, "hello_ack")) {
        if (doc["accepted"] | false) {
          Serial.println("[esp32] hello accepted -> clock sync");
          phase = CLOCK_SYNC;
          clockRound = 0; bestRttNs = INT64_MAX;
          sendPing(0);
        } else {
          Serial.printf("[esp32] hello REJECTED: %s\n",
                        (const char*)(doc["reason"] | "?"));
        }
      } else if (!strcmp(t, "pong")) {
        handlePong(doc);
      } else if (!strcmp(t, "ack")) {
        // odometry accepted; nothing to do
      } else if (!strcmp(t, "nack") || !strcmp(t, "error")) {
        Serial.printf("[esp32] server %s: %s\n", t,
                      (const char*)(doc["reason"] | "?"));
      }
      break;
    }
    default: break;
  }
}

// ---------------------------------------------------------------------------
// Arduino entry points
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);

  Wire.begin();
  if (!bno.begin()) {
    Serial.println("[esp32] BNO055 not found — check I2C wiring (SDA=21, SCL=22)");
    while (1) delay(1000);
  }
  bno.setExtCrystalUse(true);
  Serial.println("[esp32] BNO055 online");

  Serial.printf("[esp32] connecting to WiFi %s ...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); }
  Serial.printf("\n[esp32] WiFi ok, ip=%s\n", WiFi.localIP().toString().c_str());

  ws.begin(SERVER_HOST, SERVER_PORT, WS_PATH);
  ws.onEvent(onWsEvent);
  ws.setReconnectInterval(2000);
}

void loop() {
  ws.loop();
  if (phase == STREAMING) {
    uint32_t now = millis();
    if (now - lastOdomMs >= (uint32_t)(1000.0f / ODOM_RATE_HZ)) {
      lastOdomMs = now;
      sendOdometry();
    }
  }
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------
// * SESSION_ID must match a live server session. If you want the ESP32 to
//   auto-discover it (e.g. the phone broadcasts it, or you add a /session
//   lookup), wire that into setup() before ws.begin().
// * IMU-only x/y drifts quadratically; ZUPT above only helps when the rig
//   actually stops. For metric x/y, fuse wheel encoders (integrate ticks for
//   distance, keep BNO055 yaw for heading) and replace updatePose().
// * MPU6050 instead of BNO055: it has no onboard fusion — you must run a
//   complementary/Madgwick filter to get yaw from gyro Z (+ optional mag),
//   then feed the same posX/posY/yawRad integration. The wire protocol is
//   identical; only updatePose() changes.
