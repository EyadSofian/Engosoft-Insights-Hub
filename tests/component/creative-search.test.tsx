// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { filterStore } from "@/lib/filter-store";
import { CreativeAdsTable, type ClosedLoopResponse } from "@/components/acquisition/ClosedLoop";
import { emptyMetrics } from "@/lib/closed-loop";

const response: ClosedLoopResponse = {
  configured: true,
  grains: {
    campaign: [],
    adset: [],
    creative: [],
    ad: [
      {
        ...emptyMetrics(),
        key: "ad:1",
        adName: "PMP-Ad1-20-July 25",
        adId: "12000001",
        campaignId: "c1",
        campaignName: "PMP campaign",
        adsetId: "s1",
        adsetName: "PMP July",
        creativeId: "creative1",
        creativeName: "PMP creative",
        spend: 123,
        leads: 10,
      },
    ],
  },
};
afterEach(() => {
  cleanup();
  filterStore.reset();
});
describe("creative table search", () => {
  it("finds the example by normalized name or ID and can clear search", () => {
    render(
      <I18nProvider>
        <CreativeAdsTable data={response} loading={false} onOpenCreative={() => {}} />
      </I18nProvider>,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "pmp_ad 1_20_JUL_25" } });
    expect(screen.getByText("PMP-Ad1-20-July 25")).toBeTruthy();
    expect(screen.getByText("$123")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "12000001" } });
    expect(screen.getByText("PMP-Ad1-20-July 25")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });
  it("widens only when requested and preserves the search text", () => {
    filterStore.setDates("2026-11-01", "2026-11-05");
    render(
      <I18nProvider>
        <CreativeAdsTable data={response} loading={false} onOpenCreative={() => {}} />
      </I18nProvider>,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Missing old ad" } });
    expect(screen.getByText("No matching ads in the selected period")).toBeTruthy();
    expect(filterStore.get().range).not.toBe("all");
    fireEvent.click(screen.getByRole("button", { name: "Search all time with this text" }));
    expect(filterStore.get().range).toBe("all");
    expect(filterStore.get().from).toBeUndefined();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Missing old ad");
    expect(screen.getByText(/selected period: All time/)).toBeTruthy();
  });
});
