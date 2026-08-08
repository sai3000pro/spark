import SwiftUI

@main
struct GauzensplatCaptureApp: App {
    @StateObject private var vm = CaptureViewModel()

    var body: some Scene {
        WindowGroup {
            CaptureView(vm: vm)
                .onAppear { vm.onAppear() }
                .preferredColorScheme(.dark)
        }
    }
}
