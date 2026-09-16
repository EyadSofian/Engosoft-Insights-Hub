import { describe, expect, it } from "vitest";
import {
  auditDuplicateReasons,
  type DuplicateAuditSubject,
} from "../../src/lib/lost-duplicate-audit";

const row = (overrides: Partial<DuplicateAuditSubject>): DuplicateAuditSubject => ({
  id: "1",
  phone: "",
  mobile: "",
  facebookLeadId: "",
  lossReason: "Duplicate",
  ...overrides,
});

describe("Lost duplicate reason audit", () => {
  it("supports a duplicate only when another CRM id shares a real identity", () => {
    const lost = [row({ id: "lost", mobile: "01012345678" })];
    const result = auditDuplicateReasons(lost, [
      row({ id: "original", phone: "+20 101 234 5678", lossReason: "" }),
    ]);

    expect(result.declaredCount).toBe(1);
    expect(result.supportedCount).toBe(1);
    expect(result.records[0]).toMatchObject({
      id: "lost",
      supported: true,
      matchedRecordCount: 1,
      sources: ["phone"],
    });
  });

  it("does not treat the same row's phone and mobile as a duplicate", () => {
    const lost = [row({ id: "lost", phone: "01012345678", mobile: "+20 101 234 5678" })];
    const result = auditDuplicateReasons(lost, []);

    expect(result.supportedCount).toBe(0);
    expect(result.unsupportedCount).toBe(1);
  });

  it("supports exact provider ids and keeps non-duplicate reasons out of the denominator", () => {
    const lost = [
      row({ id: "lost", facebookLeadId: "FB-123" }),
      row({ id: "other", lossReason: "Not Interested" }),
    ];
    const result = auditDuplicateReasons(lost, [
      row({ id: "original", facebookLeadId: "fb 123", lossReason: "" }),
    ]);

    expect(result.declaredCount).toBe(1);
    expect(result.declaredShare).toBe(50);
    expect(result.supportedCount).toBe(1);
    expect(result.records[0].sources).toEqual(["provider_id"]);
  });

  it("does not collide confident Egyptian and Saudi numbers with the same final digits", () => {
    const lost = [row({ id: "lost", phone: "+20 101 234 5678" })];
    const result = auditDuplicateReasons(lost, [
      row({ id: "other", phone: "+966 50 123 45678", lossReason: "" }),
    ]);

    expect(result.supportedCount).toBe(0);
  });
});
