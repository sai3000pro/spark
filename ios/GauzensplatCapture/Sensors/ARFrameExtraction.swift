import Foundation
import ARKit
import CoreVideo
import CoreImage
import simd
import GauzensplatCaptureCore

/// Extracts a recordable snapshot from an ARFrame on the capture queue.
///
/// IMPORTANT: this does the MINIMUM lightweight copy inside/near the ARSession
/// callback (pixel buffers, transform, intrinsics) and hands raw bytes to the
/// background writer.  It never blocks on disk I/O.  Raw values only — no axis
/// flips, no COLMAP conversion, no confidence filtering.
struct ExtractedFrame {
    let timestamp: TimeInterval
    let transform: simd_float4x4
    let intrinsics: simd_float3x3
    let imageWidth: Int
    let imageHeight: Int
    let trackingState: CaptureTrackingState
    let trackingReason: String?
    let rgbJPEG: Data
    // depth (may be nil if sceneDepth unavailable for this frame)
    let depthBytes: Data?
    let confidenceBytes: Data?
    let depthWidth: Int?
    let depthHeight: Int?
    // stats for the live UI
    let validDepthPercent: Double
    let confidenceHistogram: (low: Int, medium: Int, high: Int)
}

enum ARFrameExtractor {
    private static let ciContext = CIContext(options: [.useSoftwareRenderer: false])

    static func trackingState(_ s: ARCamera.TrackingState) -> (CaptureTrackingState, String?) {
        switch s {
        case .normal: return (.normal, nil)
        case .limited(let reason):
            let r: String
            switch reason {
            case .excessiveMotion: r = "excessiveMotion"
            case .insufficientFeatures: r = "insufficientFeatures"
            case .initializing: r = "initializing"
            case .relocalizing: r = "relocalizing"
            @unknown default: r = "unknown"
            }
            return (.limited, r)
        case .notAvailable: return (.notAvailable, nil)
        }
    }

    /// JPEG-encode the ARFrame captured image (native geometry, no rotation).
    static func encodeRGB(_ pixelBuffer: CVPixelBuffer, quality: CGFloat = 0.85) -> Data? {
        let ci = CIImage(cvPixelBuffer: pixelBuffer)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        return ciContext.jpegRepresentation(of: ci, colorSpace: colorSpace,
                                            options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: quality])
    }

    /// Read a Float32 depth map into row-major little-endian bytes + stats.
    static func encodeDepth(_ depthMap: CVPixelBuffer)
        -> (data: Data, width: Int, height: Int, validPct: Double)? {
        CVPixelBufferLockBaseAddress(depthMap, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(depthMap, .readOnly) }
        let w = CVPixelBufferGetWidth(depthMap)
        let h = CVPixelBufferGetHeight(depthMap)
        guard CVPixelBufferGetPixelFormatType(depthMap) == kCVPixelFormatType_DepthFloat32,
              let base = CVPixelBufferGetBaseAddress(depthMap) else { return nil }
        let rowBytes = CVPixelBufferGetBytesPerRow(depthMap)
        var floats = [Float](repeating: 0, count: w * h)
        var valid = 0
        for y in 0..<h {
            let row = base.advanced(by: y * rowBytes).assumingMemoryBound(to: Float.self)
            for x in 0..<w {
                let v = row[x]
                floats[y * w + x] = v
                if v.isFinite && v > 0 { valid += 1 }
            }
        }
        let data = BinaryEncoding.encodeDepth(floats)
        let pct = w * h > 0 ? 100.0 * Double(valid) / Double(w * h) : 0
        return (data, w, h, pct)
    }

    /// Read a UInt8 confidence map into bytes + histogram.
    static func encodeConfidence(_ confMap: CVPixelBuffer)
        -> (data: Data, hist: (low: Int, medium: Int, high: Int))? {
        CVPixelBufferLockBaseAddress(confMap, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(confMap, .readOnly) }
        let w = CVPixelBufferGetWidth(confMap)
        let h = CVPixelBufferGetHeight(confMap)
        guard let base = CVPixelBufferGetBaseAddress(confMap) else { return nil }
        let rowBytes = CVPixelBufferGetBytesPerRow(confMap)
        var bytes = [UInt8](repeating: 0, count: w * h)
        var lo = 0, mid = 0, hi = 0
        for y in 0..<h {
            let row = base.advanced(by: y * rowBytes).assumingMemoryBound(to: UInt8.self)
            for x in 0..<w {
                let c = row[x]
                bytes[y * w + x] = c
                switch c { case 0: lo += 1; case 1: mid += 1; default: hi += 1 }
            }
        }
        return (BinaryEncoding.encodeConfidence(bytes), (lo, mid, hi))
    }

    /// Full extraction.  `depth` uses RAW `sceneDepth` (never smoothed).
    static func extract(_ frame: ARFrame) -> ExtractedFrame? {
        guard let rgb = encodeRGB(frame.capturedImage) else { return nil }
        let (ts, reason) = trackingState(frame.camera.trackingState)
        let res = frame.camera.imageResolution

        var depthBytes: Data? = nil
        var confBytes: Data? = nil
        var dW: Int? = nil
        var dH: Int? = nil
        var validPct = 0.0
        var hist = (low: 0, medium: 0, high: 0)

        if let sd = frame.sceneDepth,  // RAW sceneDepth only
           let d = encodeDepth(sd.depthMap) {
            depthBytes = d.data; dW = d.width; dH = d.height; validPct = d.validPct
            if let cm = sd.confidenceMap, let c = encodeConfidence(cm) {
                confBytes = c.data; hist = c.hist
            }
        }

        return ExtractedFrame(
            timestamp: frame.timestamp,
            transform: frame.camera.transform,
            intrinsics: frame.camera.intrinsics,
            imageWidth: Int(res.width),
            imageHeight: Int(res.height),
            trackingState: ts,
            trackingReason: reason,
            rgbJPEG: rgb,
            depthBytes: depthBytes,
            confidenceBytes: confBytes,
            depthWidth: dW,
            depthHeight: dH,
            validDepthPercent: validPct,
            confidenceHistogram: hist
        )
    }
}
