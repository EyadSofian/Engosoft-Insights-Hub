/* -------------------------------------------------------------------------
   Colour, in one place — and deliberately very little of it.

   Management screens use five colours: Engosoft brand blue, green, amber, red
   and neutral. Every card sits on the same white surface with the same
   hairline; meaning comes from the label, the position and the type size.

   The seven family names (mint, rose, sky, violet, amber, cyan, slate) stay as
   a vocabulary so no caller breaks, but they no longer paint surfaces. A family
   is a naming convention, not a verdict, so on chrome it resolves to brand
   blue. Only the semantic names — success, danger, warning — reach green, red
   and amber, because only a caller that has judged a figure may colour it.
   Charts keep their own multi-series palette through the `--*-strong` tokens.
------------------------------------------------------------------------- */

export type Tone = "mint" | "rose" | "sky" | "violet" | "amber" | "cyan" | "slate";

/** Kept so existing callers using semantic names keep working. */
export type SemanticTone = "success" | "danger" | "brand" | "warning" | "neutral";

export interface ToneStyle {
  /** Soft ground for a small chip or pill — never a whole card. */
  surface: string;
  /** Hairline. Always the neutral border. */
  border: string;
  /** Text on a surface. Always the neutral text colour. */
  ink: string;
  /** The accent: icon, sparkline, progress fill, focus cue. */
  strong: string;
}

const soft = (accent: string) => `color-mix(in oklab, ${accent} 11%, var(--surface))`;

const accentStyle = (accent: string): ToneStyle => ({
  surface: soft(accent),
  border: "var(--border)",
  ink: "var(--text)",
  strong: accent,
});

const BRAND = accentStyle("var(--brand)");
const NEUTRAL = accentStyle("var(--text-muted)");

/**
 * Families used as status proxies in older components (mint = fine, rose =
 * problem, amber = watch) keep that meaning on small indicators; the rest are
 * brand blue.
 */
export const TONES: Record<Tone, ToneStyle> = {
  mint: accentStyle("var(--success)"),
  rose: accentStyle("var(--danger)"),
  sky: BRAND,
  violet: BRAND,
  amber: accentStyle("var(--warning)"),
  cyan: BRAND,
  slate: NEUTRAL,
};

/** Semantic names map onto families, so "success" and mint are one green. */
const SEMANTIC: Record<SemanticTone, Tone> = {
  success: "mint",
  danger: "rose",
  brand: "sky",
  warning: "amber",
  neutral: "slate",
};

export type AnyTone = Tone | SemanticTone;

export function toneOf(tone: AnyTone | undefined): ToneStyle {
  if (!tone) return TONES.slate;
  return TONES[(tone in TONES ? tone : SEMANTIC[tone as SemanticTone]) as Tone] ?? TONES.slate;
}

/**
 * The CSS custom properties a card sets on itself: a neutral surface and one
 * accent. Spread into `style` and everything inside can read `--tone-strong`
 * and `--tone-soft` without being handed the tone as a prop.
 */
export function toneVars(tone: AnyTone | undefined): React.CSSProperties {
  const accent = surfaceAccent(tone);
  return {
    "--tone-surface": "var(--surface)",
    "--tone-border": "var(--border)",
    "--tone-ink": "var(--text)",
    "--tone-strong": accent,
    "--tone-soft": soft(accent),
  } as React.CSSProperties;
}

/**
 * The accent a whole card (KPI, reading, detail header) may carry. A family name
 * on a card is only a convention — revenue is not "good" because it is mint — so
 * it resolves to brand blue; semantic names keep their meaning.
 */
export function surfaceAccent(tone: AnyTone | undefined): string {
  switch (tone) {
    case "success":
      return "var(--success)";
    case "danger":
      return "var(--danger)";
    case "warning":
      return "var(--warning)";
    case "neutral":
      return "var(--text-muted)";
    default:
      return "var(--brand)";
  }
}

/**
 * The palette for page chrome — header, section and panel icon tiles, ranking
 * bars. Same rule as a card: brand blue unless the caller passed a verdict.
 */
export function cardTone(tone: AnyTone | undefined): ToneStyle {
  return accentStyle(surfaceAccent(tone));
}

/**
 * The family a return figure belongs to, on the same bands the ROAS pill and
 * the campaign table already use — so a ratio can never be mint in one place
 * and rose in another.
 */
export function ratioTone(value: number | null | undefined, good = 2, fair = 1): Tone {
  if (value === null || value === undefined || !isFinite(value)) return "slate";
  if (value >= good) return "mint";
  if (value >= fair) return "amber";
  return "rose";
}

/** Legacy export: the shape the first redesign used. Kept so nothing breaks. */
export const TONE = {
  neutral: { fg: TONES.slate.strong, bg: TONES.slate.surface, border: TONES.slate.border },
  brand: { fg: TONES.sky.strong, bg: TONES.sky.surface, border: TONES.sky.border },
  success: { fg: TONES.mint.strong, bg: TONES.mint.surface, border: TONES.mint.border },
  warning: { fg: TONES.amber.strong, bg: TONES.amber.surface, border: TONES.amber.border },
  danger: { fg: TONES.rose.strong, bg: TONES.rose.surface, border: TONES.rose.border },
  violet: { fg: TONES.violet.strong, bg: TONES.violet.surface, border: TONES.violet.border },
};
