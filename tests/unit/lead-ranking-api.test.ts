import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/api/lead-ranking";
const mock = vi.hoisted(() => ({
  getFiltered: vi.fn(),
  directory: vi.fn(),
  fresh: vi.fn(),
  archived: vi.fn(),
}));
vi.mock("@/lib/metrics.server", () => ({
  getFiltered: mock.getFiltered,
  authoritativeLostLeads: (data: { lost: unknown[] }) => data.lost,
}));
vi.mock("@/lib/api.server", () => ({
  json: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock("@/lib/employee-directory.server", () => ({ getEmployeeDirectory: mock.directory }));
vi.mock("@/lib/crm-fresh-lost.server", () => ({
  loadFreshLostPipeline: mock.fresh,
  loadArchivedLostLeads: mock.archived,
}));
const handler = (
  Route.options as unknown as {
    server: { handlers: { GET: (input: { request: Request }) => Promise<Response> } };
  }
).server.handlers.GET;
const get = (query: string) =>
  handler({ request: new Request(`https://example.test/api/lead-ranking?${query}`) });
beforeEach(() => {
  vi.clearAllMocks();
  mock.getFiltered.mockImplementation(async (applied) => ({
    applied,
    crm: [
      {
        id: "1",
        salesperson: "Sara Login",
        salesTeam: "A",
        course: "Mech",
        courses: "HVAC",
        createdAt: "2026-05-01",
        isWon: true,
        wonDate: "2026-06-01",
        closedAt: "",
      },
    ],
    lost: [],
    accounting: [],
    snapshot: {
      health: {
        lostAuthority: "postgres-last-good",
        crmAuthority: "postgres-last-good",
        accountingAuthority: "postgres-live",
      },
    },
  }));
  mock.directory.mockResolvedValue({
    people: [
      {
        userId: 7,
        legalName: "Sara Legal Name",
        displayName: "Sara Legal Name",
        spellings: ["Sara Login", "Sara Legal Name"],
      },
    ],
    displayNameFor: (name: string) => name,
  });
  mock.fresh.mockResolvedValue({
    availability: "available",
    records: [
      {
        id: "2",
        salesperson: "Sara Login",
        salesTeam: "A",
        course: "Mech",
        courses: "HVAC",
        createdAt: "2026-08-01",
      },
    ],
  });
  mock.archived.mockResolvedValue({ availability: "available", records: [] });
});
describe("ranking data API", () => {
  it("refuses invalid months before reading any data", async () => {
    expect((await get("month=2026-13")).status).toBe(400);
    expect(mock.getFiltered).not.toHaveBeenCalled();
  });
  it("uses complete peers, native Odoo Lost and declared employee aliases", async () => {
    const response = await get(
      "month=2026-10&from=2026-09-01&salesperson=Other&course=PMP&platform=meta",
    );
    expect(mock.getFiltered).toHaveBeenCalledWith({
      from: "2026-04-01",
      to: "2026-09-30",
      dateBasis: "payment",
    });
    const body = await response.json();
    expect(body.groups[0].rows[0]).toMatchObject({
      key: "user:7",
      name: "Sara Legal Name",
      leads: 2,
      won: 1,
      conversionRate: 50,
    });
    expect(body.health.lost).toBe("odoo-direct");
    expect(JSON.stringify(body)).not.toMatch(/phone|email|apiKey/);
  });
  it("makes conversion unavailable when neither live nor stored Lost exists", async () => {
    mock.fresh.mockResolvedValue({ availability: "unavailable", records: [] });
    mock.getFiltered.mockResolvedValue({
      crm: [
        {
          id: "1",
          salesperson: "Sara",
          salesTeam: "A",
          course: "Mech",
          courses: "",
          createdAt: "2026-05-01",
          isWon: false,
          wonDate: "",
          closedAt: "",
        },
      ],
      lost: [],
      accounting: [],
      applied: {},
      snapshot: { health: { lostAuthority: "unavailable" } },
    });
    const body = await (await get("month=2026-10")).json();
    expect(body.groups[0].rows[0]).toMatchObject({ conversionRate: null, score: null, rank: null });
  });
});
