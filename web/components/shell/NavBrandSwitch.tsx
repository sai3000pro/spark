"use client";

/**
 * THE consistent nav element: the Spark. wordmark + the Album | Map switch.
 *
 * One component, used on every surface so the nav reads identically — only the
 * TONE swaps. On the beige journal pages (album, map) it is dark ink; over the
 * dark aurora landing it is light ink. Same wordmark, same two links, same
 * underline-on-active treatment either way. This is what makes the app feel like
 * one place instead of three screens.
 *
 * Real <Link>s — navigations, so they prefetch and middle-click. The active
 * underline uses the surface's accent (brass on paper, gold on night).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

const VIEWS = [
  { href: "/album", label: "Album" },
  { href: "/trip", label: "Trip" },
  { href: "/walk", label: "Map" },
  { href: "/capture", label: "Capture" },
] as const;

export type NavTone = "paper" | "night";

const TONE = {
  paper: {
    word: "text-ink",
    dot: "text-brass-deep",
    active: "border-brass text-ink",
    idle: "border-transparent text-ink-faint hover:text-ink-soft",
  },
  night: {
    word: "text-fog-100",
    dot: "text-gold",
    active: "border-gold text-fog-100",
    idle: "border-transparent text-fog-400 hover:text-fog-200",
  },
} as const;

export function NavBrandSwitch({ tone = "paper" }: { tone?: NavTone }) {
  const pathname = usePathname();
  const t = TONE[tone];

  return (
    <div className="flex items-baseline gap-5 sm:gap-6">
      <Link
        href="/"
        className={`font-display text-lg font-bold tracking-tight transition-opacity hover:opacity-70 ${t.word}`}
        aria-label="Spark home"
      >
        Spark<span className={t.dot}>.</span>
      </Link>

      <nav className="flex items-baseline gap-4" aria-label="Views">
        {VIEWS.map((v) => {
          const active = pathname.startsWith(v.href);
          return (
            <Link
              key={v.href}
              href={v.href}
              aria-current={active ? "page" : undefined}
              className={`fnote border-b-2 pb-0.5 transition-colors ${active ? t.active : t.idle}`}
            >
              {v.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
