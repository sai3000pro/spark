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
    }

    public init(sessionID: String, deviceModel: String?, appVersion: String?,
                sampleRateHz: Double?, createdAt: String? = nil) {
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
