"use client";

/**
 * The posed-capture option on the phone: offered when it can work, explained
 * plainly when it cannot.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A THIRD OPTION AND NOT A BETTER VERSION OF THE OTHER TWO
 *
 * The other two capture paths produce a video. A video has to have its camera
 * positions SOLVED afterwards — COLMAP, 2.5 minutes for 119 frames, and an
 * outright failure on a wall with no texture. This path records the positions
 * the phone already knows, so that stage never runs. It is a different KIND of
 * capture, not a nicer recorder, and the copy says so.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HONESTY RULES, WHICH ARE THE POINT OF THIS COMPONENT
 *
 * `lib/reconstruction/targets.ts` sets the standard: nothing is offered that is
 * not reachable, and where something is unavailable it still appears, with the
 * real reason. Here that means three things:
 *
 *   · An iPhone is told it is an iPhone. Safari does not implement WebXR, every
 *     browser on iOS is Safari underneath, and the honest sentence names that
 *     rather than saying "unsupported" and leaving someone to hunt through
 *     Settings. See lib/webxr/support.ts.
 *   · `camera-access` cannot be probed without a user gesture, so before anyone
 *     taps, this says "we'll know when you start" — never "supported".
 *   · When the capture ends with too few frames to reconstruct, it SAYS SO and
 *     offers the video path, rather than uploading a dataset that will produce
 *     a splat of nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNPROVEN ON HARDWARE. The conversion this feeds is verified against pycolmap
 * (web/scripts/verify-webxr.ts, tools/spark_studio/verify_webxr.py) and Brush
 * has trained from its output. The SESSION — permission prompt, camera texture,
 * frame pacing, everything below `capture.start()` — has never run on a phone,
 * because there is no Android device on the machine this was written on. See
 * docs/webxr_capture.md for the manual test that would close that gap.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { WebXrCapture, type CapturedFrame } from "@/lib/webxr/capture";
import {
  probeWebXr,
  UNKNOWN_WEBXR_SUPPORT,
  type WebXrSupport,
} from "@/lib/webxr/support";

/**
 * Fewer than this and there is no reconstruction to be had, whatever the poses
 * say. Matches the floor `spark_studio/pipeline.py` warns at for a video: below
 * about twenty frames a splat covers a sliver of the scene at best.
 */
const MIN_USEFUL_FRAMES = 20;

interface Props {
  handoffId: string;
  token: string;
  /** Called once the dataset is on the laptop. `note` is already phrased for a person. */
  onDelivered: (result: {
    sessionId: string;
    frames: number;
    bytes: number;
    note: string;
  }) => void;
  /** The person chose not to, or cannot. Fall back to the video path. */
  onDeclined: () => void;
}

type Stage =
  | { k: "probing" }
  | { k: "offer" }
  | { k: "capturing"; frames: number }
  | { k: "uploading"; frames: number }
  | { k: "failed"; message: string };

export function WebXRCapture({ handoffId, token, onDelivered, onDeclined }: Props) {
  const [support, setSupport] = useState<WebXrSupport>(UNKNOWN_WEBXR_SUPPORT);
  const [stage, setStage] = useState<Stage>({ k: "probing" });
  const captureRef = useRef<WebXrCapture | null>(null);

  useEffect(() => {
    let live = true;
    void probeWebXr().then((s) => {
      if (!live) return;
      setSupport(s);
      setStage({ k: "offer" });
    });
    return () => {
      live = false;
      // A session left open holds the camera and the compositor. Ending it on
      // unmount is not tidiness — a phone that navigates away mid-capture would
      // otherwise stay in AR with no page driving it.
      void captureRef.current?.stop();
    };
  }, []);

  const finish = useCallback(async () => {
    const capture = captureRef.current;
    if (!capture) return;
    captureRef.current = null;
    await capture.stop();

    const frames = capture.frames;
    if (frames.length < MIN_USEFUL_FRAMES) {
      setStage({
        k: "failed",
        message:
          `Only ${frames.length} usable frames — a splat needs at least ` +
          `${MIN_USEFUL_FRAMES}. Frames are only kept when the phone actually ` +
          `moves, so a slow walk right around the subject gets there fastest.`,
      });
      return;
    }

    setStage({ k: "uploading", frames: frames.length });

    const body = new FormData();
    body.set(
      "manifest",
      JSON.stringify({
        userAgent: navigator.userAgent,
        frames: frames.map((f) => f.record),
      }),
    );
    frames.forEach((f, i) => body.set(`frame_${i + 1}`, f.jpeg, `frame_${i + 1}.jpg`));

    try {
      const res = await fetch(`/api/capture/posed/${handoffId}`, {
        method: "POST",
        headers: { "x-handoff-token": token },
        body,
      });
      const data = (await res.json().catch(() => ({}))) as {
        sessionId?: string;
        frames?: number;
        bytes?: number;
        note?: string;
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setStage({
          k: "failed",
          message:
            `Your laptop refused the capture (${data.error ?? res.status}` +
            `${data.detail ? `: ${data.detail}` : ""}). The frames are still on ` +
            `this phone until you leave this page.`,
        });
        return;
      }
      onDelivered({
        sessionId: data.sessionId ?? "",
        frames: data.frames ?? frames.length,
        // The server's count, not ours: it is the one that measured what
        // actually landed on disk.
        bytes: data.bytes ?? 0,
        note: data.note ?? "",
      });
    } catch {
      setStage({
        k: "failed",
        message:
          "Could not reach your laptop. Check you are still on the same Wi-Fi, " +
          "then try again — nothing has been sent yet.",
      });
    }
  }, [handoffId, token, onDelivered]);

  const start = useCallback(async () => {
    // NOT awaited before requestSession: `start()` calls it synchronously off
    // this handler, because WebXR requires transient user activation and there
    // is no way to ask for it after an await.
    const capture = new WebXrCapture({
      onFrame: (_frame: CapturedFrame, total: number) =>
        setStage({ k: "capturing", frames: total }),
      onEnd: () => {
        // The headset/system back gesture ends the session without going
        // through our button, so delivery has to be driven from here too.
        void finish();
      },
    });
    captureRef.current = capture;
    setStage({ k: "capturing", frames: 0 });
    try {
      await capture.start();
    } catch (err) {
      captureRef.current = null;
      setSupport((s) => ({
        ...s,
        available: false,
        cameraAccess: "refused",
        blockedBecause:
          err instanceof Error
            ? err.message
            : "This phone would not start an AR session with camera access.",
      }));
      setStage({ k: "offer" });
    }
  }, [finish]);

  if (stage.k === "probing") {
    return <p className="text-sm opacity-55">Checking what this phone can do…</p>;
  }

  if (stage.k === "capturing") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed">
          Walk slowly around the subject, keeping it in frame. Frames are kept
          only when the phone moves, so standing still adds nothing.
        </p>
        <p className="font-mono text-3xl tabular-nums">{stage.frames}</p>
        <p className="text-xs opacity-55">
          posed frames · {MIN_USEFUL_FRAMES} is the minimum worth reconstructing
        </p>
        <button
          type="button"
          onClick={() => void finish()}
          className="rounded-lg border border-current/25 px-4 py-2.5 text-sm font-medium"
        >
          Done — send to the laptop
        </button>
      </div>
    );
  }

  if (stage.k === "uploading") {
    return (
      <p className="text-sm leading-relaxed">
        Sending {stage.frames} frames and their camera positions to your laptop…
      </p>
    );
  }

  if (stage.k === "failed") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed">{stage.message}</p>
        <button
          type="button"
          onClick={onDeclined}
          className="rounded-lg border border-current/25 px-4 py-2.5 text-sm font-medium"
        >
          Record a video instead
        </button>
      </div>
    );
  }

  // ── The offer, or the reason there isn't one ───────────────────────────────
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={!support.available}
        onClick={() => void start()}
        className="flex flex-col items-start gap-1 rounded-xl border border-current/25 px-5 py-4 text-left disabled:opacity-35"
      >
        <span className="text-base font-medium">Scan with position tracking</span>
        <span className="text-xs leading-relaxed opacity-60">
          Your phone records where it is as well as what it sees, so your laptop
          skips the slowest step entirely.
        </span>
      </button>

      {support.blockedBecause && (
        <p className="text-xs leading-relaxed opacity-50">{support.blockedBecause}</p>
      )}

      {support.available && support.cameraAccessUnproven && (
        // Said BEFORE the tap, not after. Whether this phone will hand the
        // camera image to a web page cannot be asked without a user gesture —
        // see lib/webxr/support.ts — so promising it here would be inventing an
        // answer nobody has.
        <p className="text-xs leading-relaxed opacity-50">
          Your phone can track its position. Whether it will also share the
          camera image with this page is something we can only find out by
          starting — if it won&rsquo;t, we&rsquo;ll say so and you can record a
          video instead.
        </p>
      )}
    </div>
  );
}
