/**
 * The brand glyph: a four-point spark with a soft core. Server-safe.
 *
 * The one place brand orange and machine teal are allowed to touch. Everywhere
 * else they are kept apart by the rule in app/globals.css — orange is a form,
 * teal and amber are categories — but a mark is neither, it is an identity, and
 * the two-colour spark is what the brand sheet draws.
 */
import { BRAND, MACHINE } from "@/lib/theme";

export function SparkMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <defs>
        <radialGradient id="spark-core" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff2d9" />
          <stop offset="0.55" stopColor={BRAND[400]} />
          <stop offset="1" stopColor={BRAND[400]} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* The star: long vertical and horizontal arms, short diagonals. */}
      <path
        d="M10 1 L11.5 8.5 L19 10 L11.5 11.5 L10 19 L8.5 11.5 L1 10 L8.5 8.5 Z"
        fill={BRAND[400]}
      />
      <path
        d="M15.5 4.5 L11.6 8.4 L15.5 4.5 M4.5 15.5 L8.4 11.6 L4.5 15.5"
        stroke={MACHINE[400]}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="10" cy="10" r="4.5" fill="url(#spark-core)" />
    </svg>
  );
}
