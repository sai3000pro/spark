import Foundation
import Combine
import ARKit
import SwiftUI
import GauzensplatCaptureCore

/// Bridges ARSessionController + CaptureCoordinator + Wi-Fi transport to SwiftUI.
@MainActor
final class CaptureViewModel: ObservableObject {

    let ar = ARSessionController()
    @Published var coordinator: CaptureCoordinator

    // network / connection UI state
    @Published var serverAddress: String = UserDefaults.standard
        .string(forKey: "lastServerAddress") ?? ""
    @Published var connectionMessage = "OFFLINE"
    @Published var connected = false
    @Published var rttMs: Double?
    @Published var offsetMs: Double?
    @Published var mirrorEnabled = false

    private var transport: CaptureTransport
    private var wifi: WiFiLaptopTransport?
    private var rateHz: Double = 5

    // `health` and `stats` live on the child ObservableObjects (ar / coordinator).
    // SwiftUI only observes THIS object, so forward the children's change
    // notifications here or the UI never re-renders while recording.
    private var cancellables = Set<AnyCancellable>()
    private var coordinatorCancellable: AnyCancellable?

    init() {
        let offline = OfflineTransport()
        self.transport = offline
        self.coordinator = CaptureCoordinator(sampler: FixedRateSampler(rateHz: 5),
                                              transport: offline)
        ar.onFrame = { [weak self] frame in self?.coordinator.ingest(frame) }
        ar.onInterruption = { [weak self] _ in self?.coordinator.handleInterruption() }
        ar.objectWillChange
            .receive(on: RunLoop.main)
            .sink { [weak self] in self?.objectWillChange.send() }
            .store(in: &cancellables)
        bindCoordinator()
    }

    private func bindCoordinator() {
        coordinatorCancellable = coordinator.objectWillChange
            .receive(on: RunLoop.main)
            .sink { [weak self] in self?.objectWillChange.send() }
    }

    // MARK: capture

    var health: ARSessionController.Health { ar.health }
    var stats: CaptureCoordinator.Stats { coordinator.stats }

    func setRate(_ hz: Double) {
        rateHz = hz
        rebuildCoordinator()
    }

    private func rebuildCoordinator() {
        coordinator = CaptureCoordinator(sampler: FixedRateSampler(rateHz: rateHz),
                                         transport: transport)
        bindCoordinator()
    }

    func onAppear() {
        ar.requestCameraAccess { _ in }
    }

    func startRecording() {
        // A completed CaptureCoordinator has a closed queue + finished state
        // machine, so reuse would silently no-op. Build a fresh one per session.
        if coordinator.stats.state != .idle {
            rebuildCoordinator()
        }
        guard ar.start() else { return }
        do { try coordinator.start() } catch { print("start failed: \(error)") }
    }

    func stopRecording() {
        coordinator.stop()
        ar.stop()
        if mirrorEnabled, let wifi = wifi {
            Task {
                let result = try? await wifi.endSession()
                if let r = result {
                    connectionMessage = r.complete
                        ? "SYNC COMPLETE (\(r.serverFrames)/\(r.localFrames))"
                        : "SYNC INCOMPLETE missing \(r.missing)"
                }
            }
        }
    }

    var lastSessionURL: URL? { coordinator.lastSessionURL }

    // MARK: networking

    private func normalizedURL() -> URL? {
        var s = serverAddress.trimmingCharacters(in: .whitespaces)
        guard !s.isEmpty else { return nil }
        if !s.hasPrefix("http://") && !s.hasPrefix("https://") { s = "http://" + s }
        return URL(string: s)
    }

    func testConnection() {
        guard let url = normalizedURL() else { connectionMessage = "enter server address"; return }
        connectionMessage = "testing…"
        Task {
            let r = await ConnectionTester.test(serverURL: url)
            self.connected = r.ok
            self.connectionMessage = r.message
            self.rttMs = r.rttMs
            self.offsetMs = r.offsetMs
            if r.ok { UserDefaults.standard.set(self.serverAddress, forKey: "lastServerAddress") }
        }
    }

    /// Enable live mirroring: connect, begin session, sync clock, swap transport.
    func enableMirroring() {
        guard let url = normalizedURL() else { return }
        let wifi = WiFiLaptopTransport()
        self.wifi = wifi
        self.transport = wifi
        Task {
            do {
                try await wifi.connect(serverURL: url)
                _ = try await wifi.beginSession(deviceSessionID: UUID().uuidString)
                await wifi.syncClock()
                self.mirrorEnabled = true
                self.connected = true
                self.connectionMessage = "MIRRORING"
                self.rebuildCoordinator()
            } catch {
                self.connectionMessage = "mirror connect failed"
                self.transport = OfflineTransport()
                self.mirrorEnabled = false
            }
        }
    }

    func disableMirroring() {
        wifi?.disconnect()
        wifi = nil
        transport = OfflineTransport()
        mirrorEnabled = false
        connectionMessage = "OFFLINE"
        rebuildCoordinator()
    }
}
