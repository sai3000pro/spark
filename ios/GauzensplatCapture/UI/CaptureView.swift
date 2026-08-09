import SwiftUI
import ARKit
import SceneKit
import QuartzCore
import GauzensplatCaptureCore

struct CaptureView: View {
    @ObservedObject var vm: CaptureViewModel
    @State private var showExport = false
    @State private var showHistory = false
    @State private var showStats = false

    private var isRecording: Bool { vm.stats.state == .recording }

    var body: some View {
        ZStack {
            ARCoverageView(vm: vm).ignoresSafeArea()

            VStack(spacing: 0) {
                topBar
                Spacer()
                if showStats {
                    statsOverlay
                        .padding(.horizontal).padding(.bottom, 8)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                bottomBar
            }

            if !vm.health.cameraAuthorized {
                cameraDeniedOverlay
            }
        }
        .sheet(isPresented: $showExport) {
            if let url = vm.lastSessionURL {
                ExportSheet(sessionURL: url)
            } else {
                Text("No capture to export yet.").padding()
            }
        }
        .sheet(isPresented: $showHistory) { HistoryView(vm: vm) }
        .animation(.easeInOut(duration: 0.2), value: isRecording)
        .animation(.easeInOut(duration: 0.2), value: showStats)
    }

    // MARK: bars

    private var topBar: some View {
        HStack(alignment: .top) {
            if isRecording {
                HStack(spacing: 6) {
                    Circle().fill(.red).frame(width: 9, height: 9)
                    Text(timeString(vm.stats.durationSeconds))
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                }
                .foregroundColor(.white)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(.ultraThinMaterial, in: Capsule())
            }
            Spacer()
            VStack(spacing: 4) {
                CoverageRing(coverage: vm.coverage)
                Text("COVERAGE")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(.white.opacity(0.85))
            }
        }
        .padding(.horizontal).padding(.top, 8)
    }

    private var bottomBar: some View {
        VStack(spacing: 12) {
            legend
            if let msg = vm.recordStatus {
                Text(msg)
                    .font(.footnote).foregroundColor(.white.opacity(0.85))
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(.black.opacity(0.5), in: Capsule())
            }
            if let msg = vm.health.lastError {
                Text("⚠︎ \(msg)")
                    .font(.footnote).foregroundColor(.orange)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(.black.opacity(0.5), in: Capsule())
            }

            // Shutter: morphs between a red record circle and a stop square.
            Button { isRecording ? vm.stopRecording() : vm.startRecording() } label: {
                ZStack {
                    Circle().stroke(.white, lineWidth: 4).frame(width: 78, height: 78)
                    RoundedRectangle(cornerRadius: isRecording ? 8 : 32)
                        .fill(vm.health.cameraAuthorized ? Color.red : Color.gray)
                        .frame(width: isRecording ? 34 : 64, height: isRecording ? 34 : 64)
                }
            }
            .disabled(!vm.health.cameraAuthorized)

            HStack(spacing: 22) {
                iconButton("chart.bar.doc.horizontal", active: showStats) { showStats.toggle() }
                iconButton("square.and.arrow.up", enabled: vm.stats.state == .completed) { showExport = true }
                iconButton("clock.arrow.circlepath") { showHistory = true }
            }
        }
        .padding(.bottom, 22)
    }

    private var legend: some View {
        HStack(spacing: 14) {
            legendItem(.red, "need angles")
            legendItem(.yellow, "some")
            legendItem(.green, "enough")
        }
        .font(.system(size: 10, weight: .semibold))
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(.black.opacity(0.4), in: Capsule())
    }

    private func legendItem(_ c: Color, _ label: String) -> some View {
        HStack(spacing: 4) {
            Circle().fill(c).frame(width: 8, height: 8)
            Text(label).foregroundColor(.white.opacity(0.9))
        }
    }

    private var statsOverlay: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                healthCard
                statsCard
                ConnectionPanel(vm: vm)
                Picker("Rate", selection: Binding(
                    get: { Int(coordinatorRate) },
                    set: { vm.setRate(Double($0)) })) {
                    Text("1 Hz").tag(1); Text("5 Hz").tag(5); Text("10 Hz").tag(10)
                }
                .pickerStyle(.segmented)
                .disabled(isRecording)
            }
            .padding()
        }
        .frame(maxHeight: 360)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    private var cameraDeniedOverlay: some View {
        VStack(spacing: 14) {
            Image(systemName: "video.slash.fill").font(.largeTitle)
            Text("Camera access is off").font(.headline)
            Text(vm.health.cameraStatusText)
                .font(.footnote).foregroundColor(.secondary).multilineTextAlignment(.center)
            Button("Open Settings") { vm.openSettings() }.buttonStyle(.borderedProminent)
        }
        .padding(24)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .padding()
    }

    @ViewBuilder
    private func iconButton(_ system: String, active: Bool = false, enabled: Bool = true,
                            _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.title3)
                .foregroundColor(enabled ? (active ? .cyan : .white) : .white.opacity(0.35))
                .frame(width: 46, height: 46)
                .background(.ultraThinMaterial, in: Circle())
        }
        .disabled(!enabled)
    }

    // MARK: stat cards (shown behind the Stats toggle)

    private var healthCard: some View {
        card {
            row("LiDAR", lidarText, ok: vm.health.sceneDepthSupported)
            row("AR Tracking", trackingText, ok: vm.health.tracking == .normal)
            row("Depth", depthText, ok: vm.health.sceneDepthSupported)
            row("Camera", vm.health.cameraStatusText, ok: vm.health.cameraAuthorized)
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

    // MARK: helpers

    private var coordinatorRate: Double { vm.coordinator.sampleRateHz }
    private var trackingText: String {
        switch vm.health.tracking {
        case .normal: return "NORMAL"; case .limited: return "LIMITED"
        case .notAvailable: return "UNAVAILABLE"
        }
    }
    private var lidarText: String {
        guard vm.health.sceneDepthSupported else { return "UNSUPPORTED" }
        return vm.health.lidarActive ? "ACTIVE" : "READY"
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

// MARK: - Coverage ring

/// Overall "% of scanned surface that has enough angles."
struct CoverageRing: View {
    @ObservedObject var coverage: CoverageMap
    private var frac: CGFloat { CGFloat(coverage.fraction) }
    private var color: Color { frac >= 0.7 ? .green : (frac >= 0.3 ? .yellow : .red) }
    var body: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.25), lineWidth: 6)
            Circle().trim(from: 0, to: frac)
                .stroke(color, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(Int(coverage.fraction * 100))%")
                .font(.system(size: 13, weight: .bold).monospacedDigit())
                .foregroundColor(.white)
        }
        .frame(width: 60, height: 60)
        .padding(6)
        .background(.black.opacity(0.3), in: Circle())
    }
}

// MARK: - AR camera + LiDAR coverage mesh

/// ARSCNView that renders the live camera and drapes the LiDAR mesh, colored by how many
/// angles each surface region has been seen from (red → yellow → green).
struct ARCoverageView: UIViewRepresentable {
    let vm: CaptureViewModel

    func makeCoordinator() -> Coordinator { Coordinator(vm: vm) }

    func makeUIView(context: Context) -> ARSCNView {
        let v = ARSCNView()
        vm.ar.adopt(v.session)                 // controller drives/reads THIS session
        v.delegate = context.coordinator       // ARSCNView is the session delegate → renders camera
        v.automaticallyUpdatesLighting = true
        v.rendersContinuously = true
        v.scene = SCNScene()
        return v
    }

    func updateUIView(_ view: ARSCNView, context: Context) {}

    final class Coordinator: NSObject, ARSCNViewDelegate {
        let vm: CaptureViewModel
        private var lastColored: [UUID: CFTimeInterval] = [:]
        init(vm: CaptureViewModel) { self.vm = vm }

        // Session observer (ARSCNView forwards these to its delegate).
        func session(_ session: ARSession, didFailWithError error: Error) { vm.ar.reportFailure(error) }
        func sessionWasInterrupted(_ session: ARSession) { vm.ar.reportInterrupted() }
        func sessionInterruptionEnded(_ session: ARSession) { vm.ar.reportInterruptionEnded() }

        func renderer(_ renderer: SCNSceneRenderer, didAdd node: SCNNode, for anchor: ARAnchor) {
            guard let mesh = anchor as? ARMeshAnchor else { return }
            lastColored[anchor.identifier] = CACurrentMediaTime()
            node.geometry = Self.coloredGeometry(mesh, coverage: vm.coverage)
        }

        func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
            guard let mesh = anchor as? ARMeshAnchor else { return }
            let now = CACurrentMediaTime()
            if let last = lastColored[anchor.identifier], now - last < 0.4 { return }  // throttle recolor
            lastColored[anchor.identifier] = now
            node.geometry = Self.coloredGeometry(mesh, coverage: vm.coverage)
        }

        /// Build a translucent SCNGeometry from the mesh anchor with a per-vertex coverage color.
        static func coloredGeometry(_ anchor: ARMeshAnchor, coverage: CoverageMap) -> SCNGeometry {
            let g = anchor.geometry
            let n = g.vertices.count
            let vptr = g.vertices.buffer.contents()
            let vstride = g.vertices.stride
            let voff = g.vertices.offset
            let xform = anchor.transform

            var verts = [SIMD3<Float>](); verts.reserveCapacity(n)
            var colors = [SIMD4<Float>](); colors.reserveCapacity(n)
            for i in 0..<n {
                let fp = vptr.advanced(by: voff + i * vstride).assumingMemoryBound(to: Float.self)
                let p = SIMD3<Float>(fp[0], fp[1], fp[2])          // 12-byte read (safe for stride 12 or 16)
                verts.append(p)
                let w = xform * SIMD4<Float>(p.x, p.y, p.z, 1)
                colors.append(colorRamp(coverage.level(x: w.x, y: w.y, z: w.z)))
            }

            let vData = verts.withUnsafeBytes { Data($0) }
            let vSource = SCNGeometrySource(data: vData, semantic: .vertex, vectorCount: n,
                usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4,
                dataOffset: 0, dataStride: MemoryLayout<SIMD3<Float>>.stride)
            let cData = colors.withUnsafeBytes { Data($0) }
            let cSource = SCNGeometrySource(data: cData, semantic: .color, vectorCount: n,
                usesFloatComponents: true, componentsPerVector: 4, bytesPerComponent: 4,
                dataOffset: 0, dataStride: MemoryLayout<SIMD4<Float>>.stride)

            let faces = g.faces
            let fData = Data(bytes: faces.buffer.contents(), count: faces.buffer.length)
            let element = SCNGeometryElement(data: fData, primitiveType: .triangles,
                primitiveCount: faces.count, bytesPerIndex: faces.bytesPerIndex)

            let geo = SCNGeometry(sources: [vSource, cSource], elements: [element])
            let m = SCNMaterial()
            m.lightingModel = .constant
            m.isDoubleSided = true
            m.transparency = 0.55
            geo.materials = [m]
            return geo
        }

        /// 0 → red, 0.5 → yellow, 1 → green.
        static func colorRamp(_ t: Float) -> SIMD4<Float> {
            let c = max(0, min(1, t))
            let r: Float = c < 0.5 ? 1 : (1 - (c - 0.5) * 2)
            let g: Float = c < 0.5 ? c * 2 : 1
            return SIMD4<Float>(r, g, 0, 1)
        }
    }
}
