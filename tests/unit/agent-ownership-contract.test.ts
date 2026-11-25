import { expect, it } from "vitest";
import { readSurface } from "@/lib/agent-surface-gateway.server";
import { buildLeadOwnershipAudit } from "@/lib/lead-ownership-audit";

it("forwards management-review dates and exposes the exact period and plan basis", async () => {
  let called = "";
  const result = await readSurface({
    surfaceId: "management_review",
    operation: "summary",
    view: null,
    params: new URLSearchParams({ from: "2026-11-01", to: "2026-11-25" }),
    origin: "https://example.test",
    lang: "en",
    fetchImpl: (async (url) => {
      called = String(url);
      return Response.json({
        selectedPeriod: { from: "2026-11-01", to: "2026-11-25" },
        targetBasis: "Full monthly media plan",
      });
    }) as typeof fetch,
  });
  expect(new URL(called).searchParams.get("from")).toBe("2026-11-01");
  expect(new URL(called).searchParams.get("to")).toBe("2026-11-25");
  expect(result.summary.from).toBe("2026-11-01");
  expect(result.summary.targetBasis).toBe("Full monthly media plan");
  expect(result.caveats.some((line) => line.includes("not employee sales targets"))).toBe(true);
});

it("passes the ownership interpretation and duplicate split to agent tools, not just an ownerless total", async () => {
  const audit = buildLeadOwnershipAudit([
    { id: "duplicate", salesperson: "", status: "lost", lossReason: "ليد مكرر" },
    { id: "active", salesperson: "", status: "lead", lossReason: "" },
  ]);
  const result = await readSurface({
    surfaceId: "teams",
    operation: "summary",
    view: null,
    params: new URLSearchParams({ from: "2026-11-01", to: "2026-11-25" }),
    origin: "https://example.test",
    lang: "en",
    fetchImpl: (async () => Response.json({ ownershipAudit: audit })) as typeof fetch,
  });
  expect(result.summary.currentOwnerMissing).toBe(2);
  expect(result.summary.currentOwnerMissingRecordedDuplicateLost).toBe(1);
  expect(result.summary.currentOwnerMissingOpenOrLead).toBe(1);
  expect(result.caveats.some((line) => line.includes("does not prove never-assigned"))).toBe(true);
  expect(
    result.caveats.some((line) => line.includes("Aggregate rate comparisons do not establish")),
  ).toBe(true);
});

it("keeps a blank cohort owner explicitly current-only and forwards the requested cohort month", async () => {
  const seen: string[] = [];
  const result = await readSurface({
    surfaceId: "leads",
    operation: "summary",
    view: "performance",
    params: new URLSearchParams({ month: "2026-10" }),
    origin: "https://example.test",
    lang: "en",
    fetchImpl: (async (url) => {
      const u = new URL(String(url));
      if (u.pathname === "/api/lead-performance") {
        seen.push(u.searchParams.get("month") || "");
        return Response.json({
          selectedMonth: "2026-10",
          bySalesOwner: [{ name: "—", leads: 20, lost: 18, confirmedDuplicate: 17 }],
        });
      }
      return Response.json({});
    }) as typeof fetch,
  });
  expect(seen).toEqual(["2026-10"]);
  const row = result.rows.find((row) => row.kind === "current_crm_owner");
  expect(row?.label).toContain("not assignment/contact history");
  expect(row?.metrics.confirmedDuplicate).toBe(17);
  expect(row?.line).toContain("Lost بسبب مكرر");
});
