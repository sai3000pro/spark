"""What this machine can actually run, measured rather than assumed.

Every other module in this package depends on a binary or a wheel that may not
be here, and the failure modes are otherwise miserable: ffmpeg missing looks
like "0 frames extracted", brush missing looks like a job that never finishes.
So the first thing anything does is ask this module, and this module only ever
reports what it has actually seen.

MEASURED, NEVER INFERRED. `found` is set by importing the module or running the
binary with `--version`, not by checking whether a path exists. A stale
`brush-cli.exe` from a failed build is a file that exists and cannot run, and
telling someone their trainer is installed when it segfaults is precisely the
class of lie this repository is organised against.
"""

from __future__ import annotations

import importlib
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# Where `cargo install --root .venv-splat` puts a binary, so a project-local
# install is found without touching the user's PATH.
_VENV = Path(__file__).resolve().parents[2] / ".venv-splat"
_LOCAL_BIN = [_VENV / "bin", _VENV / "Scripts"]


@dataclass
class Tool:
    """One dependency, and the truth about it."""

    name: str
    found: bool
    #: Version string or path — whatever identifies WHICH one we found.
    detail: str
    #: What a person types to fix it. Empty when nothing is wrong.
    fix: str
    #: Absolute path to the executable, when this is a binary we resolved.
    path: Optional[str] = None


def _run_version(exe: str, *args: str) -> Optional[str]:
    """Actually run it. A binary that cannot start is a binary we do not have."""
    try:
        out = subprocess.run(
            [exe, *args], capture_output=True, text=True, timeout=30
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0 and not (out.stdout or out.stderr):
        return None
    return (out.stdout or out.stderr).strip().splitlines()[0] if (out.stdout or out.stderr) else ""


def find_executable(name: str) -> Optional[str]:
    """PATH, then the project venv. Never a bare path guess."""
    hit = shutil.which(name)
    if hit:
        return hit
    for d in _LOCAL_BIN:
        for candidate in (d / name, d / f"{name}.exe"):
            if candidate.is_file():
                return str(candidate)
    return None


def check_ffmpeg() -> Tool:
    """imageio-ffmpeg first: it ships its own binary, so pip alone is enough."""
    try:
        import imageio_ffmpeg

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        ver = _run_version(exe, "-version")
        if ver is not None:
            return Tool("ffmpeg", True, f"{ver.split(' Copyright')[0]} (bundled)", "", exe)
    except Exception:
        pass

    exe = find_executable("ffmpeg")
    if exe:
        ver = _run_version(exe, "-version")
        if ver is not None:
            return Tool("ffmpeg", True, ver.split(" Copyright")[0], "", exe)

    return Tool(
        "ffmpeg", False, "not found",
        "pip install imageio-ffmpeg   (ships its own binary — no system install)",
    )


def check_pycolmap() -> Tool:
    """Stage 2. A wheel, not a C++ build — Windows/macOS/Linux all have one."""
    try:
        m = importlib.import_module("pycolmap")
    except Exception as exc:
        return Tool(
            "pycolmap", False, f"import failed: {type(exc).__name__}",
            "pip install pycolmap",
        )
    ver = getattr(m, "__version__", "unknown")
    # The functions we actually call. A wheel that imports but lacks these is a
    # version we cannot drive, and finding that out mid-run wastes the extraction.
    missing = [f for f in ("extract_features", "match_sequential", "incremental_mapping")
               if not hasattr(m, f)]
    if missing:
        return Tool(
            "pycolmap", False, f"{ver} — missing {', '.join(missing)}",
            "pip install --upgrade pycolmap   (need >= 3.10 for this API)",
        )
    return Tool("pycolmap", True, ver, "")


def check_brush() -> Tool:
    """Stage 3. Rust + wgpu, so no CUDA and no NVIDIA requirement."""
    exe = find_executable("brush-cli")
    if not exe:
        return Tool(
            "brush-cli", False, "not found",
            "cargo install --path apps/brush-cli --root .venv-splat "
            "  (from a clone of github.com/ArthurBrussee/brush; needs Rust >= 1.85)",
        )
    # `--help` rather than `--version`: brush-cli takes an optional positional
    # source, so a bare invocation would try to train nothing.
    ver = _run_version(exe, "--help")
    if ver is None:
        return Tool(
            "brush-cli", False, f"{exe} exists but will not run",
            "Rebuild it — a partial `cargo install` leaves an unrunnable file behind.",
            exe,
        )
    return Tool("brush-cli", True, exe, "", exe)


def report() -> list[Tool]:
    """All three, in pipeline order."""
    return [check_ffmpeg(), check_pycolmap(), check_brush()]


def render(tools: list[Tool]) -> str:
    """The report a person reads. Missing things carry their own fix."""
    width = max(len(t.name) for t in tools)
    lines = []
    for t in tools:
        mark = "ok  " if t.found else "MISS"
        lines.append(f"  [{mark}] {t.name.ljust(width)}  {t.detail}")
        if not t.found:
            lines.append(f"         -> {t.fix}")
    missing = [t for t in tools if not t.found]
    lines.append("")
    if missing:
        stages = {"ffmpeg": "read the video", "pycolmap": "solve camera poses",
                  "brush-cli": "train the splat"}
        cannot = ", ".join(stages.get(t.name, t.name) for t in missing)
        lines.append(f"  Cannot {cannot}. Nothing will be attempted until that is fixed.")
    else:
        lines.append("  All three stages can run on this machine.")
    return "\n".join(lines)


def ready() -> bool:
    return all(t.found for t in report())


if __name__ == "__main__":
    print(render(report()))
