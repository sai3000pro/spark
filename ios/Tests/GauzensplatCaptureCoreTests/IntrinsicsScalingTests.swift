import XCTest
import simd
@testable import GauzensplatCaptureCore

final class IntrinsicsScalingTests: XCTestCase {
    private func K(_ fx: Float, _ fy: Float, _ cx: Float, _ cy: Float) -> simd_float3x3 {
        simd_float3x3(columns: (SIMD3<Float>(fx, 0, 0),
                                SIMD3<Float>(0, fy, 0),
                                SIMD3<Float>(cx, cy, 1)))
    }

    func testSameResolution() {
        let k = K(1000, 1000, 960, 720)
        let out = IntrinsicsScaling.scale(k, src: (1920, 1440), dst: (1920, 1440))!
        let p = IntrinsicsScaling.params(out)
        XCTAssertEqual(p.fx, 1000, accuracy: 1e-4)
        XCTAssertEqual(p.cx, 960, accuracy: 1e-4)
    }

    func testUniformScale() {
        let k = K(1000, 1000, 960, 720)
        let out = IntrinsicsScaling.scale(k, src: (1920, 1440), dst: (960, 720))!
        let p = IntrinsicsScaling.params(out)
        XCTAssertEqual(p.fx, 500, accuracy: 1e-3)
        XCTAssertEqual(p.fy, 500, accuracy: 1e-3)
        XCTAssertEqual(p.cx, 480, accuracy: 1e-3)
        XCTAssertEqual(p.cy, 360, accuracy: 1e-3)
    }

    func testNonUniformScale() {
        let k = K(1000, 1200, 960, 720)
        let out = IntrinsicsScaling.scale(k, src: (1920, 1440), dst: (256, 192))!
        let p = IntrinsicsScaling.params(out)
        XCTAssertEqual(p.fx, Double(1000.0 * 256.0 / 1920.0), accuracy: 1e-2)
        XCTAssertEqual(p.fy, Double(1200.0 * 192.0 / 1440.0), accuracy: 1e-2)
        XCTAssertEqual(p.cx, Double(960.0 * 256.0 / 1920.0), accuracy: 1e-2)
        XCTAssertEqual(p.cy, Double(720.0 * 192.0 / 1440.0), accuracy: 1e-2)
    }

    func testInvalidDimensions() {
        let k = K(1000, 1000, 960, 720)
        XCTAssertNil(IntrinsicsScaling.scale(k, src: (0, 1440), dst: (256, 192)))
        XCTAssertNil(IntrinsicsScaling.scale(k, src: (1920, 1440), dst: (256, 0)))
    }
}
