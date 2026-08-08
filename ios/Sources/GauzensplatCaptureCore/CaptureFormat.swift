import Foundation

/// On-disk capture-format + Wi-Fi protocol version constants.
///
/// These MUST match `tools/arkit_capture/formats.py` and
/// `tools/live_capture_server/protocol.py`.  Two distinct concepts:
/// `captureFormatVersion` (files) and `networkProtocolVersion` (wire).
public enum CaptureFormat {
    public static let captureFormatVersion = 1
    public static let networkProtocolVersion = 1

    public static let depthFormat = "float32_le"
    public static let depthUnits = "meters"
    public static let confidenceFormat = "uint8"

    public static let rgbExt = "jpg"
    public static let depthExt = "f32"
    public static let confidenceExt = "u8"
}

/// ARConfidenceLevel mapping (matches Apple + the Python contract).
public enum ConfidenceLevel: UInt8 {
    case low = 0
    case medium = 1
    case high = 2
}

/// Tracking state as stored in metadata (raw string values shared with Python).
public enum CaptureTrackingState: String, Codable {
    case normal
    case limited
    case notAvailable
}
