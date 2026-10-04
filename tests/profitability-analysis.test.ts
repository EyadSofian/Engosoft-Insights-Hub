import { describe, expect, it } from "vitest";
import { pnlAccountGroups, pnlAccounts, pnlDisplayLabel } from "../src/lib/profitability-analysis";

const lines = [
  { id: "net", label: "Net Profit", value: 172360.97, level: 0 },
  { id: "income", label: "Income", value: 3452930.29, level: 1 },
  { id: "sale", label: "4111007 المبيعات نشاط تقني", value: 1960366.13, level: 3 },
  { id: "cost", label: "Cost of Revenue", value: 250, level: 2 },
  { id: "course-cost", label: "5100106 تكلفة الدورة", value: 250, level: 3 },
  { id: "other-income", label: "Other Income", value: 15, level: 2 },
  { id: "other-revenue", label: "4119996 إيرادات أخرى", value: 15, level: 3 },
  { id: "expenses", label: "Expenses", value: 3280569.32, level: 1 },
  { id: "operating", label: "Expenses", value: 3227813.28, level: 2 },
  { id: "rent-egypt", label: "5130106 م. ايجار المكاتب", value: 102257.39, level: 3 },
  { id: "rent-ksa", label: "5130107 م. ايجار المكاتب", value: 80104.18, level: 3 },
  { id: "depreciation", label: "Depreciation", value: 52756.04, level: 2 },
];

describe("Odoo Profit and Loss breakdown", () => {
  it("finds expense accounts by report section even when expense values are positive", () => {
    expect(pnlAccounts(lines, "expenses").map((line) => line.code)).toEqual([
      "5100106",
      "5130106",
      "5130107",
    ]);
    expect(pnlAccounts(lines, "income").map((line) => line.code)).toEqual(["4111007", "4119996"]);
  });

  it("groups office rent across account codes without counting parent totals twice", () => {
    const groups = pnlAccountGroups(lines, "expenses", "ar");
    expect(groups).toHaveLength(2);
    const rent = groups.find((group) => group.name === "إيجار المكاتب");
    expect(rent?.value).toBeCloseTo(182361.57);
    expect(rent?.accounts).toHaveLength(2);
    expect(pnlDisplayLabel("Depreciation", "ar")).toBe("الإهلاك");
  });
});
