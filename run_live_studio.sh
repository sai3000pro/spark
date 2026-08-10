#!/bin/bash
# Standalone live progressive-splat studio.
#
# Runs a SEPARATE studio server instance with live reconstruction enabled, on its
# own port, so it never collides with an already-running studio (:8899) or an
# existing Brush render. Point the phone (or replay_capture.py) at this port.
#
#   ./run_live_studio.sh                # starts on :8901 with LIVE_RECON=1
#   STUDIO_PORT=8910 ./run_live_studio.sh
#
# Then, to stream a recorded capture into it (no phone needed):
#   .venv/bin/python tools/live_capture_server/replay_capture.py \
#       ~/Downloads/capture_full --host 127.0.0.1 --port ${STUDIO_PORT:-8901} --frames 60 --rate 8
#
# Live viewer (double-buffered, reloads as it builds):
#   http://localhost:8765/?live=<session_id>&studio=http://localhost:${STUDIO_PORT:-8901}
#
# NOTE: one GPU — live Brush cadence runs share it with any other Brush process.
set -euo pipefail
cd "$(dirname "$0")/ComfyUI"

export STUDIO_PORT="${STUDIO_PORT:-8901}"
export LIVE_RECON=1

# Prefer the ComfyUI venv (has numpy/plyfile/torch for in-process bits; PY is used
# for the export/decode subprocesses regardless).
PYBIN=".venv/bin/python"
[ -x "$PYBIN" ] || PYBIN="python3"

echo "Standalone LIVE studio  http://localhost:${STUDIO_PORT}/   (LIVE_RECON=1)"
echo "  phone WS:  ws://<lan-ip>:${STUDIO_PORT}/ws/phone"
echo "  live API:  GET /api/live_splat?session=<sid>   WS /ws/splat_updates?session=<sid>"
exec "$PYBIN" studio/server.py
