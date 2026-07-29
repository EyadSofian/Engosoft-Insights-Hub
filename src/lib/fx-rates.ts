import type { AccountingRow, GlobalFilters } from "./types";

/** Business-approved fixed rates, expressed as local currency per 1 USD. */
export const DEFAULT_FX_RATES = {
  EGP: 50.5,
  SAR: 3.75,
} as const;

export interface FxRates {
  EGP: number;
  SAR: number;
}

function positive(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function fxRatesFromFilters(filters: Pick<GlobalFilters, "fxEgp" | "fxSar">): FxRates {
  return {
    EGP: positive(filters.fxEgp, DEFAULT_FX_RATES.EGP),
    SAR: positive(filters.fxSar, DEFAULT_FX_RATES.SAR),
  };
}

/**
 * Recalculate only the currencies whose business rates are managed here.
 * USD is already USD. Other currencies keep the authoritative source value.
 */
export function accountingUsdPaid(row: AccountingRow, rates: FxRates): number {
  const currency = row.currency.trim().toUpperCase();
  if (currency === "EGP") return row.totalInCurrency / rates.EGP;
  if (currency === "SAR") return row.totalInCurrency / rates.SAR;
  if (currency === "USD") return row.totalInCurrency;
  return row.usdPaid;
}
