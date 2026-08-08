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
