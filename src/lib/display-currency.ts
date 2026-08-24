export type DisplayCurrency = "USD" | "SAR";

const EM_DASH = "—";

/** Convert a USD reporting value into the selected display currency. */
export function usdToDisplayCurrency(
  value: number | null | undefined,
  currency: DisplayCurrency,
  sarPerUsd: number,
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (currency === "USD") return value;
  return Number.isFinite(sarPerUsd) && sarPerUsd > 0 ? value * sarPerUsd : null;
}

/** Dashboard money formatter for amounts already converted to their display currency. */
export function formatDisplayMoney(
  value: number | null | undefined,
  currency: DisplayCurrency,
  lang: "ar" | "en",
  full = false,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  const abs = Math.abs(value);
  let body: string;
  if (full) {
    body = value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  } else if (abs >= 1_000_000) {
    body = `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  } else if (abs >= 10_000) {
    body = `${(value / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  } else {
    body = value.toLocaleString("en-US", { maximumFractionDigits: abs < 100 ? 2 : 0 });
  }

  if (currency === "USD") return `$${body}`;
  return lang === "ar" ? `${body} ر.س` : `SAR ${body}`;
}
