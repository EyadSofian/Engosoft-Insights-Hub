import { afterEach, expect, it, vi } from "vitest";
import { INSIGHTS_MCP } from "@/lib/nod-mcp-tools.server";
import { buildLeadOwnershipAudit } from "@/lib/lead-ownership-audit";

afterEach(() => vi.unstubAllGlobals());

it("preserves the ownership evidence outside paginated MCP rows", async () => {
  const ownershipAudit = buildLeadOwnershipAudit([
    { id: "1", salesperson: "", status: "lost", lossReason: "ليد مكرر" },
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        ownershipAudit,
        bySalesOwner: [{ name: "—", leads: 1, lost: 1, confirmedDuplicate: 1 }],
      }),
    ),
  );
  const tool = INSIGHTS_MCP.tools.find((tool) => tool.name === "insights_get")!;
  const result = (await tool.run(
    {
      endpoint: "/api/lead-performance",
      params: { month: "2026-11" },
      path: "bySalesOwner",
      offset: 0,
      limit: 1,
    },
    { request: new Request("https://example.test/api/mcp") },
  )) as any;
  expect(result.data).toHaveLength(1);
  expect(result.ownershipAudit.currentOwnerMissingRecordedDuplicateLost).toBe(1);
  expect(result.ownershipAudit.neverContacted).toBeNull();
  expect(result.interpretationRules.en).toContain("does not prove never-assigned");
  expect(INSIGHTS_MCP.instructions).toContain("Target achievement is not a lead conversion rate");
});
