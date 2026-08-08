import Foundation

/// Network states surfaced to the UI.
public enum TransportState: String {
    case offline
    case connecting
    case connected
    case degraded
    case reconnecting
    case syncingBacklog = "syncing_backlog"
}

/// A capture reference queued for background transmit.  References data already
/// persisted on disk (paths) so large RGB/depth buffers are NOT held in RAM.
public struct MirrorItem {
    public let identity: PayloadIdentity
    public let fileURL: URL
    public let sha256: String
    public let byteLength: Int
    public init(identity: PayloadIdentity, fileURL: URL, sha256: String, byteLength: Int) {
        self.identity = identity; self.fileURL = fileURL
        self.sha256 = sha256; self.byteLength = byteLength
    }
}

/// Abstraction so capture logic NEVER cares whether the laptop exists.
/// Future transports (cloud, USB, rover) conform without touching ARKit.
public protocol CaptureTransport: AnyObject {
    var state: TransportState { get }
    func connect(serverURL: URL) async throws
    func beginSession(deviceSessionID: String) async throws -> String  // server session_id
    func enqueue(_ item: MirrorItem)
    func endSession() async throws -> ReconcileResult
    func disconnect()
}

public struct ReconcileResult {
    public let localFrames: Int
    public let serverFrames: Int
    public let missing: Int
    public let checksumFailures: Int
    public var complete: Bool { missing == 0 && checksumFailures == 0 }
    public init(localFrames: Int, serverFrames: Int, missing: Int, checksumFailures: Int) {
        self.localFrames = localFrames; self.serverFrames = serverFrames
        self.missing = missing; self.checksumFailures = checksumFailures
    }
}

/// Records-only transport used when no laptop is configured.  Recording is
/// ALWAYS possible; the network is purely additive.
public final class OfflineTransport: CaptureTransport {
    public private(set) var state: TransportState = .offline
    public init() {}
    public func connect(serverURL: URL) async throws { state = .offline }
    public func beginSession(deviceSessionID: String) async throws -> String { deviceSessionID }
    public func enqueue(_ item: MirrorItem) { /* no-op; local disk is source of truth */ }
    public func endSession() async throws -> ReconcileResult {
        ReconcileResult(localFrames: 0, serverFrames: 0, missing: 0, checksumFailures: 0)
    }
    public func disconnect() { state = .offline }
}
