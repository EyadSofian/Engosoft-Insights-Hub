import type { QualityMetrics } from "./closed-loop";

/**
 * Management KPIs for the closed loop, with their scopes spelled out.
 *
 * Two populations exist and a ratio never mixes them silently:
 *
 *   ALL      every lead in the period, and ALL Meta ad spend in the period
 *   TRACKED  leads whose ad is known by its exact Meta ID and that matched a
 *            CRM record by Meta lead ID; spend of the campaigns that produced
 *            at least one such lead
 *
 * Paid revenue only exists for tracked leads (an unknown lead has no known
 * sale), so "ROAS on all ad spend" deliberately divides tracked revenue by all
 * spend: the conservative return. It is labelled as exactly that, next to the
 * tracked-campaign ROAS whose numerator and denominator share one population.
 *
 * Every KPI carries a status. `ok` with value 0 means the source was queried
 * and the answer is zero; anything else is shown as words, never as 0.
 */

export type KpiStatus =
  | "ok"
  /** Queried, but the denominator is zero, so the ratio has no value. */
  | "no_denominator"
  /** The source has not been synchronised for this period yet. */
  | "pending_sync"
  /** The integration that would supply it is not connected. */
  | "not_connected"
  /** The data was never recorded for this period. */
  | "historical_evidence_missing";

export type KpiFormat = "usd" | "count" | "ratio" | "percent";

export interface KpiPart {
  label: { en: string; ar: string };
  value: number;
  format: KpiFormat;
}

export interface Kpi {
  key: string;
  scope: "all" | "tracked";
  label: { en: string; ar: string };
  definition: { en: string; ar: string };
  value: number | null;
  format: KpiFormat;
  status: KpiStatus;
  numerator?: KpiPart;
  denominator?: KpiPart;
  formula?: string;
}

export interface KpiInputs {
  /** All facts in the period (any confidence). */
  all: QualityMetrics;
  /** Exact-attribution facts only. */
  tracked: QualityMetrics;
  /** Every Meta ad spend row in the period. */
  totalSpend: number;
  /** Spend of campaigns with at least one tracked lead in the period. */
  trackedSpend: number;
  /** Whether Meta spend rows exist for the period at all. */
  spendSynced: boolean;
  /** Whether the CRM/sales graph has been built at least once. */
  crmSynced: boolean;
}

const t = (en: string, ar: string) => ({ en, ar });

function ratio(
  numerator: KpiPart,
  denominator: KpiPart,
  base: Omit<Kpi, "value" | "status" | "numerator" | "denominator" | "formula">,
  gate: KpiStatus,
): Kpi {
  const formula = `${numerator.label.en} ÷ ${denominator.label.en}`;
  if (gate !== "ok") return { ...base, value: null, status: gate, numerator, denominator, formula };
  if (!denominator.value) {
    return { ...base, value: null, status: "no_denominator", numerator, denominator, formula };
  }
  const raw = numerator.value / denominator.value;
  const value =
    base.format === "usd" || base.format === "ratio" ? Math.round(raw * 100) / 100 : raw;
  return { ...base, value, status: "ok", numerator, denominator, formula };
}

export function closedLoopKpis(input: KpiInputs): Record<string, Kpi> {
  const spendGate: KpiStatus = input.spendSynced ? "ok" : "pending_sync";
  const crmGate: KpiStatus = input.crmSynced ? "ok" : "pending_sync";
  const both: KpiStatus = spendGate !== "ok" ? spendGate : crmGate;

  const part = {
    totalSpend: {
      label: t("All Meta ad spend", "كل صرف إعلانات Meta"),
      value: input.totalSpend,
      format: "usd" as const,
    },
    trackedSpend: {
      label: t("Spend on campaigns with tracked leads", "صرف الحملات التي جاءت بعملاء متتبَّعين"),
      value: input.trackedSpend,
      format: "usd" as const,
    },
    allLeads: {
      label: t("All leads", "كل العملاء"),
      value: input.all.leads,
      format: "count" as const,
    },
    trackedLeads: {
      label: t("Tracked leads", "العملاء المتتبَّعون"),
      value: input.tracked.leads,
      format: "count" as const,
    },
    matched: {
      label: t("Tracked leads matched to CRM", "العملاء المتتبَّعون المطابقون في CRM"),
      value: input.tracked.crmMatched,
      format: "count" as const,
    },
    interested: {
      label: t("Interested leads", "العملاء المهتمون"),
      value: input.tracked.interested,
      format: "count" as const,
    },
    qualified: {
      label: t("Qualified leads", "العملاء المؤهلون"),
      value: input.tracked.qualified,
      format: "count" as const,
    },
    quotations: {
      label: t("Leads with a quotation", "عملاء بعرض سعر"),
      value: input.tracked.quotations,
      format: "count" as const,
    },
    won: {
      label: t("Customers won", "العملاء المكسوبون"),
      value: input.tracked.won,
      format: "count" as const,
    },
    revenue: {
      label: t("Paid revenue from tracked leads", "الإيراد المدفوع من العملاء المتتبَّعين"),
      value: input.tracked.revenue,
      format: "usd" as const,
    },
  };

  const value = (
    key: string,
    scope: Kpi["scope"],
    label: Kpi["label"],
    definition: Kpi["definition"],
    amount: number,
    format: KpiFormat,
    gate: KpiStatus,
  ): Kpi => ({
    key,
    scope,
    label,
    definition,
    value: gate === "ok" ? amount : null,
    format,
    status: gate,
  });

  const kpis: Kpi[] = [
    value(
      "adSpend",
      "all",
      t("Ad spend", "صرف الإعلانات"),
      t(
        "Money spent on Meta ads in the selected period.",
        "المبلغ المصروف على إعلانات Meta في الفترة المختارة.",
      ),
      input.totalSpend,
      "usd",
      spendGate,
    ),
    value(
      "trackedSpend",
      "tracked",
      part.trackedSpend.label,
      t(
        "Ad spend of the campaigns that brought at least one lead we can trace to its exact ad.",
        "صرف الحملات التي جاءت بعميل واحد على الأقل نعرف إعلانه بالضبط.",
      ),
      input.trackedSpend,
      "usd",
      spendGate,
    ),
    value(
      "leads",
      "all",
      t("Leads", "العملاء المحتملون"),
      t(
        "People acquired from ads, forms and messages during the selected period.",
        "الأشخاص الذين وصلوا من الإعلانات والنماذج والرسائل خلال الفترة المختارة.",
      ),
      input.all.leads,
      "count",
      "ok",
    ),
    value(
      "trackedLeads",
      "tracked",
      part.trackedLeads.label,
      t("Leads whose exact Meta ad is known.", "العملاء الذين نعرف إعلان Meta الخاص بهم بالضبط."),
      input.tracked.leads,
      "count",
      "ok",
    ),
    value(
      "crmMatched",
      "tracked",
      t("CRM matched leads", "عملاء مطابقون في CRM"),
      t(
        "Leads we could connect to an exact CRM record through Meta's lead ID.",
        "العملاء الذين أمكن ربطهم بسجل CRM محدد عبر معرّف العميل من Meta.",
      ),
      input.tracked.crmMatched,
      "count",
      crmGate,
    ),
    value(
      "qualified",
      "tracked",
      t("Qualified leads", "العملاء المؤهلون"),
      t(
        "Matched leads that currently meet the CRM qualification rule (a later stage, or hot/intermediate priority).",
        "العملاء المطابقون الذين يستوفون حاليًا قاعدة التأهيل في CRM (مرحلة متقدمة أو أولوية ساخنة/متوسطة).",
      ),
      input.tracked.qualified,
      "count",
      crmGate,
    ),
    value(
      "won",
      "tracked",
      t("Customers won", "العملاء المكسوبون"),
      t("CRM opportunities marked Won.", "فرص CRM المسجلة كفوز."),
      input.tracked.won,
      "count",
      crmGate,
    ),
    value(
      "revenue",
      "tracked",
      t("Paid revenue", "الإيراد المدفوع"),
      t(
        "Actual paid invoice revenue connected to exactly tracked leads, dated by when the lead arrived.",
        "إيراد الفواتير المدفوعة فعليًا المرتبط بعملاء متتبَّعين بدقة، ومؤرخ بتاريخ وصول العميل.",
      ),
      input.tracked.revenue,
      "usd",
      crmGate,
    ),
    ratio(
      part.revenue,
      part.totalSpend,
      {
        key: "roasAllSpend",
        scope: "all",
        label: t("ROAS (all ad spend)", "العائد على كل صرف الإعلانات"),
        definition: t(
          "Paid revenue from tracked leads divided by ALL Meta ad spend. The conservative return: untracked spend counts as cost with no revenue.",
          "الإيراد المدفوع من العملاء المتتبَّعين مقسومًا على كل صرف Meta. العائد المتحفظ: الصرف غير المتتبَّع يُحسب تكلفة بلا إيراد.",
        ),
        format: "ratio",
      },
      both,
    ),
    ratio(
      part.revenue,
      part.trackedSpend,
      {
        key: "roasTracked",
        scope: "tracked",
        label: t("ROAS (tracked campaigns)", "العائد على الحملات المتتبَّعة"),
        definition: t(
          "Paid revenue from tracked leads divided by the spend of the campaigns those leads came from.",
          "الإيراد المدفوع من العملاء المتتبَّعين مقسومًا على صرف الحملات التي جاؤوا منها.",
        ),
        format: "ratio",
      },
      both,
    ),
    ratio(
      part.totalSpend,
      part.allLeads,
      {
        key: "cplAll",
        scope: "all",
        label: t("Cost per lead (all)", "تكلفة العميل (الكل)"),
        definition: t(
          "All Meta ad spend divided by all leads.",
          "كل صرف Meta مقسومًا على كل العملاء.",
        ),
        format: "usd",
      },
      spendGate,
    ),
    ratio(
      part.trackedSpend,
      part.trackedLeads,
      {
        key: "cplTracked",
        scope: "tracked",
        label: t("Cost per lead (tracked)", "تكلفة العميل (المتتبَّع)"),
        definition: t(
          "Spend of campaigns with tracked leads divided by tracked leads.",
          "صرف الحملات المتتبَّعة مقسومًا على العملاء المتتبَّعين.",
        ),
        format: "usd",
      },
      spendGate,
    ),
    ratio(
      part.trackedSpend,
      part.interested,
      {
        key: "costPerInterested",
        scope: "tracked",
        label: t("Cost per interested lead", "تكلفة العميل المهتم"),
        definition: t(
          "Tracked-campaign spend divided by interested leads.",
          "صرف الحملات المتتبَّعة مقسومًا على العملاء المهتمين.",
        ),
        format: "usd",
      },
      both,
    ),
    ratio(
      part.trackedSpend,
      part.qualified,
      {
        key: "costPerQualified",
        scope: "tracked",
        label: t("Cost per qualified lead", "تكلفة العميل المؤهل"),
        definition: t(
          "Tracked-campaign spend divided by qualified leads.",
          "صرف الحملات المتتبَّعة مقسومًا على العملاء المؤهلين.",
        ),
        format: "usd",
      },
      both,
    ),
    ratio(
      part.trackedSpend,
      part.quotations,
      {
        key: "costPerQuotation",
        scope: "tracked",
        label: t("Cost per quotation", "تكلفة عرض السعر"),
        definition: t(
          "Tracked-campaign spend divided by leads that reached a quotation.",
          "صرف الحملات المتتبَّعة مقسومًا على العملاء الذين وصلوا لعرض سعر.",
        ),
        format: "usd",
      },
      both,
    ),
    ratio(
      part.totalSpend,
      part.won,
      {
        key: "costPerCustomerAll",
        scope: "all",
        label: t("Cost per customer (all ad spend)", "تكلفة العميل المكسوب (كل الصرف)"),
        definition: t(
          "All Meta ad spend divided by customers won.",
          "كل صرف Meta مقسومًا على العملاء المكسوبين.",
        ),
        format: "usd",
      },
      both,
    ),
    ratio(
      part.trackedSpend,
      part.won,
      {
        key: "costPerCustomerTracked",
        scope: "tracked",
        label: t(
          "Cost per customer (tracked campaigns)",
          "تكلفة العميل المكسوب (الحملات المتتبَّعة)",
        ),
        definition: t(
          "Tracked-campaign spend divided by customers won.",
          "صرف الحملات المتتبَّعة مقسومًا على العملاء المكسوبين.",
        ),
        format: "usd",
      },
      both,
    ),
    ratio(
      part.revenue,
      part.trackedLeads,
      {
        key: "revenuePerLead",
        scope: "tracked",
        label: t("Revenue per lead", "الإيراد لكل عميل"),
        definition: t(
          "Paid revenue divided by tracked leads.",
          "الإيراد المدفوع مقسومًا على العملاء المتتبَّعين.",
        ),
        format: "usd",
      },
      crmGate,
    ),
    ratio(
      part.won,
      part.matched,
      {
        key: "winRate",
        scope: "tracked",
        label: t("Win rate", "معدل الفوز"),
        definition: t(
          "Customers won divided by tracked leads matched to CRM. Unmatched leads are left out: their outcome is unknown, not lost.",
          "العملاء المكسوبون مقسومين على العملاء المتتبَّعين المطابقين في CRM. غير المطابق مستبعد: نتيجته غير معروفة وليست خسارة.",
        ),
        format: "percent",
      },
      crmGate,
    ),
    ratio(
      part.qualified,
      part.matched,
      {
        key: "qualificationRate",
        scope: "tracked",
        label: t("Qualification rate", "معدل التأهيل"),
        definition: t(
          "Qualified leads divided by tracked leads matched to CRM.",
          "العملاء المؤهلون مقسومين على العملاء المتتبَّعين المطابقين في CRM.",
        ),
        format: "percent",
      },
      crmGate,
    ),
    ratio(
      part.matched,
      part.allLeads,
      {
        key: "crmMatchRate",
        scope: "all",
        label: t("CRM match rate", "نسبة المطابقة في CRM"),
        definition: t(
          "Tracked leads matched to CRM divided by all leads.",
          "العملاء المتتبَّعون المطابقون في CRM مقسومين على كل العملاء.",
        ),
        format: "percent",
      },
      crmGate,
    ),
  ];
  return Object.fromEntries(kpis.map((kpi) => [kpi.key, kpi]));
}

/**
 * "Cheap leads are not good leads", as data: the creative with the lowest cost
 * per lead next to the creative with the highest revenue per lead, both among
 * creatives with enough leads to mean something.
 */
export function cheapVersusQuality<
  T extends {
    creativeId: string;
    leads: number;
    spend: number;
    cpl: number | null;
    revenuePerLead: number | null;
  },
>(rows: readonly T[], minLeads = 100): { cheapest: T; bestQuality: T } | null {
  const eligible = rows.filter((row) => row.leads >= minLeads && row.spend > 0 && row.cpl !== null);
  if (eligible.length < 2) return null;
  const cheapest = [...eligible].sort((a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity))[0]!;
  const bestQuality = [...eligible].sort(
    (a, b) => (b.revenuePerLead ?? -1) - (a.revenuePerLead ?? -1),
  )[0]!;
  if (cheapest.creativeId === bestQuality.creativeId) return null;
  return { cheapest, bestQuality };
}
