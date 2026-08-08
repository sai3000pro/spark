"use client";

/**
 * The "where is my X?" entry point. Lives in the header so it is reachable from
 * every page — on the robot this is a voice query, here it is ⌘K.
 */
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ObjectSearch } from "./ObjectSearch";
import type { ObjectIndexEntry } from "@/lib/types";

interface Props {
  entries: ObjectIndexEntry[];
}

export function SearchMount({ entries }: Props) {
  const [open, setOpen] = useState(false);

  // Which trip is on screen, read from the URL rather than threaded down from a
  // layout — a layout cannot see its child page's params, and this is the one
  // fact the palette needs to know whether a nav pose is meaningful.
  const pathname = usePathname();
  const activeTripId = /^\/trip\/([^/]+)/.exec(pathname)?.[1];

  const onKey = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setOpen((v) => !v);
    }
    if (e.key === "Escape") setOpen(false);
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

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
