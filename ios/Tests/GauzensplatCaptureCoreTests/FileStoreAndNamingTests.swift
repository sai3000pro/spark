import XCTest
import simd
@testable import GauzensplatCaptureCore

final class FileStoreAndNamingTests: XCTestCase {

    func testSequentialFrameNaming() {
        XCTAssertEqual(FileNaming.frameStem(0), "000000")
        XCTAssertEqual(FileNaming.frameStem(12), "000012")
        XCTAssertEqual(FileNaming.frameStem(123456), "123456")
        XCTAssertEqual(FileNaming.rgbRelPath(12), "frames/000012.jpg")
        XCTAssertEqual(FileNaming.depthRelPath(12), "depth/000012.f32")
        XCTAssertEqual(FileNaming.confidenceRelPath(12), "confidence/000012.u8")
    }

    func testSessionDirUniqueness() {
        let a = FileNaming.sessionDirName()
        let b = FileNaming.sessionDirName()
        XCTAssertNotEqual(a, b)                 // UUID suffix differs
        XCTAssertTrue(a.hasPrefix("capture_"))
    }

    func testFileStoreWritesInspectableCapture() throws {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("gz_test_\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let dirName = FileNaming.sessionDirName()
        let store = try CaptureFileStore(baseDirectory: tmp, sessionDirName: dirName)
        try store.writeSessionInfo(SessionInfo(sessionID: dirName, deviceModel: "test",
                                               appVersion: "t", sampleRateHz: 5))

        let K = simd_float3x3(columns: (SIMD3<Float>(1000, 0, 0),
                                        SIMD3<Float>(0, 1000, 0),
                                        SIMD3<Float>(960, 720, 1)))
        for i in 0..<3 {
            var T = matrix_identity_float4x4
            T.columns.3 = SIMD4<Float>(Float(i) * 0.5, 0, 0, 1)
            let depth = BinaryEncoding.encodeDepth([Float](repeating: 2.0, count: 8 * 6))
            let conf = BinaryEncoding.encodeConfidence([UInt8](repeating: 2, count: 8 * 6))
            let meta = FrameMetadata(frameID: i, timestamp: Double(i) * 0.2,
                                     sessionTime: Double(i) * 0.2, transform: T,
                                     intrinsics: K, imageWidth: 1920, imageHeight: 1440,
                                     trackingState: .normal,
                                     depth: .init(width: 8, height: 6))
            try store.writeFrame(meta, rgbJPEG: Data([0xff, 0xd8, 0xff, 0xd9]),
                                 depth: depth, confidence: conf)
        }
        store.close()

        // metadata.jsonl has 3 lines; each parses; files exist.
        let metaURL = tmp.appendingPathComponent(dirName).appendingPathComponent("metadata.jsonl")
        let lines = try String(contentsOf: metaURL, encoding: .utf8)
            .split(separator: "\n").map(String.init)
        XCTAssertEqual(lines.count, 3)
        let first = try JSONSerialization.jsonObject(with: Data(lines[0].utf8)) as! [String: Any]
        XCTAssertEqual(first["frame_id"] as? Int, 0)
        XCTAssertEqual(first["depth_format"] as? String, "float32_le")
        XCTAssertNotNil(first["camera_transform"])
        let depthURL = tmp.appendingPathComponent(dirName).appendingPathComponent("depth/000000.f32")
        XCTAssertEqual(try Data(contentsOf: depthURL).count, 8 * 6 * 4)
    }

    func testMissingDepthFrameStored() throws {
        let K = matrix_identity_float3x3
        var T = matrix_identity_float4x4
        T.columns.3 = SIMD4<Float>(0, 0, 0, 1)
        let meta = FrameMetadata(frameID: 0, timestamp: 0, sessionTime: 0, transform: T,
                                 intrinsics: K, imageWidth: 1920, imageHeight: 1440,
                                 trackingState: .limited, depth: nil)
        XCTAssertEqual(meta.depthStatus, "unavailable")
        XCTAssertNil(meta.depthPath)
        let line = try meta.jsonLine()
        XCTAssertTrue(line.contains("\"tracking_state\":\"limited\""))
    }
}
