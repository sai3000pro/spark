"use client";

/**
 * "Where was this?" — the fallback for a clip that did not record its own answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS A PLAIN TEXT BOX
 *
 * Because the two things people actually have are a coordinate on the clipboard
 * and the name of the place, and a single field takes both. A map picker would
 * be prettier and would demand a gesture from someone who already knows the
 * answer; a lat field and a lng field would reject the string every map app
 * puts on your clipboard.
 *
 * A coordinate is parsed locally and never leaves the machine. A name is
 * geocoded once, on submit — never per keystroke, which is both a privacy
 * property and what Nominatim's usage policy asks for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT REPORTS WHAT WAS MATCHED, NOT WHAT WAS TYPED
 *
 * Searching "the park" and being shown "the park" tells you nothing. The
 * response carries the geocoder's own display name, and that is what appears
 * here — so a match in the wrong Ohio is visible at once rather than on the
 * globe an hour later.
 */
import { useState } from "react";

interface Props {
  tripId: string;
  /** Shown when the walk already knows where it was, so this reads as a change. */
  known?: boolean;
}

type State =
  | { k: "idle" }
  | { k: "working" }
  | { k: "placed"; note: string }
  | { k: "missed"; note: string };

export function SetPlace({ tripId, known = false }: Props) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ k: "idle" });

  const submit = async () => {
    const q = query.trim();
    if (!q) return;
    setState({ k: "working" });
    try {
      const res = await fetch(`/api/walk/${tripId}/place`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        note?: string;
        error?: string;
      };
      if (!res.ok) {
        setState({ k: "missed", note: body.error ?? `The server said ${res.status}.` });
        return;
      }
      // `ok: false` means "understood you, found nothing" — a normal answer
      // with a suggestion attached, not a failure to render in red.
      setState(
        body.ok
          ? { k: "placed", note: body.note ?? "Placed." }
          : { k: "missed", note: body.note ?? "Could not place that." },
      );
      if (body.ok) setQuery("");
    } catch (err) {
      setState({ k: "missed", note: err instanceof Error ? err.message : String(err) });
    }
  };

  if (state.k === "placed") {
    return <p className="fnote mt-2 text-[9.5px] leading-relaxed text-lagoon">[ {state.note} ]</p>;
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="fnote text-[9.5px] leading-relaxed text-ink-faint">
        [ {known ? "somewhere else?" : "where was this?"} · a place name, or paste a coordinate ]
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter submits. This sits inside panels that have their own
            // buttons, so it is deliberately not a <form> — a stray submit
            // would reload the page and lose the walk, which lives in memory.
            if (e.key === "Enter") void submit();
          }}
          placeholder="Stackt Market, Toronto"
          spellCheck={false}
          disabled={state.k === "working"}
          className="min-w-0 flex-1 rounded-[3px] border border-ink/15 bg-transparent px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-faint disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={state.k === "working" || !query.trim()}
          className="pill-ghost px-3 py-1.5 text-[12px] text-ink-soft disabled:opacity-40"
        >
          {state.k === "working" ? "Looking…" : "Place it"}
        </button>
      </div>
      {state.k === "missed" && (
        <p className="fnote text-[9.5px] leading-relaxed text-clay">[ {state.note} ]</p>
      )}
    </div>
  );
}
