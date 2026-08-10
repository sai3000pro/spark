import Foundation
import ARKit
import AVFoundation
import Combine
import GauzensplatCaptureCore

/// Owns AR session configuration + sensor health, and pumps frames to `onFrame`.
///
/// The camera + LiDAR mesh are rendered by an `ARSCNView` (see `ARCoverageView`),
/// which must be the session's delegate to draw the camera background. So this
/// controller no longer acts as the session delegate; instead it adopts the view's
/// session and polls `currentFrame` on the capture queue at a fixed rate. The
/// `onFrame` contract (called on the capture queue; throttling happens downstream)
/// is unchanged, so the recording pipeline is unaffected.
final class ARSessionController: NSObject, ObservableObject {

    struct Health {
        var worldTrackingSupported = false
        var sceneDepthSupported = false
        var cameraAuthorized = false
        var cameraStatusText = "NOT REQUESTED"
        var lidarActive = false
        var tracking: CaptureTrackingState = .notAvailable
        var lastError: String?
    }

    static func cameraStatusText(_ s: AVAuthorizationStatus) -> String {
        switch s {
        case .authorized:    return "AUTHORIZED"
        case .denied:        return "DENIED — enable in Settings"
        case .restricted:    return "RESTRICTED"
        case .notDetermined: return "NOT REQUESTED"
        @unknown default:    return "UNKNOWN"
        }
    }

    @Published private(set) var health = Health()
    @Published private(set) var isRunning = false

    /// The session actually rendered on screen. Replaced by `adopt(_:)` with the
    /// ARSCNView's own session (an injected session renders a blank camera).
    private(set) var session = ARSession()
    private let captureQueue = DispatchQueue(label: "gauzensplat.capture", qos: .userInitiated)
    private var pump: DispatchSourceTimer?
    private var lastPumpTimestamp: TimeInterval = 0

    /// Called on the capture queue for every polled frame (throttling happens downstream).
    var onFrame: ((ARFrame) -> Void)?
    var onInterruption: ((String) -> Void)?

    override init() {
        super.init()
        evaluateSupport()
    }

    /// Adopt the ARSCNView's session so the view renders the camera + mesh while we
    /// still drive/read it. Safe to call before `start()`.
    func adopt(_ newSession: ARSession) {
        guard session !== newSession else { return }
        session = newSession
    }

    func refreshSupport() { evaluateSupport() }

    private func evaluateSupport() {
        let world = ARWorldTrackingConfiguration.isSupported
        let depth = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        DispatchQueue.main.async {
            self.health.worldTrackingSupported = world
            self.health.sceneDepthSupported = depth
            self.health.cameraAuthorized = (status == .authorized)
            self.health.cameraStatusText = Self.cameraStatusText(status)
        }
    }

    func requestCameraAccess(_ completion: @escaping (Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .video) { granted in
            let status = AVCaptureDevice.authorizationStatus(for: .video)
            DispatchQueue.main.async {
                self.health.cameraAuthorized = granted
                self.health.cameraStatusText = Self.cameraStatusText(status)
                completion(granted)
            }
        }
    }

    /// Start (or restart) the AR session with raw depth + LiDAR mesh, and begin the
    /// frame pump. Returns false if world tracking is unsupported or camera denied.
    @discardableResult
    func start() -> Bool {
        guard ARWorldTrackingConfiguration.isSupported else {
            setError("AR world tracking is not supported on this device."); return false
        }
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
            setError("Camera access is off. Enable it in Settings › Gauzensplat Capture › Camera, then tap START again.")
            return false
        }
        let config = ARWorldTrackingConfiguration()
        config.worldAlignment = .gravity
        let depthOK = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
        if depthOK {
            config.frameSemantics.insert(.sceneDepth)   // RAW depth (reconstruction dataset)
        }
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
            config.sceneReconstruction = .mesh          // LiDAR mesh for the coverage overlay
        }
        session.run(config, options: [.resetTracking, .removeExistingAnchors])
        startPump()
        DispatchQueue.main.async {
            self.isRunning = true
            self.health.lidarActive = depthOK
            self.health.lastError = nil
        }
        return true
    }

    func stop() {
        pump?.cancel(); pump = nil
        session.pause()
        DispatchQueue.main.async {
            self.isRunning = false
            self.health.lidarActive = false
        }
    }

    // Polls the latest frame at 30 Hz on the capture queue. The downstream sampler
    // dedups by timestamp, so polling (vs delegate push) is equivalent after throttling.
    private func startPump() {
        pump?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: captureQueue)
        timer.schedule(deadline: .now() + 0.05, repeating: 1.0 / 30.0, leeway: .milliseconds(3))
        timer.setEventHandler { [weak self] in
            guard let self, let frame = self.session.currentFrame else { return }
            guard frame.timestamp != self.lastPumpTimestamp else { return }   // same frame → skip
            self.lastPumpTimestamp = frame.timestamp
            let (state, _) = ARFrameExtractor.trackingState(frame.camera.trackingState)
            if state != self.health.tracking {
                DispatchQueue.main.async { self.health.tracking = state }
            }
            self.onFrame?(frame)
        }
        timer.resume()
        pump = timer
    }

    private func setError(_ msg: String) {
        DispatchQueue.main.async { self.health.lastError = msg }
    }

    // MARK: forwarded from the ARSCNView's session observer (it is the delegate)

    func reportFailure(_ error: Error) {
        setError(error.localizedDescription)
        onInterruption?("session failed: \(error.localizedDescription)")
    }

    func reportInterrupted() {
        onInterruption?("session interrupted (backgrounded / camera unavailable)")
        DispatchQueue.main.async { self.health.lidarActive = false }
    }

    func reportInterruptionEnded() {
        DispatchQueue.main.async { self.health.lidarActive = self.health.sceneDepthSupported }
    }
}
