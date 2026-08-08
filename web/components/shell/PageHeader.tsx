/**
 * The one title on a screen.
 *
 * The app bar carries no per-page context, so this is where a page says what it
 * is: optional back link, eyebrow, h1, a line of metadata, and a right-hand slot
 * for stats. Server-safe — the back affordance is a <Link>, never an onClick.
 */
import Link from "next/link";
import type { ReactNode } from "react";

interface Props {
  backHref?: string;
  backLabel?: string;
  eyebrow?: string;
  title: string;
  /** Metadata line under the title. Usually mono, tabular figures. */
  meta?: ReactNode;
  description?: string;
  /** Stats or actions, right-aligned on wide screens. */
  aside?: ReactNode;
}

export function PageHeader({
  backHref,
  backLabel = "Back",
  eyebrow,
  title,
  meta,
  description,
  aside,
}: Props) {
  return (
    <header className="mb-6">
      {backHref && (
        <Link
          href={backHref}
          className="mb-3 inline-flex items-center gap-1.5 font-mono text-[11px] text-fog-400 transition-colors hover:text-machine-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-machine-400/60"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M10 3L5 8L10 13"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {backLabel}
        </Link>
      )}

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow text-machine-400">{eyebrow}</p>}
          <h1 className="mt-1 font-display text-[28px] font-bold leading-[1.1] tracking-[-0.02em] text-fog-100 sm:text-[34px]">
            {title}
          </h1>
          {meta && <p className="tnum mt-1.5 font-mono text-[11px] text-fog-400">{meta}</p>}
          {description && (
            <p className="mt-2 max-w-[52ch] text-[14px] leading-relaxed text-fog-300">
              {description}
            </p>
          )}
        </div>

        {aside}
      </div>
    </header>
  );
}
