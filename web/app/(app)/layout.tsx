/**
 * The AURORA-NIGHT shell: the original landing at `/`, plus `/globe`.
 *
 * Two designs ship side by side now. The journal (FIELD NOTES — cream paper,
 * pine ink) owns app/layout.tsx, `/walk`, `/trip/*` and `/landing-page`. This
 * route group is the aurora scene: navy ground, the blob companion, the app bar
 * with the Albums|Globe switch.
 *
 * `.aurora-app` is the seam between them. The root layout paints the document
 * cream for the journal, so this wrapper is what re-grounds its own subtree in
 * navy and declares the tokens the aurora components read directly rather than
 * through Tailwind — `--bg`, `--appbar-h`, `--frame-inset`. See the block of the
 * same name in globals.css. Without it the hero renders navy artwork on cream
 * paper and `.hero-stage`'s container queries resolve against the wrong box.
 *
 * It stays a route group rather than collapsing into the root layout so that
 * app/layout.tsx keeps its single job — the document, the fonts, the device
 * frame. No <html>/<body> here.
 */
import { AppBar } from "@/components/shell/AppBar";
import { LiveTripProvider } from "@/components/shell/LiveTripProvider";
import { getActiveTrip } from "@/lib/liveTrip";

export default function AppLayout({ children }: LayoutProps<"/">) {
  // Read on the server so the first paint is already correct — no idle→recording
  // flash while the client's first poll is in flight.
  const active = getActiveTrip();

  return (
    <div className="aurora-app flex flex-col">
      <LiveTripProvider initial={active}>
        <AppBar />
        {children}
      </LiveTripProvider>
    </div>
  );
}
