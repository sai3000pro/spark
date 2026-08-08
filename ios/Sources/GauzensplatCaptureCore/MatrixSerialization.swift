import Foundation
import simd

/// Matrix <-> row-major nested arrays.
///
/// CRITICAL: Swift `simd` matrices are COLUMN-major (`m.columns.0` is the first
/// column, `m[col][row]` indexing).  The capture contract stores matrices as
/// ROW-major nested arrays, so a single coordinate-system bug can't creep in.
///
///     rows[r][c] == m[c][r]
///
/// Verified byte-for-byte against `tools/arkit_capture/formats.py` and the
/// cross-language golden test.
public enum MatrixSerialization {

    // MARK: 4x4

    /// Row-major `[[Double]]` (4x4) from a column-major `simd_float4x4`.
    public static func rows(from m: simd_float4x4) -> [[Double]] {
        var out = [[Double]](repeating: [Double](repeating: 0, count: 4), count: 4)
        for r in 0..<4 {
            for c in 0..<4 {
                out[r][c] = Double(m[c][r])   // column-major storage -> row-major output
            }
        }
        return out
    }

    /// Reconstruct a `simd_float4x4` from row-major nested arrays.
    public static func matrix4(from rows: [[Double]]) -> simd_float4x4? {
        guard rows.count == 4, rows.allSatisfy({ $0.count == 4 }) else { return nil }
        var cols = [SIMD4<Float>](repeating: .zero, count: 4)
        for c in 0..<4 {
            cols[c] = SIMD4<Float>(Float(rows[0][c]), Float(rows[1][c]),
                                   Float(rows[2][c]), Float(rows[3][c]))
        }
        return simd_float4x4(columns: (cols[0], cols[1], cols[2], cols[3]))
    }

    // MARK: 3x3

    public static func rows(from m: simd_float3x3) -> [[Double]] {
        var out = [[Double]](repeating: [Double](repeating: 0, count: 3), count: 3)
        for r in 0..<3 {
            for c in 0..<3 {
                out[r][c] = Double(m[c][r])
            }
        }
        return out
    }

    public static func matrix3(from rows: [[Double]]) -> simd_float3x3? {
        guard rows.count == 3, rows.allSatisfy({ $0.count == 3 }) else { return nil }
        var cols = [SIMD3<Float>](repeating: .zero, count: 3)
        for c in 0..<3 {
            cols[c] = SIMD3<Float>(Float(rows[0][c]), Float(rows[1][c]), Float(rows[2][c]))
        }
        return simd_float3x3(columns: (cols[0], cols[1], cols[2]))
    }
}

public extension simd_float4x4 {
    /// Translation column (camera world position for a camera-to-world transform).
    var translation: SIMD3<Float> {
        SIMD3<Float>(columns.3.x, columns.3.y, columns.3.z)
    }
}
