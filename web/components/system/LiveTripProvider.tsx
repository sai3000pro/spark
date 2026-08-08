"use client";

/**
 * One live-trip poller for the whole app.
 *
 * The record control in the toolbar and the recording card on the gallery both
 * need the same state. Two independent useActiveTrip() calls would mean two
 * pollers, two timers, and two router.refresh() calls per transition — so the
 * hook is instantiated exactly once here and shared.
 *
 * This is the app's first React context, and it earns it: the alternative is
 * prop-drilling live state from a server layout into a card several levels down
 * a server-rendered tree, which is precisely what a layout cannot do.
 */
import { createContext, useContext, type ReactNode } from "react";
import { useActiveTrip } from "@/lib/useActiveTrip";
import type { ActiveTripSnapshot } from "@/lib/liveTrip";

type LiveTrip = ReturnType<typeof useActiveTrip>;

const LiveTripContext = createContext<LiveTrip | null>(null);

export function LiveTripProvider({
  initial,
  children,
}: {
  initial: ActiveTripSnapshot | null;
  children: ReactNode;
}) {
  const value = useActiveTrip(initial);
  return <LiveTripContext.Provider value={value}>{children}</LiveTripContext.Provider>;
}

export function useLiveTrip(): LiveTrip {
  const ctx = useContext(LiveTripContext);
  if (!ctx) throw new Error("useLiveTrip must be used inside <LiveTripProvider>");
  return ctx;
}
