import { describe, expect, it } from "vitest";
import {
  LEAD_CONVERSION_CATEGORIES,
  googleAdDayKey,
  leadConversionsGaql,
} from "@/lib/google-ads.server";

/**
 * Read live from Google Ads v25 for customer 6157382856 on 2026-10-26:
 *
 *   September 2026 conversions, by action
 *     1,287.00  YouTube channel subscriptions  [ENGAGEMENT]
 *         9.38  Purchase                       [PURCHASE]
 *         0.00  lead_form_cfm                  [SUBMIT_LEAD_FORM]
 *         0.00  lead_form_pmp                  [SUBMIT_LEAD_FORM]
 *     total 1,296.380953
 *
 *   2026-09-01..2026-10-25: all conversions 3,062.38, lead-category 5.
 *
 * `metrics.conversions` was reported as the platform lead count, so Google
 * showed 1,296 "leads" on $685.63 of spend -- a $0.53 cost per lead -- from
 * YouTube subscriptions. Leads now come from their own category-filtered query.
 */
describe("Google lead conversions", () => {
  it("counts only acquisition categories as leads", () => {
    expect([...LEAD_CONVERSION_CATEGORIES]).toEqual([
      "SUBMIT_LEAD_FORM",
      "PHONE_CALL_LEAD",
      "CONTACT",
      "BOOK_APPOINTMENT",
      "REQUEST_QUOTE",
      "SIGNUP",
      "IMPORTED_LEAD",
    ]);
  });

  it("never counts engagement, purchases or video views as leads", () => {
    for (const category of ["ENGAGEMENT", "PURCHASE", "YOUTUBE_FOLLOW_ON_VIEWS", "DOWNLOAD"]) {
      expect(LEAD_CONVERSION_CATEGORIES as readonly string[]).not.toContain(category);
    }
  });

  it("asks Google for the lead categories only, at ad-day grain", () => {
    const query = leadConversionsGaql("2026-09-01", "2026-09-30");
    expect(query).toContain("segments.conversion_action_category");
    expect(query).toContain("'SUBMIT_LEAD_FORM'");
    expect(query).not.toContain("ENGAGEMENT");
    expect(query).toContain("BETWEEN '2026-09-01' AND '2026-09-30'");
    // Cost must never be selected here: this query repeats an ad-day once per
    // category, so summing spend from it would multiply the bill.
    expect(query).not.toContain("cost_micros");
    expect(query).not.toContain("metrics.impressions");
  });

  it("keys a lead conversion to the exact ad-day that earned it", () => {
    const base = { date: "2026-10-20", campaignId: "11", adsetId: "22", adId: "33" };
    expect(googleAdDayKey(base)).toBe(googleAdDayKey({ ...base }));
    expect(googleAdDayKey(base)).not.toBe(googleAdDayKey({ ...base, adId: "34" }));
    expect(googleAdDayKey(base)).not.toBe(googleAdDayKey({ ...base, date: "2026-10-21" }));
    // Separator-safe: ids that concatenate to the same string must not collide.
    expect(googleAdDayKey({ date: "d", campaignId: "1", adsetId: "22", adId: "3" })).not.toBe(
      googleAdDayKey({ date: "d", campaignId: "12", adsetId: "2", adId: "3" }),
    );
  });
});
