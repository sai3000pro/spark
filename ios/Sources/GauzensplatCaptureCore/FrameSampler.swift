import Foundation

/// Frame-sampling policy.  START with fixed-rate; the protocol is designed so a
/// future policy (translation / rotation / blur / coverage / tracking quality)
/// drops in without touching the recorder or storage.
public protocol FrameSampler: AnyObject {
    /// Called for every ARFrame timestamp (seconds).  Return true to KEEP.
    func shouldSample(timestamp: TimeInterval) -> Bool
    func reset()
}

/// Keep at most `rateHz` frames/second, based on ARFrame timestamps (never
/// wall-clock — handles irregular timestamps and long pauses gracefully).
public final class FixedRateSampler: FrameSampler {
    public let rateHz: Double
    private let interval: TimeInterval
    private var lastAccepted: TimeInterval?

    public init(rateHz: Double) {
        precondition(rateHz > 0, "rateHz must be > 0")
        self.rateHz = rateHz
        self.interval = 1.0 / rateHz
    }

    public func shouldSample(timestamp: TimeInterval) -> Bool {
        guard timestamp.isFinite else { return false }
        guard let last = lastAccepted else {
            lastAccepted = timestamp
            return true
        }
        // Guard against non-monotonic / duplicate timestamps.
        if timestamp <= last { return false }
        if timestamp - last + 1e-9 >= interval {
            lastAccepted = timestamp
            return true
        }
        return false
    }

    public func reset() { lastAccepted = nil }
}
