import Foundation

/// Depth / confidence binary encoding.  Matches the Python codecs byte-for-byte
/// (little-endian float32 depth, uint8 confidence, row-major).
public enum BinaryEncoding {

    /// Encode row-major `[Float]` (length w*h) as little-endian float32 bytes.
    public static func encodeDepth(_ values: [Float]) -> Data {
        var out = Data(capacity: values.count * 4)
        for v in values {
            var le = v.bitPattern.littleEndian
            withUnsafeBytes(of: &le) { out.append(contentsOf: $0) }
        }
        return out
    }

    /// Decode little-endian float32 bytes into `[Float]` (test/round-trip use).
    public static func decodeDepth(_ data: Data) -> [Float] {
        var out = [Float]()
        out.reserveCapacity(data.count / 4)
        var i = data.startIndex
        while i + 4 <= data.endIndex {
            let bits = UInt32(data[i]) | (UInt32(data[i+1]) << 8)
                     | (UInt32(data[i+2]) << 16) | (UInt32(data[i+3]) << 24)
            out.append(Float(bitPattern: UInt32(littleEndian: bits)))
            i += 4
        }
        return out
    }

    public static func encodeConfidence(_ values: [UInt8]) -> Data {
        Data(values)
    }
}
