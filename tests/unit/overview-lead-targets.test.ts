import { describe, expect, it } from "vitest";
import { MEDIA_PLANS } from "@/lib/media-plan";
import { countsAsPotentialLead, excludedLeadSource } from "@/lib/lead-count-policy";
import { overviewLeadTargets } from "@/lib/overview-lead-targets.server";
import type { FilteredData } from "@/lib/metrics.server";

const row = (id: string, course: string, source: string) => ({
  id,
  course,
  source,
  sourceKey: source.trim().toLowerCase(),
});

describe("potential lead policy and Overview plan goals", () => {
  it("excludes only the specified Odoo source families", () => {
    expect(excludedLeadSource("Recommendation")).toBe("recommendation");
    expect(excludedLeadSource("Recommendation Sales")).toBe("recommendation");
    expect(excludedLeadSource("Recommended From Customer")).toBe("recommendation");
    expect(excludedLeadSource("WhatsApp Broadcast")).toBe("whatsapp_broadcast");
    expect(excludedLeadSource("Whtsapp Broadcast")).toBe("whatsapp_broadcast");
    expect(excludedLeadSource("AutoDailer Broadcast")).toBe("autodialer_broadcast");
    expect(excludedLeadSource("AutoDialer Broadcast")).toBe("autodialer_broadcast");
    expect(excludedLeadSource("Facebook", "AutoDialer Broadcast")).toBe("autodialer_broadcast");
    expect(excludedLeadSource("Facebook", "WhatsApp Broadcast")).toBe("whatsapp_broadcast");
    expect(excludedLeadSource("WhatsApp Recommendation")).toBe("recommendation");
    expect(excludedLeadSource("Facebook", "WhatsApp Recommendation")).toBe("recommendation");
    expect(excludedLeadSource("Facebook", "Recommendation Sales")).toBe("recommendation");
    expect(countsAsPotentialLead("Facebook", "WhatsApp Broadcast")).toBe(false);
    expect(countsAsPotentialLead("Facebook", "Normal Lead")).toBe(true);
    expect(countsAsPotentialLead("WhatsApp")).toBe(true);
    expect(countsAsPotentialLead("Website")).toBe(true);
  });

  it("keeps course and website targets separate and does not count excluded sources", () => {
    const data = {
      crm: [
        row("1", "CFM", "Facebook"),
        row("2", "CFM", "Website"),
        row("3", "PMP", "WhatsApp"),
        row("4", "PMP", "WhatsApp Broadcast"),
        row("5", "CFM", "Recommendation"),
        { ...row("7", "BIM", "Facebook"), leadSegment: "WhatsApp Broadcast" },
        row("8", "CFM", "Whtsapp Broadcast"),
        row("9", "CFM", "AutoDailer Broadcast"),
      ],
      lost: [row("6", "PMP", "Facebook")],
    } as unknown as FilteredData;
    const goal = overviewLeadTargets(data, { from: "2026-10-01", to: "2026-10-13" }, MEDIA_PLANS);
    expect(goal.reason).toBeNull();
    expect(goal.courses).toMatchObject({ actual: 4, target: 4176 });
    expect(goal.website).toMatchObject({ actual: 1, target: 3000 });
  });

  it("does not compare a narrowly filtered numerator to the whole-month goal", () => {
    const data = { crm: [], lost: [] } as unknown as FilteredData;
    const goal = overviewLeadTargets(
      data,
      { from: "2026-10-01", to: "2026-10-13", source: "Facebook" },
      MEDIA_PLANS,
    );
    expect(goal.reason).toBe("narrow_filter");
    expect(goal.courses.achievement).toBeNull();
  });
});
