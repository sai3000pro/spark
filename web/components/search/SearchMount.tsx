"use client";

/**
 * The "where is my X?" entry point. On the robot this is a voice query; here it
 * is a button in the app bar and ⌘K.
 *
 * IT ONLY EXISTS WHILE A TRIP IS RUNNING.
 *
 * "Where is my water bottle" is a question you ask mid-walk, with the robot out
 * there able to answer it. On the library it was a search box over a shelf of
 * finished albums — the most prominent control on the home screen, pointed at
 * the least urgent task. Gating it on the live trip also means the shortcut and
 * the palette come and go together: a ⌘K that opens a panel with no live robot
 * behind it is worse than no shortcut at all.
 */
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ObjectSearch } from "./ObjectSearch";
import { useLiveTrip } from "@/components/shell/LiveTripProvider";
import type { ObjectIndexEntry } from "@/lib/types";

interface Props {
  entries: ObjectIndexEntry[];
}

export function SearchMount({ entries }: Props) {
  const [open, setOpen] = useState(false);
  const { active } = useLiveTrip();

  // Which trip is on screen, read from the URL rather than threaded down from a
  // layout — a layout cannot see its child page's params, and this is the one
  // fact the palette needs to know whether a nav pose is meaningful.
  const pathname = usePathname();
  const activeTripId = /^\/trip\/([^/]+)/.exec(pathname)?.[1];

  // The shortcut is gated with the button: a ⌘K that opens a palette nothing on
  // screen advertises is a worse discovery story than no shortcut at all.
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (active) setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    },
    [active],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  /*
    Close on any change of trip, in render rather than in an effect.

    Without it, `open` survives the trip that set it: end a trip with the palette
    up and it merely unmounts, then the NEXT trip starts and the palette
    reappears on its own with nobody having asked for it. This is React's
    documented adjust-state-during-render pattern — the same one TripSessionCard
    uses — and unlike a setState in an effect it does not lint-error or paint the
    wrong state first.
  */
  const [seenTripId, setSeenTripId] = useState(active?.id ?? null);
  if ((active?.id ?? null) !== seenTripId) {
    setSeenTripId(active?.id ?? null);
    setOpen(false);
  }

  if (!active) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 py-1.5 pl-2.5 pr-2 text-[13px] text-fog-400 transition-colors hover:border-ink-600 hover:text-fog-200"
        aria-label="Ask where an object is"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M9.2 9.2 12.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <span className="hidden sm:inline">Where is my…</span>
        <kbd className="ml-1 hidden rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] text-fog-400 sm:inline">
          ⌘K
        </kbd>
      </button>

      {open && (
        <ObjectSearch
          entries={entries}
          activeTripId={activeTripId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
