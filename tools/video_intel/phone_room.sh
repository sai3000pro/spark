#!/bin/zsh
BRUSH=/Users/notjackl3/Programming/brush-app-aarch64-apple-darwin/brush_app
DS=/Users/notjackl3/Programming/hunyuanworld-mirror/ComfyUI/brush_data/phone_room
OUT=/Users/notjackl3/Programming/hunyuanworld-mirror/ComfyUI/studio/runs/phone_room_30k_1600
mkdir -p $OUT
echo "queued: waiting for capture-2 to finish (so the room gets the full GPU)..."
while pgrep -f "phone_capture2 --with-viewer" >/dev/null; do sleep 20; done
echo "capture-2 done -> starting ROOM training with live viewer"
KMP_DUPLICATE_LIB_OK=TRUE $BRUSH $DS --with-viewer \
  --total-steps 30000 --max-resolution 1600 --max-splats 2000000 \
  --growth-select-fraction 0.1 --growth-stop-iter 18000 \
  --export-path $OUT --export-name "phone_room_30k_1600_{iter}.ply" \
  --export-every 2500 --eval-every 100000000
echo "ROOM DONE"
