/**
 * Presentation formatting for ENGO Nexus.
 *
 * Every number the panel renders passes through here. The reason is a real
 * defect: raw IEEE-754 values reached users as `$138187.35635592628`, which
 * reads as machine output and hides the one thing that makes a money value
 * interpretable — its currency.
 *
 * Three rules:
 *  1. Never re-denominate. There is no FX table here and there must not be one.
 *  2. Never invent precision. Values arrive already correct from ENGO Nexus.
 *  3. An absent or non-finite value renders as an explicit dash, never as `0`.
 *     Zero and not-measurable are different findings.
 *
 * Pure: no React, no DOM, no locale database beyond `toLocaleString('en-US')`,
 * which is used for grouping only. Latin digits in both languages — the same
 * choice `src/lib/i18n.tsx` makes for the dashboard's own figures, for the same
 * reason: Arabic-Indic digits fight tabular alignment in a finance view.
 */

export const NOT_MEASURABLE = "—";

const MINOR_UNITS: Record<string, number> = {
  SAR: 2,
  EGP: 2,
  USD: 2,
  AED: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
};

const SYMBOL_PREFIX: Record<string, string> = { USD: "$" };

export function isMeasurable(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatNumber(value: unknown, decimals = 2): string {
  if (!isMeasurable(value)) return NOT_MEASURABLE;
  const dp = Math.max(0, Math.min(6, Math.trunc(decimals)));
  return value.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

export function formatMoney(value: unknown, currency?: string | null): string {
  if (!isMeasurable(value)) return NOT_MEASURABLE;
  const code = (currency ?? "").trim().toUpperCase();
  const dp = code in MINOR_UNITS ? MINOR_UNITS[code]! : 2;
  const amount = formatNumber(value, dp);
  if (!code) return amount;
  const symbol = SYMBOL_PREFIX[code];
  if (symbol) {
    return value < 0 ? `-${symbol}${amount.slice(1)}` : `${symbol}${amount}`;
  }
  return `${amount} ${code}`;
}

export function formatPercent(value: unknown, decimals = 2): string {
  if (!isMeasurable(value)) return NOT_MEASURABLE;
  return `${formatNumber(value, decimals)}%`;
}

export function formatRatio(value: unknown, decimals = 2): string {
  if (!isMeasurable(value)) return NOT_MEASURABLE;
  return `${formatNumber(value, decimals)}x`;
}

export function formatCount(value: unknown): string {
  if (!isMeasurable(value)) return NOT_MEASURABLE;
  return formatNumber(Math.round(value), 0);
}

export function formatDays(value: unknown): string {
  if (!isMeasurable(value)) return NOT_MEASURABLE;
  return `${formatNumber(value, 1)}d`;
}

export type MetricUnit = "money" | "percent" | "ratio" | "count" | "days" | "text";

/** One entry point so a component never picks a formatter by hand. */
export function formatMetric(
  value: unknown,
  unit: MetricUnit = "count",
  currency?: string | null,
): string {
  switch (unit) {
    case "money":
      return formatMoney(value, currency);
    case "percent":
      return formatPercent(value);
    case "ratio":
      return formatRatio(value);
    case "days":
      return formatDays(value);
    case "text":
      return value === null || value === undefined ? NOT_MEASURABLE : String(value);
    default:
      return formatCount(value);
  }
}

/** A signed delta. A delta of exactly 0 is a real finding, not a missing one. */
export function formatDelta(value: unknown, unit: MetricUnit = "percent"): string {
  if (!isMeasurable(value)) return NOT_MEASURABLE;
  const sign = value < 0 ? "−" : "+";
  const magnitude = Math.abs(value);
  switch (unit) {
    case "percent":
      return `${sign}${formatNumber(magnitude, 2)}%`;
    case "count":
      return `${sign}${formatCount(magnitude)}`;
    case "ratio":
      return `${sign}${formatNumber(magnitude, 2)}x`;
    default:
      return `${sign}${formatNumber(magnitude, 2)}`;
  }
}

export type TrendTone = "positive" | "negative" | "neutral";

/**
 * THE COLOUR RULE.
 *
 * Green and red are decided HERE, from the metric's own semantics — never
 * because a model asked for a colour. A falling CPL is good; a falling revenue
 * is bad; the same negative delta therefore gets opposite colours, and only the
 * frontend knows which metric it is looking at.
 *
 * `direction` says which way is good for this metric. `lower_is_better` covers
 * CPL, CPA, cost, close time, lost rate. Anything unmeasurable, or a metric
 * whose direction the payload did not declare, is neutral — an uncoloured
 * number is honest, a guessed colour is not.
 */
export type MetricDirection = "higher_is_better" | "lower_is_better" | "neutral";

export function trendTone(delta: unknown, direction: MetricDirection = "neutral"): TrendTone {
  if (!isMeasurable(delta) || delta === 0) return "neutral";
  if (direction === "neutral") return "neutral";
  const improving = direction === "higher_is_better" ? delta > 0 : delta < 0;
  return improving ? "positive" : "negative";
}

/** Metrics whose direction the Hub and ENGO Nexus both treat as cost-like. */
const LOWER_IS_BETTER = new Set([
  "cpl",
  "cpa",
  "cpc",
  "cpm",
  "acos",
  "spend",
  "cost",
  "lostrate",
  "lost_rate",
  "avgclosedays",
  "avg_close_days",
  "closedays",
  "firstresponsetime",
  "first_response_time",
]);

const HIGHER_IS_BETTER = new Set([
  "revenue",
  "roas",
  "attributedroas",
  "conversionrate",
  "conversion_rate",
  "leads",
  "crmleads",
  "won",
  "orders",
  "ctr",
  "avgorder",
  "revenueperlead",
  "qualifiedrate",
  "followupcoverage",
]);

/** Infer direction from a metric key when the payload does not declare one. */
export function inferDirection(metricKey?: string | null): MetricDirection {
  if (!metricKey) return "neutral";
  const key = metricKey.toLowerCase().replace(/[\s-]/g, "");
  if (LOWER_IS_BETTER.has(key)) return "lower_is_better";
  if (HIGHER_IS_BETTER.has(key)) return "higher_is_better";
  return "neutral";
}

/** Short, unambiguous date for a price validity window. */
export function formatDate(value: unknown, lang: "ar" | "en" = "en"): string {
  if (typeof value !== "string" || !value) return NOT_MEASURABLE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Round raw float noise out of prose, without touching anything else.
 *
 * WHY THIS EXISTS: verified against the live bot on 2026-09-04, the answer to
 * "كام الإيرادات الشهر ده؟" contained the literal string
 * `**7009.358714766733**`. Typed payloads route through `formatMetric` and are
 * safe, but a figure the agent writes into its own prose reaches the markdown
 * renderer verbatim. Fifteen decimal places is not a business number; it is an
 * IEEE-754 artifact, and it reads as a broken system.
 *
 * SCOPE, DELIBERATELY NARROW. This rounds only a run of SIX OR MORE decimal
 * digits — a shape no real revenue, price, rate or ratio has, and which
 * therefore cannot be a figure whose precision matters. It does not:
 *   - alter a number's value beyond that rounding,
 *   - touch integers, dates, codes, IDs, versions, or 1–5 decimal figures,
 *   - reformat, re-denominate or add a currency,
 *   - infer anything, or move a number into a card.
 *
 * It is presentation, not interpretation. The root cause is bot-side — the
 * agent should format money before writing it — and this is the display-layer
 * guard that keeps it from reaching a manager either way.
 */
const FLOAT_NOISE = /(\d+)\.(\d{6,})/g;

export function normalizeFloatNoise(text: string): string {
  if (!text) return text;
  // Code spans are left exactly as written: a long decimal inside backticks is
  // usually a literal being discussed, not a figure being reported.
  return text
    .split(/(`{1,3}[^`]*`{1,3})/g)
    .map((segment, index) =>
      index % 2 === 1
        ? segment
        : segment.replace(FLOAT_NOISE, (match, whole: string, fraction: string) => {
            const value = Number(`${whole}.${fraction}`);
            if (!Number.isFinite(value)) return match;
            return formatNumber(value, 2);
          }),
    )
    .join("");
}
