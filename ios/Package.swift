// swift-tools-version:5.9
// Builds the PURE-LOGIC capture core (Foundation + simd + CryptoKit only).
// The ARKit/SwiftUI iOS app in GauzensplatCapture/ reuses these same source
// files; only the app target adds device/UI code.  This package lets the
// contract-critical math/format/protocol code be compiled and unit-tested on
// the Mac with `swift test`, without a device.
import PackageDescription

let package = Package(
    name: "GauzensplatCaptureCore",
    platforms: [.macOS(.v12), .iOS(.v16)],
    products: [
        .library(name: "GauzensplatCaptureCore", targets: ["GauzensplatCaptureCore"]),
    ],
    targets: [
        .target(name: "GauzensplatCaptureCore", path: "Sources/GauzensplatCaptureCore"),
        // Executable mirror of the XCTest suite so the contract-critical logic
        // can be RUN on a machine that only has Command Line Tools (no XCTest).
        // On a full-Xcode Mac use `swift test` / the app's test target instead.
        .executableTarget(
            name: "CoreCheck",
            dependencies: ["GauzensplatCaptureCore"],
            path: "Sources/CoreCheck"
        ),
        .testTarget(
            name: "GauzensplatCaptureCoreTests",
            dependencies: ["GauzensplatCaptureCore"],
            path: "Tests/GauzensplatCaptureCoreTests"
        ),
    ]
)
