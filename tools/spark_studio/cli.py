"""The command. One video in, one .ply out.

    python -m spark_studio doctor
    python -m spark_studio walk.mp4 -o walk.ply
    python -m spark_studio walk.mp4 -o walk.ply --preset fast

No server, no browser, no account. This is the thing to run first when finding
out whether this machine can do it at all, because every failure it can hit is
a failure the server would have hit too - and here you can see the whole log.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from .doctor import render, report
from .pipeline import PipelineError, RunPaths, run
from .train import TrainConfig, latest_snapshot

_BAR = 34


def _progress_line(message: str, frac: float) -> None:
    """One line, rewritten in place. Falls back to plain lines when piped."""
    frac = max(0.0, min(1.0, frac))
    if not sys.stderr.isatty():
        print(f"  {round(frac * 100):3d}%  {message}", file=sys.stderr, flush=True)
        return
    filled = int(_BAR * frac)
    bar = "#" * filled + "." * (_BAR - filled)
    line = f"  [{bar}] {round(frac * 100):3d}%  {message}"
    sys.stderr.write("\r" + line.ljust(96)[:96])
    sys.stderr.flush()


def _human(seconds: float) -> str:
    if seconds < 90:
        return f"{seconds:.0f}s"
    minutes = seconds / 60
    if minutes < 60:
        return f"{minutes:.1f} min"
    return f"{minutes // 60:.0f}h {minutes % 60:.0f}m"


def _selftest(args) -> int:
    """Reconstruct a scene we generated, so a failure means the install.

    The scene has dense multi-scale texture and a camera that genuinely
    translates, so COLMAP should place every frame. If it does not, the problem
    is here rather than in anyone's footage - which is the whole reason this
    exists as a command.
    """
    import tempfile

    from .synth import render_video

    work = (
        Path(args.work).expanduser()
        if args.work
        else Path(tempfile.gettempdir()) / "spark_studio_selftest"
    )
    work.mkdir(parents=True, exist_ok=True)
    video = work / "synth.mp4"

    print("  Rendering a synthetic scene with known geometry...")
    # 6 fps, so 48 rendered frames become an 8-second clip. At 12 fps it is a
    # 4-second clip, and `choose_fps` caps sampling at 6 fps - so half the
    # frames we deliberately rendered were thrown away again before COLMAP saw
    # them. The cap is right for real footage; the synthetic clip has to be long
    # enough to live under it.
    render_video(video, n_frames=48, fps=6)
    print(f"  {video.name}  {video.stat().st_size / 1024:.0f} KB")
    print()

    cfg = TrainConfig.preset("fast")
    cfg.steps = args.steps or 4_000
    cfg.export_every = 1_000
    try:
        result = run(
            video,
            work / "run",
            train_config=cfg,
            target_frames=48,
            resume=not args.no_resume,
            progress=_progress_line,
        )
    except PipelineError as exc:
        if sys.stderr.isatty():
            sys.stderr.write("\r" + " " * 96 + "\r")
        print(f"\n  SELFTEST FAILED: {exc}\n", file=sys.stderr)
        return 1

    if sys.stderr.isatty():
        sys.stderr.write("\r" + " " * 96 + "\r")
    poses = result.poses or {}
    print()
    print(f"  poses    {poses.get('registered')}/{poses.get('total')} frames placed")
    if result.training:
        print(
            f"  splat    {result.training['bytes'] / (1024 * 1024):.1f} MB "
            f"at {result.training['iterations']:,} steps"
        )
    print(f"  result   {result.ply}")
    print()
    print("  This machine can reconstruct. Real footage will be slower and")
    print("  harder - this scene is deliberately easy - but the toolchain works.")
    print()
    return 0 if result.ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="spark_studio",
        description="Turn a video into a Gaussian splat on this machine.",
    )
    parser.add_argument(
        "video",
        nargs="?",
        help="The clip to reconstruct, or one of: doctor, serve, selftest",
    )
    parser.add_argument(
        "--port", type=int, default=8899, help="serve: port (default 8899)"
    )
    parser.add_argument(
        "--web", help="serve: path to the web/ directory to watch and publish into"
    )
    parser.add_argument(
        "--host", default="127.0.0.1",
        help="serve: bind address. 0.0.0.0 exposes it to the LAN, for a phone",
    )
    parser.add_argument(
        "--sessions",
        help="serve: where live sessions land. Must match the --root that "
             "tools/live_capture_server was started with, or frames arrive "
             "somewhere nothing reads",
    )
    parser.add_argument(
        "--capture-url", default="http://127.0.0.1:8765",
        help="serve: where tools/live_capture_server listens. Live capture is "
             "only offered when this answers, because it is what receives frames",
    )
    parser.add_argument("-o", "--out", help="Where to write the finished .ply")
    parser.add_argument(
        "-w", "--work",
        help="Working directory for frames, poses and snapshots "
             "(default: runs/<video name> beside the output)",
    )
    parser.add_argument(
        "--preset", choices=("fast", "balanced", "high"), default="balanced",
        help="fast = 10k steps/1280px, balanced = 30k/1600, high = 50k/1920",
    )
    parser.add_argument("--steps", type=int, help="Override the preset's step count")
    parser.add_argument(
        "--frames", type=int, default=150,
        help="Roughly how many frames to sample from the clip (default 150)",
    )
    parser.add_argument(
        "--max-frames", type=int, default=400,
        help="Hard cap on frames. Matching cost grows with this (default 400)",
    )
    parser.add_argument(
        "--sharp-keep", type=float, default=1.0,
        help="Fraction of frames to keep by relative sharpness. 1.0 keeps all "
             "(default). Lowering it punches holes in the sequence - see frames.py",
    )
    parser.add_argument(
        "--no-resume", action="store_true",
        help="Redo every stage even if its output is already on disk",
    )
    args = parser.parse_args(argv)

    # The verbs are spelled as the positional so the common case stays one word.
    if args.video in (None, "doctor"):
        tools = report()
        print(render(tools))
        return 0 if all(t.found for t in tools) else 1

    if args.video == "serve":
        from .server import serve

        # Default to the web/ beside this checkout, which is the arrangement
        # that actually happens - the studio runs next to the app it serves.
        web = (
            Path(args.web).expanduser()
            if args.web
            else Path(__file__).resolve().parents[2] / "web"
        )
        if not web.is_dir():
            print(f"No web directory at {web}. Pass --web.", file=sys.stderr)
            return 2
        work = Path(args.work).expanduser() if args.work else web.parent / ".studio"
        serve(
            web=web,
            work=work,
            port=args.port,
            preset=args.preset,
            host=args.host,
            sessions_root=Path(args.sessions).expanduser() if args.sessions else None,
            capture_url=args.capture_url,
        )
        return 0

    if args.video == "selftest":
        return _selftest(args)

    video = Path(args.video).expanduser()
    if not video.is_file():
        print(f"No such video: {video}", file=sys.stderr)
        return 2

    out = Path(args.out).expanduser() if args.out else video.with_suffix(".ply")
    work = (
        Path(args.work).expanduser()
        if args.work
        else out.parent / "runs" / video.stem
    )

    cfg = TrainConfig.preset(args.preset)
    if args.steps:
        cfg.steps = args.steps

    # Say what is about to happen BEFORE the long silence, including the honest
    # range - a person who knows it may take an hour will not kill it at minute six.
    print(f"  source     {video.name}")
    print(f"  work       {work}")
    print(f"  output     {out}")
    print(f"  preset     {args.preset} ({cfg.steps:,} steps at {cfg.max_resolution}px)")
    print()
    print("  Camera solving and training are both slow. On a laptop without CUDA")
    print("  expect roughly 30 minutes to 2 hours in total. Snapshots appear in")
    print(f"  {work / 'exports'} as training runs - you can open the newest at any time.")
    print()

    started = time.time()
    try:
        result = run(
            video,
            work,
            train_config=cfg,
            target_frames=args.frames,
            max_frames=args.max_frames,
            sharp_keep=args.sharp_keep,
            resume=not args.no_resume,
            progress=_progress_line,
        )
    except PipelineError as exc:
        if sys.stderr.isatty():
            sys.stderr.write("\r" + " " * 96 + "\r")
        print(f"\n  Stopped: {exc}\n", file=sys.stderr)
        # A partial run is worth naming - the expensive half may be reusable.
        paths = RunPaths(work)
        snap = latest_snapshot(paths.exports)
        if snap:
            print(f"  A partial splat did land: {snap}", file=sys.stderr)
        elif (paths.sparse_model / "cameras.txt").is_file():
            print(
                "  Camera poses did solve and are kept - rerunning will reuse them.",
                file=sys.stderr,
            )
        return 1

    if sys.stderr.isatty():
        sys.stderr.write("\r" + " " * 96 + "\r")

    from .pipeline import publish

    published = publish(result, out)
    elapsed = time.time() - started

    print()
    for w in result.warnings:
        print(f"  note: {w}")
    if result.poses:
        print(
            f"  poses      {result.poses['registered']}/{result.poses['total']} frames "
            f"placed via {result.poses['source']}"
        )
    if result.training:
        mb = result.training["bytes"] / (1024 * 1024)
        print(
            f"  training   {result.training['iterations']:,} steps, "
            f"{result.training['snapshots']} snapshots, {mb:.1f} MB"
        )
    print(f"  done       {published}  in {_human(elapsed)}")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
