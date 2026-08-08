import XCTest
@testable import GauzensplatCaptureCore

final class ClockSyncTests: XCTestCase {

    private func exchange(_ off: Int64, _ up: Int64, _ down: Int64,
                          t0: Int64 = 1_000_000_000, proc: Int64 = 1000)
        -> (Int64, Int64, Int64, Int64) {
        let t1 = t0 + up + off
        let t2 = t1 + proc
        let t3 = t2 - off + down
        return (t0, t1, t2, t3)
    }

    func testSymmetricOffset() {
        let est = ClockSyncEstimator()
        let (a, b, c, d) = exchange(250_000_000, 5_000_000, 5_000_000)
        let s = est.add(t0: a, t1: b, t2: c, t3: d)
        XCTAssertEqual(s.offsetNs, 250_000_000, accuracy: 2000)
        XCTAssertEqual(s.rttNs, 10_000_000, accuracy: 2000)
    }

    func testMinRttSelectedUnderJitter() {
        let est = ClockSyncEstimator()
        let off: Int64 = 100_000_000
        let lats: [(Int64, Int64)] = [(50_000_000, 5_000_000), (5_000_000, 60_000_000),
                                      (2_000_000, 2_000_000), (80_000_000, 3_000_000)]
        for (up, down) in lats {
            let (a, b, c, d) = exchange(off, up, down)
            est.add(t0: a, t1: b, t2: c, t3: d)
        }
        XCTAssertEqual(est.bestOffsetNs!, Double(off), accuracy: 2_000_000)
        XCTAssertLessThanOrEqual(est.bestRttNs!, 6_000_000)
    }

    func testHighRttFiltered() {
        let est = ClockSyncEstimator(maxRttNs: 20_000_000)
        var (a, b, c, d) = exchange(0, 100_000_000, 100_000_000)
        est.add(t0: a, t1: b, t2: c, t3: d)     // 200 ms rtt, filtered
        (a, b, c, d) = exchange(0, 3_000_000, 3_000_000)
        est.add(t0: a, t1: b, t2: c, t3: d)     // 6 ms rtt, kept
        XCTAssertLessThanOrEqual(est.bestRttNs!, 6_000_000)
    }
}
