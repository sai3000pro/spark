import XCTest
import simd
@testable import GauzensplatCaptureCore

final class MatrixSerializationTests: XCTestCase {

    private func assertRoundTrip4(_ m: simd_float4x4, accuracy: Float = 1e-5) {
        let rows = MatrixSerialization.rows(from: m)
        // JSON round-trip to mimic on-wire storage.
        let data = try! JSONSerialization.data(withJSONObject: rows)
        let parsed = try! JSONSerialization.jsonObject(with: data) as! [[Double]]
        let back = MatrixSerialization.matrix4(from: parsed)!
        for c in 0..<4 { for r in 0..<4 {
            XCTAssertEqual(m[c][r], back[c][r], accuracy: accuracy)
        }}
    }

    func testIdentity() { assertRoundTrip4(matrix_identity_float4x4) }

    func testTranslation() {
        var m = matrix_identity_float4x4
        m.columns.3 = SIMD4<Float>(1.5, -2.0, 3.25, 1)
        assertRoundTrip4(m)
        // translation column exposed correctly
        XCTAssertEqual(m.translation, SIMD3<Float>(1.5, -2.0, 3.25))
    }

    func testRotation() {
        let th: Float = 0.7
        let m = simd_float4x4(simd_quatf(angle: th, axis: SIMD3<Float>(0, 1, 0)))
        assertRoundTrip4(m)
    }

    func testRandomRigid() {
        for i in 0..<20 {
            let angle = Float(i) * 0.31
            let axis = simd_normalize(SIMD3<Float>(Float(i % 3 + 1), Float((i + 1) % 3 + 1), 1))
            var m = simd_float4x4(simd_quatf(angle: angle, axis: axis))
            m.columns.3 = SIMD4<Float>(Float(i), Float(-i) * 0.5, Float(i) * 0.25, 1)
            assertRoundTrip4(m)
        }
    }

    func testRowMajorOrdering() {
        var m = matrix_identity_float4x4
        m.columns.3 = SIMD4<Float>(7, 0, 0, 1)   // x-translation
        let rows = MatrixSerialization.rows(from: m)
        XCTAssertEqual(rows[0][3], 7.0)          // row0,col3 == tx
        XCTAssertEqual(rows[3][0], 0.0)
    }

    func testIntrinsics3x3RoundTrip() {
        let K = simd_float3x3(columns: (SIMD3<Float>(1000, 0, 0),
                                        SIMD3<Float>(0, 1000, 0),
                                        SIMD3<Float>(960, 720, 1)))
        let rows = MatrixSerialization.rows(from: K)
        let back = MatrixSerialization.matrix3(from: rows)!
        for c in 0..<3 { for r in 0..<3 {
            XCTAssertEqual(K[c][r], back[c][r], accuracy: 1e-5)
        }}
        // fx at [0][0], cx at [0][2]
        XCTAssertEqual(rows[0][0], 1000)
        XCTAssertEqual(rows[0][2], 960)
        XCTAssertEqual(rows[1][2], 720)
    }
}
