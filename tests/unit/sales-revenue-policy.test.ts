import { describe, expect, it } from "vitest";
import {
  isExcludedFromDashboardProduct,
  isExcludedFromSalesRevenue,
} from "@/lib/sales-revenue-policy";

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
    expect(
      isExcludedFromSalesRevenue({ product: "[247] PMP - Professional Certificate Registration" }),
    ).toBe(false);
    expect(isExcludedFromSalesRevenue({ product: "[2460] CFM - Site Management" })).toBe(false);
  });
});

describe("Dashboard product exclusion", () => {
  it("removes exact product code 1047 from dashboard sales data", () => {
    expect(isExcludedFromDashboardProduct({ productCode: "1047", product: "Course" })).toBe(true);
    expect(isExcludedFromDashboardProduct({ product: "[1047] Course" })).toBe(true);
    expect(isExcludedFromDashboardProduct({ productCode: " 1047 " })).toBe(true);
  });

  it("does not remove neighboring codes or unrelated revenue exclusions", () => {
    expect(isExcludedFromDashboardProduct({ productCode: "10470", product: "Course" })).toBe(false);
    expect(isExcludedFromDashboardProduct({ productCode: "CFM", product: "[1047] Course" })).toBe(false);
    expect(isExcludedFromDashboardProduct({ product: "[10470] Course" })).toBe(false);
    expect(isExcludedFromDashboardProduct({ product: "Course 1047" })).toBe(false);
    expect(isExcludedFromDashboardProduct({ productCode: "246" })).toBe(false);
  });
});
