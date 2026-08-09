import type { PerfRow } from "@/lib/types";

export type OwnerCampaignStatus = "successful" | "watch" | "weak" | "early";

export interface CycleBenchmark {
  days: number | null;
  sample: number;
  source: "course" | "portfolio" | "none";
  relatedCampaigns: number;
}

export interface OwnerCampaignVerdict {
  status: OwnerCampaignStatus;
  confidence: "low" | "medium" | "high";
  failures: number;
  watches: number;
  passes: number;
  ageDays: number | null;
  benchmark: CycleBenchmark;
  reason: { ar: string; en: string };
}

const MIN_DECISION_LEADS = 30;
const GOOD_CONVERSION = 4;
const MIN_CONVERSION = 3;
const MAX_LOST = 20;
const GOOD_ROAS = 2;

const courseKey = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

function weightedCycle(rows: PerfRow[]): { days: number | null; sample: number } {
  let total = 0;
  let sample = 0;
  for (const row of rows) {
    if (row.avgCloseDays === null || row.closeSample <= 0) continue;
    total += row.avgCloseDays * row.closeSample;
    sample += row.closeSample;
  }
  return { days: sample > 0 ? total / sample : null, sample };
}

/**
 * The campaign is compared with siblings from the same course first. When the
 * course has no closed sample yet, the whole portfolio is an explicit fallback
 * rather than an invented number.
 */
export function cycleBenchmarkFor(row: PerfRow, allRows: PerfRow[]): CycleBenchmark {
  const key = courseKey(row.course);
  const siblings = key
    ? allRows.filter(
        (candidate) => candidate.key !== row.key && courseKey(candidate.course) === key,
      )
    : [];
  const course = weightedCycle(siblings);
  if (course.days !== null) {
    return {
      ...course,
      source: "course",
      relatedCampaigns: siblings.length,
    };
  }

  const portfolio = weightedCycle(allRows.filter((candidate) => candidate.key !== row.key));
  if (portfolio.days !== null) {
    return {
      ...portfolio,
      source: "portfolio",
      relatedCampaigns: siblings.length,
    };
  }

  return { days: null, sample: 0, source: "none", relatedCampaigns: siblings.length };
}

function ageInDays(startTime: string, firstSpendDate: string, now: number): number | null {
  const parsed = Date.parse(startTime || (firstSpendDate ? `${firstSpendDate}T00:00:00Z` : ""));
  if (!Number.isFinite(parsed) || parsed > now) return null;
  return Math.max(0, Math.floor((now - parsed) / 86_400_000));
}

function confidence(leads: number): OwnerCampaignVerdict["confidence"] {
  if (leads >= 100) return "high";
  if (leads >= MIN_DECISION_LEADS) return "medium";
  return "low";
}

function websiteConfidence(conversions: number): OwnerCampaignVerdict["confidence"] {
  if (conversions >= 10) return "high";
  if (conversions >= 3) return "medium";
  return "low";
}

/**
 * An explainable owner verdict. No opaque score: every result is a short list
 * of passed, watch and failed business rules.
 */
export function ownerCampaignVerdict(
  row: PerfRow,
  allRows: PerfRow[],
  startTime = "",
  lostAvailable = true,
  now = Date.now(),
): OwnerCampaignVerdict {
  const benchmark = cycleBenchmarkFor(row, allRows);
  const ageDays = ageInDays(startTime, row.spendDateMin, now);
  const isWebsiteConversion = row.objective === "website_conversion";
  const websiteConversions = row.platformLeads ?? 0;
  const level = isWebsiteConversion
    ? websiteConfidence(websiteConversions)
    : confidence(row.crmLeads);

  const result = (
    status: OwnerCampaignStatus,
    reason: OwnerCampaignVerdict["reason"],
    failures = 0,
    watches = 0,
    passes = 0,
  ): OwnerCampaignVerdict => ({
    status,
    confidence: level,
    failures,
    watches,
    passes,
    ageDays,
    benchmark,
    reason,
  });

  if (row.partialSpend) {
    return result(
      "watch",
      {
        ar: "بيانات الإنفاق مش مغطية نفس فترة الإيراد؛ الحكم المالي محتاج مراجعة.",
        en: "Spend and revenue cover different windows, so the financial verdict needs review.",
      },
      0,
      1,
    );
  }

  // Website-conversion campaigns do not promise CRM leads. Their platform
  // metric is a purchase/conversion event, so applying Lost and CRM close-rate
  // rules would manufacture an attribution problem and call it bad performance.
  if (isWebsiteConversion) {
    if (websiteConversions <= 0) {
      if (row.spend <= 0 || ageDays === null || ageDays < 7) {
        return result("early", {
          ar: "دي حملة تحويلات موقع ولسه مفيش عينة كفاية للحكم.",
          en: "This is a website-conversion campaign without enough data to judge yet.",
        });
      }
      return result(
        "weak",
        {
          ar: `صرفت $${row.spend.toFixed(0)} ومفيش تحويل موقع مسجّل في الفترة.`,
          en: `It spent $${row.spend.toFixed(0)} with no website conversion recorded in the period.`,
        },
        1,
      );
    }

    if (row.revenue > 0 || row.salesOrders > 0 || row.invoices > 0) {
      if (row.roas !== null && row.roas >= GOOD_ROAS) {
        return result(
          "successful",
          {
            ar: `${websiteConversions} تحويل موقع، والعائد المربوط ${row.roas.toFixed(2)}×.`,
            en: `${websiteConversions} website conversions with ${row.roas.toFixed(2)}× linked ROAS.`,
          },
          0,
          0,
          2,
        );
      }
      if (row.roas !== null && row.roas < 1) {
        return result(
          "weak",
          {
            ar: `${websiteConversions} تحويل موقع، لكن الإيراد المربوط لسه أقل من المصروف.`,
            en: `${websiteConversions} website conversions, but linked revenue is still below spend.`,
          },
          1,
        );
      }
      return result(
        "watch",
        {
          ar: `${websiteConversions} تحويل موقع؛ البيع مربوط، لكن العائد لسه تحت هدف ${GOOD_ROAS}×.`,
          en: `${websiteConversions} website conversions are linked to sales, but ROAS is below ${GOOD_ROAS}×.`,
        },
        0,
        1,
        1,
      );
    }

    return result(
      "watch",
      {
        ar: `المنصة سجلت ${websiteConversions} تحويل موقع، لكن أوردر الموقع مش مربوط بنفس Campaign في Odoo؛ دي فجوة ربط مش حكم فشل.`,
        en: `The platform reports ${websiteConversions} website conversions, but no website order carries the same Odoo Campaign; this is an attribution gap, not a failure verdict.`,
      },
      0,
      1,
    );
  }

  if (row.crmLeads === 0 && (row.platformLeads ?? 0) > 0) {
    return result(
      "watch",
      {
        ar: `المنصة مسجلة ${row.platformLeads} ليد، لكن مفيش ليد مرتبط في Odoo؛ دي مشكلة ربط مش أداء.`,
        en: `The platform reports ${row.platformLeads} leads, but none is linked in Odoo; this is attribution, not performance.`,
      },
      0,
      1,
    );
  }

  const completedCycle = benchmark.days !== null && ageDays !== null && ageDays >= benchmark.days;
  if (row.crmLeads === 0 && row.platformLeads === 0 && row.spend > 0 && completedCycle) {
    return result(
      "weak",
      {
        ar: "عدّت دورة بيع كاملة وفيه إنفاق، لكن مفيش أي ليد مسجل من المنصة.",
        en: "A full sales cycle passed with spend, but the platform reported no leads.",
      },
      2,
    );
  }

  if (
    row.crmLeads < MIN_DECISION_LEADS ||
    (row.won === 0 && benchmark.days !== null && ageDays !== null && ageDays < benchmark.days)
  ) {
    return result("early", {
      ar: `لسه عندها ${row.crmLeads} ليد؛ نستنى ${MIN_DECISION_LEADS} ليد على الأقل ودورة بيع كاملة قبل الحكم.`,
      en: `Only ${row.crmLeads} leads so far; wait for at least ${MIN_DECISION_LEADS} leads and a full sales cycle.`,
    });
  }

  const failures: { ar: string; en: string }[] = [];
  const watches: { ar: string; en: string }[] = [];
  let passes = 0;

  if (!lostAvailable) {
    watches.push({
      ar: "بيانات Lost المباشرة مش متاحة دلوقتي؛ مش هنعتبر الصفر نتيجة مؤكدة.",
      en: "Direct Lost data is unavailable, so zero cannot be treated as confirmed.",
    });
  } else if (row.lostRate !== null) {
    if (row.lostRate > MAX_LOST) {
      failures.push({
        ar: `Lost ${row.lostRate.toFixed(1)}% أعلى من حد ${MAX_LOST}%`,
        en: `Lost ${row.lostRate.toFixed(1)}% is above the ${MAX_LOST}% limit`,
      });
    } else passes++;
  }

  if (row.conversionRate !== null) {
    if (row.conversionRate < MIN_CONVERSION) {
      failures.push({
        ar: `الإغلاق ${row.conversionRate.toFixed(1)}% أقل من ${MIN_CONVERSION}%`,
        en: `Conversion ${row.conversionRate.toFixed(1)}% is below ${MIN_CONVERSION}%`,
      });
    } else if (row.conversionRate < GOOD_CONVERSION) {
      watches.push({
        ar: `الإغلاق ${row.conversionRate.toFixed(1)}% داخل نطاق المتابعة 3–4%`,
        en: `Conversion ${row.conversionRate.toFixed(1)}% is in the 3–4% watch range`,
      });
    } else passes++;
  }

  const cycleDays = row.avgCloseDays;
  const benchmarkDays = benchmark.days;
  const cycleHasEnoughData =
    cycleDays !== null && row.closeSample >= 3 && benchmarkDays !== null && benchmark.sample >= 5;
  if (cycleHasEnoughData && cycleDays !== null && benchmarkDays !== null) {
    if (cycleDays > benchmarkDays * 1.25) {
      failures.push({
        ar: `دورة البيع ${cycleDays.toFixed(1)} يوم، أبطأ من مرجع ${benchmarkDays.toFixed(1)} يوم`,
        en: `Sales cycle is ${cycleDays.toFixed(1)} days versus a ${benchmarkDays.toFixed(1)}-day benchmark`,
      });
    } else if (cycleDays > benchmarkDays) {
      watches.push({
        ar: `دورة البيع أبطأ شوية: ${cycleDays.toFixed(1)} مقابل ${benchmarkDays.toFixed(1)} يوم`,
        en: `Sales cycle is slightly slower: ${cycleDays.toFixed(1)} vs ${benchmarkDays.toFixed(1)} days`,
      });
    } else passes++;
  } else if (cycleDays !== null && benchmarkDays !== null) {
    watches.push({
      ar: "عينة دورة البيع لسه صغيرة؛ ظاهرة للمعلومة لكن مش داخلة كحكم نهائي.",
      en: "The sales-cycle sample is still small; it is visible but not used as a final verdict.",
    });
  }

  if (row.roas !== null) {
    if (row.roas < 1) {
      failures.push({
        ar: `العائد ${row.roas.toFixed(2)}× أقل من المصروف`,
        en: `ROAS ${row.roas.toFixed(2)}× is below break-even`,
      });
    } else if (row.roas < GOOD_ROAS) {
      watches.push({
        ar: `العائد ${row.roas.toFixed(2)}× لسه أقل من هدف ${GOOD_ROAS}×`,
        en: `ROAS ${row.roas.toFixed(2)}× is below the ${GOOD_ROAS}× target`,
      });
    } else passes++;
  }

  const criticalFinancialFailure =
    row.roas !== null && row.roas < 1 && (completedCycle || row.crmLeads >= 100);
  if (criticalFinancialFailure || failures.length >= 2) {
    const selected = failures.slice(0, 2);
    return result(
      "weak",
      {
        ar: selected.map((item) => item.ar).join("، ") || "النتيجة أقل من الحدود المعتمدة.",
        en: selected.map((item) => item.en).join(", ") || "Results are below the approved limits.",
      },
      failures.length,
      watches.length,
      passes,
    );
  }

  if (failures.length === 0 && watches.length === 0 && passes >= 3) {
    return result(
      "successful",
      {
        ar: `الإغلاق وLost والعائد داخل الحدود، والحكم مبني على ${row.crmLeads} ليد.`,
        en: `Conversion, Lost and return are within target, based on ${row.crmLeads} leads.`,
      },
      0,
      0,
      passes,
    );
  }

  const selected = [...failures, ...watches].slice(0, 2);
  return result(
    "watch",
    {
      ar: selected.map((item) => item.ar).join("، ") || "النتيجة مختلطة ومحتاجة متابعة.",
      en: selected.map((item) => item.en).join(", ") || "Mixed result that needs monitoring.",
    },
    failures.length,
    watches.length,
    passes,
  );
}

export function ownerStatusLabel(status: OwnerCampaignStatus, lang: "ar" | "en"): string {
  const labels = {
    successful: { ar: "ناجحة", en: "Successful" },
    watch: { ar: "متابعة", en: "Watch" },
    weak: { ar: "ضعيفة", en: "Weak" },
    early: { ar: "بدري للحكم", en: "Too early" },
  } as const;
  return labels[status][lang];
}
