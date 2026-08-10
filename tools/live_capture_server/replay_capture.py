#!/usr/bin/env python3
"""Replay a RECORDED capture over the live-capture protocol (frame-by-frame).

Unlike ``simulate_phone.py`` (which sends *synthetic* frames), this streams a real
on-disk capture — the exact rgb/depth/confidence bytes and ARKit metadata the phone
recorded — over the same WebSocket protocol (via ``PhoneClient``). It's the offline
stand-in for a phone on the network: use it to validate the whole ingest + ACK +
reconcile round-trip with realistic payload sizes before wiring up a real device.

Frames are streamed lazily from disk (bounded RSS — never loads the whole capture
into RAM), matching how the on-device coordinator behaves.

Example:
    python tools/live_capture_server/replay_capture.py ~/Downloads/capture_full \
        --host 127.0.0.1 --port 8899 --frames 30 --rate 8 --realtime
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Dict, Iterator, Optional

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.live_capture_server.client import Frame, PhoneClient  # noqa: E402


def _read_bytes(base: Path, rel: Optional[str]) -> Optional[bytes]:
    if not rel:
        return None
    p = base / rel
    try:
        return p.read_bytes()
    except OSError:
        return None


def iter_frames(capture_dir: Path, *, subsample: int = 1,
                limit: Optional[int] = None) -> Iterator[Frame]:
    """Yield Frame objects from a capture's metadata.jsonl, lazily loading bytes."""
    jsonl = capture_dir / "metadata.jsonl"
    if not jsonl.is_file():
        raise SystemExit(f"no metadata.jsonl in {capture_dir}")
    emitted = 0
    with open(jsonl, "r", encoding="utf-8") as fh:
        for idx, line in enumerate(fh):
            line = line.strip()
            if not line:
                continue
            if idx % subsample != 0:
                continue
            meta = json.loads(line)
            fid = int(meta["frame_id"])
            rgb = _read_bytes(capture_dir, meta.get("rgb_path"))
            if rgb is None:
                continue  # no image on disk -> not a usable frame
            depth = _read_bytes(capture_dir, meta.get("depth_path"))
            conf = _read_bytes(capture_dir, meta.get("confidence_path"))
            yield Frame(frame_id=fid, rgb=rgb, depth=depth, confidence=conf, metadata=meta)
            emitted += 1
            if limit is not None and emitted >= limit:
                return


def run(capture_dir, host, port, *, rate=8.0, realtime=True, subsample=1,
        limit=None, clock_sync=True, do_reconcile=True, device_session_id="dev-replay-0001",
        verbose=True):
    capture_dir = Path(capture_dir).expanduser()
    c = PhoneClient(host, port, device_session_id=device_session_id)
    if not c.connect():
        raise SystemExit("phone handshake rejected")
    sid = c.begin()
    if verbose:
        print(f"[replay] connected {host}:{port}  session_id={sid}")
    if clock_sync:
        est = c.sync_clock(5)
        if verbose:
            print(f"[replay] clock offset ~{(est.best_offset_ns or 0)/1e6:.2f} ms "
                  f"rtt ~{(est.best_rtt_ns or 0)/1e6:.2f} ms")

    all_frames: Dict[int, Frame] = {}
    dt = 1.0 / rate if rate > 0 else 0.0
    start = time.time()
    n = 0
    bytes_sent = 0
    t_first = None
    for fr in iter_frames(capture_dir, subsample=subsample, limit=limit):
        all_frames[fr.frame_id] = fr
        res = c.send_frame(fr)
        n += 1
        bytes_sent += len(fr.rgb) + (len(fr.depth) if fr.depth else 0) + \
            (len(fr.confidence) if fr.confidence else 0)
        if t_first is None:
            t_first = time.time()
        if verbose and (n <= 3 or n % 25 == 0):
            statuses = ",".join(f"{k.split('_')[-1]}={v}" for k, v in res.items())
            print(f"[replay] frame {fr.frame_id:>5}  acked[{statuses}]  "
                  f"sent={n}  {bytes_sent/1e6:.1f} MB")
        if realtime and dt:
            target = start + n * dt
            slack = target - time.time()
            if slack > 0:
                time.sleep(slack)

    elapsed = max(1e-6, time.time() - start)
    eff_hz = n / elapsed
    print(f"[replay] streamed {n} frames, {bytes_sent/1e6:.1f} MB in {elapsed:.1f}s "
          f"({eff_hz:.1f} fps, {bytes_sent/1e6/elapsed:.1f} MB/s)")

    result = None
    if do_reconcile:
        result = c.reconcile(all_frames)
        c.finalize()
        print(f"[replay] reconcile: local={result['local_frames']} "
              f"server={result['server_frames']} missing={len(result['missing'])} "
              f"checksum_failures={len(result['checksum_failures'])} "
              f"complete={result['complete']} retries={c.retries}")
    c.close()
    return sid, result


def main(argv=None):
    ap = argparse.ArgumentParser(description="Replay a recorded capture over the wire")
    ap.add_argument("capture", help="capture dir (has session.json + metadata.jsonl)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8899)
    ap.add_argument("--rate", type=float, default=8.0, help="target frames/sec")
    ap.add_argument("--frames", type=int, default=None, help="limit number of frames")
    ap.add_argument("--subsample", type=int, default=1, help="send every Nth frame")
    ap.add_argument("--no-realtime", action="store_true", help="stream as fast as possible")
    ap.add_argument("--no-clock-sync", action="store_true")
    ap.add_argument("--no-reconcile", action="store_true")
    args = ap.parse_args(argv)
    sid, result = run(args.capture, args.host, args.port, rate=args.rate,
                      realtime=not args.no_realtime, subsample=args.subsample,
                      limit=args.frames, clock_sync=not args.no_clock_sync,
                      do_reconcile=not args.no_reconcile)
    print(f"session_id={sid}")
    if result is not None and not result["complete"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
