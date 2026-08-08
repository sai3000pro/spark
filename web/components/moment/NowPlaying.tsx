/**
 * The track Spark picked for a moment, in the design's Now Playing shape.
 *
 * Two departures from the mockup, both deliberate:
 *   - The mockup's progress bar sits at a hardcoded 37% and its timestamps read
 *     1:23 / 3:45. There is no audio to be 37% through, so the bar carries the
 *     moment's `vibe.energy` instead and says so.
 *   - The mockup's play button toggles a local boolean. Here it opens the real
 *     `spotifyUri`, so the affordance does what it looks like it does.
 *
 * `music` is optional on Moment by design — a short mundane stop should not get
 * scored — so the empty state is a real state, not an oversight.
 *
 * Server-safe.
 */
import type { Moment } from "@/lib/types";

interface Props {
  music: Moment["music"];
  vibe: Moment["vibe"];
  compact?: boolean;
}

export function NowPlaying({ music, vibe, compact }: Props) {
  if (!music) {
    return compact ? null : (
      <div className="rounded-xl border border-dashed border-ink-700 p-3">
        <p className="text-[12px] text-fog-300">No track picked for this moment.</p>
        <p className="mt-1 text-[11px] leading-relaxed text-fog-400">
          Energy was low and the window was short — the picker skipped it rather than putting
          music over a two-minute stop for fries.
        </p>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-machine-400/15 bg-machine-400/[0.06] px-3 py-2">
        <SpotifyGlyph size={30} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[12px] font-medium text-fog-100">
            {music.trackName}
          </div>
          <div className="truncate font-mono text-[11px] text-fog-400">{music.artist}</div>
        </div>
        <MoodBadge mood={vibe.mood} />
        <PlayLink uri={music.spotifyUri} size={16} />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-machine-400/15 bg-machine-400/[0.06] p-4">
      <div className="flex items-center gap-3">
        <SpotifyGlyph size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[13px] font-semibold text-fog-100">
            {music.trackName}
          </div>
          <div className="truncate font-mono text-[11px] text-fog-400">{music.artist}</div>
        </div>
        <PlayLink uri={music.spotifyUri} size={20} />
      </div>

      {/* The bar is energy, not playback position — labelled so it can't mislead. */}
      <div className="mt-3">
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-machine-400"
            style={{ width: `${Math.round(vibe.energy * 100)}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="tnum font-mono text-[10px] text-fog-400">
            energy {Math.round(vibe.energy * 100)}%
          </span>
          <MoodBadge mood={vibe.mood} prefix="matched to: " />
        </div>
      </div>

      <p className="mt-3 border-t border-white/[0.06] pt-2.5 text-[11px] leading-relaxed text-fog-300">
        <span className="text-fog-400">Picked because:</span> {music.chosenBecause}
      </p>

      {vibe.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
          {vibe.tags.map((tag) => (
            <span key={tag} className="font-mono text-[10px] text-fog-400">
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MoodBadge({ mood, prefix = "" }: { mood: string; prefix?: string }) {
  return (
    <span className="shrink-0 rounded border border-memory-400/20 bg-memory-400/15 px-1.5 py-0.5 font-mono text-[10px] text-memory-400">
      {prefix}
      {mood}
    </span>
  );
}

function PlayLink({ uri, size }: { uri: string; size: number }) {
  return (
    <a
      href={uri}
      className="shrink-0 text-machine-400 transition-opacity hover:opacity-80"
      title="Open in Spotify — mock URI until the playback SDK is wired up"
      aria-label="Open in Spotify"
    >
      <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path d="M5 3.5l13 6.5-13 6.5V3.5z" />
      </svg>
    </a>
  );
}

function SpotifyGlyph({ size }: { size: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-lg bg-machine-400/15"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size * 0.45} height={size * 0.45} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" fill="#1DB954" opacity="0.9" />
        <path d="M7 15.5c2.8-1.3 5.8-1.5 8.5-.8" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M6.5 12c3.5-1.5 7-1.8 10.5-.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M6 8.5c4-2 8.5-2 12-.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}
