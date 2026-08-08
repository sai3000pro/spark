import Foundation

/// Client-side NTP-like clock offset / RTT estimation (mirrors the Python
/// `clock_sync.py`).  Times are nanoseconds.  Reports the offset from the
/// minimum-RTT sample to down-weight jitter.  Raw device timestamps are never
/// mutated — this only produces an estimate for later alignment.
public struct ClockSample {
    public let t0, t1, t2, t3: Int64
    public let rttNs: Int64
    public let offsetNs: Double
}

public final class ClockSyncEstimator {
    private var samples: [ClockSample] = []
    public let window: Int
    public let maxRttNs: Int64?

    public init(window: Int = 32, maxRttNs: Int64? = nil) {
        self.window = window
        self.maxRttNs = maxRttNs
    }

    @discardableResult
    public func add(t0: Int64, t1: Int64, t2: Int64, t3: Int64) -> ClockSample {
        let rtt = (t3 - t0) - (t2 - t1)
        let offset = Double((t1 - t0) + (t2 - t3)) / 2.0
        let s = ClockSample(t0: t0, t1: t1, t2: t2, t3: t3, rttNs: rtt, offsetNs: offset)
        samples.append(s)
        if samples.count > window { samples.removeFirst(samples.count - window) }
        return s
    }

    private var usable: [ClockSample] {
        let good = samples.filter { $0.rttNs >= 0 }
        if let m = maxRttNs {
            let f = good.filter { $0.rttNs <= m }
            if !f.isEmpty { return f }
        }
        return good
    }

    public var bestOffsetNs: Double? { usable.min(by: { $0.rttNs < $1.rttNs })?.offsetNs }
    public var bestRttNs: Int64? { usable.map { $0.rttNs }.min() }
    public var sampleCount: Int { samples.count }
}
