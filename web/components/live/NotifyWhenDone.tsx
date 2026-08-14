"use client";

/**
 * "Tell me when it's done" — the only notification this app will ever send.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT IS FOR, SAID PLAINLY
 *
 * A KIRI reconstruction is minutes. The watcher beside this gives up after
 * thirty of them, and the honest advice for a wait that long is "close the tab
 * and come back" — except nothing then tells you when to come back. That is the
 * entire feature. It is not engagement, there is no digest, and there is nothing
 * else it could ever be used for, so the copy says exactly that and the reader
 * can hold us to it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT ASKS ONCE, WHEN ASKED TO
 *
 * A notification permission is close to irreversible. Denied does not expire and
 * cannot be re-requested — undoing it means finding a padlock menu — and Chrome
 * demotes origins whose prompts get dismissed. Spending that on page load, on
 * someone who has not yet seen a reconstruction finish and has no idea what this
 * app is, is how a genuinely useful notification becomes a permanently blocked
 * origin.
 *
 * So three rules, all visible in the code below:
 *
 *   1. NOTHING happens on mount. The effect reads `Notification.permission`,
 *      which shows no dialog, and stops there.
 *   2. The prompt is raised from a click and nowhere else.
 *   3. Once it has been raised, it is never raised again by us. A dismissal is
 *      remembered in localStorage and this component renders nothing forever
 *      after — because the alternative, an offer that reappears on every visit,
 *      is the behaviour that earns a block.
 *
 *      That is deliberately one-way and the cost is real: someone who dismisses
 *      by accident has no route back inside the app. It is still the right
 *      trade. A dismissal is cheap to have taken too seriously; a block is not,
 *      and a block is what the other choice buys.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE IT LIVES
 *
 * Inside the pending-reconstructions panel, which renders itself away when there
 * is nothing outstanding. So the offer only exists on a screen that is already
 * showing someone a wait — the one moment it is an answer to a question they
 * actually have — and never on a page they arrived at for another reason.
 *
 * And it renders nothing at all when Firebase is not configured, which is how
 * this app runs today. No dead button, no "coming soon", no explanation of a
 * capability this deployment does not have.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { disablePush, enablePush, pushPermission, pushSupport } from "@/lib/firebase/messaging";

/**
 * Remembers that we have spent our one ask.
 *
 * Only covers the DISMISSED case. A grant and a denial are both remembered by
 * the browser itself in `Notification.permission`, durably and across origins'
 * worth of clearing that we do not control — so writing our own copy of those
 * would just be a second answer that can disagree with the real one.
 */
const ASKED_KEY = "spark.push.asked";

function alreadyAsked(): boolean {
  try {
    return window.localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    // Private mode, or storage disabled. Treat as not-yet-asked: the browser's
    // own permission state is still authoritative for the two cases that matter.
    return false;
  }
}

function rememberAsked(): void {
  try {
    window.localStorage.setItem(ASKED_KEY, "1");
  } catch {
    // Nothing to do. Worst case the offer appears again next visit.
  }
}

type View =
  /** Firebase absent, browser incapable, insecure origin. Renders nothing. */
  | { k: "unavailable" }
  /** Not asked yet. The one state with a button in it. */
  | { k: "offer" }
  | { k: "asking" }
  | { k: "on"; note: string }
  | { k: "blocked"; note: string }
  /** Asked and refused or dismissed. Renders nothing, forever. */
  | { k: "done" };

/**
 * What the browser says before anybody has done anything.
 *
 * Read through `useSyncExternalStore` rather than assigned from an effect, for
 * the same three reasons as lib/reconstruction/useReconTarget.ts: none of it
 * exists on the server, none of it may be touched during render, and all of it
 * can change from outside React. Doing it with `useState` + `useEffect` would
 * render the wrong thing first and then correct it, which for this component
 * means a control flashing in and out on every page load.
 *
 * Every read here is PASSIVE. `pushSupport()` is feature detection,
 * `pushPermission()` is a property read, `alreadyAsked()` is localStorage —
 * none of the three can show a dialog. That is the property that makes it safe
 * to run this before anyone has clicked anything.
 */
type Initial = "unavailable" | "offer" | "on" | "blocked" | "done";

/**
 * Cached so the snapshot is referentially stable and the localStorage read
 * stays off the render path after the first one. Nothing invalidates it:
 * everything that changes after mount is a user action, and those are held in
 * the override below rather than here.
 */
let initialCache: Initial | null = null;

function readInitial(): Initial {
  if (initialCache !== null) return initialCache;
  const support = pushSupport();
  if (!support.ok) return (initialCache = "unavailable");
  const permission = pushPermission();
  if (permission === "granted") return (initialCache = "on");
  if (permission === "denied") return (initialCache = "blocked");
  return (initialCache = alreadyAsked() ? "done" : "offer");
}

/**
 * Nothing external ever notifies us. The permission can change from the
 * browser's own UI, but there is no event for it, and polling a permission in
 * order to move a control around under someone is worse than being stale until
 * the next load.
 */
function subscribe(): () => void {
  return () => {};
}

/** The server knows none of this, so it renders nothing and hydration agrees. */
function serverSnapshot(): Initial {
  return "unavailable";
}

const INITIAL_VIEW: Record<Initial, View> = {
  unavailable: { k: "unavailable" },
  offer: { k: "offer" },
  done: { k: "done" },
  on: { k: "on", note: "This browser will be told when a reconstruction finishes." },
  blocked: {
    k: "blocked",
    note: "notifications are blocked for this site · your browser's padlock menu can undo that",
  },
};

export function NotifyWhenDone() {
  const initial = useSyncExternalStore(subscribe, readInitial, serverSnapshot);

  /** Set by a user action, or by the silent re-registration below. Wins. */
  const [override, setOverride] = useState<View | null>(null);
  const view = override ?? INITIAL_VIEW[initial];

  const reRegistered = useRef(false);
  useEffect(() => {
    /*
      Already granted, but this process may know nothing about it — the registry
      is in memory until a Supabase session exists, so a server restart forgets
      the token while the browser keeps the permission. Re-registering is
      completely silent: the permission is already held, so `enablePush()` gets
      an instant "granted" from `requestPermission()` and shows no dialog.

      Once per mount, guarded by a ref rather than by a dependency, so this
      cannot re-enter when it sets state.
    */
    if (initial !== "on" || reRegistered.current) return;
    reRegistered.current = true;
    void enablePush().then((result) => {
      if (result.k === "on") setOverride({ k: "on", note: result.note });
    });
  }, [initial]);

  const ask = useCallback(async () => {
    // Recorded BEFORE the prompt, not after. If the tab is closed mid-dialog, or
    // the click handler throws, the ask still counts — the browser saw it, and
    // "we might not have asked" is not a good enough reason to ask again.
    rememberAsked();
    setOverride({ k: "asking" });
    const result = await enablePush();
    if (result.k === "on") {
      setOverride({
        k: "on",
        note: result.durable
          ? result.note
          : `${result.note.replace(/\.$/, "")} — until this server restarts.`,
      });
      return;
    }
    if (result.k === "denied") {
      setOverride({ k: "blocked", note: result.note.toLowerCase().replace(/\.$/, "") });
      return;
    }
    setOverride({ k: "done" });
  }, []);

  const stop = useCallback(async () => {
    setOverride({ k: "done" });
    await disablePush();
  }, []);

  if (view.k === "unavailable" || view.k === "done") return null;

  if (view.k === "on") {
    return (
      <p className="fnote mt-3 flex flex-wrap items-center gap-2 text-[10px] leading-relaxed text-ink-faint">
        [ {view.note} ]
        <button
          type="button"
          onClick={() => void stop()}
          className="underline underline-offset-2 transition-colors hover:text-ink"
        >
          stop telling me
        </button>
      </p>
    );
  }

  if (view.k === "blocked") {
    // No button. There is nothing a page can do about a denied permission, and
    // a control that cannot work is worse than the sentence explaining why.
    return (
      <p className="fnote mt-3 text-[10px] leading-relaxed text-ink-faint">[ {view.note} ]</p>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <button
        type="button"
        onClick={() => void ask()}
        disabled={view.k === "asking"}
        className="pill-ghost px-3 py-1.5 text-[12px] text-ink-soft disabled:opacity-40"
      >
        {view.k === "asking" ? "Asking your browser…" : "Tell me when it's done"}
      </button>
      <p className="fnote max-w-prose text-[9.5px] leading-relaxed text-ink-faint">
        [ one notification when a reconstruction finishes, and nothing else ever · reconstructing
        takes minutes, so this is what lets you close the tab · asked once ]
      </p>
    </div>
  );
}
