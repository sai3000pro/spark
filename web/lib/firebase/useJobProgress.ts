"use client";

/**
 * Listening to a reconstruction, when there is anything to listen to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE RULES FROM ./progress.ts, AS CODE
 *
 * That module states the contract that keeps RTDB from becoming a second source
 * of truth. This hook is the consumer side of it, and each rule shows up here:
 *
 *   1. "every consumer does one authoritative GET on mount BEFORE subscribing" —
 *      this hook does not do that GET, because its caller already was. It is
 *      strictly additive to a poller that keeps running; it never replaces one.
 *      A subscription established after the terminal frame never fires, and a
 *      hook that had made itself the only listener would hang forever on exactly
 *      the jobs that finished fastest.
 *
 *   2. "a `ready` frame is never trusted on its own" — so this returns a frame
 *      and nothing else. It resolves no URL, attaches nothing, and marks nothing
 *      complete. The caller re-reads the API and believes that.
 *
 *   3. "losing the RTDB connection degrades to polling, not to a wrong answer" —
 *      every failure path returns null and the poll underneath is untouched.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE CALLER ACTUALLY WANTS BACK
 *
 * Two things, and the second is the less obvious one:
 *
 *   · `frame`, to show motion between polls and to know when to poll early.
 *   · `channel`, to send UP with its own poll — because the server has no idea
 *     where to publish otherwise. The reader's channel is its anonymous Firebase
 *     uid and only the browser knows it. That is the whole handshake: one query
 *     parameter, no registration, no session.
 */
import { useEffect, useState } from "react";

import { getChannelId, getProgressDatabase } from "./client";
import { isFresher, isTerminal, progressPath, type ProgressFrame } from "./progress";

export interface JobProgress {
  /** The newest frame, or null when there is no channel or nothing has arrived. */
  frame: ProgressFrame | null;
  /**
   * This browser's channel. Send it with the authoritative poll — without it the
   * server publishes nowhere and `frame` stays null forever.
   */
  channel: string | null;
}

/**
 * Subscribe to one job's progress. Pass null to subscribe to nothing.
 *
 * Resolves to nulls and stays there whenever Firebase is unconfigured,
 * anonymous sign-in is off, or RTDB is unreachable — which is every deployment
 * running on KIRI_API_KEY alone, and is why the caller must be written as though
 * this hook did not exist.
 */
export function useJobProgress(jobId: string | null): JobProgress {
  /*
    The channel is per-BROWSER and the frame is per-JOB, so they are separate
    state and only the frame is tagged with the job it describes.

    Tagging matters: this hook's caller can be handed a different `jobId` while
    mounted, and a frame left over from the previous one would render as live
    progress for a reconstruction it knows nothing about. Comparing the tag on
    the way out discards it without needing an effect to clear it — which is
    also what keeps every `setState` below inside an asynchronous callback,
    where it belongs, rather than in an effect body.
  */
  const [channel, setChannel] = useState<string | null>(null);
  const [tagged, setTagged] = useState<{ jobId: string; frame: ProgressFrame } | null>(null);

  useEffect(() => {
    if (!jobId) return;

    let alive = true;
    let detach: (() => void) | null = null;
    /*
      Held here rather than read back out of React state.

      `isFresher` needs the previous frame to discard a replay, and reading that
      from state inside the callback would either capture a stale closure or
      require the effect to depend on the frame — which would tear the
      subscription down and rebuild it on every single frame, replaying the
      cached value each time, which is the exact problem the check exists for.
    */
    let latest: ProgressFrame | null = null;

    void (async () => {
      const channel = await getChannelId();
      if (!alive || !channel) return;

      // Published as soon as it is known, ahead of the subscription: the caller
      // needs it for its next poll whether or not any frame ever arrives.
      setChannel(channel);

      const database = await getProgressDatabase();
      if (!alive || !database) return;

      try {
        const { off, onValue, ref } = await import("firebase/database");
        if (!alive) return;

        const node = ref(database, progressPath(channel, jobId));
        const handler = onValue(
          node,
          (snapshot) => {
            if (!alive) return;
            const value = snapshot.val() as ProgressFrame | null;
            /*
              Null is the normal terminal state, not an error: ./admin.ts removes
              the node a minute after a job finishes so the 1 GB tier does not
              accumulate one dead node per reconstruction forever. Keeping the
              last frame on screen rather than blanking it is the right response
              — the job did not un-finish.
            */
            if (!value || typeof value.at !== "number") return;
            if (!isFresher(value, latest)) return;
            latest = value;
            setTagged({ jobId, frame: value });

            // Nothing more will ever arrive on this path. Detaching is not just
            // tidiness: RTDB's free tier is 100 simultaneous connections, and a
            // listener per finished job on a list page adds up quickly.
            if (isTerminal(value.status)) {
              off(node, "value", handler);
              detach = null;
            }
          },
          () => {
            /*
              Almost always PERMISSION_DENIED, and almost always because the
              rules in RTDB_RULES were never deployed to the project. Silent on
              purpose: the poll underneath is unaffected, the reader loses
              nothing they can see, and a console error on every job in a list
              would be the loudest thing in the app for the smallest reason.
            */
          },
        );
        detach = () => off(node, "value", handler);
      } catch {
        // The database chunk failed to load. Polling continues.
      }
    })();

    return () => {
      alive = false;
      detach?.();
    };
  }, [jobId]);

  return {
    frame: tagged && tagged.jobId === jobId ? tagged.frame : null,
    channel,
  };
}
