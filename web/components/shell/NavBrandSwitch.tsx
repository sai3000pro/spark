"use client";

/**
 * THE consistent nav element: the spark· logo + the Album | Map switch.
 *
 * One component, used on every surface so the nav reads identically — only the
 * TONE swaps. On the beige journal pages (album, map) it is dark ink; over the
 * dark aurora landing it is light ink. Same logo, same links, same
 * underline-on-active treatment either way. This is what makes the app feel like
 * one place instead of three screens.
 *
 * THE LOGO IS THE LANDING'S LOGO, exactly — the sleeping robot, the lowercase
 * word, the clay nib. It used to be a bare "Spark." wordmark here, which meant
 * the site had two logos: a character on the front door and a piece of type
 * everywhere behind it. A brand that changes when you walk through it is not a
 * brand. Only the WORD's colour is toned, because that is legibility, not
 * identity; the mark and the nib are the same on cream and on night.
 *
 * Kept in sync by hand with the header in components/home/Landing.tsx, which
 * cannot use this component — it carries the landing's own nav (Albums, night
 * air, Step into the walk) rather than the Album | Map switch.
 *
 * Real <Link>s — navigations, so they prefetch and middle-click. The active
 * underline uses the surface's accent (brass on paper, gold on night).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BlobMark } from "@/components/shell/BlobMark";

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
    active: "border-brass text-ink",
    idle: "border-transparent text-ink-faint hover:text-ink-soft",
  },
  night: {
    word: "text-fog-100",
    active: "border-gold text-fog-100",
    idle: "border-transparent text-fog-400 hover:text-fog-200",
  },
} as const;

export function NavBrandSwitch({ tone = "paper" }: { tone?: NavTone }) {
  const pathname = usePathname();
  const t = TONE[tone];

  return (
    // `items-center`, not `items-baseline`: the mark is a 41px cell and wants to
    // be centred against the row, exactly as it is on the landing. Baseline
    // alignment here hung the nav links off the blob's chin.
    <div className="flex items-center gap-5 sm:gap-6">
      <Link
        href="/"
        className={`flex items-center gap-1.5 text-[20px] font-semibold tracking-tight transition-opacity hover:opacity-70 ${t.word}`}
        aria-label="Spark home"
      >
        {/* 30 is the floor — below it the closed-eye sleeping pose degrades into
            a featureless oval. See the note in BlobMark. */}
        <BlobMark size={30} />
        {/* `items-baseline` INSIDE, because the clay nib is the period in
            "spark." and has to sit on the text's baseline even though the mark
            beside it is centred. */}
        <span className="flex items-baseline gap-0.5">
          spark
          <span
            aria-hidden
            className="pulse-dot inline-block h-[7px] w-[7px] rounded-full bg-clay"
          />
        </span>
      </Link>

      <nav className="flex items-center gap-4" aria-label="Views">
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
