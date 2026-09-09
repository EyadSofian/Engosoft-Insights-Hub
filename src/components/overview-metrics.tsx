import {
  AlertTriangle,
  Award,
  Crown,
  DollarSign,
  Lightbulb,
  Percent,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { fmtNum, fmtPct, fmtRoas, fmtUSD, fmtUSDFull, type Lang } from "@/lib/i18n";
import type {
  CampaignActivity,
  DataHealth,
  Deltas,
  ExecSummary,
  FunnelStep,
  Grouped,
  PerfRow,
  Platform,
  Totals,
} from "@/lib/types";
import type { AgentAnalyticsResult } from "@/lib/agent-analytics.server";
import { PLATFORM_LABEL } from "@/lib/constants";
import { campaignReturnBand } from "@/lib/campaign-return-band";
import { topRows, type MetricBreakdownRow, type MetricDetail } from "@/lib/metric-detail";

/* ---------------------------------------------------------------------------
   WHAT EACH FIGURE ON THE OVERVIEW ACTUALLY MEANS

   One builder per headline number. Everything comes out of the two responses
   the page has already rendered — `/api/overview` and `/api/teams` — so opening
   a detail costs nothing and can never disagree with the card that opened it.

   Where a section has no data behind it in those two responses, it is left out.
   The Overview response carries no invoice rows, so "the last five paid
   invoices" is not a section here; the panel links to Accounting for that
   instead of inventing five rows that look like invoices.
--------------------------------------------------------------------------- */

export interface OriginCohort {
  key: "campaign" | "other";
  leads: number;
  won: number;
  lost: number;
  conversionRate: number | null;
  lostRate: number | null;
  revenue: number;
  avgCloseDays: number | null;
  closeSample: number;
}

export interface CourseSaleContribution {
  course: string;
  mainCategory: string;
  revenue: number;
  contribution: number;
  paidInvoices: number;
  averageSalePrice: number | null;
}

export interface OverviewResp {
  totals: Totals;
  deltas: Deltas;
  prevRange: { from: string; to: string } | null;
  prevComparable: boolean;
  trend: { date: string; spend: number; revenue: number; leads: number; won: number }[];
  courseSales: CourseSaleContribution[];
  funnel: FunnelStep[];
  origin: { cohorts: OriginCohort[]; otherBySource: Grouped[] };
  best: PerfRow | null;
  leak: PerfRow | null;
  bestCPL: PerfRow | null;
  activity: CampaignActivity;
  topLeaks: PerfRow[];
  topByROAS: PerfRow[];
  topSpend: PerfRow[];
  accounts: { name: string; objective: string; spend: number; platformLeads: number | null }[];
  summary: ExecSummary;
  health: DataHealth;
  syncedAt: string;
  fetchErrors: string[];
  staleTabs: string[];
}

const ar = (lang: Lang) => lang === "ar";
const EM = "—";

/** A series out of the response itself. Never padded, never interpolated. */
const series = (rows: OverviewResp["trend"], metric: "spend" | "revenue" | "leads" | "won") =>
  rows.map((row) => ({ date: row.date, value: row[metric] }));

/* --- shared breakdown builders ------------------------------------------- */

function platformSpendRows(totals: Totals, lang: Lang): MetricBreakdownRow[] {
  const entries: [Platform, number][] = [
    ["meta", totals.spendMeta],
    ["snapchat", totals.spendSnap],
    ["tiktok", totals.spendTikTok],
    ["google", totals.spendGoogle],
  ];
  return topRows(
    entries.map(([platform, spend]) => ({
      key: platform,
      label: PLATFORM_LABEL[platform][lang],
      value: spend,
      display: fmtUSD(spend),
      meta: totals.spend > 0 ? fmtPct((spend / totals.spend) * 100, 1) : undefined,
      tone: "rose" as const,
    })),
    4,
  );
}

/** Employees, aggregated up to the team they belong to. */
function teamRows(
  agents: AgentAnalyticsResult["agents"],
  pick: (agent: AgentAnalyticsResult["agents"][number]) => number,
  format: (n: number) => string,
): MetricBreakdownRow[] {
  const totals = new Map<string, number>();
  for (const agent of agents) {
    const team = agent.team?.trim();
    if (!team) continue;
    totals.set(team, (totals.get(team) ?? 0) + pick(agent));
  }
  return topRows(
    [...totals.entries()].map(([team, value]) => ({
      key: team,
      label: team,
      value,
      display: format(value),
      tone: "cyan" as const,
    })),
  );
}

function agentRows(
  agents: AgentAnalyticsResult["agents"],
  pick: (agent: AgentAnalyticsResult["agents"][number]) => number,
  format: (n: number) => string,
  tone: MetricBreakdownRow["tone"] = "violet",
): MetricBreakdownRow[] {
  return topRows(
    agents.map((agent) => ({
      key: agent.key,
      label: agent.displayName || agent.name,
      value: pick(agent),
      display: format(pick(agent)),
      meta: agent.team || undefined,
      tone,
    })),
  );
}

function campaignRows(
  rows: PerfRow[],
  pick: (row: PerfRow) => number,
  format: (n: number) => string,
  tone: MetricBreakdownRow["tone"],
  limit = 5,
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
    limit,
  );
}

/* --- the metrics ---------------------------------------------------------- */

export interface OverviewMetricInputs {
  data: OverviewResp;
  workforce?: AgentAnalyticsResult;
  lang: Lang;
}

/** Every headline figure on the Overview, keyed by its Nexus element id. */
export function overviewMetrics({
  data,
  workforce,
  lang,
}: OverviewMetricInputs): Record<string, MetricDetail> {
  const T = data.totals;
  const D = data.deltas;
  const agents = workforce?.agents ?? [];
  const A = ar(lang);
  const campaignRowsAll = data.activity?.rows ?? [];

  /* ----- revenue ----- */
  const revenue: MetricDetail = {
    id: "overview.revenue",
    title: A ? "الإيراد المحصّل" : "Collected revenue",
    value: fmtUSD(T.revenue),
    tone: "mint",
    icon: <TrendingUp size={16} />,
    delta: D.revenue,
    definition: A
      ? "المبالغ المدفوعة فعليًا خلال الفترة، محسوبة بتاريخ الدفع من فواتير الحسابات. الفاتورة التي صدرت ولم تُدفع بعد لا تدخل هنا."
      : "Money actually collected in the period, counted on payment date from Accounting invoices. An invoice raised but not yet paid is not in this figure.",
    formula: A
      ? "مجموع قيمة الفواتير المدفوعة (Accounting · USD Paid) التي يقع تاريخ دفعها داخل الفترة المحددة."
      : "Sum of paid invoice value (Accounting · USD Paid) whose payment date falls inside the selected window.",
    trend: {
      points: series(data.trend, "revenue"),
      label: A ? "حركة التحصيل" : "Collection over the period",
      format: fmtUSD,
    },
    supporting: [
      {
        key: "invoices",
        label: A ? "عدد الفواتير" : "Invoices",
        value: fmtNum(T.orders),
      },
      {
        key: "avg",
        label: A ? "متوسط الفاتورة" : "Average invoice",
        value: fmtUSDFull(T.avgOrder),
      },
      {
        key: "attributed",
        label: A ? "مرتبط بحملات" : "Campaign-linked",
        value: fmtUSD(T.attributedRevenue),
        hint: T.revenue > 0 ? fmtPct((T.attributedRevenue / T.revenue) * 100, 1) : undefined,
      },
      {
        key: "unmatched",
        label: A ? "غير مرتبط بحملة" : "Not linked to a campaign",
        value: fmtUSD(T.unmatchedRevenue),
      },
    ],
    breakdowns: [
      {
        id: "courses",
        title: A ? "أعلى الدورات إيرادًا" : "Top courses by revenue",
        rows: topRows(
          data.courseSales.map((course) => ({
            key: course.course,
            label: course.course,
            value: course.revenue,
            display: fmtUSD(course.revenue),
            meta: `${fmtNum(course.paidInvoices)} ${A ? "فاتورة" : "inv."}`,
            tone: "mint" as const,
          })),
        ),
        moreTo: "/courses",
        moreLabel: A ? "عرض كل الدورات" : "View every course",
        emptyLabel: A ? "لا توجد مبيعات دورات مصنّفة" : "No classified course sales",
      },
      {
        id: "employees",
        title: A ? "أعلى الموظفين تحصيلًا" : "Top employees by collection",
        rows: agentRows(agents, (agent) => agent.paidRevenue, fmtUSD, "mint"),
        moreTo: "/teams",
        moreLabel: A ? "عرض أداء الموظفين" : "View employee performance",
        emptyLabel: A ? "لا توجد بيانات موظفين لهذه الفترة" : "No employee data for this period",
      },
      {
        id: "teams",
        title: A ? "الفرق" : "Teams",
        rows: teamRows(agents, (agent) => agent.paidRevenue, fmtUSD),
        emptyLabel: A ? "لا توجد فرق بإيراد في الفترة" : "No team collected in this period",
      },
    ],
    records: {
      title: A ? "الحملات صاحبة أعلى إيراد مرتبط" : "Campaigns with the most linked revenue",
      hint: A
        ? "الإيراد المرتبط فقط؛ باقي التحصيل لا يحمل حملة."
        : "Linked revenue only; the rest of the collection carries no campaign.",
      rows: [...data.topByROAS]
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5)
        .map((row) => ({
          key: row.key,
          title: row.name,
          subtitle: `${fmtNum(row.invoices)} ${A ? "فاتورة" : "invoices"} · ${fmtNum(row.crmLeads)} ${A ? "عميل" : "leads"}`,
          value: fmtUSD(row.revenue),
          meta: fmtRoas(row.roas),
        })),
      emptyLabel: A ? "لا توجد حملة بإيراد مرتبط" : "No campaign carries linked revenue",
    },
    report: {
      to: "/accounting",
      label: A ? "فتح تقرير الحسابات الكامل" : "Open the full Accounting report",
    },
  };

  /* ----- spend ----- */
  const reviewAccounts = data.accounts.filter((account) => account.objective !== "leads");
  const spend: MetricDetail = {
    id: "overview.spend",
    title: A ? "الإنفاق الإعلاني" : "Ad spend",
    value: fmtUSD(T.spend),
    tone: "rose",
    icon: <DollarSign size={16} />,
    delta: D.spend,
    deltaInvert: true,
    definition: A
      ? "ما أُنفق فعليًا على الإعلانات خلال الفترة، بتاريخ ظهور الإعلان، من كل المنصات المتصلة."
      : "What was actually spent on ads during the period, on ad date, across every connected platform.",
    formula: A
      ? "مجموع الإنفاق اليومي لكل إعلان في كل المنصات داخل الفترة، بما فيه حسابات الزيارات."
      : "Sum of daily spend for every ad on every platform inside the window, traffic accounts included.",
    caveat:
      T.nonLeadSpend > 0
        ? A
          ? `${fmtUSDFull(T.nonLeadSpend)} منها على حسابات زيارات أو حسابات بلا هدف معروف، وتظل داخل كل معادلات الكفاءة حسب تعريف الإدارة.`
          : `${fmtUSDFull(T.nonLeadSpend)} of it ran on traffic or unnamed accounts, and stays inside every efficiency formula by the approved definition.`
        : undefined,
    trend: {
      points: series(data.trend, "spend"),
      label: A ? "حركة الإنفاق" : "Spend over the period",
      format: fmtUSD,
    },
    supporting: [
      { key: "cpm", label: "CPM", value: fmtUSDFull(T.cpm) },
      { key: "cpc", label: "CPC", value: fmtUSDFull(T.cpc) },
      {
        key: "platformLeads",
        label: A ? "ليدز أبلغت عنها المنصات" : "Platform-reported leads",
        value: fmtNum(T.platformLeads ?? 0),
      },
      {
        key: "cpl",
        label: "CPL",
        value: fmtUSDFull(T.cpl),
      },
    ],
    breakdowns: [
      {
        id: "platforms",
        title: A ? "حسب المنصة" : "By platform",
        rows: platformSpendRows(T, lang),
        emptyLabel: A ? "لا يوجد إنفاق في الفترة" : "No spend in this period",
      },
      {
        id: "campaigns",
        title: A ? "أعلى الحملات إنفاقًا" : "Highest-spending campaigns",
        rows: campaignRows(data.topSpend, (row) => row.spend, fmtUSD, "rose"),
        moreTo: "/campaigns",
        moreLabel: A ? "عرض كل الحملات" : "View every campaign",
        emptyLabel: A ? "لا توجد حملات أنفقت" : "No campaign spent",
      },
      {
        id: "accounts",
        title: A ? "الحسابات الإعلانية" : "Ad accounts",
        rows: topRows(
          data.accounts.map((account) => ({
            key: account.name,
            label: account.name,
            value: account.spend,
            display: fmtUSD(account.spend),
            meta:
              account.platformLeads === null
                ? undefined
                : `${fmtNum(account.platformLeads)} ${A ? "ليد" : "leads"}`,
            tone: "amber" as const,
          })),
        ),
        emptyLabel: A ? "لا توجد حسابات نشطة" : "No active account",
      },
    ],
    records: {
      title: A ? "حسابات تحتاج مراجعة" : "Accounts that need review",
      hint: A
        ? "هدفها ليس جمع عملاء، فإنفاقها يرفع التكلفة دون أن ينتج ليدز."
        : "Their objective is not lead collection, so their spend raises cost without producing leads.",
      rows: reviewAccounts.slice(0, 5).map((account) => ({
        key: account.name,
        title: account.name,
        subtitle:
          account.objective === "traffic"
            ? A
              ? "هدف الحساب: زيارات"
              : "Objective: traffic"
            : A
              ? "هدف الحساب غير معروف"
              : "Objective unknown",
        value: fmtUSDFull(account.spend),
      })),
      emptyLabel: A ? "كل الحسابات هدفها جمع عملاء" : "Every account is a lead-collection account",
    },
    report: {
      to: "/campaigns",
      label: A ? "فتح تقرير الحملات" : "Open the campaigns report",
    },
  };

  /* ----- leads ----- */
  const campaignCohort = data.origin.cohorts.find((cohort) => cohort.key === "campaign");
  const otherCohort = data.origin.cohorts.find((cohort) => cohort.key === "other");
  const wf = workforce?.summary;
  const leads: MetricDetail = {
    id: "overview.leads",
    title: A ? "العملاء المحتملون" : "Leads",
    value: fmtNum(T.totalLeads),
    tone: "sky",
    icon: <Users size={16} />,
    delta: D.totalLeads,
    definition: A
      ? "كل عميل محتمل دخل النظام في الفترة: صفوف الـCRM النشطة، بالإضافة إلى الصفقات الضائعة من مصدر الخسائر المعتمد."
      : "Every lead that entered the system in the period: active CRM rows plus the losses from the approved Lost source.",
    formula: A
      ? `عملاء CRM (${fmtNum(T.crmLeads)}) + الصفقات الضائعة المعتمدة (${fmtNum(T.lost)}) = ${fmtNum(T.totalLeads)}.`
      : `CRM leads (${fmtNum(T.crmLeads)}) + approved losses (${fmtNum(T.lost)}) = ${fmtNum(T.totalLeads)}.`,
    trend: {
      points: series(data.trend, "leads"),
      label: A ? "حركة دخول العملاء" : "Leads arriving over the period",
      format: fmtNum,
    },
    supporting: [
      {
        key: "campaign",
        label: A ? "من حملات" : "From campaigns",
        value: fmtNum(T.leadsFromCampaign),
      },
      {
        key: "other",
        label: A ? "من مصادر أخرى" : "From other sources",
        value: fmtNum(T.leadsOther),
      },
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
    breakdowns: [
      {
        id: "sources",
        title: A ? "العملاء بلا حملة، حسب المصدر" : "Non-campaign leads by source",
        rows: topRows(
          data.origin.otherBySource.map((group) => ({
            key: group.label,
            label: group.label,
            value: group.count,
            display: fmtNum(group.count),
            meta: fmtPct(group.share, 1),
            tone: "sky" as const,
          })),
        ),
        moreTo: "/leads",
        moreLabel: A ? "عرض تقرير العملاء" : "Open the leads report",
        emptyLabel: A ? "كل العملاء جاءوا من حملات" : "Every lead came from a campaign",
      },
      {
        id: "campaigns",
        title: A ? "أعلى الحملات إنتاجًا للعملاء" : "Campaigns producing the most leads",
        rows: campaignRows(data.topSpend, (row) => row.crmLeads, fmtNum, "sky"),
        moreTo: "/campaigns",
        moreLabel: A ? "عرض كل الحملات" : "View every campaign",
        emptyLabel: A ? "لا توجد حملة أنتجت عملاء" : "No campaign produced a lead",
      },
      ...(wf && wf.distributedLeads > 0
        ? [
            {
              id: "followup",
              title: A ? "المتابعة الهاتفية" : "Phone follow-up",
              hint: A
                ? "من العملاء الموزّعين على الموظفين في هذه الفترة."
                : "Of the leads distributed to employees in this period.",
              rows: [
                {
                  key: "called",
                  label: A ? "تم الاتصال بهم" : "Called",
                  value: wf.calledDistributedLeads ?? 0,
                  display: fmtNum(wf.calledDistributedLeads ?? 0),
                  tone: "mint" as const,
                },
                {
                  key: "uncalled",
                  label: A ? "لم يتم الاتصال بهم" : "Not called",
                  value: wf.uncalledDistributedLeads ?? 0,
                  display: fmtNum(wf.uncalledDistributedLeads ?? 0),
                  tone: "rose" as const,
                },
              ],
              max: wf.distributedLeads,
              moreTo: "/teams",
              moreLabel: A ? "عرض المتابعة بالتفصيل" : "See follow-up in detail",
            },
          ]
        : []),
    ],
    records: {
      title: A ? "من أين جاء العملاء" : "Where the leads came from",
      hint: A
        ? "سياسة الخصوصية تمنع عرض بيانات عميل بعينه هنا؛ هذه هي الفئات."
        : "Privacy policy keeps individual lead details out of here; these are the cohorts.",
      rows: [
        ...(campaignCohort
          ? [
              {
                key: "campaign",
                title: A ? "عملاء من حملات" : "Leads from campaigns",
                subtitle: `${A ? "معدل التحويل" : "Conversion"} ${fmtPct(campaignCohort.conversionRate, 1)}`,
                value: fmtNum(campaignCohort.leads),
                meta: fmtUSD(campaignCohort.revenue),
              },
            ]
          : []),
        ...(otherCohort
          ? [
              {
                key: "other",
                title: A ? "عملاء من مصادر أخرى" : "Leads from other sources",
                subtitle: `${A ? "معدل التحويل" : "Conversion"} ${fmtPct(otherCohort.conversionRate, 1)}`,
                value: fmtNum(otherCohort.leads),
                meta: fmtUSD(otherCohort.revenue),
              },
            ]
          : []),
      ],
    },
    report: { to: "/leads", label: A ? "فتح تقرير العملاء" : "Open the leads report" },
  };

  /* ----- won ----- */
  const won: MetricDetail = {
    id: "overview.won",
    title: A ? "الصفقات المغلقة" : "Won deals",
    value: fmtNum(T.won),
    tone: "violet",
    icon: <Award size={16} />,
    delta: D.won,
    definition: A
      ? "عدد العملاء المحتملين الذين وصلوا إلى مرحلة الربح خلال الفترة."
      : "How many leads reached the won stage during the period.",
    formula: A
      ? `${fmtNum(T.won)} صفقة رابحة ÷ ${fmtNum(T.totalLeads)} عميل في الفترة = ${fmtPct(T.conversionRate, 2)} معدل تحويل.`
      : `${fmtNum(T.won)} won ÷ ${fmtNum(T.totalLeads)} leads in the period = ${fmtPct(T.conversionRate, 2)} conversion.`,
    trend: {
      points: series(data.trend, "won"),
      label: A ? "حركة إغلاق الصفقات" : "Deals closing over the period",
      format: fmtNum,
    },
    supporting: [
      {
        key: "rate",
        label: A ? "معدل التحويل" : "Conversion rate",
        value: fmtPct(T.conversionRate, 2),
        hint: A
          ? `المقام: ${fmtNum(T.totalLeads)} عميل`
          : `Denominator: ${fmtNum(T.totalLeads)} leads`,
      },
      {
        key: "close",
        label: A ? "متوسط زمن الإغلاق" : "Average close time",
        value: T.avgCloseDays === null ? EM : `${T.avgCloseDays.toFixed(1)} ${A ? "يوم" : "days"}`,
        hint: T.closeSample ? `${fmtNum(T.closeSample)} ${A ? "صفقة" : "deals"}` : undefined,
      },
      {
        key: "invoices",
        label: A ? "الفواتير المدفوعة" : "Paid invoices",
        value: fmtNum(T.orders),
      },
      { key: "cpa", label: A ? "تكلفة الصفقة" : "Cost per won", value: fmtUSDFull(T.cpaWon) },
    ],
    breakdowns: [
      {
        id: "employees",
        title: A ? "حسب الموظف" : "By employee",
        rows: agentRows(agents, (agent) => agent.won, fmtNum),
        moreTo: "/teams",
        moreLabel: A ? "عرض أداء الموظفين" : "View employee performance",
        emptyLabel: A ? "لا توجد بيانات موظفين لهذه الفترة" : "No employee data for this period",
      },
      {
        id: "teams",
        title: A ? "حسب الفريق" : "By team",
        rows: teamRows(agents, (agent) => agent.won, fmtNum),
        emptyLabel: A ? "لا توجد فرق بصفقات في الفترة" : "No team closed in this period",
      },
      {
        id: "campaigns",
        title: A ? "حسب الحملة" : "By campaign",
        rows: campaignRows(data.topByROAS, (row) => row.won, fmtNum, "violet"),
        moreTo: "/campaigns",
        moreLabel: A ? "عرض كل الحملات" : "View every campaign",
        emptyLabel: A ? "لا توجد حملة أغلقت صفقة" : "No campaign closed a deal",
      },
    ],
    report: { to: "/sales", label: A ? "فتح تقرير المبيعات" : "Open the sales report" },
  };

  /* ----- return on ad spend ----- */
  const bands = campaignRowsAll.reduce(
    (acc, row) => {
      const band = campaignReturnBand(row.spend, row.revenue);
      acc[band] = (acc[band] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
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

  const roas: MetricDetail = {
    id: "overview.roas",
    title: A ? "العائد الإعلاني المنسوب" : "Attributed ad ROAS",
    value: fmtRoas(T.attributedRoas),
    tone:
      T.attributedRoas !== null && isFinite(T.attributedRoas) && T.attributedRoas < 1
        ? "rose"
        : "amber",
    icon: <Target size={16} />,
    delta: D.attributedRoas,
    definition: A
      ? "كل دولار أُنفق على الإعلانات، كم دولارًا من الإيراد المحصّل المرتبط بحملة رجع في الفترة."
      : "For every dollar spent on ads, how much campaign-attributed collected revenue came back in the period.",
    formula: A
      ? `الإيراد المرتبط بحملة ÷ الإنفاق: ${fmtUSD(T.attributedRevenue)} ÷ ${fmtUSD(T.spend)} = ${fmtRoas(T.attributedRoas)}.`
      : `Campaign-attributed revenue ÷ spend: ${fmtUSD(T.attributedRevenue)} ÷ ${fmtUSD(T.spend)} = ${fmtRoas(T.attributedRoas)}.`,
    caveat: A
      ? `إجمالي التحصيل ÷ الإنفاق يساوي ${fmtRoas(T.roas)}، لكنه ليس ROAS إعلانيًا لأنه يشمل إيرادًا غير منسوب إلى حملة.`
      : `All collected revenue ÷ spend is ${fmtRoas(T.roas)}, but it is not advertising ROAS because it includes revenue not attributed to a campaign.`,
    supporting: [
      {
        key: "attributed_revenue",
        label: A ? "الإيراد المنسوب المستخدم" : "Attributed revenue used",
        value: fmtUSD(T.attributedRevenue),
      },
      { key: "spend", label: A ? "الإنفاق المستخدم" : "Spend used", value: fmtUSD(T.spend) },
      {
        key: "all_revenue",
        label: A ? "إجمالي التحصيل" : "All collected revenue",
        value: fmtUSD(T.revenue),
        hint: A ? "للسياق فقط" : "Context only",
      },
      {
        key: "all_revenue_ratio",
        label: A ? "إجمالي التحصيل ÷ الإنفاق" : "All revenue ÷ spend",
        value: fmtRoas(T.roas),
        hint: A ? "ليس ROAS إعلانيًا" : "Not advertising ROAS",
      },
    ],
    breakdowns: [
      {
        id: "best",
        title: A ? "أفضل الحملات عائدًا" : "Best-returning campaigns",
        rows: campaignRows(data.topByROAS, (row) => row.roas ?? 0, fmtRoas, "mint"),
        moreTo: "/campaigns",
        moreLabel: A ? "عرض كل الحملات" : "View every campaign",
        emptyLabel: A ? "لا توجد حملة مؤهلة" : "No eligible campaign",
      },
      {
        id: "worst",
        title: A ? "حملات أنفقت أكثر مما أعادت" : "Campaigns that returned less than they cost",
        rows: campaignRows(data.topLeaks, (row) => row.spend - row.revenue, fmtUSD, "rose"),
        moreTo: "/campaigns",
        moreLabel: A ? "عرض كل الحملات" : "View every campaign",
        emptyLabel: A ? "لا توجد حملة خاسرة في الفترة" : "No loss-making campaign in this period",
      },
      {
        id: "bands",
        title: A ? "توزيع الحملات حسب العائد" : "Campaigns by return band",
        hint: A
          ? `على ${fmtNum(campaignRowsAll.length)} حملة في الفترة.`
          : `Across ${fmtNum(campaignRowsAll.length)} campaigns in the period.`,
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
    ],
    report: { to: "/campaigns", label: A ? "فتح تقرير الحملات" : "Open the campaigns report" },
  };

  return { revenue, spend, leads, won, roas };
}

/* --- the second row ------------------------------------------------------- */

/** Cost, follow-up and loss — the figures that qualify the five above them. */
export function overviewEfficiencyMetrics({
  data,
  workforce,
  lang,
}: OverviewMetricInputs): Record<string, MetricDetail> {
  const T = data.totals;
  const D = data.deltas;
  const A = ar(lang);
  const agents = workforce?.agents ?? [];
  const campaignRowsAll = data.activity?.rows ?? [];

  /** Spend and platform-reported leads, added up per platform from the campaign rows. */
  const perPlatform = new Map<Platform, { spend: number; leads: number }>();
  for (const row of campaignRowsAll) {
    // A row that ran on two platforms cannot be split between them without
    // inventing a split, so it is counted only where it is unambiguous.
    if (row.platforms.length !== 1) continue;
    const platform = row.platforms[0];
    const current = perPlatform.get(platform) ?? { spend: 0, leads: 0 };
    current.spend += row.spend;
    current.leads += row.platformLeads ?? 0;
    perPlatform.set(platform, current);
  }

  const lost: MetricDetail = {
    id: "overview.lost",
    title: A ? "الصفقات الضائعة" : "Lost deals",
    value: fmtNum(T.lost),
    tone: "rose",
    icon: <TrendingDown size={14} />,
    delta: D.lost,
    deltaInvert: true,
    definition: A
      ? "الصفقات التي أُغلقت خاسرة، من مصدر الخسائر المعتمد وحده. صفوف الـCRM التي حالتها «خسارة» مستبعدة تمامًا حتى لا تُحسب الخسارة مرتين."
      : "Deals closed as lost, from the approved Lost source only. CRM rows whose stage is Lost are excluded entirely so a loss is never counted twice.",
    formula: A
      ? `${fmtNum(T.lost)} صفقة ضائعة ÷ ${fmtNum(T.totalLeads)} عميل = ${fmtPct(T.lostRate, 2)}.`
      : `${fmtNum(T.lost)} lost ÷ ${fmtNum(T.totalLeads)} leads = ${fmtPct(T.lostRate, 2)}.`,
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
    breakdowns: [
      {
        id: "employees",
        title: A ? "أكثر الموظفين تأثرًا" : "Most affected employees",
        rows: agentRows(agents, (agent) => agent.lost, fmtNum, "rose"),
        moreTo: "/teams",
        moreLabel: A ? "عرض أداء الموظفين" : "View employee performance",
        emptyLabel: A ? "لا توجد بيانات موظفين لهذه الفترة" : "No employee data for this period",
      },
      {
        id: "teams",
        title: A ? "أكثر الفرق تأثرًا" : "Most affected teams",
        rows: teamRows(agents, (agent) => agent.lost, fmtNum),
        emptyLabel: A ? "لا توجد فرق بخسائر في الفترة" : "No team lost a deal in this period",
      },
    ],
    report: { to: "/lost", label: A ? "فتح تحليل الخسائر" : "Open the Lost analysis" },
  };

  const conversion: MetricDetail = {
    id: "overview.conversion",
    title: A ? "معدل التحويل" : "Conversion rate",
    value: fmtPct(T.conversionRate, 2),
    tone: "violet",
    icon: <Percent size={14} />,
    delta: D.conversionRate,
    definition: A
      ? "نسبة العملاء المحتملين الذين تحوّلوا إلى صفقات رابحة داخل الفترة."
      : "The share of leads that became won deals inside the period.",
    formula: A
      ? `${fmtNum(T.won)} ÷ ${fmtNum(T.totalLeads)} = ${fmtPct(T.conversionRate, 2)}.`
      : `${fmtNum(T.won)} ÷ ${fmtNum(T.totalLeads)} = ${fmtPct(T.conversionRate, 2)}.`,
    supporting: [
      { key: "won", label: A ? "البسط · صفقات رابحة" : "Numerator · won", value: fmtNum(T.won) },
      {
        key: "leads",
        label: A ? "المقام · إجمالي العملاء" : "Denominator · all leads",
        value: fmtNum(T.totalLeads),
      },
      {
        key: "revenuePerLead",
        label: A ? "الإيراد لكل عميل" : "Revenue per lead",
        value: fmtUSDFull(T.revenuePerLead),
      },
      {
        key: "close",
        label: A ? "متوسط زمن الإغلاق" : "Average close time",
        value: T.avgCloseDays === null ? EM : `${T.avgCloseDays.toFixed(1)} ${A ? "يوم" : "days"}`,
      },
    ],
    breakdowns: [
      {
        id: "origin",
        title: A ? "حسب المصدر" : "By origin",
        rows: data.origin.cohorts.map((cohort) => ({
          key: cohort.key,
          label:
            cohort.key === "campaign"
              ? A
                ? "من حملات"
                : "From campaigns"
              : A
                ? "مصادر أخرى"
                : "Other sources",
          value: cohort.conversionRate ?? 0,
          display: fmtPct(cohort.conversionRate, 2),
          meta: `${fmtNum(cohort.won)} / ${fmtNum(cohort.leads)}`,
          tone: "violet" as const,
        })),
        emptyLabel: A ? "لا توجد بيانات مصدر" : "No origin data",
      },
      {
        id: "employees",
        title: A ? "حسب الموظف" : "By employee",
        rows: topRows(
          agents
            .filter((agent) => agent.cleanLeads > 0 && agent.conversionRate !== null)
            .map((agent) => ({
              key: agent.key,
              label: agent.displayName || agent.name,
              value: agent.conversionRate ?? 0,
              display: fmtPct(agent.conversionRate, 1),
              meta: `${fmtNum(agent.won)} / ${fmtNum(agent.cleanLeads)}`,
              tone: "violet" as const,
            })),
        ),
        moreTo: "/teams",
        moreLabel: A ? "عرض أداء الموظفين" : "View employee performance",
        emptyLabel: A ? "لا توجد بيانات موظفين لهذه الفترة" : "No employee data for this period",
      },
    ],
    report: { to: "/teams", label: A ? "فتح أداء الموظفين" : "Open employee performance" },
  };

  const cpl: MetricDetail = {
    id: "overview.cpl",
    title: A ? "تكلفة العميل المحتمل" : "Cost per lead",
    value: fmtUSDFull(T.cpl),
    // A cost is read against the thing it bought, so cost-per-lead takes the
    // lead family and cost-per-won takes the won family. Painting all three
    // cost figures amber gave the second row three identical cards and told a
    // reader nothing about which one belonged to which funnel stage.
    tone: "cyan",
    icon: <DollarSign size={14} />,
    delta: D.cpl,
    deltaInvert: true,
    definition: A
      ? "كم كلّف كل عميل محتمل أبلغت عنه المنصات الإعلانية. المقام هنا هو ليدز المنصات، لا عملاء الـCRM."
      : "What each platform-reported lead cost. The denominator is platform leads, not CRM leads.",
    formula: A
      ? `${fmtUSD(T.spend)} ÷ ${fmtNum(T.platformLeads ?? 0)} ليد إعلانية = ${fmtUSDFull(T.cpl)}.`
      : `${fmtUSD(T.spend)} ÷ ${fmtNum(T.platformLeads ?? 0)} platform leads = ${fmtUSDFull(T.cpl)}.`,
    supporting: [
      { key: "spend", label: A ? "الإنفاق" : "Spend", value: fmtUSD(T.spend) },
      {
        key: "platformLeads",
        label: A ? "ليدز المنصات" : "Platform leads",
        value: fmtNum(T.platformLeads ?? 0),
      },
      {
        key: "attributed",
        label: A ? "التكلفة على العملاء المرتبطين" : "Cost per campaign-linked lead",
        value: fmtUSDFull(T.attributedCpl),
      },
      { key: "cpa", label: A ? "تكلفة الصفقة" : "Cost per won", value: fmtUSDFull(T.cpaWon) },
    ],
    breakdowns: [
      {
        id: "platforms",
        title: A ? "حسب المنصة" : "By platform",
        hint: A
          ? "الحملات التي تعمل على منصة واحدة فقط، حتى لا يُقسم إنفاق مشترك تقديريًا."
          : "Single-platform campaigns only, so shared spend is never split by guesswork.",
        rows: topRows(
          [...perPlatform.entries()]
            .filter(([, value]) => value.leads > 0)
            .map(([platform, value]) => ({
              key: platform,
              label: PLATFORM_LABEL[platform][lang],
              value: value.spend / value.leads,
              display: fmtUSDFull(value.spend / value.leads),
              meta: `${fmtNum(value.leads)} ${A ? "ليد" : "leads"}`,
              tone: "amber" as const,
            })),
        ),
        emptyLabel: A ? "لا توجد منصة أبلغت عن ليدز" : "No platform reported leads",
      },
      {
        id: "best",
        title: A ? "أرخص الحملات لكل ليد" : "Cheapest campaigns per lead",
        rows: topRows(
          campaignRowsAll
            .filter((row) => row.spend > 0 && (row.platformLeads ?? 0) > 0)
            .map((row) => ({
              key: row.key,
              label: row.name,
              // Sorted ascending by inverting the weight: the bar length then
              // reads "more efficient", which is what the section is about.
              value: 1 / (row.spend / (row.platformLeads ?? 1)),
              display: fmtUSDFull(row.spend / (row.platformLeads ?? 1)),
              meta: `${fmtNum(row.platformLeads ?? 0)} ${A ? "ليد" : "leads"}`,
              tone: "mint" as const,
            })),
        ),
        moreTo: "/campaigns",
        moreLabel: A ? "عرض كل الحملات" : "View every campaign",
        emptyLabel: A ? "لا توجد حملة بليدز مبلَّغة" : "No campaign reported leads",
      },
      {
        id: "worst",
        title: A ? "أغلى الحملات لكل ليد" : "Most expensive campaigns per lead",
        rows: topRows(
          campaignRowsAll
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
        moreTo: "/campaigns",
        moreLabel: A ? "عرض كل الحملات" : "View every campaign",
        emptyLabel: A ? "لا توجد حملة بليدز مبلَّغة" : "No campaign reported leads",
      },
    ],
    report: { to: "/campaigns", label: A ? "فتح تقرير الحملات" : "Open the campaigns report" },
  };

  const lostRate: MetricDetail = {
    ...lost,
    id: "overview.lostRate",
    title: A ? "نسبة الخسارة" : "Lost rate",
    value: fmtPct(T.lostRate, 2),
    delta: D.lostRate,
    icon: <Percent size={14} />,
    definition: A
      ? "نسبة العملاء المحتملين الذين انتهت صفقتهم بالخسارة داخل الفترة، من مصدر الخسائر المعتمد وحده."
      : "The share of leads whose deal ended as lost inside the period, from the approved Lost source only.",
  };

  const acos: MetricDetail = {
    id: "overview.acos",
    title: "ACOS",
    value: fmtPct(T.acos, 1),
    tone: "amber",
    icon: <Percent size={14} />,
    delta: D.acos,
    deltaInvert: true,
    definition: A
      ? "نسبة الإنفاق الإعلاني من الإيراد المحصّل. كلما انخفضت كان الإعلان أرخص مقابل ما أعاده."
      : "Ad spend as a share of collected revenue. The lower it is, the cheaper the advertising was for what it returned.",
    formula: A
      ? `${fmtUSD(T.spend)} ÷ ${fmtUSD(T.revenue)} = ${fmtPct(T.acos, 1)}. وهي مقلوب العائد على الإنفاق.`
      : `${fmtUSD(T.spend)} ÷ ${fmtUSD(T.revenue)} = ${fmtPct(T.acos, 1)}. It is the inverse of the return on ad spend.`,
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
    report: { to: "/campaigns", label: A ? "فتح تقرير الحملات" : "Open the campaigns report" },
  };

  const closeTime: MetricDetail = {
    id: "overview.closeTime",
    title: A ? "متوسط زمن الإغلاق" : "Average close time",
    value: T.avgCloseDays === null ? EM : `${T.avgCloseDays.toFixed(1)}`,
    tone: "slate",
    icon: <Timer size={14} />,
    definition: A
      ? "متوسط عدد الأيام بين دخول العميل المحتمل وإغلاق صفقته، محسوبًا على الصفقات المغلقة فقط."
      : "The average number of days between a lead arriving and its deal closing, over closed deals only.",
    formula: A
      ? `محسوب على ${fmtNum(T.closeSample)} صفقة مغلقة يمكن قياس زمنها.`
      : `Measured over ${fmtNum(T.closeSample)} closed deals whose timing is measurable.`,
    supporting: [
      { key: "sample", label: A ? "حجم العينة" : "Sample", value: fmtNum(T.closeSample) },
      { key: "won", label: A ? "صفقات رابحة" : "Won", value: fmtNum(T.won) },
      ...data.origin.cohorts.map((cohort) => ({
        key: `close-${cohort.key}`,
        label:
          cohort.key === "campaign"
            ? A
              ? "من حملات"
              : "From campaigns"
            : A
              ? "مصادر أخرى"
              : "Other sources",
        value:
          cohort.avgCloseDays === null
            ? EM
            : `${cohort.avgCloseDays.toFixed(1)} ${A ? "يوم" : "days"}`,
        hint: `${fmtNum(cohort.closeSample)} ${A ? "صفقة" : "deals"}`,
      })),
    ],
    report: { to: "/sales", label: A ? "فتح تقرير المبيعات" : "Open the sales report" },
  };

  const cpa: MetricDetail = {
    id: "overview.cpa",
    title: A ? "تكلفة الصفقة" : "Cost per won deal",
    value: fmtUSDFull(T.cpa),
    tone: "violet",
    icon: <Target size={14} />,
    definition: A
      ? "كم كلّف الإعلان مقابل كل صفقة رابحة في الفترة."
      : "What advertising cost for each won deal in the period.",
    formula: A
      ? `${fmtUSD(T.spend)} ÷ ${fmtNum(T.won)} صفقة = ${fmtUSDFull(T.cpa)}.`
      : `${fmtUSD(T.spend)} ÷ ${fmtNum(T.won)} won = ${fmtUSDFull(T.cpa)}.`,
    supporting: [
      { key: "spend", label: A ? "الإنفاق" : "Spend", value: fmtUSD(T.spend) },
      { key: "won", label: A ? "صفقات رابحة" : "Won deals", value: fmtNum(T.won) },
      {
        key: "invoices",
        label: A ? "على أساس الفواتير" : "On an invoice basis",
        value: fmtUSDFull(T.cpaInvoices),
        hint: `${fmtNum(T.orders)} ${A ? "فاتورة" : "invoices"}`,
      },
      { key: "cpl", label: "CPL", value: fmtUSDFull(T.cpl) },
    ],
    report: { to: "/sales", label: A ? "فتح تقرير المبيعات" : "Open the sales report" },
  };

  return { lost, conversion, lostRate, closeTime, acos, cpl, cpa };
}

/* ---------------------------------------------------------------------------
   THE THREE READINGS OF THE PERIOD

   The Overview's headline figures say what happened; these say what to do about
   it. They live beside the figure builders rather than in the route because
   they are the same kind of thing — a description assembled from the response
   already on screen — and because a verdict the app states out loud is exactly
   the thing that has to be testable on its own.
--------------------------------------------------------------------------- */

export interface BusinessSignals {
  topCourse: CourseSaleContribution | null;
  courseTargetShare: number | null;
  targetComplete: boolean;
  bestEmployee: AgentAnalyticsResult["agents"][number] | null;
  bestCampaign: PerfRow | null;
  risk: { title: string; detail: string };
  decision: { title: string; detail: string; href: string };
}

export function businessSignals(
  data: OverviewResp,
  workforce: AgentAnalyticsResult | undefined,
  lang: "ar" | "en",
): BusinessSignals {
  const topCourse = data.courseSales[0] ?? null;
  const target = workforce?.targets.totalTarget ?? null;
  const courseTargetShare =
    topCourse && target !== null && target > 0 ? (topCourse.revenue / target) * 100 : null;
  const bestEmployee =
    [...(workforce?.agents ?? [])]
      .filter((agent) => agent.averageQualityScore !== null && (agent.analyzedCalls ?? 0) > 0)
      .sort(
        (a, b) =>
          (b.averageQualityScore ?? 0) - (a.averageQualityScore ?? 0) ||
          (b.analyzedCalls ?? 0) - (a.analyzedCalls ?? 0),
      )[0] ?? null;

  let risk: BusinessSignals["risk"];
  if (data.fetchErrors.length || data.staleTabs.length) {
    // This card used to print the raw connector errors — "Archived Lost
    // unavailable: direct Odoo is not configured or could not be reached" —
    // into an executive summary. The count and the consequence are what a
    // reader here can act on; the connector names are stated in full in the
    // data-health card at the foot of the page.
    const affected = data.fetchErrors.length + data.staleTabs.length;
    risk = {
      title: lang === "ar" ? "بيانات تحتاج مراجعة" : "Data needs review",
      detail:
        lang === "ar"
          ? `${affected} من المصادر لم تُحدَّث بعد. راجع بطاقة صحة البيانات أسفل الصفحة قبل اتخاذ قرار مالي.`
          : `${affected} source${affected === 1 ? " has" : "s have"} not refreshed. Check the data-health card at the foot of the page before making a budget call.`,
    };
  } else if (data.leak) {
    risk = {
      title: data.leak.name || (lang === "ar" ? "حملة عالية المخاطرة" : "High-risk campaign"),
      detail:
        lang === "ar"
          ? `صرف ${fmtUSD(data.leak.spend)} مقابل ${fmtUSD(data.leak.revenue)} إيراد مرتبط.`
          : `${fmtUSD(data.leak.spend)} spend versus ${fmtUSD(data.leak.revenue)} linked revenue.`,
    };
  } else if ((data.totals.lostRate ?? 0) >= 35) {
    risk = {
      title: lang === "ar" ? "نسبة Lost مرتفعة" : "High Lost rate",
      detail: `${fmtPct(data.totals.lostRate, 1)} · ${fmtNum(data.totals.lost)} ${lang === "ar" ? "ليد" : "leads"}`,
    };
  } else {
    risk = {
      title: lang === "ar" ? "لا يوجد إنذار حرج ظاهر" : "No critical alert detected",
      detail:
        lang === "ar"
          ? "استمر في مراقبة الصرف وجودة الليد يوميًا."
          : "Keep monitoring spend and lead quality daily.",
    };
  }

  let decision: BusinessSignals["decision"];
  if (data.fetchErrors.length || data.staleTabs.length) {
    decision = {
      title:
        lang === "ar"
          ? "ثبّت مصادر الداتا قبل تغيير الميزانية"
          : "Stabilize data before changing budget",
      detail:
        lang === "ar"
          ? "القرار المالي المبني على مصدر ناقص أو نسخة قديمة قد يكون مضللاً؛ راجع المصادر المتأثرة أولاً."
          : "A budget decision based on missing or stale sources can mislead; fix the affected feeds first.",
      href: "/guide",
    };
  } else if (data.leak && data.leak.spend > data.leak.revenue) {
    decision = {
      title:
        lang === "ar" ? `راجع أو خفّض ${data.leak.name}` : `Review or reduce ${data.leak.name}`,
      detail:
        lang === "ar"
          ? "الحملة تصرف أكثر من الإيراد المرتبط بها في الفترة. افحص جودة الليد والتتبع قبل ضخ ميزانية إضافية."
          : "This campaign spends more than its linked revenue. Audit lead quality and attribution before adding budget.",
      href: "/campaigns",
    };
  } else if ((data.totals.lostRate ?? 0) >= 35) {
    decision = {
      title:
        lang === "ar"
          ? "الأولوية لتحسين المتابعة لا لزيادة الصرف"
          : "Prioritize follow-up before more spend",
      detail:
        lang === "ar"
          ? "نسبة Lost الحالية تشير أن تحسين سرعة وجودة المتابعة قد يحقق نتيجة أكبر من توسيع الحملات."
          : "The current Lost rate suggests follow-up quality can create more value than campaign expansion.",
      href: "/lost",
    };
  } else if (data.best) {
    decision = {
      title:
        lang === "ar"
          ? `اختبر زيادة منضبطة لـ ${data.best.name}`
          : `Test a controlled increase for ${data.best.name}`,
      detail:
        lang === "ar"
          ? "ابدأ بزيادة 10–15% مع مراقبة CPL وجودة الليد، ولا تعتبر ROAS وحده ضمانًا للاستمرار."
          : "Start with a 10–15% increase while watching CPL and lead quality; ROAS alone is not a guarantee.",
      href: "/campaigns",
    };
  } else {
    decision = {
      title:
        lang === "ar"
          ? "اجمع عينة أكبر قبل تغيير الخطة"
          : "Collect a larger sample before changing course",
      detail:
        lang === "ar"
          ? "لا توجد حملة مؤهلة بما يكفي لقرار توسّع أو إيقاف موثوق في الفترة الحالية."
          : "No campaign has enough reliable evidence for a scale-or-stop decision in this period.",
      href: "/campaigns",
    };
  }

  return {
    topCourse,
    courseTargetShare,
    targetComplete: workforce?.targets.complete ?? false,
    bestEmployee,
    bestCampaign: data.best,
    risk,
    decision,
  };
}
/* ---------------------------------------------------------------------------
   THE READINGS, AND WHY EACH ONE WAS CHOSEN

   An insight that cannot be opened is an assertion. Each of the three cards
   below carries the same drill-down every KPI does — what the verdict is, which
   figures produced it, what it means for the reader, and where the underlying
   report lives — because "CFM produced the most revenue" is only useful if the
   reader can see how far ahead it was and what it was measured against.
--------------------------------------------------------------------------- */

export function insightDetails(
  data: OverviewResp,
  signals: BusinessSignals,
  workforce: AgentAnalyticsResult | undefined,
  lang: "ar" | "en",
): { best: MetricDetail; risk: MetricDetail; decision: MetricDetail } {
  const A = lang === "ar";
  const T = data.totals;
  const course = signals.topCourse;
  const runnerUp = data.courseSales[1] ?? null;

  const best: MetricDetail = {
    id: "overview.revenue",
    title: course
      ? A
        ? `أعلى دورة إيرادًا: ${course.course}`
        : `Top course by revenue: ${course.course}`
      : A
        ? "لا توجد مبيعات دورات مصنّفة"
        : "No classified course sales",
    value: course ? fmtUSD(course.revenue) : "—",
    tone: "mint",
    icon: <Crown size={16} />,
    definition: course
      ? A
        ? `اختيرت هذه الدورة لأنها صاحبة أعلى إيراد محصّل في الفترة: ${fmtUSD(course.revenue)} من ${fmtNum(course.paidInvoices)} فاتورة مدفوعة، أي ${fmtPct(course.contribution, 1)} من إيراد الدورات المصنّف.`
        : `This course is named because it collected the most in the period: ${fmtUSD(course.revenue)} across ${fmtNum(course.paidInvoices)} paid invoices — ${fmtPct(course.contribution, 1)} of classified course revenue.`
      : A
        ? "لا توجد فاتورة مدفوعة في هذه الفترة يمكن نسبتها إلى دورة مصنّفة، فلا توجد دورة تتصدر."
        : "No paid invoice in this period maps to a classified course, so no course leads.",
    formula: course
      ? A
        ? "المساهمة = إيراد الدورة ÷ إجمالي إيراد الدورات المصنّف داخل الفترة."
        : "Contribution = course revenue ÷ classified course revenue inside the window."
      : undefined,
    supporting: course
      ? [
          {
            key: "revenue",
            label: A ? "إيراد الدورة" : "Course revenue",
            value: fmtUSD(course.revenue),
          },
          {
            key: "invoices",
            label: A ? "فواتير مدفوعة" : "Paid invoices",
            value: fmtNum(course.paidInvoices),
          },
          {
            key: "avg",
            label: A ? "متوسط سعر البيع" : "Average sale price",
            value: fmtUSDFull(course.averageSalePrice),
          },
          {
            key: "gap",
            label: A ? "الفارق عن التالية" : "Lead over the runner-up",
            value: runnerUp ? fmtUSD(course.revenue - runnerUp.revenue) : "—",
            hint: runnerUp?.course,
          },
        ]
      : undefined,
    breakdowns: [
      {
        id: "courses",
        title: A ? "ترتيب الدورات بالإيراد" : "Courses ranked by revenue",
        rows: data.courseSales.slice(0, 5).map((row) => ({
          key: row.course,
          label: row.course,
          value: row.revenue,
          display: fmtUSD(row.revenue),
          meta: fmtPct(row.contribution, 1),
          tone: "mint" as const,
        })),
        moreTo: "/courses",
        moreLabel: A ? "عرض كل الدورات" : "View every course",
        emptyLabel: A ? "لا توجد مبيعات دورات مصنّفة" : "No classified course sales",
      },
    ],
    report: { to: "/courses", label: A ? "فتح تقرير الدورات" : "Open the courses report" },
  };

  const feeds = data.fetchErrors.length + data.staleTabs.length;
  const risk: MetricDetail = {
    id: "overview.risk",
    title: signals.risk.title,
    value: feeds
      ? `${fmtNum(feeds)} ${A ? "مصدر" : feeds === 1 ? "source" : "sources"}`
      : data.leak
        ? fmtUSD(data.leak.spend - data.leak.revenue)
        : fmtPct(T.lostRate, 1),
    tone: "rose",
    icon: <AlertTriangle size={16} />,
    definition: signals.risk.detail,
    caveat: feeds
      ? A
        ? "الأرقام في هذه الصفحة لا تشمل ما لم يُحمَّل، فأي قرار ميزانية الآن مبني على صورة ناقصة."
        : "The figures on this page exclude whatever failed to load, so any budget call made now rests on a partial picture."
      : undefined,
    supporting: data.leak
      ? [
          { key: "spend", label: A ? "أنفقت" : "Spent", value: fmtUSD(data.leak.spend) },
          {
            key: "revenue",
            label: A ? "أعادت" : "Returned",
            value: fmtUSD(data.leak.revenue),
          },
          {
            key: "leads",
            label: A ? "عملاء أنتجتهم" : "Leads produced",
            value: fmtNum(data.leak.crmLeads),
          },
          { key: "roas", label: A ? "العائد" : "Return", value: fmtRoas(data.leak.roas) },
        ]
      : [
          { key: "lost", label: A ? "صفقات ضائعة" : "Lost deals", value: fmtNum(T.lost) },
          { key: "rate", label: A ? "نسبة الخسارة" : "Lost rate", value: fmtPct(T.lostRate, 1) },
          { key: "won", label: A ? "صفقات رابحة" : "Won deals", value: fmtNum(T.won) },
          { key: "leads", label: A ? "إجمالي العملاء" : "All leads", value: fmtNum(T.totalLeads) },
        ],
    breakdowns: data.topLeaks.length
      ? [
          {
            id: "leaks",
            title: A
              ? "الحملات التي أنفقت أكثر مما أعادت"
              : "Campaigns that spent more than they returned",
            rows: data.topLeaks.slice(0, 5).map((row) => ({
              key: row.key,
              label: row.name,
              value: row.spend - row.revenue,
              display: fmtUSD(row.spend - row.revenue),
              meta: `${fmtUSD(row.spend)} → ${fmtUSD(row.revenue)}`,
              tone: "rose" as const,
            })),
            moreTo: "/campaigns",
            moreLabel: A ? "عرض كل الحملات" : "View every campaign",
          },
        ]
      : undefined,
    records:
      data.fetchErrors.length || data.staleTabs.length
        ? {
            title: A ? "المصادر المتأثرة" : "Affected sources",
            hint: A
              ? "التفاصيل الكاملة في بطاقة صحة البيانات أسفل الصفحة."
              : "The full statement is in the data-health card at the foot of the page.",
            rows: [
              ...data.fetchErrors.slice(0, 3).map((error, index) => ({
                key: `err-${index}`,
                title: error,
                subtitle: A ? "لم يُحمَّل في هذه الجلسة" : "Did not load in this session",
              })),
              ...data.staleTabs.slice(0, 2).map((tab, index) => ({
                key: `stale-${index}`,
                title: tab,
                subtitle: A ? "يُعرض من آخر نسخة ناجحة" : "Served from the last good copy",
              })),
            ],
          }
        : undefined,
    report: feeds
      ? { to: "/guide", label: A ? "فتح دليل المصادر" : "Open the source guide" }
      : { to: "/campaigns", label: A ? "فتح تقرير الحملات" : "Open the campaigns report" },
  };

  const decision: MetricDetail = {
    id: "overview.decision",
    title: signals.decision.title,
    value: A ? "قرار مقترح" : "Recommended",
    tone: "sky",
    icon: <Lightbulb size={16} />,
    definition: signals.decision.detail,
    formula: A
      ? "القرار مبني على ثلاثة فحوص بالترتيب: سلامة المصادر، ثم وجود حملة تنفق أكثر مما تعيد، ثم نسبة الخسارة."
      : "The recommendation runs three checks in order: source health, then any campaign spending more than it returns, then the lost rate.",
    supporting: [
      { key: "roas", label: A ? "العائد الحالي" : "Current return", value: fmtRoas(T.roas) },
      { key: "spend", label: A ? "الإنفاق" : "Spend", value: fmtUSD(T.spend) },
      { key: "lostRate", label: A ? "نسبة الخسارة" : "Lost rate", value: fmtPct(T.lostRate, 1) },
      {
        key: "sources",
        label: A ? "مصادر تحتاج مراجعة" : "Sources needing review",
        value: fmtNum(feeds),
      },
    ],
    breakdowns: signals.bestCampaign
      ? [
          {
            id: "best",
            title: A ? "الحملات المرشّحة للتوسّع" : "Campaigns worth scaling",
            hint: A
              ? "الأعلى عائدًا في الفترة. العائد وحده ليس ضمانًا؛ راقب التكلفة وجودة الليد."
              : "Highest return in the period. Return alone is not a guarantee; watch cost and lead quality.",
            rows: data.topByROAS.slice(0, 5).map((row) => ({
              key: row.key,
              label: row.name,
              value: row.roas ?? 0,
              display: fmtRoas(row.roas),
              meta: `${fmtUSD(row.spend)} → ${fmtUSD(row.revenue)}`,
              tone: "mint" as const,
            })),
            moreTo: "/campaigns",
            moreLabel: A ? "عرض كل الحملات" : "View every campaign",
          },
        ]
      : undefined,
    report: {
      to: signals.decision.href,
      label: A ? "فتح التحليل الكامل" : "Open the full analysis",
    },
  };

  void workforce;
  return { best, risk, decision };
}
