import { describe, expect, it } from "vitest";
import { excludeSalesRevenue, isExcludedFromSalesRevenue } from "@/lib/sales-revenue-policy";

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
    expect(isExcludedFromSalesRevenue({ odooProductId: "247", product: "PMP" })).toBe(false);
  });

  it("zeros eligible revenue without deleting the invoice detail", () => {
    const row = {
      id: "line-1",
      movement: "INV/001",
      product: "Professional certificate registration",
      odooProductId: "246",
      usdPaid: 250,
      usdSales: 250,
    } as Parameters<typeof excludeSalesRevenue>[0];

    expect(excludeSalesRevenue(row)).toMatchObject({
      movement: "INV/001",
      odooProductId: "246",
      usdPaid: 0,
      usdSales: 0,
    });
  });
});
