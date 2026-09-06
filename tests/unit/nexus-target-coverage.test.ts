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

describe("employee rows carry performance and nothing personal", () => {
  /**
   * "Who is behind quota?" needs names and numbers. It must never need, or
   * accidentally carry, a phone number.
   *
   * These used to grep the route file for a constant, which stopped meaning
   * anything the moment the logic moved into a module. They now drive the real
   * gateway with a stubbed source and assert on what actually leaves it — the
   * property that was always the point.
   */
  const FORBIDDEN = [
    "phone",
    "mobile",
    "email",
    "recordingUrl",
    "transcript",
    "address",
    "nationalId",
    "employeeId",
  ];

  /** One agent row carrying every field a real /api/teams row carries, plus PII. */
  const agentRow = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    displayName: name,
    team: "Website",
    paidRevenue: 12_000,
    cleanLeads: 100,
    won: 10,
    conversionRate: 10,
    // Everything below must never leave the gateway.
    phone: "+201000000000",
    mobile: "+201000000001",
    email: "someone@engosoft.com",
    recordingUrl: "https://example.com/call.mp3",
    transcript: "hello",
    address: "Cairo",
    nationalId: "29001010101010",
    employeeId: "632",
    leadPhoneKeys: ["201000000000"],
    chatwootAgentId: 42,
    target: { target: 15_000, achievementPaid: 80, teamLeader: "Nader Aziz" },
    ...extra,
  });

  const teamsPayload = {
    totals: { spend: 1 },
    summary: { agents: 1 },
    agents: Array.from({ length: 200 }, (_, index) => agentRow(`Rep ${index}`)),
    teams: [{ name: "Website", crmLeads: 10, won: 2, people: [{ name: "Rep 0" }] }],
  };

  const readTeams = async () => {
    const { readSurface } = await import("@/lib/agent-surface-gateway.server");
    return readSurface({
      surfaceId: "teams",
      operation: "list",
      view: null,
      params: new URLSearchParams({ from: "2026-08-01", to: "2026-08-31" }),
      origin: "http://hub.test",
      fetchImpl: (async () =>
        new Response(JSON.stringify(teamsPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch,
    });
  };

  it("allow-lists performance fields only", async () => {
    const result = await readTeams();
    expect(result.rows.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(result);
    for (const field of FORBIDDEN) {
      expect(serialised, field).not.toContain(field);
    }
    // The values themselves, not just the key names.
    for (const value of ["+201000000000", "someone@engosoft.com", "29001010101010"]) {
      expect(serialised, value).not.toContain(value);
    }
  });

  it("keeps the figures a manager actually asks for", async () => {
    const result = await readTeams();
    const rep = result.rows.find((row) => row.label === "Rep 0")!;
    expect(rep.metrics.target).toBe(15_000);
    expect(rep.metrics.achievementPaid).toBe(80);
    expect(rep.metrics.paidRevenue).toBe(12_000);
    expect(rep.kind).toBe("salesperson");
  });

  it("caps how many rows can leave", async () => {
    const result = await readTeams();
    const people = result.rows.filter((row) => row.kind === "salesperson");
    // 200 agents in, at most the contract's cap out.
    expect(people.length).toBeLessThanOrEqual(60);
  });

  it("projects only the collections a ranking question needs", async () => {
    const { contractById } = await import("@/lib/agent-surface-contract");
    const collections = (contractById("teams")!.rows ?? []).map((row) => row.collection);
    expect(collections).toEqual(["agents", "teams", "leaderboard", "needsAttention"]);
  });

  it("reads teams[].people, which is the field name that actually exists", async () => {
    const result = await readTeams();
    const team = result.rows.find((row) => row.kind === "team")!;
    // The agent looked for teams[].salespeople, found nothing, and reported
    // insufficient data with the evidence in hand.
    expect(team.metrics.peopleCount).toBe(1);
  });
});
