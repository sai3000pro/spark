import SwiftUI

/// Laptop-server connection panel.  Recording is ALWAYS possible even when the
/// laptop is OFFLINE — the panel makes the distinction explicit.
struct ConnectionPanel: View {
    @ObservedObject var vm: CaptureViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Laptop Server").font(.headline)
            HStack {
                TextField("192.168.1.20:8765", text: $vm.serverAddress)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                Button("TEST") { vm.testConnection() }
                    .buttonStyle(.bordered)
            }
            HStack {
                Circle().fill(vm.connected ? Color.green : Color.gray).frame(width: 10, height: 10)
                Text(vm.connectionMessage).font(.subheadline).bold()
            }
            if let rtt = vm.rttMs {
                Text(String(format: "RTT: %.1f ms", rtt)).font(.caption).foregroundColor(.secondary)
            }
            if let off = vm.offsetMs {
                Text(String(format: "Clock offset: %+.1f ms", off))
                    .font(.caption).foregroundColor(.secondary)
            }
            HStack {
                if vm.mirrorEnabled {
                    Button("STOP MIRRORING") { vm.disableMirroring() }
                        .buttonStyle(.bordered).tint(.orange)
                } else {
                    Button("ENABLE LIVE MIRROR") { vm.enableMirroring() }
                        .buttonStyle(.bordered).tint(.blue)
                        .disabled(!vm.connected)
                }
            }
            Text(vm.mirrorEnabled ? "Capture: local + live mirror"
                                  : "Capture: local only (laptop mirror OFF)")
                .font(.caption2).foregroundColor(.secondary)
        }
        .padding()
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(.secondarySystemBackground)))
    }
}
