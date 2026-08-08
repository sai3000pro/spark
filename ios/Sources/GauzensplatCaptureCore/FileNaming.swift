import Foundation

/// Deterministic, collision-free names for sessions, frames, and payloads.
public enum FileNaming {

    /// Zero-padded 6-digit frame stem, e.g. `000012`.
    public static func frameStem(_ frameID: Int) -> String {
        String(format: "%06d", frameID)
    }

    public static func rgbRelPath(_ frameID: Int) -> String {
        "frames/\(frameStem(frameID)).\(CaptureFormat.rgbExt)"
    }
    public static func depthRelPath(_ frameID: Int) -> String {
        "depth/\(frameStem(frameID)).\(CaptureFormat.depthExt)"
    }
    public static func confidenceRelPath(_ frameID: Int) -> String {
        "confidence/\(frameStem(frameID)).\(CaptureFormat.confidenceExt)"
    }

    /// `capture_<yyyymmdd-HHmmss>_<uuid8>` — sortable + unique.
    public static func sessionDirName(date: Date = Date(),
                                      uuid: UUID = UUID()) -> String {
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.timeZone = TimeZone(identifier: "UTC")
        fmt.dateFormat = "yyyyMMdd-HHmmss"
        let ts = fmt.string(from: date)
        let short = uuid.uuidString.prefix(8)
        return "capture_\(ts)_\(short)"
    }
}
