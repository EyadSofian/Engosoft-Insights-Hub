// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { MarketingCosts } from "@/components/MarketingCosts";
import { analyzeMarketingCosts } from "@/lib/marketing-costs";
import type { MarketingCostsReport } from "@/lib/marketing-costs.server";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/use-api", () => ({ useApi: api }));
const makeReport = (): MarketingCostsReport => ({
  from: "2026-10-01",
  to: "2026-10-31",
  generatedAt: "2026-11-10T10:00:00Z",
  timezone: "Asia/Riyadh",
  dateBasis: "payment",
  notApplicable: false,
  scopeNarrowed: false,
  possibleCostOverlap: false,
  ads: {
    spendUsd: 100,
    complete: true,
    platforms: [{ platform: "meta", spend: 100 }],
    daily: [{ date: "2026-10-01", spend: 100 }],
  },
  whatsapp: {
    ...analyzeMarketingCosts(
      [
        {
          accountId: "1",
          date: "2026-10-01",
          phone: "966500000000",
          category: "SERVICE",
          pricingType: "REGULAR",
          currency: "USD",
          cost: 5,
          volume: 100,
        },
      ],
      [],
      [],
    ),
    complete: true,
    reportedCostUsd: 5,
    accounts: [{ id: "1", name: "Company", currency: "USD" }],
    errors: [],
  },
  campaigns: {
    complete: true,
    totalJobs: 0,
    scannedJobs: 2300,
    unreadableJobs: 0,
    error: "",
    phoneCoverageComplete: true,
    acceptedMeaning: "accepted_by_chatwoot_not_verified_delivery",
  },
  combinedUsageUsd: 105,
  billing: { status: "not_connected", chargedUsd: null, taxUsd: null, differenceUsd: null },
});
beforeEach(() => {
  localStorage.clear();
  api.mockReturnValue({
    data: makeReport(),
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});
describe("marketing cost presentation", () => {
  it("keeps advertising, WhatsApp usage and unavailable bank charges distinct", () => {
    render(
      <I18nProvider>
        <MarketingCosts />
      </I18nProvider>,
    );
    expect(screen.getByText("Advertising usage")).toBeTruthy();
    expect(screen.getByText("WhatsApp account usage — before tax")).toBeTruthy();
    expect(screen.getByText("Card charges and tax — separate from usage")).toBeTruthy();
    expect(screen.getByText(/provider amount is preserved/)).toBeTruthy();
    expect(
      screen.getByText(/Payment receipts\/card statements are not yet connected/),
    ).toBeTruthy();
  });
  it("shows an unavailable Meta cost as an em dash, not zero", () => {
    const report = makeReport();
    report.whatsapp.complete = false;
    report.whatsapp.reportedCostUsd = null;
    report.combinedUsageUsd = null;
    api.mockReturnValue({ data: report, isLoading: false });
    render(
      <I18nProvider>
        <MarketingCosts compact />
      </I18nProvider>,
    );
    const card = screen.getByText("WhatsApp account usage — before tax").parentElement!;
    expect(within(card).getByText("—")).toBeTruthy();
    expect(within(card).queryByText("$0")).toBeNull();
    expect(
      screen.getByRole("link", { name: /Details and reconciliation/ }).getAttribute("href"),
    ).toBe("/accounting?view=messaging-costs");
  });
  it("provides the same money explanation in Arabic", () => {
    localStorage.setItem("engo_lang_v2", "ar");
    render(
      <I18nProvider>
        <MarketingCosts />
      </I18nProvider>,
    );
    expect(screen.getByText("مصروفات الإعلانات وواتساب")).toBeTruthy();
    expect(screen.getByText("السحوبات والضريبة — منفصلة عن الاستهلاك")).toBeTruthy();
    expect(screen.getByText(/احتُفظ بالمبلغ كما أرسله المزود/)).toBeTruthy();
  });
});
