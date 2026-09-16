import { describe, expect, it } from "vitest";
import { CRM_NORMAL_SCOPE_FILTER, crmNormalScopeDomain } from "../../src/lib/crm-contract";
import { buildCrmCandidateDomains } from "../../src/lib/crm-odoo.server";
import { buildLostRegistrationDomains } from "../../src/lib/crm-lost-registration-audit.server";

const inventoryFilter = [...CRM_NORMAL_SCOPE_FILTER];

function expectNormalCrmScope(domain: unknown[]) {
  expect(domain[0]).toEqual(inventoryFilter);
  expect(
    domain.filter((clause) => JSON.stringify(clause) === JSON.stringify(inventoryFilter)),
  ).toHaveLength(1);
}

describe("normal CRM Data Inventory scope", () => {
  it("adds the explicit inventory filter without adding a stage condition", () => {
    const domain = crmNormalScopeDomain([["active", "=", true]]);

    expect(domain).toEqual([
      ["inventory_bucket", "=", false],
      ["active", "=", true],
    ]);
    expect(JSON.stringify(domain)).not.toContain("stage_id");
    expect(JSON.stringify(domain).toLowerCase()).not.toContain("preparation");
  });

  it("scopes both active and inactive candidate reads before lifecycle classification", () => {
    const metadata = {
      create_date: { type: "datetime" },
      lost_verification_date: { type: "datetime" },
      date_last_stage_update: { type: "datetime" },
      date_closed: { type: "datetime" },
    };
    const domains = buildCrmCandidateDomains(metadata, "2025-12-31 00:00:00");

    expectNormalCrmScope(domains.activeDomain);
    expectNormalCrmScope(domains.inactiveDomain);
    expect(domains.activeDomain).toContainEqual(["active", "=", true]);
    expect(domains.inactiveDomain).toContainEqual(["active", "=", false]);
    expect(JSON.stringify(domains)).not.toContain("stage_id");
    expect(JSON.stringify(domains).toLowerCase()).not.toContain("preparation");
  });

  it("scopes every direct Lost-registration audit query", () => {
    for (const hasWonStatus of [true, false]) {
      for (const hasStageLost of [true, false]) {
        const domains = buildLostRegistrationDomains({ hasWonStatus, hasStageLost });

        for (const domain of Object.values(domains)) expectNormalCrmScope(domain);
        expect(JSON.stringify(domains)).not.toContain("stage_id");
        expect(JSON.stringify(domains).toLowerCase()).not.toContain("preparation");
      }
    }
  });
});
