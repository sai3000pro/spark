import XCTest
import simd
@testable import GauzensplatCaptureCore

/// Cross-language golden test — these exact values are ALSO asserted by the
/// Python `tools/arkit_capture/tests/test_golden.py`.  Both sides agreeing is
/// the guard against iOS<->Mac format drift.  Keep the two in lockstep.
final class GoldenFormatTests: XCTestCase {

    func testGoldenMatrixRows() {
        // rotate 90deg about Y, translate (1,2,3).  Build in column-major simd,
        // expect the documented row-major serialization.
        let m = simd_float4x4(columns: (
            SIMD4<Float>( 0,  0, -1, 0),   // column 0
            SIMD4<Float>( 0,  1,  0, 0),   // column 1
            SIMD4<Float>( 1,  0,  0, 0),   // column 2
            SIMD4<Float>( 1,  2,  3, 1)    // column 3 (translation)
        ))
        let rows = MatrixSerialization.rows(from: m)
        let golden: [[Double]] = [
            [0, 0, 1, 1],
            [0, 1, 0, 2],
            [-1, 0, 0, 3],
            [0, 0, 0, 1],
        ]
        XCTAssertEqual(rows, golden)
    }

    func testGoldenDepthBytes() {
        // [[1,2],[3,4]] row-major, little-endian float32
        let data = BinaryEncoding.encodeDepth([1.0, 2.0, 3.0, 4.0])
        XCTAssertEqual(data.map { String(format: "%02x", $0) }.joined(),
                       "0000803f000000400000404000008040")
        XCTAssertEqual(BinaryEncoding.decodeDepth(data), [1, 2, 3, 4])
    }

    func testGoldenConfidenceBytes() {
        let data = BinaryEncoding.encodeConfidence([0, 1, 2, 0])
        XCTAssertEqual(data.map { String(format: "%02x", $0) }.joined(), "00010200")
    }

    func testGoldenSha256() {
        // sha256("gauzensplat") — cross-checks CryptoKit vs Python hashlib.
        let h = Checksum.sha256Hex(Data("gauzensplat".utf8))
        XCTAssertEqual(h, "3f07e5a08fcf0d2922570c05aba5c6e553add9569394891afe575469eb293d88")
    }
}
