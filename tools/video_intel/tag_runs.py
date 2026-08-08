#!/usr/bin/env python3
"""tag_runs — annotate each studio run's meta.json with technique `tags`.

Reads the splat_batch logs (which hold the real per-run spec: pipeline +
preprocessing) and writes a `tags` list into studio/runs/<id>/meta.json so the
frontend can offer clickable technique filters. General: derives tags from spec
data, not from any single video.

    python tag_runs.py
"""
import glob
import json
import os

COMFY = "/Users/notjackl3/Programming/hunyuanworld-mirror/ComfyUI"
RUNS = os.path.join(COMFY, "studio/runs")
LOGS = [
    "/Users/notjackl3/Programming/hunyuanworld-mirror/tools/video_intel/out/stackt/splat_batch_log.jsonl",
    "/Users/notjackl3/Programming/hunyuanworld-mirror/tools/video_intel/out/stackt_compare/splat_batch_log.jsonl",
]

# name -> spec
specs = {}
for lg in LOGS:
    if os.path.exists(lg):
        for line in open(lg):
            if line.strip():
                r = json.loads(line)
                specs[r["name"]] = r.get("spec", {})


def group_of(name):
    if name.startswith("cmp_good"):
        return "good-case"
    if name.startswith("cmp_hard"):
        return "hard-case"
    if name.startswith("sweep"):
        return "sweep"
    if name.startswith("full"):
        return "full-video"
    if name[:1] == "m" and name[1:3].isdigit():
        return "moment"
    return None


def tags_from_spec(name, spec):
    t = [spec.get("pipeline", "brush")]
    tech = []
    if spec.get("deblur"):
        tech.append("deblur")
    if spec.get("sharp_keep", 1.0) < 1.0:
        tech.append("sharp-gate")
    if spec.get("opac_loss"):
        tech.append("opac-reg")
    if not tech and t[0] == "brush":
        tech.append("base")
    t += tech
    g = group_of(name)
    if g:
        t.append(g)
    return t


n = 0
for mp in glob.glob(os.path.join(RUNS, "*", "meta.json")):
    try:
        meta = json.load(open(mp))
    except Exception:
        continue
    name = meta.get("id") or os.path.basename(os.path.dirname(mp))
    if name in specs:
        tags = tags_from_spec(name, specs[name])
    elif name.endswith("_CLEAN"):
        base = name[:-6]
        tags = (tags_from_spec(base, specs[base]) if base in specs
                else [meta.get("pipeline", "brush"), group_of(name) or "moment"])
        tags.append("pruned")
    else:
        tags = [meta.get("pipeline", "brush"), "legacy"]
    meta["tags"] = sorted(set(t for t in tags if t))
    json.dump(meta, open(mp, "w"), indent=2)
    n += 1

print(f"tagged {n} runs")
# show the tag vocabulary
vocab = sorted({t for mp in glob.glob(os.path.join(RUNS, "*", "meta.json"))
                for t in json.load(open(mp)).get("tags", [])})
print("tag vocabulary:", vocab)
