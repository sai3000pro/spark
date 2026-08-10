import Foundation
import AVFoundation

/// Microphone capture for a recording session — fully isolated from the AR/frame
/// pipeline. Taps `AVAudioEngine`, converts to 16 kHz mono signed-16-bit PCM
/// (Whisper's native rate), and emits fixed ~1 s chunks. Each chunk is written to
/// `audio/NNNNNN.pcm` under the session root (local disk = source of truth) and
/// handed to `onChunk` for optional live mirroring.
///
/// Everything here is best-effort: if the mic is denied or the engine fails to
/// start, `start()` returns false and recording proceeds normally without audio.
/// It never touches `CaptureFileStore`, the frame queue, or the AR session, so it
/// cannot destabilise the working capture path.
final class AudioCapture {

    /// Called (on a private serial queue) for each completed PCM chunk:
    /// `(chunkSeq, fileURL, rawPCMBytes)`.
    var onChunk: ((Int, URL, Data) -> Void)?
    /// Called once (main thread) if audio capture fails to start / stops on error.
    var onError: ((String) -> Void)?

    static let sampleRate: Double = 16000
    static let chunkSeconds: Double = 1.0
    private var chunkBytes: Int { Int(Self.sampleRate * Self.chunkSeconds) * 2 } // s16 mono

    private let engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private let outFormat: AVAudioFormat
    private let audioDir: URL
    private let ioQueue = DispatchQueue(label: "gauzensplat.audio", qos: .utility)

    private var accum = Data()          // ioQueue only
    private var chunkSeq = 0            // ioQueue only
    private var started = false         // main only
    private var restarting = false      // main only; reentrancy guard for restart()
    private var observers: [NSObjectProtocol] = []  // main only

    init?(sessionRoot: URL) {
        guard let fmt = AVAudioFormat(commonFormat: .pcmFormatInt16,
                                      sampleRate: Self.sampleRate, channels: 1,
                                      interleaved: true) else { return nil }
        self.outFormat = fmt
        self.audioDir = sessionRoot.appendingPathComponent("audio", isDirectory: true)
    }

    /// Request microphone permission ahead of time (mirrors the camera prompt).
    static func requestAccess(_ completion: @escaping (Bool) -> Void) {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async { completion(granted) }
        }
    }

    static var isAuthorized: Bool {
        AVAudioSession.sharedInstance().recordPermission == .granted
    }

    /// Start capturing. Returns false (and records nothing) on any failure.
    @discardableResult
    func start() -> Bool {
        guard !started else { return true }
        guard Self.isAuthorized else { return false }
        do {
            try FileManager.default.createDirectory(at: audioDir, withIntermediateDirectories: true)
            try activateSession()
            guard configureEngine() else { return false }
            try engine.start()
            started = true
            registerObservers()
            return true
        } catch {
            let msg = error.localizedDescription
            DispatchQueue.main.async { self.onError?(msg) }
            return false
        }
    }

    /// Stop capturing and flush any partial trailing chunk.
    func stop() {
        guard started else { return }
        started = false
        removeObservers()
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        // deactivate off the main flow; ignore errors (best-effort)
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        ioQueue.async { [weak self] in self?.flushRemainder() }
    }

    // MARK: - engine lifecycle + self-healing

    /// Configure the shared audio session for mixed record. Coexists with the AR
    /// camera / other audio and doesn't duck other apps.
    private func activateSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default,
                                options: [.mixWithOthers, .allowBluetooth])
        try session.setActive(true, options: [])
    }

    /// (Re)build the converter + input tap for the CURRENT hardware input format
    /// and prepare the engine. Safe to call repeatedly — removes any prior tap
    /// first. Returns false if the input is unavailable. Must run on main.
    private func configureEngine() -> Bool {
        let input = engine.inputNode
        let inFormat = input.outputFormat(forBus: 0)
        guard inFormat.sampleRate > 0,
              let conv = AVAudioConverter(from: inFormat, to: outFormat) else {
            return false
        }
        converter = conv
        // ~100 ms tap buffers; converted + accumulated on the io queue.
        let tapFrames = AVAudioFrameCount(inFormat.sampleRate * 0.1)
        input.removeTap(onBus: 0)   // no-op if none installed
        input.installTap(onBus: 0, bufferSize: tapFrames, format: inFormat) { [weak self] buf, _ in
            self?.handleInput(buf)
        }
        engine.prepare()
        return true
    }

    /// Rebuild + restart the engine after the shared audio session was reconfigured
    /// out from under us. This is the whole reason audio survives a live capture:
    /// when ARKit's camera pipeline settles the AVAudioSession (or an interruption /
    /// route change / media-services reset happens), AVAudioEngine tears down the
    /// installed tap and stops delivering buffers permanently — with no observer it
    /// silently dies after ~1 s. Here we re-activate the session, rebuild the graph
    /// for the possibly-changed input format, and start again. Main-thread only.
    private func restart(reason: String) {
        guard started, !restarting else { return }
        restarting = true
        defer { restarting = false }
        do {
            try activateSession()
            engine.stop()
            guard configureEngine() else {
                DispatchQueue.main.async { self.onError?("audio restart failed: no input") }
                return
            }
            try engine.start()
        } catch {
            let msg = error.localizedDescription
            DispatchQueue.main.async { self.onError?("audio restart failed: \(msg)") }
        }
    }

    private func registerObservers() {
        let nc = NotificationCenter.default
        // Interruption (phone call, Siri, etc.): rebuild when it ends.
        observers.append(nc.addObserver(forName: AVAudioSession.interruptionNotification,
                                        object: AVAudioSession.sharedInstance(),
                                        queue: .main) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            if raw.flatMap(AVAudioSession.InterruptionType.init) == .ended {
                self?.restart(reason: "interruption ended")
            }
        })
        // The engine posts this when the session/hardware config changes (e.g. ARKit
        // camera settling the audio session). The system has already stopped the
        // engine by the time this fires — this is the primary recovery path.
        observers.append(nc.addObserver(forName: .AVAudioEngineConfigurationChange,
                                        object: engine,
                                        queue: .main) { [weak self] _ in
            self?.restart(reason: "engine config change")
        })
    }

    private func removeObservers() {
        let nc = NotificationCenter.default
        for o in observers { nc.removeObserver(o) }
        observers.removeAll()
    }

    // MARK: - conversion + chunking (io queue for accumulation/writes)

    private func handleInput(_ inBuf: AVAudioPCMBuffer) {
        guard let conv = converter else { return }
        let ratio = outFormat.sampleRate / inBuf.format.sampleRate
        let cap = AVAudioFrameCount(Double(inBuf.frameLength) * ratio) + 1024
        guard let outBuf = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: cap) else { return }
        var fed = false
        var err: NSError?
        conv.convert(to: outBuf, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true; status.pointee = .haveData; return inBuf
        }
        guard err == nil, outBuf.frameLength > 0,
              let ch = outBuf.int16ChannelData else { return }
        let byteCount = Int(outBuf.frameLength) * 2
        let data = Data(bytes: ch[0], count: byteCount)
        ioQueue.async { [weak self] in self?.accumulate(data) }
    }

    private func accumulate(_ data: Data) {
        accum.append(data)
        while accum.count >= chunkBytes {
            let chunk = accum.prefix(chunkBytes)
            accum.removeFirst(chunkBytes)
            emit(Data(chunk))
        }
    }

    private func flushRemainder() {
        if !accum.isEmpty {
            let chunk = accum
            accum.removeAll(keepingCapacity: false)
            emit(chunk)
        }
    }

    private func emit(_ pcm: Data) {
        let seq = chunkSeq; chunkSeq += 1
        let url = audioDir.appendingPathComponent(String(format: "%06d.pcm", seq))
        do {
            try pcm.write(to: url, options: .atomic)
        } catch {
            return  // disk write failed; drop this chunk, keep capturing
        }
        onChunk?(seq, url, pcm)
    }
}
