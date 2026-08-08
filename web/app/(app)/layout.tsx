/**
 * The app shell. Everything except the API renders inside this.
 *
 * It stays a route group rather than collapsing into the root layout so that
 * app/layout.tsx keeps its single job — the document, the fonts, the device
 * frame — while this one owns the chrome. No <html>/<body> here.
 */
import { AppBar } from "@/components/shell/AppBar";
import { LiveTripProvider } from "@/components/shell/LiveTripProvider";
import { getActiveTrip } from "@/lib/liveTrip";

export default function AppLayout({ children }: LayoutProps<"/">) {
  // Read on the server so the first paint is already correct — no idle→recording
  // flash while the client's first poll is in flight.
  const active = getActiveTrip();

  return (
    <LiveTripProvider initial={active}>
      <AppBar />
      {children}
    </LiveTripProvider>
  );
}
