#include <WiFi.h>
#include <WebServer.h>

// ---------------------------------------------------------------------------
// Person-follower rover — car-style steering (1 drive ESC + 1 steering servo).
//
// Architecture:
//   * The iPhone/server does the perception (person detection -> bearing +
//     distance) and POSTs it to this ESP32 over Wi-Fi. The ESP32 only runs the
//     control loop: steer toward the bearing, drive to hold a standoff distance.
//   * The manual web page (forward/reverse/speed) is retained as an OVERRIDE /
//     test harness. Calling /drive drops out of follow mode; calling /follow
//     enters it.
//   * Failsafe: if no fresh command arrives within the timeout, the rover
//     stops and re-centers the steering.
//
// Sender contract (phone/server -> ESP32):
//   GET /follow?bearing=<deg>&distance=<m>&t=<ms>
//     bearing  : degrees, 0 = person straight ahead, + = person to the RIGHT,
//                - = person to the LEFT (clamped to +/-STEER_INPUT_MAX_DEG).
//     distance : meters to the person.
//     t        : cache-buster (ignored by firmware).
//   Send this continuously (e.g. 10-20 Hz) while tracking; stop sending (or
//   send /drive?dir=stop) to halt.
//
// Wiring:
//   ESC signal  -> GPIO 25  (white lead; ESC red disconnected while on USB)
//   Servo signal-> GPIO 26  (orange/white; power the servo from a proper 5-6V
//                            rail, NOT the ESP32 3V3 pin; share grounds)
// ---------------------------------------------------------------------------

// ---- Drive ESC (unchanged from the original controller) -------------------
constexpr uint8_t  ESC_PIN = 25;
constexpr uint32_t ESC_FREQUENCY_HZ = 50;
constexpr uint8_t  ESC_RESOLUTION_BITS = 16;
constexpr uint16_t ESC_MIN_US = 1000;
constexpr uint16_t ESC_NEUTRAL_US = 1500;
constexpr uint16_t ESC_MAX_US = 2000;
constexpr uint16_t ESC_DEADBAND_US = 40;

// ---- Steering servo -------------------------------------------------------
constexpr uint8_t  SERVO_PIN = 26;
constexpr uint32_t SERVO_FREQUENCY_HZ = 50;
constexpr uint8_t  SERVO_RESOLUTION_BITS = 16;
constexpr uint16_t SERVO_MIN_US = 1000;   // full left  (adjust to your linkage)
constexpr uint16_t SERVO_CENTER_US = 1500;
constexpr uint16_t SERVO_MAX_US = 2000;   // full right
// If your servo turns the wrong way for a given bearing, flip this to -1.
constexpr int8_t   STEER_SENSE = +1;

// ---- Follow controller ----------------------------------------------------
constexpr float    FOLLOW_DISTANCE_M   = 1.5f;   // desired standoff from person
constexpr float    FOLLOW_DEADBAND_M   = 0.30f;  // no throttle inside this band
constexpr float    FOLLOW_KP_PCT_PER_M = 60.0f;  // throttle gain (%/meter of err)
constexpr int      FOLLOW_MAX_FWD_PCT  = 45;     // safety cap forward (autonomous)
constexpr int      FOLLOW_MAX_REV_PCT  = 25;     // safety cap when backing off
constexpr float    STEER_INPUT_MAX_DEG = 45.0f;  // bearing that maps to full lock
constexpr int      THROTTLE_SLEW_PCT   = 4;      // max throttle change per tick
constexpr uint32_t CONTROL_TICK_MS     = 20;     // 50 Hz control loop

// ---- Timeouts -------------------------------------------------------------
// Manual buttons tolerate mobile-browser timer throttling; autonomous follow
// must fail fast, so it gets a much shorter watchdog.
constexpr uint32_t MANUAL_TIMEOUT_MS = 5000;
constexpr uint32_t FOLLOW_TIMEOUT_MS = 800;

const char *AP_NAME = "ESP32-Follower";
const char *AP_PASSWORD = "motorcontrol";

WebServer server(80);

enum Mode { MODE_IDLE, MODE_MANUAL, MODE_FOLLOW };
Mode     mode = MODE_IDLE;
uint32_t lastCommandMs = 0;

// Latest target from the perception sender.
float    targetBearingDeg = 0.0f;
float    targetDistanceM  = FOLLOW_DISTANCE_M;

// Applied outputs (kept so we can slew-limit throttle).
int      appliedThrottlePct = 0;   // signed: + forward, - reverse
uint32_t lastTickMs = 0;

const char INDEX_HTML[] PROGMEM = R"HTML(
<!doctype html>
<html lang="en">
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
  <title>ESP32 Follower</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #101318; }
    main { width: min(92vw, 430px); text-align: center; }
    h1 { margin-bottom: .35rem; }
    #status { color: #9fe3a8; min-height: 1.5em; }
    .speed { margin: 1.5rem 0; }
    input { width: 100%; }
    button { width: 100%; min-height: 92px; margin: .55rem 0; border: 0; border-radius: 18px;
             color: white; font-size: 1.55rem; font-weight: 750; touch-action: none; user-select: none;
             -webkit-user-select: none; -webkit-touch-callout: none; }
    #forward { background: #16884a; }
    #reverse { background: #b46a14; }
    #stop { background: #c52b32; min-height: 68px; }
    button.active { filter: brightness(1.35); transform: scale(.99); }
    small { display: block; color: #adb5bd; margin-top: 1rem; line-height: 1.4; }
  </style>
</head>
<body>
<main>
  <h1>Follower — manual override</h1>
  <div id="status">Stopped</div>
  <div class="speed">
    <label>Speed: <b id="speedValue">30</b>%</label>
    <input id="speed" type="range" min="0" max="100" value="30">
  </div>
  <button id="forward">Hold for FORWARD</button>
  <button id="reverse">Hold for REVERSE</button>
  <button id="stop">STOP</button>
  <small>Manual override. Autonomous follow is driven by /follow?bearing=&distance=
  from the phone/server. Any manual button here takes over; STOP halts follow too.</small>
</main>
<script>
  const speed = document.querySelector('#speed');
  const speedValue = document.querySelector('#speedValue');
  const statusText = document.querySelector('#status');
  let timer = null;
  let direction = 'stop';

  speed.oninput = () => speedValue.textContent = speed.value;

  function send(dir) {
    fetch(`/drive?dir=${dir}&speed=${speed.value}&t=${Date.now()}`,
          {cache: 'no-store', keepalive: true}).catch(() => {});
  }

  function stop(sendCommand = true) {
    direction = 'stop';
    clearInterval(timer);
    timer = null;
    document.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    statusText.textContent = 'Stopped';
    if (sendCommand) send('stop');
  }

  function start(dir, button) {
    stop(false);
    direction = dir;
    button.classList.add('active');
    statusText.textContent = `${dir === 'fwd' ? 'Forward' : 'Reverse'} at ${speed.value}%`;
    send(dir);
    timer = setInterval(() => send(direction), 1000);
  }

  const stopButton = document.querySelector('#stop');
  const directionButtons = [
    [document.querySelector('#forward'), 'fwd'],
    [document.querySelector('#reverse'), 'rev']
  ];

  if (navigator.maxTouchPoints > 0) {
    for (const [button, dir] of directionButtons) {
      button.addEventListener('touchstart', e => { e.preventDefault(); start(dir, button); }, {passive: false});
    }
    document.addEventListener('touchend', e => { if (direction !== 'stop') { e.preventDefault(); stop(); } }, {passive: false});
    document.addEventListener('touchcancel', e => { if (direction !== 'stop') stop(); }, {passive: false});
    stopButton.addEventListener('touchstart', e => { e.preventDefault(); stop(); }, {passive: false});
  } else {
    for (const [button, dir] of directionButtons) {
      button.addEventListener('mousedown', e => { e.preventDefault(); start(dir, button); });
    }
    document.addEventListener('mouseup', () => { if (direction !== 'stop') stop(); });
    stopButton.addEventListener('mousedown', e => { e.preventDefault(); stop(); });
  }
  document.addEventListener('contextmenu', e => e.preventDefault());
</script>
</body>
</html>
)HTML";

// ---------------------------------------------------------------------------
// Low-level output helpers
// ---------------------------------------------------------------------------
uint32_t pulseUsToDuty(uint16_t pulseUs, uint32_t freqHz, uint8_t bits) {
  const uint32_t maxDuty = (1UL << bits) - 1;
  const uint32_t periodUs = 1000000UL / freqHz;
  return (static_cast<uint32_t>(pulseUs) * maxDuty + periodUs / 2) / periodUs;
}

void writeEscMicroseconds(uint16_t pulseUs) {
  pulseUs = constrain(pulseUs, ESC_MIN_US, ESC_MAX_US);
  ledcWrite(ESC_PIN, pulseUsToDuty(pulseUs, ESC_FREQUENCY_HZ, ESC_RESOLUTION_BITS));
}

void writeServoMicroseconds(uint16_t pulseUs) {
  pulseUs = constrain(pulseUs, SERVO_MIN_US, SERVO_MAX_US);
  ledcWrite(SERVO_PIN, pulseUsToDuty(pulseUs, SERVO_FREQUENCY_HZ, SERVO_RESOLUTION_BITS));
}

// Signed throttle in percent: + forward, - reverse, 0 neutral. Applies the ESC
// deadband exactly like the original manual controller.
void applyThrottle(int pct) {
  pct = constrain(pct, -100, 100);
  if (pct > 0) {
    const uint16_t pulse = ESC_NEUTRAL_US + ESC_DEADBAND_US +
      ((ESC_MAX_US - ESC_NEUTRAL_US - ESC_DEADBAND_US) * pct) / 100;
    writeEscMicroseconds(pulse);
  } else if (pct < 0) {
    const uint16_t pulse = ESC_NEUTRAL_US - ESC_DEADBAND_US -
      ((ESC_NEUTRAL_US - ESC_MIN_US - ESC_DEADBAND_US) * (-pct)) / 100;
    writeEscMicroseconds(pulse);
  } else {
    writeEscMicroseconds(ESC_NEUTRAL_US);
  }
  appliedThrottlePct = pct;
}

// Map a bearing in degrees to a steering pulse. + bearing (person to the right)
// steers right; STEER_SENSE flips it if your linkage is mirrored.
void applySteering(float bearingDeg) {
  bearingDeg = constrain(bearingDeg, -STEER_INPUT_MAX_DEG, STEER_INPUT_MAX_DEG);
  const float norm = (STEER_SENSE * bearingDeg) / STEER_INPUT_MAX_DEG; // -1..+1
  const uint16_t pulse = SERVO_CENTER_US +
      (int)(norm * (SERVO_MAX_US - SERVO_CENTER_US));
  writeServoMicroseconds(pulse);
}

void haltRover() {
  applyThrottle(0);
  applySteering(0.0f);   // re-center wheels
  mode = MODE_IDLE;
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------
void handleDrive() {   // manual override (original behaviour)
  const String direction = server.arg("dir");
  const int speedPercent = constrain(server.arg("speed").toInt(), 0, 100);

  if (direction == "fwd" && speedPercent > 0) {
    applyThrottle(speedPercent);
    applySteering(0.0f);
    mode = MODE_MANUAL;
  } else if (direction == "rev" && speedPercent > 0) {
    applyThrottle(-speedPercent);
    applySteering(0.0f);
    mode = MODE_MANUAL;
  } else {
    haltRover();
  }
  lastCommandMs = millis();
  server.send(200, "text/plain", "OK");
}

void handleFollow() {  // autonomous target from phone/server
  if (!server.hasArg("bearing") || !server.hasArg("distance")) {
    server.send(400, "text/plain", "need bearing & distance");
    return;
  }
  targetBearingDeg = server.arg("bearing").toFloat();
  targetDistanceM  = server.arg("distance").toFloat();
  mode = MODE_FOLLOW;
  lastCommandMs = millis();
  server.send(200, "text/plain", "OK");
}

// ---------------------------------------------------------------------------
// Follow control loop (runs continuously in FOLLOW mode)
// ---------------------------------------------------------------------------
void runFollowControl() {
  // Steering tracks the latest bearing directly.
  applySteering(targetBearingDeg);

  // Throttle holds the standoff distance.
  const float err = targetDistanceM - FOLLOW_DISTANCE_M;  // + => too far => forward
  int desired = 0;
  if (fabs(err) > FOLLOW_DEADBAND_M) {
    float mag = (fabs(err) - FOLLOW_DEADBAND_M) * FOLLOW_KP_PCT_PER_M;
    if (err > 0) desired = (int)constrain(mag, 0.0f, (float)FOLLOW_MAX_FWD_PCT);
    else         desired = -(int)constrain(mag, 0.0f, (float)FOLLOW_MAX_REV_PCT);
  }

  // Slew-limit for a smooth ride and to protect the drivetrain.
  int step = desired - appliedThrottlePct;
  step = constrain(step, -THROTTLE_SLEW_PCT, THROTTLE_SLEW_PCT);
  applyThrottle(appliedThrottlePct + step);
}

// ---------------------------------------------------------------------------
// Arduino entry points
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);

  ledcAttach(ESC_PIN, ESC_FREQUENCY_HZ, ESC_RESOLUTION_BITS);
  ledcAttach(SERVO_PIN, SERVO_FREQUENCY_HZ, SERVO_RESOLUTION_BITS);
  applyThrottle(0);
  applySteering(0.0f);

  // Hold neutral long enough for a typical reversible brushed ESC to arm.
  delay(3000);

  WiFi.mode(WIFI_AP);
  WiFi.setSleep(false);
  WiFi.softAP(AP_NAME, AP_PASSWORD);

  server.on("/", HTTP_GET, []() {
    server.sendHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    server.sendHeader("Pragma", "no-cache");
    server.send_P(200, "text/html", INDEX_HTML);
  });
  server.on("/drive", HTTP_GET, handleDrive);
  server.on("/follow", HTTP_GET, handleFollow);
  server.onNotFound([]() { server.sendHeader("Location", "/"); server.send(302); });
  server.begin();

  Serial.println();
  Serial.printf("Connect to Wi-Fi: %s\n", AP_NAME);
  Serial.printf("Open: http://%s/\n", WiFi.softAPIP().toString().c_str());
  Serial.printf("Follow target: GET http://%s/follow?bearing=<deg>&distance=<m>\n",
                WiFi.softAPIP().toString().c_str());
}

void loop() {
  server.handleClient();

  const uint32_t now = millis();

  // Watchdog: stop if the governing command source went quiet.
  const uint32_t timeout = (mode == MODE_FOLLOW) ? FOLLOW_TIMEOUT_MS : MANUAL_TIMEOUT_MS;
  if (mode != MODE_IDLE && now - lastCommandMs > timeout) {
    haltRover();
  }

  // Fixed-rate follow control loop.
  if (mode == MODE_FOLLOW && now - lastTickMs >= CONTROL_TICK_MS) {
    lastTickMs = now;
    runFollowControl();
  }

  delay(2);
}

// ---------------------------------------------------------------------------
// Tuning / integration notes
// ---------------------------------------------------------------------------
// * Steering geometry: set SERVO_MIN_US/MAX_US to your servo's real end stops
//   and SERVO_CENTER_US so the wheels point straight; flip STEER_SENSE if it
//   turns the wrong way. STEER_INPUT_MAX_DEG is the bearing that commands full
//   lock — lower it for twitchier steering, raise it for gentler.
// * Distance hold: FOLLOW_DISTANCE_M is the standoff; FOLLOW_DEADBAND_M is the
//   dead zone where it coasts. FOLLOW_KP_PCT_PER_M sets how hard it accelerates
//   to close a gap. Caps (FOLLOW_MAX_FWD/REV_PCT) are your safety limits.
// * Car steering can't turn in place: if the person is far to the side, the
//   rover must roll forward to swing around. That's expected. If you later move
//   to differential drive, replace applySteering + the throttle mixing with a
//   left/right speed mix.
// * Network: this stays a SoftAP (join "ESP32-Follower", POST to 192.168.4.1).
//   Whoever runs perception must be on this AP. To instead have the ESP32 JOIN
//   your capture Wi-Fi (so the laptop can be both capture server and sender),
//   switch setup() to WiFi.mode(WIFI_STA)+WiFi.begin(ssid,pass) and target the
//   ESP32's DHCP IP.
