import Foundation
import Combine
import ARKit
import CoreLocation
import SwiftUI
import UIKit
import GauzensplatCaptureCore

/// Bridges ARSessionController + CaptureCoordinator + Wi-Fi transport to SwiftUI.
@MainActor
final class CaptureViewModel: ObservableObject {

    let ar = ARSessionController()
    @Published var coordinator: CaptureCoordinator

    // Coverage feedback: drives the on-screen LiDAR mesh heatmap + % ring. Fed from
    // the capture queue via ar.onFrame; independent of the recording pipeline.
    let coverage = CoverageMap()

    // network / connection UI state
    @Published var serverAddress: String = UserDefaults.standard
        .string(forKey: "lastServerAddress") ?? ""
    @Published var connectionMessage = "OFFLINE"
    @Published var connected = false
    @Published var rttMs: Double?
    @Published var offsetMs: Double?
    @Published var mirrorEnabled = false
    @Published var recordStatus: String?

    private var transport: CaptureTransport
    private var wifi: WiFiLaptopTransport?
    private var rateHz: Double = 5

    // Latest one-shot GPS fix for the CURRENT recording (nil until it resolves or if
    // denied/unavailable). Written into session.json + the begin_session handshake.
    // Purely additive & fail-open — recording never waits on these beyond the ~1s
    // one-shot timeout, and stays fully functional when they remain nil.
    private var captureLatitude: Double?
    private var captureLongitude: Double?
    private var capturePlaceName: String?

    // Maps a local session dir (capture_…) → the server run id (sess_…) it was
    // mirrored to, persisted at captures/sessions_index.json. Lets "continue
    // session" rejoin the SAME live splat run. Purely additive — nothing in the
    // normal record path reads it.
    private var sessionsIndex: [String: String] = [:]

    // Local session dirs CONFIRMED fully mirrored to the laptop (reconcile complete,
    // or verified against the server). Persisted at captures/synced_sessions.json.
    // A synced session's phone copy is redundant and safe to delete to free storage.
    private var syncedSessions: Set<String> = []

    // `health` and `stats` live on the child ObservableObjects (ar / coordinator).
    // SwiftUI only observes THIS object, so forward the children's change
    // notifications here or the UI never re-renders while recording.
    private var cancellables = Set<AnyCancellable>()
    private var coordinatorCancellable: AnyCancellable?

    init() {
        let offline = OfflineTransport()
        self.transport = offline
        self.coordinator = CaptureCoordinator(sampler: FixedRateSampler(rateHz: 5),
                                              transport: offline)
        ar.onFrame = { [weak self] frame in
            guard let self else { return }
            // Fold into coverage FIRST so the keyframe signal can tag this frame's
            // mirrored metadata (coverage only accumulates while active).
            let kf = self.coverage.update(frame)
            self.coordinator.ingest(frame, keyframe: kf.isKeyframe, trigger: kf.trigger)
        }
        ar.onInterruption = { [weak self] _ in self?.coordinator.handleInterruption() }
        ar.objectWillChange
            .receive(on: RunLoop.main)
            .sink { [weak self] in self?.objectWillChange.send() }
            .store(in: &cancellables)
        bindCoordinator()
        loadSessionsIndex()
        loadSyncedSessions()
    }

    private func bindCoordinator() {
        coordinatorCancellable = coordinator.objectWillChange
            .receive(on: RunLoop.main)
            .sink { [weak self] in self?.objectWillChange.send() }
        coordinator.onAutoStop = { [weak self] reason in
            self?.recordStatus = "recording stopped by: \(reason) — saved \(self?.coordinator.stats.framesSaved ?? 0) frame(s)"
        }
        coordinator.onWriteError = { [weak self] desc in
            self?.recordStatus = "disk write failed: \(desc)"
        }
    }

    // MARK: capture

    var health: ARSessionController.Health { ar.health }
    var stats: CaptureCoordinator.Stats { coordinator.stats }

    func setRate(_ hz: Double) {
        rateHz = hz
        rebuildCoordinator()
    }

    private func rebuildCoordinator() {
        coordinator = CaptureCoordinator(sampler: FixedRateSampler(rateHz: rateHz),
                                         transport: transport)
        bindCoordinator()
    }

    func onAppear() {
        ar.refreshSupport()
        // Prompt on first launch; if already denied this just refreshes the
        // status text (no prompt) so the UI can route the user to Settings.
        // On grant, run the session immediately so the camera preview is live
        // before recording (ingest self-gates, so nothing is recorded yet).
        ar.requestCameraAccess { [weak self] granted in
            guard let self else { return }
            self.ar.refreshSupport()
            if granted { _ = self.ar.start() }
        }
        // Prompt for the mic too so audio can be captured during a scan. Purely
        // additive: if denied, recording proceeds normally without audio.
        AudioCapture.requestAccess { _ in }
        // Prompt for location so captures can be tagged with a place for the album
        // map. Fail-open: if denied/unavailable, recording proceeds with no coords.
        LocationOneShot.requestAuthorization()
        // Warm a one-shot fix so coords are ready for the mirror handshake + the
        // first recording's session.json (best-effort; never blocks anything).
        Task { [weak self] in
            let (coord, name) = await LocationOneShot.fetch(timeout: 2.0)
            guard let self, coord != nil || name != nil else { return }
            self.captureLatitude = coord?.latitude
            self.captureLongitude = coord?.longitude
            self.capturePlaceName = name
        }
    }

    /// Call when the app returns to the foreground — the user may have flipped
    /// the Camera switch in Settings while we were backgrounded.
    func refreshOnForeground() { ar.refreshSupport() }

    /// Deep-link into this app's Settings page so the user can enable Camera.
    func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

    func startRecording() {
        // Re-entrancy guard: a second tap while the machine is already leaving .idle
        // must NOT start again (that throws CaptureStateError). Use the coordinator's
        // SYNCHRONOUS state, not the async-published stats.state which lags a tap.
        guard coordinator.currentState == .idle || coordinator.currentState == .completed
                || coordinator.currentState == .failed else { return }
        recordStatus = nil
        // A completed/failed CaptureCoordinator has a closed queue + finished state
        // machine, so reuse would silently no-op. Build a fresh one per session.
        if coordinator.currentState != .idle {
            rebuildCoordinator()
        }
        guard ar.start() else {
            recordStatus = ar.health.lastError ?? "AR session did not start"
            return
        }
        // Stamp any GPS coords we already have (from the onAppear prefetch), then start
        // IMMEDIATELY and synchronously — recording must never wait on GPS/network.
        coordinator.setLocation(latitude: captureLatitude, longitude: captureLongitude,
                                placeName: capturePlaceName)
        do {
            try coordinator.start()
            coverage.reset()
            coverage.active = true
            recordStatus = "recording"
            recordMappingIfMirrored()
        } catch {
            recordStatus = "recording failed to start: \(error.localizedDescription)"
            return
        }
        // Refresh the fix in the background (fail-open); it stamps the LIVE session
        // and is cached for the next mirror handshake. Never blocks recording.
        Task {
            let (coord, name) = await LocationOneShot.fetch(timeout: 1.0)
            if coord != nil || name != nil {
                self.captureLatitude = coord?.latitude
                self.captureLongitude = coord?.longitude
                self.capturePlaceName = name
                self.coordinator.setLocation(latitude: coord?.latitude,
                                             longitude: coord?.longitude, placeName: name)
            }
        }
    }

    /// Continue a PREVIOUS session: reopen its on-disk store in append mode and,
    /// when mirroring, rejoin the same server run so the live splat keeps building
    /// on that scan instead of starting a new one. The normal Record button is
    /// untouched; this is the only entry point that resumes.
    func resumeRecording(dirName: String) {
        guard coordinator.currentState == .idle || coordinator.currentState == .completed
                || coordinator.currentState == .failed else { return }
        recordStatus = nil
        if coordinator.currentState != .idle {
            rebuildCoordinator()
        }
        guard ar.start() else {
            recordStatus = ar.health.lastError ?? "AR session did not start"
            return
        }
        // If mirroring, rejoin the run this session belongs to FIRST (so the
        // server appends via get_or_create instead of minting a fresh sess_…),
        // then begin appending frames. Doing it in this order avoids a window
        // where resumed frames would mirror to the previous run id.
        if mirrorEnabled, let wifi = wifi, let serverID = sessionsIndex[dirName] {
            Task {
                _ = try? await wifi.beginSession(deviceSessionID: UUID().uuidString,
                                                 resumeServerSessionID: serverID,
                                                 latitude: self.captureLatitude,
                                                 longitude: self.captureLongitude,
                                                 placeName: self.capturePlaceName)
                self.beginResume(dirName: dirName)
            }
        } else {
            beginResume(dirName: dirName)
        }
    }

    private func beginResume(dirName: String) {
        do {
            try coordinator.resume(sessionDirName: dirName)
            // Heatmap fix (continue-scan): do NOT reset coverage here. The CoverageMap
            // persists in memory across recordings (stop() never resets it), so simply
            // skipping reset() preserves the accumulated coverage/heatmap when the user
            // taps "Continue". Only the fresh startRecording() path resets.
            //
            // Caveat: ar.start() (via resumeRecording) runs the ARSession with
            // [.resetTracking, .removeExistingAnchors] (see ARSessionController.start),
            // so the world coordinate frame is re-established and the KEPT voxels may not
            // perfectly align with the new frame until the user re-scans overlapping
            // geometry. That is still far less surprising than wiping the whole heatmap,
            // and we deliberately avoid ARWorldMap relocalization here (out of scope).
            coverage.active = true
            recordStatus = "continuing \(dirName)"
            recordMappingIfMirrored()
        } catch {
            recordStatus = "continue failed: \(error.localizedDescription)"
        }
    }

    func stopRecording() {
        coverage.active = false
        let dirName = coordinator.lastSessionURL?.lastPathComponent
        coordinator.stop()
        // Keep the AR session running so the camera preview stays live after STOP.
        if mirrorEnabled, let wifi = wifi {
            Task {
                let result = try? await wifi.endSession()
                if let r = result {
                    connectionMessage = r.complete
                        ? "SYNC COMPLETE (\(r.serverFrames)/\(r.localFrames))"
                        : "SYNC INCOMPLETE missing \(r.missing)"
                    // Reconcile confirmed every payload is on the laptop -> the phone
                    // copy is now safe to delete from History.
                    if r.complete, let dir = dirName { self.markSynced(dir) }
                }
            }
        }
    }

    var lastSessionURL: URL? { coordinator.lastSessionURL }

    // MARK: session history (continue a previous session)

    /// A past recording on disk, for the History sheet.
    struct PastSession: Identifiable, Hashable {
        let id: String            // == dirName
        let dirName: String
        let url: URL
        let createdAt: Date?
        let frameCount: Int
        let mirrored: Bool        // has a known server-run mapping
        let synced: Bool          // confirmed fully on the laptop -> safe to delete here
    }

    private var capturesDir: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("captures", isDirectory: true)
    }
    private var sessionsIndexURL: URL { capturesDir.appendingPathComponent("sessions_index.json") }

    private func loadSessionsIndex() {
        guard let data = try? Data(contentsOf: sessionsIndexURL),
              let map = try? JSONDecoder().decode([String: String].self, from: data) else { return }
        sessionsIndex = map
    }

    private func saveSessionsIndex() {
        try? FileManager.default.createDirectory(at: capturesDir, withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(sessionsIndex) {
            try? data.write(to: sessionsIndexURL, options: .atomic)
        }
    }

    // MARK: synced-to-laptop tracking (safe-to-delete)

    private var syncedSessionsURL: URL { capturesDir.appendingPathComponent("synced_sessions.json") }

    private func loadSyncedSessions() {
        guard let data = try? Data(contentsOf: syncedSessionsURL),
              let arr = try? JSONDecoder().decode([String].self, from: data) else { return }
        syncedSessions = Set(arr)
    }

    private func saveSyncedSessions() {
        try? FileManager.default.createDirectory(at: capturesDir, withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(Array(syncedSessions)) {
            try? data.write(to: syncedSessionsURL, options: .atomic)
        }
    }

    private func markSynced(_ dirName: String) {
        guard !syncedSessions.contains(dirName) else { return }
        syncedSessions.insert(dirName)
        saveSyncedSessions()
        objectWillChange.send()
    }

    /// Ask the laptop how many frames it holds for each mirrored-but-unconfirmed
    /// session and mark it synced when the server has at least as many as the phone.
    /// Best-effort: covers sessions that ended without a clean reconcile (e.g. the
    /// recording was auto-stopped by low storage). No-op if no server is configured.
    func verifySyncStatus() async {
        guard let base = normalizedURL() else { return }
        for s in listSessions() where s.mirrored && !s.synced && s.frameCount > 0 {
            guard let sid = sessionsIndex[s.dirName],
                  var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) else { continue }
            comps.path = "/api/live_splat"
            comps.queryItems = [URLQueryItem(name: "session", value: sid)]
            guard let url = comps.url,
                  let (data, _) = try? await URLSession.shared.data(from: url),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let serverFrames = obj["frames"] as? Int else { continue }
            if serverFrames >= s.frameCount { markSynced(s.dirName) }
        }
    }

    /// Delete a recording's local files to free storage. Intended for sessions that
    /// are already on the laptop; the caller confirms first. Keeps nothing on the
    /// phone (also drops the run mapping + synced flag).
    func deleteSession(dirName: String) {
        let url = capturesDir.appendingPathComponent(dirName, isDirectory: true)
        try? FileManager.default.removeItem(at: url)
        sessionsIndex[dirName] = nil; saveSessionsIndex()
        if syncedSessions.remove(dirName) != nil { saveSyncedSessions() }
        objectWillChange.send()
    }

    /// After a mirrored recording (new or resumed) starts, remember which server
    /// run this local session maps to, so it can be rejoined later.
    private func recordMappingIfMirrored() {
        guard mirrorEnabled, let wifi = wifi,
              let dir = coordinator.lastSessionURL?.lastPathComponent else { return }
        Task {
            guard let sid = await wifi.currentServerSessionID() else { return }
            self.sessionsIndex[dir] = sid
            self.saveSessionsIndex()
        }
    }

    /// Every recorded session on disk, newest first — powers the History sheet.
    func listSessions() -> [PastSession] {
        let base = capturesDir
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: base, includingPropertiesForKeys: [.contentModificationDateKey, .isDirectoryKey],
            options: [.skipsHiddenFiles]) else { return [] }
        var out: [PastSession] = []
        for url in entries {
            let name = url.lastPathComponent
            guard name.hasPrefix("capture_"),
                  (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true else { continue }
            let frames = (try? FileManager.default.contentsOfDirectory(
                atPath: url.appendingPathComponent("frames").path))?.count ?? 0
            let created = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate
            out.append(PastSession(id: name, dirName: name, url: url, createdAt: created,
                                   frameCount: frames, mirrored: sessionsIndex[name] != nil,
                                   synced: syncedSessions.contains(name)))
        }
        return out.sorted { ($0.createdAt ?? .distantPast) > ($1.createdAt ?? .distantPast) }
    }

    // MARK: networking

    private func normalizedURL() -> URL? {
        var s = serverAddress.trimmingCharacters(in: .whitespaces)
        guard !s.isEmpty else { return nil }
        if !s.hasPrefix("http://") && !s.hasPrefix("https://") { s = "http://" + s }
        return URL(string: s)
    }

    func testConnection() {
        guard let url = normalizedURL() else { connectionMessage = "enter server address"; return }
        connectionMessage = "testing…"
        Task {
            let r = await ConnectionTester.test(serverURL: url)
            self.connected = r.ok
            self.connectionMessage = r.message
            self.rttMs = r.rttMs
            self.offsetMs = r.offsetMs
            if r.ok { UserDefaults.standard.set(self.serverAddress, forKey: "lastServerAddress") }
        }
    }

    /// Enable live mirroring: connect, begin session, sync clock, swap transport.
    func enableMirroring() {
        guard let url = normalizedURL() else { return }
        let wifi = WiFiLaptopTransport()
        self.wifi = wifi
        self.transport = wifi
        Task {
            do {
                try await wifi.connect(serverURL: url)
                // Pass any location we already have so the laptop can stamp a live
                // session's place (usually nil here since mirroring is enabled before
                // recording; fail-open either way).
                _ = try await wifi.beginSession(deviceSessionID: UUID().uuidString,
                                                resumeServerSessionID: nil,
                                                latitude: self.captureLatitude,
                                                longitude: self.captureLongitude,
                                                placeName: self.capturePlaceName)
                await wifi.syncClock()
                self.mirrorEnabled = true
                self.connected = true
                self.connectionMessage = "MIRRORING"
                self.rebuildCoordinator()
            } catch {
                self.connectionMessage = "mirror connect failed"
                self.transport = OfflineTransport()
                self.mirrorEnabled = false
            }
        }
    }

    func disableMirroring() {
        wifi?.disconnect()
        wifi = nil
        transport = OfflineTransport()
        mirrorEnabled = false
        connectionMessage = "OFFLINE"
        rebuildCoordinator()
    }
}

// MARK: - Coverage

/// Voxelized angle-coverage of the scanned surface. For each ~12 cm world cell it tracks
/// which of 12 azimuth buckets the surface has been *seen from* (surface → camera). A cell
/// is "covered enough" once it has been seen from `enoughAngles` distinct azimuths — which
/// is what Gaussian-splat reconstruction needs. Feeds:
///   • `level(x:y:z:)` → per-vertex color for the on-screen mesh heatmap (called on the
///     render thread), and
///   • `fraction` → overall "% of scanned surface that is well-covered" for the ring.
/// Updated from the capture queue via `update(_:)` while `active`.
final class CoverageMap: ObservableObject {
    @Published private(set) var fraction: Double = 0

    /// Result of folding one frame into coverage — drives keyframe tagging (Phase 3).
    struct KeyframeSignal { let isKeyframe: Bool; let trigger: String? }

    private let lock = NSLock()
    // Pure, unit-tested coverage/keyframe logic lives in Core (KeyframeCoverage);
    // this class is just the ARKit depth-reprojection shell + thread-safety.
    private let kc = KeyframeCoverage(azBuckets: 12, cellSize: 0.12, enoughAngles: 5)
    private var _active = false
    private var lastUpdate: TimeInterval = 0      // capture-queue only

    var active: Bool {
        get { lock.lock(); defer { lock.unlock() }; return _active }
        set { lock.lock(); _active = newValue; lock.unlock() }
    }

    func reset() {
        lock.lock(); kc.reset(); lock.unlock()
        DispatchQueue.main.async { self.fraction = 0 }
    }

    /// Coverage 0…1 for a world point (for mesh vertex coloring). Thread-safe.
    func level(x: Float, y: Float, z: Float) -> Float {
        lock.lock(); let l = kc.level(x, y, z); lock.unlock()
        return l
    }

    /// Fold this frame's LiDAR depth into coverage (subsampled + throttled ~8 Hz) and
    /// return whether it should be tagged as a keyframe: a voxel newly crossed
    /// `enoughAngles` (threshold_crossing) or the pose is novel vs the last keyframe
    /// (novel_viewpoint). Non-keyframe / throttled / inactive frames return isKeyframe=false.
    @discardableResult
    func update(_ frame: ARFrame) -> KeyframeSignal {
        let none = KeyframeSignal(isKeyframe: false, trigger: nil)
        guard active, frame.timestamp - lastUpdate >= 0.12 else { return none }
        guard let depth = frame.sceneDepth?.depthMap else { return none }
        lastUpdate = frame.timestamp

        let w = CVPixelBufferGetWidth(depth), h = CVPixelBufferGetHeight(depth)
        CVPixelBufferLockBaseAddress(depth, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(depth, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(depth) else { return none }
        let rowBytes = CVPixelBufferGetBytesPerRow(depth)

        let intr = frame.camera.intrinsics
        let imgRes = frame.camera.imageResolution
        let sx = Float(w) / Float(imgRes.width), sy = Float(h) / Float(imgRes.height)
        let fx = intr.columns.0.x * sx, fy = intr.columns.1.y * sy
        let cx = intr.columns.2.x * sx, cy = intr.columns.2.y * sy
        let pose = frame.camera.transform
        let camPos = SIMD3<Float>(pose.columns.3.x, pose.columns.3.y, pose.columns.3.z)

        let step = 8
        var crossed = false
        lock.lock()
        for v in stride(from: 0, to: h, by: step) {
            let row = base.advanced(by: v * rowBytes).assumingMemoryBound(to: Float32.self)
            for u in stride(from: 0, to: w, by: step) {
                let d = row[u]
                guard d.isFinite, d > 0.2, d < 5 else { continue }
                let xc = (Float(u) - cx) / fx * d
                let yc = (Float(v) - cy) / fy * d
                let world = pose * SIMD4<Float>(xc, -yc, -d, 1)   // ARKit cam looks -Z, +Y up
                let ax = camPos.x - world.x, az = camPos.z - world.z
                guard ax * ax + az * az > 1e-6 else { continue }
                var ang = atan2(ax, az); if ang < 0 { ang += 2 * .pi }
                let bucket = Int(ang / (2 * .pi) * Float(12))
                if kc.observe(x: world.x, y: world.y, z: world.z, bucket: bucket) { crossed = true }
            }
        }
        let novel = kc.acceptPoseNovelty(pose)
        let frac = kc.fraction
        lock.unlock()

        DispatchQueue.main.async { self.fraction = frac }
        let isKf = crossed || novel
        let trigger = crossed ? "threshold_crossing" : (novel ? "novel_viewpoint" : nil)
        return KeyframeSignal(isKeyframe: isKf, trigger: trigger)
    }
}
