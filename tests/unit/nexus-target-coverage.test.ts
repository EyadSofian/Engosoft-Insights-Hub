import { describe, expect, it } from "vitest";
import { INSIGHTS_SURFACES } from "@/lib/agent-insights-registry";
import { NEXUS_SURFACES } from "@/lib/nexus-surface-registry";

/**
 * Figures a person can see on a tab must be figures the agent can read.
 *
 * THE FAILURE. A manager pointed at "إجمالي التارجت $162,000" on the Employee
 * Performance page and the agent said it had no target data. /api/teams had
 * carried `targets.totalTarget = 162000` the whole time, nested one level down.
 * `flatSummary` walks `totals`, `summary`, whatever the registry declares, and
 * top-level numbers — `targets` was none of those, so the number did not exist
 * as far as Nexus was concerned.
 *
 * scripts/audit-agent-coverage.mjs proves this against live payloads. These
 * assertions hold the specific gaps that reached a user.
 */

const surface = (id: string) => INSIGHTS_SURFACES.find((s) => s.id === id)!;

describe("every dashboard figure is reachable by the agent", () => {
  it("declares the target block wherever /api/teams is served", () => {
    for (const id of ["teams", "overview", "social_media"]) {
      const paths = surface(id).summaryPaths ?? [];
      expect(paths, id).toContain("targets");
    }
  });

  it("declares the nested groups that carry headline numbers", () => {
    const expected: Record<string, string[]> = {
      website: ["websiteCampaignAttribution", "reconciliation", "leadSources"],
      accounting: ["funnel", "courses.summary", "snapshot"],
      lost: ["breakdown", "closureMovement"],
      media_buyers: ["coverage"],
      media_plan: ["plan", "actual"],
      organic: ["counts"],
    };
    for (const [id, paths] of Object.entries(expected)) {
      const declared = surface(id).summaryPaths ?? [];
      for (const path of paths) expect(declared, `${id} → ${path}`).toContain(path);
    }
  });

  it("gives every connected surface somewhere to look", () => {
    for (const s of INSIGHTS_SURFACES) {
      if (s.status !== "CONNECTED") continue;
      expect((s.summaryPaths ?? []).length, s.id).toBeGreaterThan(0);
    }
  });
});

describe("the employee performance page describes what it holds", () => {
  const teams = NEXUS_SURFACES.find((s) => s.id === "teams")!;

  it("lists the units-and-teams target board as a tab", () => {
    // It was `tabs: []`, so nothing knew the board existed.
    expect(teams.tabs.map((t) => t.id)).toContain("targets");
    expect(teams.tabs.map((t) => t.id)).toContain("agents");
  });

  it("names the target and achievement figures", () => {
    const ids = teams.elements.map((e) => e.id);
    expect(ids).toContain("teams.target");
    expect(ids).toContain("teams.achievement");
  });

  it("says where achievement comes from, since it is collection not invoicing", () => {
    const achievement = teams.elements.find((e) => e.id === "teams.achievement")!;
    expect(achievement.meaning.ar).toMatch(/تحصيل/);
  });

  it("offers the questions a manager actually asks here", () => {
    const asked = teams.suggestedQuestions.map((q) => q.ar).join(" ");
    expect(asked).toMatch(/التارجت/);
    expect(asked).toMatch(/موظف/);
  });
});
