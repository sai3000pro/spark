"""Live diagnostic dashboard (terminal snapshot + minimal HTML)."""

from __future__ import annotations


from tools.live_capture_server.session_manager import SessionManager


def snapshot(manager: SessionManager) -> dict:
    return {"sessions": manager.all_snapshots()}


def render_text(manager: SessionManager) -> str:
    snaps = manager.all_snapshots()
    lines = ["Gauzensplat Live Capture — Dashboard", "=" * 40]
    if not snaps:
        lines.append("(no sessions yet)")
    for sid, s in snaps.items():
        lines.append(f"Session: {sid}")
        lines.append(f"  PHONE   frames={s['frames_stored']} "
                     f"payloads={s['payloads_stored']} "
                     f"meta={s['metadata_records']} "
                     f"bytes={s['bytes_written']} errors={s['errors']}")
        odom = s.get("odometry", {})
        if odom:
            for dev, o in odom.items():
                lines.append(f"  ESP32[{dev}] recv={o['received']} "
                             f"dups={o['duplicates']} ooo={o['out_of_order']} "
                             f"missing={o['missing_count']} "
                             f"last_seq={o['max_sequence']}")
        else:
            lines.append("  ESP32   (none)")
    return "\n".join(lines)


def render_html(manager: SessionManager) -> str:
    snaps = manager.all_snapshots()
    rows = []
    for sid, s in snaps.items():
        odom = s.get("odometry", {})
        odo_html = "".join(
            f"<li>{dev}: recv={o['received']} dups={o['duplicates']} "
            f"ooo={o['out_of_order']} missing={o['missing_count']} "
            f"last_seq={o['max_sequence']}</li>"
            for dev, o in odom.items()
        ) or "<li>(none)</li>"
        rows.append(f"""
        <div class="session">
          <h2>{sid}</h2>
          <p><b>Phone</b>: frames {s['frames_stored']}, payloads {s['payloads_stored']},
             metadata {s['metadata_records']}, bytes {s['bytes_written']},
             errors {s['errors']}</p>
          <p><b>ESP32 / odometry</b></p><ul>{odo_html}</ul>
        </div>""")
    body = "".join(rows) or "<p>(no sessions yet)</p>"
    return f"""<!doctype html><html><head><meta charset="utf-8">
<title>Gauzensplat Live Capture</title>
<meta http-equiv="refresh" content="2">
<style>body{{font-family:-apple-system,system-ui,sans-serif;margin:2rem;background:#0e1116;color:#e6edf3}}
.session{{border:1px solid #30363d;border-radius:8px;padding:1rem;margin:1rem 0;background:#161b22}}
h1{{color:#58a6ff}} h2{{color:#79c0ff}}</style></head>
<body><h1>Gauzensplat Live Capture Server</h1>{body}</body></html>"""
