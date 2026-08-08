"use client";

/**
 * Albums | Globe — the app's only global navigation.
 *
 * The visual language is lifted exactly from TripExplorer's tab strip rather than
 * invented: same `rounded-xl bg-ink-800 p-1` track, same active treatment.
 * Promoting a control the app already had into global nav is a large part of why
 * this reads as one designed system instead of a pile of screens.
 *
 * Real <Link>s, not buttons — these are navigations, so they prefetch, they
 * middle-click, and they work before hydration.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

const VIEWS = [
  { href: "/", label: "Albums" },
  { href: "/globe", label: "Globe" },
] as const;

export function ViewSwitch() {
  const pathname = usePathname();

  return (
    <nav className="flex shrink-0 gap-1 rounded-xl bg-ink-800 p-1" aria-label="Views">
      {VIEWS.map((view) => {
        // "/" would otherwise prefix-match every route in the app.
        const active = view.href === "/" ? pathname === "/" : pathname.startsWith(view.href);
        return (
          <Link
            key={view.href}
            href={view.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg border px-3 py-1.5 font-display text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-machine-400/60 ${
              active
                ? "border-machine-400/15 bg-ink-900 text-machine-400"
                : "border-transparent text-fog-400 hover:text-fog-200"
            }`}
          >
            {view.label}
          </Link>
        );
      })}
    </nav>
  );
}
