import { describe, expect, it } from "vitest";
import { isExcludedFromSalesRevenue } from "@/lib/sales-revenue-policy";

describe("Sales revenue exclusion policy", () => {
  it("recognizes Odoo product 246 and its exact product name", () => {
    expect(
      isExcludedFromSalesRevenue({
        odooProductId: "246",
        product: "Professional certificate registration",
      }),
    ).toBe(true);
    expect(
      isExcludedFromSalesRevenue({
        product: "  PROFESSIONAL CERTIFICATE REGISTRATION ",
      }),
    ).toBe(true);
    expect(
      isExcludedFromSalesRevenue({
        product: "[246] CFM - Professional Certificate Registration",
      }),
    ).toBe(true);
    expect(
      isExcludedFromSalesRevenue({
        product: "CFM - Professional Certificate Registration",
      }),
    ).toBe(true);
    expect(isExcludedFromSalesRevenue({ odooProductId: "247", product: "PMP" })).toBe(false);
    expect(isExcludedFromSalesRevenue({ product: "[192] Shipping KSA Certificates" })).toBe(false);
  });

  it("does not accidentally exclude other registration or certificate products", () => {
    expect(isExcludedFromSalesRevenue({ product: "[247] PMP - Professional Certificate Registration" })).toBe(false);
    expect(isExcludedFromSalesRevenue({ product: "[2460] CFM - Site Management" })).toBe(false);
  });
});
