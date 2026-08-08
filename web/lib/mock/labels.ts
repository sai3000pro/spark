/**
 * COCO label families. Used to color detection ticks in the pipeline timeline and
 * to power category matching in object search ("where are my things?" → personal).
 */
export const LABEL_FAMILIES = {
  people: ["person"],
  animal: ["bird", "dog", "cat", "horse"],
  vehicle: ["bicycle", "car", "motorcycle", "bus", "truck", "boat"],
  furniture: ["bench", "chair", "dining table", "potted plant", "couch"],
  personal: [
    "backpack",
    "handbag",
    "umbrella",
    "cell phone",
    "laptop",
    "book",
    "bottle",
    "cup",
  ],
  sport: ["frisbee", "sports ball", "kite", "skateboard", "tennis racket"],
  food: ["banana", "apple", "sandwich", "cake", "donut"],
} as const;

export type LabelFamily = keyof typeof LABEL_FAMILIES;

const LABEL_TO_FAMILY = new Map<string, LabelFamily>();
for (const [family, labels] of Object.entries(LABEL_FAMILIES)) {
  for (const label of labels) LABEL_TO_FAMILY.set(label, family as LabelFamily);
}

export const familyOf = (label: string): LabelFamily =>
  LABEL_TO_FAMILY.get(label) ?? "furniture";

/**
 * Categorical palette for label families. Tailwind-independent hex so SVG, canvas
 * and DOM stay in sync. (Brand colors live in lib/theme.ts; these are deliberately
 * separate because a categorical scale has different constraints than a palette.)
 *
 * Validated against Spark's three dark surfaces (#09090e, #111118, #16161f) over
 * ALL 21 pairs — not just adjacent slots:
 *   min contrast 3.63:1  ·  normal ΔE 33.9  ·  protan ΔE 8.7  ·  deutan ΔE 7.5
 *
 * `furniture` was moved off violet (#9085e9): against `people` blue it collapsed to
 * protan ΔE 2.0 — effectively identical for a red-blind viewer — and it also
 * collided with the new compute-state violet. The desaturated cool grey reads as
 * the static built environment (benches, tables) and lifts protan to 15.7 for
 * that pair.
 *
 * Family color is always shown NEXT TO the label text (chips, legends, tooltips),
 * never as the sole carrier of identity — which is what lets the 7.5 deutan floor
 * stand. Re-run the all-pairs check before hand-picking any replacement.
 */
export const FAMILY_COLOR: Record<LabelFamily, string> = {
  people: "#3987e5",
  personal: "#d95926",
  animal: "#199e70",
  sport: "#c98500",
  food: "#d55181",
  vehicle: "#008300",
  furniture: "#8d94a8",
};

/**
 * Sequential ramp for detection DENSITY — one hue, dark→light, because density is
 * a magnitude and not an identity. Anchored on the machine teal so it reads as
 * perception data rather than as one of the label families above. Lightness is
 * monotonic (L* 16.9 → 88.1), which is what makes the area chart readable.
 */
export const DENSITY_RAMP = [
  "#0b2f2b",
  "#0f4a44",
  "#12766c",
  "#14b8a6",
  "#2dd4bf",
  "#7ff0e2",
] as const;

export function densityColor(value: number, max: number): string {
  if (max <= 0 || value <= 0) return DENSITY_RAMP[0];
  const i = Math.min(
    DENSITY_RAMP.length - 1,
    Math.floor((value / max) * (DENSITY_RAMP.length - 1) + 0.5),
  );
  return DENSITY_RAMP[i];
}

export const colorForLabel = (label: string) => FAMILY_COLOR[familyOf(label)];

/**
 * Everyday words people actually say, mapped to the COCO class the model emits.
 * "where is my water bottle" must find a `bottle`.
 */
export const LABEL_ALIASES: Record<string, string[]> = {
  bottle: ["water bottle", "nalgene", "flask", "drink", "hydro flask"],
  cup: ["coffee", "coffee cup", "mug", "latte", "tea"],
  backpack: ["bag", "rucksack", "knapsack", "my bag"],
  "cell phone": ["phone", "iphone", "mobile"],
  laptop: ["computer", "macbook", "notebook"],
  bicycle: ["bike", "cycle"],
  "dining table": ["table", "picnic table"],
  bird: ["duck", "ducks", "goose", "geese", "swan"],
  dog: ["puppy", "doggo"],
  frisbee: ["disc", "disk"],
  "sports ball": ["ball", "soccer ball"],
  bench: ["seat"],
  person: ["people", "friend", "someone", "us"],
};
