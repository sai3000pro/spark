import Foundation
import GauzensplatCaptureCore

/// Live Wi-Fi mirror transport over `URLSessionWebSocketTask`, implementing the
/// same wire protocol as `tools/live_capture_server` (verified against
/// `simulate_phone.py`).  All I/O is serialized on an actor so capture threads
/// never block.  Local disk remains the source of truth; this only mirrors.
actor WiFiLaptopTransport: CaptureTransport {

    nonisolated let stateBox = StateBox()
    nonisolated var state: TransportState { stateBox.value }

    private var task: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    private var serverSessionID: String?
    private var deviceSessionID: String = "dev-" + UUID().uuidString.prefix(8)
    private var serverURL: URL?

    private var seq = 0
    private var backlog: [MirrorItem] = []
    private var manifest: [String: [String: String]] = [:]
    private let clock = ClockSyncEstimator()

    // telemetry for UI
    nonisolated let telemetry = Telemetry()

    // MARK: connection

    /// Build a ws:// (or wss://) URL for `path` from the http(s) server URL.
    /// `URLSessionWebSocketTask` requires a ws/wss scheme — handing it http
    /// produces an unusable task.
    private static func websocketURL(from serverURL: URL, path: String) -> URL {
        var comps = URLComponents(url: serverURL, resolvingAgainstBaseURL: false)
        comps?.scheme = (serverURL.scheme == "https") ? "wss" : "ws"
        comps?.path = path
        return comps?.url ?? serverURL
    }

    func connect(serverURL: URL) async throws {
        self.serverURL = serverURL
        stateBox.value = .connecting
        let wsURL = Self.websocketURL(from: serverURL, path: "/ws/phone")
        let t = session.webSocketTask(with: wsURL)
        t.resume()
        self.task = t
        try await send(NetworkProtocol.hello(deviceSessionID: deviceSessionID,
                                             appVersion: "1.0"))
        let ack = try await receiveJSON()
        guard ack["accepted"] as? Bool == true else {
            stateBox.value = .offline
            throw TransportError.rejected(String(describing: ack["reason"] ?? "unknown"))
        }
        stateBox.value = .connected
    }

    /// The server session id currently mirrored to, if any. Lets the app persist
    /// the local-dir → server-run mapping so a later "continue session" can rejoin
    /// the same run.
    func currentServerSessionID() -> String? { serverSessionID }

    /// Begin — or RESUME — a server session. Passing `resumeServerSessionID` makes
    /// the server `get_or_create` that exact run (see live_capture_server), so a
    /// continued capture appends to the SAME live splat instead of minting a new
    /// one. Omitting it preserves the original behaviour exactly.
    func beginSession(deviceSessionID: String, resumeServerSessionID: String? = nil,
                      latitude: Double? = nil, longitude: Double? = nil,
                      placeName: String? = nil) async throws -> String {
        self.deviceSessionID = deviceSessionID
        if let resume = resumeServerSessionID { serverSessionID = resume }
        try await send(NetworkProtocol.beginSession(deviceSessionID: deviceSessionID,
                                                    sessionID: serverSessionID,
                                                    latitude: latitude,
                                                    longitude: longitude,
                                                    placeName: placeName))
        let ack = try await receiveJSON()
        guard let sid = ack["session_id"] as? String else { throw TransportError.protocolError }
        serverSessionID = sid
        return sid
    }

    func syncClock(rounds: Int = 5) async {
        for i in 0..<rounds {
            let t0 = Int64(Date().timeIntervalSince1970 * 1e9)
            guard (try? await send(NetworkProtocol.ping(seq: i, t0ClientNs: t0))) != nil,
                  let pong = try? await receiveJSON(),
                  let t1 = (pong["t1_server_ns"] as? NSNumber)?.int64Value,
                  let t2 = (pong["t2_server_ns"] as? NSNumber)?.int64Value else { continue }
            let t3 = Int64(Date().timeIntervalSince1970 * 1e9)
            clock.add(t0: t0, t1: t1, t2: t2, t3: t3)
        }
        let rtt = clock.bestRttNs.map { Double($0) / 1e6 }
        let off = clock.bestOffsetNs.map { $0 / 1e6 }
        telemetry.onMain { $0.rttMs = rtt; $0.offsetMs = off }
    }

    // MARK: mirroring

    nonisolated func enqueue(_ item: MirrorItem) {
        Task { await self.appendAndDrain(item) }
    }

    private func appendAndDrain(_ item: MirrorItem) async {
        manifest[String(item.identity.frameID), default: [:]][item.identity.payloadType.rawValue] = item.sha256
        backlog.append(item)
        let pending = backlog.count
        telemetry.onMain { $0.pending = pending }
        await drain()
    }

    private var draining = false
    private func drain() async {
        // Actors are RE-ENTRANT across `await`: while one drain() is suspended at
        // `await sendPayload`, a second enqueue's drain() can run, and both loops read
        // backlog[0] and call removeFirst() on the same single item -> crash
        // ("Can't remove first element from an empty collection"). Guard so only ONE
        // drain loop runs; a concurrent caller returns (its item is already queued and
        // this loop picks it up on its next iteration).
        if draining { return }
        guard state == .connected || state == .degraded else { return }
        draining = true
        defer { draining = false }
        while !backlog.isEmpty {
            let item = backlog[0]
            do {
                try await sendPayload(item)
                if !backlog.isEmpty { backlog.removeFirst() }   // belt-and-suspenders
                let pending = backlog.count
                telemetry.onMain { $0.pending = pending; $0.sent += 1 }
            } catch {
                stateBox.value = .reconnecting
                if await reconnect() { stateBox.value = .connected; continue }
                stateBox.value = .offline
                return   // keep backlog on disk-referenced items; retry later
            }
        }
    }

    private func sendPayload(_ item: MirrorItem) async throws {
        guard let sid = serverSessionID else { throw TransportError.protocolError }
        seq += 1
        let header = NetworkProtocol.bulkHeader(sessionID: sid, frameID: item.identity.frameID,
                                                payloadType: item.identity.payloadType,
                                                sequence: seq, byteLength: item.byteLength,
                                                sha256: item.sha256)
        let data = try Data(contentsOf: item.fileURL)
        try await send(header)
        try await task?.send(.data(data))
        let ack = try await receiveJSON()
        if ack["type"] as? String == "ack" {
            telemetry.onMain { $0.acked += 1 }
        } else {
            telemetry.onMain { $0.retries += 1 }
            throw TransportError.nack(String(describing: ack["reason"] ?? ""))
        }
    }

    func endSession() async throws -> ReconcileResult {
        guard let sid = serverSessionID else { throw TransportError.protocolError }
        try await send(NetworkProtocol.endSession(sessionID: sid, manifest: manifest))
        var result = try await receiveJSON()
        var rounds = 0
        while (result["complete"] as? Bool != true) && rounds < 5 {
            rounds += 1
            // Re-send missing/corrupt payloads still referenced on disk.
            let missing = (result["missing"] as? [[String: Any]] ?? [])
                + (result["checksum_failures"] as? [[String: Any]] ?? [])
            for m in missing {
                if let fid = m["frame_id"] as? Int, let ptRaw = m["payload_type"] as? String,
                   let item = backlog.first(where: { $0.identity.frameID == fid
                       && $0.identity.payloadType.rawValue == ptRaw }) {
                    try? await sendPayload(item)
                }
            }
            try await send(NetworkProtocol.endSession(sessionID: sid, manifest: manifest))
            result = try await receiveJSON()
        }
        _ = try? await send(NetworkProtocol.finalize(sessionID: sid))
        _ = try? await receiveJSON()
        return ReconcileResult(
            localFrames: result["local_frames"] as? Int ?? manifest.count,
            serverFrames: result["server_frames"] as? Int ?? 0,
            missing: (result["missing"] as? [[String: Any]])?.count ?? 0,
            checksumFailures: (result["checksum_failures"] as? [[String: Any]])?.count ?? 0)
    }

    nonisolated func disconnect() {
        Task { await self.closeTask() }
    }
    private func closeTask() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        stateBox.value = .offline
    }

    // MARK: reconnect w/ exponential backoff

    private func reconnect(maxAttempts: Int = 6) async -> Bool {
        guard let url = serverURL else { return false }
        var delayMs: UInt64 = 100
        for _ in 0..<maxAttempts {
            do {
                try await connect(serverURL: url)
                _ = try await beginSession(deviceSessionID: deviceSessionID)
                return true
            } catch {
                try? await Task.sleep(nanoseconds: delayMs * 1_000_000)
                delayMs = min(delayMs * 2, 2000)
            }
        }
        return false
    }

    // MARK: low-level

    private func send(_ obj: [String: Any]) async throws {
        let text = try NetworkProtocol.jsonString(obj)
        guard let task = task else { throw TransportError.notConnected }
        try await task.send(.string(text))
    }

    private func receiveJSON() async throws -> [String: Any] {
        guard let task = task else { throw TransportError.notConnected }
        let msg = try await task.receive()
        switch msg {
        case .string(let s):
            return (try JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any]) ?? [:]
        case .data(let d):
            return (try JSONSerialization.jsonObject(with: d) as? [String: Any]) ?? [:]
        @unknown default:
            throw TransportError.protocolError
        }
    }

    enum TransportError: Error {
        case notConnected, protocolError, rejected(String), nack(String)
    }

    /// Thread-safe box so `state` is readable synchronously from the UI.
    final class StateBox: @unchecked Sendable {
        private let lock = NSLock()
        private var _v: TransportState = .offline
        var value: TransportState {
            get { lock.lock(); defer { lock.unlock() }; return _v }
            set { lock.lock(); _v = newValue; lock.unlock() }
        }
    }

    final class Telemetry: @unchecked Sendable, ObservableObject {
        @Published var pending = 0
        @Published var sent = 0
        @Published var acked = 0
        @Published var retries = 0
        @Published var rttMs: Double?
        @Published var offsetMs: Double?

        /// `@Published` MUST be mutated on the main thread — these values are
        /// written from the transport actor's background executor, so route
        /// every mutation through here to avoid a SwiftUI background-publish crash.
        func onMain(_ block: @escaping (Telemetry) -> Void) {
            if Thread.isMainThread { block(self) }
            else { DispatchQueue.main.async { block(self) } }
        }
    }
}
