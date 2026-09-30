import type { AccountingRow } from "./types";

/** Products that should not contribute to Sales revenue or quota achievement. */
export const SALES_REVENUE_EXCLUDED_PRODUCT_IDS = new Set(["246"]);

const normalizeProductName = (value: string | undefined) =>
  (value ?? "").trim().toLocaleLowerCase("en");
const excludedProductNames = new Set(["professional certificate registration"]);

export function isExcludedFromSalesRevenue(
  row: Pick<AccountingRow, "odooProductId" | "product">,
): boolean {
  const productId = (row.odooProductId ?? "").trim();
  return (
    SALES_REVENUE_EXCLUDED_PRODUCT_IDS.has(productId) ||
    excludedProductNames.has(normalizeProductName(row.product))
  );
}

/**
 * Preserve the original invoice line for traceability, but zero its eligible
 * Sales revenue so it cannot affect revenue charts or target attainment.
 */
export function excludeSalesRevenue(row: AccountingRow): AccountingRow {
  if (!isExcludedFromSalesRevenue(row)) return row;
  return { ...row, usdPaid: 0, usdSales: 0 };
}
