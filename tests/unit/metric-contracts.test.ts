import { describe, expect, it } from "vitest";
import { emptyMetrics, finalizeMetrics } from "@/lib/closed-loop";
import { closedLoopKpis } from "@/lib/closed-loop-kpis";
import { scopeSpend } from "@/lib/management-scope";
import { METRIC_CONTRACTS } from "@/lib/metric-contracts";

const overview = closedLoopKpis({
  all: finalizeMetrics({ ...emptyMetrics(), leads: 10, crmMatched: 4, won: 1, revenue: 50 }),
  tracked: finalizeMetrics({ ...emptyMetrics(), leads: 4, crmMatched: 4, qualified: 2, won: 1, revenue: 50 }),
  totalSpend: 100,
  trackedSpend: 80,
  spendSynced: true,
  crmSynced: true,
  scope: { kind: "all" },
  scopeTotals: {
    spend: scopeSpend({ kind: "all" }, [
      { platform: "meta", spend: 100, adRows: 3, sourceHealthy: true, crmLeads: 5 },
    ]),
    uniqueCrmLeads: 5,
    uniqueWonCustomers: 1,
    collectedRevenue: 70,
    scopeLabel: { en: "All channels", ar: "كل القنوات" },
  },
});

describe("Marketing Overview KPI contracts", () => {
  it("attaches a contract to every management KPI", () => {
    for (const kpi of Object.values(overview)) {
      expect(kpi.contract, `${kpi.key} has no contract`).toBeTruthy();
      expect(kpi.contract!.key).toBe(kpi.key);
    }
  });

  it("states source, grain, numerator, date basis, attribution and platform scope for each", () => {
    for (const contract of Object.values(METRIC_CONTRACTS)) {
      expect(contract.source.length, contract.key).toBeGreaterThan(0);
      expect(contract.grain, contract.key).toBeTruthy();
      expect(contract.numerator.description, contract.key).toBeTruthy();
      expect(contract.dateBasis, contract.key).toBeTruthy();
      expect(contract.attributionScope, contract.key).toBeTruthy();
      expect(contract.platformScope, contract.key).toBeTruthy();
      expect(contract.nullWhen.length, contract.key).toBeGreaterThan(0);
    }
  });

  it("exposes the exact numerator and denominator of every ratio, in the KPI and in its contract", () => {
    for (const kpi of Object.values(overview).filter((row) => row.kind === "ratio")) {
      expect(kpi.numerator, kpi.key).toBeTruthy();
      expect(kpi.denominator, kpi.key).toBeTruthy();
      expect(kpi.contract?.denominator, kpi.key).toBeTruthy();
    }
  });

  it("names the second date basis whenever a ratio divides across two dates", () => {
    for (const kpi of Object.values(overview).filter((row) => row.kind === "ratio")) {
      const contract = kpi.contract!;
      const crossesDates = ["roasAllSpend", "roasTracked", "blendedRoas", "costPerCrmLead", "cplTracked"].includes(
        kpi.key,
      );
      if (crossesDates) expect(contract.denominatorDateBasis, kpi.key).toBeTruthy();
    }
  });

  it("uses one engine per KPI", () => {
    const engines = new Set(Object.values(METRIC_CONTRACTS).map((contract) => contract.engine));
    expect([...engines].every((engine) => typeof engine === "string")).toBe(true);
    expect(METRIC_CONTRACTS.adSpend.engine).toBe("metrics.server");
    expect(METRIC_CONTRACTS.revenue.engine).toBe("closed-loop");
    expect(METRIC_CONTRACTS.collectedRevenue.engine).toBe("accounting");
  });
});
