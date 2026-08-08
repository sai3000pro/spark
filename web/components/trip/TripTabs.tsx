"use client";

/**
 * The trip's view tabs, extracted so they can render ABOVE the layout branch.
 *
 * They used to live inside the 288px rail, which cannot work now that the
 * Moments tab is full-width. Same visual language as before — and as ViewSwitch,
 * which borrowed it from here.
 */
export type TripTab = "moments" | "map" | "timeline" | "ask";

const TABS: Array<{ id: TripTab; label: string }> = [
  { id: "moments", label: "Moments" },
  { id: "map", label: "Map" },
  { id: "timeline", label: "Timeline" },
  { id: "ask", label: "Ask Spark" },
];

export function TripTabs({
  tab,
  onChange,
}: {
  tab: TripTab;
  onChange: (tab: TripTab) => void;
}) {
  return (
    <div
      className="flex shrink-0 gap-1 self-start rounded-xl bg-ink-800 p-1"
      role="tablist"
      aria-label="Trip views"
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => onChange(t.id)}
          className={`rounded-lg border px-3 py-1.5 font-display text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-machine-400/60 ${
            tab === t.id
              ? "border-machine-400/15 bg-ink-900 text-machine-400"
              : "border-transparent text-fog-400 hover:text-fog-200"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
