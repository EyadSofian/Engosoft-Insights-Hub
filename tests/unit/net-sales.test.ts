import { describe, expect, it } from "vitest";
import {
  buildNetSalesMonths,
  companyAmountUsd,
  type NetSalesLedgerGroup,
} from "../../src/lib/net-sales";

const rates = { SAR: 4, EGP: 50 };
const group = (patch: Partial<NetSalesLedgerGroup>): NetSalesLedgerGroup => ({
  month: "2026-08",
  company: "Engosoft - KSA",
  currency: "SAR",
  accountCode: "4112007",
  accountName: "Sales",
  kind: "sales",
  balance: -400,
  count: 2,
  ...patch,
});

describe("posted-ledger net sales", () => {
  it("converts company currency without guessing unsupported currencies", () => {
    expect(companyAmountUsd(200, "EGP", rates)).toBe(4);
    expect(companyAmountUsd(40, "SAR", rates)).toBe(10);
    expect(companyAmountUsd(36.725, "AED", rates)).toBeCloseTo(10);
    expect(() => companyAmountUsd(5, "EUR", rates)).toThrow(/Unsupported/);
  });

  it("excludes VAT once, subtracts collection fees, and isolates certificates and write-offs", () => {
    const [month] = buildNetSalesMonths(
      [
        group({ balance: -400 }),
        group({ kind: "certificate", accountCode: "4112007", balance: -20 }),
        group({ kind: "outputVat", accountCode: "2131007", balance: -60 }),
        group({ kind: "gatewayFees", accountCode: "5121807", balance: 12 }),
        group({ kind: "rounding", accountCode: "40000017", balance: 1 }),
        group({ kind: "otherIncome", accountCode: "4200007", balance: -40 }),
      ],
      rates,
    );
    expect(month.salesUsd).toBe(100);
    expect(month.outputVatUsd).toBe(15);
    expect(month.gatewayFeesUsd).toBe(3);
    expect(month.netSalesUsd).toBe(97);
    expect(month.certificateUsd).toBe(5);
    expect(month.otherIncomeUsd).toBe(10);
    expect(month.roundingUsd).toBe(0.25);
    expect(month.accounts.map((account) => account.code)).toEqual(["4112007", "5121807"]);
  });

  it("keeps refunds and fee credits signed in their posting month", () => {
    const months = buildNetSalesMonths(
      [
        group({ month: "2026-08", balance: -400 }),
        group({ month: "2026-09", balance: 80 }),
        group({ month: "2026-09", kind: "gatewayFees", accountCode: "5121807", balance: -8 }),
      ],
      rates,
    );
    expect(months.map((month) => month.month)).toEqual(["2026-08", "2026-09"]);
    expect(months[1].salesUsd).toBe(-20);
    expect(months[1].gatewayFeesUsd).toBe(-2);
    expect(months[1].netSalesUsd).toBe(-18);
  });
});
