#!/bin/zsh
COMFY=/Users/notjackl3/Programming/hunyuanworld-mirror/ComfyUI
PY=$COMFY/.venv/bin/python
DS=$COMFY/brush_data/phone_capture2
LOG=/Users/notjackl3/Programming/hunyuanworld-mirror/tools/video_intel/out/phone_brush.out
export KMP_DUPLICATE_LIB_OK=TRUE OMP_NUM_THREADS=8
echo "waiting for capture-1 sweep to finish before starting (avoid GPU pileup)..."
while ! grep -q "ALL PHONE RUNS DONE" $LOG 2>/dev/null; do sleep 20; done
echo "capture-1 done -> starting capture-2 sweep"
run(){
  cfg=$DS/cfg_$1.json
  cat > $cfg <<JSON
{"id":"$1","pipeline":"brush","label":"phone2 orbit $2st/$3px","colmap_dataset":"$DS","steps":$2,"max_res":$3,"max_splats":$4,"growth_fraction":0.1,"tags":["brush","phone-capture","lidar","orbit"]}
JSON
  echo "=== $1 ($2 steps, $3px) ==="
  cd $COMFY && $PY pipeline_run.py $cfg 2>&1 | tail -3
}
run phone2_fast_10k_1280  10000 1280 2000000
run phone2_bal_30k_1600   30000 1600 2500000
run phone2_hi_50k_1920    50000 1920 3000000
echo "ALL PHONE2 RUNS DONE"
