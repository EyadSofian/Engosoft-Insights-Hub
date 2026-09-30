import type { AccountingRow } from "./types";

/** Products that should not contribute to Sales revenue or quota achievement. */
export const SALES_REVENUE_EXCLUDED_PRODUCT_IDS = new Set(["246"]);

const normalizeProductName = (value: string | undefined) =>
  (value ?? "").trim().toLocaleLowerCase("en");
const excludedProductNames = new Set([
  "professional certificate registration",
  "cfm - professional certificate registration",
]);

export function isExcludedFromSalesRevenue(
  row: Pick<AccountingRow, "odooProductId" | "product">,
): boolean {
  const productId = (row.odooProductId ?? "").trim();
  const productName = normalizeProductName(row.product);
  // The paid-invoice export often omits __odoo_product_id and instead embeds
  // the Odoo product code in the display name: "[246] CFM - ...".
  const displayedProductId = /^\[(\d+)\](?:\s|$)/.exec(productName)?.[1] ?? "";
  const unprefixedName = productName.replace(/^\[\d+\]\s*/, "");
  return (
    SALES_REVENUE_EXCLUDED_PRODUCT_IDS.has(productId) ||
    SALES_REVENUE_EXCLUDED_PRODUCT_IDS.has(displayedProductId) ||
    excludedProductNames.has(unprefixedName)
  );
}
