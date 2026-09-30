// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { buildLeadRankings, type RankingCrmLead, type RankingInvoice } from "@/lib/lead-ranking";
import { LeadDistribution } from "@/routes/lead-distribution";

const mock = vi.hoisted(() => ({ query: vi.fn(), state: {} as Record<string, unknown> }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => {
    mock.query(options);
    return mock.state;
  },
}));
const fixture = () => ({
  ...buildLeadRankings({
    month: "2026-10",
    lost: [],
    crm: [
      {
        id: "1",
        salesperson: "Sara",
        salesTeam: "A",
        course: "Mech",
        courses: "HVAC",
        createdAt: "2026-05-01",
        isWon: true,
        wonDate: "2026-09-01",
        closedAt: "",
      } as RankingCrmLead,
    ],
    accounting: [
      {
        id: "1",
        salesperson: "Sara",
        salesTeam: "A",
        course: "Mech",
        product: "HVAC",
        company: "Egypt",
        usdPaid: 100,
        movement: "INV/1",
        paymentDate: "2026-05-01",
        invoiceDate: "2026-05-01",
        isCreditNote: false,
      } as RankingInvoice,
    ],
  }),
  health: { crm: "odoo-direct", lost: "odoo-direct", accounting: "postgres-live" },
});
const wrap = () =>
  render(
    <I18nProvider>
      <LeadDistribution />
    </I18nProvider>,
  );
beforeEach(() => {
  mock.query.mockClear();
  mock.state = { data: fixture(), isLoading: false, error: null, refetch: vi.fn() };
  window.localStorage.clear();
});
afterEach(cleanup);

describe("lead distribution report", () => {
  it("shows the authoritative window, fixed weights, rank and chosen scope", () => {
    wrap();
    expect(screen.getByText("2026-04-01 → 2026-09-30")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getAllByText("25%")).toHaveLength(2);
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByLabelText("Specialization")).toHaveValue("Mech");
    fireEvent.change(screen.getByLabelText("Course"), {
      target: { value: fixture().groups.find((group) => group.course === "HVAC")!.key },
    });
    expect(screen.getByText("HVAC", { selector: "p" })).toBeInTheDocument();
  });
  it("requests the distribution month without inheriting global filters", async () => {
    wrap();
    fireEvent.change(screen.getByLabelText("Distribution month"), { target: { value: "2026-11" } });
    const options = mock.query.mock.calls.at(-1)![0] as { queryFn: () => Promise<unknown> };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => fixture() });
    vi.stubGlobal("fetch", fetchMock);
    await options.queryFn();
    expect(fetchMock).toHaveBeenCalledWith("/api/lead-ranking?month=2026-11");
    vi.unstubAllGlobals();
  });
  it("keeps insufficient data visible instead of calling a salesperson first", () => {
    const data = fixture();
    for (const group of data.groups)
      for (const row of group.rows) {
        row.score = null;
        row.rank = null;
        row.conversionRate = null;
      }
    mock.state.data = data;
    wrap();
    expect(screen.getByText("No complete ranking available")).toBeInTheDocument();
    expect(screen.getByText("Insufficient data")).toBeInTheDocument();
    expect(screen.queryByText("#1")).toBeNull();
  });
  it("renders Arabic scope labels and rank without breaking RTL", () => {
    window.localStorage.setItem("engo_lang_v2", "ar");
    wrap();
    expect(screen.getByLabelText("شهر التوزيع")).toBeInTheDocument();
    expect(screen.getByLabelText("التخصص")).toHaveValue("Mech");
    expect(screen.getByText("#1")).toBeInTheDocument();
  });
});
