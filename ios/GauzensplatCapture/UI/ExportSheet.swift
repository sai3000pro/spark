import SwiftUI
import UIKit

/// Zips the capture session directory and presents the system share sheet
/// (Files / AirDrop / etc).  Manual export always works, even if live mirroring
/// failed or was never enabled.
struct ExportSheet: UIViewControllerRepresentable {
    let sessionURL: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let items: [Any]
        if let zip = try? ExportManager.zipSession(sessionURL) {
            items = [zip]
        } else {
            items = [sessionURL]
        }
        return UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

enum ExportManager {
    /// Package a capture directory into a single .zip in a temp location.
    static func zipSession(_ sessionURL: URL) throws -> URL {
        let fm = FileManager.default
        let dest = fm.temporaryDirectory
            .appendingPathComponent(sessionURL.lastPathComponent)
            .appendingPathExtension("zip")
        try? fm.removeItem(at: dest)

        // NSFileCoordinator produces a zip when reading a directory with the
        // .forUploading option — no third-party zip dependency needed.
        var coordError: NSError?
        var resultURL: URL?
        let coordinator = NSFileCoordinator()
        coordinator.coordinate(readingItemAt: sessionURL, options: [.forUploading],
                               error: &coordError) { tmpURL in
            do {
                try fm.copyItem(at: tmpURL, to: dest)
                resultURL = dest
            } catch {
                resultURL = tmpURL
            }
        }
        if let e = coordError { throw e }
        return resultURL ?? sessionURL
    }
}
