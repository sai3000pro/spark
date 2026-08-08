/**
 * The status bar plus the ⌘K search trigger, composed on the server.
 *
 * Search needs the object index, and the index is derived from the trip — so this
 * reads it here rather than threading it through every page. `buildTrip()` is
 * memoized in lib/mock, so calling it from another place costs nothing.
 */
import { RobotStatusBar } from "@/components/shell/RobotStatusBar";
import { SearchMount } from "@/components/search/SearchMount";
import { getObjectIndexView } from "@/lib/tripData";

interface Props {
  backHref?: string;
  title?: string;
  subtitle?: string;
}

export function TopBar({ backHref, title, subtitle }: Props) {
  const index = getObjectIndexView();

  return (
    <RobotStatusBar backHref={backHref} title={title} subtitle={subtitle}>
      <SearchMount
        entries={index.entries}
        durationSec={index.durationSec}
        tripId={index.tripId}
      />
    </RobotStatusBar>
  );
}
