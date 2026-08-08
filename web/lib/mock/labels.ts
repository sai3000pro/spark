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
 * Tuned for the night grounds (#0f0d23, #171432): each value is luminous
 * enough to hold ≥3:1 against night as a dot/stroke, the hues sit inside the
 * NIGHT WALK family, and no pair collapses for protan/deutan viewers.
 * `furniture` stays a desaturated moth — the static built environment.
 *
 * Family color is always shown NEXT TO the label text (chips, legends, tooltips),
 * never as the sole carrier of identity. Re-check the all-pairs ΔE before
 * hand-picking any replacement.
 */
export const FAMILY_COLOR: Record<LabelFamily, string> = {
  people: "#9d8bfa",
  personal: "#ff8e5e",
  animal: "#3ee6c0",
  sport: "#ffc46b",
  food: "#ee6fae",
  vehicle: "#b7e06b",
  furniture: "#8f9bb8",
};

/**
 * Sequential ramp for detection DENSITY — one hue, dark→light, because density
 * is a magnitude and not an identity, and at night "more" reads as more light.
 * Anchored on the machine aurora so it reads as perception data rather than as
 * one of the label families above. Lightness is monotonic, which is what makes
 * the area chart readable.
 */
export const DENSITY_RAMP = [
  "#1a2440",
  "#173d4d",
  "#14565a",
  "#1f7a6d",
  "#2bb493",
  "#3ee6c0",
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
 * The same categorical scale pressed onto paper — one deep value per family,
 * for dots and meters on the cream grounds where the luminous set washes out.
 * Hues match FAMILY_COLOR one-for-one so a family keeps its identity when a
 * label moves between the dark splat stage and the journal page.
 */
export const FAMILY_COLOR_DEEP: Record<LabelFamily, string> = {
  people: "#5a48c9",
  personal: "#b4491f",
  animal: "#0e7a63",
  sport: "#a06a14",
  food: "#a72d6a",
  vehicle: "#5f7a1f",
  furniture: "#5c6880",
};

export const deepColorForLabel = (label: string) => FAMILY_COLOR_DEEP[familyOf(label)];

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
