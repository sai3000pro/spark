#!/bin/zsh
COMFY=/Users/notjackl3/Programming/hunyuanworld-mirror/ComfyUI
PY=$COMFY/.venv/bin/python
DS=$COMFY/brush_data/phone_capture           # capture 1 (outdoor patio)
LOG2=/Users/notjackl3/Programming/hunyuanworld-mirror/tools/video_intel/out/phone_brush2.out
export KMP_DUPLICATE_LIB_OK=TRUE OMP_NUM_THREADS=8
echo "ultra queued: waiting for both phone sweeps to finish first..."
while ! grep -q "ALL PHONE2 RUNS DONE" $LOG2 2>/dev/null; do sleep 30; done
echo "queue clear -> starting ULTRA rerun of outdoor capture"
cfg=$DS/cfg_ultra.json
cat > $cfg <<JSON
{"id":"phone_ultra_60k_1920","pipeline":"brush","label":"phone OUTDOOR ULTRA 60k/1920/4M","colmap_dataset":"$DS","steps":60000,"max_res":1920,"max_splats":4000000,"growth_fraction":0.15,"tags":["brush","phone-capture","lidar","ultra"]}
JSON
cd $COMFY && $PY pipeline_run.py $cfg 2>&1 | tail -3
echo "ULTRA DONE"
