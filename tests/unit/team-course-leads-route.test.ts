import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ filtered: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (config: unknown) => config }));
vi.mock("@/lib/metrics.server", () => ({
  getFiltered: mocks.filtered,
  authoritativeLostLeads: (data: any) => data.lost,
  getDefaultRange: async () => ({ from: "2026-11-01", to: "2026-11-26" }),
}));
vi.mock("@/lib/odoo.server", () => ({ odooConfig: () => ({ url: "https://odoo.test" }) }));
beforeEach(() => {
  mocks.filtered.mockResolvedValue({
    crm: [
      {
        id: "42",
        salesperson: "Sales A",
        course: "PMP",
        company: "Egypt",
        createdAt: "2026-11-15",
        recordType: "lead",
        businessStatus: "lead",
      },
    ],
    lost: [],
    snapshot: { health: { lostAuthority: "live" }, syncedAt: "2026-11-26" },
  });
});
afterEach(() => vi.clearAllMocks());
async function invoke(params: Record<string, string> = {}) {
  const { Route } = await import("@/routes/api/team-course-leads");
  return (Route as any).server.handlers.GET({
    request: new Request(
      "https://test/api/team-course-leads?" +
        new URLSearchParams({ ownerKey: '["Sales A"]', matrixCourse: "PMP", ...params }),
    ),
  }) as Promise<Response>;
}
it("forwards all filters and returns the exact owner/course list with Odoo hyperlinks", async () => {
  const result = await invoke({
    from: "2026-11-10",
    to: "2026-11-20",
    salesTeam: "Team A",
    platform: "meta",
    source: "Facebook",
  });
  expect(result.status).toBe(200);
  const data = await result.json();
  expect(mocks.filtered).toHaveBeenCalledWith(
    expect.objectContaining({
      from: "2026-11-10",
      to: "2026-11-20",
      salesTeam: "Team A",
      platform: "meta",
      source: "Facebook",
    }),
  );
  expect(data.total).toBe(1);
  expect(data.rows[0].odooUrl).toBe("https://odoo.test/web#id=42&model=crm.lead&view_type=form");
});
it.each([
  { ownerKey: "" },
  { matrixCourse: "" },
  { offset: "-1" },
  { limit: "0" },
  { limit: "101" },
])("rejects invalid cell/page parameters %o", async (params) => {
  expect((await invoke(params)).status).toBe(400);
  expect(mocks.filtered).not.toHaveBeenCalled();
});
it("does not present an unavailable Lost population as a complete lead list", async () => {
  mocks.filtered.mockResolvedValueOnce({ snapshot: { health: { lostAuthority: "unavailable" } } });
  expect((await invoke()).status).toBe(503);
});
