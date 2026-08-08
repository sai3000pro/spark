"use client";

import { useState } from "react";
import { timecode } from "@/lib/format";
import { questionsFor, type QAAnswer } from "@/lib/momentQA";
import type { Moment } from "@/lib/types";

interface Props {
  moment: Moment;
  onCite?: (segmentIds: string[]) => void;
}

/**
 * Ask about the moment. Answers are templated but the retrieval is real — every
 * one carries the transcript segments it came from, which get highlighted in the
 * panel beside it.
 */
export function MomentQA({ moment, onCite }: Props) {
  const questions = questionsFor(moment);
  const [asked, setAsked] = useState<{ label: string; result: QAAnswer } | null>(null);

  if (!questions.length) {
    return (
      <p className="text-[12px] text-fog-400">
        Nothing here to ask about — no speech and no tracked objects.
      </p>
    );
  }

  const ask = (q: (typeof questions)[number]) => {
    const result = q.run(moment);
    setAsked({ label: q.label, result });
    onCite?.(result.citationIds);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {questions.map((q) => (
          <button
            key={q.id}
            type="button"
            onClick={() => ask(q)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              asked?.label === q.label
                ? "border-machine-500/60 bg-machine-500/12 text-machine-300"
                : "border-ink-700 text-fog-300 hover:border-machine-500/50 hover:text-machine-300"
            }`}
          >
            {q.label}
          </button>
        ))}
      </div>

      {asked && (
        <div className="mt-3 rounded-lg border border-ink-700 bg-ink-850 p-3">
          <p className="text-[13px] leading-relaxed text-fog-100">{asked.result.answer}</p>

          {asked.result.quotes?.length ? (
            <ul className="mt-2.5 space-y-1.5">
              {asked.result.quotes.map((seg) => (
                <li key={seg.id} className="border-l-2 border-machine-500/50 pl-2.5">
                  <span className="tnum mr-1.5 font-mono text-[10px] text-fog-400">
                    {timecode(seg.t)}
                  </span>
                  <span className="text-[12px] text-fog-300">
                    <span className="text-fog-200">{seg.speaker}:</span> “{seg.text}”
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {asked.result.citationIds.length > 0 && (
            <p className="mt-2.5 border-t border-ink-700 pt-2 text-[10px] text-fog-400">
              {asked.result.citationIds.length} cited{" "}
              {asked.result.citationIds.length === 1 ? "line" : "lines"} highlighted in the
              transcript.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
