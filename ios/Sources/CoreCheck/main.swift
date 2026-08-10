import Foundation
import simd
import GauzensplatCaptureCore

// A dependency-free runner for the capture-core contract logic.  Mirrors the
// XCTest suite so it can execute under Command Line Tools (no XCTest module).
// Exits non-zero on the first failure.

var failures = 0
func check(_ cond: Bool, _ name: String) {
    if cond { print("  ok   \(name)") }
    else { print("  FAIL \(name)"); failures += 1 }
}
func approx(_ a: Double, _ b: Double, _ tol: Double = 1e-5) -> Bool { abs(a - b) <= tol }

print("== MatrixSerialization ==")
do {
    var m = matrix_identity_float4x4
    m.columns.3 = SIMD4<Float>(7, 0, 0, 1)
    let rows = MatrixSerialization.rows(from: m)
    check(rows[0][3] == 7.0 && rows[3][0] == 0.0, "row-major ordering")
    let back = MatrixSerialization.matrix4(from: rows)!
    check(back.translation == SIMD3<Float>(7, 0, 0), "matrix4 round-trip")
    // random rigid round-trips
    var okAll = true
    for i in 0..<20 {
        let axis = simd_normalize(SIMD3<Float>(Float(i % 3 + 1), Float((i + 1) % 3 + 1), 1))
        var r = simd_float4x4(simd_quatf(angle: Float(i) * 0.31, axis: axis))
        r.columns.3 = SIMD4<Float>(Float(i), -0.5 * Float(i), 0.25 * Float(i), 1)
        let rr = MatrixSerialization.matrix4(from: MatrixSerialization.rows(from: r))!
        for c in 0..<4 { for k in 0..<4 where abs(r[c][k] - rr[c][k]) > 1e-4 { okAll = false } }
    }
    check(okAll, "20 random rigid round-trips")
}

print("== Golden (cross-language) ==")
do {
    let m = simd_float4x4(columns: (SIMD4<Float>(0, 0, -1, 0), SIMD4<Float>(0, 1, 0, 0),
                                    SIMD4<Float>(1, 0, 0, 0), SIMD4<Float>(1, 2, 3, 1)))
    let golden: [[Double]] = [[0, 0, 1, 1], [0, 1, 0, 2], [-1, 0, 0, 3], [0, 0, 0, 1]]
    check(MatrixSerialization.rows(from: m) == golden, "matrix golden rows")
    let depth = BinaryEncoding.encodeDepth([1, 2, 3, 4])
    check(depth.map { String(format: "%02x", $0) }.joined() == "0000803f000000400000404000008040",
          "depth golden bytes")
    check(BinaryEncoding.decodeDepth(depth) == [1, 2, 3, 4], "depth decode round-trip")
    let conf = BinaryEncoding.encodeConfidence([0, 1, 2, 0])
    check(conf.map { String(format: "%02x", $0) }.joined() == "00010200", "confidence golden bytes")
    check(Checksum.sha256Hex(Data("gauzensplat".utf8)) ==
          "3f07e5a08fcf0d2922570c05aba5c6e553add9569394891afe575469eb293d88", "sha256 golden")
}

print("== IntrinsicsScaling ==")
do {
    let K = simd_float3x3(columns: (SIMD3<Float>(1000, 0, 0), SIMD3<Float>(0, 1200, 0),
                                    SIMD3<Float>(960, 720, 1)))
    let out = IntrinsicsScaling.scale(K, src: (1920, 1440), dst: (256, 192))!
    let p = IntrinsicsScaling.params(out)
    check(approx(p.fx, 1000 * 256.0 / 1920, 1e-2) && approx(p.fy, 1200 * 192.0 / 1440, 1e-2)
          && approx(p.cx, 960 * 256.0 / 1920, 1e-2) && approx(p.cy, 720 * 192.0 / 1440, 1e-2),
          "non-uniform scale")
    check(IntrinsicsScaling.scale(K, src: (0, 1440), dst: (256, 192)) == nil, "invalid dims rejected")
}

print("== State machine ==")
do {
    var sm = CaptureStateMachine()
    var thrown = false
    do {
        try sm.apply(.start); try sm.apply(.preparationSucceeded)
        try sm.apply(.stop); try sm.apply(.finalizeSucceeded)
        try sm.assertCanExport()
    } catch { thrown = true }
    check(!thrown && sm.state == .completed, "happy path -> completed + export")

    var sm2 = CaptureStateMachine()
    var doubleStart = false
    do { try sm2.apply(.start); try sm2.apply(.start) } catch { doubleStart = true }
    check(doubleStart, "double START rejected")

    var sm3 = CaptureStateMachine()
    var stopIdle = false
    do { try sm3.apply(.stop) } catch { stopIdle = true }
    check(stopIdle, "STOP while idle rejected")

    let sm4 = CaptureStateMachine()
    var exportEarly = false
    do { try sm4.assertCanExport() } catch { exportEarly = true }
    check(exportEarly, "export before completion rejected")
}

print("== FrameSampler ==")
do {
    let s = FixedRateSampler(rateHz: 5)
    let times = (0..<120).map { Double($0) / 60.0 }
    let n = times.reduce(0) { $0 + (s.shouldSample(timestamp: $1) ? 1 : 0) }
    check(n >= 9 && n <= 11, "5 Hz from 60 Hz stream (got \(n))")
    let s2 = FixedRateSampler(rateHz: 5)
    check(s2.shouldSample(timestamp: 10) && !s2.shouldSample(timestamp: 9.5)
          && !s2.shouldSample(timestamp: .nan), "non-monotonic + invalid rejected")
    let s3 = FixedRateSampler(rateHz: 5)
    check(s3.shouldSample(timestamp: 0) && !s3.shouldSample(timestamp: 0.05)
          && s3.shouldSample(timestamp: 30), "long pause accepts next")
}

print("== BoundedFrameQueue ==")
do {
    let q = BoundedFrameQueue<Int>(capacity: 3)
    _ = q.enqueue(1); _ = q.enqueue(2); _ = q.enqueue(3)
    let d4 = q.enqueue(4); let d5 = q.enqueue(5)
    check(!d4 && !d5 && q.droppedCount == 2 && q.enqueuedCount == 3 && q.requestedCount == 5,
          "backpressure drops + counters")
    _ = q.dequeue()
    check(q.enqueue(6), "recovery after drain")
}

print("== ClockSync ==")
do {
    let est = ClockSyncEstimator()
    let off: Int64 = 250_000_000, up: Int64 = 5_000_000, down: Int64 = 5_000_000
    let t0: Int64 = 1_000_000_000
    let t1 = t0 + up + off, t2 = t1 + 1000, t3 = t2 - off + down
    let s = est.add(t0: t0, t1: t1, t2: t2, t3: t3)
    check(abs(s.offsetNs - Double(off)) < 2000 && abs(s.rttNs - 10_000_000) < 2000,
          "symmetric offset + rtt recovered")
}

print("== CaptureFileStore ==")
do {
    let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("gz_cc_\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tmp) }
    let name = FileNaming.sessionDirName()
    let store = try CaptureFileStore(baseDirectory: tmp, sessionDirName: name)
    try store.writeSessionInfo(SessionInfo(sessionID: name, deviceModel: "cc", appVersion: "1", sampleRateHz: 5))
    let K = simd_float3x3(columns: (SIMD3<Float>(1000, 0, 0), SIMD3<Float>(0, 1000, 0), SIMD3<Float>(960, 720, 1)))
    for i in 0..<3 {
        var T = matrix_identity_float4x4
        T.columns.3 = SIMD4<Float>(Float(i) * 0.5, 0, 0, 1)
        let depth = BinaryEncoding.encodeDepth([Float](repeating: 2, count: 48))
        let conf = BinaryEncoding.encodeConfidence([UInt8](repeating: 2, count: 48))
        let meta = FrameMetadata(frameID: i, timestamp: Double(i) * 0.2, sessionTime: Double(i) * 0.2,
                                 transform: T, intrinsics: K, imageWidth: 1920, imageHeight: 1440,
                                 trackingState: .normal, depth: .init(width: 8, height: 6))
        try store.writeFrame(meta, rgbJPEG: Data([0xff, 0xd8, 0xff, 0xd9]), depth: depth, confidence: conf)
    }
    store.close()
    let metaURL = tmp.appendingPathComponent(name).appendingPathComponent("metadata.jsonl")
    let lines = try String(contentsOf: metaURL, encoding: .utf8).split(separator: "\n")
    check(lines.count == 3, "metadata.jsonl has 3 lines")
    let obj = try JSONSerialization.jsonObject(with: Data(lines[0].utf8)) as! [String: Any]
    check((obj["frame_id"] as? Int) == 0 && (obj["depth_format"] as? String) == "float32_le",
          "metadata record parses with contract fields")
    let dURL = tmp.appendingPathComponent(name).appendingPathComponent("depth/000000.f32")
    check((try Data(contentsOf: dURL)).count == 48 * 4, "depth file byte length")
}

print("== CaptureFileStore resume/append (continue session) ==")
do {
    let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("gz_rc_\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tmp) }
    let name = FileNaming.sessionDirName()
    let K = simd_float3x3(columns: (SIMD3<Float>(1000, 0, 0), SIMD3<Float>(0, 1000, 0), SIMD3<Float>(960, 720, 1)))
    func writeFrames(_ store: CaptureFileStore, _ ids: [Int]) throws {
        for i in ids {
            let meta = FrameMetadata(frameID: i, timestamp: Double(i) * 0.2, sessionTime: Double(i) * 0.2,
                                     transform: matrix_identity_float4x4, intrinsics: K,
                                     imageWidth: 1920, imageHeight: 1440, trackingState: .normal)
            try store.writeFrame(meta, rgbJPEG: Data([0xff, 0xd8, 0xff, 0xd9]), depth: nil, confidence: nil)
        }
    }
    // First segment: frames 0..2.
    let s1 = try CaptureFileStore(baseDirectory: tmp, sessionDirName: name)
    try s1.writeSessionInfo(SessionInfo(sessionID: name, deviceModel: "cc", appVersion: "1", sampleRateHz: 5))
    try writeFrames(s1, [0, 1, 2])
    s1.close()
    check(CaptureFileStore.maxFrameID(baseDirectory: tmp, sessionDirName: name) == 2, "maxFrameID after first segment == 2")

    // Resume: reopen and append frames 3..4 without truncating.
    let next = CaptureFileStore.maxFrameID(baseDirectory: tmp, sessionDirName: name) + 1
    check(next == 3, "resume starts at maxFrameID + 1")
    let s2 = try CaptureFileStore(resuming: tmp, sessionDirName: name)
    try writeFrames(s2, [next, next + 1])
    s2.close()

    let metaURL = tmp.appendingPathComponent(name).appendingPathComponent("metadata.jsonl")
    let lines = try String(contentsOf: metaURL, encoding: .utf8).split(separator: "\n")
    check(lines.count == 5, "metadata.jsonl appended (5 lines, not truncated)")
    let firstID = (try JSONSerialization.jsonObject(with: Data(lines[0].utf8)) as! [String: Any])["frame_id"] as? Int
    let lastID = (try JSONSerialization.jsonObject(with: Data(lines[4].utf8)) as! [String: Any])["frame_id"] as? Int
    check(firstID == 0 && lastID == 4, "original + resumed records both present (0..4)")
    check(CaptureFileStore.maxFrameID(baseDirectory: tmp, sessionDirName: name) == 4, "maxFrameID after resume == 4")

    // Resuming a non-existent session must throw (not silently create a new one).
    var threw = false
    do { _ = try CaptureFileStore(resuming: tmp, sessionDirName: "capture_nope_00000000") }
    catch { threw = true }
    check(threw, "resuming a missing session throws")
}

print("== KeyframeCoverage (Phase 3) ==")
do {
    // T3.1 — threshold-crossing fires exactly ONCE per voxel
    let kc = KeyframeCoverage(azBuckets: 12, cellSize: 0.12, enoughAngles: 5)
    var fires = 0
    for b in 0..<4 { if kc.observe(x: 0, y: 0, z: 0, bucket: b) { fires += 1 } }
    check(fires == 0, "no crossing before enoughAngles")
    let crossed = kc.observe(x: 0, y: 0, z: 0, bucket: 4)   // 5th distinct angle
    check(crossed, "crosses on the 5th distinct angle")
    var again = false
    for b in 5..<12 { if kc.observe(x: 0, y: 0, z: 0, bucket: b) { again = true } }
    check(!again, "never fires again for the same voxel")
    check(kc.observe(x: 0, y: 0, z: 0, bucket: 3) == false, "re-observing a filled bucket: no fire")
    check(kc.greenCount == 1 && kc.voxelCount == 1, "one green voxel tracked")

    // T3.2 — pose-novelty dedup: stationary emits 1, orbiting emits ~1 per step
    let kc2 = KeyframeCoverage(minTranslation: 0.15, minRotation: 0.26)
    func pose(tx: Float, angle: Float) -> simd_float4x4 {
        var m = simd_float4x4(simd_quatf(angle: angle, axis: SIMD3<Float>(0, 1, 0)))
        m.columns.3 = SIMD4<Float>(tx, 0, 0, 1); return m
    }
    check(kc2.acceptPoseNovelty(pose(tx: 0, angle: 0)), "first pose accepted")
    var stationary = 0
    for _ in 0..<10 { if kc2.acceptPoseNovelty(pose(tx: 0.01, angle: 0.01)) { stationary += 1 } }
    check(stationary == 0, "stationary camera emits no extra keyframes")
    var orbit = 0
    for i in 1...6 { if kc2.acceptPoseNovelty(pose(tx: 0, angle: Float(i) * 0.30)) { orbit += 1 } }
    check(orbit >= 5, "orbiting emits ~1 keyframe per angular step (got \(orbit))")

    // T3.3 — keyframe tag round-trips through the Core encoder/decoder
    var meta = FrameMetadata(frameID: 7, timestamp: 1.0, sessionTime: 0.0,
                             transform: matrix_identity_float4x4,
                             intrinsics: matrix_identity_float3x3,
                             imageWidth: 1920, imageHeight: 1440,
                             trackingState: .normal)
    meta.keyframe = true; meta.trigger = "threshold_crossing"
    let line = try meta.jsonLine()
    check(line.contains("\"keyframe\":true") && line.contains("\"threshold_crossing\""),
          "metadata jsonLine includes keyframe tag")
    let back = try JSONDecoder().decode(FrameMetadata.self, from: Data(line.utf8))
    check(back.keyframe == true && back.trigger == "threshold_crossing", "keyframe round-trips")
    // nil keyframe is OMITTED (backward-compatible wire format)
    let plain = FrameMetadata(frameID: 8, timestamp: 1.0, sessionTime: 0.0,
                              transform: matrix_identity_float4x4,
                              intrinsics: matrix_identity_float3x3,
                              imageWidth: 1920, imageHeight: 1440, trackingState: .normal)
    check(!(try plain.jsonLine()).contains("keyframe"), "nil keyframe omitted from JSON")

    // bulk_header carries the tag when present, omits when nil
    let hdr = NetworkProtocol.bulkHeader(sessionID: "s", frameID: 7, payloadType: .frameMetadata,
                                         sequence: 1, byteLength: 10, sha256: "ab",
                                         keyframe: true, trigger: "threshold_crossing")
    check((hdr["keyframe"] as? Bool) == true && (hdr["trigger"] as? String) == "threshold_crossing",
          "bulk_header includes keyframe tag")
    let hdr2 = NetworkProtocol.bulkHeader(sessionID: "s", frameID: 8, payloadType: .rgb,
                                          sequence: 2, byteLength: 10, sha256: "cd")
    check(hdr2["keyframe"] == nil, "bulk_header omits keyframe when nil")
}

print("")
if failures == 0 { print("ALL CORE CHECKS PASSED") }
else { print("\(failures) CHECK(S) FAILED"); exit(1) }
