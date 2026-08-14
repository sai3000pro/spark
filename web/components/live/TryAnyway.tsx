"use client";

/**
 * "Reconstruct it anyway" — the scorer's verdict, overruled.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `promoteThreshold` is 0.62 and `dedupeTriggers` keeps only the strongest
 * trigger of each kind, so a silent clip's whole reachable budget is novelty +
 * faces + dwell + scene-change. Clearing the bar without audio needs nearly all
 * of them firing at once. That is a reasonable rule for deciding what to SHOW
 * someone, and a terrible reason to refuse to build the place they just walked
 * around: "no minute stood out" and "this is not worth reconstructing" are
 * different claims, and the pipeline only ever measured the first.
 *
 * So the scorer keeps its opinion and stops being the gate. The person looking
 * at "nothing scored high enough" is the one who was actually there.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CLIP IS ALREADY HERE, USUALLY
 *
 * A phone handoff writes the video to `.uploads/<jobId>.<ext>` before anything
 * is allowed to fail, so pressing this sends bytes that are already on the
 * server — no re-upload, no second walk around the building. The laptop path
 * may not have uploaded at all (the "also reconstruct" box was unticked, which
 * is the whole reason the file stayed in the tab), so that caller hands over a
 * `resolveJobId` that uploads first. Either way this component only ever knows
 * about a job id.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AVAILABILITY IS PROBED, PREFERENCE IS REMEMBERED
 *
 * The menu comes from /api/reconstruction/targets, which pings the studio and
 * reads the KIRI balance, so nothing is offered that would quietly do nothing.
 * Unavailable options stay VISIBLE and greyed with their reason — "no GPU
 * studio running here" is a fact someone can go and fix and then press this
 * again, and a hidden option teaches nobody anything.
 *
 * Which one is preselected comes from lib/reconstruction/useReconTarget, so
 * somebody who always wants the free local box is asked once, not every time.
 */
import { useCallback, useEffect, useState } from "react";

import { setReconTarget, useReconTarget } from "@/lib/reconstruction/useReconTarget";
import type { ReconTarget, TargetOption } from "@/lib/reconstruction/targets";

interface Props {
  /**
   * Hands back the job whose clip should be reconstructed, uploading it first
   * if the server does not have it yet. Rejecting is fine — the message is
   * shown as-is.
   */
  resolveJobId: () => Promise<string>;
  /** The sentence above the control. The two panels frame this differently. */
  prompt: string;
  /**
   * The job this ended up dispatching, once it has.
   *
   * The laptop panel opens a job LAZILY here — the video was never uploaded
   * until the button was pressed — so the parent has no id to watch until this
   * says so. Without it a dispatch from that path would be unwatched, and an
   * unwatched KIRI job is one whose result nobody ever collects.
   */
  onDispatched?: (jobId: string) => void;
}

type State =
  | { k: "idle" }
  | { k: "sending" }
  | { k: "sent"; note: string; ok: boolean; degraded: boolean }
  | { k: "error"; message: string };

export function TryAnyway({ resolveJobId, prompt, onDispatched }: Props) {
  const preferred = useReconTarget();
  const [options, setOptions] = useState<TargetOption[] | null>(null);
  const [state, setState] = useState<State>({ k: "idle" });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/reconstruction/targets", { cache: "no-store" });
        if (!alive || !res.ok) return;
        const body = (await res.json()) as { options: TargetOption[] };
        if (alive) setOptions(body.options);
      } catch {
        // Leaving `options` null is the honest state: the menu is unknown, so
        // the button below falls back to sending at the remembered preference
        // and letting the server's own fallback chain decide.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const send = useCallback(
    async (target: ReconTarget) => {
      setReconTarget(target);
      setState({ k: "sending" });
      try {
        const jobId = await resolveJobId();
        // Announced BEFORE the outcome is known: the clip is on the server from
        // this point, so it is worth watching even if the dispatch degrades or
        // is retried later.
        onDispatched?.(jobId);
        const res = await fetch(`/api/splat/jobs/${jobId}/dispatch`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          outcome?: { ok: boolean; degraded: boolean; note: string };
          error?: string;
        };
        if (!res.ok) {
          setState({ k: "error", message: body.error ?? `The server said ${res.status}.` });
          return;
        }
        // `ok: false` is not an error here — the request worked and the answer
        // is "it went nowhere, and here is why". Rendered the same way, in the
        // server's own words, because it already phrased it for a person.
        setState({
          k: "sent",
          note: body.outcome?.note ?? "Sent.",
          ok: body.outcome?.ok ?? false,
          degraded: body.outcome?.degraded ?? false,
        });
      } catch (err) {
        setState({ k: "error", message: err instanceof Error ? err.message : String(err) });
      }
    },
    [resolveJobId, onDispatched],
  );

  if (state.k === "sent") {
    return (
      <p
        className={`fnote mt-3 text-[10px] leading-relaxed ${
          state.ok ? "text-lagoon" : "text-ink-faint"
        }`}
      >
        [ {state.degraded ? "sent elsewhere · " : ""}
        {state.note} ]
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="fnote text-[10px] leading-relaxed text-ink-faint">[ {prompt} ]</p>

      <div className="flex flex-wrap items-center gap-1.5">
        {(options ?? []).map((o) => {
          const chosen = o.id === preferred;
          return (
            <button
              key={o.id}
              type="button"
              disabled={state.k === "sending" || !o.available}
              onClick={() => void send(o.id)}
              // The reason lives in `title` as well as being implied by the
              // greying: a disabled control with no explanation is a dead end.
              title={o.blockedBecause ?? o.detail}
              className={`pill-ghost px-3 py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-40 ${
                chosen ? "bg-brass/20 text-ink" : "text-ink-soft"
              }`}
            >
              {o.label}
              {chosen && o.available && (
                <span className="fnote ml-1.5 text-[9px] text-ink-faint">[ remembered ]</span>
              )}
            </button>
          );
        })}

        {/* The menu never arrived. Still offer the action rather than nothing:
            the server re-probes on its own and falls back local-before-cloud,
            so this cannot silently spend a credit. */}
        {options === null && (
          <button
            type="button"
            disabled={state.k === "sending"}
            onClick={() => void send(preferred)}
            className="pill-ghost px-3 py-1.5 text-[12px] text-ink-soft disabled:opacity-40"
          >
            Reconstruct it anyway
          </button>
        )}
      </div>

      {state.k === "sending" && (
        <p className="fnote text-[9.5px] text-ink-faint">[ handing the clip over… ]</p>
      )}
      {state.k === "error" && (
        <p className="fnote text-[9.5px] leading-relaxed text-clay">[ {state.message} ]</p>
      )}
    </div>
  );
}
