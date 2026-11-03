/** Engosoft's three ascending strokes and orange point, redrawn as a crisp UI mark. */
export function EngosoftMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 112 128"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M13 46 54 31M13 77 90 49M13 110 90 82" stroke="currentColor" strokeWidth="22" strokeLinecap="round" />
      <circle cx="88" cy="16" r="13" fill="#FF6500" />
    </svg>
  );
}
