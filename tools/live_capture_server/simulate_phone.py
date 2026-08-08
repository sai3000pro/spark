#!/usr/bin/env python3
"""Simulate the iPhone recorder over the live-capture protocol.

Emits the SAME network protocol as the iOS app (via PhoneClient), so the whole
server + reconciliation path can be tested before any device is available.

Examples:
    python tools/live_capture_server/simulate_phone.py --host 127.0.0.1 \
        --port 8765 --frames 100 --rate 5 --disconnect-after 40 --reconnect-after 1
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.arkit_capture.formats import sha256_hex  # noqa: E402
from tools.live_capture_server import protocol  # noqa: E402
from tools.live_capture_server.client import PhoneClient  # noqa: E402
from tools.live_capture_server.synth import synth_frame  # noqa: E402


def run(host, port, frames=100, rate=5.0, *, depth_w=16, depth_h=12,
        disconnect_after=None, reconnect_after=0.5, corrupt_every=None,
        duplicate_every=None, latency=0.0, clock_sync=True, realtime=False,
        device_session_id="dev-sim-0001"):
    c = PhoneClient(host, port, device_session_id=device_session_id)
    if not c.connect():
        raise SystemExit("phone handshake rejected")
    c.begin()
    if clock_sync:
        est = c.sync_clock(5)
        print(f"[phone] clock offset ~{(est.best_offset_ns or 0)/1e6:.3f} ms "
              f"rtt ~{(est.best_rtt_ns or 0)/1e6:.3f} ms")

    all_frames = {}
    dt = 1.0 / rate
    start = time.time()
    for i in range(frames):
        fr = synth_frame(i, rate_hz=rate, depth_w=depth_w, depth_h=depth_h)
        all_frames[i] = fr

        if disconnect_after is not None and i == disconnect_after:
            print(f"[phone] simulating disconnect at frame {i}")
            c.ws.close()
            time.sleep(reconnect_after)
            if not c.reconnect():
                raise SystemExit("reconnect failed")
            print("[phone] reconnected + resumed session")

        # corruption injection: one bad send (NACK) then correct via send_frame
        if corrupt_every and i > 0 and i % corrupt_every == 0:
            bad = protocol.bulk_header(c.session_id, i, protocol.PT_DEPTH, -1,
                                       len(fr.depth), "00" * 32)
            try:
                c.ws.send_text(json.dumps(bad))
                c.ws.send_binary(fr.depth)
                json.loads(c.ws.recv_text())  # NACK
            except Exception:
                c.reconnect()

        c.send_frame(fr)

        if duplicate_every and i > 0 and i % duplicate_every == 0:
            c.send_payload(i, protocol.PT_RGB, fr.rgb)  # idempotent duplicate

        if latency:
            time.sleep(latency)
        elif realtime:
            target = start + (i + 1) * dt
            slack = target - time.time()
            if slack > 0:
                time.sleep(slack)

    result = c.reconcile(all_frames)
    c.finalize()
    print(f"[phone] reconcile: local={result['local_frames']} "
          f"server={result['server_frames']} missing={len(result['missing'])} "
          f"checksum_failures={len(result['checksum_failures'])} "
          f"complete={result['complete']} retries={c.retries}")
    sid = c.session_id
    c.close()
    return sid, result


def main(argv=None):
    ap = argparse.ArgumentParser(description="iPhone recorder simulator")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--frames", type=int, default=100)
    ap.add_argument("--rate", type=float, default=5.0)
    ap.add_argument("--depth-w", type=int, default=16)
    ap.add_argument("--depth-h", type=int, default=12)
    ap.add_argument("--disconnect-after", type=int, default=None)
    ap.add_argument("--reconnect-after", type=float, default=0.5)
    ap.add_argument("--corrupt-every", type=int, default=None)
    ap.add_argument("--duplicate-every", type=int, default=None)
    ap.add_argument("--latency", type=float, default=0.0, help="per-frame delay (s)")
    ap.add_argument("--no-clock-sync", action="store_true")
    ap.add_argument("--realtime", action="store_true")
    args = ap.parse_args(argv)
    sid, result = run(args.host, args.port, args.frames, args.rate,
                      depth_w=args.depth_w, depth_h=args.depth_h,
                      disconnect_after=args.disconnect_after,
                      reconnect_after=args.reconnect_after,
                      corrupt_every=args.corrupt_every,
                      duplicate_every=args.duplicate_every, latency=args.latency,
                      clock_sync=not args.no_clock_sync, realtime=args.realtime)
    print(f"session_id={sid}")
    return 0 if result["complete"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
