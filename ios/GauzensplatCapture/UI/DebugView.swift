import SwiftUI

struct DebugView: View {
    @ObservedObject var vm: CaptureViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            List {
                Section("Session") {
                    kv("State", "\(vm.stats.state.rawValue)")
                    kv("Frames considered", "\(vm.stats.framesConsidered)")
                    kv("Frames saved", "\(vm.stats.framesSaved)")
                    kv("Frames dropped", "\(vm.stats.framesDropped)")
                    kv("Frames without depth", "\(vm.stats.framesWithoutDepth)")
                    kv("Interruptions", "\(vm.stats.interruptions)")
                }
                Section("Tracking") {
                    kv("normal", "\(vm.stats.trackingNormal)")
                    kv("limited", "\(vm.stats.trackingLimited)")
                    kv("notAvailable", "\(vm.stats.trackingNotAvailable)")
                }
                Section("Last session path") {
                    Text(vm.lastSessionURL?.lastPathComponent ?? "—")
                        .font(.caption).foregroundColor(.secondary)
                }
            }
            .navigationTitle("Debug")
            .toolbar { ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() } } }
        }
    }

    private func kv(_ k: String, _ v: String) -> some View {
        HStack { Text(k); Spacer(); Text(v).foregroundColor(.secondary) }
    }
}
