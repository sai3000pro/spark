import SwiftUI
import GauzensplatCaptureCore

struct CaptureView: View {
    @ObservedObject var vm: CaptureViewModel
    @State private var showExport = false
    @State private var showDebug = false

    private var isRecording: Bool { vm.stats.state == .recording }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Gauzensplat Capture")
                    .font(.largeTitle).bold()

                healthCard
                statsCard
                ConnectionPanel(vm: vm)
                controls

                if let msg = vm.health.lastError {
                    Text("⚠︎ \(msg)").foregroundColor(.orange).font(.footnote)
                }
            }
            .padding()
        }
        .sheet(isPresented: $showExport) {
            if let url = vm.lastSessionURL {
                ExportSheet(sessionURL: url)
            } else {
                Text("No capture to export yet.").padding()
            }
        }
        .sheet(isPresented: $showDebug) { DebugView(vm: vm) }
    }

    // MARK: sections

    private var healthCard: some View {
        card {
            row("LiDAR", vm.health.lidarActive ? "ACTIVE" : "UNAVAILABLE",
                ok: vm.health.lidarActive)
            row("AR Tracking", trackingText, ok: vm.health.tracking == .normal)
            row("Depth", depthText, ok: vm.health.sceneDepthSupported)
            row("Camera", vm.health.cameraAuthorized ? "AUTHORIZED" : "DENIED",
                ok: vm.health.cameraAuthorized)
        }
    }

    private var statsCard: some View {
        card {
            row("Recording", timeString(vm.stats.durationSeconds), ok: isRecording)
            row("Frames Saved", "\(vm.stats.framesSaved)")
            row("Frames Dropped", "\(vm.stats.framesDropped)",
                ok: vm.stats.framesDropped == 0)
            row("Writer Queue", "\(vm.stats.writerQueueDepth) / \(vm.stats.writerQueueCapacity)")
            row("Valid Depth", String(format: "%.1f%%", vm.stats.lastValidDepthPct))
            row("Confidence", confidenceText)
            row("Capture Rate", String(format: "%.0f Hz", coordinatorRate))
            row("Storage Free", storageText)
        }
    }

    private var controls: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Button(action: { vm.startRecording() }) {
                    Label("START", systemImage: "record.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).tint(.green)
                .disabled(isRecording || !vm.health.cameraAuthorized)

                Button(action: { vm.stopRecording() }) {
                    Label("STOP", systemImage: "stop.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).tint(.red)
                .disabled(!isRecording)
            }
            HStack(spacing: 12) {
                Button("EXPORT LAST CAPTURE") { showExport = true }
                    .frame(maxWidth: .infinity)
                    .buttonStyle(.bordered)
                    .disabled(vm.stats.state != .completed)
                Button("DEBUG") { showDebug = true }
                    .buttonStyle(.bordered)
            }
            Picker("Rate", selection: Binding(
                get: { Int(coordinatorRate) },
                set: { vm.setRate(Double($0)) })) {
                Text("1 Hz").tag(1); Text("5 Hz").tag(5); Text("10 Hz").tag(10)
            }
            .pickerStyle(.segmented)
            .disabled(isRecording)
        }
    }

    // MARK: helpers

    private var coordinatorRate: Double {
        vm.coordinator.sampleRateHz
    }
    private var trackingText: String {
        switch vm.health.tracking {
        case .normal: return "NORMAL"; case .limited: return "LIMITED"
        case .notAvailable: return "UNAVAILABLE"
        }
    }
    private var depthText: String { vm.health.sceneDepthSupported ? "256 × 192" : "n/a" }
    private var confidenceText: String {
        let c = vm.stats.confidence
        let total = max(1, c.low + c.medium + c.high)
        return String(format: "L%d M%d H%d", 100 * c.low / total,
                      100 * c.medium / total, 100 * c.high / total)
    }
    private var storageText: String {
        ByteCountFormatter.string(fromByteCount: vm.stats.storageFreeBytes, countStyle: .file)
    }

    private func timeString(_ t: TimeInterval) -> String {
        let s = Int(t); return String(format: "%02d:%02d", s / 60, s % 60)
    }

    @ViewBuilder private func card<Content: View>(@ViewBuilder _ c: () -> Content) -> some View {
        VStack(spacing: 6) { c() }
            .padding()
            .background(RoundedRectangle(cornerRadius: 12).fill(Color(.secondarySystemBackground)))
    }

    @ViewBuilder private func row(_ label: String, _ value: String, ok: Bool? = nil) -> some View {
        HStack {
            Text(label).foregroundColor(.secondary)
            Spacer()
            Text(value).bold()
                .foregroundColor(ok == nil ? .primary : (ok! ? .green : .orange))
        }
    }
}
