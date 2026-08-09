/**
 * No journeys yet.
 *
 * Deliberately NOT a dashed pseudo-card sitting in the grid next to real albums —
 * a fake card that isn't a card is precisely the tell this redesign is trying to
 * remove. It is a centred block in the space where the grid would be.
 */
import { SparkMark } from "@/components/shell/SparkMark";

export function EmptyLibrary() {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <span className="opacity-40">
        <SparkMark size={40} />
      </span>
      <p className="font-display text-[15px] font-semibold text-fog-200">No journeys yet</p>
      <p className="max-w-[42ch] text-[13px] leading-relaxed text-fog-400">
        Spark hasn&apos;t been out yet. Start a trip and it will decide on its own what was worth
        keeping.
      </p>
    </div>
  );
}
