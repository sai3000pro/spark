/**
 * "What was covered in this conversation?"
 *
 * The prose here is templated — tomorrow it comes from a Claude call over the
 * moment's transcript and frames. What is NOT faked is the retrieval: topics,
 * quotes and speaker stats are computed from the actual transcript, and every
 * answer carries the segment ids it came from so the transcript highlights the
 * evidence. Templated wording over real citations beats a hardcoded paragraph,
 * and it works for any moment including ones we never authored.
 */
import type { Moment, TranscriptSegment } from "./types";

export interface QAAnswer {
  answer: string;
  /** TranscriptSegment ids backing the answer. Drives the highlight. */
  citationIds: string[];
  /** Verbatim lines worth showing under the answer. */
  quotes?: TranscriptSegment[];
}

export interface QAQuestion {
  id: string;
  label: string;
  /** Hidden when it would have nothing to work with. */
  applies: (m: Moment) => boolean;
  run: (m: Moment) => QAAnswer;
}

const STOP = new Set([
  "the", "and", "that", "this", "with", "have", "what", "your", "you", "for", "are", "was",
  "were", "not", "but", "all", "can", "get", "got", "just", "like", "one", "out", "its",
  "it's", "i'm", "we're", "they", "them", "then", "than", "there", "here", "into", "from",
  "about", "which", "would", "could", "should", "going", "goes", "went", "does", "did",
  "doing", "gonna", "okay", "yeah", "actually", "really", "very", "much", "more", "some",
  "any", "own", "off", "our", "his", "her", "she", "him", "who", "why", "how", "when",
  "where", "will", "well", "back", "make", "made", "take", "look", "know", "think", "say",
  "said", "tell", "see", "come", "want", "need", "give", "put", "let", "him", "everyone",
  "somebody", "someone", "thing", "things", "still", "again", "over", "under", "down",
  "long", "hold", "wait", "even", "also", "only", "because", "does", "done",
]);

const tokens = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));

/** Words that recur across lines — the closest thing to a topic without a model. */
function salientTopics(transcript: TranscriptSegment[], max = 4) {
  const counts = new Map<string, { n: number; segs: TranscriptSegment[] }>();
  for (const seg of transcript) {
    for (const w of new Set(tokens(seg.text))) {
      const e = counts.get(w) ?? { n: 0, segs: [] };
      e.n++;
      e.segs.push(seg);
      counts.set(w, e);
    }
  }
  return [...counts.entries()]
    .filter(([, e]) => e.n >= 2)
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, max)
    .map(([word, e]) => ({ word, count: e.n, segs: e.segs }));
}

const DECISION_RE =
  /\b(cut|cutting|agreed|agree|decid|first|instead|no\b|don't|we'll|we're going|let's|fine\b|right\b|then we|going to|write .*down)\b/i;

const list = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export const QA_QUESTIONS: QAQuestion[] = [
  {
    id: "covered",
    label: "What was covered?",
    applies: (m) => m.transcript.length >= 3,
    run: (m) => {
      const topics = salientTopics(m.transcript);
      if (!topics.length) {
        const first = m.transcript[0];
        return {
          answer: `Not much was said — ${m.transcript.length} short lines, nothing that recurred.`,
          citationIds: [first.id],
          quotes: [first],
        };
      }
      const named = list(topics.map((t) => `${t.word} (${t.count} lines)`));
      return {
        answer: `${m.transcript.length} lines over ${Math.round(
          (m.tEnd - m.tStart) / 60,
        )} minutes, from ${list([...new Set(m.transcript.map((s) => s.speaker))])}. What kept coming back up: ${named}.`,
        citationIds: topics.map((t) => t.segs[0].id),
      };
    },
  },
  {
    id: "decisions",
    label: "What did we decide?",
    applies: (m) => m.transcript.some((s) => DECISION_RE.test(s.text)),
    run: (m) => {
      const hits = m.transcript.filter((s) => DECISION_RE.test(s.text));
      // Prefer the substantive lines — a bare "Fine." is a decision but a poor quote.
      const quotes = [...hits].sort((a, b) => b.text.length - a.text.length).slice(0, 3);
      quotes.sort((a, b) => a.t - b.t);
      return {
        answer: `${hits.length} lines read as decisions or commitments. The clearest ones:`,
        citationIds: hits.map((s) => s.id),
        quotes,
      };
    },
  },
  {
    id: "who",
    label: "Who talked the most?",
    applies: (m) => new Set(m.transcript.map((s) => s.speaker)).size > 1,
    run: (m) => {
      const bySpeaker = new Map<string, { lines: number; words: number }>();
      for (const s of m.transcript) {
        const e = bySpeaker.get(s.speaker) ?? { lines: 0, words: 0 };
        e.lines++;
        e.words += s.text.split(/\s+/).length;
        bySpeaker.set(s.speaker, e);
      }
      const ranked = [...bySpeaker.entries()].sort((a, b) => b[1].words - a[1].words);
      const [topName, top] = ranked[0];
      const longest = m.transcript.reduce((a, b) => (b.text.length > a.text.length ? b : a));
      return {
        answer: `${topName} — ${top.words} words across ${top.lines} lines. ${list(
          ranked.slice(1).map(([n, e]) => `${n} ${e.words}`),
        )}${ranked.length > 1 ? " words" : ""}.`,
        citationIds: [longest.id],
        quotes: [longest],
      };
    },
  },
  {
    id: "around",
    label: "What was around us?",
    applies: (m) => m.objects.length > 0,
    run: (m) => {
      const byLabel = new Map<string, number>();
      for (const o of m.objects) byLabel.set(o.label, (byLabel.get(o.label) ?? 0) + 1);
      const ranked = [...byLabel.entries()].sort((a, b) => b[1] - a[1]);
      const named = ranked
        .slice(0, 6)
        .map(([label, n]) => (n > 1 ? `${n}× ${label}` : label));
      const placed = m.objects.filter((o) => o.worldPos).length;
      return {
        answer: `${m.objects.length} objects tracked: ${list(named)}${
          ranked.length > 6 ? `, plus ${ranked.length - 6} more` : ""
        }. ${placed} of them have a 3D position, so they're clickable in the view.`,
        citationIds: [],
      };
    },
  },
];

export function questionsFor(moment: Moment): QAQuestion[] {
  return QA_QUESTIONS.filter((q) => q.applies(moment));
}
