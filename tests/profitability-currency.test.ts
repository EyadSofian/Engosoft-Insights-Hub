import { describe, expect, it, vi } from "vitest";

const reportCalls: number[][] = [];
vi.mock("../src/lib/odoo.server", () => ({
  companyContext: (extra: Record<string, unknown>) => extra,
  odooAccessibleCompanies: async () => [
    { id: 2, name: "Egypt", currency: "EGP" },
    { id: 3, name: "KSA", currency: "SAR" },
    { id: 4, name: "UAE", currency: "AED" },
    { id: 5, name: "Agwad", currency: "EGP" },
    { id: 6, name: "USD", currency: "USD" },
  ],
  odooConfig: () => ({ pnlCompanyIds: [2, 3, 4, 5, 6] }),
  odooConfigured: () => true,
  odooCallWithPolicy: async (
    _model: string,
    method: string,
    args: unknown[],
    options: { context: { allowed_company_ids: number[] } },
  ) => {
    const ids = options.context.allowed_company_ids;
    if (method === "get_options") {
      const previous = args[1] as { date?: Record<string, unknown> };
      return {
        companies: ids.map((id) => ({ id, name: ({ 2: "Egypt", 3: "KSA", 4: "UAE", 5: "Agwad", 6: "USD" } as Record<number, string>)[id] })),
        date: previous?.date ?? {},
      };
    }
    reportCalls.push([...ids]);
    const income = ids.length === 1 ? 100 : ids.length === 2 ? 140 : 152689.28;
    const expense = ids.length === 1 ? 40 : ids.length === 2 ? 65 : 102130.09;
    return {
      lines: [
        { id: "net", name: "Net Profit", columns: [{ no_format: income - expense, currency_symbol: "$" }] },
        { id: "income", name: "Income", columns: [{ no_format: income, currency_symbol: "$" }] },
        { id: "expenses", name: "Expenses", columns: [{ no_format: expense, currency_symbol: "$" }] },
      ],
    };
  },
}));

import { getProfitabilitySnapshot } from "../src/lib/profitability.server";

describe("Odoo Profit and Loss currency", () => {
  it("keeps Odoo's USD totals without dividing by a SAR rate", async () => {
    const result = await getProfitabilitySnapshot("2026-09-01", "2026-09-30", undefined, 3.7453);
    expect(result.status).toBe("ready");
    expect(reportCalls.at(-1)).toEqual([6, 2, 3, 4, 5]);
    expect(result.snapshot?.income).toBe(152689.28);
    expect(result.snapshot?.expenses).toBe(102130.09);
    expect(result.snapshot?.sourceCurrency).toBe("USD");
    expect(result.snapshot?.fxRate).toBe(1);
  });

  it("isolates a non-USD company by subtracting the USD company in Odoo's currency", async () => {
    const result = await getProfitabilitySnapshot("2026-08-01", "2026-08-31", "KSA", 3.7453);
    expect(result.status).toBe("ready");
    expect(reportCalls).toContainEqual([6, 3]);
    expect(reportCalls).toContainEqual([6]);
    expect(result.snapshot?.companies).toEqual([{ id: 3, name: "KSA" }]);
    expect(result.snapshot?.income).toBe(40);
    expect(result.snapshot?.expenses).toBe(25);
  });
});
