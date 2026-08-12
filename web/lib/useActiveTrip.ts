"use client";

/**
 * The live trip, on the client. No websockets, no react-query, no SWR.
 *
 * Two channels, deliberately separated:
 *
 *   · A 1 Hz LOCAL clock drives the elapsed timer. It re-renders only the pill.
 *   · A 2 s poll of /api/trip/active drives status and counters, and it calls
 *     router.refresh() ONLY on a status transition. Refreshing the RSC tree on
 *     every poll would refetch every server component twice a second.
 *
 * The timer is anchored to the server's `startedAt` rather than counting up from
 * a local zero, so it cannot drift no matter how long the tab has been open or
 * how many polls were missed while it was hidden.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { ActiveTripSnapshot } from "./liveTrip";

/**
 * Wall-clock seconds, as a subscribable external store.
 *
 * A live clock is by definition impure, so it cannot be read with `Date.now()`
 * during render — `useSyncExternalStore` is the sanctioned way to read a changing
 * external value: getSnapshot is stable within a second, so React's Object.is
 * comparison settles, and the subscription is what schedules the re-render.
 *
 * The server snapshot is 0; every consumer of the resulting timer already carries
 * suppressHydrationWarning, because server and client legitimately disagree by up
 * to a second on the very first paint.
 */
function useNowSeconds(running: boolean): number {
  return useSyncExternalStore(
    useCallback(
      (onChange: () => void) => {
        if (!running) return () => {};
        const id = setInterval(onChange, 1000);
        return () => clearInterval(id);
      },
      [running],
    ),
    () => Math.floor(Date.now() / 1000),
    () => 0,
  );
}

interface UseActiveTrip {
  active: ActiveTripSnapshot | null;
  /** Ticks locally at 1 Hz. Do NOT read `active.elapsedSec` for display. */
  elapsedSec: number;
  pending: boolean;
  error: string | null;
  /**
   * There is no `start`. A session opens when hardware POSTs to /api/ingest/*
   * (see openTripForIngest in lib/liveTrip.ts) — nothing in the UI can open one,
   * because a session nothing is driving is a screen of numbers nobody measured.
   */
  stop: () => Promise<void>;
}

const IDLE_POLL_MS = 15_000;

export function useActiveTrip(initial: ActiveTripSnapshot | null): UseActiveTrip {
  const router = useRouter();

  const [active, setActive] = useState<ActiveTripSnapshot | null>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compared against each poll to decide whether the page needs refreshing.
  const lastStatus = useRef<string | null>(initial?.status ?? null);
  const pollAfterMs = useRef(initial ? 2000 : IDLE_POLL_MS);

  const adopt = useCallback(
    (next: ActiveTripSnapshot | null) => {
      setActive(next);
      const status = next?.status ?? null;
      if (status !== lastStatus.current) {
        lastStatus.current = status;
        // Expensive channel: only on a real transition (recording → processing →
        // gone), or right after a mutation.
        router.refresh();
      }
    },
    [router],
  );

  // ── Poll ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Same alive-flag + cleanup idiom as SplatStage's HEAD probe.
    const tick = async () => {
      if (!alive || document.hidden) return;
      try {
        const res = await fetch("/api/trip/active", { cache: "no-store" });
        if (!alive || !res.ok) return;
        const data = (await res.json()) as {
          active: ActiveTripSnapshot | null;
          pollAfterMs?: number;
        };
        if (!alive) return;
        pollAfterMs.current = data.pollAfterMs ?? IDLE_POLL_MS;
        adopt(data.active);
      } catch {
        // A failed poll is not worth surfacing — the next one is 2s away.
      } finally {
        if (alive) timer = setTimeout(tick, pollAfterMs.current);
      }
    };

    // A hidden tab must not hammer the server every 2s forever.
    const onVisibility = () => {
      if (document.hidden) {
        if (timer) clearTimeout(timer);
        timer = null;
      } else if (!timer) {
        void tick();
      }
    };

    timer = setTimeout(tick, pollAfterMs.current);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [adopt]);

  // ── Local clock ───────────────────────────────────────────────────────────
  //
  // Derived from the server's `startedAt`, not counted up from a local zero, so
  // it cannot drift however long the tab has been open and it self-corrects after
  // the tab was hidden or the machine asleep.
  const running = !!active && !active.endedAt;
  const nowSec = useNowSeconds(running);

  const elapsedSec = !active
    ? 0
    : active.endedAt || !nowSec
      ? // Frozen once stopped — and on the very first (server) paint, where the
        // snapshot's own value is the only honest answer.
        active.elapsedSec
      : Math.max(0, nowSec - Math.round(Date.parse(active.startedAt) / 1000));

  // ── Mutations ─────────────────────────────────────────────────────────────
  const mutate = useCallback(
    async (path: string, body?: unknown) => {
      setPending(true);
      setError(null);
      try {
        const res = await fetch(path, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        const data = (await res.json()) as { active?: ActiveTripSnapshot | null; error?: string };

        // A 409 carries the server's view of the world. Adopting it is how a
        // stale tab heals instead of showing an error the user cannot act on.
        if (res.status === 409 && data.active !== undefined) {
          adopt(data.active);
          return;
        }
        if (!res.ok) {
          setError(data.error ?? "Something went wrong.");
          return;
        }

        adopt(data.active ?? null);
        lastStatus.current = data.active?.status ?? null;
        router.refresh();
      } catch {
        setError("Could not reach the server.");
      } finally {
        setPending(false);
      }
    },
    [adopt, router],
  );

  const stop = useCallback(() => mutate("/api/trip/stop", {}), [mutate]);

  return { active, elapsedSec, pending, error, stop };
}

/** "12:04" / "1:02:44" — the live timer. */
export function elapsedLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}
