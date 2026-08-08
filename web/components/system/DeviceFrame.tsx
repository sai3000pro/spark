"use client";

/**
 * Demo chrome. The robot's screen is a mounted iPhone, so being able to flip the
 * whole app into a 390×844 bezel mid-demo is useful — it shows the on-robot view
 * without a second build, and doubles as a live mobile-layout check.
 *
 * The bezel contains an <iframe>, not a scaled div, and that is the whole trick.
 * Tailwind's `sm:`/`md:` breakpoints resolve against the VIEWPORT, not the
 * container, so simply making a 390px-wide box gives you the desktop layout
 * crushed into 390px. An iframe has its own viewport, so every existing media
 * query resolves correctly with no component changes at all.
 *
 * The iframe loads the same route with `?chrome=off`, which tells the nested copy
 * of this component to render bare — otherwise it would draw its own bezel, and
 * so would that one's, forever.
 *
 * Lives in the root layout, so React keeps the mode across route changes.
 */
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

const BEZEL = 14;
const SCREEN_W = 390 - BEZEL * 2;
const SCREEN_H = 844 - BEZEL * 2;

export function DeviceFrame({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<"web" | "phone">("web");
  const pathname = usePathname();
  const nested = useSearchParams().get("chrome") === "off";

  // Inside the iframe: no bezel, no toggle, just the app — but inset from the top
  // so the dynamic island doesn't sit on the app chrome, the same way a real
  // iPhone's safe area works.
  if (nested) {
    // --frame-inset tells the landing hero how much vertical room the notch
    // padding has already taken, so it still ends exactly at the preview's fold.
    // Without it, ~46px of the hero — including the scroll cue — sits below the
    // fold in the one view that gets demoed.
    return (
      <div
        className="flex min-h-screen flex-col pt-[46px]"
        style={{ "--frame-inset": "46px" } as React.CSSProperties}
      >
        {children}
      </div>
    );
  }

  return (
    <>
      {mode === "web" ? (
        <div className="flex min-h-screen flex-col">{children}</div>
      ) : (
        // items-start, not items-center: the bezel is taller than most laptop
        // viewports, and centring it clips the island and status bar off the top.
        <div className="flex min-h-screen items-start justify-center p-6">
          <div
            className="relative shrink-0"
            style={{
              width: 390,
              height: 844,
              borderRadius: 52,
              background: "#232038",
              padding: BEZEL,
              boxShadow:
                "0 0 0 2px #3a3654, 0 0 0 6px #16141f, 0 40px 100px rgba(20,18,32,0.55), inset 0 0 0 1px rgba(255,255,255,0.05)",
            }}
          >
            <div
              className="absolute left-1/2 z-40 -translate-x-1/2 rounded-[22px] bg-black"
              style={{ top: 19, width: 126, height: 36 }}
            />
            <iframe
              // Remount on route change so opening phone mode always shows the
              // page you were looking at.
              key={pathname}
              src={`${pathname}?chrome=off`}
              title="Phone preview"
              className="block bg-cream"
              style={{ width: SCREEN_W, height: SCREEN_H, borderRadius: 42, border: 0 }}
            />
            <span className="absolute -left-1 top-24 h-8 w-1 rounded-l bg-[#3a3654]" />
            <span className="absolute -left-1 top-36 h-14 w-1 rounded-l bg-[#3a3654]" />
            <span className="absolute -left-1 top-[212px] h-14 w-1 rounded-l bg-[#3a3654]" />
            <span className="absolute -right-1 top-36 h-[72px] w-1 rounded-r bg-[#3a3654]" />
          </div>
        </div>
      )}

      <div
        className="riso-card fixed bottom-4 right-4 z-50 flex items-center gap-0.5 p-1 shadow-lg shadow-ink/10"
        role="group"
        aria-label="Preview device"
      >
        {(["phone", "web"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`tag rounded-[12px] px-2.5 py-1 text-[10px] transition-all duration-200 ease-(--ease-pop) ${
              mode === m ? "bg-ink text-cream-bright" : "text-ink-soft hover:text-ink"
            }`}
          >
            {m === "phone" ? "Phone" : "Web"}
          </button>
        ))}
      </div>
    </>
  );
}
