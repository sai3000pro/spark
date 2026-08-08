import XCTest
@testable import GauzensplatCaptureCore

final class FrameSamplerTests: XCTestCase {

    private func countAccepted(_ sampler: FrameSampler, times: [Double]) -> Int {
        times.reduce(0) { $0 + (sampler.shouldSample(timestamp: $1) ? 1 : 0) }
    }

    func test5HzFrom60HzStream() {
        let s = FixedRateSampler(rateHz: 5)
        // 60 Hz for 2 s -> ~120 frames -> expect ~10 accepted (5 Hz * 2 s)
        let times = (0..<120).map { Double($0) / 60.0 }
        let n = countAccepted(s, times: times)
        XCTAssertTrue(n >= 9 && n <= 11, "got \(n)")
    }

    func test1Hz() {
        let s = FixedRateSampler(rateHz: 1)
        let times = (0..<60).map { Double($0) / 30.0 }  // 2 s at 30 Hz
        XCTAssertEqual(countAccepted(s, times: times), 2)
    }

    func test10Hz() {
        let s = FixedRateSampler(rateHz: 10)
        let times = (0..<100).map { Double($0) / 30.0 }  // ~3.3 s at 30 Hz
        let n = countAccepted(s, times: times)
        XCTAssertTrue(n >= 33 && n <= 35, "got \(n)")
    }

    func testFirstFrameAlwaysAccepted() {
        let s = FixedRateSampler(rateHz: 5)
        XCTAssertTrue(s.shouldSample(timestamp: 100.0))
    }

    func testNonMonotonicRejected() {
        let s = FixedRateSampler(rateHz: 5)
        XCTAssertTrue(s.shouldSample(timestamp: 10.0))
        XCTAssertFalse(s.shouldSample(timestamp: 9.5))   // goes backwards
        XCTAssertFalse(s.shouldSample(timestamp: 10.0))  // duplicate
    }

    func testLongPauseAcceptsNext() {
        let s = FixedRateSampler(rateHz: 5)
        XCTAssertTrue(s.shouldSample(timestamp: 0.0))
        XCTAssertFalse(s.shouldSample(timestamp: 0.05))
        XCTAssertTrue(s.shouldSample(timestamp: 30.0))   // after long pause
    }

    func testInvalidTimestampRejected() {
        let s = FixedRateSampler(rateHz: 5)
        XCTAssertFalse(s.shouldSample(timestamp: .nan))
        XCTAssertFalse(s.shouldSample(timestamp: .infinity))
    }

    func testResetClearsState() {
        let s = FixedRateSampler(rateHz: 5)
        _ = s.shouldSample(timestamp: 0.0)
        s.reset()
        XCTAssertTrue(s.shouldSample(timestamp: 0.01))  // accepted again after reset
    }
}
