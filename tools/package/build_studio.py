"""Freeze the studio into one file somebody can download and run.

    .venv-splat/Scripts/python tools/package/build_studio.py

Produces `dist/spark-studio.exe` (or `dist/spark-studio` elsewhere): a single
file containing Python, numpy, pycolmap, ffmpeg and brush-cli, which turns a
video into a .ply and can upload the result straight into the app.

WHY THIS EXISTS AT ALL
    Everything the studio needs is already pip-installable, and that is still
    four steps too many. The audience for local reconstruction is not people who
    keep a Python 3.12 and a Rust toolchain around - it is people who have a
    video and a laptop, and for whom "create a virtualenv" is where the project
    ends. A download that runs is the difference between a capability and a
    README.

WHY ONE FILE, KNOWING THE COST
    A --onefile build unpacks itself into a temporary directory on every run,
    and at this size that is a real pause - seconds, sometimes more on a slow
    disk, before anything is printed. A --onedir build starts instantly and is
    a folder of six hundred files, which is what people zip up wrong, move half
    of, and then report as broken.

    The pause is paid once against a job that runs for tens of minutes, so it
    rounds to nothing where it lands. `doctor` pays it for a two-second answer,
    which is the one place it is annoying, and that is an acceptable trade for
    never having to explain a directory layout.

WHAT IS NOT SOLVED HERE
    Code signing. On Windows this .exe is unsigned, so SmartScreen will warn
    about it, and on macOS Gatekeeper will refuse it outright until it is
    notarised. Both need a paid developer identity and neither can be faked, so
    the honest position is that this is the build, and shipping it publicly
    needs a certificate first. See the README section this writes about.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools"
NAME = "spark-studio"


def _fail(message: str) -> None:
    print(f"\n  {message}\n", file=sys.stderr)
    raise SystemExit(1)


def locate_binaries() -> list[tuple[Path, str]]:
    """The two native executables that must travel inside the bundle.

    Resolved by asking the same code the studio uses at runtime, so a build can
    never quietly ship a different ffmpeg than the one `doctor` reported green.
    """
    sys.path.insert(0, str(TOOLS))
    from spark_studio.doctor import check_brush, check_ffmpeg  # noqa: E402

    found: list[tuple[Path, str]] = []

    ff = check_ffmpeg()
    if not ff.found or not ff.path:
        _fail(
            "ffmpeg is not available, so it cannot be bundled.\n"
            "  pip install imageio-ffmpeg"
        )
    found.append((Path(ff.path), "ffmpeg"))

    brush = check_brush()
    if not brush.found or not brush.path:
        _fail(
            "brush-cli is not available, so it cannot be bundled.\n"
            "  Build it from github.com/ArthurBrussee/brush, or drop the binary\n"
            "  in .venv-splat/bin/ - see tools/spark_studio/README.md."
        )
    found.append((Path(brush.path), "brush-cli"))

    return found


def write_entry(build_dir: Path) -> Path:
    """A launcher, because PyInstaller freezes a script rather than a module.

    `python -m spark_studio` goes through __main__.py, which is not a path
    PyInstaller can be pointed at. This is the same two lines with a filename.
    """
    entry = build_dir / "studio_entry.py"
    entry.write_text(
        '"""Entry point for the frozen studio. See tools/package/build_studio.py."""\n'
        "import multiprocessing\n"
        "import sys\n"
        "\n"
        "from spark_studio.cli import main\n"
        "\n"
        "if __name__ == '__main__':\n"
        "    # Without this a frozen child process re-runs the whole CLI instead\n"
        "    # of starting a worker, which on Windows forks bombs. Harmless when\n"
        "    # nothing spawns; catastrophic the one time something does.\n"
        "    multiprocessing.freeze_support()\n"
        "    sys.exit(main())\n",
        encoding="utf-8",
    )
    return entry


def main() -> int:
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        _fail("PyInstaller is not installed.\n  pip install pyinstaller")

    build_dir = ROOT / "build" / "studio"
    build_dir.mkdir(parents=True, exist_ok=True)
    entry = write_entry(build_dir)
    binaries = locate_binaries()

    print("  bundling:")
    total = 0
    for src, as_name in binaries:
        size = src.stat().st_size
        total += size
        print(f"    {as_name:12} {size / 1048576:7.1f} MB  {src}")

    args = [
        sys.executable, "-m", "PyInstaller",
        str(entry),
        "--name", NAME,
        "--onefile",
        "--console",
        "--noconfirm",
        "--clean",
        "--distpath", str(ROOT / "dist"),
        "--workpath", str(build_dir / "work"),
        "--specpath", str(build_dir),
        "--paths", str(TOOLS),
        # pycolmap is a native extension with its own DLLs beside it; the
        # generic analysis finds the .pyd and misses what it links against.
        "--collect-all", "pycolmap",
        "--collect-submodules", "spark_studio",
        # Imported lazily inside functions, so static analysis does not see them.
        "--hidden-import", "spark_studio.server",
        "--hidden-import", "spark_studio.synth",
        "--hidden-import", "spark_studio.push",
    ]
    for src, as_name in binaries:
        # `.` puts them at the root of the unpack directory, which is exactly
        # where doctor.bundled_dir() looks.
        args += ["--add-binary", f"{src}{os.pathsep}."]

    # Nothing here draws a window or plots anything. These get pulled in
    # transitively and cost tens of megabytes in a download people wait on.
    for mod in ("tkinter", "matplotlib", "IPython", "pytest", "setuptools", "pip"):
        args += ["--exclude-module", mod]

    print(f"\n  running PyInstaller ({total / 1048576:.0f} MB of binaries to embed)...\n")
    result = subprocess.run(args, cwd=ROOT)
    if result.returncode != 0:
        _fail("PyInstaller failed. The output above says why.")

    exe = ROOT / "dist" / (f"{NAME}.exe" if sys.platform == "win32" else NAME)
    if not exe.is_file():
        _fail(f"PyInstaller reported success but {exe} is not there.")

    print()
    print(f"  built    {exe}")
    print(f"  size     {exe.stat().st_size / 1048576:.0f} MB")
    print()
    print("  Verify it before shipping it - a frozen build fails in ways the")
    print("  checkout never does, and only running it proves otherwise:")
    print(f"    {exe.name} doctor")
    print(f"    {exe.name} selftest")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
