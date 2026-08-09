/**
 * GConverter mark (spec §57).
 *
 * A stylised "G" whose terminal opens into a conversion arrow — the letter
 * and the transform are the same stroke. Reads cleanly from 16px upward.
 */

export function Logo({ size = 32 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="GConverter"
    >
      <defs>
        <linearGradient id="gc-grad" x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5B8CFF" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
        <linearGradient id="gc-face" x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1E2740" />
          <stop offset="1" stopColor="#141824" />
        </linearGradient>
      </defs>

      {/* Rounded tile keeps the mark legible on any background. */}
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#gc-face)" />
      <rect
        x="2.75"
        y="2.75"
        width="42.5"
        height="42.5"
        rx="11.25"
        stroke="url(#gc-grad)"
        strokeOpacity="0.5"
        strokeWidth="1.5"
      />

      {/* Same geometry as build/icon.svg, scaled to a 48px grid. */}
      <g
        stroke="url(#gc-grad)"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {/* The G: an open arc that stops short of closing on the right. */}
        <path d="M30.4 17.2A9.4 9.4 0 1 0 33.1 24" />
        {/* Crossbar of the G, doubling as the shaft of a conversion arrow. */}
        <path d="M23.8 24H31.7" />
        {/* Arrowhead with long arms so it stays a chevron at small sizes. */}
        <path d="M29.8 19.3 34.9 24l-5.1 4.7" />
      </g>
    </svg>
  )
}
