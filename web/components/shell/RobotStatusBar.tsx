/**
 * The bar across the top of every screen. It is the robot's status, not the app's
 * navigation — which is why it carries follow-mode and battery rather than links.
 *
 * Server-safe: navigation is a `backHref` <Link>, never an onClick, so server
 * components can render it directly.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { SparkMark } from "@/components/shell/SparkMark";

interface Props {
  /** When set, the bar shows a back chevron instead of the wordmark. */
  backHref?: string;
  title?: string;
  subtitle?: string;
  /** Right-hand slot, before the status pills — the search trigger goes here. */
  children?: ReactNode;
}

export function RobotStatusBar({ backHref, title, subtitle, children }: Props) {
  return (
    <div className="glass sticky top-0 z-30 border-x-0 border-t-0">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:px-5">
        {backHref ? (
          <Link
            href={backHref}
            aria-label="Back"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-machine-400/10 text-machine-400 transition-colors hover:bg-machine-400/20"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M10 3L5 8L10 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        ) : (
          <Link href="/" className="group flex shrink-0 items-center gap-2">
            <SparkMark />
            <span className="font-display text-[15px] font-bold tracking-[0.18em] text-machine-400">
              SPARK
            </span>
          </Link>
        )}

        {title && (
          <div className="min-w-0">
            <div className="truncate font-display text-[14px] font-semibold text-fog-100">
              {title}
            </div>
            {subtitle && (
              <div className="tnum truncate font-mono text-[11px] text-fog-400">{subtitle}</div>
            )}
          </div>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {children}
          <FollowPill />
          <Battery percent={78} />
        </div>
      </div>
    </div>
  );
}

/** Mock telemetry — the robot isn't connected tonight, and the pill says "mock". */
function FollowPill() {
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-machine-400/25 bg-machine-400/10 px-2.5 py-1 font-mono text-[11px] text-machine-400 sm:inline-flex"
      title="Follow mode. Mock telemetry — no robot is connected yet."
    >
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-signal-400" />
      Follow
    </span>
  );
}

function Battery({ percent }: { percent: number }) {
  return (
    <span className="tnum flex items-center gap-1 font-mono text-[11px] text-fog-400">
      <svg width="16" height="10" viewBox="0 0 16 10" fill="none" aria-hidden>
        <rect x="0.5" y="0.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeOpacity="0.5" />
        <rect x="14" y="3" width="1.5" height="4" rx="0.5" fill="currentColor" fillOpacity="0.4" />
        <rect
          x="2"
          y="2"
          width={Math.max(1, (percent / 100) * 10)}
          height="6"
          rx="0.5"
          fill="currentColor"
          fillOpacity="0.55"
        />
      </svg>
      {percent}%
    </span>
  );
}
