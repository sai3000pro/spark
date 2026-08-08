#!/usr/bin/env python3
"""Simulate an ESP32 odometry source over the live-capture WebSocket protocol.

Emits synthetic timestamped odometry for a chosen path at a chosen rate, into
an existing (or new) server session.  The real ESP32 will speak the same
protocol.

Examples:
    python tools/live_capture_server/simulate_esp32.py \
        --host 127.0.0.1 --port 8765 --session sess_abc \
        --path circle --rate 20 --duration 10
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.live_capture_server.odometry_client import OdometryClient  # noqa: E402
from tools.live_capture_server.synth import odometry_payload  # noqa: E402

PATHS = ["stationary", "straight", "square", "circle", "random"]
RATES = [1, 10, 20, 50, 100]


def run(host, port, session_id, path, rate, duration, device_id,
        clock_sync=True, realtime=True):
    dt = 1.0 / rate
    n = int(duration * rate)
    client = OdometryClient(host, port, device_id=device_id)
    if not client.connect():
        raise SystemExit("odometry handshake rejected")
    if clock_sync:
        est = client.sync_clock(session_id, rounds=5)
        print(f"[esp32] clock offset ~{(est.best_offset_ns or 0)/1e6:.3f} ms "
              f"rtt ~{(est.best_rtt_ns or 0)/1e6:.3f} ms")
    start = time.time()
    for seq in range(n):
        payload = odometry_payload(path, seq, dt)
        device_time_us = int(seq * dt * 1e6)
        client.send(session_id, seq, device_time_us, payload)
        if realtime:
            target = start + (seq + 1) * dt
            slack = target - time.time()
            if slack > 0:
                time.sleep(slack)
    print(f"[esp32] sent {n} odometry msgs path={path} rate={rate}Hz "
          f"session={session_id}")
    client.close()


def main(argv=None):
    ap = argparse.ArgumentParser(description="ESP32 odometry simulator")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--session", required=True, help="server session_id to attach to")
    ap.add_argument("--path", choices=PATHS, default="circle")
    ap.add_argument("--rate", type=int, default=20, help="Hz")
    ap.add_argument("--duration", type=float, default=10.0, help="seconds")
    ap.add_argument("--device-id", default="esp32-sim-01")
    ap.add_argument("--no-clock-sync", action="store_true")
    ap.add_argument("--fast", action="store_true", help="send as fast as possible")
    args = ap.parse_args(argv)
    run(args.host, args.port, args.session, args.path, args.rate, args.duration,
        args.device_id, clock_sync=not args.no_clock_sync, realtime=not args.fast)


if __name__ == "__main__":
    main()
