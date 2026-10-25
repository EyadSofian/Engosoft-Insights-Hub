import { describe, expect, it } from "vitest";
import { crmSourceDistribution, type SourceDistributionRecord } from "../../src/lib/crm-source-distribution";

const row = (id: string, source: string, status: SourceDistributionRecord["status"]): SourceDistributionRecord => ({
  id, source, status, createdAt: "2026-10-19", contact: `Lead ${id}`, stage: status, odooUrl: `https://engosoft.com/web#id=${id}`,
});

describe("CRM source distribution", () => {
  it("reconciles every source to the total and computes lost and win rates within that source", () => {
    const groups = crmSourceDistribution([
      row("1", "Facebook", "won"), row("2", "facebook", "lost"),
      row("3", "Facebook", "open"), row("4", "Snapchat", "lost"),
      row("5", "Snapchat", "lead"), row("6", "", "open"),
    ]);
    expect(groups.reduce((sum, item) => sum + item.total, 0)).toBe(6);
    expect(groups.reduce((sum, item) => sum + item.active + item.won + item.lost, 0)).toBe(6);
    const facebook = groups.find((item) => item.source === "Facebook");
    expect(facebook).toMatchObject({ total: 3, won: 1, lost: 1, active: 1, share: 50 });
    expect(facebook?.wonRate).toBeCloseTo(100 / 3);
    expect(facebook?.lostRate).toBeCloseTo(100 / 3);
    expect(groups.find((item) => item.source === "Snapchat")).toMatchObject({ total: 2, lost: 1, lostRate: 50 });
    expect(groups.find((item) => item.source === "Unspecified source")?.total).toBe(1);
  });

  it("shows only the newest twelve records and avoids shipping unrelated record fields", () => {
    const rows = Array.from({ length: 15 }, (_, index) => ({
      ...row(String(index + 1), "TikTok", "lead"),
      createdAt: `2026-10-${String(index + 1).padStart(2, "0")}`,
      phone: "private field",
    }));
    const [group] = crmSourceDistribution(rows);
    expect(group.total).toBe(15);
    expect(group.latestRecords).toHaveLength(12);
    expect(group.latestRecords[0]?.id).toBe("15");
    expect(group.latestRecords[0]).not.toHaveProperty("phone");
  });
});
