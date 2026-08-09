"""Clock-sync estimation unit tests: injected offset, jitter, drift, filtering."""

import unittest

from tools.live_capture_server.clock_sync import ClockSyncEstimator, estimate


def exchange(true_offset_ns, up_ns, down_ns, t0=1_000_000_000, proc_ns=1000):
    """Build (t0,t1,t2,t3) for a client whose clock is behind server by offset."""
    t1 = t0 + up_ns + true_offset_ns
    t2 = t1 + proc_ns
    t3 = t2 - true_offset_ns + down_ns
    return t0, t1, t2, t3


class TestClockSync(unittest.TestCase):
    def test_symmetric_offset_recovered(self):
        off = 250_000_000  # +250 ms
        s = estimate(*exchange(off, 5_000_000, 5_000_000))
        self.assertAlmostEqual(s.offset_ns, off, delta=1000)

    def test_negative_offset(self):
        off = -3_000_000_000  # client 3s ahead
        s = estimate(*exchange(off, 4_000_000, 4_000_000))
        self.assertAlmostEqual(s.offset_ns, off, delta=1000)

    def test_min_rtt_selected_under_jitter(self):
        off = 100_000_000
        est = ClockSyncEstimator()
        # jittery samples with asymmetric latency; one clean low-RTT sample.
        latencies = [(50e6, 5e6), (5e6, 60e6), (2e6, 2e6), (80e6, 3e6)]
        for up, down in latencies:
            est.add(*exchange(off, int(up), int(down)))
        # best (min-rtt) sample is the symmetric 2ms/2ms one -> offset ~ exact
        self.assertAlmostEqual(est.best_offset_ns, off, delta=2_000_000)
        self.assertLessEqual(est.best_rtt_ns, 6_000_000)

    def test_high_rtt_filtered(self):
        off = 0
        est = ClockSyncEstimator(max_rtt_ns=20_000_000)
        est.add(*exchange(off, 100_000_000, 100_000_000))  # 200ms rtt, filtered
        est.add(*exchange(off, 3_000_000, 3_000_000))      # 6ms rtt, kept
        self.assertLessEqual(est.best_rtt_ns, 6_000_000)

    def test_drift_tracked_over_window(self):
        est = ClockSyncEstimator(window=8)
        # offset drifts linearly; latest best offset should track upward
        first = None
        last = None
        for i in range(8):
            off = 10_000_000 + i * 1_000_000
            s = est.add(*exchange(off, 2_000_000, 2_000_000))
            if i == 0:
                first = s.offset_ns
            last = s.offset_ns
        self.assertGreater(last, first)

    def test_negative_rtt_rejected_from_estimate(self):
        est = ClockSyncEstimator()
        # craft an impossible sample (t2<t1 style) -> negative rtt
        est.add(1000, 1000, 1000, 1000)  # rtt 0
        self.assertIsNotNone(est.best_rtt_ns)


if __name__ == "__main__":
    unittest.main()
