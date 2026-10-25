import type { QualityMetrics } from "./closed-loop";
import { metricContract, type MetricContract } from "./metric-contracts";
import {
  exactAttributionAvailable,
  type ManagementScope,
  type ScopeSpend,
} from "./management-scope";

/**
 * Management KPIs for the Marketing Overview, with their scopes spelled out.
 *
 * Two engines, never blended inside one figure:
 *
 *   SCOPE    (metrics.server) the selected platform scope: ad spend of every
 *            platform with a spend source, unique CRM leads and won customers
 *            by creation date, paid collections by payment date.
 *   EXACT    (closed-loop) acquisitions whose ad is known by its Meta provider
 *            IDs and matched to a CRM record by Meta lead ID; their paid revenue
 *            comes from Accounting through the sale order → opportunity link.
 *            Exists only for Meta: with another platform selected every EXACT
 *            figure is `not_available`, never a Meta number under another name.
 *
 * Cohort revenue (leads created in the window, paid at any date since) is only
 * ever divided by spend under a label that says "cohort". Every ratio carries
 * its numerator, denominator and contract; every figure carries a status, and
 * anything other than `ok` is shown as words, never as 0.
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
  | "historical_evidence_missing"
  /** The figure does not exist for the selected platform scope (e.g. exact attribution off Meta). */
  | "not_available"
  /** A component source is missing (e.g. one platform's spend), so a ratio on it would mislead. */
  | "incomplete_source";

export type KpiFormat = "usd" | "count" | "ratio" | "percent";

export interface KpiPart {
  label: { en: string; ar: string };
  value: number;
  format: KpiFormat;
}

export interface Kpi {
  key: string;
  kind: "value" | "ratio";
  scope: "all" | "tracked";
  label: { en: string; ar: string };
  definition: { en: string; ar: string };
  value: number | null;
  format: KpiFormat;
  status: KpiStatus;
  numerator?: KpiPart;
  denominator?: KpiPart;
  formula?: string;
  /** Set when a value is shown but a component source is missing. */
  coverageNote?: { en: string; ar: string };
  contract?: MetricContract;
}

export interface ScopeTotalsInput {
  spend: ScopeSpend;
  uniqueCrmLeads: number | null;
  uniqueWonCustomers: number | null;
  collectedRevenue: number | null;
  scopeLabel: { en: string; ar: string };
}

export interface KpiInputs {
  /** Acquisition facts in the selected scope (any confidence). */
  all: QualityMetrics;
  /** Exact-attribution facts only. */
  tracked: QualityMetrics;
  /** Every Meta ad spend row in the period. */
  totalSpend: number;
  /** Spend of Meta campaigns with at least one tracked lead in the period. */
  trackedSpend: number;
  /** Whether Meta spend rows exist for the period at all. */
  spendSynced: boolean;
  /** Whether the CRM/sales graph has been built at least once. */
  crmSynced: boolean;
  /** Global platform/channel selection; All when omitted. */
  scope?: ManagementScope;
  /** Acquisition events in the Meta scope (the CPL denominator); defaults to `all.leads`. */
  metaEvents?: number;
  /** Distinct CRM ids behind exact CRM matches; defaults to `tracked.crmMatched`. */
  exactUniqueLeads?: number;
  /** Distinct won CRM ids behind exact CRM matches; defaults to `tracked.won`. */
  exactUniqueWon?: number;
  /** Events in scope with an exact CRM link; defaults to `tracked.crmMatched`. */
  exactCrmMatchesInScope?: number;
  /** Selected-scope figures from metrics.server. Omitted in isolated tests. */
  scopeTotals?: ScopeTotalsInput;
}

const t = (en: string, ar: string) => ({ en, ar });

const PENDING_SPEND_NOTE = t(
  "Spend for part of this scope is unavailable.",
  "صرف جزء من هذا النطاق غير متاح.",
);

function withContract(kpi: Omit<Kpi, "contract">): Kpi {
  const contract = metricContract(kpi.key);
  return contract ? { ...kpi, contract } : kpi;
}

function ratio(
  numerator: KpiPart,
  denominator: KpiPart,
  base: Omit<Kpi, "kind" | "value" | "status" | "numerator" | "denominator" | "formula">,
  gate: KpiStatus,
): Kpi {
  const formula = `${numerator.label.en} ÷ ${denominator.label.en}`;
  const shell = { ...base, kind: "ratio" as const, numerator, denominator, formula };
  if (gate !== "ok") return withContract({ ...shell, value: null, status: gate });
  if (!denominator.value) return withContract({ ...shell, value: null, status: "no_denominator" });
  const raw = numerator.value / denominator.value;
  const value =
    base.format === "usd" || base.format === "ratio" ? Math.round(raw * 100) / 100 : raw;
  return withContract({ ...shell, value, status: "ok" });
}

function value(
  key: string,
  scope: Kpi["scope"],
  label: Kpi["label"],
  definition: Kpi["definition"],
  amount: number | null,
  format: KpiFormat,
  gate: KpiStatus,
  coverageNote?: Kpi["coverageNote"],
): Kpi {
  return withContract({
    key,
    kind: "value",
    scope,
    label,
    definition,
    value: gate === "ok" ? amount : null,
    format,
    status: gate === "ok" && amount === null ? "pending_sync" : gate,
    ...(coverageNote ? { coverageNote } : {}),
  });
}

export function closedLoopKpis(input: KpiInputs): Record<string, Kpi> {
  const exactOk = !input.scope || exactAttributionAvailable(input.scope);
  const exactGate = (gate: KpiStatus): KpiStatus => (exactOk ? gate : "not_available");
  const spendGate: KpiStatus = input.spendSynced ? "ok" : "pending_sync";
  const crmGate: KpiStatus = input.crmSynced ? "ok" : "pending_sync";
  const both: KpiStatus = spendGate !== "ok" ? spendGate : crmGate;
  const metaEvents = input.metaEvents ?? input.all.leads;
  const exactUniqueLeads = input.exactUniqueLeads ?? input.tracked.crmMatched;
  const exactUniqueWon = input.exactUniqueWon ?? input.tracked.won;
  const exactMatchesInScope = input.exactCrmMatchesInScope ?? input.tracked.crmMatched;

  const part = {
    metaSpend: {
      label: t("All Meta ad spend", "كل صرف إعلانات Meta"),
      value: input.totalSpend,
      format: "usd" as const,
    },
    trackedSpend: {
      label: t("Spend on tracked Meta campaigns", "صرف حملات Meta المتتبَّعة"),
      value: input.trackedSpend,
      format: "usd" as const,
    },
    events: {
      label: t("Acquisition events in scope", "أحداث الاستحواذ في النطاق"),
      value: input.all.leads,
      format: "count" as const,
    },
    metaEvents: {
      label: t("Meta acquisition events", "أحداث استحواذ Meta"),
      value: metaEvents,
      format: "count" as const,
    },
    trackedLeads: {
      label: t("Exactly attributed acquisitions", "استحواذات بإسناد دقيق"),
      value: input.tracked.leads,
      format: "count" as const,
    },
    matched: {
      label: t("Exact CRM matches", "مطابقات CRM دقيقة"),
      value: input.tracked.crmMatched,
      format: "count" as const,
    },
    matchedInScope: {
      label: t("Events in scope with an exact CRM match", "أحداث النطاق المطابقة بدقة في CRM"),
      value: exactMatchesInScope,
      format: "count" as const,
    },
    interested: {
      label: t("Interested (exact)", "مهتمون (دقيق)"),
      value: input.tracked.interested,
      format: "count" as const,
    },
    qualified: {
      label: t("Qualified (exact)", "مؤهلون (دقيق)"),
      value: input.tracked.qualified,
      format: "count" as const,
    },
    quotations: {
      label: t("Quotations (exact)", "عروض أسعار (دقيق)"),
      value: input.tracked.quotations,
      format: "count" as const,
    },
    won: {
      label: t("Won (exact)", "مكسوب (دقيق)"),
      value: input.tracked.won,
      format: "count" as const,
    },
    revenue: {
      label: t("Cohort paid revenue (exact)", "إيراد الكوهورت المدفوع (دقيق)"),
      value: input.tracked.revenue,
      format: "usd" as const,
    },
  };

  const kpis: Kpi[] = [];

  /* --- selected scope (metrics.server) ------------------------------------ */
  const scopeTotals = input.scopeTotals;
  if (scopeTotals) {
    const spend = scopeTotals.spend;
    const spendStatus: KpiStatus =
      spend.status === "not_applicable"
        ? "not_available"
        : spend.status === "pending_sync"
          ? "pending_sync"
          : "ok";
    const ratioSpendGate: KpiStatus =
      spend.status === "ok" ? "ok" : spend.status === "partial" ? "incomplete_source" : spendStatus;
    const scopeName = scopeTotals.scopeLabel;
    kpis.push(
      value(
        "adSpend",
        "all",
        t(`Ad spend · ${scopeName.en}`, `صرف الإعلانات · ${scopeName.ar}`),
        t(
          `Spend of every paid platform in scope with a spend source (${spend.includedPlatforms.join(", ") || "none"}). Platforms whose spend is unavailable are named, never counted as zero.`,
          `صرف كل منصة مدفوعة في النطاق لها مصدر صرف (${spend.includedPlatforms.join("، ") || "لا يوجد"}). المنصات غير المتاح صرفها تُذكر بالاسم ولا تُحسب صفرًا.`,
        ),
        spend.value,
        "usd",
        spendStatus,
        spend.status === "partial"
          ? t(
              `Excludes unavailable spend for ${spend.unavailablePlatforms.join(", ")}.`,
              `لا يشمل الصرف غير المتاح لـ ${spend.unavailablePlatforms.join("، ")}.`,
            )
          : undefined,
      ),
      value(
        "uniqueCrmLeads",
        "all",
        t("Unique CRM leads created", "ليدز CRM فريدة أُنشئت"),
        t(
          "Distinct Odoo CRM records (active + canonical Lost) created in the period, narrowed by the platform filter. People, not events.",
          "سجلات Odoo CRM المميزة (النشطة + Lost القياسية) المُنشأة في الفترة، بحسب فلتر المنصة. أشخاص وليست أحداثًا.",
        ),
        scopeTotals.uniqueCrmLeads,
        "count",
        "ok",
      ),
      value(
        "uniqueWonCustomers",
        "all",
        t("Won customers (CRM cohort)", "عملاء مكسوبون (كوهورت CRM)"),
        t(
          "Distinct CRM records created in the period that are Won, narrowed by the platform filter.",
          "سجلات CRM المميزة المُنشأة في الفترة والمكسوبة، بحسب فلتر المنصة.",
        ),
        scopeTotals.uniqueWonCustomers,
        "count",
        "ok",
      ),
      value(
        "collectedRevenue",
        "all",
        t("Paid collections (payment date)", "التحصيل المدفوع (تاريخ الدفع)"),
        t(
          "Accounting USD paid whose Payment Date is in the period. With a platform selected, only lines linked to that platform's campaigns or sources. This is money collected, not revenue attributed to ads.",
          "USD المدفوع في الحسابات بتاريخ دفع داخل الفترة. مع اختيار منصة: البنود المرتبطة بحملاتها أو مصادرها فقط. هذا تحصيل فعلي وليس إيرادًا مُسندًا للإعلانات.",
        ),
        scopeTotals.collectedRevenue,
        "usd",
        "ok",
      ),
    );
    const spendPart = {
      label: t("Ad spend in scope", "الصرف في النطاق"),
      value: spend.value ?? 0,
      format: "usd" as const,
    };
    kpis.push(
      ratio(
        spendPart,
        {
          label: t("Unique CRM leads created", "ليدز CRM فريدة أُنشئت"),
          value: scopeTotals.uniqueCrmLeads ?? 0,
          format: "count",
        },
        {
          key: "costPerCrmLead",
          scope: "all",
          label: t("Spend per unique CRM lead", "الصرف لكل ليد CRM فريد"),
          definition: t(
            "Ad spend in scope divided by unique CRM leads created in the same period and scope.",
            "صرف النطاق مقسومًا على ليدز CRM الفريدة المُنشأة في نفس الفترة والنطاق.",
          ),
          format: "usd",
          ...(spend.status === "partial" ? { coverageNote: PENDING_SPEND_NOTE } : {}),
        },
        scopeTotals.uniqueCrmLeads === null ? "pending_sync" : ratioSpendGate,
      ),
      ratio(
        {
          label: t("Paid collections in scope", "التحصيل في النطاق"),
          value: scopeTotals.collectedRevenue ?? 0,
          format: "usd",
        },
        spendPart,
        {
          key: "collectionsToSpend",
          scope: "all",
          label: t(
            "Collections-to-spend ratio (not attributed, not ROAS)",
            "نسبة التحصيل إلى الصرف (بدون إسناد، ليست ROAS)",
          ),
          definition: t(
            "Payment-date collections in scope divided by ad spend in scope. Not an attributed return: it includes money from older leads and non-ad sources.",
            "تحصيل النطاق بتاريخ الدفع مقسومًا على صرف النطاق. ليس عائدًا مُسندًا: يشمل أموالًا من ليدز أقدم ومصادر غير إعلانية.",
          ),
          format: "ratio",
        },
        scopeTotals.collectedRevenue === null ? "pending_sync" : ratioSpendGate,
      ),
    );
  } else {
    // Isolated use (tests, scripts): the only spend known here is Meta's.
    kpis.push(
      value(
        "adSpend",
        "all",
        t("Meta ad spend", "صرف إعلانات Meta"),
        t(
          "Money spent on Meta ads in the selected period.",
          "المبلغ المصروف على إعلانات Meta في الفترة المختارة.",
        ),
        input.totalSpend,
        "usd",
        exactGate(spendGate),
      ),
    );
  }

  /* --- exact attribution (closed-loop, Meta only) -------------------------- */
  kpis.push(
    value(
      "metaSpend",
      "all",
      part.metaSpend.label,
      t(
        "Money spent on Meta ads in the period: the spend the exact-attribution figures are measured against.",
        "المبلغ المصروف على إعلانات Meta في الفترة: الصرف الذي تُقاس عليه أرقام الإسناد الدقيق.",
      ),
      input.totalSpend,
      "usd",
      exactGate(spendGate),
    ),
    value(
      "trackedSpend",
      "tracked",
      part.trackedSpend.label,
      t(
        "Meta spend of the campaigns that brought at least one lead we can trace to its exact ad.",
        "صرف حملات Meta التي جاءت بعميل واحد على الأقل نعرف إعلانه بالضبط.",
      ),
      input.trackedSpend,
      "usd",
      exactGate(spendGate),
    ),
    value(
      "leads",
      "all",
      t("Acquisition events", "أحداث الاستحواذ"),
      t(
        "Meta form leads, Chatwoot conversations and landing-page submissions in the period, in scope. One person can produce several events; this is not a count of customers.",
        "عملاء نماذج Meta ومحادثات Chatwoot وإرسالات صفحات الهبوط في الفترة داخل النطاق. الشخص الواحد قد ينتج أكثر من حدث؛ هذا ليس عدد عملاء.",
      ),
      input.all.leads,
      "count",
      "ok",
    ),
    value(
      "trackedLeads",
      "tracked",
      part.trackedLeads.label,
      t(
        "Acquisition events whose exact Meta ad is known.",
        "أحداث الاستحواذ التي نعرف إعلان Meta الخاص بها بالضبط.",
      ),
      input.tracked.leads,
      "count",
      exactGate("ok"),
    ),
    value(
      "exactAttributedLeads",
      "tracked",
      t("Unique exact-attributed CRM leads", "ليدز CRM فريدة بإسناد دقيق"),
      t(
        "Distinct CRM records behind the exact CRM matches.",
        "سجلات CRM المميزة خلف المطابقات الدقيقة.",
      ),
      exactUniqueLeads,
      "count",
      exactGate(crmGate),
    ),
    value(
      "crmMatched",
      "tracked",
      part.matched.label,
      t(
        "Exactly attributed acquisitions connected to a CRM record through Meta's lead ID.",
        "استحواذات بإسناد دقيق مربوطة بسجل CRM عبر معرّف العميل من Meta.",
      ),
      input.tracked.crmMatched,
      "count",
      exactGate(crmGate),
    ),
    value(
      "qualified",
      "tracked",
      part.qualified.label,
      t(
        "Exact CRM matches that currently meet the CRM qualification rule (a later stage, or hot/intermediate priority).",
        "المطابقات الدقيقة التي تستوفي حاليًا قاعدة التأهيل في CRM (مرحلة متقدمة أو أولوية ساخنة/متوسطة).",
      ),
      input.tracked.qualified,
      "count",
      exactGate(crmGate),
    ),
    value(
      "won",
      "tracked",
      part.won.label,
      t("Exact CRM matches whose CRM record is Won.", "المطابقات الدقيقة التي سجلها في CRM مكسوب."),
      input.tracked.won,
      "count",
      exactGate(crmGate),
    ),
    value(
      "exactUniqueWon",
      "tracked",
      t("Unique won customers (exact)", "عملاء مكسوبون فريدون (دقيق)"),
      t(
        "Distinct won CRM records behind the exact CRM matches.",
        "سجلات CRM المكسوبة المميزة خلف المطابقات الدقيقة.",
      ),
      exactUniqueWon,
      "count",
      exactGate(crmGate),
    ),
    value(
      "revenue",
      "tracked",
      t("Cohort paid revenue (exact)", "إيراد الكوهورت المدفوع (دقيق)"),
      t(
        "Accounting paid revenue, at any payment date so far, of the exactly attributed leads that arrived in the period. A cohort figure dated by lead arrival, not by payment date.",
        "إيراد مدفوع من الحسابات، بأي تاريخ دفع حتى الآن، للعملاء بإسناد دقيق الذين وصلوا في الفترة. رقم كوهورت مؤرخ بوصول العميل وليس بتاريخ الدفع.",
      ),
      input.tracked.revenue,
      "usd",
      exactGate(crmGate),
    ),
    ratio(
      part.revenue,
      part.metaSpend,
      {
        key: "roasAllSpend",
        scope: "all",
        label: t("Cohort ROAS on all Meta spend", "العائد (كوهورت) على كل صرف Meta"),
        definition: t(
          "Cohort paid revenue of exactly attributed leads divided by ALL Meta ad spend in the period. The conservative return: untracked Meta spend counts as cost with no revenue. Revenue is dated by lead arrival, spend by spend date.",
          "إيراد الكوهورت للعملاء بإسناد دقيق مقسومًا على كل صرف Meta في الفترة. العائد المتحفظ. الإيراد مؤرخ بوصول العميل والصرف بتاريخ الصرف.",
        ),
        format: "ratio",
      },
      exactGate(both),
    ),
    ratio(
      part.revenue,
      part.trackedSpend,
      {
        key: "roasTracked",
        scope: "tracked",
        label: t(
          "Cohort ROAS on tracked Meta campaigns",
          "العائد (كوهورت) على حملات Meta المتتبَّعة",
        ),
        definition: t(
          "Cohort paid revenue of exactly attributed leads divided by the Meta spend of the campaigns those leads came from.",
          "إيراد الكوهورت للعملاء بإسناد دقيق مقسومًا على صرف حملات Meta التي جاؤوا منها.",
        ),
        format: "ratio",
      },
      exactGate(both),
    ),
    ratio(
      part.metaSpend,
      part.metaEvents,
      {
        key: "cplAll",
        scope: "all",
        label: t("Meta spend per Meta acquisition event", "صرف Meta لكل حدث استحواذ من Meta"),
        definition: t(
          "All Meta ad spend divided by acquisition events that belong to Meta. Events from unknown sources are not in the denominator.",
          "كل صرف Meta مقسومًا على أحداث الاستحواذ التابعة لـ Meta. أحداث المصادر غير المعروفة ليست في المقام.",
        ),
        format: "usd",
      },
      exactGate(spendGate),
    ),
    ratio(
      part.trackedSpend,
      part.trackedLeads,
      {
        key: "cplTracked",
        scope: "tracked",
        label: t("Cost per tracked lead", "تكلفة العميل المتتبَّع"),
        definition: t(
          "Tracked-campaign spend divided by exactly attributed acquisitions.",
          "صرف الحملات المتتبَّعة مقسومًا على الاستحواذات بإسناد دقيق.",
        ),
        format: "usd",
      },
      exactGate(spendGate),
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
      exactGate(both),
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
      exactGate(both),
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
      exactGate(both),
    ),
    ratio(
      part.metaSpend,
      part.won,
      {
        key: "costPerCustomerAll",
        scope: "all",
        label: t("CAC on all Meta spend (exact won)", "تكلفة العميل المكسوب على كل صرف Meta"),
        definition: t(
          "All Meta ad spend divided by exactly attributed won customers.",
          "كل صرف Meta مقسومًا على العملاء المكسوبين بإسناد دقيق.",
        ),
        format: "usd",
      },
      exactGate(both),
    ),
    ratio(
      part.trackedSpend,
      part.won,
      {
        key: "costPerCustomerTracked",
        scope: "tracked",
        label: t("CAC on tracked Meta campaigns", "تكلفة العميل المكسوب (الحملات المتتبَّعة)"),
        definition: t(
          "Tracked-campaign spend divided by exactly attributed won customers.",
          "صرف الحملات المتتبَّعة مقسومًا على العملاء المكسوبين بإسناد دقيق.",
        ),
        format: "usd",
      },
      exactGate(both),
    ),
    ratio(
      part.revenue,
      part.trackedLeads,
      {
        key: "revenuePerLead",
        scope: "tracked",
        label: t("Cohort revenue per tracked lead", "إيراد الكوهورت لكل عميل متتبَّع"),
        definition: t(
          "Cohort paid revenue divided by exactly attributed acquisitions.",
          "إيراد الكوهورت المدفوع مقسومًا على الاستحواذات بإسناد دقيق.",
        ),
        format: "usd",
      },
      exactGate(crmGate),
    ),
    ratio(
      part.won,
      part.matched,
      {
        key: "winRate",
        scope: "tracked",
        label: t("Win rate (exact CRM matches)", "معدل الفوز (مطابقات دقيقة)"),
        definition: t(
          "Won divided by exact CRM matches. Unmatched leads are left out: their outcome is unknown, not lost.",
          "المكسوب مقسومًا على المطابقات الدقيقة. غير المطابق مستبعد: نتيجته غير معروفة وليست خسارة.",
        ),
        format: "percent",
      },
      exactGate(crmGate),
    ),
    ratio(
      part.qualified,
      part.matched,
      {
        key: "qualificationRate",
        scope: "tracked",
        label: t("Qualification rate (exact CRM matches)", "معدل التأهيل (مطابقات دقيقة)"),
        definition: t(
          "Qualified divided by exact CRM matches.",
          "المؤهلون مقسومين على المطابقات الدقيقة.",
        ),
        format: "percent",
      },
      exactGate(crmGate),
    ),
    ratio(
      part.matchedInScope,
      part.events,
      {
        key: "crmMatchRate",
        scope: "all",
        label: t("Exact CRM match rate", "نسبة المطابقة الدقيقة في CRM"),
        definition: t(
          "Acquisition events in scope with an exact CRM link divided by all acquisition events in scope. Both sides count events.",
          "أحداث الاستحواذ في النطاق المربوطة بدقة في CRM مقسومة على كل أحداث الاستحواذ في النطاق. الطرفان يعدّان أحداثًا.",
        ),
        format: "percent",
      },
      exactGate(crmGate),
    ),
  );
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
