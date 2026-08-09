"use client";

/**
 * Capture — a field-notes reskin of the Reconstruction Studio "Capture" tab.
 *
 * Presentation only. Every backend contract is preserved exactly as the studio's
 * own page (ComfyUI/studio/static/index.html) uses it, so the working pipeline is
 * untouched. Data is polled through same-origin Next proxies (app/api/capture/*),
 * which forward to the studio (:8899) — matching how app/api/album/* bridges the
 * studio. Poll cadence is 2s, exactly as the original.
 *
 *   GET  /api/capture/state                 → { online, protocol, lan_ip, port, sessions, runs }
 *        (folds studio /health + /api/capture/status + /api/live/list)
 *   GET  /api/capture/live-splat?session=   → { current_ply, ... }  (studio /api/live_splat)
 *   POST /api/capture/delete { session }    → studio /api/live/delete
 *
 * Browser link-outs go straight to their real origins (they can't be proxied):
 *   bigview → {STUDIO_URL}/bigview?ply=&live=6&run=   (SharedArrayBuffer lives there)
 *   viewer  → {VIEWER_URL}/?live=&studio=
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { STUDIO_URL, VIEWER_URL } from "@/lib/studio";
import { NavBrandSwitch } from "@/components/shell/NavBrandSwitch";

// ── the studio's JSON shapes (only the fields this page reads) ──────────────
type OdometryDevice = { received?: number };
type SessionSnapshot = {
  frames_stored?: number;
  bytes_written?: number;
  odometry?: Record<string, OdometryDevice>;
};
type LiveRun = {
  session: string;
  version: number | null;
  frames: number | null;
  keyframes: number | null;
  running: boolean;
  last_run_seconds: number | null;
  current_ply: string | null;
  started_at: number | null;
  updated_at: number | null;
};
type CaptureState = {
  online: boolean;
  protocol: number | null;
  lan_ip: string | null;
  port: number | null;
  sessions: Record<string, SessionSnapshot>;
  runs: LiveRun[];
};

// ── formatting helpers (mirrors the studio's fmtB / fmtAgo) ─────────────────
function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}
function fmtAgo(epochS: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - epochS));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
function fmtClock(epochS: number): string {
  return new Date(epochS * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
function fmtInt(n: number): string {
  return n.toLocaleString();
}

// ── run state, exactly as the studio derives it ─────────────────────────────
type RunState = "training" | "ready" | "waiting";
function runState(r: LiveRun): RunState {
  if (r.running) return "training";
  return (r.version ?? 0) > 0 ? "ready" : "waiting";
}
const STATE_INK: Record<RunState, string> = {
  training: "var(--color-moss)",
  ready: "var(--color-brass-deep)",
  waiting: "var(--color-ink-faint)",
};
const STATE_LABEL: Record<RunState, string> = {
  training: "training…",
  ready: "ready",
  waiting: "waiting",
};

export default function CapturePage() {
  const [state, setState] = useState<CaptureState | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState<Set<string>>(new Set());

  const poll = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const res = await fetch("/api/capture/state", { cache: "no-store" });
      const data = (await res.json()) as CaptureState;
      setState(data);
      setReachable(data.online);
    } catch {
      setReachable(false);
    }
  }, []);

  useEffect(() => {
    // The 2s interval is the subscription to the studio's changing state; the
    // deferred kickoff does the first fetch without a synchronous setState in
    // the effect body (poll setStates only after its await resolves).
    const kickoff = setTimeout(poll, 0);
    const id = setInterval(poll, 2000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [poll]);

  // ── derived connection + stats ───────────────────────────────────────────
  const online = reachable === true && state?.online === true;
  const serverAddr = state?.lan_ip ? `${state.lan_ip}:${state.port}` : null;
  const wsAddr = state?.lan_ip ? `ws://${state.lan_ip}:${state.port}/ws/phone` : null;
  const runs = state?.runs ?? [];

  const stats = useMemo(() => {
    const s = { sessions: 0, frames: 0, bytes: 0, odometry: 0 };
    if (!state) return s;
    for (const id in state.sessions) {
      s.sessions++;
      const v = state.sessions[id];
      s.frames += v.frames_stored || 0;
      s.bytes += v.bytes_written || 0;
      for (const d in v.odometry || {}) s.odometry += v.odometry![d].received || 0;
    }
    return s;
  }, [state]);

  // ── actions — identical targets to the studio's own buttons ──────────────
  const copy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
    } catch {
      /* clipboard blocked — no-op */
    }
  }, []);

  const openBig = useCallback(async (sid: string) => {
    // Open bigview even before the first snapshot exists — it shows a "waiting"
    // state and auto-loads the splat the moment training publishes one.
    let ply = "";
    try {
      const l = await (
        await fetch(`/api/capture/live-splat?session=${encodeURIComponent(sid)}`, {
          cache: "no-store",
        })
      ).json();
      ply = l?.current_ply || "";
    } catch {
      /* studio may be briefly unreachable — still open bigview to wait */
    }
    const base = `${STUDIO_URL}/bigview?live=6&run=${encodeURIComponent(sid)}`;
    window.open(ply ? `${base}&ply=${encodeURIComponent(ply)}` : base, "_blank");
  }, []);

  const openViewer = useCallback((sid: string) => {
    window.open(
      `${VIEWER_URL}/?live=${encodeURIComponent(sid)}&studio=${encodeURIComponent(STUDIO_URL)}`,
      "_blank",
    );
  }, []);

  const deleteRun = useCallback(
    async (sid: string) => {
      if (
        !confirm(
          `Delete splat run ${sid}?\n\nThe captured frames on disk are kept — only the splat + dataset are removed.`,
        )
      )
        return;
      setPending((p) => new Set(p).add(sid));
      try {
        await fetch("/api/capture/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: sid }),
        });
        await poll();
      } catch {
        alert("Delete failed — the studio server may be unreachable.");
      } finally {
        setPending((p) => {
          const n = new Set(p);
          n.delete(sid);
          return n;
        });
      }
    },
    [poll],
  );

  const generateFull = useCallback(
    async (sid: string) => {
      setGenerating((p) => new Set(p).add(sid));
      try {
        await fetch("/api/capture/full-run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: sid }),
        });
        await poll();
        alert(
          "Full splat queued — a high-quality reconstruction is running and will appear in the Album when done.",
        );
      } catch {
        alert("Couldn’t queue the full splat — the studio server may be unreachable.");
      } finally {
        setGenerating((p) => {
          const n = new Set(p);
          n.delete(sid);
          return n;
        });
      }
    },
    [poll],
  );

  return (
    <main className="min-h-dvh w-full bg-paper text-ink">
      <div className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-12">
        {/* ── shared nav ───────────────────────────────────────────────── */}
        <div
          className="rise-in mb-9 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3"
          style={{ "--i": 0 } as React.CSSProperties}
        >
          <NavBrandSwitch tone="paper" />
          <span className="tag text-ink-faint">
            iPhone <Arrow /> COLMAP <Arrow /> Brush · all local on Apple Silicon
          </span>
        </div>

        {/* ── header ───────────────────────────────────────────────────── */}
        <header className="rise-in" style={{ "--i": 1 } as React.CSSProperties}>
          <p className="fnote text-[11px] text-ink-faint">Reconstruction Studio</p>
          <h1 className="mt-1.5 text-[34px] font-medium leading-none tracking-[-0.025em] sm:text-[40px]">
            Capture
          </h1>
        </header>

        {/* ── offline banner ───────────────────────────────────────────── */}
        {reachable === false && (
          <div className="rise-in mt-6 rounded-[10px] px-4 py-3" style={offlineBox}>
            <span className="fnote chip chip-synth text-[10px]">offline</span>
            <span className="ml-2.5 text-[13px] text-ink-soft">
              Can’t reach the studio — is it running on port 8899?
            </span>
          </div>
        )}

        {/* ── connection card ──────────────────────────────────────────── */}
        <section
          className="plate-vellum papergrain rise-in relative mt-6 p-5 sm:p-6"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          <div className="relative z-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[15px] font-medium">
                Connect your iPhone{" "}
                <span className="text-ink-faint">— Gauzensplat Capture app</span>
              </h2>
              <HealthChip online={online} protocol={state?.protocol ?? null} />
            </div>

            <div className="mt-4 border-t" style={{ borderColor: HAIRLINE }}>
              <ConnRow label="Server address">
                <CopyValue
                  value={serverAddr}
                  copied={copied === "addr"}
                  onCopy={() => serverAddr && copy(serverAddr, "addr")}
                />
              </ConnRow>
              <ConnRow label="Phone WebSocket">
                <CopyValue
                  value={wsAddr}
                  copied={copied === "ws"}
                  onCopy={() => wsAddr && copy(wsAddr, "ws")}
                />
              </ConnRow>
            </div>
          </div>
        </section>

        {/* ── stat cards ───────────────────────────────────────────────── */}
        <div
          className="rise-in mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"
          style={{ "--i": 3 } as React.CSSProperties}
        >
          <StatCard label="Live sessions" value={state ? fmtInt(stats.sessions) : "—"} />
          <StatCard label="Frames stored" value={state ? fmtInt(stats.frames) : "—"} />
          <StatCard label="Bytes" value={state ? fmtBytes(stats.bytes) : "—"} />
          <StatCard label="Odometry" value={state ? fmtInt(stats.odometry) : "—"} />
        </div>

        <p
          className="rise-in mt-5 text-[13px] leading-relaxed text-ink-soft"
          style={{ "--i": 4 } as React.CSSProperties}
        >
          Recording is local-first on the phone; this mirrors it live. Mirrored + exported captures
          appear under <span className="font-medium text-ink">Sessions</span>.
        </p>

        {/* ── live splats ──────────────────────────────────────────────── */}
        <section className="rise-in mt-9" style={{ "--i": 5 } as React.CSSProperties}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[19px] font-medium tracking-[-0.02em]">Live splats</h2>
            <span className="tag text-ink-faint">
              each recording is its own run · start a new scan to add one
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {runs.length === 0 ? (
              <EmptyState online={online} loaded={state !== null} />
            ) : (
              runs.map((r, i) => (
                <RunCard
                  key={r.session}
                  run={r}
                  index={i}
                  busy={pending.has(r.session)}
                  generating={generating.has(r.session)}
                  onBigview={() => openBig(r.session)}
                  onViewer={() => openViewer(r.session)}
                  onGenerateFull={() => generateFull(r.session)}
                  onDelete={() => deleteRun(r.session)}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// pieces
// ════════════════════════════════════════════════════════════════════════════

const HAIRLINE = "rgb(27 27 24 / 0.08)";
const offlineBox: React.CSSProperties = {
  background: "rgb(207 94 50 / 0.08)",
  boxShadow: "inset 0 0 0 1px rgb(207 94 50 / 0.28)",
};

function Arrow() {
  return <span className="text-ink-faint/70">→</span>;
}

function HealthChip({ online, protocol }: { online: boolean; protocol: number | null }) {
  if (!online) {
    return <span className="fnote chip chip-synth text-[10px]">offline</span>;
  }
  return (
    <span className="fnote chip chip-live text-[10px]">
      <span className="relative flex h-[7px] w-[7px]">
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
          style={{ background: "var(--color-moss)" }}
        />
        <span
          className="relative inline-flex h-[7px] w-[7px] rounded-full"
          style={{ background: "var(--color-moss)" }}
        />
      </span>
      ok · protocol v{protocol ?? 1}
    </span>
  );
}

function ConnRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between gap-4 border-b py-3.5"
      style={{ borderColor: HAIRLINE }}
    >
      <span className="text-[13px] text-ink-soft">{label}</span>
      {children}
    </div>
  );
}

function CopyValue({
  value,
  copied,
  onCopy,
}: {
  value: string | null;
  copied: boolean;
  onCopy: () => void;
}) {
  if (!value) return <span className="font-mono text-[13px] text-ink-faint">—</span>;
  return (
    <button
      type="button"
      onClick={onCopy}
      title="Copy"
      className="group inline-flex items-center gap-2 font-mono text-[13px] text-brass-deep transition-colors hover:text-ink"
    >
      <span className="tabular-nums">{value}</span>
      <span className="fnote text-[9px] text-ink-faint opacity-0 transition-opacity group-hover:opacity-100">
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="plate-vellum p-4">
      <div className="fnote text-[10.5px] text-ink-faint">{label}</div>
      <div className="mt-2 text-[26px] font-medium tabular-nums leading-none tracking-[-0.02em]">
        {value}
      </div>
    </div>
  );
}

function EmptyState({ online, loaded }: { online: boolean; loaded: boolean }) {
  return (
    <div className="plate-vellum papergrain relative px-6 py-10 text-center">
      <div className="relative z-10">
        <p className="text-[14px] font-medium text-ink">
          {loaded ? "No live scans yet" : "Loading…"}
        </p>
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-soft">
          {online || !loaded
            ? "Start a scan on your iPhone in the Gauzensplat Capture app and it will mirror here as it trains."
            : "Waiting for the studio server. Runs will appear here once it’s reachable."}
        </p>
      </div>
    </div>
  );
}

function RunCard({
  run,
  index,
  busy,
  generating,
  onBigview,
  onViewer,
  onGenerateFull,
  onDelete,
}: {
  run: LiveRun;
  index: number;
  busy: boolean;
  generating: boolean;
  onBigview: () => void;
  onViewer: () => void;
  onGenerateFull: () => void;
  onDelete: () => void;
}) {
  const state = runState(run);
  const ver = run.version == null ? "—" : `v${run.version}`;
  const frameLine =
    run.frames == null ? "" : `${fmtInt(run.frames)} frames · ${run.keyframes || 0} keyframes`;
  const lastRun = run.last_run_seconds ? ` · last run ${run.last_run_seconds}s` : "";
  const updated = run.updated_at ? ` · updated ${fmtAgo(run.updated_at)}` : "";

  return (
    <div
      className="plate-vellum rise-in flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4"
      style={{ "--i": index } as React.CSSProperties}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <StateDot state={state} />
          <span className="text-[15px] font-medium tabular-nums">
            {run.started_at ? fmtClock(run.started_at) : "—"}
          </span>
          <span className="fnote text-[9.5px]" style={{ color: STATE_INK[state] }}>
            {STATE_LABEL[state]}
          </span>
        </div>
        <div className="tag mt-1.5 text-ink-faint">
          <span className="font-mono text-ink-soft">{run.session}</span>
          <span className="text-ink-faint"> · {ver}</span>
          {frameLine && <span className="text-ink-faint"> · {frameLine}</span>}
          <span className="text-ink-faint">{lastRun}</span>
          <span className="text-ink-faint">{updated}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onBigview} className="pill-brass px-3.5 py-1.5 text-[12.5px]">
          bigview <span className="opacity-70">(live)</span>
        </button>
        <button
          type="button"
          onClick={onViewer}
          className="pill-ghost px-3.5 py-1.5 text-[12.5px] text-ink"
        >
          Open viewer
        </button>
        <button
          type="button"
          onClick={onGenerateFull}
          disabled={generating}
          className="pill-ghost px-3.5 py-1.5 text-[12.5px] text-ink disabled:opacity-40"
        >
          {generating ? "Generating…" : "Generate full"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="pill-ghost px-3.5 py-1.5 text-[12.5px] text-clay disabled:opacity-40"
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}

function StateDot({ state }: { state: RunState }) {
  const ink = STATE_INK[state];
  return (
    <span className="relative flex h-[9px] w-[9px] shrink-0">
      {state === "training" && (
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
          style={{ background: ink }}
        />
      )}
      <span
        className="relative inline-flex h-[9px] w-[9px] rounded-full"
        style={{ background: ink, boxShadow: "0 0 0 1px rgb(250 244 227 / 0.9)" }}
      />
    </span>
  );
}
