import { describe, expect, it, vi } from "vitest";
import type { ProfitabilityMonth, ProfitabilitySnapshot } from "../src/lib/profitability.server";
import { aggregateProfitabilityMonths } from "../src/lib/profitability-aggregate";

const reportWindows: string[] = [];
vi.mock("../src/lib/odoo.server", () => ({
  companyContext: (extra: Record<string, unknown>) => extra,
  odooAccessibleCompanies: async () => [{ id: 6, name: "USD", currency: "USD" }],
  odooConfig: () => ({ pnlCompanyIds: [6] }),
  odooConfigured: () => true,
  odooCallWithPolicy: async (_model: string, method: string, args: unknown[]) => {
    const options = args[1] as { date?: { date_from?: string; date_to?: string } };
    if (method === "get_options")
      return { companies: [{ id: 6, name: "USD" }], date: options?.date ?? {} };
    const from = options.date?.date_from ?? "";
    const to = options.date?.date_to ?? "";
    reportWindows.push(`${from}|${to}`);
    // A whole-period Odoo report would be revalued at one rate and is wrong.
    const net = from === "2026-01-01" && to === "2026-01-31" ? 15 : 25;
    return {
      lines: [
        { id: "net", name: "Net Profit", columns: [{ no_format: net, currency_symbol: "$" }] },
        { id: "income", name: "Income", columns: [{ no_format: 100, currency_symbol: "$" }] },
        {
          id: "expenses",
          name: "Expenses",
          columns: [{ no_format: 100 - net, currency_symbol: "$" }],
        },
      ],
    };
  },
}));

import { getProfitability } from "../src/lib/profitability.server";

const month = (label: string, netProfit: number | null): ProfitabilityMonth => ({
  month: label,
  from: `${label}-01`,
  to: `${label}-28`,
  status: "ready",
  snapshot: {
    from: `${label}-01`,
    to: `${label}-28`,
    currency: "USD",
    sourceCurrency: "USD",
    fxRate: 1,
    reportId: 11,
    postedOnly: true,
    companies: [{ id: 6, name: "USD" }],
    netProfit,
    income: 100.005,
    grossProfit: 90,
    operatingIncome: 90,
    otherIncome: 10,
    costOfRevenue: 0,
    expenses: 100,
    depreciation: 0,
    lines: [],
    fetchedAt: "2026-10-28T00:00:00Z",
  } satisfies ProfitabilitySnapshot,
});

describe("monthly-rate Profit and Loss period totals", () => {
  it("adds only complete Odoo months and preserves missing figures", () => {
    const january = month("2026-01", 15);
    const february = month("2026-02", 25);
    expect(aggregateProfitabilityMonths([january, february])?.netProfit).toBe(40);
    expect(aggregateProfitabilityMonths([january, february])?.income).toBe(200.02);
    expect(aggregateProfitabilityMonths([january, february])?.calculationBasis).toBe(
      "sum_of_odoo_months",
    );
    expect(
      aggregateProfitabilityMonths([january, { ...february, status: "error", snapshot: null }]),
    ).toBeNull();
    expect(aggregateProfitabilityMonths([january, month("2026-02", null)])?.netProfit).toBeNull();
    expect(
      aggregateProfitabilityMonths([
        january,
        {
          ...february,
          snapshot: {
            ...february.snapshot!,
            companies: [{ id: 3, name: "KSA" }],
          },
        },
      ]),
    ).toBeNull();
  });

  it("does not ask Odoo for a full-range revalued report", async () => {
    let result = await getProfitability("2026-01-01", "2026-02-28");
    await vi.waitFor(async () => {
      result = await getProfitability("2026-01-01", "2026-02-28");
      expect(result.status).toBe("ready");
    });
    expect(result.snapshot?.netProfit).toBe(40);
    expect(result.snapshot?.income).toBe(200);
    expect(result.monthly.map((item) => item.snapshot?.netProfit)).toEqual([15, 25]);
    expect(reportWindows.sort()).toEqual(["2026-01-01|2026-01-31", "2026-02-01|2026-02-28"]);
  });
});
