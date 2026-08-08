"""Gauzensplat live capture server (Mac-side, stdlib-only).

A local-LAN server that ingests live iPhone sensor payloads and ESP32 odometry
over WebSocket, verifies + stores them idempotently under one session, and
exposes health / dashboard / clock-sync endpoints.

No third-party dependencies: the WebSocket implementation (``ws.py``) is a
self-contained RFC 6455 subset.  Storage is written in the same on-disk format
as the offline recorder, so ``tools/arkit_capture/inspect_capture.py`` runs
directly on a server-received session.
"""
