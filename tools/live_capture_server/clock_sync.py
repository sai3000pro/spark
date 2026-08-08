"""NTP-like clock offset / RTT estimation.

An exchange:
    t0_client  -- client send
    t1_server  -- server receive
    t2_server  -- server respond
    t3_client  -- client receive

    rtt    = (t3 - t0) - (t2 - t1)
    offset = ((t1 - t0) + (t2 - t3)) / 2      # add to client clock -> server

All times are nanoseconds.  We keep a bounded window of samples and report the
offset from the *minimum-RTT* sample (the least network-delayed, most accurate),
which naturally down-weights jittery/high-latency samples.  Raw device
timestamps are never mutated — this only produces an estimate.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Deque, List, Optional


def estimate(t0: int, t1: int, t2: int, t3: int) -> "Sample":
    rtt = (t3 - t0) - (t2 - t1)
    offset = ((t1 - t0) + (t2 - t3)) / 2.0
    return Sample(t0=t0, t1=t1, t2=t2, t3=t3, rtt_ns=rtt, offset_ns=offset)


@dataclass
class Sample:
    t0: int
    t1: int
    t2: int
    t3: int
    rtt_ns: int
    offset_ns: float


class ClockSyncEstimator:
    def __init__(self, window: int = 32, max_rtt_ns: Optional[int] = None):
        self.window = window
        self.max_rtt_ns = max_rtt_ns
        self.samples: Deque[Sample] = deque(maxlen=window)

    def add(self, t0: int, t1: int, t2: int, t3: int) -> Sample:
        s = estimate(t0, t1, t2, t3)
        # Reject obviously bad (negative rtt) or over-threshold samples for the
        # estimate, but still record for diagnostics.
        self.samples.append(s)
        return s

    def _usable(self) -> List[Sample]:
        good = [s for s in self.samples if s.rtt_ns >= 0]
        if self.max_rtt_ns is not None:
            filt = [s for s in good if s.rtt_ns <= self.max_rtt_ns]
            if filt:
                return filt
        return good

    @property
    def best_offset_ns(self) -> Optional[float]:
        usable = self._usable()
        if not usable:
            return None
        best = min(usable, key=lambda s: s.rtt_ns)
        return best.offset_ns

    @property
    def best_rtt_ns(self) -> Optional[int]:
        usable = self._usable()
        if not usable:
            return None
        return min(s.rtt_ns for s in usable)

    @property
    def sample_count(self) -> int:
        return len(self.samples)
