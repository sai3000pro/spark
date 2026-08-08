/** The brand glyph: a four-point spark with a soft core. Server-safe. */
export function SparkMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <defs>
        <radialGradient id="spark-core" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#e8fffb" />
          <stop offset="0.55" stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#2dd4bf" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* The star: long vertical and horizontal arms, short diagonals. */}
      <path
        d="M10 1 L11.5 8.5 L19 10 L11.5 11.5 L10 19 L8.5 11.5 L1 10 L8.5 8.5 Z"
        fill="#2dd4bf"
      />
      <path
        d="M15.5 4.5 L11.6 8.4 L15.5 4.5 M4.5 15.5 L8.4 11.6 L4.5 15.5"
        stroke="#f59e0b"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="10" cy="10" r="4.5" fill="url(#spark-core)" />
    </svg>
  );
}
