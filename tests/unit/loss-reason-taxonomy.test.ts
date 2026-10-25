import { describe, expect, it } from "vitest";
import {
  LOSS_REASON_TAXONOMY,
  canonicalLossReason,
  groupByCanonicalReason,
  normalizeReasonText,
} from "@/lib/loss-reason-taxonomy";

describe("bilingual loss reason normalization", () => {
  it.each([
    ["غير مهتم", "Not Interested", "not_interested"],
    ["لم يسجل", "Didn't Register", "did_not_register"],
    ["ميزانية العميل أقل من السعر", "Budget Low", "budget_low"],
    ["سجل في شركة أخرى", "Registered with Competitor", "registered_with_competitor"],
    ["رقم خطأ", "Wrong Number", "wrong_number"],
    ["ليد مكرر", "Duplicate", "duplicate"],
    ["يبحث عن عمل", "Need Job", "job_seeker"],
    ["لا يتحدث العربية", "Language", "language_barrier"],
  ])("folds %s and %s into %s", (arabic, english, key) => {
    expect(canonicalLossReason(arabic).canonicalReasonKey).toBe(key);
    expect(canonicalLossReason(english).canonicalReasonKey).toBe(key);
  });

  it("ignores letter variants, diacritics, apostrophes and casing", () => {
    expect(canonicalLossReason("  NOT   interested ").canonicalReasonKey).toBe("not_interested");
    expect(canonicalLossReason("Didn’t register").canonicalReasonKey).toBe("did_not_register");
    expect(canonicalLossReason("العميل مكرر").canonicalReasonKey).toBe("duplicate");
    expect(canonicalLossReason("محتاج دراسة دبلوم").canonicalReasonKey).toBe("wants_diploma");
    expect(normalizeReasonText("شهادات أخرى (أسم الشهادة )")).toBe(
      normalizeReasonText("شهادات أخري"),
    );
  });

  it("keeps the placeholder-bearing reasons recognisable when a value is filled in", () => {
    expect(canonicalLossReason("تخصص اخر (مدني)").canonicalReasonKey).toBe("other_specialization");
    expect(canonicalLossReason("محتوى بلغة مختلفة (الإنجليزية)").canonicalReasonKey).toBe(
      "language_barrier",
    );
  });

  it("keeps near-but-different reasons apart", () => {
    expect(canonicalLossReason("رقم خطأ").canonicalReasonKey).not.toBe(
      canonicalLossReason("الرقم لايمكن الاتصال به ولا يوجد واتس اب").canonicalReasonKey,
    );
    expect(canonicalLossReason("Location").canonicalReasonKey).not.toBe(
      canonicalLossReason("طريقة الحضور غير مناسبة").canonicalReasonKey,
    );
  });

  it("puts empty reasons in Unknown and unrecognised ones in Other, keeping the raw text", () => {
    expect(canonicalLossReason("").canonicalReasonKey).toBe("unknown");
    const other = canonicalLossReason("سبب جديد لم يُصنف");
    expect(other.canonicalReasonKey).toBe("other");
    expect(other.rawReason).toBe("سبب جديد لم يُصنف");
  });

  it("exposes Arabic and English labels for every canonical key", () => {
    for (const entry of LOSS_REASON_TAXONOMY) {
      const reason = canonicalLossReason(entry.en);
      expect(reason.canonicalReasonKey).toBe(entry.key);
      expect(reason.canonicalReasonLabelAr).toBeTruthy();
      expect(reason.canonicalReasonLabelEn).toBeTruthy();
    }
  });

  it("groups by canonical key without dropping a single row", () => {
    const rows = [
      "غير مهتم",
      "Not Interested",
      "Not Interested",
      "",
      "شيء آخر",
      "Duplicate",
      "ليد مكرر",
    ];
    const groups = groupByCanonicalReason(rows, (value) => value);
    expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(rows.length);
    const notInterested = groups.find((group) => group.canonicalReasonKey === "not_interested")!;
    expect(notInterested.count).toBe(3);
    expect(notInterested.rawReasons).toEqual([
      { rawReason: "Not Interested", count: 2 },
      { rawReason: "غير مهتم", count: 1 },
    ]);
    expect(groups.find((group) => group.canonicalReasonKey === "unknown")?.count).toBe(1);
    expect(
      groups.find((group) => group.canonicalReasonKey === "other")?.rawReasons[0]?.rawReason,
    ).toBe("شيء آخر");
  });
});
