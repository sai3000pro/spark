#!/bin/zsh
COMFY=/Users/notjackl3/Programming/hunyuanworld-mirror/ComfyUI
PY=$COMFY/.venv/bin/python
DS=$COMFY/brush_data/phone_capture
export KMP_DUPLICATE_LIB_OK=TRUE OMP_NUM_THREADS=8
run(){  # id steps res splats
  cfg=$COMFY/brush_data/phone_capture/cfg_$1.json
  cat > $cfg <<JSON
{"id":"$1","pipeline":"brush","label":"phone LiDAR $2st/$3px","colmap_dataset":"$DS","steps":$2,"max_res":$3,"max_splats":$4,"growth_fraction":0.1,"tags":["brush","phone-capture","lidar"]}
JSON
  echo "=== $1 ($2 steps, $3px) ==="
  cd $COMFY && $PY pipeline_run.py $cfg 2>&1 | tail -3
}
run phone_fast_10k_1280   10000 1280 2000000
run phone_bal_30k_1600    30000 1600 2500000
run phone_hi_50k_1920     50000 1920 3000000
echo "ALL PHONE RUNS DONE"
