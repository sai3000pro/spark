"""Hand a finished .ply to a running Spark app.

The last step of the local route, and the one that decides whether the studio
is a tool or a chore. Without it the pipeline ends with a file on a desktop and
an instruction to go and find it; with it, `--push` means the capture is in the
app before the terminal has finished scrolling.

WHY urllib AND NOT requests
    This module gets frozen into a one-file executable. Every dependency is
    weight in a download somebody waits on, and `requests` brings urllib3,
    certifi and charset-normalizer for one POST that talks to localhost. The
    stdlib does it in forty lines.

WHY THE RAW BODY AND NOT MULTIPART
    Multipart means building a MIME envelope around a file that can be a
    gigabyte, which either buffers it in memory or needs a chunked encoder
    written by hand. The upload route accepts a raw body with the filename in a
    header for exactly this reason - see its "Two shapes, one handler" note - so
    the file object is handed to urllib and streamed off disk.

WHAT IT WILL NOT DO
    Silently swallow the outcome. A push that fails still leaves the .ply where
    it was written and says so with the path, because the reconstruction is the
    expensive artefact and the upload is a convenience on top of it. Losing a
    web request is a nuisance; letting someone believe an hour of training got
    somewhere it did not is not.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

# Local uploads over a fast link, but a 900 MB splat onto a busy dev server is
# not instant. Generous enough not to sever a working transfer.
TIMEOUT_SECONDS = 900.0


# The app writes for a browser, where an em-dash is free. This is a Windows
# console, where cp1252 turns one into a replacement glyph in the middle of an
# error message - which is how "re-export it as binary" arrived as garbage the
# first time it was shown. Folded on the way in rather than at the print, so
# every caller gets a string that survives whatever stream it lands on.
_ASCII_FOLD = {
    0x2014: "-", 0x2013: "-", 0x2012: "-", 0x2010: "-", 0x2011: "-",
    0x2018: "'", 0x2019: "'", 0x201C: '"', 0x201D: '"',
    0x2026: "...", 0x00A0: " ", 0x2022: "*", 0x00B7: "-",
    0x2192: "->", 0x00D7: "x",
}


def terminal_safe(text: str) -> str:
    """Fold typographic punctuation to ASCII, then drop anything still exotic."""
    folded = text.translate(_ASCII_FOLD)
    # Belt and braces: an unforeseen character should degrade, never raise.
    return folded.encode("ascii", "replace").decode("ascii")


class PushError(Exception):
    """The splat did not reach the app. The .ply is still on disk."""


@dataclass
class PushResult:
    job_id: str
    view_url: str
    gaussians: int
    warning: str | None


def push_ply(ply: Path, app_url: str, *, trip_id: str | None = None) -> PushResult:
    """POST `ply` to the app at `app_url`, returning what it became.

    `app_url` is the app's origin - "http://localhost:3000" - not the endpoint.
    Taking the origin means the caller never has to know the route, and a
    trailing slash or a pasted full URL both still work.
    """
    if not ply.is_file():
        raise PushError(f"No such file: {ply}")
    size = ply.stat().st_size
    if size == 0:
        raise PushError(f"{ply.name} is empty - nothing was trained.")

    base = app_url.rstrip("/")
    # Someone will paste the endpoint rather than the origin. Both should work.
    if base.endswith("/api/splat/upload"):
        endpoint = base
    else:
        endpoint = f"{base}/api/splat/upload"

    with ply.open("rb") as fh:
        request = urllib.request.Request(endpoint, method="POST")
        request.add_header("Content-Type", "application/octet-stream")
        # Required: without it urllib falls back to chunked, and the size is
        # what the server's truncation check is measured against.
        request.add_header("Content-Length", str(size))
        request.add_header("X-Splat-Filename", ply.name)
        if trip_id:
            request.add_header("X-Splat-Trip", trip_id)
        request.data = fh  # type: ignore[assignment]  # urllib streams a file object

        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            # The app explains refusals in a sentence meant for a person. Pass
            # it through rather than replacing it with a status code.
            detail = ""
            try:
                detail = json.loads(exc.read().decode("utf-8")).get("error", "")
            except Exception:
                pass
            raise PushError(
                terminal_safe(detail) or f"The app refused the upload (HTTP {exc.code})."
            ) from exc
        except urllib.error.URLError as exc:
            raise PushError(
                f"Could not reach the app at {base} ({exc.reason}). "
                "Is it running? Start it with `npm run dev` in web/."
            ) from exc
        except TimeoutError as exc:
            raise PushError(
                f"The upload to {base} timed out after {TIMEOUT_SECONDS / 60:.0f} minutes."
            ) from exc

    job = body.get("job") or {}
    job_id = job.get("id")
    if not job_id:
        raise PushError("The app accepted the upload but did not say what it became.")

    return PushResult(
        job_id=job_id,
        view_url=f"{base}{body.get('view') or f'/splat/{job_id}'}",
        gaussians=int(body.get("gaussians") or 0),
        warning=terminal_safe(w) if (w := body.get("warning")) else None,
    )
