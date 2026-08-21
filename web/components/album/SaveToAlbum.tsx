"use client";

/**
 * Where does this walk belong?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STEP THAT TURNS A CAPTURE INTO A COLLECTION
 *
 * A walk that exists on its own is a file with moments in it. A walk filed
 * under "Autumn in Waterloo" alongside three others is the thing this product
 * is actually for — and the globe can pin it under one name instead of
 * scattering four unrelated dots over the same park.
 *
 * Two answers only, and they are the two people actually have: this starts
 * something new, or it belongs with something that already exists. Deliberately
 * NOT a required step — a walk is already saved and openable by the time this
 * appears, so skipping is a real option and the copy says so. Forcing a filing
 * decision at the moment someone most wants to look at what they just made is
 * the kind of nagging that gets a product closed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The list is fetched when the component mounts rather than passed down,
 * because both callers (CapturedWalk, VideoWalkPanel) are deep inside client
 * trees that have no album data and no reason to.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { MAX_TITLE, normaliseTitle } from "@/lib/albumTitle";
import type { Album } from "@/lib/albums";

type State =
  | { k: "loading" }
  | { k: "choosing"; albums: Album[] }
  | { k: "naming"; albums: Album[] }
  | { k: "saving" }
  | { k: "saved"; album: Album }
  | { k: "skipped" }
  | { k: "error"; message: string; albums: Album[] };

export function SaveToAlbum({
  journeyId,
  onDone,
}: {
  /** The walk being filed. */
  journeyId: string;
  onDone?: (album: Album | null) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ k: "loading" });
  const [title, setTitle] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/albums", { cache: "no-store" });
        const body = (await res.json()) as { albums: Album[] };
        if (!alive) return;
        // Straight to naming when there is nothing to choose between — an empty
        // picker with a "new album" button under it is one pointless tap.
        setState(
          body.albums.length === 0
            ? { k: "naming", albums: [] }
            : { k: "choosing", albums: body.albums },
        );
      } catch {
        if (alive) setState({ k: "naming", albums: [] });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const albumsOf = (s: State): Album[] =>
    "albums" in s ? s.albums : [];

  const fileInto = useCallback(
    async (album: Album) => {
      const previous = state;
      setState({ k: "saving" });
      try {
        const res = await fetch(`/api/albums/${album.id}/journeys`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ journeyId }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { album: Album };
        setState({ k: "saved", album: body.album });
        onDone?.(body.album);
        // The library and the globe both group by album now.
        router.refresh();
      } catch {
        setState({
          k: "error",
          message: "Couldn't file it just now. The walk is still saved.",
          albums: albumsOf(previous),
        });
      }
    },
    [journeyId, onDone, router, state],
  );

  const createAndFile = useCallback(async () => {
    const clean = normaliseTitle(title);
    if (!clean) return;
    const previous = state;
    setState({ k: "saving" });
    try {
      const res = await fetch("/api/albums", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: clean, journeyId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { album: Album };
      setState({ k: "saved", album: body.album });
      onDone?.(body.album);
      router.refresh();
    } catch {
      setState({
        k: "error",
        message: "Couldn't make that album. The walk is still saved.",
        albums: albumsOf(previous),
      });
    }
  }, [title, journeyId, onDone, router, state]);

  if (state.k === "loading" || state.k === "saving") {
    return (
      <p className="fnote mt-3 text-[10px] text-ink-faint">
        [ {state.k === "saving" ? "filing it" : "reading your albums"}… ]
      </p>
    );
  }

  if (state.k === "skipped") {
    return (
      <p className="fnote mt-3 text-[10px] text-ink-faint">
        [ left unfiled · you can add it to an album later ]
      </p>
    );
  }

  if (state.k === "saved") {
    return (
      <p className="fnote mt-3 text-[10px] text-moss">
        [ filed under {state.album.title} ·{" "}
        {state.album.journeyIds.length}{" "}
        {state.album.journeyIds.length === 1 ? "walk" : "walks"} ]
      </p>
    );
  }

  const naming = state.k === "naming";
  const clean = normaliseTitle(title);

  return (
    <div className="mt-4 flex flex-col gap-2.5 border-t border-ink/10 pt-4">
      <p className="text-[13px] leading-relaxed text-ink">
        {naming ? "Name the album this starts" : "Put this walk somewhere"}
      </p>

      {state.k === "error" && (
        <p className="fnote text-[10px] text-clay">[ {state.message} ]</p>
      )}

      {!naming && (
        <div className="flex flex-col gap-1.5">
          {state.albums.map((album) => (
            <button
              key={album.id}
              type="button"
              onClick={() => void fileInto(album)}
              className="flex items-baseline justify-between gap-3 rounded-[3px] border border-ink/15 px-3 py-2 text-left transition-colors hover:border-ink/35"
            >
              <span className="text-[13px] text-ink">{album.title}</span>
              <span className="fnote shrink-0 text-[9.5px] text-ink-faint">
                {album.journeyIds.length}{" "}
                {album.journeyIds.length === 1 ? "walk" : "walks"}
              </span>
            </button>
          ))}
        </div>
      )}

      {naming ? (
        <div className="flex flex-col gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && clean) void createAndFile();
            }}
            maxLength={MAX_TITLE}
            placeholder="Autumn in Waterloo"
            autoComplete="off"
            className="rounded-[3px] border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-faint"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void createAndFile()}
              disabled={!clean}
              className="pill-brass px-3 py-1.5 text-[12.5px] disabled:opacity-40"
            >
              Create and file it
            </button>
            {state.albums.length > 0 && (
              <button
                type="button"
                onClick={() => setState({ k: "choosing", albums: state.albums })}
                className="fnote text-[10px] text-ink-faint underline underline-offset-2"
              >
                [ or pick an existing one ]
              </button>
            )}
            <SkipButton onSkip={() => { setState({ k: "skipped" }); onDone?.(null); }} />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setState({ k: "naming", albums: state.albums })}
            className="fnote text-[10px] text-ink-soft underline underline-offset-2"
          >
            [ start a new album ]
          </button>
          <SkipButton onSkip={() => { setState({ k: "skipped" }); onDone?.(null); }} />
        </div>
      )}
    </div>
  );
}

/** Always present. The walk is already saved; filing it is optional. */
function SkipButton({ onSkip }: { onSkip: () => void }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      className="fnote text-[10px] text-ink-faint underline underline-offset-2"
    >
      [ not now ]
    </button>
  );
}
