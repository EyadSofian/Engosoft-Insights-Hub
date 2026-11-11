// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { buildDailyUpdates } from "@/lib/daily-updates";
import { DailyUpdates } from "@/routes/daily-updates";
const query = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-query", () => ({ useQuery: query }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
  Link: ({ children, to, search, onClick, ...rest }: any) => (
    <a href={to} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));
const fixture = () => ({
  ...buildDailyUpdates({
    day: "2026-11-11",
    availability: {
      crm: true,
      lost: true,
      revenue: true,
      links: true,
      daySpend: true,
      monthSpend: true,
    },
    entries: [
      {
        id: "1",
        course: "CFM",
        createdAt: "2026-11-11",
        status: "open",
        recordType: "opportunity",
        source: "Facebook",
        segment: "Fresh",
        name: "Example record",
        url: "https://example.test/crm/1",
        campaign: "CFM campaign",
      },
    ],
    losses: [],
    payments: [],
    spend: [
      {
        course: "CFM",
        campaign: "CFM campaign",
        campaignKey: "id:1",
        platform: "meta",
        date: "2026-11-11",
        spend: 25,
        attribution: "campaign_name",
      },
    ],
  }),
  generatedAt: "2026-11-11T10:00:00Z",
  errors: [],
  financialOnlyScope: false,
  unlinkedInvoices: 2,
  sources: { revenueSyncedAt: "2026-11-11T09:00:00Z", linksSyncedAt: "2026-11-11T09:00:00Z" },
});
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T10:00:00Z"));
  query.mockReturnValue({
    data: fixture(),
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
});
describe("daily updates presentation", () => {
  it("opens the actual cohort records and Odoo link, not only a generic destination", () => {
    render(
      <I18nProvider>
        <DailyUpdates />
      </I18nProvider>,
    );
    expect(screen.getByRole("heading", { name: "Daily Updates" })).toBeTruthy();
    expect(screen.getByText(/unambiguous Opportunity link/)).toBeTruthy();
    const tr = screen.getByText("CFM", { exact: true }).closest("tr")!;
    fireEvent.click(within(tr).getAllByRole("button", { name: "1", exact: true })[0]);
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog)
        .getByRole("link", { name: /Example record/ })
        .getAttribute("href"),
    ).toBe("https://example.test/crm/1");
  });
  it("expands campaigns with observed spend and supports course search", () => {
    render(
      <I18nProvider>
        <DailyUpdates />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "1 campaigns" }));
    expect(screen.getByRole("link", { name: /CFM campaign/ }).getAttribute("href")).toBe(
      "/campaigns",
    );
    expect(screen.getByText(/not proof that a campaign is Active/)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Search courses" }), {
      target: { value: "PMP" },
    });
    expect(screen.getByText("No courses in this selection.")).toBeTruthy();
  });
  it("renders Arabic copy and keeps missing Lost unavailable", () => {
    localStorage.setItem("engo_lang_v2", "ar");
    const data = fixture();
    data.totals.lostDay = null;
    data.rows[0].lostDay = null;
    query.mockReturnValue({ data, isPending: false, refetch: vi.fn() });
    render(
      <I18nProvider>
        <DailyUpdates />
      </I18nProvider>,
    );
    expect(screen.getByRole("heading", { name: "دايلي أبديتس" })).toBeTruthy();
    const card = screen.getAllByText("اتعمل Lost اليوم", { exact: true })[0].parentElement!;
    expect(within(card).getByText("—")).toBeTruthy();
  });
});
