// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * WHAT THIS SUITE PROTECTS
 *
 * This report is the one management reads to judge lead quality and sales
 * follow-up, so the failure modes that matter are not crashes — they are a
 * figure that reads as a result when it is actually missing evidence, and a
 * figure that exists but cannot be seen.
 *
 * 1. Withheld evidence renders as an em dash, never as zero. "Nobody called
 *    this lead" and "we cannot see the calls" must never look the same.
 * 2. Every funnel stage carries its own step conversion, because a funnel of
 *    bare counts does not say where the leak is.
 * 3. The follow-up columns reach every breakdown dimension, not only the month
 *    total. Judging a salesperson needs their attempts, not the company's.
 * 4. The export carries the cohort the reader is actually looking at.
 *
 * The router is mocked: this is a presentation test, and a real route tree
 * would make it a test about TanStack.
 */
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to?: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: "/leads", search: { view: "performance" } }),
}));

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { SixMonthPerformance } = await import("@/components/leads/SixMonthPerformance");
const { I18nProvider } = await import("@/lib/i18n");
const { filterStore } = await import("@/lib/filter-store");
const { clearNexusView, getNexusView } =
  await import("@/components/engo-nexus/state/nexus-view-context");

const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

const group = (name: string, patch: Record<string, unknown> = {}) => ({
  name,
  leads: 100,
  duplicateSameMonth: 6,
  duplicateEarlierMonth: 4,
  confirmedDuplicate: 2,
  unqualified: 8,
  noAnswer: 11,
  unreachable: 3,
  noInterest: 7,
  lost: 40,
  opportunities: 55,
  crmWon: 14,
  contacted: 70,
  contactedWithin24h: 45,
  paidLeads: 12,
  paidOrders: 13,
  paidLater: 5,
  paidRevenue: 9_400,
  conversionRate: 12,
  lostRate: 40,
  contact0: 10,
  contact1: 25,
  contact2: 20,
  contact3Plus: 25,
  averageAttempts: 2.4,
  averageDaysToFirstCall: 0.5,
  averageHoursToFirstCall: 9.5,
  exactLagSample: 60,
  callMatchable: 80,
  ...patch,
});

const response = (patch: Record<string, unknown> = {}) => ({
  asOf: "2026-10-23",
  months: MONTHS,
  selectedMonth: "2026-09",
  rows: MONTHS.map((month) => group(month)),
  selected: group("2026-09"),
  stages: [],
  byCourse: [group("PMP"), group("CFM", { leads: 40, averageAttempts: 1.1 })],
  bySource: [group("Facebook")],
  byCampaign: [group("pmp-23-12-25-sayed")],
  byMediaBuyer: [group("Sayed")],
  bySalesOwner: [
    group("Fast Caller", { averageHoursToFirstCall: 1.5, averageAttempts: 3.8 }),
    group("Slow Caller", { averageHoursToFirstCall: 72, averageAttempts: 1.1 }),
  ],
  bySalesCloser: [group("Closer A", { conversionRate: null, lostRate: null })],
  lossReasons: [{ key: "not_reached", ar: "لا يرد", en: "No answer", count: 11 }],
  unqualifiedReasons: [
    { category: "customer_data", count: 5 },
    { category: "course_fit", count: 2 },
    { category: "unspecified", count: 1 },
  ],
  coverage: {
    excludedRecommendation: 3,
    excludedBroadcast: 2,
    missingIdentity: 1,
    unknownCampaign: 4,
    unknownMediaBuyer: 6,
    qaReviewed: 20,
    ambiguousOrders: 0,
    unlinkedAccountingLines: 10,
    linkedAccountingLines: 190,
    callsAvailable: true,
    qaAvailable: true,
    linksAvailable: true,
  },
  collectionsByMonth: MONTHS.map((month) => ({ month, paidInvoices: 31, paidUsd: 22_000 })),
  callCoverage: { expectedDays: 180, coveredDays: 180, newestSync: "2026-10-23T06:00:00.000Z" },
  source: { crm: "Odoo CRM (creation date; current status)" },
  availability: {
    crm: true,
    lost: true,
    accounting: true,
    callRefreshSucceeded: true,
    crmSyncedAt: "2026-10-23T05:00:00.000Z",
    lostSyncedAt: "2026-10-23T05:00:00.000Z",
    accountingSyncedAt: "2026-10-23T05:00:00.000Z",
  },
  linksRefreshedAt: "2026-10-23T05:00:00.000Z",
  syncedAt: "2026-10-23T05:00:00.000Z",
  health: {},
  ...patch,
});

let requested: string[] = [];

function mount(payload: Record<string, unknown>) {
  requested = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      requested.push(String(input));
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <SixMonthPerformance />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.innerWidth = 1600;
  filterStore.reset();
  clearNexusView();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the six-month lead-to-paid report", () => {
  it("shows a verified contact rate but does not invent opportunity or paid transitions", async () => {
    mount(response());
    await waitFor(() => expect(screen.getByText(/Evidence-backed funnel/i)).toBeTruthy());
    const funnel = screen.getByText(/Evidence-backed funnel/i).closest("section")!;
    // 70 contacted of 80 matchable leads — over entries it would read 70%,
    // which would blame follow-up for a phone-matching limit.
    expect(within(funnel).getByText(/87\.5%\s*of phone-matchable leads/)).toBeTruthy();
    // Paid is shown only as a share of entries, not a made-up transition rate.
    expect(within(funnel).getByText(/12\.0%\s*of all entries/)).toBeTruthy();
    expect(within(funnel).getByText(/current-status proxy/i)).toBeTruthy();
  });

  it("shows withheld call evidence as an em dash rather than zero", async () => {
    mount(
      response({
        selected: group("2026-09", {
          contacted: null,
          contactedWithin24h: null,
          contact0: null,
          contact1: null,
          contact2: null,
          contact3Plus: null,
          averageAttempts: null,
          averageDaysToFirstCall: null,
          averageHoursToFirstCall: null,
          exactLagSample: null,
          callMatchable: null,
        }),
        coverage: { ...response().coverage, callsAvailable: false },
      }),
    );
    await waitFor(() => expect(screen.getByText(/PBX call attempts/i)).toBeTruthy());
    const contact = screen.getByText(/PBX call attempts/i).closest("section")!;
    expect(within(contact).getByText(/Average attempts/i).parentElement!.textContent).toContain(
      "—",
    );
    expect(within(contact).queryByText("0")).toBeNull();
    // And the reader is told why, instead of being left to read the dash —
    // once at the top of the page and again beside the withheld figures.
    expect(screen.getAllByText(/coverage is incomplete/i).length).toBeGreaterThanOrEqual(2);
  });

  it("carries follow-up figures into the per-salesperson breakdown", async () => {
    mount(response());
    await waitFor(() => expect(screen.getByText(/Where did the result come from\?/i)).toBeTruthy());
    const breakdown = screen.getByText(/Where did the result come from\?/i).closest("section")!;
    // The dimension table must be able to answer "who is slow to call?", which
    // the month total never could.
    expect(within(breakdown).getByText(/Average attempts/i)).toBeTruthy();
    expect(within(breakdown).getByText(/Hours to first attempt/i)).toBeTruthy();
  });

  it("exports the cohort the reader is looking at, not a default", async () => {
    mount(response());
    await waitFor(() => expect(screen.getByText(/Download the report/i)).toBeTruthy());
    const link = screen.getByText(/Download the report/i).closest("a")!;
    expect(link.getAttribute("href")).toContain("/api/lead-performance-export");
    expect(link.getAttribute("href")).toContain("month=2026-09");
  });

  it("declares the cohort on screen to the assistant", async () => {
    mount(response());
    await waitFor(() => expect(screen.getByText(/From lead to paid enrollment/i)).toBeTruthy());
    const view = getNexusView();
    expect(view.surface).toBe("leads");
    expect(view.tab).toBe("performance");
    expect(view.parameters).toEqual({ month: "2026-09" });
  });

  it("refuses rather than reporting a misleading zero when the CRM snapshot is stale", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "CRM_STALE" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <SixMonthPerformance />
        </I18nProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(/CRM data is stale/i)).toBeTruthy());
    expect(screen.queryByText(/From lead to paid enrollment/i)).toBeNull();
  });
});
