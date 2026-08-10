#!/bin/zsh
# Food capture — full pipeline NOW (GPU is free): export (rotate-cw) -> object
# detection (food labels) -> Brush train 1.5M @1600 WITH live viewer. Light scene.
set -u
ROOT=/Users/notjackl3/Programming/hunyuanworld-mirror
BRUSH=/Users/notjackl3/Programming/brush-app-aarch64-apple-darwin/brush_app
PY=$ROOT/ComfyUI/.venv/bin/python
CAP=/Users/notjackl3/Downloads/food
DS=$ROOT/ComfyUI/brush_data/capture_food
OUT=$ROOT/ComfyUI/studio/runs/capture_food_15M_1600
RUNID=capture_food_15M_1600
mkdir -p $OUT

echo "[food] $(date +%H:%M:%S) exporting COLMAP (rotate-cw)..."
rm -rf $DS
$PY $ROOT/tools/arkit_capture/export_colmap.py "$CAP" --out $DS --max-points 250000 --rotate-cw \
  > /tmp/food_export.log 2>&1
echo "[food] export: $(grep -o '"images": [0-9]*' /tmp/food_export.log | head -1)"

echo "[food] $(date +%H:%M:%S) object detection (DETR, food labels)..."
$PY $ROOT/tools/video_intel/object_catalog.py $DS \
  --out $OUT/objects.json --detector detr --device cpu --stride 5 --thresh 0.6 --min-views 3 \
  --labels "banana,apple,orange,sandwich,pizza,donut,cake,broccoli,carrot,hot dog,bowl,cup,wine glass,bottle,fork,knife,spoon,dining table,cell phone,laptop" \
  --skip person > /tmp/food_objects.log 2>&1
echo "[food] detection: $(grep -o '[0-9]* instances' /tmp/food_objects.log | tail -1)"

$PY - <<PYEOF
import json, os, time
run="$OUT"
json.dump(dict(id="$RUNID", pipeline="brush", label="food (1.5M, full res)",
          colmap_dataset="$DS", status="running", started=time.time(),
          run_dir=run, steps=30000, note="rotated CW; food; max-splats 1.5M"),
          open(os.path.join(run,"meta.json"),"w"), indent=2)
print("[food] wrote meta.json")
PYEOF

echo "[food] $(date +%H:%M:%S) starting Brush 1.5M @1600 WITH VIEWER"
KMP_DUPLICATE_LIB_OK=TRUE $BRUSH $DS --with-viewer \
  --total-steps 30000 --max-resolution 1600 --max-splats 1500000 \
  --growth-select-fraction 0.1 --growth-stop-iter 18000 \
  --export-path $OUT --export-name "${RUNID}_{iter}.ply" \
  --export-every 2500 --eval-every 100000000
echo "[food] $(date +%H:%M:%S) FOOD TRAINING DONE"

echo "[food] $(date +%H:%M:%S) object quality gate (needs final .ply)..."
$PY $ROOT/tools/video_intel/object_quality.py $OUT > /tmp/food_quality.log 2>&1
echo "[food] quality: $(grep -o '[0-9]*/[0-9]* flagged low_quality' /tmp/food_quality.log | tail -1)"
