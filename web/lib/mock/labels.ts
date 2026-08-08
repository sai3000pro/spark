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
 * Tuned for the riso cream surfaces (#f6eedd, #fdf8ec): each value is deep
 * enough to hold ≥3:1 against cream as a dot/stroke, the hues sit inside the
 * poster palette's family, and no pair collapses for protan/deutan viewers.
 * `furniture` stays a desaturated slate — the static built environment.
 *
 * Family color is always shown NEXT TO the label text (chips, legends, tooltips),
 * never as the sole carrier of identity. Re-check the all-pairs ΔE before
 * hand-picking any replacement.
 */
export const FAMILY_COLOR: Record<LabelFamily, string> = {
  people: "#4227c8",
  personal: "#bc3a1e",
  animal: "#0f6b66",
  sport: "#92670a",
  food: "#b03a58",
  vehicle: "#3a7d1e",
  furniture: "#6b7280",
};

/**
 * Sequential ramp for detection DENSITY — one hue, light→dark, because density is
 * a magnitude and not an identity, and on paper "more" reads as more ink.
 * Anchored on the machine teal so it reads as perception data rather than as one
 * of the label families above. Lightness is monotonic, which is what makes the
 * area chart readable.
 */
export const DENSITY_RAMP = [
  "#e7ebe4",
  "#c6ded9",
  "#8fcac2",
  "#4eb3a8",
  "#1ba098",
  "#0f6b66",
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
