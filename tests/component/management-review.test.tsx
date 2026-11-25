// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { filterStore } from "@/lib/filter-store";
import { Route } from "@/routes/management-review";
const query = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-query", () => ({ useQuery: query }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => config,
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n")>()),
  useI18n: () => ({ lang: "en" }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  filterStore.reset();
});

it("uses the top-bar dates, shows their exact period and has no independent review-month selector", async () => {
  const row = {
    month: "2026-11",
    funnelAvailable: true,
    funnelEnriched: true,
    planStatus: "draft",
    coverage: { crm: true, ads: true, revenue: true },
    target: { revenue: 140000, spend: 23500, leads: 3400 },
    actual: { revenue: 77850, spend: 1000, leads: 2255, crmLeads: 3000, certificateRevenue: null },
    achievement: { revenue: 77850 / 140000, spend: 1000 / 23500, leads: 2255 / 3400 },
    budget: { targetRate: null },
    lostMovement: {},
    funnel: { reasons: [], courses: [], leads: 3000, won: 100, lost: 200 },
  };
  const data = {
    selectedPeriod: { from: "2026-11-05", to: "2026-11-15" },
    today: "2026-11-25",
    selected: row,
    rows: [row],
    months: ["2026-11"],
    historical: { status: "ready", funnelReady: true },
  };
  query.mockReturnValue({ data, isLoading: false, error: null, refetch: vi.fn() });
  const fetchMock = vi.fn().mockResolvedValue(Response.json(data));
  vi.stubGlobal("fetch", fetchMock);
  filterStore.setDates("2026-11-05", "2026-11-15");
  const Component = (Route as unknown as { component: () => React.ReactNode }).component;
  render(<Component />);
  expect(screen.getByText("2026-11-05 → 2026-11-15")).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getByText("Media-plan revenue achievement")).toBeTruthy();
  await query.mock.calls[0][0].queryFn();
  const url = new URL(fetchMock.mock.calls[0][0], "https://test");
  expect(url.searchParams.get("from")).toBe("2026-11-05");
  expect(url.searchParams.get("to")).toBe("2026-11-15");
  fireEvent.click(screen.getByRole("button", { name: "November 2026" }));
  expect(filterStore.get().from).toBe("2026-11-01");
  expect(filterStore.get().to).toBe("2026-11-25");
});
