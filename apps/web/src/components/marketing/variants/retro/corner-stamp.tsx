// Rotated circular "approval" stamp — decorative ink seal. Text runs around the
// ring via SVG textPath; centre carries a star + year. aria-hidden: the headline
// carries all meaning.
export function CornerStamp({
  size = 116,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      aria-hidden="true"
      className={className}
      style={{ color: "var(--mk-seed-primary)" }}
    >
      <defs>
        <path
          id="v-stamp-ring"
          d="M 60 60 m -42 0 a 42 42 0 1 1 84 0 a 42 42 0 1 1 -84 0"
          fill="none"
        />
      </defs>
      <circle
        cx="60"
        cy="60"
        r="56"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <circle
        cx="60"
        cy="60"
        r="48"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="2 3"
      />
      <text
        fill="currentColor"
        style={{
          fontFamily: "var(--v-font-display)",
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "2.5px",
        }}
      >
        <textPath href="#v-stamp-ring" startOffset="2%">
          APPROVED · EST. 2025 · NETHERLANDS ·
        </textPath>
      </text>
      <text
        x="60"
        y="50"
        textAnchor="middle"
        fill="currentColor"
        style={{ fontSize: "20px" }}
      >
        ✶
      </text>
      <text
        x="60"
        y="74"
        textAnchor="middle"
        fill="currentColor"
        style={{
          fontFamily: "var(--v-font-display)",
          fontSize: "16px",
          fontWeight: 800,
          letterSpacing: "1px",
        }}
      >
        NO. 2025
      </text>
    </svg>
  );
}
