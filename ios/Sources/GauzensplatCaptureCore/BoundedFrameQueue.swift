import Foundation

/// Thread-safe bounded FIFO for pending writer work.
///
/// Backpressure: when full, `enqueue` DROPS the new item and increments
/// `droppedCount` (never grows RAM without bound).  Tracks requested/enqueued
/// counters for the debug UI + session summary.
public final class BoundedFrameQueue<Element> {
    public let capacity: Int
    private var items: [Element] = []
    private let lock = NSCondition()
    private var closed = false

    public private(set) var requestedCount = 0
    public private(set) var droppedCount = 0
    public private(set) var enqueuedCount = 0

    public init(capacity: Int) {
        precondition(capacity > 0)
        self.capacity = capacity
        items.reserveCapacity(capacity)
    }

    /// Returns true if accepted, false if dropped due to backpressure.
    @discardableResult
    public func enqueue(_ element: Element) -> Bool {
        lock.lock(); defer { lock.unlock() }
        requestedCount += 1
        if items.count >= capacity {
            droppedCount += 1
            return false
        }
        items.append(element)
        enqueuedCount += 1
        lock.signal()
        return true
    }

    /// Blocking dequeue for a serial worker.  Returns nil once closed & drained.
    public func dequeue() -> Element? {
        lock.lock(); defer { lock.unlock() }
        while items.isEmpty && !closed {
            lock.wait()
        }
        if items.isEmpty { return nil }
        return items.removeFirst()
    }

    public var count: Int {
        lock.lock(); defer { lock.unlock() }
        return items.count
    }

    /// Signal no more items; wakes a waiting worker so it can drain and exit.
    public func close() {
        lock.lock(); defer { lock.unlock() }
        closed = true
        lock.broadcast()
    }
}
