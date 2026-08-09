#!/bin/zsh
# Queue the OUTDOOR capture to run the full pipeline AFTER the current indoor
# full-quality run completes (waits for its final 30000 snapshot, then frees the
# GPU). Stage 1 = 2.5M splats @ 1600 with the live Brush viewer. Stage 2 (3M) is
# launched separately after we judge memory behavior at 2.5M.
set -u
ROOT=/Users/notjackl3/Programming/hunyuanworld-mirror
BRUSH=/Users/notjackl3/Programming/brush-app-aarch64-apple-darwin/brush_app
PY=$ROOT/ComfyUI/.venv/bin/python
CAP=/Users/notjackl3/Downloads/capture_20260808-223731_B7A82614
DS=$ROOT/ComfyUI/brush_data/capture_outdoor
INDOOR_FINAL=$ROOT/ComfyUI/studio/runs/capture_full_30k_1600_FULL/capture_full_FULL_30000.ply
OUT=$ROOT/ComfyUI/studio/runs/capture_outdoor_25M_1600
RUNID=capture_outdoor_25M_1600
mkdir -p $OUT

echo "[outdoor] $(date +%H:%M:%S) waiting for indoor full run to reach 30000..."
while [ ! -f "$INDOOR_FINAL" ]; do sleep 30; done
echo "[outdoor] $(date +%H:%M:%S) indoor 30k done. Freeing GPU (closing finished Brush)."
pkill -f "brush_app" 2>/dev/null; sleep 5

# --- export (rotate CW 90, same portrait phone) ---
echo "[outdoor] $(date +%H:%M:%S) exporting COLMAP (rotate-cw)..."
rm -rf $DS
$PY $ROOT/tools/arkit_capture/export_colmap.py "$CAP" --out $DS --max-points 300000 --rotate-cw \
  > /tmp/outdoor_export.log 2>&1
echo "[outdoor] export done: $(grep -o '"images": [0-9]*' /tmp/outdoor_export.log | head -1)"

# --- object detection (outdoor labels) ---
echo "[outdoor] $(date +%H:%M:%S) object detection (DETR, outdoor labels)..."
$PY $ROOT/tools/video_intel/object_catalog.py $DS \
  --out $OUT/objects.json --detector detr --device cpu --stride 6 --thresh 0.7 --min-views 3 \
  --labels "car,truck,bus,bicycle,motorcycle,bench,traffic light,stop sign,fire hydrant,parking meter,potted plant,umbrella,backpack,handbag,dog,cat,bird,boat,skateboard,chair,dining table,bottle,cup" \
  --skip person > /tmp/outdoor_objects.log 2>&1
echo "[outdoor] detection done: $(grep -o '[0-9]* instances' /tmp/outdoor_objects.log | tail -1)"

# --- meta so bigview overlays frames + objects ---
$PY - <<PYEOF
import json, os, time
run="$OUT"
json.dump(dict(id="$RUNID", pipeline="brush", label="outdoor 2.5M (full res)",
          colmap_dataset="$DS", status="running", started=time.time(),
          run_dir=run, steps=30000, note="rotated CW; outdoor; max-splats 2.5M"),
          open(os.path.join(run,"meta.json"),"w"), indent=2)
print("[outdoor] wrote meta.json")
PYEOF

# --- Stage 1: train 2.5M @ 1600 WITH live viewer ---
echo "[outdoor] $(date +%H:%M:%S) starting Brush 2.5M @1600 WITH VIEWER"
KMP_DUPLICATE_LIB_OK=TRUE $BRUSH $DS --with-viewer \
  --total-steps 30000 --max-resolution 1600 --max-splats 2500000 \
  --growth-select-fraction 0.1 --growth-stop-iter 18000 \
  --export-path $OUT --export-name "${RUNID}_{iter}.ply" \
  --export-every 2500 --eval-every 100000000
echo "[outdoor] $(date +%H:%M:%S) STAGE 1 (2.5M) DONE"
