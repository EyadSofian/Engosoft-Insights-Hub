/* -------------------------------------------------------------------------
   Semantic tone, in one place.

   Every dashboard surface that carries a verdict — a KPI icon chip, an insight
   card, a data-health row — reads its colours from here, so "warning" is one
   colour across the whole app and a component never hardcodes a hex.
------------------------------------------------------------------------- */

/**
 * Semantic tone. `neutral` is the default and deliberately the commonest —
 * a colour on a dashboard should mean something, and if every card is tinted
 * then none of them are saying anything.
 */
export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "violet";

interface ToneStyle {
  /** Full-strength colour: text, icon strokes, bar fills. */
  fg: string;
  /** Pastel wash for an icon chip or a whole semantic card. */
  bg: string;
  /** Border when the tone owns the card. */
  border: string;
}

export const TONE: Record<Tone, ToneStyle> = {
  neutral: {
    fg: "var(--text-muted)",
    bg: "var(--surface-2)",
    border: "var(--border)",
  },
  brand: {
    fg: "var(--brand)",
    bg: "var(--brand-soft)",
    border: "color-mix(in oklab, var(--brand) 22%, transparent)",
  },
  success: {
    fg: "var(--success)",
    bg: "var(--success-soft)",
    border: "color-mix(in oklab, var(--success) 22%, transparent)",
  },
  warning: {
    fg: "var(--warning)",
    bg: "var(--warning-soft)",
    border: "color-mix(in oklab, var(--warning) 22%, transparent)",
  },
  danger: {
    fg: "var(--danger)",
    bg: "var(--danger-soft)",
    border: "color-mix(in oklab, var(--danger) 22%, transparent)",
  },
  violet: {
    fg: "var(--violet)",
    bg: "var(--violet-soft)",
    border: "color-mix(in oklab, var(--violet) 22%, transparent)",
  },
};
