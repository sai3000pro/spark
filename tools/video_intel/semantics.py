#!/usr/bin/env python3
"""semantics — label the moments in a processed video with a vision model.

Reads the manifest.json produced by process_video.py, sends the per-moment
keyframes to a VLM in ONE batched request, and writes context.json:

    { "overall": "...", "moments": [ {index,label,description,tags,
                                      salience, splat_feasibility, splat_reason} ] }

Backends (stdlib urllib only — no SDK, works on this Python 3.14 venv):
    gemini  (default)  gemini-2.5-flash, images sent inline
    openai             gpt-4o, images sent as data URLs   [fallback]

Keys are read from env (GEMINI_API_KEY / OPENAI_API_KEY) or the local
.secrets/*.key files. Nothing is printed.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import sys
import time
import urllib.request
from pathlib import Path
from typing import List, Optional

from PIL import Image

HERE = Path(__file__).resolve().parent
SECRETS = HERE / ".secrets"

# Per-moment output contract (shared by both backends).
MOMENT_FIELDS = ("index", "label", "description", "tags",
                 "salience", "splat_feasibility", "splat_reason")

INSTRUCTION = (
    "You are the intelligence layer of a memory-capture app. The images are "
    "keyframes sampled from a single continuous walkthrough video, each tagged "
    "with its MOMENT index and timestamp. For EACH moment index, describe what "
    "is happening so the person can later find and relive it. Return strict "
    "JSON. For every moment provide:\n"
    "  label: 3-6 word title of the moment\n"
    "  description: one sentence on what is happening / what is visible\n"
    "  tags: 2-5 short nouns (objects, place type, activity)\n"
    "  salience: 0..1, how memorable/interesting this moment is to relive\n"
    "  splat_feasibility: 'high' | 'med' | 'low' — can this be reconstructed as "
    "a 3D Gaussian splat? high = camera translates around static structure with "
    "parallax; low = pure panning, motion blur, crowds, or featureless.\n"
    "  splat_reason: brief why for the feasibility rating.\n"
    "Also return an 'overall' one-sentence summary of the whole video."
)


def _read_key(env_name: str, file_name: str) -> Optional[str]:
    import os
    if os.environ.get(env_name):
        return os.environ[env_name].strip()
    p = SECRETS / file_name
    return p.read_text().strip() if p.exists() else None


def _jpeg_b64(path: Path, max_w: int = 768, quality: int = 80) -> str:
    with Image.open(path) as im:
        im = im.convert("RGB")
        if im.width > max_w:
            im = im.resize((max_w, max(1, int(im.height * max_w / im.width))))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=quality)
    return base64.b64encode(buf.getvalue()).decode()


def _keyframes(manifest: dict) -> List[dict]:
    kf = [f for f in manifest["frames"] if f.get("is_keyframe")]
    kf.sort(key=lambda f: f["t"])
    return kf


def _moment_lines(manifest: dict) -> str:
    return "\n".join(
        f"  moment {s['index']}: {s['start']:.0f}-{s['end']:.0f}s"
        for s in manifest["segments"])


# --------------------------------------------------------------------------- #
# Gemini backend
# --------------------------------------------------------------------------- #
def _gemini(manifest: dict, out_dir: Path, model: str) -> dict:
    key = _read_key("GEMINI_API_KEY", "gemini.key")
    if not key:
        raise RuntimeError("no Gemini key")
    parts: List[dict] = [{"text": INSTRUCTION + "\n\nMoments and time spans:\n"
                          + _moment_lines(manifest)}]
    for f in _keyframes(manifest):
        parts.append({"text": f"moment {f['segment']} @ {f['t']:.0f}s:"})
        parts.append({"inline_data": {"mime_type": "image/jpeg",
                     "data": _jpeg_b64(out_dir / f["path"])}})
    schema = {
        "type": "OBJECT",
        "properties": {
            "overall": {"type": "STRING"},
            "moments": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
                "index": {"type": "INTEGER"},
                "label": {"type": "STRING"},
                "description": {"type": "STRING"},
                "tags": {"type": "ARRAY", "items": {"type": "STRING"}},
                "salience": {"type": "NUMBER"},
                "splat_feasibility": {"type": "STRING"},
                "splat_reason": {"type": "STRING"},
            }, "required": list(MOMENT_FIELDS)}},
        },
        "required": ["overall", "moments"],
    }
    body = {"contents": [{"parts": parts}],
            "generationConfig": {"responseMimeType": "application/json",
                                 "responseSchema": schema, "temperature": 0.2}}
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{model}:generateContent?key={key}")
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        resp = json.load(r)
    text = resp["candidates"][0]["content"]["parts"][0]["text"]
    u = resp.get("usageMetadata", {})
    usage = {"backend": "gemini", "model": model,
             "input_tokens": u.get("promptTokenCount"),
             "output_tokens": u.get("candidatesTokenCount"),
             "total_tokens": u.get("totalTokenCount")}
    return json.loads(text), usage


# --------------------------------------------------------------------------- #
# OpenAI backend (fallback)
# --------------------------------------------------------------------------- #
def _openai(manifest: dict, out_dir: Path, model: str) -> dict:
    key = _read_key("OPENAI_API_KEY", "openai.key")
    if not key:
        raise RuntimeError("no OpenAI key")
    content: List[dict] = [{"type": "text", "text": INSTRUCTION
                            + "\n\nMoments and time spans:\n" + _moment_lines(manifest)
                            + "\n\nReturn a JSON object {overall, moments:[...]}."}]
    for f in _keyframes(manifest):
        content.append({"type": "text", "text": f"moment {f['segment']} @ {f['t']:.0f}s:"})
        content.append({"type": "image_url", "image_url": {
            "url": "data:image/jpeg;base64," + _jpeg_b64(out_dir / f["path"]),
            "detail": "low"}})
    body = {"model": model, "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": content}], "temperature": 0.2}
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=180) as r:
        resp = json.load(r)
    u = resp.get("usage", {})
    usage = {"backend": "openai", "model": model,
             "input_tokens": u.get("prompt_tokens"),
             "output_tokens": u.get("completion_tokens"),
             "total_tokens": u.get("total_tokens")}
    return json.loads(resp["choices"][0]["message"]["content"]), usage


# $ per 1M tokens (input, output). Update as prices change.
PRICES = {"gemini-2.5-flash": (0.30, 2.50), "gemini-2.5-pro": (1.25, 10.0),
          "gpt-4o": (2.50, 10.0), "gpt-5": (1.25, 10.0)}


def _cost(usage: dict) -> Optional[float]:
    price = PRICES.get(usage.get("model"))
    if not price or usage.get("input_tokens") is None:
        return None
    inp, out = price
    return round((usage["input_tokens"] * inp
                  + (usage.get("output_tokens") or 0) * out) / 1e6, 6)


def label(out_dir: Path, backend: str, model: str) -> dict:
    manifest = json.loads((out_dir / "manifest.json").read_text())
    fn = {"gemini": _gemini, "openai": _openai}[backend]
    t0 = time.time()
    ctx, usage = fn(manifest, out_dir, model)
    usage["seconds"] = round(time.time() - t0, 1)
    usage["n_keyframes"] = len(_keyframes(manifest))
    usage["n_moments"] = len(manifest["segments"])
    usage["est_cost_usd"] = _cost(usage)
    # merge time spans back in for convenience
    spans = {s["index"]: s for s in manifest["segments"]}
    for m in ctx.get("moments", []):
        s = spans.get(m.get("index"))
        if s:
            m["start"], m["end"] = s["start"], s["end"]
    (out_dir / "context.json").write_text(json.dumps(ctx, indent=2))
    (out_dir / "semantics_analytics.json").write_text(json.dumps(usage, indent=2))
    ctx["_usage"] = usage
    return ctx


def main() -> None:
    ap = argparse.ArgumentParser(description="Label video moments with a VLM.")
    ap.add_argument("out_dir", type=Path, help="dir containing manifest.json")
    ap.add_argument("--backend", choices=["gemini", "openai"], default="gemini")
    ap.add_argument("--model", default=None)
    args = ap.parse_args()
    model = args.model or ("gemini-2.5-flash" if args.backend == "gemini" else "gpt-4o")
    try:
        ctx = label(args.out_dir, args.backend, model)
    except Exception as e:  # noqa: BLE001
        print(f"[error] {args.backend} failed: {e}", file=sys.stderr)
        sys.exit(1)
    u = ctx.get("_usage", {})
    print(f"TOKENS: in={u.get('input_tokens')} out={u.get('output_tokens')} "
          f"total={u.get('total_tokens')} | est_cost=${u.get('est_cost_usd')} "
          f"| {u.get('seconds')}s | {u.get('n_keyframes')} keyframes")
    print("OVERALL:", ctx.get("overall", ""))
    print("-" * 88)
    for m in sorted(ctx.get("moments", []), key=lambda x: x.get("index", 0)):
        print(f"[{m.get('start',0):5.0f}-{m.get('end',0):5.0f}s] "
              f"sal={m.get('salience',0):.2f} splat={m.get('splat_feasibility','?'):>4} "
              f"| {m.get('label','')}")
        print(f"           {m.get('description','')}  {m.get('tags',[])}")


if __name__ == "__main__":
    main()
