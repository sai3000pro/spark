import Foundation

/// Wire-protocol message builders + payload identity.  Matches
/// `tools/live_capture_server/protocol.py`.  JSON control frames are text;
/// bulk payloads are a `bulk_header` text frame + one binary frame.
public enum PayloadType: String {
    case rgb
    case depth
    case confidence
    case frameMetadata = "frame_metadata"
}

public enum NetworkProtocol {
    public static let version = CaptureFormat.networkProtocolVersion

    public static let clientPhone = "iphone"
    public static let clientESP32 = "esp32"

    public static func hello(deviceSessionID: String, appVersion: String) -> [String: Any] {
        ["type": "hello",
         "protocol_version": version,
         "client_type": clientPhone,
         "device_session_id": deviceSessionID,
         "app_version": appVersion]
    }

    public static func beginSession(deviceSessionID: String,
                                    sessionID: String? = nil) -> [String: Any] {
        var m: [String: Any] = ["type": "begin_session",
                                "protocol_version": version,
                                "device_session_id": deviceSessionID]
        if let s = sessionID { m["session_id"] = s }
        return m
    }

    public static func ping(seq: Int, t0ClientNs: Int64) -> [String: Any] {
        ["type": "ping", "protocol_version": version, "seq": seq,
         "t0_client_ns": t0ClientNs]
    }

    public static func bulkHeader(sessionID: String, frameID: Int,
                                  payloadType: PayloadType, sequence: Int,
                                  byteLength: Int, sha256: String) -> [String: Any] {
        ["type": "bulk_header",
         "protocol_version": version,
         "session_id": sessionID,
         "frame_id": frameID,
         "payload_type": payloadType.rawValue,
         "sequence": sequence,
         "byte_length": byteLength,
         "sha256": sha256]
    }

    public static func endSession(sessionID: String,
                                  manifest: [String: [String: String]]) -> [String: Any] {
        ["type": "end_session", "protocol_version": version,
         "session_id": sessionID, "manifest": ["frames": manifest]]
    }

    public static func finalize(sessionID: String) -> [String: Any] {
        ["type": "finalize", "protocol_version": version, "session_id": sessionID]
    }

    public static func jsonData(_ obj: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: obj, options: [])
    }

    public static func jsonString(_ obj: [String: Any]) throws -> String {
        String(decoding: try jsonData(obj), as: UTF8.self)
    }
}

/// A payload's stable identity — never inferred from arrival order.
public struct PayloadIdentity: Hashable {
    public let frameID: Int
    public let payloadType: PayloadType
    public init(frameID: Int, payloadType: PayloadType) {
        self.frameID = frameID; self.payloadType = payloadType
    }
}
