#!/bin/zsh
# Queue capture_full Brush training to start the moment the phone_room job exits,
# so both never fight over the single Metal GPU. Opens the live Brush viewer,
# snapshots during training, then decodes the final ply for the :8765 browser viewer.
set -u
ROOT=/Users/notjackl3/Programming/hunyuanworld-mirror
BRUSH=/Users/notjackl3/Programming/brush-app-aarch64-apple-darwin/brush_app
DS=$ROOT/ComfyUI/brush_data/capture_full
OUT=$ROOT/ComfyUI/studio/runs/capture_full_30k_1600
PY=$ROOT/ComfyUI/.venv/bin/python
mkdir -p $OUT

echo "[queue] waiting for phone_room Brush to finish so capture_full gets the full GPU..."
while pgrep -f "brush_app.*phone_room" >/dev/null; do sleep 20; done
echo "[queue] phone_room done at $(date '+%H:%M:%S') -> starting capture_full training with live viewer"

KMP_DUPLICATE_LIB_OK=TRUE $BRUSH $DS --with-viewer \
  --total-steps 30000 --max-resolution 1600 --max-splats 2000000 \
  --growth-select-fraction 0.1 --growth-stop-iter 18000 \
  --export-path $OUT --export-name "capture_full_30k_1600_{iter}.ply" \
  --export-every 2500 --eval-every 100000000
echo "[queue] Brush training finished at $(date '+%H:%M:%S'); decoding final ply for browser viewer"

# decode highest-iteration brush ply -> viewer-ready result.ply
$PY - "$OUT" <<'PYEOF'
import sys, os, glob, re
sys.path.insert(0, "/Users/notjackl3/Programming/hunyuanworld-mirror/ComfyUI")
from pipeline_run import decode_brush_ply
out = sys.argv[1]
plys = glob.glob(os.path.join(out, "capture_full_30k_1600_*.ply"))
it = lambda p: int(re.search(r"_(\d+)\.ply$", os.path.basename(p)).group(1))
raw = max(plys, key=it)
res = os.path.join(out, "result.ply")
n = decode_brush_ply(raw, res)
print(f"[queue] decoded {raw} -> {res} ({n:,} gaussians)")
PYEOF
echo "[queue] DONE at $(date '+%H:%M:%S')"
