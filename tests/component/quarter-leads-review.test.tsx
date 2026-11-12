// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { buildQuarterLeadReview } from "@/lib/quarter-leads-report";
import { QuarterLeadReviewPage } from "@/routes/quarter-leads-review";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/use-api", () => ({ useApi: api }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => () => ({}) }));
beforeEach(() => {
  localStorage.clear();
  api.mockReturnValue({
    data: {
      ...buildQuarterLeadReview({
        ads: [],
        leads: [],
        payments: [],
        asOf: "2026-11-12",
        spendCoverage: { "2026-08": true, "2026-09": true, "2026-10": true },
        crmReady: true,
        revenueReady: true,
        linksReady: true,
      }),
      asOf: "2026-11-12",
      generatedAt: "2026-11-12T10:00:00Z",
      availability: { crm: true, revenue: true, links: true },
      tiktokNativeReady: true,
    },
    refetch: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("temporary review page", () => {
  it("shows the fixed three months and explains form-event versus CRM-cohort denominators", () => {
    render(
      <I18nProvider>
        <QuarterLeadReviewPage />
      </I18nProvider>,
    );
    expect(
      screen.getByRole("heading", { name: "Leads: August · September · October" }),
    ).toBeTruthy();
    expect(screen.getByText(/Native platform leads are form events/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export review Excel" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Course × platform" }));
    expect(screen.getByRole("columnheader", { name: "Won / Lost rate" })).toBeTruthy();
  });
  it("provides Arabic copy without relabelling current Fresh as entry-time history", () => {
    localStorage.setItem("engo_lang_v2", "ar");
    render(
      <I18nProvider>
        <QuarterLeadReviewPage />
      </I18nProvider>,
    );
    expect(screen.getByRole("heading", { name: "الليدز: أغسطس · سبتمبر · أكتوبر" })).toBeTruthy();
    expect(screen.getByText(/Fresh هنا = كل الليدز الداخلة/)).toBeTruthy();
  });
});
