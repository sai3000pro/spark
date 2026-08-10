import Foundation

/// Foundation-only on-disk writer for a capture session.  Streams to disk,
/// appends metadata incrementally, never reloads the whole recording — a
/// 10-minute capture uses the same code path as a 30-second one.
///
/// This is the LOCAL SOURCE OF TRUTH.  It has no dependency on ARKit or the
/// network, so it is fully unit-testable on the Mac.
public final class CaptureFileStore {
    public let root: URL
    public let sessionID: String
    private let fm = FileManager.default
    private var metadataHandle: FileHandle?

    public private(set) var bytesWritten: Int = 0

    public init(baseDirectory: URL, sessionDirName: String) throws {
        self.root = baseDirectory.appendingPathComponent(sessionDirName, isDirectory: true)
        self.sessionID = sessionDirName
        for sub in ["frames", "depth", "confidence", "diagnostics"] {
            try fm.createDirectory(at: root.appendingPathComponent(sub),
                                   withIntermediateDirectories: true)
        }
        let metaURL = root.appendingPathComponent("metadata.jsonl")
        fm.createFile(atPath: metaURL.path, contents: nil)
        self.metadataHandle = try FileHandle(forWritingTo: metaURL)
    }

    /// Reopen an EXISTING session directory to CONTINUE it: keeps its frames,
    /// `session.json`, and `metadata.jsonl`, seeking the metadata handle to the
    /// end so new records append instead of truncating. Powers "continue session".
    /// The caller resumes frame numbering at `maxFrameID(...) + 1` so existing
    /// frame files are never overwritten.
    public init(resuming baseDirectory: URL, sessionDirName: String) throws {
        self.root = baseDirectory.appendingPathComponent(sessionDirName, isDirectory: true)
        self.sessionID = sessionDirName
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: root.path, isDirectory: &isDir), isDir.boolValue else {
            throw CocoaError(.fileNoSuchFile)
        }
        // createDirectory(withIntermediateDirectories:) is idempotent — it neither
        // errors nor clears an existing subdir, so this only fills in any gaps.
        for sub in ["frames", "depth", "confidence", "diagnostics"] {
            try fm.createDirectory(at: root.appendingPathComponent(sub),
                                   withIntermediateDirectories: true)
        }
        let metaURL = root.appendingPathComponent("metadata.jsonl")
        if !fm.fileExists(atPath: metaURL.path) {
            fm.createFile(atPath: metaURL.path, contents: nil)
        }
        let handle = try FileHandle(forWritingTo: metaURL)
        try handle.seekToEnd()   // append, never truncate
        self.metadataHandle = handle
    }

    /// Highest frame id already written for a session (by scanning `frames/`), or
    /// `-1` when none exist. A resumed recording starts at this + 1.
    public static func maxFrameID(baseDirectory: URL, sessionDirName: String) -> Int {
        let framesDir = baseDirectory
            .appendingPathComponent(sessionDirName, isDirectory: true)
            .appendingPathComponent("frames", isDirectory: true)
        guard let names = try? FileManager.default
            .contentsOfDirectory(atPath: framesDir.path) else { return -1 }
        var maxID = -1
        for name in names {
            let stem = (name as NSString).deletingPathExtension   // "000123.jpg" -> "000123"
            if let id = Int(stem) { maxID = max(maxID, id) }
        }
        return maxID
    }

    public func writeSessionInfo(_ info: SessionInfo) throws {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
        let data = try enc.encode(info)
        try data.write(to: root.appendingPathComponent("session.json"))
    }

    /// Write RGB (already JPEG-encoded), depth bytes, confidence bytes, then the
    /// metadata line.  Order guarantees the metadata never references a file
    /// that isn't on disk yet.  Returns the URLs written (for network enqueue).
    @discardableResult
    public func writeFrame(_ meta: FrameMetadata,
                           rgbJPEG: Data,
                           depth: Data?,
                           confidence: Data?) throws -> [PayloadType: URL] {
        var urls: [PayloadType: URL] = [:]
        let rgbURL = root.appendingPathComponent(meta.rgbPath)
        try rgbJPEG.write(to: rgbURL, options: .atomic)
        urls[.rgb] = rgbURL
        bytesWritten += rgbJPEG.count

        if let d = depth, let dp = meta.depthPath {
            let u = root.appendingPathComponent(dp)
            try d.write(to: u, options: .atomic)
            urls[.depth] = u
            bytesWritten += d.count
        }
        if let c = confidence, let cp = meta.confidencePath {
            let u = root.appendingPathComponent(cp)
            try c.write(to: u, options: .atomic)
            urls[.confidence] = u
            bytesWritten += c.count
        }

        let line = try meta.jsonLine() + "\n"
        if let h = metadataHandle, let data = line.data(using: .utf8) {
            try h.write(contentsOf: data)
            bytesWritten += data.count
        }
        return urls
    }

    /// Flush + fsync metadata (called at STOP / interruption for durability).
    /// Must be called on the same (writer) thread that calls `writeFrame`.
    public func flush() {
        try? metadataHandle?.synchronize()
    }

    public func writeSummary(_ summary: SessionSummary) throws {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
        let data = try enc.encode(summary)
        try data.write(to: root.appendingPathComponent("diagnostics/summary.json"))
    }

    public func close() {
        try? metadataHandle?.synchronize()
        try? metadataHandle?.close()
        metadataHandle = nil
    }
}
