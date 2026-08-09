"use client";

/**
 * Demo chrome, retired down to its safe-area duty. The phone-bezel preview and
 * its floating Phone/Web toggle are gone (v5.8) — the app renders as itself.
 * What remains is the `?chrome=off` contract: a nested/embedded copy of the app
 * still gets the notch inset so app chrome never sits under a dynamic island.
 *
 * Lives in the root layout, so the behaviour holds across route changes.
 */
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

export function DeviceFrame({ children }: { children: ReactNode }) {
  const nested = useSearchParams().get("chrome") === "off";

  if (nested) {
    // --frame-inset tells the landing hero how much vertical room the notch
    // padding has already taken, so it still ends exactly at the preview's fold.
    return (
      <div
        className="flex min-h-screen flex-col pt-[46px]"
        style={{ "--frame-inset": "46px" } as React.CSSProperties}
      >
        {children}
      </div>
    );
  }

  return <div className="flex min-h-screen flex-col">{children}</div>;
}
