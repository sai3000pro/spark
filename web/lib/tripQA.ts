/**
 * Trip-level Q&A for the "Ask Spark" panel.
 *
 * The per-moment answers in lib/momentQA.ts need a full `Moment` — transcript,
 * objects, the lot. The trip page only ships `MomentSummary`, and pushing six
 * complete moments into the client bundle to power a chat box is the wrong trade.
 *
 * So the answers are precomputed here, on the server: `QA_QUESTIONS` is
 * deterministic, so running all of them for every moment up front costs one pass
 * and yields a couple of dozen short strings. The client then does intent matching
 * only, which is the part that has to be interactive.
 *
 * Nothing here is templated prose pretending to be retrieval — every answer comes
 * from momentQA running over the real transcript, and carries the moment it came
 * from so the UI can link to the evidence.
 */
import { QA_QUESTIONS } from "./momentQA";
import type { Moment } from "./types";

export interface MomentQAEntry {
  momentId: string;
  title: string;
  placeLabel: string;
  tStart: number;
  transcriptLineCount: number;
  speakers: string[];
  /** Keyed by QAQuestion.id — only the ones that applied to this moment. */
  answers: Record<string, string>;
}

export interface TripQAView {
  moments: MomentQAEntry[];
  momentCount: number;
  distinctLabelCount: number;
  transcriptLineCount: number;
}

export function buildTripQA(moments: Moment[]): TripQAView {
  const labels = new Set<string>();
  let lines = 0;

  const entries: MomentQAEntry[] = moments.map((m) => {
    for (const o of m.objects) labels.add(o.label);
    lines += m.transcript.length;

    const answers: Record<string, string> = {};
    for (const q of QA_QUESTIONS) {
      if (!q.applies(m)) continue;
      const { answer, quotes } = q.run(m);
      // Fold the strongest quote into the answer text. The moment page shows
      // quotes as highlighted transcript lines; here there is no transcript to
      // highlight, so the quote has to travel with the prose or be lost.
      const quote = quotes?.[0];
      answers[q.id] = quote ? `${answer} ${quote.speaker}: “${quote.text}”` : answer;
    }

    return {
      momentId: m.id,
      title: m.title,
      placeLabel: m.place.label,
      tStart: m.tStart,
      transcriptLineCount: m.transcript.length,
      speakers: [...new Set(m.transcript.map((s) => s.speaker))],
      answers,
    };
  });

  return {
    moments: entries,
    momentCount: moments.length,
    distinctLabelCount: labels.size,
    transcriptLineCount: lines,
  };
}

/**
 * Which precomputed answer a free-text question is asking for.
 *
 * Deliberately keyword matching rather than anything clever: it is inspectable,
 * it fails predictably, and tomorrow the whole function is replaced by a Claude
 * call that gets the same `TripQAView` as context.
 */
const INTENTS: Array<{ id: string; test: RegExp }> = [
  { id: "decisions", test: /\b(decid|decision|agree|conclu|settle|commit)/i },
  { id: "who", test: /\b(who|talked most|speaker|said more|quiet)/i },
  { id: "around", test: /\b(around|nearby|see|objects?|things? (were|was) there|what did you spot)/i },
  { id: "covered", test: /\b(cover|talk|discuss|conversation|say|said|about|topic|chat)/i },
];

export function intentFor(query: string): string | null {
  return INTENTS.find((i) => i.test.test(query))?.id ?? null;
}

/**
 * Which moment a question is about: an explicit mention wins, otherwise the
 * moment with the most transcript, since that is the one with something to say.
 */
export function momentFor(query: string, qa: TripQAView, intent: string): MomentQAEntry | null {
  const q = query.toLowerCase();

  const named = qa.moments.find((m) => {
    const words = [...m.title.toLowerCase().split(/\s+/), ...m.placeLabel.toLowerCase().split(/\s+/)]
      .filter((w) => w.length >= 4);
    return words.some((w) => q.includes(w));
  });
  if (named?.answers[intent]) return named;

  const applicable = qa.moments.filter((m) => m.answers[intent]);
  if (!applicable.length) return null;

  return applicable.reduce((a, b) => (b.transcriptLineCount > a.transcriptLineCount ? b : a));
}
