import Foundation
import ARKit
import Combine
import GauzensplatCaptureCore

/// Owns the ARSession, configures world tracking + raw sceneDepth, and reports
/// sensor health.  It forwards frames to a delegate but performs NO disk I/O
/// itself.  Fails gracefully when tracking / depth / permission are unavailable.
final class ARSessionController: NSObject, ObservableObject, ARSessionDelegate {

    struct Health {
        var worldTrackingSupported = false
        var sceneDepthSupported = false
        var cameraAuthorized = false
        var lidarActive = false
        var tracking: CaptureTrackingState = .notAvailable
        var lastError: String?
    }

    @Published private(set) var health = Health()
    @Published private(set) var isRunning = false

    let session = ARSession()
    private let captureQueue = DispatchQueue(label: "gauzensplat.capture", qos: .userInitiated)

    /// Called on the capture queue for every frame (throttling happens downstream).
    var onFrame: ((ARFrame) -> Void)?
    var onInterruption: ((String) -> Void)?

    override init() {
        super.init()
        session.delegate = self
        session.delegateQueue = captureQueue
        evaluateSupport()
    }

    private func evaluateSupport() {
        var h = Health()
        h.worldTrackingSupported = ARWorldTrackingConfiguration.isSupported
        h.sceneDepthSupported =
            ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
        h.cameraAuthorized = AVCaptureDevice.authorizationStatus(for: .video) == .authorized
        DispatchQueue.main.async { self.health = h }
    }

    func requestCameraAccess(_ completion: @escaping (Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .video) { granted in
            DispatchQueue.main.async {
                self.health.cameraAuthorized = granted
                completion(granted)
            }
        }
    }

    /// Start (or restart) the AR session with the best available depth semantics.
    /// Returns false if world tracking is unsupported or camera denied.
    @discardableResult
    func start() -> Bool {
        guard health.worldTrackingSupported else {
            setError("ARWorldTracking not supported on this device"); return false
        }
        guard health.cameraAuthorized else {
            setError("camera permission denied"); return false
        }
        let config = ARWorldTrackingConfiguration()
        config.worldAlignment = .gravity
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
            config.frameSemantics.insert(.sceneDepth)   // RAW depth (reconstruction dataset)
        }
        session.run(config, options: [.resetTracking, .removeExistingAnchors])
        DispatchQueue.main.async {
            self.isRunning = true
            self.health.lidarActive = self.health.sceneDepthSupported
            self.health.lastError = nil
        }
        return true
    }

    func stop() {
        session.pause()
        DispatchQueue.main.async {
            self.isRunning = false
            self.health.lidarActive = false
        }
    }

    private func setError(_ msg: String) {
        DispatchQueue.main.async { self.health.lastError = msg }
    }

    // MARK: ARSessionDelegate

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        let (state, _) = ARFrameExtractor.trackingState(frame.camera.trackingState)
        if state != health.tracking {
            DispatchQueue.main.async { self.health.tracking = state }
        }
        onFrame?(frame)   // already on captureQueue
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        setError(error.localizedDescription)
        onInterruption?("session failed: \(error.localizedDescription)")
    }

    func sessionWasInterrupted(_ session: ARSession) {
        onInterruption?("session interrupted (backgrounded / camera unavailable)")
        DispatchQueue.main.async { self.health.lidarActive = false }
    }

    func sessionInterruptionEnded(_ session: ARSession) {
        DispatchQueue.main.async { self.health.lidarActive = self.health.sceneDepthSupported }
    }
}
