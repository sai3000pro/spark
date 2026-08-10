import SwiftUI

@main
struct GauzensplatCaptureApp: App {
    @StateObject private var vm = CaptureViewModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            CaptureView(vm: vm)
                .onAppear { vm.onAppear() }
                .onChange(of: scenePhase) { phase in
                    if phase == .active { vm.refreshOnForeground() }
                }
                .preferredColorScheme(.dark)
        }
    }
}
