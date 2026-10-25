/* -------------------------------------------------------------------------
   Colour, in one place.

   Six families plus a neutral. Every family is complete — a pastel `surface` a
   whole card can sit on, a `border` from the same family, an `ink` that stays
   legible on that surface, and a `strong` for the icon chip, the sparkline and
   the progress fill.

   A card takes all four. The previous system put the family colour on a 32px
   icon and left the card white, so five cards meant to say five different
   things read, at a glance, as one grey block.

   Which family a metric gets is a convention, not a verdict: money in is mint,
   money out is rose, volume is sky, a qualified count is violet, a ratio is
   amber, anything non-paid is cyan. `slate` is for figures that carry no
   meaning of their own.
------------------------------------------------------------------------- */

export type Tone = "mint" | "rose" | "sky" | "violet" | "amber" | "cyan" | "slate";

/** Kept so existing callers using semantic names keep working. */
export type SemanticTone = "success" | "danger" | "brand" | "warning" | "neutral";

export interface ToneStyle {
  /** Pastel ground for a whole card. */
  surface: string;
  /** Hairline from the same family. */
  border: string;
  /** Readable dark tone on `surface` — the figure itself. */
  ink: string;
  /** Saturated tone: icon chip, sparkline stroke, progress fill. */
  strong: string;
}

export const TONES: Record<Tone, ToneStyle> = {
  mint: {
    surface: "var(--mint-surface)",
    border: "var(--mint-border)",
    ink: "var(--mint-ink)",
    strong: "var(--mint-strong)",
  },
  rose: {
    surface: "var(--rose-surface)",
    border: "var(--rose-border)",
    ink: "var(--rose-ink)",
    strong: "var(--rose-strong)",
  },
  sky: {
    surface: "var(--sky-surface)",
    border: "var(--sky-border)",
    ink: "var(--sky-ink)",
    strong: "var(--sky-strong)",
  },
  violet: {
    surface: "var(--violet-surface)",
    border: "var(--violet-border)",
    ink: "var(--violet-ink)",
    strong: "var(--violet-strong)",
  },
  amber: {
    surface: "var(--amber-surface)",
    border: "var(--amber-border)",
    ink: "var(--amber-ink)",
    strong: "var(--amber-strong)",
  },
  cyan: {
    surface: "var(--cyan-surface)",
    border: "var(--cyan-border)",
    ink: "var(--cyan-ink)",
    strong: "var(--cyan-strong)",
  },
  slate: {
    surface: "var(--slate-surface)",
    border: "var(--slate-border)",
    ink: "var(--slate-ink)",
    strong: "var(--slate-strong)",
  },
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
 * The CSS custom properties a tonal block sets on itself.
 *
 * Spread into `style` and everything inside can read `--tone-ink` and
 * `--tone-strong` without being handed the tone as a prop.
 */
export function toneVars(tone: AnyTone | undefined): React.CSSProperties {
  const t = toneOf(tone);
  return {
    "--tone-surface": t.surface,
    "--tone-border": t.border,
    "--tone-ink": t.ink,
    "--tone-strong": t.strong,
  } as React.CSSProperties;
}

/** The solid fill a KPI card is painted with, per family. */
const FILL: Record<Tone, string> = {
  mint: "var(--mint-fill)",
  rose: "var(--rose-fill)",
  sky: "var(--sky-fill)",
  violet: "var(--violet-fill)",
  amber: "var(--amber-fill)",
  cyan: "var(--cyan-fill)",
  slate: "var(--slate-fill)",
};

function familyOf(tone: AnyTone | undefined): Tone {
  if (!tone) return "slate";
  if (tone in TONES) return tone as Tone;
  return SEMANTIC[tone as SemanticTone] ?? "slate";
}

/**
 * A headline KPI card: a solid, saturated family fill with everything on it
 * in white — label, figure, sub-line, icon, sparkline and cue. White text is
 * at least 4.6:1 on every fill, so the colour can be loud without costing
 * legibility. Pair with the `kpi-solid` class, which turns deltas, verdict
 * chips and info buttons inside the card white too.
 */
export function solidCardVars(tone: AnyTone | undefined): React.CSSProperties {
  const fill = FILL[familyOf(tone)];
  return {
    "--tone-fill": fill,
    "--tone-surface": fill,
    "--tone-border": fill,
    "--tone-ink": "#ffffff",
    "--tone-strong": "#ffffff",
  } as React.CSSProperties;
}

/**
 * The tone of a card: KPI cards, readings, workspace links.
 *
 * The card itself is neutral — white surface, the shared hairline, figures in
 * the page's own text colour — and the family survives only where it carries
 * meaning: the icon, the sparkline, the hero rule and the "view detail" cue.
 * A full pastel surface per card put five or six colours side by side on every
 * screen, none of which meant good or bad, and that noise is what tired the
 * eye. Semantic colour still comes from deltas, verdict pills and charts.
 */
export function cardToneVars(tone: AnyTone | undefined): React.CSSProperties {
  const t = toneOf(tone);
  return {
    "--tone-surface": "var(--surface)",
    "--tone-border": "var(--border)",
    "--tone-ink": "var(--text)",
    "--tone-strong": t.strong,
  } as React.CSSProperties;
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

/**
 * A note, warning or alert: every word stays on screen, in the page's own
 * text colour on a white surface, with the meaning carried by a 3px edge in
 * the inline-start and the icon.
 *
 * Notes used to fill the full width with a pink, orange or blue wash and set
 * the whole paragraph in the warning colour itself — orange on pale orange is
 * about 2.4:1, unreadable — and three or four of them stacked above the first
 * figure made every page open on an alarm.
 */
export function calloutStyle(accent: string): React.CSSProperties {
  return {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderInlineStartWidth: "3px",
    borderInlineStartColor: accent,
    color: "var(--text)",
  };
}
