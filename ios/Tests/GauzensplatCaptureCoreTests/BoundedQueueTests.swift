import XCTest
@testable import GauzensplatCaptureCore

final class BoundedQueueTests: XCTestCase {

    func testEnqueueDequeueOrder() {
        let q = BoundedFrameQueue<Int>(capacity: 8)
        for i in 0..<5 { XCTAssertTrue(q.enqueue(i)) }
        var out = [Int]()
        for _ in 0..<5 { out.append(q.dequeue()!) }
        XCTAssertEqual(out, [0, 1, 2, 3, 4])
    }

    func testBackpressureDrops() {
        let q = BoundedFrameQueue<Int>(capacity: 3)
        XCTAssertTrue(q.enqueue(1))
        XCTAssertTrue(q.enqueue(2))
        XCTAssertTrue(q.enqueue(3))
        XCTAssertFalse(q.enqueue(4))   // full -> dropped
        XCTAssertFalse(q.enqueue(5))
        XCTAssertEqual(q.droppedCount, 2)
        XCTAssertEqual(q.enqueuedCount, 3)
        XCTAssertEqual(q.requestedCount, 5)
    }

    func testRecoveryAfterDrain() {
        let q = BoundedFrameQueue<Int>(capacity: 2)
        XCTAssertTrue(q.enqueue(1))
        XCTAssertTrue(q.enqueue(2))
        XCTAssertFalse(q.enqueue(3))   // dropped
        _ = q.dequeue()                // free a slot
        XCTAssertTrue(q.enqueue(4))    // accepted again
        XCTAssertEqual(q.count, 2)
    }

    func testConcurrentProducerConsumerBounded() {
        let q = BoundedFrameQueue<Int>(capacity: 16)
        let consumed = NSMutableArray()
        let worker = Thread {
            while let v = q.dequeue() { consumed.add(v) }
        }
        worker.start()
        // Producer much faster than a bounded queue can hold -> some drops, no crash.
        for i in 0..<10_000 { _ = q.enqueue(i) }
        // give the consumer a moment, then close to drain+exit
        Thread.sleep(forTimeInterval: 0.2)
        q.close()
        Thread.sleep(forTimeInterval: 0.1)
        XCTAssertLessThanOrEqual(q.count, 16)
        XCTAssertEqual(q.enqueuedCount + q.droppedCount, q.requestedCount)
        XCTAssertEqual(q.requestedCount, 10_000)
    }
}
