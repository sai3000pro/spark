import SwiftUI

/// History sheet (opened by the clock button that used to be Debug).
///
/// Lists every recording on disk, newest first. Sessions are one of two kinds:
///   • LOCAL   — a standalone offline scan saved on the phone. Share it later via
///               AirDrop (the zip export) straight from its row.
///   • MIRRORED — was streamed live to the laptop. "Continue" rejoins that same
///               live splat run so it keeps building.
/// Either kind can be continued (append more frames) or shared.
///
/// (File is still named DebugView.swift so the Xcode project needs no regen; the
/// type is HistoryView.)
struct HistoryView: View {
    @ObservedObject var vm: CaptureViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var sessions: [CaptureViewModel.PastSession] = []
    @State private var share: ShareItem?
    @State private var pendingDelete: CaptureViewModel.PastSession?

    private var isRecording: Bool { vm.stats.state == .recording }

    private struct ShareItem: Identifiable { let id = UUID(); let url: URL }

    var body: some View {
        NavigationView {
            Group {
                if sessions.isEmpty {
                    ContentUnavailableCompat()
                } else {
                    List {
                        Section {
                            ForEach(sessions) { s in row(s) }
                        } footer: {
                            Text("Local scans are saved on this phone — share one via AirDrop with "
                                 + "the Share button. “Continue” keeps recording into a session; a "
                                 + "mirrored one rejoins its live splat run. An “on laptop” scan is "
                                 + "fully synced — deleting it here frees phone storage and keeps the "
                                 + "laptop copy.")
                        }
                    }
                }
            }
            .navigationTitle("History")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { reload(verify: true) } label: {
                        Label("Check laptop", systemImage: "arrow.triangle.2.circlepath")
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .onAppear { reload(verify: true) }
        .sheet(item: $share) { ExportSheet(sessionURL: $0.url) }
        .confirmationDialog("Delete from phone?",
            isPresented: Binding(get: { pendingDelete != nil },
                                 set: { if !$0 { pendingDelete = nil } }),
            presenting: pendingDelete) { s in
            Button("Delete \(s.frameCount) frame\(s.frameCount == 1 ? "" : "s")",
                   role: .destructive) {
                vm.deleteSession(dirName: s.dirName)
                pendingDelete = nil
                reload(verify: false)
            }
            Button("Cancel", role: .cancel) { pendingDelete = nil }
        } message: { s in
            Text(s.synced
                 ? "This scan is on the laptop. Deleting frees space on the phone; the laptop copy is kept."
                 : "This scan is NOT confirmed on the laptop. Deleting removes it permanently from the phone.")
        }
    }

    /// Refresh the list, optionally re-checking the laptop for newly-synced scans.
    private func reload(verify: Bool) {
        sessions = vm.listSessions()
        if verify {
            Task { await vm.verifySyncStatus(); sessions = vm.listSessions() }
        }
    }

    @ViewBuilder
    private func row(_ s: CaptureViewModel.PastSession) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(dateText(s.createdAt)).font(.subheadline.weight(.semibold))
                    if s.synced {
                        badge("on laptop", .blue)
                    } else if s.mirrored {
                        badge("mirrored", .green)
                    } else {
                        badge("local", .orange)
                    }
                }
                Text("\(s.frameCount) frame\(s.frameCount == 1 ? "" : "s")")
                    .font(.footnote).foregroundColor(.secondary)
                Text(s.dirName).font(.caption2.monospaced()).foregroundColor(.secondary)
                    .lineLimit(1).truncationMode(.middle)
            }
            Spacer(minLength: 8)
            VStack(spacing: 6) {
                Button { share = ShareItem(url: s.url) } label: {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                Button("Continue") {
                    vm.resumeRecording(dirName: s.dirName)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(isRecording)
                Button(role: .destructive) { pendingDelete = s } label: {
                    Label("Delete", systemImage: "trash")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .tint(s.synced ? .blue : .red)   // blue = safe (on laptop); red = caution
                .disabled(isRecording)
            }
            .fixedSize()
        }
        .padding(.vertical, 2)
    }

    private func badge(_ text: String, _ color: Color) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.18), in: Capsule())
            .foregroundColor(color)
    }

    private func dateText(_ date: Date?) -> String {
        guard let date else { return "—" }
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f.string(from: date)
    }
}

/// Minimal empty-state (avoids depending on iOS 17's ContentUnavailableView).
private struct ContentUnavailableCompat: View {
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.largeTitle).foregroundColor(.secondary)
            Text("No sessions yet").font(.headline)
            Text("Recordings you make will appear here to continue or share.")
                .font(.footnote).foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(32)
    }
}
