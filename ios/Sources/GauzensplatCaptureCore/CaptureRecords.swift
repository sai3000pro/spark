import Foundation
import simd

/// One `metadata.jsonl` record.  Field names / semantics match
/// `tools/arkit_capture/formats.py:FrameMeta`.
public struct FrameMetadata: Codable, Equatable {
    public var formatVersion: Int
    public var frameID: Int
    public var timestamp: Double
    public var sessionTime: Double?
    public var rgbPath: String
    public var depthPath: String?
    public var confidencePath: String?
    public var imageWidth: Int
    public var imageHeight: Int
    public var depthWidth: Int?
    public var depthHeight: Int?
    public var depthFormat: String?
    public var depthUnits: String?
    public var confidenceFormat: String?
    public var depthStatus: String
    public var cameraTransform: [[Double]]
    public var cameraIntrinsics: [[Double]]
    public var trackingState: String
    public var trackingReason: String?
    /// Coverage-triggered keyframe tag (Phase 3). Omitted from JSON when nil so the
    /// wire format stays byte-compatible with pre-keyframe captures; the desktop
    /// LiveReconManager reads `meta.keyframe` to prioritise these frames.
    public var keyframe: Bool?
    public var trigger: String?   // e.g. "threshold_crossing", "novel_viewpoint"

    enum CodingKeys: String, CodingKey {
        case formatVersion = "format_version"
        case frameID = "frame_id"
        case timestamp
        case sessionTime = "session_time"
        case rgbPath = "rgb_path"
        case depthPath = "depth_path"
        case confidencePath = "confidence_path"
        case imageWidth = "image_width"
        case imageHeight = "image_height"
        case depthWidth = "depth_width"
        case depthHeight = "depth_height"
        case depthFormat = "depth_format"
        case depthUnits = "depth_units"
        case confidenceFormat = "confidence_format"
        case depthStatus = "depth_status"
        case cameraTransform = "camera_transform"
        case cameraIntrinsics = "camera_intrinsics"
        case trackingState = "tracking_state"
        case trackingReason = "tracking_reason"
        case keyframe
        case trigger
    }

    public init(frameID: Int,
                timestamp: Double,
                sessionTime: Double?,
                transform: simd_float4x4,
                intrinsics: simd_float3x3,
                imageWidth: Int, imageHeight: Int,
                trackingState: CaptureTrackingState,
                trackingReason: String? = nil,
                depth: DepthDescriptor? = nil) {
        self.formatVersion = CaptureFormat.captureFormatVersion
        self.frameID = frameID
        self.timestamp = timestamp
        self.sessionTime = sessionTime
        self.rgbPath = FileNaming.rgbRelPath(frameID)
        self.imageWidth = imageWidth
        self.imageHeight = imageHeight
        self.cameraTransform = MatrixSerialization.rows(from: transform)
        self.cameraIntrinsics = MatrixSerialization.rows(from: intrinsics)
        self.trackingState = trackingState.rawValue
        self.trackingReason = trackingReason
        if let d = depth {
            self.depthPath = FileNaming.depthRelPath(frameID)
            self.confidencePath = FileNaming.confidenceRelPath(frameID)
            self.depthWidth = d.width
            self.depthHeight = d.height
            self.depthFormat = CaptureFormat.depthFormat
            self.depthUnits = CaptureFormat.depthUnits
            self.confidenceFormat = CaptureFormat.confidenceFormat
            self.depthStatus = "available"
        } else {
            self.depthStatus = "unavailable"
        }
    }

    public struct DepthDescriptor {
        public let width: Int
        public let height: Int
        public init(width: Int, height: Int) { self.width = width; self.height = height }
    }

    /// A single compact JSON line (no newline).  Deterministic keys via Codable.
    public func jsonLine() throws -> String {
        let enc = JSONEncoder()
        enc.outputFormatting = [.withoutEscapingSlashes]
        let data = try enc.encode(self)
        return String(decoding: data, as: UTF8.self)
    }
}

/// `session.json` contents.
public struct SessionInfo: Codable {
    public var formatVersion: Int
    public var sessionID: String
    public var createdAt: String?
    public var deviceModel: String?
    public var appVersion: String?
    public var cameraTransformSource: String
    public var cameraTransformStorage: String
    public var cameraTransformModified: Bool
    public var intrinsicsStorage: String
    public var sampleRateHz: Double?
    // Optional capture-location tags (Phase: GPS). Codable skips nil values, so
    // session.json stays byte-identical for captures recorded without a location
    // fix (denied/unavailable/timeout). The laptop reads these to stamp meta.place.
    public var latitude: Double?
    public var longitude: Double?
    public var placeName: String?

    enum CodingKeys: String, CodingKey {
        case formatVersion = "format_version"
        case sessionID = "session_id"
        case createdAt = "created_at"
        case deviceModel = "device_model"
        case appVersion = "app_version"
        case cameraTransformSource = "camera_transform_source"
        case cameraTransformStorage = "camera_transform_storage"
        case cameraTransformModified = "camera_transform_modified"
        case intrinsicsStorage = "intrinsics_storage"
        case sampleRateHz = "sample_rate_hz"
        case latitude
        case longitude
        case placeName = "place_name"
    }

    public init(sessionID: String, deviceModel: String?, appVersion: String?,
                sampleRateHz: Double?, createdAt: String? = nil,
                latitude: Double? = nil, longitude: Double? = nil,
                placeName: String? = nil) {
        self.formatVersion = CaptureFormat.captureFormatVersion
        self.sessionID = sessionID
        self.createdAt = createdAt
        self.deviceModel = deviceModel
        self.appVersion = appVersion
        self.cameraTransformSource = "ARCamera.transform"
        self.cameraTransformStorage = "row-major nested arrays"
        self.cameraTransformModified = false
        self.intrinsicsStorage = "row-major nested arrays"
        self.sampleRateHz = sampleRateHz
        self.latitude = latitude
        self.longitude = longitude
        self.placeName = placeName
    }
}

/// Final session summary (written to diagnostics/summary.json at finalize).
public struct SessionSummary: Codable {
    public var sessionID: String
    public var durationS: Double
    public var framesConsidered: Int
    public var framesSaved: Int
    public var framesDropped: Int
    public var framesWithoutDepth: Int
    public var trackingNormal: Int
    public var trackingLimited: Int
    public var trackingNotAvailable: Int
    public var storageBytes: Int
    public var interruptionCount: Int
    public var recordingStatus: String

    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
        case durationS = "duration_s"
        case framesConsidered = "frames_considered"
        case framesSaved = "frames_saved"
        case framesDropped = "frames_dropped"
        case framesWithoutDepth = "frames_without_depth"
        case trackingNormal = "tracking_normal"
        case trackingLimited = "tracking_limited"
        case trackingNotAvailable = "tracking_not_available"
        case storageBytes = "storage_bytes"
        case interruptionCount = "interruption_count"
        case recordingStatus = "recording_status"
    }

    public init(sessionID: String) {
        self.sessionID = sessionID
        durationS = 0; framesConsidered = 0; framesSaved = 0; framesDropped = 0
        framesWithoutDepth = 0; trackingNormal = 0; trackingLimited = 0
        trackingNotAvailable = 0; storageBytes = 0; interruptionCount = 0
        recordingStatus = "unknown"
    }
}



/// Pure, ARKit-free coverage accumulator + keyframe selector (Phase 3).
///
/// Separated from the app's `CoverageMap` so the keyframe *logic* is unit-testable
/// on macOS with no simulator. Two independent keyframe triggers:
///   1. **threshold_crossing** — a voxel's azimuth-bucket bitmask first reaches
///      `enoughAngles` distinct viewing angles (fires ONCE per voxel, on the edge).
///   2. **novel_viewpoint** — the camera pose is sufficiently far (translation or
///      rotation) from the last accepted keyframe, so orbiting a filled region still
///      yields fresh views, while a stationary camera does not flood keyframes.
///
/// Thread-safety is the caller's responsibility (the app wraps it in its NSLock).
public final class KeyframeCoverage {
    public let azBuckets: Int
    public let cellSize: Float
    public let enoughAngles: Int
    public let minTranslation: Float   // metres
    public let minRotation: Float      // radians

    private var cells: [Int64: UInt16] = [:]     // voxel key -> azimuth-bucket bitmask
    private var crossed: Set<Int64> = []         // voxels that already fired a crossing
    private var lastKeyframePose: simd_float4x4?

    public init(azBuckets: Int = 12, cellSize: Float = 0.12, enoughAngles: Int = 5,
                minTranslation: Float = 0.15, minRotation: Float = 0.26 /* ~15° */) {
        self.azBuckets = azBuckets
        self.cellSize = cellSize
        self.enoughAngles = enoughAngles
        self.minTranslation = minTranslation
        self.minRotation = minRotation
    }

    public func reset() {
        cells.removeAll(); crossed.removeAll(); lastKeyframePose = nil
    }

    public var voxelCount: Int { cells.count }
    public var greenCount: Int { cells.values.reduce(0) { $0 + (($1.nonzeroBitCount >= enoughAngles) ? 1 : 0) } }
    public var fraction: Double { cells.isEmpty ? 0 : Double(greenCount) / Double(cells.count) }

    public func key(_ x: Float, _ y: Float, _ z: Float) -> Int64 {
        let qx = Int64((x / cellSize).rounded()) + 0x100000
        let qy = Int64((y / cellSize).rounded()) + 0x100000
        let qz = Int64((z / cellSize).rounded()) + 0x100000
        return ((qx & 0x1FFFFF) << 42) | ((qy & 0x1FFFFF) << 21) | (qz & 0x1FFFFF)
    }

    public func level(_ x: Float, _ y: Float, _ z: Float) -> Float {
        let mask = cells[key(x, y, z)] ?? 0
        return min(1, Float(mask.nonzeroBitCount) / Float(enoughAngles))
    }

    /// Observe one voxel from a given azimuth bucket. Returns true iff this observation
    /// pushed the voxel across `enoughAngles` for the FIRST time (edge, once per voxel).
    @discardableResult
    public func observe(x: Float, y: Float, z: Float, bucket: Int) -> Bool {
        let k = key(x, y, z)
        let b = max(0, min(azBuckets - 1, bucket))
        let before = cells[k] ?? 0
        let after = before | (UInt16(1) << b)
        cells[k] = after
        if after != before,
           before.nonzeroBitCount < enoughAngles,
           after.nonzeroBitCount >= enoughAngles,
           !crossed.contains(k) {
            crossed.insert(k)
            return true
        }
        return false
    }

    /// Should `pose` be accepted as a novel-viewpoint keyframe? True on the first call,
    /// or when translation/rotation vs the last accepted keyframe exceeds the minimums.
    /// When true, records `pose` as the new reference.
    public func acceptPoseNovelty(_ pose: simd_float4x4) -> Bool {
        guard let last = lastKeyframePose else {
            lastKeyframePose = pose; return true
        }
        let dt = simd_distance(SIMD3<Float>(pose.columns.3.x, pose.columns.3.y, pose.columns.3.z),
                               SIMD3<Float>(last.columns.3.x, last.columns.3.y, last.columns.3.z))
        let dr = Self.rotationAngle(between: last, and: pose)
        if dt >= minTranslation || dr >= minRotation {
            lastKeyframePose = pose; return true
        }
        return false
    }

    /// Geodesic angle (radians) between the rotation parts of two rigid transforms.
    public static func rotationAngle(between a: simd_float4x4, and b: simd_float4x4) -> Float {
        let qa = simd_quatf(rotationMatrix3(a)), qb = simd_quatf(rotationMatrix3(b))
        let dot = abs(simd_dot(qa.vector, qb.vector))
        return 2 * acos(min(1, dot))
    }

    private static func rotationMatrix3(_ m: simd_float4x4) -> simd_float3x3 {
        simd_float3x3(columns: (SIMD3<Float>(m.columns.0.x, m.columns.0.y, m.columns.0.z),
                                SIMD3<Float>(m.columns.1.x, m.columns.1.y, m.columns.1.z),
                                SIMD3<Float>(m.columns.2.x, m.columns.2.y, m.columns.2.z)))
    }
}
