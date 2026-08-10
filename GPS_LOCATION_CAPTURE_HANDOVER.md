# Handover: GPS location tagging for GauzensplatCapture (iOS) → album + map

**Owner of this task:** an iOS-focused agent.
**Author of this plan:** web/pipeline agent (already shipped the album location editor + real map that consumes `place`).
**Status:** plan only — no code written yet.

---

## 1. Goal

When the user does a live capture on the phone, capture the **device GPS (lat/lng)** and
optionally a **reverse-geocoded place name** at record time, flow it to the laptop over the
existing capture protocol, and have the studio stamp it into the run's `meta.json` as:

```json
"place": { "name": "Waterloo Park, Ontario", "lat": 43.4669, "lng": -80.5325 }
```

That `place` field already drives everything downstream — it renders on the **album** card and
drops a **pin on the `/walk` map** automatically. No web changes are required; this is purely
"get real coordinates into `meta.place`."

## 2. Hard constraints (read first)

- **The iOS app works GREAT. Do NOT refactor. Additive only.** Every new field is optional.
- **No protocol-version bump.** Adding optional keys to `begin_session` is backward/forward
  compatible (JSON ignores unknown keys; the server only checks `protocol_version` is present).
  This is the same pattern already used to add `keyframe`/`trigger` to frame metadata.
- **Fail open.** If location permission is denied, unavailable, or times out, capture proceeds
  exactly as today with no coords. Never block or delay recording waiting on GPS beyond a short
  timeout (~1s).
- Location fetch must be **one-shot** (not continuous tracking) to preserve battery/behavior.

## 3. Wire contract (the agreement between iOS and server)

Extend the existing `begin_session` message with three OPTIONAL keys:

```jsonc
{
  "type": "begin_session",
  "protocol_version": 1,
  "device_session_id": "…",
  "session_id": "…",        // existing, optional (resume)
  "latitude": 43.4669,       // NEW, optional (Double)
  "longitude": -80.5325,     // NEW, optional (Double)
  "place_name": "Waterloo Park, Ontario"  // NEW, optional (String; reverse-geocoded on device)
}
```

Keys are only emitted when a value exists (`if let`). Snake_case on the wire.

---

## 4. iOS implementation (your work)

Shared networking/records live in the SPM package `ios/Sources/GauzensplatCaptureCore/`; the app
target is `ios/GauzensplatCapture/`.

### 4.1 Add optional fields to the session record — `ios/Sources/GauzensplatCaptureCore/CaptureRecords.swift`
- Struct `SessionInfo` (around **line 106**; fields: `sessionID`, `createdAt`, `deviceModel`,
  `appVersion`, `sampleRateHz`; `CodingKeys` ~line 120; `init` ~line 131).
- Add three optional stored props + CodingKeys + init params (defaulted `nil` so existing call
  sites are unaffected):
  ```swift
  public var latitude: Double?
  public var longitude: Double?
  public var placeName: String?
  // CodingKeys:
  case latitude
  case longitude
  case placeName = "place_name"
  // init(...): add `latitude: Double? = nil, longitude: Double? = nil, placeName: String? = nil`
  //            and assign them.
  ```
- Codable skips nil optionals, so `session.json` stays clean and older tools still parse it.

### 4.2 Add optional params to the handshake — `ios/Sources/GauzensplatCaptureCore/NetworkProtocol.swift`
- `beginSession(deviceSessionID:sessionID:)` at **line 31**. Add optional params and emit if set:
  ```swift
  public static func beginSession(deviceSessionID: String,
                                  sessionID: String? = nil,
                                  latitude: Double? = nil,
                                  longitude: Double? = nil,
                                  placeName: String? = nil) -> [String: Any] {
      var m: [String: Any] = ["type": "begin_session",
                              "protocol_version": version,
                              "device_session_id": deviceSessionID]
      if let s = sessionID { m["session_id"] = s }
      if let lat = latitude { m["latitude"] = lat }
      if let lng = longitude { m["longitude"] = lng }
      if let name = placeName { m["place_name"] = name }
      return m
  }
  ```
- `version` = `CaptureFormat.networkProtocolVersion` (line 18) — **do not change it.**

### 4.3 New: a tiny one-shot location helper (new file in the app target)
Create `ios/GauzensplatCapture/Capture/LocationOneShot.swift` (or similar). Requirements:
- `import CoreLocation`.
- Request `WhenInUse` authorization; if already denied/restricted, return `nil` immediately.
- Do ONE location request (`requestLocation()` or a single `startUpdatingLocation` you stop on
  first fix), with a **~1s timeout** → return `CLLocationCoordinate2D?`.
- Optionally then call `CLGeocoder().reverseGeocodeLocation(...)` with its own short timeout to
  produce a `place_name` (prefer `placemark.name` ?? locality ?? administrativeArea). Reverse
  geocoding is **best-effort** — return coords even if the name lookup fails.
- Keep it self-contained (no singletons that outlive a capture). Must not retain a running
  location session after the fix.

**Reverse geocoding decision:** do it **on device** with `CLGeocoder` (free, instant,
human-readable). Do NOT add a server-side geocoder.

### 4.4 Wire it into the start path — `ios/GauzensplatCapture/App/CaptureViewModel.swift`
- `startRecording()` at **line 114** calls `coordinator.start()` at **line 126**.
- `enableMirroring()` at **line 178** calls `wifi.beginSession(deviceSessionID:)` at **line 186**.
- Minimal flow:
  1. Kick the one-shot location fetch early (e.g. at start of `startRecording()`), store the
     result (coords + optional name) on the view model. Do not `await` it in a way that delays
     `coordinator.start()` beyond the ~1s cap — grab whatever is available.
  2. Pass coords/name into the session record so they land in `session.json`. Two options — pick
     the one that's least invasive in this codebase:
     - **A (preferred):** thread optional `latitude/longitude/placeName` through
       `CaptureCoordinator.init` (**~line 82**, already carries `deviceModel`/`appVersion`) so
       `start()` (**line 99**) includes them when it builds `SessionInfo` (**line 105**).
     - **B:** if the coordinator is constructed before the fix is ready, add a
       `coordinator.setLocation(lat:lng:name:)` setter it applies when writing `SessionInfo`.
  3. In `enableMirroring()`, pass the same values to `beginSession(...)` so the laptop gets them
     even for a live (streamed) session that may never finalize a local `session.json`.

### 4.5 Permission string — `Info.plist` (app target)
Add:
```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Gauzensplat Capture tags your captures with their location so they appear on the album map.</string>
```
(First capture will show the system permission prompt once.)

---

## 5. Server / studio counterpart (context — may be done by another agent)

You do NOT have to do this, but here is the other end of the contract so you can test end-to-end.
The phone connects to the **studio** server on `:8899`, which imports the capture server code from
`tools/live_capture_server/`.

1. **Parse coords** — `tools/live_capture_server/server.py`, `_handle_begin` (**line 211**):
   read `msg.get("latitude")`, `"longitude"`, `"place_name"` and hand them to the store.
2. **Persist** — `tools/live_capture_server/storage.py`, `SessionStore` (`__init__` line 63,
   `_write_server_session` line 123 which writes `server_session.json` line 130 and
   `phone/session.json` line 137). Add an optional metadata dict and include it in both writes.
   Note `_write_server_session` runs at construction (before coords arrive), so add a small
   `set_place(lat,lng,name)` that stores + re-writes.
3. **Stamp the run** — when a run's `meta.json` is created for a live session
   (`ComfyUI/studio/live_recon.py`; `session_dir`/`phone_dir` around lines 189–193, `out_dir` =
   `studio/runs/live_<sid>` line 192) OR wherever the live run is registered, read
   `phone/session.json` and, if it has `latitude`/`longitude`, set
   `meta["place"] = {"name": place_name or "", "lat": …, "lng": …}`.
   Use the exact shape written by `_set_place` in `ComfyUI/studio/server.py` (**lines 745–768**)
   as the reference. Do the same in the offline export path so non-live captures also carry it.

Nothing else is needed — `list_runs()` returns `place` and the web album/map already render it.

---

## 6. Build / deploy / test

- Team `42LZF4Q3RR`, automatic signing. Bundle id `com.gauzensplat.capture`.
- Build+install to device:
  ```
  xcodebuild -destination 'platform=iOS,id=<udid>' -allowProvisioningUpdates
  xcrun devicectl device install app <built .app>
  ```
- Watch console (also how Swift fatal errors surface):
  ```
  xcrun devicectl device process launch --console --terminate-existing --device <udid> com.gauzensplat.capture
  ```

### End-to-end test
1. Grant location permission on first capture.
2. Do a short live capture outdoors (or with a simulated location in Xcode:
   Debug → Simulate Location).
3. On the laptop, confirm `phone/session.json` (and `server_session.json`) contain
   `latitude`/`longitude`/`place_name`.
4. Confirm the resulting run's `ComfyUI/studio/runs/<id>/meta.json` has a `place` block.
5. Open the web app: the card shows the location (◈ + name) on **`/album`**, and a pin appears on
   **`/walk`**. (Web already verified against manually-set `place`.)

### Regression checks (must still pass)
- Capture with location **denied** → records normally, no coords, run has no `place`.
- Older server / no-GPS build interop → handshake still succeeds (optional keys ignored).
- No added latency to record start beyond the ~1s location cap.

---

## 7. Acceptance criteria
- [ ] All new fields optional; `protocol_version` unchanged.
- [ ] Location fetch is one-shot, time-boxed, and fails open.
- [ ] `session.json` + `begin_session` carry `latitude`/`longitude`/`place_name` when available.
- [ ] A located live capture produces `meta.place` and shows on album + map with no web changes.
- [ ] Denied/unavailable location leaves capture behavior byte-for-byte as before.
