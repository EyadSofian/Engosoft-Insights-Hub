import { Award, DollarSign, Percent, Target, TrendingDown, TrendingUp, Users } from "lucide-react";
import { fmtNum, fmtPct, fmtRoas, fmtUSD, fmtUSDFull, type Lang } from "@/lib/i18n";
import type { Deltas, PerfRow, Platform, Totals } from "@/lib/types";
import { PLATFORM_LABEL } from "@/lib/constants";
import { campaignReturnBand } from "@/lib/campaign-return-band";
import {
  topRows,
  type MetricBreakdownRow,
  type MetricDetail,
  type MetricReportLink,
} from "@/lib/metric-detail";

/* ---------------------------------------------------------------------------
   THE SAME NINE FIGURES, EXPLAINED THE SAME WAY, ON EVERY PAGE

   Eight analytical routes return the same `Totals` shape. Writing a drill-down
   per page per figure would have meant nine explanations of ROAS that could
   drift apart — and a reader who learned what "attributed" means on Campaigns
   and had to learn it again on Accounting.

   So: one builder, taking what a surface actually has. `rows` (its campaign or
   ad rows) and `trend` (its own daily series) are optional, and every section
   that depends on them is simply absent when they are not passed. A page that
   has no series shows no trend rather than a flat line.

   The Overview keeps its own richer builder: it is the only surface with course
   contribution, the employee roster and the campaign activity feed in one
   response, and those breakdowns do not generalise.
--------------------------------------------------------------------------- */

export type StandardMetricKey =
  "revenue" | "spend" | "leads" | "won" | "roas" | "conversion" | "cpl" | "cpa" | "acos" | "lost";

export interface StandardMetricInputs {
  totals: Totals;
  deltas?: Deltas;
  /** The surface's own rows, for "which campaign produced this". */
  rows?: PerfRow[];
  /** A real daily series out of the same response. Never synthesised. */
  trend?: { date: string; spend?: number; revenue?: number; leads?: number; won?: number }[];
  /** Nexus capability id — "campaigns", "accounting", "leads"… */
  surface: string;
  lang: Lang;
  /** Where each figure's "open the full report" goes, when the page has one. */
  reports?: Partial<Record<StandardMetricKey, MetricReportLink>>;
  /** Overrides for a page whose wording for a figure is genuinely different. */
  titles?: Partial<Record<StandardMetricKey, string>>;
  /** Extra caveats a surface knows and the shared builder cannot. */
  caveats?: Partial<Record<StandardMetricKey, string>>;
}

const EM = "—";

function campaignBreakdown(
  rows: PerfRow[],
  pick: (row: PerfRow) => number,
  format: (n: number) => string,
  tone: MetricBreakdownRow["tone"],
): MetricBreakdownRow[] {
  return topRows(
    rows.map((row) => ({
      key: row.key,
      label: row.name,
      value: pick(row),
      display: format(pick(row)),
      meta: row.platforms.length ? row.platforms.join(" · ") : undefined,
      tone,
    })),
  );
}

function platformRows(rows: PerfRow[], lang: Lang): MetricBreakdownRow[] {
  const per = new Map<Platform, { spend: number; leads: number; revenue: number }>();
  for (const row of rows) {
    // A row on two platforms cannot be split between them without inventing a
    // split, so it counts only where it is unambiguous.
    if (row.platforms.length !== 1) continue;
    const platform = row.platforms[0];
    const current = per.get(platform) ?? { spend: 0, leads: 0, revenue: 0 };
    current.spend += row.spend;
    current.leads += row.platformLeads ?? 0;
    current.revenue += row.revenue;
    per.set(platform, current);
  }
  return topRows(
    [...per.entries()].map(([platform, value]) => ({
      key: platform,
      label: PLATFORM_LABEL[platform][lang],
      value: value.spend,
      display: fmtUSD(value.spend),
      meta: value.leads ? `${fmtNum(value.leads)} ${lang === "ar" ? "ليد" : "leads"}` : undefined,
      tone: "rose" as const,
    })),
  );
}

/** Every standard figure a `Totals`-shaped surface can explain about itself. */
export function standardMetrics({
  totals: T,
  deltas = {},
  rows = [],
  trend = [],
  surface,
  lang,
  reports = {},
  titles = {},
  caveats = {},
}: StandardMetricInputs): Record<StandardMetricKey, MetricDetail> {
  const A = lang === "ar";
  const series = (metric: "spend" | "revenue" | "leads" | "won") => {
    const points = trend
      .filter((row) => typeof row[metric] === "number")
      .map((row) => ({ date: row.date, value: row[metric] as number }));
    return points.length > 1 ? points : undefined;
  };
  const title = (key: StandardMetricKey, fallback: string) => titles[key] ?? fallback;

  const trendFor = (
    metric: "spend" | "revenue" | "leads" | "won",
    label: string,
    format: (n: number) => string,
  ) => {
    const points = series(metric);
    return points ? { points, label, format } : undefined;
  };

  const bands = rows.reduce<Record<string, number>>((acc, row) => {
    const band = campaignReturnBand(row.spend, row.revenue);
    acc[band] = (acc[band] ?? 0) + 1;
    return acc;
  }, {});
  const bandLabel: Record<string, string> = A
    ? {
        strong: "أعلى من ×2",
        positive: "بين ×1.1 و ×2",
        breakeven: "عند حد التعادل",
        loss: "أقل من تكلفتها",
        unrated: "بلا إنفاق في الفترة",
      }
    : {
        strong: "Above 2x",
        positive: "1.1x – 2x",
        breakeven: "At break-even",
        loss: "Below cost",
        unrated: "No spend this period",
      };
  const bandTone: Record<string, MetricBreakdownRow["tone"]> = {
    strong: "mint",
    positive: "cyan",
    breakeven: "amber",
    loss: "rose",
    unrated: "slate",
  };

  const revenue: MetricDetail = {
    id: `${surface}.revenue`,
    title: title("revenue", A ? "الإيراد المحصّل" : "Collected revenue"),
    value: fmtUSD(T.revenue),
    tone: "mint",
    icon: <TrendingUp size={16} />,
    delta: deltas.revenue,
    definition: A
      ? "المبالغ المدفوعة فعليًا خلال الفترة، محسوبة بتاريخ الدفع من فواتير الحسابات."
      : "Money actually collected in the period, counted on payment date from Accounting invoices.",
    formula: A
      ? "مجموع قيمة الفواتير المدفوعة التي يقع تاريخ دفعها داخل الفترة المحددة."
      : "Sum of paid invoice value whose payment date falls inside the selected window.",
    caveat: caveats.revenue,
    trend: trendFor("revenue", A ? "حركة التحصيل" : "Collection over the period", fmtUSD),
    supporting: [
      { key: "invoices", label: A ? "عدد الفواتير" : "Invoices", value: fmtNum(T.orders) },
      {
        key: "avg",
        label: A ? "متوسط الفاتورة" : "Average invoice",
        value: fmtUSDFull(T.avgOrder),
      },
      {
        key: "attributed",
        label: A ? "مرتبط بحملات" : "Campaign-linked",
        value: fmtUSD(T.attributedRevenue),
      },
      {
        key: "perLead",
        label: A ? "الإيراد لكل عميل" : "Revenue per lead",
        value: fmtUSDFull(T.revenuePerLead),
      },
    ],
    breakdowns: rows.length
      ? [
          {
            id: "campaigns",
            title: A ? "أعلى الحملات إيرادًا مرتبطًا" : "Campaigns with the most linked revenue",
            rows: campaignBreakdown(rows, (row) => row.revenue, fmtUSD, "mint"),
            emptyLabel: A ? "لا توجد حملة بإيراد مرتبط" : "No campaign carries linked revenue",
          },
        ]
      : undefined,
    report: reports.revenue,
  };

  const spend: MetricDetail = {
    id: `${surface}.spend`,
    title: title("spend", A ? "الإنفاق الإعلاني" : "Ad spend"),
    value: fmtUSD(T.spend),
    tone: "rose",
    icon: <DollarSign size={16} />,
    delta: deltas.spend,
    deltaInvert: true,
    definition: A
      ? "ما أُنفق فعليًا على الإعلانات خلال الفترة، بتاريخ ظهور الإعلان، من كل المنصات المتصلة."
      : "What was actually spent on ads during the period, on ad date, across every connected platform.",
    formula: A
      ? "مجموع الإنفاق اليومي لكل إعلان داخل الفترة، بما فيه حسابات الزيارات."
      : "Sum of daily spend for every ad inside the window, traffic accounts included.",
    caveat:
      caveats.spend ??
      (T.nonLeadSpend > 0
        ? A
          ? `${fmtUSDFull(T.nonLeadSpend)} منها على حسابات زيارات أو بلا هدف معروف، وتظل داخل كل معادلات الكفاءة.`
          : `${fmtUSDFull(T.nonLeadSpend)} of it ran on traffic or unnamed accounts, and stays inside every efficiency formula.`
        : undefined),
    trend: trendFor("spend", A ? "حركة الإنفاق" : "Spend over the period", fmtUSD),
    supporting: [
      { key: "meta", label: PLATFORM_LABEL.meta[lang], value: fmtUSD(T.spendMeta) },
      { key: "snap", label: PLATFORM_LABEL.snapchat[lang], value: fmtUSD(T.spendSnap) },
      { key: "cpm", label: "CPM", value: fmtUSDFull(T.cpm) },
      { key: "cpc", label: "CPC", value: fmtUSDFull(T.cpc) },
    ],
    breakdowns: rows.length
      ? [
          {
            id: "platforms",
            title: A ? "حسب المنصة" : "By platform",
            hint: A
              ? "الحملات التي تعمل على منصة واحدة فقط، حتى لا يُقسم إنفاق مشترك تقديريًا."
              : "Single-platform campaigns only, so shared spend is never split by guesswork.",
            rows: platformRows(rows, lang),
            emptyLabel: A ? "لا يوجد إنفاق في الفترة" : "No spend in this period",
          },
          {
            id: "campaigns",
            title: A ? "أعلى الحملات إنفاقًا" : "Highest-spending campaigns",
            rows: campaignBreakdown(rows, (row) => row.spend, fmtUSD, "rose"),
            emptyLabel: A ? "لا توجد حملات أنفقت" : "No campaign spent",
          },
        ]
      : undefined,
    report: reports.spend,
  };

  const leads: MetricDetail = {
    id: `${surface}.leads`,
    title: title("leads", A ? "العملاء المحتملون" : "Leads"),
    value: fmtNum(T.totalLeads),
    tone: "sky",
    icon: <Users size={16} />,
    delta: deltas.totalLeads,
    definition: A
      ? "كل عميل محتمل دخل النظام في الفترة: صفوف الـCRM النشطة، بالإضافة إلى الصفقات الضائعة من مصدر الخسائر المعتمد."
      : "Every lead that entered the system in the period: active CRM rows plus the losses from the approved Lost source.",
    formula: A
      ? `عملاء CRM (${fmtNum(T.crmLeads)}) + الصفقات الضائعة (${fmtNum(T.lost)}) = ${fmtNum(T.totalLeads)}.`
      : `CRM leads (${fmtNum(T.crmLeads)}) + losses (${fmtNum(T.lost)}) = ${fmtNum(T.totalLeads)}.`,
    caveat: caveats.leads,
    trend: trendFor("leads", A ? "حركة دخول العملاء" : "Leads arriving over the period", fmtNum),
    supporting: [
      {
        key: "campaign",
        label: A ? "من حملات" : "From campaigns",
        value: fmtNum(T.leadsFromCampaign),
      },
      { key: "other", label: A ? "من مصادر أخرى" : "Other sources", value: fmtNum(T.leadsOther) },
      {
        key: "platform",
        label: A ? "أبلغت عنها المنصات" : "Platform-reported",
        value: fmtNum(T.platformLeads ?? 0),
      },
      {
        key: "conversion",
        label: A ? "معدل التحويل" : "Conversion rate",
        value: fmtPct(T.conversionRate, 1),
      },
    ],
    breakdowns: rows.length
      ? [
          {
            id: "campaigns",
            title: A ? "أعلى الحملات إنتاجًا للعملاء" : "Campaigns producing the most leads",
            rows: campaignBreakdown(rows, (row) => row.crmLeads, fmtNum, "sky"),
            emptyLabel: A ? "لا توجد حملة أنتجت عملاء" : "No campaign produced a lead",
          },
        ]
      : undefined,
    report: reports.leads,
  };

  const won: MetricDetail = {
    id: `${surface}.won`,
    title: title("won", A ? "الصفقات المغلقة" : "Won deals"),
    value: fmtNum(T.won),
    tone: "violet",
    icon: <Award size={16} />,
    delta: deltas.won,
    definition: A
      ? "عدد العملاء المحتملين الذين وصلوا إلى مرحلة الربح خلال الفترة."
      : "How many leads reached the won stage during the period.",
    formula: A
      ? `${fmtNum(T.won)} ÷ ${fmtNum(T.totalLeads)} = ${fmtPct(T.conversionRate, 2)} معدل تحويل.`
      : `${fmtNum(T.won)} ÷ ${fmtNum(T.totalLeads)} = ${fmtPct(T.conversionRate, 2)} conversion.`,
    caveat: caveats.won,
    trend: trendFor("won", A ? "حركة إغلاق الصفقات" : "Deals closing over the period", fmtNum),
    supporting: [
      {
        key: "rate",
        label: A ? "معدل التحويل" : "Conversion rate",
        value: fmtPct(T.conversionRate, 2),
      },
      { key: "leads", label: A ? "المقام المستخدم" : "Denominator", value: fmtNum(T.totalLeads) },
      {
        key: "close",
        label: A ? "متوسط زمن الإغلاق" : "Average close time",
        value: T.avgCloseDays === null ? EM : `${T.avgCloseDays.toFixed(1)} ${A ? "يوم" : "days"}`,
      },
      { key: "cpa", label: A ? "تكلفة الصفقة" : "Cost per won", value: fmtUSDFull(T.cpaWon) },
    ],
    breakdowns: rows.length
      ? [
          {
            id: "campaigns",
            title: A ? "حسب الحملة" : "By campaign",
            rows: campaignBreakdown(rows, (row) => row.won, fmtNum, "violet"),
            emptyLabel: A ? "لا توجد حملة أغلقت صفقة" : "No campaign closed a deal",
          },
        ]
      : undefined,
    report: reports.won,
  };

  const roas: MetricDetail = {
    id: `${surface}.roas`,
    title: title("roas", A ? "العائد على الإنفاق" : "Return on ad spend"),
    value: fmtRoas(T.roas),
    tone: T.roas !== null && isFinite(T.roas) && T.roas < 1 ? "rose" : "amber",
    icon: <Target size={16} />,
    delta: deltas.roas,
    definition: A
      ? "كل دولار أُنفق على الإعلانات، كم دولارًا من الإيراد المحصّل قابله في الفترة."
      : "For every dollar spent on ads, how many dollars of collected revenue came back in the period.",
    formula: A
      ? `الإيراد ÷ الإنفاق: ${fmtUSD(T.revenue)} ÷ ${fmtUSD(T.spend)} = ${fmtRoas(T.roas)}.`
      : `Revenue ÷ spend: ${fmtUSD(T.revenue)} ÷ ${fmtUSD(T.spend)} = ${fmtRoas(T.roas)}.`,
    caveat:
      caveats.roas ??
      (A
        ? `هذا هو العائد الإجمالي: كل التحصيل مقابل كل الإنفاق. العائد المرتبط — ${fmtRoas(T.attributedRoas)} — يحسب فقط الإيراد الذي يحمل حملة، وهما رقمان مختلفان لا يصح خلطهما.`
        : `This is the total return: all collection against all spend. The attributed return — ${fmtRoas(T.attributedRoas)} — counts only revenue that carries a campaign. They must not be mixed.`),
    supporting: [
      { key: "revenue", label: A ? "الإيراد المستخدم" : "Revenue used", value: fmtUSD(T.revenue) },
      { key: "spend", label: A ? "الإنفاق المستخدم" : "Spend used", value: fmtUSD(T.spend) },
      {
        key: "attributed",
        label: A ? "العائد المرتبط" : "Attributed return",
        value: fmtRoas(T.attributedRoas),
      },
      { key: "acos", label: "ACOS", value: fmtPct(T.acos, 1) },
    ],
    breakdowns: rows.length
      ? [
          {
            id: "best",
            title: A ? "أفضل الحملات عائدًا" : "Best-returning campaigns",
            rows: campaignBreakdown(
              rows.filter((row) => row.spend > 0),
              (row) => row.roas ?? 0,
              fmtRoas,
              "mint",
            ),
            emptyLabel: A ? "لا توجد حملة مؤهلة" : "No eligible campaign",
          },
          {
            id: "worst",
            title: A ? "حملات أنفقت أكثر مما أعادت" : "Campaigns that returned less than they cost",
            rows: campaignBreakdown(
              rows.filter((row) => row.spend > row.revenue),
              (row) => row.spend - row.revenue,
              fmtUSD,
              "rose",
            ),
            emptyLabel: A ? "لا توجد حملة خاسرة في الفترة" : "No loss-making campaign",
          },
          {
            id: "bands",
            title: A ? "توزيع الحملات حسب العائد" : "Campaigns by return band",
            hint: A
              ? `على ${fmtNum(rows.length)} حملة في الفترة.`
              : `Across ${fmtNum(rows.length)} campaigns in the period.`,
            rows: (["strong", "positive", "breakeven", "loss", "unrated"] as const)
              .filter((band) => (bands[band] ?? 0) > 0)
              .map((band) => ({
                key: band,
                label: bandLabel[band],
                value: bands[band] ?? 0,
                display: fmtNum(bands[band] ?? 0),
                tone: bandTone[band],
              })),
            emptyLabel: A ? "لا توجد حملات في الفترة" : "No campaigns in this period",
          },
        ]
      : undefined,
    report: reports.roas,
  };

  const conversion: MetricDetail = {
    id: `${surface}.conversion`,
    title: title("conversion", A ? "معدل التحويل" : "Conversion rate"),
    value: fmtPct(T.conversionRate, 2),
    tone: "violet",
    icon: <Percent size={14} />,
    delta: deltas.conversionRate,
    definition: A
      ? "نسبة العملاء المحتملين الذين تحوّلوا إلى صفقات رابحة داخل الفترة."
      : "The share of leads that became won deals inside the period.",
    formula: A
      ? `${fmtNum(T.won)} ÷ ${fmtNum(T.totalLeads)} = ${fmtPct(T.conversionRate, 2)}.`
      : `${fmtNum(T.won)} ÷ ${fmtNum(T.totalLeads)} = ${fmtPct(T.conversionRate, 2)}.`,
    caveat: caveats.conversion,
    supporting: [
      { key: "won", label: A ? "البسط · صفقات رابحة" : "Numerator · won", value: fmtNum(T.won) },
      {
        key: "leads",
        label: A ? "المقام · إجمالي العملاء" : "Denominator · all leads",
        value: fmtNum(T.totalLeads),
      },
      {
        key: "perLead",
        label: A ? "الإيراد لكل عميل" : "Revenue per lead",
        value: fmtUSDFull(T.revenuePerLead),
      },
      {
        key: "close",
        label: A ? "متوسط زمن الإغلاق" : "Average close time",
        value: T.avgCloseDays === null ? EM : `${T.avgCloseDays.toFixed(1)} ${A ? "يوم" : "days"}`,
      },
    ],
    breakdowns: rows.length
      ? [
          {
            id: "campaigns",
            title: A ? "حسب الحملة" : "By campaign",
            rows: topRows(
              rows
                .filter((row) => row.crmLeads > 0 && row.conversionRate !== null)
                .map((row) => ({
                  key: row.key,
                  label: row.name,
                  value: row.conversionRate ?? 0,
                  display: fmtPct(row.conversionRate, 1),
                  meta: `${fmtNum(row.won)} / ${fmtNum(row.crmLeads)}`,
                  tone: "violet" as const,
                })),
            ),
            emptyLabel: A ? "لا توجد حملة بعملاء" : "No campaign carries leads",
          },
        ]
      : undefined,
    report: reports.conversion,
  };

  const cpl: MetricDetail = {
    id: `${surface}.cpl`,
    title: title("cpl", A ? "تكلفة العميل المحتمل" : "Cost per lead"),
    value: fmtUSDFull(T.cpl),
    tone: "cyan",
    icon: <DollarSign size={14} />,
    delta: deltas.cpl,
    deltaInvert: true,
    definition: A
      ? "كم كلّف كل عميل محتمل أبلغت عنه المنصات الإعلانية. المقام هنا هو ليدز المنصات، لا عملاء الـCRM."
      : "What each platform-reported lead cost. The denominator is platform leads, not CRM leads.",
    formula: A
      ? `${fmtUSD(T.spend)} ÷ ${fmtNum(T.platformLeads ?? 0)} ليد إعلانية = ${fmtUSDFull(T.cpl)}.`
      : `${fmtUSD(T.spend)} ÷ ${fmtNum(T.platformLeads ?? 0)} platform leads = ${fmtUSDFull(T.cpl)}.`,
    caveat: caveats.cpl,
    supporting: [
      { key: "spend", label: A ? "الإنفاق" : "Spend", value: fmtUSD(T.spend) },
      {
        key: "platformLeads",
        label: A ? "ليدز المنصات" : "Platform leads",
        value: fmtNum(T.platformLeads ?? 0),
      },
      {
        key: "attributed",
        label: A ? "على العملاء المرتبطين" : "Per campaign-linked lead",
        value: fmtUSDFull(T.attributedCpl),
      },
      { key: "cpa", label: A ? "تكلفة الصفقة" : "Cost per won", value: fmtUSDFull(T.cpaWon) },
    ],
    breakdowns: rows.length
      ? [
          {
            id: "best",
            title: A ? "أرخص الحملات لكل ليد" : "Cheapest campaigns per lead",
            rows: topRows(
              rows
                .filter((row) => row.spend > 0 && (row.platformLeads ?? 0) > 0)
                .map((row) => ({
                  key: row.key,
                  // Inverted so the longest bar is the most efficient row,
                  // which is what this section is about.
                  value: 1 / (row.spend / (row.platformLeads ?? 1)),
                  label: row.name,
                  display: fmtUSDFull(row.spend / (row.platformLeads ?? 1)),
                  meta: `${fmtNum(row.platformLeads ?? 0)} ${A ? "ليد" : "leads"}`,
                  tone: "mint" as const,
                })),
            ),
            emptyLabel: A ? "لا توجد حملة بليدز مبلَّغة" : "No campaign reported leads",
          },
          {
            id: "worst",
            title: A ? "أغلى الحملات لكل ليد" : "Most expensive campaigns per lead",
            rows: topRows(
              rows
                .filter((row) => row.spend > 0 && (row.platformLeads ?? 0) > 0)
                .map((row) => ({
                  key: row.key,
                  label: row.name,
                  value: row.spend / (row.platformLeads ?? 1),
                  display: fmtUSDFull(row.spend / (row.platformLeads ?? 1)),
                  meta: `${fmtNum(row.platformLeads ?? 0)} ${A ? "ليد" : "leads"}`,
                  tone: "rose" as const,
                })),
            ),
            emptyLabel: A ? "لا توجد حملة بليدز مبلَّغة" : "No campaign reported leads",
          },
        ]
      : undefined,
    report: reports.cpl,
  };

  const cpa: MetricDetail = {
    id: `${surface}.cpa`,
    title: title("cpa", A ? "تكلفة الصفقة" : "Cost per won deal"),
    value: fmtUSDFull(T.cpa),
    tone: "violet",
    icon: <Target size={14} />,
    definition: A
      ? "كم كلّف الإعلان مقابل كل صفقة رابحة في الفترة."
      : "What advertising cost for each won deal in the period.",
    formula: A
      ? `${fmtUSD(T.spend)} ÷ ${fmtNum(T.won)} صفقة = ${fmtUSDFull(T.cpa)}.`
      : `${fmtUSD(T.spend)} ÷ ${fmtNum(T.won)} won = ${fmtUSDFull(T.cpa)}.`,
    caveat: caveats.cpa,
    supporting: [
      { key: "spend", label: A ? "الإنفاق" : "Spend", value: fmtUSD(T.spend) },
      { key: "won", label: A ? "صفقات رابحة" : "Won deals", value: fmtNum(T.won) },
      {
        key: "invoices",
        label: A ? "على أساس الفواتير" : "On an invoice basis",
        value: fmtUSDFull(T.cpaInvoices),
      },
      { key: "cpl", label: "CPL", value: fmtUSDFull(T.cpl) },
    ],
    report: reports.cpa,
  };

  const acos: MetricDetail = {
    id: `${surface}.acos`,
    title: title("acos", "ACOS"),
    value: fmtPct(T.acos, 1),
    tone: "amber",
    icon: <Percent size={14} />,
    delta: deltas.acos,
    deltaInvert: true,
    definition: A
      ? "نسبة الإنفاق الإعلاني من الإيراد المحصّل. كلما انخفضت كان الإعلان أرخص مقابل ما أعاده."
      : "Ad spend as a share of collected revenue. The lower it is, the cheaper the advertising was.",
    formula: A
      ? `${fmtUSD(T.spend)} ÷ ${fmtUSD(T.revenue)} = ${fmtPct(T.acos, 1)}. وهي مقلوب العائد على الإنفاق.`
      : `${fmtUSD(T.spend)} ÷ ${fmtUSD(T.revenue)} = ${fmtPct(T.acos, 1)}. It is the inverse of the return on ad spend.`,
    caveat: caveats.acos,
    supporting: [
      { key: "spend", label: A ? "الإنفاق" : "Spend", value: fmtUSD(T.spend) },
      { key: "revenue", label: A ? "الإيراد" : "Revenue", value: fmtUSD(T.revenue) },
      { key: "roas", label: A ? "العائد" : "Return", value: fmtRoas(T.roas) },
      {
        key: "attributedAcos",
        label: A ? "ACOS المرتبط" : "Attributed ACOS",
        value: fmtPct(T.attributedAcos, 1),
      },
    ],
    report: reports.acos,
  };

  const lost: MetricDetail = {
    id: `${surface}.lost`,
    title: title("lost", A ? "الصفقات الضائعة" : "Lost deals"),
    value: fmtNum(T.lost),
    tone: "rose",
    icon: <TrendingDown size={14} />,
    delta: deltas.lost,
    deltaInvert: true,
    definition: A
      ? "الصفقات التي أُغلقت خاسرة، من مصدر الخسائر المعتمد وحده. صفوف الـCRM التي حالتها «خسارة» مستبعدة حتى لا تُحسب الخسارة مرتين."
      : "Deals closed as lost, from the approved Lost source only. CRM rows whose stage is Lost are excluded so a loss is never counted twice.",
    formula: A
      ? `${fmtNum(T.lost)} ÷ ${fmtNum(T.totalLeads)} = ${fmtPct(T.lostRate, 2)}.`
      : `${fmtNum(T.lost)} ÷ ${fmtNum(T.totalLeads)} = ${fmtPct(T.lostRate, 2)}.`,
    caveat: caveats.lost,
    supporting: [
      { key: "rate", label: A ? "نسبة الخسارة" : "Lost rate", value: fmtPct(T.lostRate, 2) },
      {
        key: "denominator",
        label: A ? "المقام المستخدم" : "Denominator",
        value: fmtNum(T.totalLeads),
      },
      { key: "won", label: A ? "مقابل صفقات رابحة" : "Against won deals", value: fmtNum(T.won) },
      {
        key: "open",
        label: A ? "ما زال مفتوحًا" : "Still open",
        value: fmtNum(Math.max(0, T.totalLeads - T.won - T.lost)),
      },
    ],
    breakdowns: rows.length
      ? [
          {
            id: "campaigns",
            title: A ? "حسب الحملة" : "By campaign",
            rows: campaignBreakdown(rows, (row) => row.lost, fmtNum, "rose"),
            emptyLabel: A ? "لا توجد حملة بخسائر" : "No campaign carries a loss",
          },
        ]
      : undefined,
    report: reports.lost,
  };

  return { revenue, spend, leads, won, roas, conversion, cpl, cpa, acos, lost };
}
