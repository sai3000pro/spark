import Foundation
import CryptoKit

/// SHA-256 hex, matching `formats.sha256_hex` in Python.  Used for bulk-payload
/// integrity across the Wi-Fi transport.
public enum Checksum {
    public static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
