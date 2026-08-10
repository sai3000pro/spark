import Foundation
import ARKit
import Combine
import GauzensplatCaptureCore

/// Orchestrates a recording: sampling -> LOCAL durable write -> network enqueue.
///
///     ARSession frame (capture queue)
///         -> FrameSampler eligibility (cheap)
///         -> extract lightweight snapshot
///         -> bounded queue (drops on backpressure)
///         -> background serial writer -> disk (SOURCE OF TRUTH)
///         -> transport.enqueue(reference-to-disk)  [never blocks capture]
///
/// The network is strictly additive; recording never depends on it.
final class CaptureCoordinator: ObservableObject {

    struct Stats {
        var state: CaptureState = .idle
        var framesConsidered = 0
        var framesSaved = 0
        var framesDropped = 0
        var writerQueueDepth = 0
        var writerQueueCapacity = 0
        var storageFreeBytes: Int64 = 0
        var durationSeconds: TimeInterval = 0
        var lastValidDepthPct = 0.0
        var confidence = (low: 0, medium: 0, high: 0)
        var trackingNormal = 0, trackingLimited = 0, trackingNotAvailable = 0
        var interruptions = 0
    }

    @Published private(set) var stats = Stats()

    /// Called on the main thread when recording stops for a reason OTHER than the
    /// user tapping STOP (low storage, interruption, session failure). Lets the
    /// UI explain why a capture ended on its own instead of failing silently.
    var onAutoStop: ((String) -> Void)?

    /// Called on the main thread the FIRST time a frame fails to write to disk.
    /// Write failures are otherwise skipped silently, which looks like recording
    /// mysteriously stalling (e.g. disk full → every write after the first throws).
    var onWriteError: ((String) -> Void)?
    private var reportedWriteError = false

    private var machine = CaptureStateMachine()
    /// Synchronous current state (the state machine is mutated only on the main
    /// thread). Gate start/resume on THIS, not the async-published `stats.state`,
    /// so a fast second tap can't slip past the guard while stats still reads .idle
    /// and call start() on an already-recording machine (CaptureStateError).
    var currentState: CaptureState { machine.state }
    private let sampler: FrameSampler
    private let baseDir: URL
    private let transport: CaptureTransport
    private let deviceModel: String
    private let appVersion: String

    // Optional capture-location tags stamped into session.json at start(). Set via
    // `setLocation` from the VM's one-shot GPS fetch; all nil = record with no coords.
    // Additive & fail-open: nothing in the frame/write path depends on these.
    private var latitude: Double?
    private var longitude: Double?
    private var placeName: String?

    private struct QueuedFrame { let frameID: Int; let frame: ExtractedFrame
                                 var keyframe: Bool = false; var trigger: String? = nil }
    private let queue: BoundedFrameQueue<QueuedFrame>
    private var writerThread: Thread?
    private var store: CaptureFileStore?
    private var audio: AudioCapture?            // isolated mic capture; nil when off/denied
    private var startTime: TimeInterval = 0
    private var frameID = 0
    private var summary = SessionSummary(sessionID: "")
    private let minFreeBytes: Int64 = 300 * 1024 * 1024   // stop if < 300 MB free

    // Thread-safe recording gate: written on main (start/stop), read on the AR
    // capture queue (ingest). Avoids racing the `machine` struct across threads.
    private let gateLock = NSLock()
    private var _accepting = false
    private var accepting: Bool {
        gateLock.lock(); defer { gateLock.unlock() }; return _accepting
    }
    private func setAccepting(_ v: Bool) {
        gateLock.lock(); _accepting = v; gateLock.unlock()
    }
    private var considered = 0   // capture-queue only
    private var stopReason = "completed"

    init(sampler: FrameSampler = FixedRateSampler(rateHz: 5),
         transport: CaptureTransport = OfflineTransport(),
         baseDirectory: URL? = nil,
         writerCapacity: Int = 24,
         deviceModel: String = UIDevice.current.model,
         appVersion: String = "1.0") {
        self.sampler = sampler
        self.transport = transport
        self.queue = BoundedFrameQueue(capacity: writerCapacity)
        self.deviceModel = deviceModel
        self.appVersion = appVersion
        self.baseDir = baseDirectory ?? FileManager.default
            .urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("captures", isDirectory: true)
        try? FileManager.default.createDirectory(at: baseDir, withIntermediateDirectories: true)
    }

    var sampleRateHz: Double { (sampler as? FixedRateSampler)?.rateHz ?? 0 }

    /// Provide optional capture-location tags to be written into session.json at
    /// the next `start()`. Called from the VM once its one-shot GPS fetch resolves;
    /// safe to call with nils (leaves session.json location-free). Applies only to
    /// `start()` — `resume()` deliberately does NOT rewrite session.json.
    func setLocation(latitude: Double?, longitude: Double?, placeName: String?) {
        self.latitude = latitude
        self.longitude = longitude
        self.placeName = placeName
    }

    // MARK: control

    func start() throws {
        try machine.apply(.start)
        publishState()
        let dirName = FileNaming.sessionDirName()
        do {
            let store = try CaptureFileStore(baseDirectory: baseDir, sessionDirName: dirName)
            try store.writeSessionInfo(SessionInfo(sessionID: dirName, deviceModel: deviceModel,
                                                   appVersion: appVersion, sampleRateHz: sampleRateHz,
                                                   createdAt: ISO8601DateFormatter().string(from: Date()),
                                                   latitude: latitude, longitude: longitude,
                                                   placeName: placeName))
            self.store = store
        } catch {
            try? machine.apply(.preparationFailed); publishState()
            throw error
        }
        sampler.reset()
        frameID = 0
        considered = 0
        summary = SessionSummary(sessionID: dirName)
        startTime = ProcessInfo.processInfo.systemUptime
        startWriter()
        if let root = self.store?.root { startAudio(sessionRoot: root) }  // best-effort; never blocks recording
        try machine.apply(.preparationSucceeded)
        setAccepting(true)
        publishState()
    }

    /// Continue an EXISTING on-disk session instead of starting a fresh one:
    /// reopen its store in append mode and resume frame numbering at the last
    /// saved frame + 1, so the recording extends the same capture (same session
    /// dir, same frames) rather than creating a new run. Otherwise identical to
    /// `start()` — writer thread, audio, gate, and state transitions all match —
    /// and it deliberately does NOT rewrite `session.json`, preserving the
    /// original createdAt / sample rate.
    func resume(sessionDirName: String) throws {
        try machine.apply(.start)
        publishState()
        let next = CaptureFileStore.maxFrameID(baseDirectory: baseDir,
                                               sessionDirName: sessionDirName) + 1
        let resumedStore: CaptureFileStore
        do {
            resumedStore = try CaptureFileStore(resuming: baseDir, sessionDirName: sessionDirName)
            self.store = resumedStore
        } catch {
            try? machine.apply(.preparationFailed); publishState()
            throw error
        }
        sampler.reset()
        frameID = next
        considered = 0
        summary = SessionSummary(sessionID: sessionDirName)
        startTime = ProcessInfo.processInfo.systemUptime
        startWriter()
        startAudio(sessionRoot: resumedStore.root)   // best-effort; never blocks recording
        try machine.apply(.preparationSucceeded)
        setAccepting(true)
        publishState()
    }

    /// Called on the AR capture queue for each frame. Does the MINIMUM work and
    /// only touches the main thread at the (throttled) sample rate — never on
    /// every ~60 Hz ARFrame.
    func ingest(_ frame: ARFrame, keyframe: Bool = false, trigger: String? = nil) {
        guard accepting else { return }
        considered += 1
        guard sampler.shouldSample(timestamp: frame.timestamp) else { return }

        // Disk guard (cheap check; stop safely if dangerously low).
        if freeBytes() < minFreeBytes {
            setAccepting(false)
            DispatchQueue.main.async { self.stopSafely(reason: "low_storage") }
            return
        }
        guard let extracted = ARFrameExtractor.extract(frame) else { return }
        let fid = frameID; frameID += 1
        let accepted = queue.enqueue(QueuedFrame(frameID: fid, frame: extracted,
                                                 keyframe: keyframe, trigger: trigger))
        let qDepth = queue.count
        let dropped = queue.droppedCount
        let dur = ProcessInfo.processInfo.systemUptime - startTime
        let consideredNow = considered
        DispatchQueue.main.async {
            self.stats.framesConsidered = consideredNow
            self.stats.durationSeconds = dur
            self.stats.writerQueueDepth = qDepth
            if !accepted { self.stats.framesDropped = dropped }
        }
    }

    func stop() { stopSafely(reason: "completed") }

    func handleInterruption() {
        DispatchQueue.main.async { self.stats.interruptions += 1 }
        if machine.isRecording { stopSafely(reason: "interrupted") }
    }

    // MARK: writer

    private func startWriter() {
        let t = Thread { [weak self] in self?.writerLoop() }
        t.name = "gauzensplat.writer"
        t.qualityOfService = .utility
        t.start()
        writerThread = t
    }

    private func writerLoop() {
        var saved = 0, withoutDepth = 0, tn = 0, tl = 0, tna = 0
        while let job = queue.dequeue() {
            guard let store = store else { break }
            let fid = job.frameID
            let extracted = job.frame
            let hasDepth = extracted.depthBytes != nil
            var meta = FrameMetadata(
                frameID: fid,
                timestamp: extracted.timestamp,
                sessionTime: extracted.timestamp - startTime,
                transform: extracted.transform,
                intrinsics: extracted.intrinsics,
                imageWidth: extracted.imageWidth,
                imageHeight: extracted.imageHeight,
                trackingState: extracted.trackingState,
                trackingReason: extracted.trackingReason,
                depth: hasDepth ? .init(width: extracted.depthWidth ?? 0,
                                        height: extracted.depthHeight ?? 0) : nil)
            if job.keyframe { meta.keyframe = true; meta.trigger = job.trigger }
            do {
                let urls = try store.writeFrame(meta, rgbJPEG: extracted.rgbJPEG,
                                                depth: extracted.depthBytes,
                                                confidence: extracted.confidenceBytes)
                enqueueMirror(fid: fid, meta: meta, urls: urls)
            } catch {
                // Non-fatal: skip this frame, keep recording — but surface the
                // FIRST failure so a persistent problem (e.g. disk full) is visible
                // instead of silently stalling frame saves.
                if !reportedWriteError {
                    reportedWriteError = true
                    let desc = error.localizedDescription
                    DispatchQueue.main.async { self.onWriteError?(desc) }
                }
                continue
            }
            saved += 1
            if !hasDepth { withoutDepth += 1 }
            switch extracted.trackingState {
            case .normal: tn += 1
            case .limited: tl += 1
            case .notAvailable: tna += 1
            }
            updateWriterStats(saved: saved, extracted: extracted, hadDepth: hasDepth,
                              tn: tn, tl: tl, tna: tna)
        }
        // Queue is closed & drained: finalize ON THIS THREAD (no main-thread
        // file I/O, no cross-thread handle races -> STOP can't deadlock).
        finalizeOnWriter(saved: saved, withoutDepth: withoutDepth,
                         tn: tn, tl: tl, tna: tna)
    }

    private func finalizeOnWriter(saved: Int, withoutDepth: Int,
                                  tn: Int, tl: Int, tna: Int) {
        guard let store = store else { return }
        store.flush()
        summary.durationS = ProcessInfo.processInfo.systemUptime - startTime
        summary.framesConsidered = considered
        summary.framesSaved = saved
        summary.framesDropped = queue.droppedCount
        summary.framesWithoutDepth = withoutDepth
        summary.trackingNormal = tn
        summary.trackingLimited = tl
        summary.trackingNotAvailable = tna
        summary.storageBytes = store.bytesWritten
        summary.recordingStatus = stopReason
        try? store.writeSummary(summary)
        store.close()
        DispatchQueue.main.async {
            try? self.machine.apply(.finalizeSucceeded)
            self.stats.framesSaved = saved
            self.publishState()
        }
    }

    private func enqueueMirror(fid: Int, meta: FrameMetadata, urls: [PayloadType: URL]) {
        // Local-only recording: nothing to mirror, skip the extra file reads +
        // hashing so the writer keeps up with the capture rate.
        if transport is OfflineTransport { return }
        // metadata as its own payload (JSON bytes)
        if let line = try? meta.jsonLine(), let data = line.data(using: .utf8) {
            transport.enqueue(MirrorItem(identity: .init(frameID: fid, payloadType: .frameMetadata),
                                         fileURL: tempWrite(data, name: "meta_\(fid).json"),
                                         sha256: Checksum.sha256Hex(data), byteLength: data.count))
        }
        for (pt, url) in urls {
            if let data = try? Data(contentsOf: url) {
                transport.enqueue(MirrorItem(identity: .init(frameID: fid, payloadType: pt),
                                             fileURL: url, sha256: Checksum.sha256Hex(data),
                                             byteLength: data.count))
            }
        }
    }

    // MARK: audio (isolated; never affects the frame path)

    /// Start microphone capture for this session. Best-effort: does nothing if the
    /// mic is denied or the engine fails, so recording is unaffected.
    private func startAudio(sessionRoot: URL) {
        guard AudioCapture.isAuthorized, let a = AudioCapture(sessionRoot: sessionRoot) else { return }
        a.onChunk = { [weak self] seq, url, data in
            self?.handleAudioChunk(seq: seq, url: url, data: data)
        }
        a.onError = { [weak self] msg in
            DispatchQueue.main.async { self?.onWriteError?("audio: \(msg)") }
        }
        if a.start() { self.audio = a }
    }

    /// AudioCapture already wrote the PCM chunk to disk (source of truth); only
    /// mirror it when a live transport is attached. frame_id == chunk sequence.
    private func handleAudioChunk(seq: Int, url: URL, data: Data) {
        if transport is OfflineTransport { return }
        transport.enqueue(MirrorItem(identity: .init(frameID: seq, payloadType: .audio),
                                     fileURL: url, sha256: Checksum.sha256Hex(data),
                                     byteLength: data.count))
    }

    private func tempWrite(_ data: Data, name: String) -> URL {
        let u = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        try? data.write(to: u)
        return u
    }

    private func updateWriterStats(saved: Int, extracted: ExtractedFrame, hadDepth: Bool,
                                   tn: Int, tl: Int, tna: Int) {
        let qDepth = queue.count
        DispatchQueue.main.async {
            self.stats.framesSaved = saved
            self.stats.writerQueueDepth = qDepth
            self.stats.lastValidDepthPct = extracted.validDepthPercent
            self.stats.confidence = extracted.confidenceHistogram
            self.stats.trackingNormal = tn
            self.stats.trackingLimited = tl
            self.stats.trackingNotAvailable = tna
        }
    }

    // MARK: finalize

    /// Non-blocking: flip the gate, close the queue, and let the WRITER thread
    /// drain + finalize (flush, summary, close) and transition to `.completed`.
    /// Main never does file I/O here, so STOP can't freeze the UI.
    private func stopSafely(reason: String) {
        guard machine.isRecording else { return }
        stopReason = reason
        setAccepting(false)                 // stop the capture queue enqueuing first
        audio?.stop(); audio = nil          // flush trailing audio chunk, release the mic
        try? machine.apply(.stop); publishState()
        summary.interruptionCount = stats.interruptions
        queue.close()                       // wake writer -> it drains + finalizes
        writerThread = nil
        if reason != "completed" {
            DispatchQueue.main.async { self.onAutoStop?(reason) }
        }
    }

    var lastSessionURL: URL? { store?.root }

    private func publishState() {
        let s = machine.state
        DispatchQueue.main.async {
            self.stats.state = s
            self.stats.writerQueueCapacity = self.queue.capacity
            self.stats.storageFreeBytes = self.freeBytes()
        }
    }

    private func freeBytes() -> Int64 {
        // Prefer the "important usage" figure, fall back to plain available
        // capacity. If BOTH are unavailable, return a large value rather than 0
        // so a nil reading never triggers a false "low storage" stop.
        if let v = try? baseDir.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]),
           let imp = v.volumeAvailableCapacityForImportantUsage, imp > 0 {
            return Int64(imp)
        }
        if let v = try? baseDir.resourceValues(forKeys: [.volumeAvailableCapacityKey]),
           let cap = v.volumeAvailableCapacity, cap > 0 {
            return Int64(cap)
        }
        return Int64.max
    }
}
