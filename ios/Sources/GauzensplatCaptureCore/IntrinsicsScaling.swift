import Foundation
import simd

/// Scale RGB-resolution intrinsics to depth resolution for unprojection.
/// Mirrors `tools/arkit_capture/intrinsics.py`.
public enum IntrinsicsScaling {

    public struct Params {
        public let fx: Double, fy: Double, cx: Double, cy: Double
        public init(fx: Double, fy: Double, cx: Double, cy: Double) {
            self.fx = fx; self.fy = fy; self.cx = cx; self.cy = cy
        }
    }

    public static func params(_ K: simd_float3x3) -> Params {
        Params(fx: Double(K[0][0]), fy: Double(K[1][1]),
               cx: Double(K[2][0]), cy: Double(K[2][1]))
    }

    /// Scale intrinsics from `src` (w,h) to `dst` (w,h).  Returns nil on
    /// non-positive dimensions.
    public static func scale(_ K: simd_float3x3,
                             src: (w: Int, h: Int),
                             dst: (w: Int, h: Int)) -> simd_float3x3? {
        guard src.w > 0, src.h > 0, dst.w > 0, dst.h > 0 else { return nil }
        let sx = Float(dst.w) / Float(src.w)
        let sy = Float(dst.h) / Float(src.h)
        var out = K
        out[0][0] *= sx   // fx
        out[2][0] *= sx   // cx
        out[1][1] *= sy   // fy
        out[2][1] *= sy   // cy
        return out
    }
}
