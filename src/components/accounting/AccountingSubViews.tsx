import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { TargetEditor } from "@/components/accounting/TargetEditor";
import { EmployeeMetricInfo } from "@/components/accounting/EmployeeMetricInfo";
import { MiniMetric } from "@/components/accounting/MiniMetric";
import { monthLabel } from "@/components/accounting/accounting-format";
import {
  UncalledLeadsDialog,
  type UncalledScope,
} from "@/components/accounting/UncalledLeadsDialog";
import type { EmployeeMetricKey } from "@/lib/employee-metric-catalog";
import {
  ArrowUpRight,
  AudioLines,
  Calculator,
  ChartNoAxesCombined,
  CheckCircle2,
  ChevronDown,
  CircleGauge,
  Clock3,
  ExternalLink,
  FileAudio,
  Info,
  Layers3,
  PhoneCall,
  ReceiptText,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { DonutChart, HBarChart, MultiLineChart } from "@/components/charts";
import {
  Card,
  ErrorState,
  KpiCard,
  Notice,
  Pill,
  SectionTitle,
  Segmented,
  Skeleton,
} from "@/components/ui-bits";
import { KpiRow } from "@/components/dashboard-bits";
import { MetricDetailTrigger, MetricDrilldown } from "@/components/metric-detail";
import { topRows, type MetricBreakdownRow, type MetricDetail } from "@/lib/metric-detail";
import { fmtNum, fmtPct, fmtUSDExact, fmtUSDFull, useI18n, type Lang } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import { filterStore, useFilters } from "@/lib/filter-store";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  AgentAnalyticsResult as AgentsResponse,
  AgentAnalyticsRow as AgentRow,
  AgentCourseInvoice,
  AgentCoursePerformance,
  AgentSpecializationPerformance,
  AgentTarget,
} from "@/lib/agent-analytics.server";
import type { CallsHubCall, CallsHubEmployeeCalls } from "@/lib/calls-hub.server";
import {
  buildTargetUnitRollup,
  type TargetLeaderRollup,
  type TargetUnitMember,
  type TargetUnitRollup,
} from "@/lib/target-units";
import {
  useRegisterNexusEntity,
  useRegisterNexusView,
} from "@/components/engo-nexus/state/nexus-view-context";

const QUALITY_REVIEW_THRESHOLD = 85;

interface EmployeeEvidenceResponse {
  ok: boolean;
  employee: string;
  range: { from: string; to: string };
  leads: {
    rows: Array<{
      id: string;
      contact: string;
      phone: string;
      stage: string;
      course: string;
      createdAt: string;
      outcome: "won" | "open" | "lost";
      url: string | null;
      calledByAny: boolean;
      calledByOwner: boolean;
      totalCalls: number;
      ownerCalls: number;
      firstCallAt: string | null;
      latestCallAt: string | null;
      latestCallUrl: string | null;
    }>;
    total: number;
    truncated: boolean;
  };
  orders: {
    rows: Array<{
      orderRef: string;
      customer: string;
      course: string;
      revenueDate: string;
      usdSales: number;
    }>;
    total: number;
    truncated: boolean;
    amount: number;
  };
  invoices: {
    rows: Array<{
      movement: string;
      partner: string;
      paymentDate: string;
      usdPaid: number;
      isCreditNote: boolean;
    }>;
    total: number;
    truncated: boolean;
    paidTotal: number;
    creditNoteTotal: number;
    amount: number;
  };
  chatwoot: null | {
    agentId: number;
    total: number;
    conversations: Array<{
      id: number;
      contactName: string;
      status: string;
      unreadMessages: number;
      awaitingReply: boolean;
      lastActivityAt: number;
      url: string;
    }>;
  };
  chatwootError: string | null;
}

type EmployeeEvidenceKind = "target" | "sales" | "leads" | "calls" | "chatwoot";

const EmployeeEvidenceContext = createContext<{
  openEvidence: (kind: EmployeeEvidenceKind) => void;
} | null>(null);

function evidenceKindFromHref(href: string): EmployeeEvidenceKind | null {
  if (href.includes("target")) return "target";
  if (href.includes("sales")) return "sales";
  if (href.includes("lead")) return "leads";
  if (href.includes("call")) return "calls";
  if (href.includes("chat")) return "chatwoot";
  return null;
}

export interface AccountingMonth {
  month: string;
  revenue: number;
  invoices: number;
  creditNotes: number;
  creditNoteUsd: number;
  productLines: number;
  averageInvoice: number | null;
  growthPct: number | null;
}

interface ProfitabilityResponse {
  status: "ready" | "refreshing" | "loading" | "error";
  error?: string;
  snapshot: {
    from: string;
    to: string;
    currency: string;
    postedOnly: true;
    companies: { id: number; name: string }[];
    netProfit: number | null;
    income: number | null;
    grossProfit: number | null;
    operatingIncome: number | null;
    otherIncome: number | null;
    costOfRevenue: number | null;
    expenses: number | null;
    depreciation: number | null;
    lines: { id: string; label: string; value: number; level: number }[];
    fetchedAt: string;
  } | null;
}

const localMoney = (value: number | null, currency = "LE") =>
  value === null || !Number.isFinite(value)
    ? "—"
    : `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

/** The month-by-month figures, and the months behind each. */
function monthlyMetrics(
  monthly: AccountingMonth[],
  latest: AccountingMonth | undefined,
  previous: AccountingMonth | undefined,
  lang: Lang,
): Record<string, MetricDetail> {
  const A = lang === "ar";
  const months = (
    pick: (row: AccountingMonth) => number,
    format: (n: number) => string,
    tone: MetricBreakdownRow["tone"],
  ): MetricBreakdownRow[] =>
    topRows(
      monthly.map((row) => ({
        key: row.month,
        label: monthLabel(row.month, lang),
        value: pick(row),
        display: format(pick(row)),
        tone,
      })),
      6,
    );
  const monthName = latest ? monthLabel(latest.month, lang) : "—";
  const previousName = previous ? monthLabel(previous.month, lang) : "—";

  return {
    revenue: {
      id: "accounting.monthRevenue",
      title: A ? "تحصيل آخر شهر" : "Latest month collections",
      value: fmtUSDExact(latest?.revenue ?? null),
      tone: "mint",
      definition: A
        ? `ما حُصّل فعليًا في ${monthName}. كل شهر يُقارن بالشهر الذي يسبقه مباشرة، لا بمتوسط السنة.`
        : `What was actually collected in ${monthName}. Each month is compared with the one directly before it, never with a yearly average.`,
      formula: A
        ? `${fmtUSDExact(latest?.revenue ?? null)} في ${monthName} مقابل ${fmtUSDExact(previous?.revenue ?? null)} في ${previousName}.`
        : `${fmtUSDExact(latest?.revenue ?? null)} in ${monthName} against ${fmtUSDExact(previous?.revenue ?? null)} in ${previousName}.`,
      supporting: [
        {
          key: "invoices",
          label: A ? "الفواتير" : "Invoices",
          value: fmtNum(latest?.invoices ?? 0),
        },
        {
          key: "growth",
          label: A ? "النمو الشهري" : "Month-over-month",
          value: fmtPct(latest?.growthPct ?? null, 1),
        },
        {
          key: "previous",
          label: previousName,
          value: fmtUSDExact(previous?.revenue ?? null),
        },
        { key: "months", label: A ? "شهور معروضة" : "Months shown", value: fmtNum(monthly.length) },
      ],
      breakdowns: [
        {
          id: "months",
          title: A ? "التحصيل شهرًا بشهر" : "Collections month by month",
          rows: months((row) => row.revenue, fmtUSDExact, "mint"),
          emptyLabel: A ? "لا توجد شهور" : "No months",
        },
      ],
    },
    invoices: {
      id: "accounting.monthInvoices",
      title: A ? "فواتير آخر شهر" : "Latest month invoices",
      value: fmtNum(latest?.invoices ?? 0),
      tone: "violet",
      definition: A
        ? `عدد الفواتير المدفوعة المميزة في ${monthName}.`
        : `Distinct paid invoices in ${monthName}.`,
      formula: A
        ? `${fmtNum(latest?.invoices ?? 0)} فاتورة بقيمة ${fmtUSDExact(latest?.revenue ?? null)}.`
        : `${fmtNum(latest?.invoices ?? 0)} invoices worth ${fmtUSDExact(latest?.revenue ?? null)}.`,
      supporting: [
        {
          key: "revenue",
          label: A ? "التحصيل" : "Collections",
          value: fmtUSDExact(latest?.revenue ?? null),
        },
        {
          key: "previous",
          label: previousName,
          value: fmtNum(previous?.invoices ?? 0),
        },
        {
          key: "credits",
          label: A ? "إشعارات خصم" : "Credit notes",
          value: fmtNum(latest?.creditNotes ?? 0),
        },
        { key: "months", label: A ? "شهور معروضة" : "Months shown", value: fmtNum(monthly.length) },
      ],
      breakdowns: [
        {
          id: "months",
          title: A ? "الفواتير شهرًا بشهر" : "Invoices month by month",
          rows: months((row) => row.invoices, fmtNum, "violet"),
          emptyLabel: A ? "لا توجد شهور" : "No months",
        },
      ],
    },
    growth: {
      id: "accounting.monthGrowth",
      title: A ? "النمو الشهري" : "Month-over-month growth",
      value: fmtPct(latest?.growthPct ?? null, 1),
      tone: "amber",
      definition: A
        ? `تغيّر التحصيل في ${monthName} مقابل ${previousName}. لا تُعرض نسبة أمام أساس صفري، لأنها بلا معنى.`
        : `The change in collections in ${monthName} against ${previousName}. No percentage is shown against a zero baseline — it would be meaningless.`,
      formula: A
        ? `(${fmtUSDExact(latest?.revenue ?? null)} − ${fmtUSDExact(previous?.revenue ?? null)}) ÷ ${fmtUSDExact(previous?.revenue ?? null)}.`
        : `(${fmtUSDExact(latest?.revenue ?? null)} − ${fmtUSDExact(previous?.revenue ?? null)}) ÷ ${fmtUSDExact(previous?.revenue ?? null)}.`,
      supporting: [
        { key: "latest", label: monthName, value: fmtUSDExact(latest?.revenue ?? null) },
        { key: "previous", label: previousName, value: fmtUSDExact(previous?.revenue ?? null) },
        {
          key: "difference",
          label: A ? "الفارق" : "Difference",
          value: fmtUSDExact((latest?.revenue ?? 0) - (previous?.revenue ?? 0)),
        },
        {
          key: "invoices",
          label: A ? "الفواتير" : "Invoices",
          value: fmtNum(latest?.invoices ?? 0),
        },
      ],
      breakdowns: [
        {
          id: "months",
          title: A ? "النمو شهرًا بشهر" : "Growth month by month",
          rows: months(
            (row) => row.growthPct ?? 0,
            (n) => fmtPct(n, 1),
            "amber",
          ),
          emptyLabel: A ? "لا توجد شهور" : "No months",
        },
      ],
    },
    credits: {
      id: "accounting.monthCredits",
      title: A ? "إلغاءات آخر شهر" : "Latest month cancellations",
      value: fmtUSDExact(latest?.creditNoteUsd ?? null),
      tone: "rose",
      definition: A
        ? `قيمة الإلغاءات وإشعارات الخصم في ${monthName}. تظهر بالسالب في شهر تاريخ العكس، لا في شهر الفاتورة الأصلية.`
        : `The value of cancellations and credit notes in ${monthName}. They land negative in the month of the reversal, not in the month of the original invoice.`,
      formula: A
        ? `${fmtNum(latest?.creditNotes ?? 0)} إشعار بقيمة ${fmtUSDExact(latest?.creditNoteUsd ?? null)}.`
        : `${fmtNum(latest?.creditNotes ?? 0)} notes worth ${fmtUSDExact(latest?.creditNoteUsd ?? null)}.`,
      supporting: [
        {
          key: "count",
          label: A ? "عدد الإشعارات" : "Notes",
          value: fmtNum(latest?.creditNotes ?? 0),
        },
        {
          key: "revenue",
          label: A ? "التحصيل" : "Collections",
          value: fmtUSDExact(latest?.revenue ?? null),
        },
        {
          key: "previous",
          label: previousName,
          value: fmtUSDExact(previous?.creditNoteUsd ?? null),
        },
        { key: "months", label: A ? "شهور معروضة" : "Months shown", value: fmtNum(monthly.length) },
      ],
      breakdowns: [
        {
          id: "months",
          title: A ? "الإلغاءات شهرًا بشهر" : "Cancellations month by month",
          rows: months((row) => row.creditNoteUsd, fmtUSDExact, "rose"),
          emptyLabel: A ? "لا توجد شهور" : "No months",
        },
      ],
    },
  };
}

export function AccountingMonthlyView({ monthly }: { monthly: AccountingMonth[] }) {
  const { lang } = useI18n();
  const filters = useFilters();
  const dateBasis = filters.dateBasis === "invoice" ? "Invoice Date" : "Payment Date";
  const latest = monthly.at(-1);
  const previous = monthly.at(-2);
  // One description per figure, built from the months already on screen.
  const monthlyFigures = monthlyMetrics(monthly, latest, previous, lang);
  return (
    <div className="space-y-4">
      <Notice tone="info" icon={<Info size={16} />}>
        {lang === "ar"
          ? `الفواتير الموجبة حسب ${dateBasis}، والإلغاء يظهر بالسالب في شهر تاريخ العكس. كل شهر يُقارن بالشهر السابق مباشرة.`
          : `Positive invoices use ${dateBasis}; cancellations are negative in their reversal month. Each month is compared with its predecessor.`}
      </Notice>
      <KpiRow>
        <MetricDetailTrigger
          detail={monthlyFigures.revenue}
          card={{ index: 0, hero: true, valueWrap: true }}
        />
        <MetricDetailTrigger detail={monthlyFigures.invoices} card={{ index: 1 }} />
        <MetricDetailTrigger detail={monthlyFigures.growth} card={{ index: 2 }} />
        <MetricDetailTrigger
          detail={monthlyFigures.credits}
          card={{
            index: 3,
            valueWrap: true,
            sub: `${fmtNum(latest?.creditNotes ?? 0)} ${lang === "ar" ? "إشعار خصم" : "credit notes"}`,
          }}
        />
      </KpiRow>
      <Card>
        <SectionTitle>
          {lang === "ar" ? "اتجاه التحصيل وعدد الفواتير" : "Collections and invoice trend"}
        </SectionTitle>
        <MultiLineChart
          data={monthly.map((row) => ({
            date: `${row.month}-01`,
            revenue: row.revenue,
            invoices: row.invoices,
          }))}
          series={[
            {
              key: "revenue",
              name: lang === "ar" ? "التحصيل" : "Collections",
              color: "var(--chart-2)",
            },
            {
              key: "invoices",
              name: lang === "ar" ? "الفواتير" : "Invoices",
              color: "var(--chart-1)",
              axis: "right",
            },
          ]}
          format={fmtNum}
        />
      </Card>
      <Card>
        <SectionTitle>
          {lang === "ar" ? "مقارنة شهر بشهر" : "Month-by-month comparison"}
        </SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {monthly.map((row, index) => (
            <article
              key={row.month}
              className="rounded-2xl border border-border bg-surface p-4 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand/35 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-medium text-text-muted">
                    {lang === "ar" ? "الشهر" : "Month"}
                  </div>
                  <div className="mt-1 text-base font-semibold text-text">
                    {monthLabel(row.month, lang)}
                  </div>
                </div>
                <Pill
                  tone={
                    row.growthPct === null ? "neutral" : row.growthPct >= 0 ? "success" : "danger"
                  }
                >
                  {index === 0
                    ? lang === "ar"
                      ? "بداية القياس"
                      : "Baseline"
                    : fmtPct(row.growthPct, 1)}
                </Pill>
              </div>
              <div className="num mt-4 text-2xl font-semibold text-text">
                {fmtUSDExact(row.revenue)}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <MiniMetric
                  label={lang === "ar" ? "الفواتير" : "Invoices"}
                  value={fmtNum(row.invoices)}
                />
                <MiniMetric
                  label={lang === "ar" ? "متوسط الفاتورة" : "Average invoice"}
                  value={fmtUSDExact(row.averageInvoice)}
                />
              </div>
              {row.creditNotes > 0 && (
                <div className="mt-2 rounded-xl bg-danger/8 px-3 py-2 text-xs text-danger">
                  {lang === "ar" ? "إلغاءات الشهر" : "Month cancellations"}:{" "}
                  {fmtNum(row.creditNotes)} · {fmtUSDExact(row.creditNoteUsd)}
                </div>
              )}
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}

/**
 * What each figure on the employee board is made of.
 *
 * Everything comes from the `/api/teams` payload the board already renders, so
 * a manager can open "Target for period" and see the same roster the table
 * below is built from — not a second, differently-filtered answer.
 */
function agentBoardMetrics(data: AgentsResponse, lang: Lang): Record<string, MetricDetail> {
  const A = lang === "ar";
  const S = data.summary;
  const targets = data.targets;
  const agents = data.agents;

  const roster = (
    pick: (agent: AgentsResponse["agents"][number]) => number,
    format: (n: number) => string,
    tone: MetricBreakdownRow["tone"],
    source: AgentsResponse["agents"] = agents,
  ): MetricBreakdownRow[] =>
    topRows(
      source.map((agent) => ({
        key: agent.key,
        label: agent.displayName || agent.name,
        value: pick(agent),
        display: format(pick(agent)),
        meta: agent.team || undefined,
        tone,
      })),
    );

  const byTeam = (
    pick: (agent: AgentsResponse["agents"][number]) => number,
    format: (n: number) => string,
  ): MetricBreakdownRow[] => {
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
  };

  const remaining =
    targets.totalTarget === null
      ? null
      : Math.max(0, targets.totalTarget - targets.totalPaidRevenue);

  return {
    employees: {
      id: "teams.employees",
      title: A ? "الموظفون" : "Active employees",
      value: fmtNum(S.agents),
      tone: "sky",
      icon: <Users size={16} />,
      definition: A
        ? "الموظفون الذين لديهم نشاط في الفترة: فاتورة، أو ليد مسند، أو مكالمة."
        : "Employees with activity in the period: an invoice, an assigned lead, or a call.",
      formula: A
        ? `${fmtNum(S.agents)} موظفًا، منهم ${fmtNum(targets.matched)} لديهم تارجت منشور.`
        : `${fmtNum(S.agents)} employees, of whom ${fmtNum(targets.matched)} have a published target.`,
      supporting: [
        {
          key: "targeted",
          label: A ? "لهم تارجت" : "With a target",
          value: fmtNum(targets.matched),
        },
        {
          key: "untargeted",
          label: A ? "بلا تارجت" : "Without a target",
          value: fmtNum(targets.untargeted.length),
        },
        { key: "leads", label: A ? "ليدز الفترة" : "Leads in period", value: fmtNum(S.cleanLeads) },
        { key: "won", label: A ? "صفقات رابحة" : "Won", value: fmtNum(S.won) },
      ],
      breakdowns: [
        {
          id: "teams",
          title: A ? "التحصيل حسب الفريق" : "Collections by team",
          rows: byTeam((agent) => agent.paidRevenue, fmtUSDFull),
          emptyLabel: A ? "لا توجد فرق بتحصيل" : "No team collected",
        },
      ],
      records: targets.untargeted.length
        ? {
            title: A ? "يبيعون بلا تارجت منشور" : "Selling with no published target",
            hint: A
              ? "يظهرون في التحصيل ولا يدخلون في نسبة الإنجاز."
              : "They appear in collections and not in the achievement percentage.",
            rows: targets.untargeted.slice(0, 5).map((person) => ({
              key: person.name,
              title: person.name,
              value: fmtUSDFull(person.paidRevenue),
            })),
          }
        : undefined,
    },
    collections: {
      id: "teams.revenue",
      title: A ? "التحصيل" : "Paid collections",
      value: fmtUSDFull(S.paidRevenue),
      tone: "mint",
      icon: <ReceiptText size={16} />,
      definition: A
        ? "ما حصّله الموظفون فعليًا من فواتير مدفوعة داخل الفترة، منسوبًا إلى الموظف المسؤول عن الفاتورة."
        : "What employees actually collected from paid invoices inside the period, attributed to the invoice's owner.",
      formula: A
        ? `${fmtUSDFull(S.paidRevenue)} من ${fmtNum(S.invoices)} فاتورة.`
        : `${fmtUSDFull(S.paidRevenue)} across ${fmtNum(S.invoices)} invoices.`,
      supporting: [
        { key: "invoices", label: A ? "الفواتير" : "Invoices", value: fmtNum(S.invoices) },
        {
          key: "target",
          label: A ? "التارجت" : "Target",
          value: targets.totalTarget === null ? "—" : fmtUSDFull(targets.totalTarget),
        },
        {
          key: "achievement",
          label: A ? "نسبة الإنجاز" : "Achievement",
          value: fmtPct(targets.totalAchievementPaid, 1),
        },
        { key: "won", label: A ? "صفقات رابحة" : "Won deals", value: fmtNum(S.won) },
      ],
      breakdowns: [
        {
          id: "employees",
          title: A ? "أعلى الموظفين تحصيلًا" : "Top employees by collection",
          rows: roster((agent) => agent.paidRevenue, fmtUSDFull, "mint"),
          emptyLabel: A ? "لا يوجد تحصيل في الفترة" : "Nothing collected in this period",
        },
        {
          id: "teams",
          title: A ? "حسب الفريق" : "By team",
          rows: byTeam((agent) => agent.paidRevenue, fmtUSDFull),
          emptyLabel: A ? "لا توجد فرق بتحصيل" : "No team collected",
        },
      ],
      report: { to: "/accounting", label: A ? "فتح تقرير الحسابات" : "Open the Accounting report" },
    },
    target: {
      id: "teams.target",
      title: A ? "التارجت" : "Target for period",
      value: targets.totalTarget === null ? "—" : fmtUSDFull(targets.totalTarget),
      tone: "amber",
      icon: <Target size={16} />,
      definition: A
        ? "مجموع الحصص المنشورة للموظفين الظاهرين في هذه الفترة، محسوبة بالتناسب: نصف شهر يعني نصف الحصة."
        : "The published quotas of the employees present in this window, prorated: half a month means half the quota.",
      formula:
        targets.totalTarget === null
          ? A
            ? "لا يوجد تارجت منشور لهذه الفترة، ولذلك لا تُحسب نسبة إنجاز."
            : "No target is published for this window, so no achievement percentage is computed."
          : A
            ? `${fmtUSDFull(targets.totalPaidRevenue)} محقق ÷ ${fmtUSDFull(targets.totalTarget)} تارجت = ${fmtPct(targets.totalAchievementPaid, 1)}.`
            : `${fmtUSDFull(targets.totalPaidRevenue)} achieved ÷ ${fmtUSDFull(targets.totalTarget)} target = ${fmtPct(targets.totalAchievementPaid, 1)}.`,
      caveat: targets.complete
        ? undefined
        : A
          ? `الفترة تمتد على ${targets.monthsMissing.length} شهرًا بلا تارجت منشور، فالنسبة محسوبة على جزء من المدة فقط.`
          : `The window spans ${targets.monthsMissing.length} month(s) with no published target, so the percentage covers part of the period only.`,
      supporting: [
        {
          key: "achieved",
          label: A ? "المحقق" : "Achieved",
          value: fmtUSDFull(targets.totalPaidRevenue),
        },
        {
          key: "remaining",
          label: A ? "المتبقي" : "Remaining",
          value: remaining === null ? "—" : fmtUSDFull(remaining),
        },
        {
          key: "achievement",
          label: A ? "نسبة الإنجاز" : "Achievement",
          value: fmtPct(targets.totalAchievementPaid, 1),
        },
        {
          key: "matched",
          label: A ? "موظفون لهم تارجت" : "Employees with a target",
          value: fmtNum(targets.matched),
        },
      ],
      breakdowns: [
        {
          id: "employees",
          title: A ? "المشاركون في التارجت" : "Who the target is shared between",
          rows: roster(
            (agent) => agent.paidRevenue,
            fmtUSDFull,
            "amber",
            agents.filter((agent) => agent.target?.target !== null),
          ),
          emptyLabel: A ? "لا يوجد موظفون في الفترة" : "No employees in this period",
        },
      ],
      records: targets.unmatched.length
        ? {
            title: A ? "تارجت بلا موظف مطابق" : "Targets with no matching employee",
            hint: A
              ? "إما أن الشخص لم ينتج شيئًا في الفترة، أو أن اسمه مكتوب بشكل مختلف في المصدر."
              : "Either the person produced nothing this period, or their name is spelled differently upstream.",
            rows: targets.unmatched.slice(0, 5).map((row) => ({
              key: row.employeeId || row.name,
              title: row.name,
              subtitle: row.teamLeader || undefined,
              value: row.target === null ? "—" : fmtUSDFull(row.target),
            })),
          }
        : undefined,
    },
    leads: {
      id: "teams.leads",
      title: A ? "الليدز الجديدة" : "Leads created in period",
      value: fmtNum(S.cleanLeads),
      tone: "sky",
      icon: <UserRound size={16} />,
      definition: A
        ? "العملاء الذين أُنشئوا داخل الفترة وأُسندوا إلى موظف. المتابعة الهاتفية عليهم هي ما يقيسه العمود المجاور."
        : "Leads created inside the window and assigned to an employee. The phone follow-up on them is what the next figure measures.",
      formula: A
        ? `${fmtNum(S.won)} من ${fmtNum(S.cleanLeads)} تحوّلوا إلى صفقات رابحة = ${fmtPct(S.conversionRate, 1)}.`
        : `${fmtNum(S.won)} of ${fmtNum(S.cleanLeads)} became won = ${fmtPct(S.conversionRate, 1)}.`,
      supporting: [
        { key: "won", label: A ? "تم كسبها" : "Became won", value: fmtNum(S.won) },
        { key: "lost", label: A ? "ضائعة" : "Lost", value: fmtNum(S.lost) },
        {
          key: "uncalled",
          label: A ? "لم يتم الاتصال بهم" : "Never called",
          value: S.uncalledDistributedLeads === null ? "—" : fmtNum(S.uncalledDistributedLeads),
        },
        {
          key: "conversion",
          label: A ? "معدل التحويل" : "Conversion",
          value: fmtPct(S.conversionRate, 1),
        },
      ],
      breakdowns: [
        {
          id: "employees",
          title: A ? "حسب الموظف" : "By employee",
          rows: roster((agent) => agent.cleanLeads, fmtNum, "sky"),
          emptyLabel: A ? "لا توجد ليدز في الفترة" : "No leads in this period",
        },
        {
          id: "uncalled",
          title: A ? "ليدز بلا اتصال، حسب الموظف" : "Never-called leads by employee",
          rows: roster((agent) => agent.uncalledDistributedLeads ?? 0, fmtNum, "rose"),
          emptyLabel: A ? "كل الليدز الموزّعة تم الاتصال بها" : "Every distributed lead was called",
        },
      ],
      report: { to: "/leads", label: A ? "فتح تقرير العملاء" : "Open the leads report" },
    },
    closures: {
      id: "teams.won",
      title: A ? "الصفقات الرابحة" : "Won closures during period",
      value: fmtNum(S.periodClosedWon),
      tone: "violet",
      icon: <Trophy size={16} />,
      definition: A
        ? "الصفقات التي أُغلقت داخل الفترة، بصرف النظر عن تاريخ إنشاء العميل. هذا مقياس عمل الفترة، لا مقياس جودة كوهورت الليدز."
        : "Deals closed inside the window, whatever the lead's creation date. This measures the period's work, not the quality of the period's lead cohort.",
      formula: A
        ? `${fmtNum(S.periodClosedWon)} رابحة و${fmtNum(S.periodClosedLost)} خاسرة = ${fmtPct(S.decidedConversionRate, 1)} من الصفقات المحسومة.`
        : `${fmtNum(S.periodClosedWon)} won and ${fmtNum(S.periodClosedLost)} lost = ${fmtPct(S.decidedConversionRate, 1)} of decided deals.`,
      supporting: [
        { key: "lost", label: A ? "خاسرة" : "Lost", value: fmtNum(S.periodClosedLost) },
        {
          key: "decided",
          label: A ? "تحويل الصفقات المحسومة" : "Decided conversion",
          value: fmtPct(S.decidedConversionRate, 1),
        },
        { key: "cohortWon", label: A ? "كوهورت الفترة" : "Cohort won", value: fmtNum(S.won) },
        { key: "revenue", label: A ? "التحصيل" : "Collections", value: fmtUSDFull(S.paidRevenue) },
      ],
      breakdowns: [
        {
          id: "employees",
          title: A ? "حسب الموظف" : "By employee",
          rows: roster((agent) => agent.won, fmtNum, "violet"),
          emptyLabel: A ? "لا توجد صفقات في الفترة" : "No deals closed in this period",
        },
        {
          id: "teams",
          title: A ? "حسب الفريق" : "By team",
          rows: byTeam((agent) => agent.won, fmtNum),
          emptyLabel: A ? "لا توجد فرق أغلقت صفقات" : "No team closed a deal",
        },
      ],
    },
    calls: {
      id: "teams.calls",
      title: A ? "المكالمات" : "Total calls",
      value: S.outboundCalls === null ? "—" : fmtNum(S.outboundCalls),
      tone: "cyan",
      icon: <PhoneCall size={16} />,
      definition: A
        ? "المكالمات الصادرة من مقاسم Yeastar داخل الفترة، منسوبة إلى الموظف صاحب التحويلة."
        : "Outbound calls from the Yeastar extensions inside the period, attributed to the extension's owner.",
      formula:
        S.answeredCalls === null
          ? A
            ? "لا توجد بيانات مكالمات لهذه الفترة."
            : "No call data for this window."
          : A
            ? `${fmtNum(S.answeredCalls)} مردود عليها من ${fmtNum(S.outboundCalls ?? 0)} = ${fmtPct(S.answerRate, 1)}.`
            : `${fmtNum(S.answeredCalls)} answered of ${fmtNum(S.outboundCalls ?? 0)} = ${fmtPct(S.answerRate, 1)}.`,
      supporting: [
        {
          key: "answered",
          label: A ? "مردود عليها" : "Answered",
          value: S.answeredCalls === null ? "—" : fmtNum(S.answeredCalls),
        },
        { key: "rate", label: A ? "نسبة الرد" : "Answer rate", value: fmtPct(S.answerRate, 1) },
        {
          key: "leads",
          label: A ? "ليدز موزّعة" : "Distributed leads",
          value: fmtNum(S.distributedLeads),
        },
        {
          key: "uncalled",
          label: A ? "لم يتم الاتصال بهم" : "Never called",
          value: S.uncalledDistributedLeads === null ? "—" : fmtNum(S.uncalledDistributedLeads),
        },
      ],
      breakdowns: [
        {
          id: "employees",
          title: A ? "حسب الموظف" : "By employee",
          rows: roster((agent) => agent.outboundCalls ?? 0, fmtNum, "cyan"),
          emptyLabel: A ? "لا توجد مكالمات في الفترة" : "No calls in this period",
        },
      ],
    },
    callTime: {
      id: "teams.callTime",
      title: A ? "وقت المكالمات" : "Call hours",
      value: formatCallHours(S.totalCallSeconds, lang),
      tone: "cyan",
      icon: <Clock3 size={16} />,
      definition: A
        ? "إجمالي زمن المكالمات في الفترة. وقت التحدث هو الجزء الذي رُد فيه فعلًا؛ الفرق بينهما هو الرنين والانتظار."
        : "Total call time in the period. Talk time is the part that was actually answered; the difference is ringing and waiting.",
      formula: A
        ? `وقت التحدث ${formatCallHours(S.talkSeconds, lang)} من إجمالي ${formatCallHours(S.totalCallSeconds, lang)}.`
        : `${formatCallHours(S.talkSeconds, lang)} of talk time within ${formatCallHours(S.totalCallSeconds, lang)} total.`,
      supporting: [
        {
          key: "talk",
          label: A ? "وقت التحدث" : "Talk time",
          value: formatCallHours(S.talkSeconds, lang),
        },
        {
          key: "calls",
          label: A ? "عدد المكالمات" : "Calls",
          value: S.outboundCalls === null ? "—" : fmtNum(S.outboundCalls),
        },
        {
          key: "answered",
          label: A ? "مردود عليها" : "Answered",
          value: S.answeredCalls === null ? "—" : fmtNum(S.answeredCalls),
        },
        { key: "rate", label: A ? "نسبة الرد" : "Answer rate", value: fmtPct(S.answerRate, 1) },
      ],
      breakdowns: [
        {
          id: "employees",
          title: A ? "حسب الموظف" : "By employee",
          rows: roster(
            (agent) => agent.talkSeconds ?? 0,
            (seconds) => formatCallHours(seconds, lang),
            "cyan",
          ),
          emptyLabel: A ? "لا توجد مكالمات في الفترة" : "No calls in this period",
        },
      ],
    },
    quality: {
      id: "teams.quality",
      title: A ? "تقييم الجودة" : "Average quality",
      value: fmtQuality(S.averageQualityScore),
      tone: "amber",
      icon: <CircleGauge size={16} />,
      definition: A
        ? "متوسط تقييم جودة المكالمات المحلَّلة في الفترة. يُحسب على المكالمات التي جرى تحليلها فقط، لا على كل المكالمات."
        : "The average quality score of the calls analysed in the period. Computed over analysed calls only, not over every call.",
      formula:
        S.analyzedCalls === null
          ? A
            ? "لا يوجد تحليل جودة لهذه الفترة."
            : "No quality analysis for this window."
          : A
            ? `محسوب على ${fmtNum(S.analyzedCalls)} مكالمة محلَّلة، منها ${fmtNum(S.qualityNeedsReview ?? 0)} تحتاج مراجعة.`
            : `Measured over ${fmtNum(S.analyzedCalls)} analysed calls, of which ${fmtNum(S.qualityNeedsReview ?? 0)} need review.`,
      supporting: [
        {
          key: "analyzed",
          label: A ? "مكالمات محلَّلة" : "Analysed calls",
          value: S.analyzedCalls === null ? "—" : fmtNum(S.analyzedCalls),
        },
        {
          key: "review",
          label: A ? "تحتاج مراجعة" : "Need review",
          value: fmtNum(S.qualityNeedsReview ?? 0),
        },
        {
          key: "calls",
          label: A ? "إجمالي المكالمات" : "Total calls",
          value: S.outboundCalls === null ? "—" : fmtNum(S.outboundCalls),
        },
        { key: "rate", label: A ? "نسبة الرد" : "Answer rate", value: fmtPct(S.answerRate, 1) },
      ],
      breakdowns: [
        {
          id: "employees",
          title: A ? "أعلى تقييمًا" : "Highest scoring",
          rows: roster(
            (agent) => agent.averageQualityScore ?? 0,
            (score) => fmtQuality(score || null),
            "amber",
          ),
          emptyLabel: A ? "لا يوجد تقييم في الفترة" : "No quality data in this period",
        },
      ],
    },
  };
}

export function AccountingAgentsView() {
  const { lang } = useI18n();
  const filters = useFilters();
  const [section, setSection] = useState<"units" | "employees">("units");
  const [display, setDisplay] = useState<"cards" | "table">("cards");
  const [sortBy, setSortBy] = useState<"revenue" | "closing" | "calls">("revenue");
  const [search, setSearch] = useState("");
  const [selectedAgentKey, setSelectedAgentKey] = useState<string | null>(null);
  const [editingTargets, setEditingTargets] = useState(false);
  const [uncalledScope, setUncalledScope] = useState<UncalledScope | null>(null);
  const [uncalledEmployee, setUncalledEmployee] = useState<{
    name: string;
    displayName: string;
  } | null>(null);
  const [autoOpenedUncalled, setAutoOpenedUncalled] = useState(false);
  const { data, isLoading, error, refetch } = useApi<AgentsResponse>("/api/teams");

  /**
   * Tell ENGO Nexus which board is open and who is selected.
   *
   * The two sections here ARE the contract's two views of the teams surface —
   * "units" is the target board, "employees" is the per-person board — so the
   * ids are mapped rather than passed through, and "حلل التاب ده" resolves to
   * the same thing the agent's contract calls it.
   */
  useRegisterNexusView("teams", { tab: section === "units" ? "targets" : "agents" });

  /**
   * The person whose card is open, so "الموظف ده" has a referent.
   *
   * Registered HERE, above the loading and error early-returns, because a hook
   * below them runs on some renders and not others. The DISPLAY name travels as
   * the label and the key as the id: the agent needs a stable identity to join
   * on, and the reader must only ever see the name already on their screen.
   */
  const focusedAgent = data?.agents.find((row) => row.key === selectedAgentKey) ?? null;
  useRegisterNexusEntity(
    focusedAgent
      ? {
          type: "salesperson",
          id: focusedAgent.key,
          name: focusedAgent.displayName || focusedAgent.name,
        }
      : null,
  );
  useEffect(() => {
    if (data && !data.callsHub.callsAvailable && sortBy === "calls") setSortBy("revenue");
  }, [data, sortBy]);
  useEffect(() => {
    if (!data || typeof window === "undefined") return;
    const requested = new URLSearchParams(window.location.search).get("employee")?.trim();
    if (!requested) return;
    const normalized = requested.toLocaleLowerCase("en");
    const match = data.agents.find(
      (row) =>
        row.key.toLocaleLowerCase("en") === normalized ||
        row.name.toLocaleLowerCase("en") === normalized ||
        row.displayName.toLocaleLowerCase("en") === normalized,
    );
    if (match) setSelectedAgentKey(match.key);
  }, [data]);
  useEffect(() => {
    if (
      autoOpenedUncalled ||
      data?.summary.uncalledDistributedLeads === null ||
      !data?.summary.uncalledDistributedLeads
    ) {
      return;
    }
    // The employee page is an action surface: open the company-wide queue once
    // after its real Yeastar/Odoo match has loaded. Closing it is respected for
    // the remainder of this visit; entering the page again opens a fresh queue.
    setAutoOpenedUncalled(true);
    setUncalledEmployee(null);
    setUncalledScope("none");
  }, [autoOpenedUncalled, data]);
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (isLoading || !data)
    return (
      <>
        <Skeleton className="h-28" />
        <Skeleton className="mt-4 h-96" />
      </>
    );

  // One description per figure, built from the response the board is already
  // rendering — so opening a card can never disagree with the card itself.
  const boardMetrics = agentBoardMetrics(data, lang);

  const filterMonth = filters.from?.slice(0, 7) || "";
  const selectedMonth =
    filterMonth && filters.from === `${filterMonth}-01` && filters.to === monthEnd(filterMonth)
      ? filterMonth
      : "";
  const normalizedSearch = search.trim().toLocaleLowerCase(lang === "ar" ? "ar" : "en");
  const visibleAgents = data.agents
    .filter((row) =>
      normalizedSearch
        ? `${row.displayName} ${row.name} ${row.team}`
            .toLocaleLowerCase(lang === "ar" ? "ar" : "en")
            .includes(normalizedSearch)
        : true,
    )
    .sort((a, b) =>
      sortBy === "closing"
        ? (b.decidedConversionRate ?? -1) - (a.decidedConversionRate ?? -1) ||
          b.slaWon - a.slaWon ||
          b.paidRevenue - a.paidRevenue
        : sortBy === "calls"
          ? (b.outboundCalls ?? -1) - (a.outboundCalls ?? -1) ||
            (b.answeredCalls ?? -1) - (a.answeredCalls ?? -1)
          : b.paidRevenue - a.paidRevenue || b.invoices - a.invoices,
    );
  const selectedAgent = data.agents.find((row) => row.key === selectedAgentKey) ?? null;
  const targetUnitRollup = buildTargetUnitRollup(
    data.agents
      .filter(
        (row): row is AgentRow & { target: AgentTarget & { target: number } } =>
          row.target?.target !== null && row.target?.target !== undefined,
      )
      .map((row) => ({
        key: row.key,
        employeeId: row.target.employeeId,
        name: row.displayName,
        target: row.target.target,
        paidRevenue: row.paidRevenue,
        orderRevenue: row.orderRevenue,
      })),
  );

  const selectMonth = (month: string) => {
    if (!month) return;
    filterStore.setDates(`${month}-01`, monthEnd(month));
  };

  return (
    <div className="space-y-5">
      <Notice tone="info" icon={<Info size={16} />}>
        {lang === "ar"
          ? `التحصيل والفواتير والليدز من Odoo حسب ${data.selected.dateBasis === "invoice" ? "تاريخ الفاتورة" : "تاريخ الدفع"}${data.selected.company ? ` لشركة ${data.selected.company}` : ""}. المكالمات من Yeastar.`
          : `Collections use Odoo ${data.selected.dateBasis === "invoice" ? "Invoice Date" : "Payment Date"}${data.selected.company ? ` for ${data.selected.company}` : ""}. Leads and closures come from Odoo; calls come from Yeastar.`}
      </Notice>
      {!data.callsHub.ok && (
        <Notice
          tone="warning"
          title={
            lang === "ar"
              ? "بيانات المكالمات غير متاحة مؤقتًا"
              : "Call data temporarily unavailable"
          }
        >
          {data.callsHub.error ||
            (lang === "ar"
              ? "تظهر مؤشرات الحسابات والعملاء فقط."
              : "Accounting and CRM metrics remain available.")}
        </Notice>
      )}
      {data.callsHub.ok && !data.callsHub.recordsAvailable && (
        <Notice
          tone="warning"
          title={
            lang === "ar"
              ? "لا توجد مكالمات مسجّلة في هذه الفترة"
              : "No calls recorded for this period"
          }
        >
          {lang === "ar"
            ? "الاتصال شغال، لكن مفيش مكالمات مسجلة داخل الفترة المختارة. أرقام Odoo ما زالت ظاهرة عادي."
            : "The connection is healthy, but no calls were recorded in the selected period. Odoo metrics remain available."}
        </Notice>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setEditingTargets(true)}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-brand/30 bg-brand-soft px-4 text-sm font-semibold text-brand transition-colors hover:bg-brand/10"
        >
          <Target size={16} />
          {lang === "ar" ? "تعديل التارجت" : "Edit targets"}
        </button>
      </div>
      <TargetNotices targets={data.targets} />
      <TargetEditor
        open={editingTargets}
        onOpenChange={setEditingTargets}
        // A saved quota changes every achievement figure on the page, so the
        // report is re-read rather than left showing the previous numbers.
        onSaved={() => refetch()}
      />
      <KpiRow>
        <MetricDetailTrigger
          detail={boardMetrics.employees}
          card={{
            index: 0,
            sub:
              data.targets.matched > 0
                ? `${fmtNum(data.targets.matched)} ${lang === "ar" ? "لهم تارجت" : "with a published target"}`
                : undefined,
          }}
        />
        <MetricDetailTrigger
          detail={boardMetrics.collections}
          card={{ index: 1, hero: true, sub: invoiceCount(data.summary.invoices, lang) }}
        />
        <MetricDetailTrigger
          detail={boardMetrics.target}
          card={{
            index: 2,
            // Prorated, so half a month shows half the quota. An em dash means
            // no target is published for this window — never a zero.
            sub:
              data.targets.totalTarget === null
                ? lang === "ar"
                  ? "لا يوجد تارجت للفترة"
                  : "No target published for this window"
                : `${lang === "ar" ? "تم تحقيق" : "Achieved"} ${fmtPct(data.targets.totalAchievementPaid, 1)}`,
          }}
        />
        <MetricDetailTrigger
          detail={boardMetrics.leads}
          card={{
            index: 3,
            sub: `${fmtNum(data.summary.won)} ${lang === "ar" ? "تم كسبها" : "became won"}`,
            info: <EmployeeMetricInfo metric="cohortWon" />,
          }}
        />
        <MetricDetailTrigger
          detail={boardMetrics.closures}
          card={{
            index: 4,
            sub:
              lang === "ar"
                ? `${fmtNum(data.summary.periodClosedLost)} خاسرة · تحويل ${fmtPct(data.summary.decidedConversionRate, 1)}`
                : `${fmtNum(data.summary.periodClosedLost)} lost · ${fmtPct(data.summary.decidedConversionRate, 1)}`,
            info: <EmployeeMetricInfo metric="periodClosures" />,
          }}
        />
        <MetricDetailTrigger
          detail={boardMetrics.calls}
          card={{
            index: 5,
            sub:
              data.summary.answeredCalls === null
                ? lang === "ar"
                  ? "لا توجد بيانات"
                  : "Unavailable for period"
                : `${fmtNum(data.summary.answeredCalls)} ${lang === "ar" ? "مردود عليها" : "answered"} · ${fmtPct(data.summary.answerRate, 1)}`,
          }}
        />
        <MetricDetailTrigger
          detail={{
            ...boardMetrics.callTime,
            value: <CallHoursKpiValue seconds={data.summary.totalCallSeconds} lang={lang} />,
          }}
          card={{
            index: 6,
            valueWrap: true,
            sub:
              lang === "ar"
                ? `وقت التحدث: ${formatCallHours(data.summary.talkSeconds, lang)}`
                : `${formatCallHours(data.summary.talkSeconds, lang)} actual talk time`,
          }}
        />
        <MetricDetailTrigger
          detail={boardMetrics.quality}
          card={{
            index: 7,
            sub:
              data.summary.analyzedCalls === null
                ? lang === "ar"
                  ? "لا يوجد تقييم"
                  : "Quality data unavailable"
                : lang === "ar"
                  ? `${fmtNum(data.summary.analyzedCalls)} مكالمة محللة · ${fmtNum(data.summary.qualityNeedsReview ?? 0)} تحتاج مراجعة`
                  : `${fmtNum(data.summary.analyzedCalls)} analyzed calls · ${fmtNum(data.summary.qualityNeedsReview ?? 0)} to review`,
          }}
        />
      </KpiRow>

      <Card padded={false} className="p-2">
        <div
          className="grid grid-cols-2 gap-2"
          role="tablist"
          aria-label={lang === "ar" ? "أقسام أداء الموظفين" : "Employee performance sections"}
        >
          <button
            type="button"
            role="tab"
            aria-selected={section === "units"}
            onClick={() => setSection("units")}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors ${
              section === "units"
                ? "bg-brand text-white shadow-sm"
                : "text-text-muted hover:bg-surface-muted hover:text-text"
            }`}
          >
            <ChartNoAxesCombined size={18} />
            {lang === "ar" ? "تحقيق الوحدات والتيمات" : "Units & team targets"}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === "employees"}
            onClick={() => setSection("employees")}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors ${
              section === "employees"
                ? "bg-brand text-white shadow-sm"
                : "text-text-muted hover:bg-surface-muted hover:text-text"
            }`}
          >
            <Users size={18} />
            {lang === "ar" ? "تفاصيل الموظفين" : "Employee details"}
          </button>
        </div>
      </Card>

      {section === "units" ? (
        <TargetUnitsDashboard
          rollup={targetUnitRollup}
          allPaidRevenue={data.summary.paidRevenue}
          untargeted={data.targets.untargeted}
          months={data.months}
          selectedMonth={selectedMonth}
          lang={lang}
          onSelectMonth={selectMonth}
          onSelectEmployee={(key) => setSelectedAgentKey(key)}
        />
      ) : (
        <>
          <Card>
            <SectionTitle
              hint={
                lang === "ar"
                  ? "التوزيع من Odoo، والتواصل يُثبت برقم الهاتف من مكالمات Yeastar أو رسائل وردود الموظفين في Chatwoot."
                  : "Assignment comes from Odoo; contact is proven by phone using Yeastar calls or employee messages and replies in Chatwoot."
              }
              action={
                <div className="flex flex-wrap gap-1.5">
                  <Pill tone={data.callsHub.leadCoverageAvailable ? "success" : "warning"}>
                    {data.callsHub.leadCoverageAvailable
                      ? lang === "ar"
                        ? "مطابقة فعلية بالرقم"
                        : "Live phone matching"
                      : lang === "ar"
                        ? "مطابقة المكالمات غير متاحة"
                        : "Call matching unavailable"}
                  </Pill>
                  <Pill tone={data.chatwoot.ok ? "success" : "warning"}>
                    {data.chatwoot.ok
                      ? lang === "ar"
                        ? "Chatwoot متصل"
                        : "Chatwoot connected"
                      : lang === "ar"
                        ? "تعذّر تحميل Chatwoot"
                        : "Chatwoot unavailable"}
                  </Pill>
                </div>
              }
            >
              {lang === "ar" ? "الليدز والمكالمات والشات" : "Lead distribution, calls, and chats"}
            </SectionTitle>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <MiniMetric
                label={lang === "ar" ? "الليدز" : "Assigned leads"}
                value={fmtNum(data.summary.distributedLeads)}
              />
              <MiniMetric
                label={lang === "ar" ? "تواصل معها الموظف المسؤول" : "Contacted by assigned owner"}
                value={
                  data.summary.ownerCalledDistributedLeads === null
                    ? "—"
                    : fmtNum(data.summary.ownerCalledDistributedLeads)
                }
              />
              <MiniMetric
                label={
                  lang === "ar"
                    ? "لم يتواصل معها الموظف المسؤول"
                    : "Not contacted by assigned owner"
                }
                value={
                  data.summary.ownerCalledDistributedLeads === null
                    ? "—"
                    : fmtNum(
                        Math.max(
                          0,
                          data.summary.distributedLeads - data.summary.ownerCalledDistributedLeads,
                        ),
                      )
                }
                hint={
                  lang === "ar"
                    ? "يشمل ليدز تابعها زميل آخر"
                    : "Includes leads handled by a colleague"
                }
                onDrill={
                  data.summary.ownerCalledDistributedLeads === null
                    ? undefined
                    : () => {
                        setUncalledEmployee(null);
                        setUncalledScope("owner");
                      }
                }
                drillLabel={
                  lang === "ar"
                    ? "اعرض الليدز التي لم يتواصل معها الموظف المسؤول"
                    : "Show the leads the assigned owner never contacted"
                }
              />
              <MiniMetric
                label={lang === "ar" ? "تواصل معها أي موظف" : "Contacted by any employee"}
                value={
                  data.summary.calledDistributedLeads === null
                    ? "—"
                    : fmtNum(data.summary.calledDistributedLeads)
                }
              />
              <MiniMetric
                label={lang === "ar" ? "لم يتواصل معها أحد" : "Never contacted by anyone"}
                value={
                  data.summary.uncalledDistributedLeads === null
                    ? "—"
                    : fmtNum(data.summary.uncalledDistributedLeads)
                }
                hint={
                  lang === "ar"
                    ? "لا مكالمة ولا رسالة أو رد من موظف"
                    : "No employee call, message, or reply"
                }
                onDrill={
                  data.summary.uncalledDistributedLeads === null
                    ? undefined
                    : () => {
                        setUncalledEmployee(null);
                        setUncalledScope("none");
                      }
                }
                drillLabel={
                  lang === "ar"
                    ? "اعرض الليدز التي لم يتواصل معها أحد"
                    : "Show the leads nobody contacted"
                }
              />
              <MiniMetric
                label={lang === "ar" ? "مكالمات من الليدز" : "Calls from assigned leads"}
                value={
                  data.summary.callsFromDistributedLeads === null
                    ? "—"
                    : fmtNum(data.summary.callsFromDistributedLeads)
                }
              />
              <MiniMetric
                label={lang === "ar" ? "نسبة اتصال الموظف بليدزه" : "Owner contact coverage"}
                value={fmtPct(data.summary.leadOwnerCallCoverageRate, 1)}
              />
              <MiniMetric
                label={lang === "ar" ? "الشات" : "Chat conversations"}
                value={
                  data.summary.chatConversations === null
                    ? "—"
                    : fmtNum(data.summary.chatConversations)
                }
              />
              <MiniMetric
                label={lang === "ar" ? "عملاء ينتظرون الرد الآن" : "Awaiting reply now"}
                value={
                  data.summary.chatAwaitingReply === null
                    ? "—"
                    : fmtNum(data.summary.chatAwaitingReply)
                }
              />
              <MiniMetric
                label={lang === "ar" ? "محادثات مفتوحة الآن" : "Open conversations now"}
                value={
                  data.summary.chatOpenConversations === null
                    ? "—"
                    : fmtNum(data.summary.chatOpenConversations)
                }
              />
              <MiniMetric
                label={lang === "ar" ? "محادثات بلا موظف الآن" : "Unassigned now"}
                value={
                  data.chatwoot.unassignedConversations === null
                    ? "—"
                    : fmtNum(data.chatwoot.unassignedConversations)
                }
              />
              <MiniMetric
                label={lang === "ar" ? "أول رد" : "First response"}
                value={formatCallDuration(data.summary.chatAverageFirstResponseSeconds, lang)}
              />
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-text-muted">
              {lang === "ar"
                ? "التوزيع حسب الموظف المسجل على الليد في Odoo. لمعرفة من غيّر التوزيع نحتاج سجل التعديلات من Odoo."
                : "This is the current distribution by the salesperson assigned in Odoo. Identifying which admin changed an assignment requires Odoo tracking history; a normal last edit is not mislabeled as a distribution event."}
            </p>
            {!data.chatwoot.ok && data.chatwoot.error && (
              <p className="mt-2 rounded-xl border border-warning/20 bg-warning-soft px-3 py-2 text-[10px] leading-relaxed text-text-muted">
                {lang === "ar"
                  ? `سبب تعذّر Chatwoot: ${data.chatwoot.error}`
                  : `Chatwoot error: ${data.chatwoot.error}`}
              </p>
            )}
          </Card>

          <Card>
            <div className="grid gap-3 xl:grid-cols-[minmax(190px,.7fr)_minmax(250px,1fr)_auto_auto] xl:items-end">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-muted">
                  {lang === "ar" ? "اختر الشهر" : "Choose month"}
                </span>
                <select
                  value={selectedMonth}
                  onChange={(event) => selectMonth(event.target.value)}
                  className="min-h-11 w-full cursor-pointer rounded-xl border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                >
                  <option value="">
                    {lang === "ar" ? "الفترة الحالية" : "Current date range"}
                  </option>
                  {[...data.months].reverse().map((month) => (
                    <option key={month} value={month}>
                      {monthLabel(month, lang)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-muted">
                  {lang === "ar" ? "ابحث بالاسم" : "Search employee or team"}
                </span>
                <span className="relative block">
                  <Search
                    size={16}
                    className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-text-muted"
                  />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={lang === "ar" ? "اكتب الاسم…" : "Type a name…"}
                    className="min-h-11 w-full rounded-xl border border-border bg-surface ps-10 pe-3 text-sm text-text outline-none placeholder:text-text-subtle focus:border-brand focus:ring-2 focus:ring-brand/15"
                  />
                </span>
              </label>

              <div className="table-wrap scroll-hint-x">
                <span className="mb-1.5 block text-xs font-medium text-text-muted">
                  {lang === "ar" ? "الترتيب حسب" : "Rank cards by"}
                </span>
                <Segmented
                  value={sortBy}
                  onChange={setSortBy}
                  options={[
                    { value: "revenue", label: lang === "ar" ? "التحصيل" : "Revenue" },
                    { value: "closing", label: lang === "ar" ? "الإغلاقات" : "Closures" },
                    ...(data.callsHub.callsAvailable
                      ? [{ value: "calls" as const, label: lang === "ar" ? "المكالمات" : "Calls" }]
                      : []),
                  ]}
                />
                <p className="mt-1.5 text-[10px] text-text-subtle">
                  {lang === "ar"
                    ? "يغيّر ترتيب الموظفين فقط."
                    : "Changes card order and emphasis, not period totals."}
                </p>
              </div>

              <div className="table-wrap scroll-hint-x">
                <span className="mb-1.5 block text-xs font-medium text-text-muted">
                  {lang === "ar" ? "طريقة العرض" : "View"}
                </span>
                <Segmented
                  value={display}
                  onChange={setDisplay}
                  options={[
                    { value: "cards", label: lang === "ar" ? "كروت" : "Cards" },
                    { value: "table", label: lang === "ar" ? "جدول" : "Table" },
                  ]}
                />
              </div>
            </div>
          </Card>

          {display === "cards" ? (
            <AgentCards
              rows={visibleAgents}
              sortBy={sortBy}
              callsAvailable={data.callsHub.callsAvailable}
              onSelect={(row) => setSelectedAgentKey(row.key)}
            />
          ) : (
            <AgentTable
              rows={visibleAgents}
              onSelect={(row) => setSelectedAgentKey(row.key)}
              onOpenUncalled={(row) => {
                setUncalledEmployee({ name: row.name, displayName: row.displayName });
                setUncalledScope("owner");
              }}
            />
          )}
        </>
      )}

      <AgentPerformanceSheet
        row={selectedAgent}
        open={selectedAgent !== null}
        onOpenChange={(next) => {
          if (!next) setSelectedAgentKey(null);
        }}
      />

      <UncalledLeadsDialog
        scope={uncalledScope}
        employee={uncalledEmployee?.name}
        employeeLabel={uncalledEmployee?.displayName}
        onOpenChange={(next) => {
          if (!next) {
            setUncalledScope(null);
            setUncalledEmployee(null);
          }
        }}
      />
    </div>
  );
}

function TargetUnitsDashboard({
  rollup,
  allPaidRevenue,
  untargeted,
  months,
  selectedMonth,
  lang,
  onSelectMonth,
  onSelectEmployee,
}: {
  rollup: ReturnType<typeof buildTargetUnitRollup>;
  allPaidRevenue: number;
  untargeted: AgentsResponse["targets"]["untargeted"];
  months: string[];
  selectedMonth: string;
  lang: Lang;
  onSelectMonth: (month: string) => void;
  onSelectEmployee: (key: string) => void;
}) {
  const periodLabel = selectedMonth
    ? monthLabel(selectedMonth, lang)
    : lang === "ar"
      ? "الفترة المختارة"
      : "Selected period";
  const outsideTargetRevenue = untargeted.reduce((sum, person) => sum + person.paidRevenue, 0);
  const collectionDetail: MetricDetail = {
    id: "teams.target-collections",
    title: lang === "ar" ? "التحصيل المحسوب على التارجت" : "Collections counted toward target",
    value: fmtUSDFull(rollup.paidRevenue),
    tone: "sky",
    icon: <ReceiptText size={16} />,
    definition:
      lang === "ar"
        ? `ده تحصيل الموظفين اللي لهم تارجت منشور في ${periodLabel}. مش كل تحصيل الشركة يدخل في نسبة التارجت.`
        : `Collections from employees with a published target in ${periodLabel}; not every company collection belongs in target achievement.`,
    formula:
      lang === "ar"
        ? `${fmtUSDFull(allPaidRevenue)} إجمالي تحصيل الموظفين − ${fmtUSDFull(outsideTargetRevenue)} تحصيل موظفين بلا تارجت = ${fmtUSDFull(rollup.paidRevenue)} داخل حساب التارجت.`
        : `${fmtUSDFull(allPaidRevenue)} all employee collections − ${fmtUSDFull(outsideTargetRevenue)} from employees without a target = ${fmtUSDFull(rollup.paidRevenue)} counted toward target.`,
    caveat:
      untargeted.length > 0
        ? lang === "ar"
          ? `لذلك لا تضيف ${fmtUSDFull(outsideTargetRevenue)} إلى نسبة التحقيق: مفيش تارجت مقابل له. افتح القائمة تحت لمعرفة الموظفين والمبالغ.`
          : `${fmtUSDFull(outsideTargetRevenue)} is excluded from the achievement rate because it has no corresponding target. See the employees below.`
        : undefined,
    supporting: [
      {
        key: "all-collections",
        label: lang === "ar" ? "إجمالي تحصيل الموظفين" : "All employee collections",
        value: fmtUSDFull(allPaidRevenue),
      },
      {
        key: "target-collections",
        label: lang === "ar" ? "داخل حساب التارجت" : "Counted toward target",
        value: fmtUSDFull(rollup.paidRevenue),
      },
      {
        key: "outside-target",
        label: lang === "ar" ? "خارج حساب التارجت" : "Outside target calculation",
        value: fmtUSDFull(outsideTargetRevenue),
        hint: lang === "ar" ? `${fmtNum(untargeted.length)} موظف بلا تارجت منشور` : `${fmtNum(untargeted.length)} employees without a published target`,
      },
      {
        key: "target-members",
        label: lang === "ar" ? "نسبة التحقيق" : "Achievement rate",
        value: fmtPct(rollup.achievement, 1),
      },
    ],
    records: untargeted.length
      ? {
          title: lang === "ar" ? "تحصيل ظاهر في الإيراد لكنه خارج التارجت" : "Collections in revenue but outside target",
          hint:
            lang === "ar"
              ? "هؤلاء الموظفون لهم تحصيل في الفترة، لكن ملف التارجت لا يضع لهم تارجت. لذلك يظهروا في إجمالي الإيراد ولا يدخلوا في نسبة التحقيق."
              : "These employees collected in the period but have no target in the target file, so they appear in revenue but not in achievement.",
          rows: untargeted.map((person) => ({
            key: person.name,
            title: person.name,
            subtitle: person.note || (lang === "ar" ? "بلا تارجت منشور" : "No published target"),
            value: fmtUSDFull(person.paidRevenue),
          })),
        }
      : undefined,
  };

  return (
    <section className="space-y-4" aria-labelledby="target-units-title">
      <Card padded={false} className="overflow-hidden">
        {/* Was a full-width dark gradient band. Nothing on it was a figure —
            a label, a heading, a sentence and a month picker — so it was the
            heaviest element on the page carrying the least information. */}
        <div className="grid gap-5 border-b border-border bg-surface-2 px-5 py-5 lg:grid-cols-[1fr_auto] lg:items-center lg:px-7">
          <div>
            <p className="text-xs font-semibold text-text-muted">
              {lang === "ar" ? "متابعة التارجت من تحصيل Odoo" : "Odoo collections target tracking"}
            </p>
            <h2 id="target-units-title" className="mt-1 text-xl font-bold text-text sm:text-2xl">
              {lang === "ar" ? "أداء الوحدات والتيمات" : "Units and team performance"}
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-6 text-text-muted">
              {lang === "ar"
                ? `الأرقام محسوبة من التحصيل المدفوع خلال ${periodLabel}. افتح أي تيم لعرض مساهمة كل موظف.`
                : `Figures use paid collections during ${periodLabel}. Open a team to see every employee's contribution.`}
            </p>
          </div>
          <label className="block min-w-[210px]">
            <span className="mb-1.5 block text-xs font-semibold text-text-muted">
              {lang === "ar" ? "شهر التارجت" : "Target month"}
            </span>
            <select
              value={selectedMonth}
              onChange={(event) => onSelectMonth(event.target.value)}
              className="min-h-11 w-full cursor-pointer rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-text outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            >
              <option value="">{lang === "ar" ? "الفترة الحالية" : "Current date range"}</option>
              {[...months].reverse().map((month) => (
                <option key={month} value={month}>
                  {monthLabel(month, lang)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 divide-x divide-border border-t border-border sm:grid-cols-4 rtl:divide-x-reverse">
          <TargetHeadlineMetric
            label={lang === "ar" ? "إجمالي التارجت" : "Total target"}
            value={fmtUSDFull(rollup.target)}
          />
          <TargetHeadlineMetric
            label={lang === "ar" ? "المحقق داخل التارجت" : "Collections toward target"}
            value={fmtUSDFull(rollup.paidRevenue)}
            accent
            detail={collectionDetail}
          />
          <TargetHeadlineMetric
            label={lang === "ar" ? "نسبة التحقيق" : "Achievement"}
            value={fmtPct(rollup.achievement, 1)}
          />
          <TargetHeadlineMetric
            label={lang === "ar" ? "المتبقي" : "Remaining"}
            value={fmtUSDFull(rollup.remaining)}
          />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {rollup.units.map((unit, index) => (
          <TargetUnitCard
            key={unit.key}
            unit={unit}
            lang={lang}
            index={index}
            onSelectEmployee={onSelectEmployee}
          />
        ))}
      </div>

      {rollup.standalone.length > 0 && (
        <Card>
          <SectionTitle
            hint={
              lang === "ar"
                ? "أفراد بتارجت مستقل، وغير محسوبين داخل وحدتي بهاء أو أسماء."
                : "Independent targets, outside Bahaa and Asmaa's unit totals."
            }
          >
            {lang === "ar" ? "التارجتات الفردية" : "Standalone targets"}
          </SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            {rollup.standalone.map((member) => (
              <TargetMemberCard
                key={member.employeeId}
                member={member}
                lang={lang}
                onSelect={() => onSelectEmployee(member.key)}
              />
            ))}
          </div>
        </Card>
      )}

      {rollup.unassigned.length > 0 && (
        <Notice
          tone="warning"
          title={lang === "ar" ? "تارجتات تحتاج توزيعًا" : "Targets need an org assignment"}
        >
          {lang === "ar"
            ? `${fmtNum(rollup.unassigned.length)} موظف لهم تارجت منشور لكنهم غير موجودين في تقسيم الوحدات الحالي. لم يتم حذفهم من الإجمالي.`
            : `${fmtNum(rollup.unassigned.length)} published targets are not mapped to the current unit layout. They remain included in the total.`}
        </Notice>
      )}
    </section>
  );
}

function TargetHeadlineMetric({
  label,
  value,
  accent = false,
  detail,
}: {
  label: string;
  value: string;
  accent?: boolean;
  detail?: MetricDetail;
}) {
  const metric = (onOpen?: () => void) => (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      data-metric-trigger={onOpen ? "true" : undefined}
      className={`min-w-0 px-3 py-4 text-center ${onOpen ? "group w-full cursor-pointer transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-brand" : "w-full"} sm:px-5`}
      aria-label={onOpen ? `${label} — عرض التفاصيل` : undefined}
    >
      <p className="text-[10px] font-bold text-text-muted sm:text-xs">{label}</p>
      <p
        className={`mt-1 truncate text-lg font-black sm:text-xl ${accent ? "text-brand" : "text-text"}`}
      >
        {value}
      </p>
      {onOpen && (
        <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-brand opacity-80 group-hover:opacity-100">
          <Info size={11} aria-hidden="true" />
          اضغط للتوضيح
        </span>
      )}
    </button>
  );
  return detail ? <MetricDrilldown detail={detail}>{(open) => metric(open)}</MetricDrilldown> : metric();
}

function TargetUnitCard({
  unit,
  lang,
  index,
  onSelectEmployee,
}: {
  unit: TargetUnitRollup;
  lang: Lang;
  index: number;
  onSelectEmployee: (key: string) => void;
}) {
  const unitName = lang === "ar" ? unit.nameAr : unit.nameEn;
  const accent = index % 2 === 0 ? "bg-brand" : "bg-[#d88724]";

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="relative overflow-hidden px-5 py-5">
        <div className={`absolute inset-y-0 start-0 w-1.5 ${accent}`} />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-text-subtle">
              {lang === "ar" ? "وحدة مبيعات" : "Sales unit"}
            </p>
            <h3 className="mt-1 text-xl font-black text-text">{unitName}</h3>
            <p className="mt-1 text-xs text-text-muted">
              {fmtNum(unit.leaders.length)} {lang === "ar" ? "تيم" : "teams"} ·{" "}
              {fmtNum(unit.leaders.reduce((sum, leader) => sum + leader.members.length, 0))}{" "}
              {lang === "ar" ? "موظف" : "employees"}
            </p>
          </div>
          <div className="text-end">
            <p className="text-xs font-semibold text-text-muted">
              {lang === "ar" ? "نسبة التحقيق" : "Achievement"}
            </p>
            <p className="mt-0.5 text-3xl font-black text-brand">{fmtPct(unit.achievement, 1)}</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl bg-surface-muted p-3">
          <TargetCompactMetric
            label={lang === "ar" ? "التارجت" : "Target"}
            value={fmtUSDFull(unit.target)}
          />
          <TargetCompactMetric
            label={lang === "ar" ? "المحقق" : "Achieved"}
            value={fmtUSDFull(unit.paidRevenue)}
            strong
          />
          <TargetCompactMetric
            label={lang === "ar" ? "المتبقي" : "Remaining"}
            value={fmtUSDFull(unit.remaining)}
          />
        </div>
        <TargetProgress value={unit.achievement} className="mt-4" />
      </div>

      <div className="space-y-2 border-t border-border bg-surface-muted/45 p-3 sm:p-4">
        {unit.leaders.map((leader) => (
          <TargetLeaderCard
            key={leader.key}
            leader={leader}
            lang={lang}
            onSelectEmployee={onSelectEmployee}
          />
        ))}
      </div>
    </Card>
  );
}

function TargetLeaderCard({
  leader,
  lang,
  onSelectEmployee,
}: {
  leader: TargetLeaderRollup;
  lang: Lang;
  onSelectEmployee: (key: string) => void;
}) {
  return (
    <details className="group rounded-2xl border border-border bg-surface shadow-[0_1px_0_rgba(15,35,60,.03)]">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 marker:content-none">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
          <Users size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-text">
            {lang === "ar" ? leader.nameAr : leader.nameEn}
          </p>
          <p className="mt-0.5 text-[10px] text-text-muted">
            {fmtNum(leader.members.length)} {lang === "ar" ? "موظف" : "employees"} ·{" "}
            {lang === "ar" ? "تارجت" : "target"} {fmtUSDFull(leader.target)}
          </p>
        </div>
        <div className="shrink-0 text-end">
          <p className="text-sm font-black text-brand">{fmtPct(leader.achievement, 1)}</p>
          <p className="text-[9px] text-text-subtle">{fmtUSDFull(leader.paidRevenue)}</p>
        </div>
        <ChevronDown
          size={17}
          className="shrink-0 text-text-subtle transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-border px-3 py-3">
        <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl bg-surface-muted p-2.5">
          <TargetCompactMetric
            label={lang === "ar" ? "التارجت" : "Target"}
            value={fmtUSDFull(leader.target)}
          />
          <TargetCompactMetric
            label={lang === "ar" ? "التحصيل" : "Paid"}
            value={fmtUSDFull(leader.paidRevenue)}
            strong
          />
          <TargetCompactMetric
            label={lang === "ar" ? "المتبقي" : "Remaining"}
            value={fmtUSDFull(leader.remaining)}
          />
        </div>
        <div className="space-y-1.5">
          {leader.members.map((member) => (
            <button
              key={member.employeeId}
              type="button"
              onClick={() => onSelectEmployee(member.key)}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-start transition-colors hover:border-brand/20 hover:bg-brand-soft"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-text">{member.name}</span>
                <span className="mt-0.5 block text-[9px] text-text-subtle">
                  {lang === "ar" ? "افتح أداء الموظف" : "Open employee performance"}
                </span>
              </span>
              <span className="text-end">
                <span className="block text-xs font-black text-text">
                  {fmtUSDFull(member.paidRevenue)}
                </span>
                <span className="block text-[9px] text-text-subtle">
                  / {fmtUSDFull(member.target)}
                </span>
              </span>
              <Pill
                tone={
                  member.achievement >= 100
                    ? "success"
                    : member.achievement >= 60
                      ? "warning"
                      : "neutral"
                }
              >
                {fmtPct(member.achievement, 1)}
              </Pill>
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}

function TargetMemberCard({
  member,
  lang,
  onSelect,
}: {
  member: TargetUnitMember;
  lang: Lang;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="rounded-2xl border border-border bg-surface p-4 text-start transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-text">{member.name}</p>
          <p className="mt-1 text-[10px] text-text-muted">
            {lang === "ar" ? "تارجت فردي مستقل" : "Independent individual target"}
          </p>
        </div>
        <Pill
          tone={
            member.achievement >= 100 ? "success" : member.achievement >= 60 ? "warning" : "neutral"
          }
        >
          {fmtPct(member.achievement, 1)}
        </Pill>
      </div>
      <TargetProgress value={member.achievement} className="mt-4" />
      <div className="mt-3 grid grid-cols-3 gap-2">
        <TargetCompactMetric
          label={lang === "ar" ? "التارجت" : "Target"}
          value={fmtUSDFull(member.target)}
        />
        <TargetCompactMetric
          label={lang === "ar" ? "المحقق" : "Achieved"}
          value={fmtUSDFull(member.paidRevenue)}
          strong
        />
        <TargetCompactMetric
          label={lang === "ar" ? "المتبقي" : "Remaining"}
          value={fmtUSDFull(member.remaining)}
        />
      </div>
    </button>
  );
}

function TargetCompactMetric({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[9px] font-semibold text-text-subtle">{label}</p>
      <p
        className={`mt-0.5 truncate text-xs font-black sm:text-sm ${strong ? "text-brand" : "text-text"}`}
      >
        {value}
      </p>
    </div>
  );
}

function TargetProgress({ value, className = "" }: { value: number; className?: string }) {
  const width = Math.max(0, Math.min(100, value));
  const color = value >= 100 ? "bg-success" : value >= 60 ? "bg-warning" : "bg-brand";
  return (
    <div
      className={`h-2 overflow-hidden rounded-full bg-surface-muted ${className}`}
      aria-label={`${fmtPct(value, 1)}`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${color}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

/**
 * Everything the target comparison cannot answer, said out loud.
 *
 * A quota that silently fails to reach its employee is worse than no quota at
 * all: the page still shows a plausible number, just for fewer people than the
 * manager thinks. So an unmatched name and a partially covered window each get
 * a named notice rather than a footnote.
 */
function TargetNotices({ targets }: { targets: AgentsResponse["targets"] }) {
  const { lang } = useI18n();
  if (!targets.publishedMonths.length) return null;
  return (
    <>
      {targets.unmatched.length > 0 && (
        <Notice
          tone="warning"
          title={
            lang === "ar"
              ? `${fmtNum(targets.unmatched.length)} تارجت غير مطابق`
              : `${fmtNum(targets.unmatched.length)} published targets matched no employee`
          }
        >
          {lang === "ar"
            ? `${targets.unmatched.map((row) => row.name).join("، ")} — الموظف بلا نشاط في الفترة أو اسمه مختلف في Odoo. التارجت لن ينتقل لموظف آخر.`
            : `${targets.unmatched.map((row) => row.name).join(", ")} — either they had no activity in this period, or the workbook spells them differently from Odoo and needs an alias. Their quota is never reassigned to anyone else.`}
        </Notice>
      )}
      {!targets.complete && targets.monthsMissing.length > 0 && (
        <Notice
          tone="warning"
          title={
            lang === "ar"
              ? "التارجت لا يغطي كل الفترة"
              : "The target covers only part of this window"
          }
        >
          {lang === "ar"
            ? `يوجد تارجت لـ ${targets.publishedMonths.map((month) => monthLabel(month, lang)).join("، ")} فقط. اختر شهرًا واحدًا لمقارنة أدق.`
            : `Targets exist for ${targets.publishedMonths.join(", ")} only, while this window spans ${fmtNum(targets.monthsMissing.length)} further month(s) with none. The percentage therefore compares whole-window sales against the published months alone — pick a single month for a fair comparison.`}
        </Notice>
      )}
      {targets.duplicates.length > 0 && (
        <Notice
          tone="warning"
          title={lang === "ar" ? "تعارض في ملف التارجت" : "Target workbook conflict"}
        >
          {targets.duplicates.join(" · ")}
        </Notice>
      )}
    </>
  );
}

/**
 * The employee's quota for the selected window, on both revenue bases.
 *
 * The two bases genuinely disagree: paid collections come from Odoo invoice
 * lines dated by Payment Date, while the operational figure is Odoo's own
 * monthly sales report. Showing them side by side is deliberate — picking one
 * silently would make the dashboard argue with the sheet management already
 * circulates, with no way to see which number moved.
 */
function AgentTargetPanel({ target, row }: { target: AgentTarget; row: AgentRow }) {
  const { lang } = useI18n();
  const money = (value: number | null) => (value === null ? "—" : fmtUSDFull(value));
  const gapLabel = (gap: number | null) => {
    if (gap === null) return "—";
    return gap > 0
      ? `${lang === "ar" ? "باقي" : "remaining"} ${fmtUSDFull(gap)}`
      : `${lang === "ar" ? "تخطّى بـ" : "over by"} ${fmtUSDFull(Math.abs(gap))}`;
  };

  return (
    <section
      id="employee-target-summary"
      className="scroll-mt-24 rounded-2xl border border-brand/20 bg-brand-soft/40 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-brand">
          <Target size={16} />
          <span>{lang === "ar" ? "تارجت الفترة" : "Target for this period"}</span>
        </div>
        <div className="text-[11px] text-text-muted">
          {[target.teamLeader, target.branch, target.note].filter(Boolean).join(" · ")}
        </div>
      </div>

      {target.target === null ? (
        <p className="mt-3 text-sm font-medium text-text-muted">
          {target.note ||
            (lang === "ar"
              ? "لا يوجد تارجت منشور لهذا الموظف في الفترة المختارة."
              : "No target is published for this employee in the selected window.")}
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ProfileMetric
              label={lang === "ar" ? "التارجت" : "Target"}
              explain="target"
              value={money(target.target)}
              sub={target.monthsCovered.map((month) => monthLabel(month, lang)).join(" · ")}
              icon={<Target size={17} />}
              hero
              evidenceHref="#employee-target-evidence"
            />
            <ProfileMetric
              label={lang === "ar" ? "إنجاز التحصيل" : "Collections vs target"}
              explain="achievementPaid"
              value={fmtPct(target.achievementPaid, 1)}
              sub={gapLabel(target.gapPaid)}
              icon={<ReceiptText size={17} />}
              evidenceHref="#employee-sales-evidence"
            />
            {/* Two different silences, two different sentences. "Unavailable for
                period" covered both and sent readers hunting for a gap in the
                month, when the cause was a feed nobody had connected. */}
            <ProfileMetric
              label={lang === "ar" ? "إنجاز أوامر البيع" : "Orders vs target"}
              explain="achievementOrders"
              value={fmtPct(target.achievementOrders, 1)}
              sub={
                row.orderRevenue
                  ? `${gapLabel(target.gapOrders)} · ${fmtNum(row.orderCount)} ${lang === "ar" ? "أمر بيع" : "orders"}`
                  : lang === "ar"
                    ? "مفيش أوامر بيع باسمه في الفترة دي"
                    : "No sale orders on his name in this window"
              }
              icon={<Calculator size={17} />}
              evidenceHref="#employee-sales-evidence"
            />
            <ProfileMetric
              label={lang === "ar" ? "كود الموظف" : "Employee code"}
              value={target.employeeId}
              sub={target.supervisor}
              icon={<UserRound size={17} />}
            />
          </div>
          <div className="mt-4">
            <ProgressMetric
              label={
                lang === "ar"
                  ? `نسبة إنجاز التارجت — ${money(row.paidRevenue)} من ${money(target.target)}`
                  : `Target achievement — ${money(row.paidRevenue)} of ${money(target.target)}`
              }
              value={target.achievementPaid}
              color="var(--brand)"
            />
          </div>
          {!target.complete && (
            <p className="mt-3 text-[11px] text-text-muted">
              {lang === "ar"
                ? `التارجت منشور لـ ${target.monthsCovered.map((month) => monthLabel(month, lang)).join("، ")} فقط، والفترة المختارة أطول من كده — النسبة جزئية.`
                : `A target exists only for ${target.monthsCovered.join(", ")}, while the window is longer — the percentage is partial.`}
            </p>
          )}
          <div
            id="employee-target-evidence"
            className="mt-3 scroll-mt-24 rounded-xl border border-brand/15 bg-surface/75 px-3 py-2 text-[10px] leading-relaxed text-text-muted"
          >
            <b className="text-text">
              {lang === "ar" ? "دليل التارجت المنشور:" : "Published target evidence:"}
            </b>{" "}
            {lang === "ar"
              ? `كود الموظف ${target.employeeId} · الشهور ${target.monthsCovered.map((month) => monthLabel(month, lang)).join("، ") || "—"} · القيمة ${money(target.target)}.`
              : `Employee ${target.employeeId} · months ${target.monthsCovered.join(", ") || "—"} · value ${money(target.target)}.`}
          </div>
        </>
      )}
    </section>
  );
}

function EvidenceLink({ href }: { href: string }) {
  const { lang } = useI18n();
  const evidence = useContext(EmployeeEvidenceContext);
  const kind = evidenceKindFromHref(href);
  if (evidence && kind) {
    const labels: Record<EmployeeEvidenceKind, { ar: string; en: string }> = {
      target: { ar: "تفاصيل التارجت", en: "Target details" },
      sales: { ar: "سجلات المبيعات", en: "Sales records" },
      leads: { ar: "الليدز واتصالاتها", en: "Leads and contacts" },
      calls: { ar: "المكالمات والتقييم", en: "Calls and scores" },
      chatwoot: { ar: "محادثات Chatwoot", en: "Chatwoot conversations" },
    };
    return (
      <button
        type="button"
        onClick={() => evidence.openEvidence(kind)}
        className="inline-flex items-center gap-1 rounded-lg border border-brand/20 bg-brand-soft/55 px-2.5 py-1.5 text-[10px] font-semibold text-brand transition-colors hover:bg-brand-soft"
      >
        {labels[kind][lang]}
        <ArrowUpRight size={12} aria-hidden="true" />
      </button>
    );
  }
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand underline-offset-4 hover:underline"
    >
      {lang === "ar" ? "عرض الدليل" : "View evidence"}
      <ArrowUpRight size={12} aria-hidden="true" />
    </a>
  );
}

function EmployeeScoreSummary({ row }: { row: AgentRow }) {
  const { lang } = useI18n();
  const score = row.performanceScore;
  return (
    <section
      id="employee-score-summary"
      className="scroll-mt-24 rounded-2xl border border-brand/20 bg-brand-soft/35 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-brand">
            {lang === "ar" ? "ملخص الأداء" : "Performance summary"}
          </div>
          <h3 className="mt-0.5 text-lg font-bold text-text">
            {lang === "ar" ? "النتيجة أولًا، ثم الدليل" : "Score first, evidence next"}
          </h3>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-text-muted">
            {lang === "ar"
              ? "25 نقطة للمكالمات + 30 للتواصل والبيع + 20 لمتابعة Chatwoot + 25 لتحقيق التارجت. الجزء الذي لا توجد له بيانات يأخذ صفرًا ولا يرفع باقي الأجزاء."
              : "25 points for calls + 30 for lead execution + 20 for Chatwoot follow-up + 25 for target attainment. Missing evidence earns zero and never inflates the other areas."}
          </p>
        </div>
        <div className="rounded-2xl border border-brand/20 bg-surface px-5 py-3 text-center shadow-sm">
          <div className="num text-3xl font-bold text-brand">{fmtQuality(score.overall)}</div>
          <small className="block text-[10px] text-text-muted">
            {lang === "ar" ? "نقطة مكتسبة من 100" : "Earned points out of 100"}
          </small>
          <small className="mt-0.5 block text-[10px] font-medium text-brand">
            {lang === "ar"
              ? `تغطية البيانات ${fmtPct(score.dataCoverage, 0)}`
              : `${fmtPct(score.dataCoverage, 0)} evidence coverage`}
          </small>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-3.5">
          <div className="flex items-center justify-between gap-2">
            <b className="text-xs text-text">
              {lang === "ar"
                ? `جودة المكالمات · ${score.weights.callQuality} نقطة`
                : `Call quality · ${score.weights.callQuality} pts`}
            </b>
            <span className="num font-bold text-brand">{fmtQuality(score.callQuality)}</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
            {lang === "ar"
              ? `${fmtNum(score.evidence.analyzedCalls)} محللة من ${score.evidence.answeredCalls === null ? "—" : fmtNum(score.evidence.answeredCalls)} مكالمة · ${fmtScorePoints(score.earnedPoints.callQuality)} نقطة مكتسبة`
              : `${fmtNum(score.evidence.analyzedCalls)} analyzed of ${score.evidence.answeredCalls === null ? "—" : fmtNum(score.evidence.answeredCalls)} calls · ${fmtScorePoints(score.earnedPoints.callQuality)} pts earned`}
          </p>
          <div className="mt-3">
            <EvidenceLink href="#employee-call-evidence" />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3.5">
          <div className="flex items-center justify-between gap-2">
            <b className="text-xs text-text">
              {lang === "ar"
                ? `التواصل والبيع · ${score.weights.salesExecution} نقطة`
                : `Lead execution · ${score.weights.salesExecution} pts`}
            </b>
            <span className="num font-bold text-brand">{fmtQuality(score.salesExecution)}</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
            {lang === "ar"
              ? `اتصل بنفسه بـ ${score.evidence.ownerCalledDistributedLeads === null ? "—" : fmtNum(score.evidence.ownerCalledDistributedLeads)} من ${fmtNum(score.evidence.distributedLeads)} ليد · تغطية ${fmtPct(score.evidence.leadCoverageRate, 1)} · ${fmtScorePoints(score.earnedPoints.salesExecution)} نقطة مكتسبة`
              : `Personally called ${score.evidence.ownerCalledDistributedLeads === null ? "—" : fmtNum(score.evidence.ownerCalledDistributedLeads)} of ${fmtNum(score.evidence.distributedLeads)} leads · ${fmtPct(score.evidence.leadCoverageRate, 1)} coverage · ${fmtScorePoints(score.earnedPoints.salesExecution)} pts earned`}
          </p>
          <div className="mt-3">
            <EvidenceLink href="#employee-lead-evidence" />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3.5">
          <div className="flex items-center justify-between gap-2">
            <b className="text-xs text-text">
              {lang === "ar"
                ? `متابعة Chatwoot · ${score.weights.chatFollowUp} نقطة`
                : `Chatwoot follow-up · ${score.weights.chatFollowUp} pts`}
            </b>
            <span className="num font-bold text-brand">{fmtQuality(score.chatFollowUp)}</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
            {lang === "ar"
              ? `${fmtNum(score.evidence.chatConversations)} محادثة مفتوحة الآن · ${fmtNum(score.evidence.chatRepliedConversations)} لا تنتظر ردًا · ${fmtNum(score.evidence.chatAwaitingReply)} ينتظرون الرد · ${fmtScorePoints(score.earnedPoints.chatFollowUp)} نقطة مكتسبة`
              : `${fmtNum(score.evidence.chatConversations)} open now · ${fmtNum(score.evidence.chatRepliedConversations)} not awaiting · ${fmtNum(score.evidence.chatAwaitingReply)} awaiting reply · ${fmtScorePoints(score.earnedPoints.chatFollowUp)} pts earned`}
          </p>
          <div className="mt-3">
            <EvidenceLink href="#employee-chat-evidence" />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3.5">
          <div className="flex items-center justify-between gap-2">
            <b className="text-xs text-text">
              {lang === "ar"
                ? `تحقيق التارجت · ${score.weights.targetAttainment} نقطة`
                : `Target attainment · ${score.weights.targetAttainment} pts`}
            </b>
            <span className="num font-bold text-brand">{fmtQuality(score.targetAttainment)}</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
            {score.evidence.targetBasis === "orders"
              ? lang === "ar"
                ? "محسوب من أوامر البيع المؤكدة."
                : "Based on confirmed sale orders."
              : score.evidence.targetBasis === "collections"
                ? lang === "ar"
                  ? "محسوب من التحصيل لعدم توفر أوامر البيع."
                  : "Based on collections because orders are unavailable."
                : lang === "ar"
                  ? "لا يوجد تارجت صالح للفترة."
                  : "No scoreable target for this period."}{" "}
            {lang === "ar"
              ? `${fmtScorePoints(score.earnedPoints.targetAttainment)} نقطة مكتسبة`
              : `${fmtScorePoints(score.earnedPoints.targetAttainment)} pts earned`}
          </p>
          <div className="mt-3">
            <EvidenceLink href="#employee-target-summary" />
          </div>
        </div>
      </div>
      {score.missing.length > 0 && (
        <p className="mt-3 rounded-xl border border-warning/20 bg-warning-soft px-3 py-2 text-[11px] leading-relaxed text-text-muted">
          {lang === "ar"
            ? "الدرجة محافظة: الجزء بلا بيانات كافية يأخذ صفرًا مؤقتًا."
            : "This is conservative: a component without enough evidence temporarily earns zero."}
        </p>
      )}
    </section>
  );
}

function EmployeeEvidencePanel({
  row,
  kind,
}: {
  row: AgentRow;
  kind: Extract<EmployeeEvidenceKind, "sales" | "leads" | "chatwoot">;
}) {
  const { lang } = useI18n();
  const query = `/api/employee-evidence?employee=${encodeURIComponent(row.name)}${row.callExtension ? `&extension=${encodeURIComponent(row.callExtension)}` : ""}${row.chatwootAgentId ? `&chatwoot_agent_id=${row.chatwootAgentId}` : ""}`;
  const { data, isLoading, error, refetch } = useApi<EmployeeEvidenceResponse>(query);
  const outcomeLabel = (outcome: "won" | "open" | "lost") =>
    outcome === "won"
      ? lang === "ar"
        ? "تم البيع"
        : "Won"
      : outcome === "lost"
        ? lang === "ar"
          ? "لم يتم البيع"
          : "Lost"
        : lang === "ar"
          ? "مفتوح"
          : "Open";

  return (
    <section className="space-y-3">
      <div>
        <div className="text-xs font-semibold text-brand">
          {lang === "ar" ? "السجلات الأصلية" : "Source records"}
        </div>
        <h3 className="mt-0.5 text-lg font-bold text-text">
          {kind === "sales"
            ? lang === "ar"
              ? "التحصيل وأوامر البيع"
              : "Collections and sale orders"
            : kind === "leads"
              ? lang === "ar"
                ? "الليدز واتصالات الموظف بها"
                : "Leads and the employee's calls"
              : lang === "ar"
                ? "محادثات الموظف في Chatwoot"
                : "Employee Chatwoot conversations"}
        </h3>
        <p className="mt-1 text-[11px] text-text-muted">
          {lang === "ar"
            ? "هذه القائمة تخص الرقم الذي ضغطت عليه فقط، وكل زر يفتح السجل الأصلي مباشرة."
            : "This list only supports the KPI you opened, and every action opens the original record directly."}
        </p>
      </div>
      {isLoading ? (
        <Skeleton className="h-80" />
      ) : error ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : (
        data && (
          <div>
            {kind === "sales" && (
              <article className="overflow-hidden rounded-2xl border border-border bg-surface">
                <header className="border-b border-border bg-surface-2/65 px-4 py-3">
                  <b className="text-sm text-text">
                    {lang === "ar" ? "أوامر البيع والفواتير" : "Sale orders and invoices"}
                  </b>
                  <p className="mt-0.5 text-[10px] text-text-muted">
                    <bdi dir="ltr" className="num">
                      {fmtNum(data.orders.total)}
                    </bdi>{" "}
                    {lang === "ar" ? "أمر بيع" : "orders"} ·{" "}
                    <bdi dir="ltr" className="num">
                      {fmtUSDFull(data.orders.amount)}
                    </bdi>
                  </p>
                  <p className="mt-0.5 text-[10px] text-text-muted">
                    <bdi dir="ltr" className="num">
                      {fmtNum(data.invoices.paidTotal)}
                    </bdi>{" "}
                    {lang === "ar" ? "فاتورة مدفوعة" : "paid invoices"}
                    {data.invoices.creditNoteTotal > 0 ? (
                      <>
                        {" "}
                        ·{" "}
                        <bdi dir="ltr" className="num">
                          {fmtNum(data.invoices.creditNoteTotal)}
                        </bdi>{" "}
                        {lang === "ar" ? "إشعار دائن" : "credit notes"}
                      </>
                    ) : null}{" "}
                    ·{" "}
                    <bdi dir="ltr" className="num">
                      {fmtUSDFull(data.invoices.amount)}
                    </bdi>
                  </p>
                </header>
                <div className="max-h-72 divide-y divide-border overflow-auto">
                  {data.orders.rows.slice(0, 8).map((order) => (
                    <div key={order.orderRef} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <bdi dir="ltr" className="num text-xs font-semibold text-text">
                          {order.orderRef}
                        </bdi>
                        <strong className="num text-xs text-brand">
                          {fmtUSDFull(order.usdSales)}
                        </strong>
                      </div>
                      <p className="mt-1 truncate text-[10px] text-text-muted">
                        {order.customer || order.course || "—"}
                      </p>
                    </div>
                  ))}
                  {data.orders.rows.length === 0 && (
                    <p className="p-4 text-xs text-text-muted">
                      {lang === "ar"
                        ? "لا توجد أوامر بيع في الفترة."
                        : "No sale orders in this period."}
                    </p>
                  )}
                  {data.invoices.rows.slice(0, 6).map((invoice) => (
                    <div key={invoice.movement} className="bg-surface-2/45 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <bdi
                            dir="ltr"
                            className="num block truncate text-xs font-semibold text-text"
                          >
                            {invoice.movement}
                          </bdi>
                          <small className="mt-0.5 block truncate text-[10px] text-text-muted">
                            {invoice.partner || "—"} · {invoice.paymentDate}
                          </small>
                        </span>
                        <strong
                          className={`num shrink-0 text-xs ${invoice.isCreditNote ? "text-danger" : "text-brand"}`}
                        >
                          {fmtUSDFull(invoice.usdPaid)}
                        </strong>
                      </div>
                      <small className="mt-1 block text-[10px] text-text-muted">
                        {invoice.isCreditNote
                          ? lang === "ar"
                            ? "إشعار دائن مخصوم من الصافي"
                            : "Credit note deducted from net"
                          : lang === "ar"
                            ? "فاتورة مدفوعة"
                            : "Paid invoice"}
                      </small>
                    </div>
                  ))}
                </div>
              </article>
            )}
            {kind === "leads" && (
              <article className="overflow-hidden rounded-2xl border border-border bg-surface">
                <header className="border-b border-border bg-surface-2/65 px-4 py-3">
                  <b className="text-sm text-text">
                    {lang === "ar" ? "الليدز في Odoo" : "Odoo leads"}
                  </b>
                  <p className="mt-0.5 text-[10px] text-text-muted">
                    <bdi dir="ltr" className="num">
                      {fmtNum(data.leads.total)}
                    </bdi>{" "}
                    {lang === "ar" ? "ليد في الفترة" : "leads in period"}
                  </p>
                </header>
                <div className="max-h-72 divide-y divide-border overflow-auto">
                  {data.leads.rows.map((lead) => (
                    <div
                      key={`${lead.outcome}-${lead.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <b className="block truncate text-xs text-text">
                          {lead.contact || lead.phone || `#${lead.id}`}
                        </b>
                        <small className="mt-0.5 block truncate text-[10px] text-text-muted">
                          {outcomeLabel(lead.outcome)} · {lead.course || lead.stage || "—"}
                        </small>
                        <small className="mt-1 block text-[10px] text-text-muted">
                          <bdi dir="ltr" className="num">
                            {fmtNum(lead.ownerCalls)}
                          </bdi>{" "}
                          {lang === "ar" ? "مكالمة من الموظف" : "owner calls"} ·{" "}
                          {lead.calledByOwner
                            ? lang === "ar"
                              ? "تم التواصل"
                              : "contacted"
                            : lang === "ar"
                              ? "لم يتواصل"
                              : "not contacted"}
                        </small>
                      </div>
                      <span className="flex shrink-0 flex-wrap gap-1.5">
                        {lead.latestCallUrl && (
                          <a
                            href={lead.latestCallUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-brand/20 bg-brand-soft/40 px-2.5 py-1.5 text-[10px] font-semibold text-brand hover:bg-brand-soft"
                          >
                            {lang === "ar" ? "فتح آخر مكالمة" : "Open latest call"}
                            <ExternalLink size={11} className="ms-1 inline" />
                          </a>
                        )}
                        {lead.url ? (
                          <a
                            href={lead.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-brand/20 px-2.5 py-1.5 text-[10px] font-semibold text-brand hover:bg-brand-soft"
                          >
                            {lang === "ar" ? "فتح الليد" : "Open lead"}
                            <ExternalLink size={11} className="ms-1 inline" />
                          </a>
                        ) : (
                          <bdi dir="ltr" className="num text-[10px] text-text-muted">
                            #{lead.id}
                          </bdi>
                        )}
                      </span>
                    </div>
                  ))}
                  {data.leads.rows.length === 0 && (
                    <p className="p-4 text-xs text-text-muted">
                      {lang === "ar" ? "لا توجد ليدز في الفترة." : "No leads in this period."}
                    </p>
                  )}
                </div>
              </article>
            )}
            {kind === "chatwoot" && (
              <article className="overflow-hidden rounded-2xl border border-border bg-surface">
                <header className="border-b border-border bg-surface-2/65 px-4 py-3">
                  <b className="text-sm text-text">
                    {lang === "ar" ? "محادثات Chatwoot" : "Chatwoot conversations"}
                  </b>
                  <p className="mt-0.5 text-[10px] text-text-muted">
                    {data.chatwoot ? (
                      <>
                        <bdi dir="ltr" className="num">
                          {fmtNum(data.chatwoot.total)}
                        </bdi>{" "}
                        {lang === "ar" ? "محادثة في الفترة" : "conversations in period"}
                      </>
                    ) : lang === "ar" ? (
                      "لا يوجد موظف Chatwoot مطابق"
                    ) : (
                      "No matched Chatwoot agent"
                    )}
                  </p>
                </header>
                <div className="max-h-72 divide-y divide-border overflow-auto">
                  {data.chatwoot?.conversations.slice(0, 12).map((conversation) => (
                    <a
                      key={conversation.id}
                      href={conversation.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2"
                    >
                      <div className="min-w-0">
                        <b className="block truncate text-xs text-text">
                          {conversation.contactName || `#${conversation.id}`}
                        </b>
                        <small className="mt-0.5 block text-[10px] text-text-muted">
                          {conversation.awaitingReply
                            ? lang === "ar"
                              ? "العميل ينتظر ردًا"
                              : "Customer awaiting reply"
                            : lang === "ar"
                              ? "تم الرد"
                              : "Replied"}{" "}
                          ·{" "}
                          <bdi dir="ltr" className="num">
                            {fmtNum(conversation.unreadMessages)}
                          </bdi>{" "}
                          {lang === "ar" ? "غير مقروءة" : "unread"}
                        </small>
                      </div>
                      <ExternalLink size={13} className="shrink-0 text-brand" />
                    </a>
                  ))}
                  {!data.chatwoot?.conversations.length && (
                    <p className="p-4 text-xs text-text-muted">
                      {data.chatwootError ||
                        (lang === "ar"
                          ? "لا توجد محادثات قابلة للفتح في الفترة."
                          : "No openable conversations in this period.")}
                    </p>
                  )}
                </div>
              </article>
            )}
          </div>
        )
      )}
    </section>
  );
}

function EmployeeEvidenceDialog({
  row,
  kind,
  onOpenChange,
}: {
  row: AgentRow;
  kind: EmployeeEvidenceKind | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { lang } = useI18n();
  const titles: Record<EmployeeEvidenceKind, { ar: string; en: string }> = {
    target: { ar: "دليل التارجت", en: "Target evidence" },
    sales: { ar: "دليل التحصيل والمبيعات", en: "Sales and collections evidence" },
    leads: { ar: "دليل الليدز والاتصالات", en: "Lead and contact evidence" },
    calls: { ar: "دليل المكالمات والجودة", en: "Call and quality evidence" },
    chatwoot: { ar: "دليل محادثات Chatwoot", en: "Chatwoot conversation evidence" },
  };
  return (
    <Dialog open={kind !== null} onOpenChange={onOpenChange}>
      <DialogContent
        dir={lang === "ar" ? "rtl" : "ltr"}
        className="max-h-[88vh] w-[min(94vw,920px)] max-w-none overflow-y-auto rounded-2xl border-border bg-surface p-0 text-text"
      >
        {kind && (
          <>
            <DialogHeader className="sticky top-0 z-10 border-b border-border bg-surface px-5 py-4 pe-12 text-start">
              <DialogTitle>{titles[kind][lang]}</DialogTitle>
              <DialogDescription className="text-xs text-text-muted">
                {lang === "ar"
                  ? `السجلات الخاصة بـ ${row.displayName} في الفترة المختارة فقط. لن نعرض فواتير داخل دليل الليدز أو محادثات داخل دليل المكالمات.`
                  : `Only ${row.displayName}'s records for the selected period. Each evidence view contains one source and one purpose.`}
              </DialogDescription>
            </DialogHeader>
            <div className="p-4 sm:p-5">
              {kind === "target" && (
                <div className="rounded-2xl border border-brand/20 bg-brand-soft/35 p-5">
                  {row.target ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <MiniMetric
                          label={lang === "ar" ? "التارجت المنشور" : "Published target"}
                          value={fmtUSDFull(row.target.target)}
                        />
                        <MiniMetric
                          label={lang === "ar" ? "التحصيل" : "Collections"}
                          value={fmtUSDFull(row.paidRevenue)}
                        />
                        <MiniMetric
                          label={lang === "ar" ? "نسبة الإنجاز" : "Achievement"}
                          value={fmtPct(row.target.achievementPaid, 1)}
                        />
                      </div>
                      <p className="mt-4 text-xs leading-relaxed text-text-muted">
                        {lang === "ar"
                          ? `كود الموظف ${row.target.employeeId} · الشهور: ${row.target.monthsCovered.map((month) => monthLabel(month, lang)).join("، ") || "—"} · المسؤول: ${row.target.teamLeader}.`
                          : `Employee ${row.target.employeeId} · months: ${row.target.monthsCovered.join(", ") || "—"} · owner: ${row.target.teamLeader}.`}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-text-muted">
                      {lang === "ar"
                        ? "لا يوجد تارجت منشور لهذا الموظف في الفترة."
                        : "No published target for this employee and period."}
                    </p>
                  )}
                </div>
              )}
              {(kind === "sales" || kind === "leads" || kind === "chatwoot") && (
                <EmployeeEvidencePanel row={row} kind={kind} />
              )}
              {kind === "calls" && <EmployeeCallsPanel row={row} />}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Achievement pill: green once the prorated quota is met, grey while short. */
function TargetPill({ value }: { value: number | null }) {
  if (value === null) return <span className="num text-text-muted">—</span>;
  return (
    <Pill tone={value >= 100 ? "success" : value >= 70 ? "brand" : "neutral"}>
      {fmtPct(value, 1)}
    </Pill>
  );
}

function AgentCards({
  rows,
  sortBy,
  callsAvailable,
  onSelect,
}: {
  rows: AgentRow[];
  sortBy: "revenue" | "closing" | "calls";
  callsAvailable: boolean;
  onSelect: (row: AgentRow) => void;
}) {
  const { lang } = useI18n();
  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {rows.map((row, index) => (
        <button
          type="button"
          key={row.key}
          onClick={() => onSelect(row)}
          className="card w-full overflow-hidden p-4 text-start transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 sm:p-5"
          aria-label={
            lang === "ar" ? `فتح تحليل ${row.displayName}` : `Open ${row.displayName} analysis`
          }
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-sm font-bold text-brand">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-text" title={row.displayName}>
                    {row.displayName}
                  </h3>
                  <p className="mt-0.5 truncate text-[11px] text-text-muted" title={row.team}>
                    {row.team}
                  </p>
                </div>
              </div>
            </div>
            <Pill
              tone={
                row.decidedConversionRate !== null && row.decidedConversionRate >= 10
                  ? "success"
                  : "neutral"
              }
            >
              {lang === "ar" ? "إغلاق الفترة" : "Period close"}{" "}
              {fmtPct(row.decidedConversionRate, 1)}
            </Pill>
          </div>

          <div className="mt-4 rounded-2xl bg-surface-2 p-3">
            <div className="text-[11px] font-medium text-text-muted">
              {sortBy === "closing"
                ? lang === "ar"
                  ? "إغلاقات رابحة تمت في الفترة"
                  : "Won closures in period"
                : sortBy === "calls"
                  ? lang === "ar"
                    ? "إجمالي المكالمات"
                    : "Total calls"
                  : lang === "ar"
                    ? "التحصيل المدفوع"
                    : "Paid collections"}
            </div>
            <div className="num mt-1 text-xl font-semibold text-text">
              {sortBy === "closing"
                ? fmtNum(row.slaWon)
                : sortBy === "calls"
                  ? row.outboundCalls === null
                    ? "—"
                    : fmtNum(row.outboundCalls)
                  : fmtUSDExact(row.paidRevenue)}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 min-[420px]:grid-cols-3">
            <MiniMetric
              label={lang === "ar" ? "الفواتير" : "Invoices"}
              value={fmtNum(row.invoices)}
            />
            <MiniMetric
              label={lang === "ar" ? "محادثات الشات" : "Chat conversations"}
              value={row.chatConversations === null ? "—" : fmtNum(row.chatConversations)}
              hint={
                row.chatAwaitingReply === null
                  ? undefined
                  : lang === "ar"
                    ? `${fmtNum(row.chatAwaitingReply)} عميل ينتظر رده الآن`
                    : `${fmtNum(row.chatAwaitingReply)} customers await a reply now`
              }
            />
            <MiniMetric
              label={lang === "ar" ? "ليدز دخلت" : "New leads"}
              value={fmtNum(row.cleanLeads)}
            />
            <MiniMetric
              label={lang === "ar" ? "التحصيل" : "Collections"}
              value={fmtUSDExact(row.paidRevenue)}
            />
            <MiniMetric
              label={lang === "ar" ? "إغلاقات رابحة" : "Won closures"}
              value={fmtNum(row.slaWon)}
              hint={
                lang === "ar"
                  ? "صفقات قفلها رابحة، محسوبة بتاريخ القفل مش بتاريخ دخول الليد."
                  : "Deals he closed won, dated by close date — not by when the lead arrived."
              }
            />
            <MiniMetric
              label={lang === "ar" ? "إغلاقات خاسرة" : "Lost closures"}
              value={fmtNum(row.slaLost)}
              hint={
                lang === "ar"
                  ? "صفقات قفلها خاسرة، محسوبة بتاريخ القفل مش بتاريخ دخول الليد."
                  : "Deals he closed lost, dated by close date — not by when the lead arrived."
              }
            />
            <MiniMetric
              label={lang === "ar" ? "المكالمات" : "Calls"}
              value={
                !callsAvailable || row.outboundCalls === null ? "—" : fmtNum(row.outboundCalls)
              }
            />
            <MiniMetric
              label={lang === "ar" ? "وقت الكلام" : "Talk time"}
              value={formatCallHours(row.talkSeconds, lang)}
            />
            <MiniMetric
              label={lang === "ar" ? "جودة المكالمات" : "Call quality"}
              value={fmtQuality(row.averageQualityScore)}
              hint={
                row.analyzedCalls === null
                  ? undefined
                  : lang === "ar"
                    ? `${fmtNum(row.analyzedCalls)} مكالمة محللة`
                    : `${fmtNum(row.analyzedCalls)} analyzed calls`
              }
            />
          </div>

          <div className="mt-4 space-y-2.5">
            {row.target && row.target.target !== null && (
              <ProgressMetric
                label={
                  lang === "ar"
                    ? `إنجاز التارجت (${fmtUSDFull(row.target.target)})`
                    : `Target achievement (${fmtUSDFull(row.target.target)})`
                }
                value={row.target.achievementPaid}
                color="var(--brand)"
              />
            )}
            <ProgressMetric
              label={lang === "ar" ? "نسبة الإغلاق في الفترة" : "Period closure rate"}
              hint={
                lang === "ar"
                  ? "الرابحة ÷ (الرابحة + الخاسرة) من الصفقات اللي اتقفلت في الفترة — بتاريخ القفل، مش بتاريخ دخول الليد. عشان كده مش هتساوي نسبة تحويل الليدز."
                  : "Won ÷ (won + lost) among deals closed inside the window, dated by close date rather than lead date — which is why it will not match lead conversion."
              }
              value={row.decidedConversionRate}
              color="var(--success)"
            />
            <ProgressMetric
              label={lang === "ar" ? "نسبة الرد" : "Answer rate"}
              value={callsAvailable ? row.answerRate : null}
              color="var(--chart-1)"
            />
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3 text-[11px] text-text-muted">
            <span>
              {lang === "ar" ? "رابحة من ليدز الفترة" : "Cohort won"}:{" "}
              <b className="num text-text">{fmtNum(row.won)}</b>
            </span>
            <span>
              {lang === "ar" ? "تم الرد" : "Answered"}:{" "}
              <b className="num text-text">
                {row.answeredCalls === null ? "—" : fmtNum(row.answeredCalls)}
              </b>
            </span>
          </div>
          <div className="mt-3 flex items-center justify-end gap-1 text-[11px] font-semibold text-brand">
            {lang === "ar" ? "تحليل الكورسات والتخصصات" : "Course and specialization analysis"}
            <ArrowUpRight size={14} className="rtl:-rotate-90" />
          </div>
        </button>
      ))}
    </div>
  );
}

function AgentTable({
  rows,
  onSelect,
  onOpenUncalled,
}: {
  rows: AgentRow[];
  onSelect: (row: AgentRow) => void;
  onOpenUncalled: (row: AgentRow) => void;
}) {
  const { lang } = useI18n();
  return (
    <Card padded={false}>
      <div className="border-b border-border p-4 sm:p-5">
        <SectionTitle className="mb-0">
          {lang === "ar" ? "كل الموظفين" : "All employees"}
        </SectionTitle>
      </div>
      <div className="max-h-[680px] overflow-auto">
        <table className="w-full min-w-[2380px] text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr className="text-[11px] uppercase tracking-wide text-text-muted">
              {[
                lang === "ar" ? "الموظف" : "Employee",
                lang === "ar" ? "التارجت" : "Target",
                lang === "ar" ? "التحصيل المدفوع" : "Paid collections",
                lang === "ar" ? "إنجاز التحصيل" : "Collections vs target",
                lang === "ar" ? "إنجاز أوامر البيع" : "Orders vs target",
                lang === "ar" ? "الفواتير" : "Invoices",
                lang === "ar" ? "العملاء" : "Leads",
                lang === "ar" ? "ليدز متوزعة" : "Assigned leads",
                lang === "ar" ? "تواصل بنفسه" : "Contacted by owner",
                lang === "ar" ? "لم يتواصل معهم" : "Not contacted by owner",
                lang === "ar" ? "مكالمات الليدز" : "Lead calls",
                lang === "ar" ? "رابحة" : "Won",
                lang === "ar" ? "خاسرة" : "Lost",
                lang === "ar" ? "نسبة الإغلاق" : "Conversion",
                lang === "ar" ? "إغلاقات الفترة" : "Period closures",
                lang === "ar" ? "المكالمات" : "Calls",
                lang === "ar" ? "تم الرد" : "Answered",
                lang === "ar" ? "ساعات المكالمات" : "Call hours",
                lang === "ar" ? "وقت الكلام" : "Talk time",
                lang === "ar" ? "الجودة" : "Quality",
                lang === "ar" ? "المحادثات" : "Chats",
                lang === "ar" ? "أول رد" : "First response",
                lang === "ar" ? "نسبة الرد" : "Answer rate",
                lang === "ar" ? "لم يتم التواصل" : "Uncontacted",
                lang === "ar" ? "مبيعات SLA التشغيلية" : "SLA operational sales",
              ].map((label, index) => (
                <th
                  key={label}
                  className={`px-3 py-2.5 ${index === 0 ? "text-start" : "text-end"}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className="cursor-pointer border-t border-border transition-colors hover:bg-brand-soft/45 focus-within:bg-brand-soft/45"
                onClick={() => onSelect(row)}
              >
                <td className="px-3 py-3">
                  <button
                    type="button"
                    className="text-start font-semibold text-text outline-none focus-visible:text-brand"
                    onClick={() => onSelect(row)}
                  >
                    {row.displayName}
                  </button>
                  <div
                    className="mt-0.5 max-w-[220px] truncate text-[11px] text-text-muted"
                    title={row.team}
                  >
                    {row.team}
                  </div>
                </td>
                <td className="px-3 py-3 text-end">
                  <div className="num font-semibold">
                    {row.target?.target === null || !row.target
                      ? "—"
                      : fmtUSDFull(row.target.target)}
                  </div>
                  <div className="mt-0.5 text-[10px] text-text-muted">
                    {!row.target
                      ? lang === "ar"
                        ? "بدون تارجت"
                        : "No target"
                      : row.target.target === null
                        ? row.target.note || (lang === "ar" ? "غير مستهدف" : "Untargeted")
                        : row.target.teamLeader}
                  </div>
                </td>
                <td className="num px-3 py-3 text-end font-semibold">
                  {fmtUSDExact(row.paidRevenue)}
                </td>
                <td className="px-3 py-3 text-end">
                  <TargetPill value={row.target?.achievementPaid ?? null} />
                </td>
                <td className="px-3 py-3 text-end">
                  <TargetPill value={row.target?.achievementOrders ?? null} />
                </td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.invoices)}</td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.cleanLeads)}</td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.distributedLeads)}</td>
                <td className="num px-3 py-3 text-end">
                  {row.ownerCalledDistributedLeads === null
                    ? "—"
                    : fmtNum(row.ownerCalledDistributedLeads)}
                </td>
                <td className="px-3 py-3 text-end">
                  {row.ownerCalledDistributedLeads === null ? (
                    <span className="num text-text-muted">—</span>
                  ) : (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenUncalled(row);
                      }}
                      className="group inline-flex items-center gap-1 rounded-lg border border-brand/20 bg-brand-soft/25 px-2 py-1 font-semibold text-brand hover:border-brand/45 hover:bg-brand-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                      aria-label={
                        lang === "ar"
                          ? `عرض ليدز ${row.displayName} التي لم يتواصل معها`
                          : `Show leads ${row.displayName} did not contact`
                      }
                    >
                      <bdi dir="ltr" className="num">
                        {fmtNum(
                          Math.max(0, row.distributedLeads - row.ownerCalledDistributedLeads),
                        )}
                      </bdi>
                      <ArrowUpRight
                        size={12}
                        className="transition-transform group-hover:-translate-y-0.5"
                      />
                    </button>
                  )}
                </td>
                <td className="num px-3 py-3 text-end">
                  {row.callsFromDistributedLeads === null
                    ? "—"
                    : fmtNum(row.callsFromDistributedLeads)}
                </td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.won)}</td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.lost)}</td>
                <td className="px-3 py-3 text-end">
                  <Pill
                    tone={
                      row.conversionRate !== null && row.conversionRate >= 10
                        ? "success"
                        : "neutral"
                    }
                  >
                    {fmtPct(row.conversionRate, 1)}
                  </Pill>
                </td>
                <td className="num px-3 py-3 text-end">
                  {fmtNum(row.slaWon)} / {fmtNum(row.slaLost)}
                </td>
                <td className="num px-3 py-3 text-end">
                  {row.outboundCalls === null ? "—" : fmtNum(row.outboundCalls)}
                </td>
                <td className="num px-3 py-3 text-end">
                  {row.answeredCalls === null ? "—" : fmtNum(row.answeredCalls)}
                </td>
                <td className="num px-3 py-3 text-end">
                  {formatCallHours(row.totalCallSeconds, lang)}
                </td>
                <td className="num px-3 py-3 text-end">{formatCallHours(row.talkSeconds, lang)}</td>
                <td className="px-3 py-3 text-end">
                  <Pill tone={qualityTone(row.averageQualityScore)}>
                    {fmtQuality(row.averageQualityScore)}
                  </Pill>
                  <div className="mt-0.5 text-[10px] text-text-muted">
                    {row.analyzedCalls === null
                      ? "—"
                      : `${fmtNum(row.analyzedCalls)} ${lang === "ar" ? "مكالمة محللة" : "analyzed calls"}`}
                  </div>
                </td>
                <td className="num px-3 py-3 text-end">
                  {row.chatConversations === null ? "—" : fmtNum(row.chatConversations)}
                  <div className="mt-1 flex flex-col gap-0.5 text-[10px] text-text-muted">
                    <span>
                      {row.chatAwaitingReply === null
                        ? "—"
                        : `${fmtNum(row.chatAwaitingReply)} ${lang === "ar" ? "تنتظر رد الموظف" : "await employee reply"}`}
                    </span>
                    <span>
                      {row.chatOpenConversations === null
                        ? "—"
                        : `${fmtNum(row.chatOpenConversations)} ${lang === "ar" ? "مفتوحة الآن" : "open now"}`}
                    </span>
                  </div>
                </td>
                <td className="num px-3 py-3 text-end">
                  {formatCallDuration(row.chatAverageFirstResponseSeconds, lang)}
                </td>
                <td className="num px-3 py-3 text-end">{fmtPct(row.answerRate, 1)}</td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.uncontactedLeads)}</td>
                <td className="num px-3 py-3 text-end">
                  {row.operationalSales === null
                    ? "—"
                    : row.operationalSales.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  <span className="ms-1 text-[10px] text-text-muted">
                    {lang === "ar" ? "عملة أودو" : "Odoo currency"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AgentPerformanceSheet({
  row,
  open,
  onOpenChange,
}: {
  row: AgentRow | null;
  /** False when Odoo's operational sales report has no feed behind it at all. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { lang } = useI18n();
  const [courseMetric, setCourseMetric] = useState<"revenue" | "invoices" | "leads">("revenue");
  const [invoiceCourse, setInvoiceCourse] = useState<AgentCoursePerformance | null>(null);
  const [evidenceKind, setEvidenceKind] = useState<EmployeeEvidenceKind | null>(null);
  const [uncalledScope, setUncalledScope] = useState<UncalledScope | null>(null);
  useEffect(() => {
    setCourseMetric("revenue");
    // Closing the sheet with the dialog open leaves it open. Without this it
    // reopens on the next employee, showing one person's invoices under
    // another person's name.
    setInvoiceCourse(null);
    setEvidenceKind(null);
    setUncalledScope(null);
  }, [row?.key]);
  useEffect(() => {
    if (
      !row ||
      !open ||
      typeof window === "undefined" ||
      !window.location.hash.startsWith("#employee-")
    )
      return;
    const timer = window.setTimeout(() => {
      document
        .getElementById(window.location.hash.slice(1))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 160);
    return () => window.clearTimeout(timer);
  }, [open, row?.key]);
  if (!row) return null;

  const { courseProfile } = row;
  const { totals } = courseProfile;
  // The second fact on every summary card. Whichever basis a card ranks on, the
  // other one sits underneath it, so no card can be read out of context.
  //
  // These read "X رابحة من Y ليد" rather than "X Won / Y ليد". Two problems were
  // fixed here at once. A slash between a Latin word and an Arabic one has no
  // direction of its own, so the numbers could land either way round and the
  // line degenerated into "2 10" with nothing saying which was which. And the
  // bare Latin "Won" was its own reversal: an English run inside an Arabic
  // paragraph is laid out left-to-right within a right-to-left line, so "1 Won"
  // read as "Won 1" on screen. An Arabic word carries the relationship in the
  // direction the rest of the sentence is already going.
  const cohortLine = (course: AgentCoursePerformance) =>
    lang === "ar"
      ? `${fmtNum(course.won)} رابحة من ${fmtNum(course.leads)} ليد · ${fmtPct(course.conversionRate, 1)}`
      : `${fmtNum(course.won)} won of ${fmtNum(course.leads)} leads · ${fmtPct(course.conversionRate, 1)}`;
  const moneyLine = (course: AgentCoursePerformance) =>
    `${fmtUSDFull(course.paidRevenue)} · ${invoiceCount(course.invoices, lang)}`;
  const metricConfig = {
    revenue: {
      value: (course: AgentCoursePerformance) => course.paidRevenue,
      format: fmtUSDFull,
      name: lang === "ar" ? "المبيعات" : "Sales",
    },
    invoices: {
      value: (course: AgentCoursePerformance) => course.invoices,
      format: fmtNum,
      name: lang === "ar" ? "الفواتير" : "Invoices",
    },
    leads: {
      value: (course: AgentCoursePerformance) => course.leads,
      format: fmtNum,
      name: lang === "ar" ? "الليدز" : "Leads",
    },
  }[courseMetric];
  const courseChart = [...courseProfile.courses]
    .filter((course) => metricConfig.value(course) > 0)
    .sort((left, right) => metricConfig.value(right) - metricConfig.value(left))
    .slice(0, 10)
    .map((course) => ({ label: course.label, value: metricConfig.value(course) }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <EmployeeEvidenceContext.Provider value={{ openEvidence: setEvidenceKind }}>
        <SheetContent
          side={lang === "ar" ? "left" : "right"}
          className="w-[min(100vw,1040px)] max-w-none overflow-y-auto border-border bg-surface p-0 text-text [&>button]:z-30 [&>button]:text-white [&>button]:opacity-100 rtl:[&>button]:left-4 rtl:[&>button]:right-auto sm:max-w-[1040px]"
          dir={lang === "ar" ? "rtl" : "ltr"}
        >
          <div className="sticky top-0 z-20 overflow-hidden border-b border-white/10 bg-[linear-gradient(135deg,var(--brand),color-mix(in_srgb,var(--brand)_72%,#08142e))] px-5 py-6 text-white sm:px-7">
            <div className="pointer-events-none absolute -end-16 -top-20 h-52 w-52 rounded-full border-[34px] border-white/8" />
            <SheetHeader className="relative pe-8 text-start sm:text-start">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-white/70">
                <span className="rounded-full bg-white/12 px-2.5 py-1">
                  {lang === "ar" ? "ملف أداء الموظف" : "Employee performance profile"}
                </span>
                <span>{row.team}</span>
              </div>
              <SheetTitle className="text-2xl font-bold text-white sm:text-3xl">
                {row.displayName}
              </SheetTitle>
              <SheetDescription className="max-w-3xl text-xs leading-relaxed text-white/72 sm:text-sm">
                {lang === "ar"
                  ? "تفصيل التحصيل والليدز والتحويل حسب كل كورس وتخصص داخل الفترة والفلاتر المختارة."
                  : "Paid collections, leads, and conversion by course and specialization for the selected period and filters."}
              </SheetDescription>
            </SheetHeader>
          </div>

          <div className="space-y-5 p-4 sm:p-7">
            <EmployeeScoreSummary row={row} />
            {row.target && <AgentTargetPanel target={row.target} row={row} />}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <ProfileMetric
                label={lang === "ar" ? "التحصيل المدفوع" : "Paid collections"}
                explain="paidCollections"
                value={fmtUSDFull(row.paidRevenue)}
                sub={invoiceCount(row.invoices, lang)}
                icon={<ReceiptText size={17} />}
                hero
                evidenceHref="#employee-sales-evidence"
              />
              <ProfileMetric
                label={lang === "ar" ? "إجمالي الليدز" : "Total leads"}
                explain="totalLeads"
                value={fmtNum(row.cleanLeads)}
                sub={
                  lang === "ar"
                    ? `${fmtNum(row.won)} رابحة · ${fmtNum(row.lost)} خاسرة`
                    : `${fmtNum(row.won)} won · ${fmtNum(row.lost)} lost`
                }
                icon={<Users size={17} />}
                evidenceHref="#employee-lead-evidence"
              />
              <ProfileMetric
                label={lang === "ar" ? "تحويل كل الليدز" : "Lead conversion"}
                explain="conversionAll"
                value={fmtPct(row.conversionRate, 1)}
                sub={lang === "ar" ? "الرابحة ÷ إجمالي الليدز" : "Won ÷ all leads"}
                icon={<ChartNoAxesCombined size={17} />}
                evidenceHref="#employee-lead-evidence"
              />
              <ProfileMetric
                label={lang === "ar" ? "نسبة الإغلاق في الفترة" : "Period closure rate"}
                explain="periodClosureRate"
                value={fmtPct(row.decidedConversionRate, 1)}
                sub={
                  lang === "ar"
                    ? `${fmtNum(row.slaWon)} رابحة · ${fmtNum(row.slaLost)} خاسرة · اتقفلوا في الفترة`
                    : `${fmtNum(row.slaWon)} won · ${fmtNum(row.slaLost)} lost · closed in period`
                }
                icon={<Trophy size={17} />}
                evidenceHref="#employee-lead-evidence"
              />
            </div>

            <section className="space-y-3" aria-labelledby="employee-lead-execution-title">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-brand">
                    {lang === "ar" ? "التواصل والبيع" : "Lead execution"}
                  </div>
                  <h3
                    id="employee-lead-execution-title"
                    className="mt-0.5 text-lg font-bold text-text"
                  >
                    {lang === "ar"
                      ? "هل اتصل الموظف بالليدز التي وُزعت عليه؟"
                      : "Did the employee contact their assigned leads?"}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setUncalledScope("owner")}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-brand/25 bg-brand-soft/30 px-3 text-[11px] font-semibold text-brand transition-colors hover:bg-brand-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                >
                  <PhoneCall size={13} />
                  {lang === "ar" ? "فلتر الليدز التي لم يتواصل معها" : "Filter leads not contacted"}
                </button>
              </div>
              <div className="rounded-2xl border border-border bg-surface p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <b className="text-sm text-text">
                    {lang === "ar" ? "تغطية الليدز بواسطة صاحب الليد" : "Owner lead coverage"}
                  </b>
                  <Pill
                    tone={
                      row.leadOwnerCallCoverageRate === null
                        ? "neutral"
                        : row.leadOwnerCallCoverageRate >= 80
                          ? "success"
                          : "warning"
                    }
                  >
                    {fmtPct(row.leadOwnerCallCoverageRate, 1)}
                  </Pill>
                </div>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                  <MiniMetric
                    label={lang === "ar" ? "موزعة عليه" : "Assigned"}
                    value={fmtNum(row.distributedLeads)}
                  />
                  <MiniMetric
                    label={lang === "ar" ? "تواصل معها بنفسه" : "Contacted by this employee"}
                    value={
                      row.ownerCalledDistributedLeads === null
                        ? "—"
                        : fmtNum(row.ownerCalledDistributedLeads)
                    }
                  />
                  <MiniMetric
                    label={lang === "ar" ? "لم يتواصل معها هو" : "Not contacted by this employee"}
                    value={
                      row.ownerCalledDistributedLeads === null
                        ? "—"
                        : fmtNum(
                            Math.max(0, row.distributedLeads - row.ownerCalledDistributedLeads),
                          )
                    }
                    hint={
                      lang === "ar"
                        ? "يشمل ليدز تابعها زميل آخر"
                        : "Includes leads handled by a colleague"
                    }
                    onDrill={
                      row.ownerCalledDistributedLeads === null
                        ? undefined
                        : () => setUncalledScope("owner")
                    }
                    drillLabel={
                      lang === "ar"
                        ? `اعرض ليدز ${row.displayName} التي لم يتواصل معها`
                        : `Show the leads ${row.displayName} never contacted`
                    }
                  />
                  <MiniMetric
                    label={lang === "ar" ? "تواصل معها أي موظف" : "Contacted by any employee"}
                    value={
                      row.calledDistributedLeads === null ? "—" : fmtNum(row.calledDistributedLeads)
                    }
                  />
                  <MiniMetric
                    label={lang === "ar" ? "لم يتواصل معها أحد" : "Never contacted by anyone"}
                    value={
                      row.uncalledDistributedLeads === null
                        ? "—"
                        : fmtNum(row.uncalledDistributedLeads)
                    }
                    hint={
                      lang === "ar"
                        ? "لا مكالمة ولا رسالة أو رد من موظف"
                        : "No employee call, message, or reply"
                    }
                    onDrill={
                      row.uncalledDistributedLeads === null
                        ? undefined
                        : () => setUncalledScope("none")
                    }
                    drillLabel={
                      lang === "ar"
                        ? `اعرض ليدز ${row.displayName} التي لم يتواصل معها أحد`
                        : `Show ${row.displayName}'s leads that nobody contacted`
                    }
                  />
                  <MiniMetric
                    label={lang === "ar" ? "كل مكالمات الليدز" : "All lead calls"}
                    value={
                      row.callsFromDistributedLeads === null
                        ? "—"
                        : fmtNum(row.callsFromDistributedLeads)
                    }
                  />
                  <MiniMetric
                    label={lang === "ar" ? "مكالمات الموظف نفسه" : "Calls by assigned employee"}
                    value={
                      row.callsByAssignedEmployee === null
                        ? "—"
                        : fmtNum(row.callsByAssignedEmployee)
                    }
                  />
                  <MiniMetric
                    label={lang === "ar" ? "مكالمات الموظف لكل ليد" : "Owner calls per lead"}
                    value={
                      row.callsByAssignedEmployee === null || row.distributedLeads <= 0
                        ? "—"
                        : (row.callsByAssignedEmployee / row.distributedLeads).toFixed(2)
                    }
                    hint={
                      lang === "ar"
                        ? `${row.callsByAssignedEmployee === null ? "—" : fmtNum(row.callsByAssignedEmployee)} مكالمة ÷ ${fmtNum(row.distributedLeads)} ليد في الفترة`
                        : `${row.callsByAssignedEmployee === null ? "—" : fmtNum(row.callsByAssignedEmployee)} calls ÷ ${fmtNum(row.distributedLeads)} period leads`
                    }
                  />
                  <MiniMetric
                    label={lang === "ar" ? "نسبة إغلاق الفترة" : "Period close rate"}
                    value={fmtPct(row.decidedConversionRate, 1)}
                    hint={
                      lang === "ar"
                        ? `${fmtNum(row.slaWon)} رابحة من ${fmtNum(row.slaWon + row.slaLost)} صفقة متحسمة`
                        : `${fmtNum(row.slaWon)} won of ${fmtNum(row.slaWon + row.slaLost)} decided deals`
                    }
                  />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-brand">
                    {lang === "ar" ? "أداء المكالمات" : "Call performance"}
                  </div>
                  <h3 className="mt-0.5 text-lg font-bold text-text">
                    {lang === "ar"
                      ? "المكالمات ووقت الحديث والجودة"
                      : "Calls, talk time, and quality"}
                  </h3>
                  <p className="mt-1 text-[11px] text-text-muted">
                    {lang === "ar"
                      ? "كل الأرقام محسوبة على نفس الفترة المختارة أعلى الصفحة؛ وقت الكلام الفعلي لا يشمل الرنين والانتظار."
                      : "Every figure uses the selected page date range; actual talk time excludes ringing and waiting."}
                  </p>
                </div>
                <EvidenceLink href="#employee-call-evidence" />
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <ProfileMetric
                  label={lang === "ar" ? "إجمالي المكالمات" : "Total calls"}
                  value={row.totalCalls === null ? "—" : fmtNum(row.totalCalls)}
                  sub={
                    row.answeredCalls === null
                      ? lang === "ar"
                        ? "غير مربوط بامتداد Yeastar"
                        : "No Yeastar extension matched"
                      : `${fmtNum(row.answeredCalls)} ${lang === "ar" ? "تم الرد" : "answered"} · ${fmtPct(row.answerRate, 1)}`
                  }
                  icon={<PhoneCall size={17} />}
                  evidenceHref="#employee-call-evidence"
                />
                <ProfileMetric
                  label={lang === "ar" ? "الوقت من الاتصال إلى الإغلاق" : "Dial-to-hangup time"}
                  value={formatCallHours(row.totalCallSeconds, lang)}
                  sub={
                    lang === "ar"
                      ? `${formatCallHours(row.talkSeconds, lang)} حديث فعلي مع العملاء`
                      : `${formatCallHours(row.talkSeconds, lang)} actual talk time`
                  }
                  icon={<Clock3 size={17} />}
                  evidenceHref="#employee-call-evidence"
                />
                <ProfileMetric
                  label={lang === "ar" ? "متوسط مدة المكالمة" : "Average call length"}
                  value={formatCallDuration(row.averageCallSeconds, lang)}
                  sub={lang === "ar" ? "للمكالمات التي تم الرد عليها" : "Across answered calls"}
                  icon={<AudioLines size={17} />}
                  evidenceHref="#employee-call-evidence"
                />
                <ProfileMetric
                  label={lang === "ar" ? "متوسط الجودة" : "Average quality"}
                  value={fmtQuality(row.averageQualityScore)}
                  sub={
                    row.analyzedCalls === null
                      ? lang === "ar"
                        ? "التقييم غير متاح"
                        : "Quality unavailable"
                      : lang === "ar"
                        ? `${fmtNum(row.analyzedCalls)} مكالمة محللة · ${fmtNum(row.qualityNeedsReview ?? 0)} تحتاج مراجعة`
                        : `${fmtNum(row.analyzedCalls)} analyzed · ${fmtNum(row.qualityNeedsReview ?? 0)} to review`
                  }
                  icon={<CircleGauge size={17} />}
                  evidenceHref="#employee-call-evidence"
                />
              </div>
              <div className="rounded-2xl border border-border bg-surface p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <b className="text-sm text-text">
                    {lang === "ar" ? "أداء محادثات Chatwoot" : "Chatwoot conversation performance"}
                  </b>
                  <span className="flex items-center gap-2">
                    <EvidenceLink href="#employee-chat-evidence" />
                    <Pill tone={row.chatConversations === null ? "neutral" : "success"}>
                      {row.chatConversations === null
                        ? lang === "ar"
                          ? "غير مطابق"
                          : "Not matched"
                        : "Connected"}
                    </Pill>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                  <MiniMetric
                    label={lang === "ar" ? "كل محادثات الفترة" : "All conversations in period"}
                    value={row.chatConversations === null ? "—" : fmtNum(row.chatConversations)}
                  />
                  <MiniMetric
                    label={lang === "ar" ? "تم التعامل معها وإغلاقها" : "Handled and resolved"}
                    value={row.chatResolved === null ? "—" : fmtNum(row.chatResolved)}
                  />
                  <MiniMetric
                    label={lang === "ar" ? "تنتظر رد الموظف الآن" : "Await employee reply now"}
                    value={row.chatAwaitingReply === null ? "—" : fmtNum(row.chatAwaitingReply)}
                  />
                  <MiniMetric
                    label={lang === "ar" ? "كل المفتوح الآن" : "All open now"}
                    value={
                      row.chatOpenConversations === null ? "—" : fmtNum(row.chatOpenConversations)
                    }
                  />
                  <MiniMetric
                    label={lang === "ar" ? "مفتوحة ولا تنتظر رده" : "Open, not awaiting agent"}
                    value={
                      row.chatOpenConversations === null || row.chatAwaitingReply === null
                        ? "—"
                        : fmtNum(Math.max(0, row.chatOpenConversations - row.chatAwaitingReply))
                    }
                  />
                  <MiniMetric
                    label={lang === "ar" ? "متوسط أول رد" : "Avg. first response"}
                    value={formatCallDuration(row.chatAverageFirstResponseSeconds, lang)}
                  />
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
                  {lang === "ar"
                    ? "«كل محادثات الفترة» و«تم إغلاقها» حسب التاريخ المختار. أما «المفتوح الآن» و«تنتظر رد الموظف» فهي حالة Chatwoot الحالية. لأن الفريق لا يغلق كل المحادثات، فعدد المنتظرين هو المؤشر الأوضح لمن يحتاج ردًا الآن."
                    : "Period conversations and resolved conversations follow the selected dates. Open and awaiting-reply counts are the current Chatwoot workload. Because not every conversation is closed, awaiting reply is the clearest action metric."}
                </p>
              </div>
            </section>

            {!courseProfile.lostDataAvailable && (
              <Notice
                tone="warning"
                title={
                  lang === "ar"
                    ? "بيانات Lost غير مكتملة حاليًا"
                    : "Lost data is currently incomplete"
                }
              >
                {lang === "ar"
                  ? "المبيعات وتوزيع الليدز متاحان، لكن تقييم أفضل تحويل والكورس المحتاج دعم متوقف مؤقتًا حتى يعود مصدر Archived Lost؛ النسب الحالية استرشادية فقط."
                  : "Sales and lead distribution remain available, but best-conversion and needs-support judgments are paused until Archived Lost returns; current rates are directional only."}
              </Notice>
            )}

            <section>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-brand">
                    {lang === "ar" ? "الخلاصة التنفيذية" : "Executive summary"}
                  </div>
                  <h3 className="mt-0.5 text-lg font-bold text-text">
                    {lang === "ar"
                      ? "قوي في إيه وضعيف في إيه — من الكورسات اللي بيبيعها"
                      : "Strongest and weakest — within the courses he sells"}
                  </h3>
                  {/* The population is stated on the section, not buried in a
                    footnote: all four cards below rank the same courses. */}
                  <p className="mt-1 text-[11px] text-text-muted">
                    {lang === "ar"
                      ? `الأربع كروت دي كلها بتترتب على ${fmtNum(courseProfile.soldTotals.courses)} كورس دخل فيهم بيع أو قفل فيهم صفقة رابحة — الكورسات اللي جاتله ليدز ومحصلش فيها لا بيع ولا صفقة رابحة متحسبش عليه، وموضّحة تحت لوحدها. الكورس اللي قفل فيه صفقة لسه فاتورتها مجتش بيبان بـ$0، وده مش خطأ: الفلوس محسوبة بتاريخ الدفع.`
                      : `All four cards rank the same ${fmtNum(courseProfile.soldTotals.courses)} courses he has either sold or won a deal in. Courses that only received leads are never counted against him; they are reported separately below. A course he won but whose invoice has not landed yet shows $0 — collections are dated by payment, so that is timing, not an error.`}
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {/* Each card carries money *and* cohort, because the row is read
                  left to right as one comparison. Showing revenue on two cards
                  and a bare percentage on the others is what let a $0 course sit
                  beside the best seller looking like its peer. */}
                <CourseInsight
                  icon={<TrendingUp size={18} />}
                  eyebrow={lang === "ar" ? "أفضل مبيعات" : "Best sales"}
                  onOpenInvoices={setInvoiceCourse}
                  explain="bestSelling"
                  course={courseProfile.bestSellingCourse}
                  value={(course) => fmtUSDFull(course.paidRevenue)}
                  sub={(course) =>
                    `${fmtPct(course.salesShare, 1)} ${lang === "ar" ? "من مبيعات الموظف" : "of employee sales"}`
                  }
                  foot={cohortLine}
                  tone="success"
                  empty={
                    lang === "ar"
                      ? "مفيش أي بيع للموظف في الفترة دي"
                      : "No sale at all in this period"
                  }
                />
                <CourseInsight
                  icon={<TrendingDown size={18} />}
                  eyebrow={lang === "ar" ? "أقل مبيعات" : "Lowest sales"}
                  onOpenInvoices={setInvoiceCourse}
                  explain="leastSelling"
                  course={courseProfile.leastSellingCourse}
                  value={(course) => fmtUSDFull(course.paidRevenue)}
                  // $0 here means a course he won in but has not been paid for
                  // yet, not a course he was never selling — those are excluded
                  // from this row entirely.
                  sub={(course) =>
                    course.paidRevenue === 0 && course.invoices === 0
                      ? lang === "ar"
                        ? `${fmtNum(course.won)} صفقة رابحة لسه فاتورتها مجتش`
                        : `${fmtNum(course.won)} won, not yet invoiced`
                      : invoiceCount(course.invoices, lang)
                  }
                  foot={cohortLine}
                  tone="neutral"
                  empty={
                    lang === "ar"
                      ? "كورس واحد بس فيه بيع — مفيش مقارنة"
                      : "Only one course sold — nothing to compare"
                  }
                />
                <CourseInsight
                  icon={<Sparkles size={18} />}
                  eyebrow={lang === "ar" ? "أفضل تحويل" : "Best conversion"}
                  onOpenInvoices={setInvoiceCourse}
                  explain="bestConverting"
                  course={courseProfile.bestConvertingCourse}
                  value={(course) => fmtPct(course.conversionRate, 1)}
                  sub={(course) =>
                    lang === "ar"
                      ? `${fmtNum(course.won)} رابحة من ${fmtNum(course.leads)} ليد`
                      : `${fmtNum(course.won)} won of ${fmtNum(course.leads)} leads`
                  }
                  foot={moneyLine}
                  tone="brand"
                  // Three different reasons, three different sentences. A cohort
                  // can be perfectly large and still hold no win yet, so this must
                  // never read as "not enough data".
                  empty={
                    courseProfile.bestReason === "no_win_yet"
                      ? lang === "ar"
                        ? "لسه مفيش ولا صفقة رابحة في أي كورس بيبيعه من ليدز الفترة دي"
                        : "No lead from this period has been won yet in a course he sells"
                      : courseProfile.bestReason === "no_book"
                        ? lang === "ar"
                          ? "مفيش كورس باعه في الفترة دي عشان نحكم عليه"
                          : "He sold no course in this period, so there is nothing to rank"
                        : lang === "ar"
                          ? `مفيش كورس باعه وصل ${fmtNum(courseProfile.minimumLeadSample)} ليدز في الفترة دي`
                          : `No course he sells reached ${fmtNum(courseProfile.minimumLeadSample)} leads in this period`
                  }
                />
                <CourseInsight
                  icon={<Layers3 size={18} />}
                  eyebrow={lang === "ar" ? "يحتاج دعم" : "Needs support"}
                  onOpenInvoices={setInvoiceCourse}
                  explain="needsSupport"
                  course={courseProfile.needsSupportCourse}
                  value={(course) => fmtPct(course.conversionRate, 1)}
                  sub={(course) =>
                    `${fmtNum(course.won + course.lost)} ${lang === "ar" ? "محسومة من" : "decided of"} ${fmtNum(course.leads)} ${lang === "ar" ? "ليد" : "leads"}`
                  }
                  foot={moneyLine}
                  tone="danger"
                  // A course whose cohort is mostly still open is not a proven
                  // weakness. Saying "not enough sample" would be wrong — the
                  // sample is large, it just has not finished.
                  empty={
                    courseProfile.needsSupportReason === "too_few_decided"
                      ? lang === "ar"
                        ? `لسه مفيش كورس اتحسم فيه ${fmtNum(courseProfile.minimumDecidedSample)} ليدز — أقل من كده الرقم بيبقى صدفة مش نتيجة.`
                        : `No course has ${fmtNum(courseProfile.minimumDecidedSample)} settled leads yet — below that the rate is chance, not a result.`
                      : courseProfile.needsSupportReason === "no_book"
                        ? lang === "ar"
                          ? "مفيش كورس باعه في الفترة دي عشان نحكم عليه"
                          : "He sold no course in this period, so there is nothing to rank"
                        : lang === "ar"
                          ? "مفيش كورس بيبيعه اتحسمت ليدزه وطلع ضعيف"
                          : "No course he sells has a decided cohort that went badly"
                  }
                />
              </div>
              <NonCourseLine profile={courseProfile} />
            </section>

            <CourseLeadTotals profile={courseProfile} />
            <UnsoldCoursesNotice profile={courseProfile} />

            <div className="grid items-start gap-4 xl:grid-cols-[1.2fr_.8fr]">
              <Card>
                <SectionTitle
                  hint={lang === "ar" ? "أعلى 10 كورسات في الفترة" : "Top 10 courses in the period"}
                  action={
                    <Segmented
                      value={courseMetric}
                      onChange={setCourseMetric}
                      options={[
                        { value: "revenue", label: lang === "ar" ? "المبيعات" : "Sales" },
                        { value: "invoices", label: lang === "ar" ? "الفواتير" : "Invoices" },
                        { value: "leads", label: lang === "ar" ? "الليدز" : "Leads" },
                      ]}
                    />
                  }
                >
                  {lang === "ar" ? "أداء كل كورس" : "Performance by course"}
                </SectionTitle>
                <HBarChart
                  data={courseChart}
                  height={Math.max(260, courseChart.length * 38)}
                  color="var(--chart-1)"
                  format={metricConfig.format}
                  name={metricConfig.name}
                  labelWidth={132}
                  showValues
                />
              </Card>

              <Card>
                <SectionTitle hint={lang === "ar" ? "حسب عدد الليدز" : "By lead count"}>
                  {lang === "ar"
                    ? "توزيع الليدز حسب التخصص"
                    : "Lead distribution by specialization"}
                </SectionTitle>
                <DonutChart
                  data={courseProfile.specializations
                    .filter((item) => item.leads > 0)
                    .map((item) => ({
                      label: displayDimension(item.label, lang),
                      value: item.leads,
                      color: SPECIALIZATION_COLORS[item.key],
                    }))}
                  /* Fixed: the ring no longer grows with the slice count now that
                   the legend is a list beneath it rather than wrapped inside. */
                  height={244}
                  format={fmtNum}
                  centerCaption={lang === "ar" ? "إجمالي الليدز" : "Total leads"}
                />
              </Card>
            </div>

            <Card padded={false}>
              <div className="border-b border-border p-4 sm:p-5">
                <SectionTitle className="mb-0">
                  {lang === "ar" ? "تحليل التخصصات" : "Specialization analysis"}
                </SectionTitle>
                <p className="mt-1 text-xs text-text-muted">
                  {lang === "ar"
                    ? "الحجم يوضح توزيع الفرص، والتحويل يوضح النتيجة بعد مراعاة عدد الليدز."
                    : "Volume shows opportunity distribution; conversion shows outcomes relative to lead count."}
                </p>
              </div>
              <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
                {courseProfile.specializations.map((item) => (
                  <SpecializationCard key={item.key} item={item} lang={lang} />
                ))}
              </div>
            </Card>

            <Card padded={false}>
              <div className="border-b border-border p-4 sm:p-5">
                <SectionTitle className="mb-0">
                  {lang === "ar" ? "التفاصيل الكاملة حسب الكورس" : "Full course detail"}
                </SectionTitle>
              </div>
              <div className="max-h-[620px] overflow-auto">
                <table className="w-full min-w-[1180px] text-sm">
                  <thead className="sticky top-0 z-10 bg-surface-2">
                    <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                      {[
                        lang === "ar" ? "الكورس" : "Course",
                        lang === "ar" ? "التخصص" : "Specialization",
                        lang === "ar" ? "الليدز" : "Leads",
                        lang === "ar" ? "رابحة" : "Won",
                        lang === "ar" ? "خاسرة" : "Lost",
                        lang === "ar" ? "مفتوح" : "Open",
                        lang === "ar" ? "تحويل الليدز" : "Lead conversion",
                        lang === "ar" ? "تحويل المحسوم" : "Decided conversion",
                        lang === "ar" ? "الفواتير" : "Invoices",
                        lang === "ar" ? "المبيعات" : "Sales",
                        lang === "ar" ? "% المبيعات" : "Sales share",
                        lang === "ar" ? "حجم العينة" : "Sample",
                      ].map((label, index) => (
                        <th
                          key={`${label}-${index}`}
                          className={`px-3 py-2.5 ${index < 2 ? "text-start" : "text-end"}`}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {courseProfile.courses.map((course) => (
                      <tr key={course.key} className="border-t border-border hover:bg-surface-2/70">
                        <td className="px-3 py-3 font-semibold text-text">
                          {/* The course name is the handle for its invoices. A
                            revenue figure with no way to reach the move numbers
                            behind it cannot be checked against Odoo. */}
                          <button
                            type="button"
                            onClick={() => setInvoiceCourse(course)}
                            title={dimensionNote(course.label, lang)}
                            className="inline-flex items-center gap-1.5 rounded text-start underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                          >
                            {displayDimension(course.label, lang)}
                            <ReceiptText
                              size={13}
                              className="shrink-0 text-text-muted"
                              aria-hidden="true"
                            />
                            <span className="sr-only">
                              {lang === "ar" ? "اعرض فواتير الكورس" : "Show this course's invoices"}
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-3 text-text-muted">
                          {displayDimension(course.mainCategory, lang)}
                        </td>
                        <td className="num px-3 py-3 text-end">{fmtNum(course.leads)}</td>
                        <td className="num px-3 py-3 text-end text-success">
                          {fmtNum(course.won)}
                        </td>
                        <td className="num px-3 py-3 text-end text-danger">
                          {fmtNum(course.lost)}
                        </td>
                        <td className="num px-3 py-3 text-end">{fmtNum(course.openLeads)}</td>
                        <td className="px-3 py-3 text-end">
                          <Pill tone={conversionTone(course)}>
                            {fmtPct(course.conversionRate, 1)}
                          </Pill>
                        </td>
                        <td className="num px-3 py-3 text-end">
                          {fmtPct(course.decidedConversionRate, 1)}
                        </td>
                        <td className="num px-3 py-3 text-end">{fmtNum(course.invoices)}</td>
                        <td className="num px-3 py-3 text-end font-semibold">
                          {fmtUSDFull(course.paidRevenue)}
                        </td>
                        <td className="num px-3 py-3 text-end">{fmtPct(course.salesShare, 1)}</td>
                        <td className="px-3 py-3 text-end">
                          <Pill tone={course.sampleStatus === "reliable" ? "success" : "neutral"}>
                            {course.sampleStatus === "reliable"
                              ? lang === "ar"
                                ? "كافية"
                                : "Reliable"
                              : lang === "ar"
                                ? "استرشادية"
                                : "Directional"}
                          </Pill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {/* The totals the summary cards are a slice of. Without them the
                    reader cannot tell whether a named course is most of his
                    volume or a rounding error. */}
                  <tfoot className="sticky bottom-0 bg-surface-2">
                    <tr className="border-t-2 border-border text-[12px] font-semibold text-text">
                      <td className="px-3 py-3">{lang === "ar" ? "الإجمالي" : "Total"}</td>
                      <td className="px-3 py-3 text-text-muted">
                        {fmtNum(totals.courses)} {lang === "ar" ? "كورس" : "courses"}
                      </td>
                      <td className="num px-3 py-3 text-end">{fmtNum(totals.leads)}</td>
                      <td className="num px-3 py-3 text-end text-success">{fmtNum(totals.won)}</td>
                      <td className="num px-3 py-3 text-end text-danger">{fmtNum(totals.lost)}</td>
                      <td className="num px-3 py-3 text-end">{fmtNum(totals.openLeads)}</td>
                      <td className="num px-3 py-3 text-end">{fmtPct(totals.conversionRate, 1)}</td>
                      <td className="num px-3 py-3 text-end">
                        {fmtPct(totals.decidedConversionRate, 1)}
                      </td>
                      <td className="num px-3 py-3 text-end">{fmtNum(totals.invoices)}</td>
                      <td className="num px-3 py-3 text-end">{fmtUSDFull(totals.paidRevenue)}</td>
                      {/* Shares are taken over positive revenue while this row is
                        net of credit notes, so they do not add to a meaningful
                        total. Better blank than a 100% that is not true. */}
                      <td className="num px-3 py-3 text-end text-text-muted">—</td>
                      <td className="px-3 py-3 text-end text-[11px] font-normal text-text-muted">
                        {lang === "ar"
                          ? `${fmtNum(courseProfile.soldTotals.courses)} فيها بيع`
                          : `${fmtNum(courseProfile.soldTotals.courses)} sold`}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>

            <Notice tone="info" icon={<Info size={16} />}>
              {lang === "ar"
                ? `المبيعات هي صافي التحصيل من فواتير Odoo المدفوعة بتاريخ الدفع، فممكن تكون من ليدز اتعملت قبل الفترة. تحويل الليدز = الرابحة ÷ ليدز الفترة نفسها، عشان كده الرقمين ممكن يختلفوا. كروت «قوي وضعيف» بتترتب كلها على الكورسات اللي فيها بيع فعلي للموظف بس، والتصنيفات اللي مش كورس زي «أخرى» مستبعدة من الترتيب ومعروضة في سطر تحت الكروت؛ «أفضل تحويل» محتاج ${courseProfile.minimumLeadSample} ليدز على الأقل ومعاهم صفقة رابحة حقيقية واحدة، و«يحتاج دعم» محتاج كمان ${fmtNum(courseProfile.minimumDecidedSample)} ليدز متحسمة على الأقل من اللي معاه دلوقتي — الليدز اللي لسه مفتوحة مش محسوبة ضده، والكورس اللي مباعش فيه خالص ما يتحاسبش عليه أصلاً. والصفقة اللي اتقفلت رابحة واتأرشفت بعدها بتتحسب رابحة زي أي صفقة تانية.`
                : `Sales are net paid Odoo collections dated by payment, so they can come from cohorts created before this period. Lead conversion is Won ÷ this period's cohort, which is why the two can disagree. The strength and weakness cards all rank the courses he has actually sold, and non-course buckets such as "Other" are held out of the ranking and reported on a line under the cards; "best conversion" needs at least ${courseProfile.minimumLeadSample} leads and one real win, and "needs support" additionally requires at least ${fmtNum(courseProfile.minimumDecidedSample)} settled leads among the ones he holds now — leads still open are not counted against him, and a course he never sold is never judged at all.`}
            </Notice>
            <section className="rounded-2xl border border-brand/15 bg-brand-soft/25 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <b className="text-sm text-text">
                    {lang === "ar" ? "السجلات التفصيلية" : "Detailed source records"}
                  </b>
                  <p className="mt-1 text-[11px] text-text-muted">
                    {lang === "ar"
                      ? "افتح نوع الدليل الذي تحتاجه مباشرة؛ كل مصدر يظهر منفصلًا عن الآخر."
                      : "Open the exact evidence you need; every source is kept separate."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <EvidenceLink href="#employee-lead-evidence" />
                  <EvidenceLink href="#employee-call-evidence" />
                  <EvidenceLink href="#employee-chat-evidence" />
                </div>
              </div>
            </section>
          </div>
          {invoiceCourse && (
            <CourseInvoicesDialog
              course={invoiceCourse}
              agent={row.name}
              onClose={() => setInvoiceCourse(null)}
            />
          )}
          <EmployeeEvidenceDialog
            row={row}
            kind={evidenceKind}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) setEvidenceKind(null);
            }}
          />
          <UncalledLeadsDialog
            scope={uncalledScope}
            employee={row.name}
            employeeLabel={row.displayName}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) setUncalledScope(null);
            }}
          />
        </SheetContent>
      </EmployeeEvidenceContext.Provider>
    </Sheet>
  );
}

type CallDetailResponse = {
  ok: boolean;
  call: CallsHubCall & {
    analysisScore?: number | null;
    qualityAudit?: {
      call_classification?: { type?: string; reasoning?: string; source?: string };
      score_card?: { final_score?: number; total_penalty?: number; bonus_points?: number };
      detailed_analysis?: Record<string, unknown>;
      audit_summary?: { strengths?: string[]; areas_for_improvement?: string[] };
    };
  };
  transcript: Array<{
    id: string;
    speaker_role?: string;
    speaker?: string;
    start_seconds?: number;
    text: string;
    confidence?: number;
    language?: string;
    suspect_terms?: string[];
  }>;
  selection?: {
    selected?: boolean;
    eligible?: boolean;
    checks?: { answered?: boolean; recorded?: boolean; durationWithinRange?: boolean };
  };
};

function EmployeeCallsPanel({ row }: { row: AgentRow }) {
  const { lang } = useI18n();
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  useEffect(() => setSelectedCallId(null), [row.key]);

  if (!row.callExtension) {
    return (
      <Notice
        tone="warning"
        title={lang === "ar" ? "امتداد الموظف غير مطابق" : "Employee extension not matched"}
      >
        {lang === "ar"
          ? "اسم الموظف موجود في Odoo لكن مش مطابق لاسم أي Extension نشط في Calls Hub. بعد توحيد الاسم هتظهر سجلاته وتحليلات مكالماته هنا تلقائيًا."
          : "The employee exists in Odoo but does not match an active Calls Hub extension. Once the names are aligned, records and call analyses will appear automatically."}
      </Notice>
    );
  }

  return (
    <EmployeeCallsList
      row={row}
      selectedCallId={selectedCallId}
      onSelect={setSelectedCallId}
      lang={lang}
    />
  );
}

function EmployeeCallsList({
  row,
  selectedCallId,
  onSelect,
  lang,
}: {
  row: AgentRow;
  selectedCallId: string | null;
  onSelect: (id: string | null) => void;
  lang: "ar" | "en";
}) {
  const { data, isLoading, error, refetch } = useApi<CallsHubEmployeeCalls>(
    `/api/employee-calls?extension=${encodeURIComponent(row.callExtension || "")}&page_size=50`,
  );
  const reviewCalls =
    data?.calls.filter(
      (call) => call.qualityScore !== null && call.qualityScore < QUALITY_REVIEW_THRESHOLD,
    ) ?? [];
  const remainingCalls =
    data?.calls.filter(
      (call) => call.qualityScore === null || call.qualityScore >= QUALITY_REVIEW_THRESHOLD,
    ) ?? [];
  const callGroups = [
    {
      key: "review",
      label: lang === "ar" ? "مكالمات تحتاج مراجعة" : "Calls needing review",
      calls: reviewCalls,
      warning: true,
    },
    {
      key: "remaining",
      label: lang === "ar" ? "باقي المكالمات" : "Remaining calls",
      calls: remainingCalls,
      warning: false,
    },
  ].filter((group) => group.calls.length > 0);
  return (
    <div id="employee-call-evidence" className="scroll-mt-24">
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 sm:p-5">
          <div>
            <SectionTitle className="mb-0">
              {lang === "ar" ? "دليل المكالمات وتقييمها" : "Call evidence and scores"}
            </SectionTitle>
            <p className="mt-1 text-[11px] text-text-muted">
              {lang === "ar"
                ? `المكالمات الأقل من ${QUALITY_REVIEW_THRESHOLD} تظهر أولًا. افتح أي مكالمة لسماع التسجيل ومراجعة النص المصحح وكل خصم ودليله.`
                : `Calls below ${QUALITY_REVIEW_THRESHOLD} appear first. Open any call to hear the recording and review the corrected transcript and every evidence-backed deduction.`}
            </p>
          </div>
          {data && (
            <Pill tone="brand">
              <bdi dir="ltr" className="num">
                {fmtNum(data.calls.length)}
              </bdi>{" "}
              {lang === "ar" ? "معروضة من" : "shown of"}{" "}
              <bdi dir="ltr" className="num">
                {fmtNum(data.total)}
              </bdi>
            </Pill>
          )}
        </div>
        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : error ? (
          <div className="p-4">
            <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
          </div>
        ) : !data?.calls.length ? (
          <div className="grid min-h-32 place-items-center p-6 text-center text-sm text-text-muted">
            {lang === "ar"
              ? "لا توجد مكالمات لهذا الموظف في الفترة المختارة."
              : "No calls for this employee in the selected period."}
          </div>
        ) : (
          <div>
            {callGroups.map((group) => (
              <section
                key={group.key}
                className={group.key === "remaining" ? "border-t-8 border-surface-2" : ""}
              >
                <div
                  className={`flex items-center justify-between border-b px-4 py-3 ${group.warning ? "border-danger/15 bg-danger/5" : "border-border bg-surface-2/60"}`}
                >
                  <b className={`text-xs ${group.warning ? "text-danger" : "text-text"}`}>
                    {group.label}
                  </b>
                  <Pill tone={group.warning ? "danger" : "neutral"}>
                    {fmtNum(group.calls.length)}
                  </Pill>
                </div>
                <div className="divide-y divide-border">
                  {group.calls.map((call) => {
                    const open = selectedCallId === call.id;
                    return (
                      <article
                        key={call.id}
                        className="bg-surface transition-colors hover:bg-surface-2/55"
                      >
                        <button
                          type="button"
                          onClick={() => onSelect(open ? null : call.id)}
                          className="grid w-full gap-3 p-4 text-start sm:grid-cols-[minmax(180px,1.3fr)_minmax(140px,1fr)_110px_100px_28px] sm:items-center"
                        >
                          <span className="min-w-0">
                            <b className="block truncate text-sm text-text">
                              {call.customerNumber || "—"}
                            </b>
                            <small className="mt-0.5 block text-[11px] text-text-muted">
                              {formatCallDate(call.startedAt, lang)} ·{" "}
                              {call.callType === "inbound"
                                ? lang === "ar"
                                  ? "واردة"
                                  : "Inbound"
                                : lang === "ar"
                                  ? "صادرة"
                                  : "Outbound"}
                            </small>
                          </span>
                          <span className="min-w-0">
                            <b className="block truncate text-xs text-text">
                              {call.intent || (lang === "ar" ? "غير مصنفة" : "Unclassified")}
                            </b>
                            <small className="mt-0.5 block truncate text-[11px] text-text-muted">
                              {call.summary || call.recordingState}
                            </small>
                          </span>
                          <span className="num text-xs font-semibold text-text">
                            {formatCallDuration(call.durationSeconds, lang)}
                          </span>
                          <span>
                            <Pill tone={qualityTone(call.qualityScore)}>
                              {fmtQuality(call.qualityScore)}
                            </Pill>
                          </span>
                          <ChevronDown
                            size={17}
                            className={`text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
                          />
                        </button>
                        {open && (
                          <EmployeeCallDetail call={call} lang={lang} appUrl={data.appUrl} />
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function EmployeeCallDetail({
  call,
  lang,
  appUrl,
}: {
  call: CallsHubCall;
  lang: "ar" | "en";
  appUrl: string;
}) {
  const { data, isLoading, error, refetch } = useApi<CallDetailResponse>(
    `/api/employee-call-detail?id=${encodeURIComponent(call.id)}`,
  );
  if (isLoading)
    return (
      <div className="border-t border-border p-4">
        <Skeleton className="h-44" />
      </div>
    );
  if (error || !data)
    return (
      <div className="border-t border-border p-4">
        <ErrorState
          message={(error as Error)?.message || "Call details unavailable"}
          onRetry={() => refetch()}
        />
      </div>
    );

  const audit = data.call.qualityAudit;
  const detail = audit?.detailed_analysis ?? {};
  const findingKeys = [
    "end_user_mistakes",
    "business_critical_mistakes",
    "non_critical_mistakes",
    "system_mistakes",
  ];
  const findings = findingKeys.flatMap((key) => {
    const value = detail[key];
    return Array.isArray(value)
      ? value.filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object"),
        )
      : [];
  });
  const classification = audit?.call_classification?.type || "—";

  return (
    <div className="space-y-4 border-t border-border bg-surface-2/45 p-4 sm:p-5">
      <div className="grid gap-3 lg:grid-cols-[1.05fr_.95fr]">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <b className="inline-flex items-center gap-2 text-sm text-text">
              <FileAudio size={16} className="text-brand" />
              {lang === "ar" ? "تسجيل المكالمة" : "Call recording"}
            </b>
            <span className="text-[10px] text-text-muted">
              {call.recordingPlayable
                ? "WAV · Private stream"
                : lang === "ar"
                  ? "غير متاح"
                  : "Unavailable"}
            </span>
          </div>
          {call.recordingPlayable ? (
            <audio
              className="w-full"
              controls
              preload="none"
              src={`/api/employee-call-recording?id=${encodeURIComponent(call.id)}`}
            />
          ) : (
            <p className="text-xs text-text-muted">
              {lang === "ar"
                ? "لا يوجد ملف صوت محفوظ لهذه المكالمة."
                : "No stored audio file is available for this call."}
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b className="text-sm text-text">{lang === "ar" ? "أساس التقييم" : "Scoring basis"}</b>
            <Pill tone={classification === "Follow-up" ? "brand" : "neutral"}>
              {classification}
            </Pill>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
            {audit?.call_classification?.reasoning ||
              (lang === "ar"
                ? "لم يكتمل تحليل هذه المكالمة بعد."
                : "This call has not completed quality analysis yet.")}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(lang === "ar"
              ? [
                  "الافتتاح",
                  "فهم الاحتياج",
                  "الاستماع",
                  "العرض البيعي",
                  "الاعتراضات",
                  "الإغلاق",
                  "الـCRM",
                ]
              : [
                  "Opening",
                  "Discovery",
                  "Listening",
                  "Sales pitch",
                  "Objections",
                  "Closing",
                  "CRM discipline",
                ]
            ).map((criterion) => (
              <span
                key={criterion}
                className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-[10px] text-text-muted"
              >
                {criterion}
              </span>
            ))}
          </div>
        </div>
      </div>

      {findings.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <b className="text-sm text-text">
              {lang === "ar" ? "الخصومات المثبتة" : "Evidence-backed deductions"}
            </b>
            <span className="num text-xs text-text-muted">{fmtNum(findings.length)}</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {findings.map((finding, index) => (
              <div
                key={`${String(finding.code)}-${index}`}
                className="rounded-xl border border-danger/15 bg-danger/5 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <b className="text-xs text-text">
                    {String(finding.code || "—")} ·{" "}
                    {String(
                      finding.criterion || (lang === "ar" ? "معيار جودة" : "Quality criterion"),
                    )}
                  </b>
                  <span className="num text-[10px] font-semibold text-danger">
                    {String(finding.penalty || "")}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">
                  {String(finding.evidence || "")}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <b className="text-sm text-text">
            {lang === "ar" ? "النص المصحح" : "Corrected transcript"}
          </b>
          <span className="text-[10px] text-text-muted">
            Deepgram Nova-3 · Arabic dialect-aware correction
          </span>
        </div>
        {data.transcript.length ? (
          <div className="max-h-80 overflow-y-auto rounded-xl border border-border bg-surface-2/60 p-4 pe-3">
            <p className="text-sm leading-[2.1] text-text" dir="auto">
              {data.transcript.map((segment, index) => {
                const agent = segment.speaker_role === "agent";
                const lowConfidence =
                  typeof segment.confidence === "number" &&
                  (segment.confidence <= 1 ? segment.confidence < 0.6 : segment.confidence < 60);
                return (
                  <span key={segment.id}>
                    {index > 0 && " "}
                    <b className="me-1 text-[10px] text-brand">
                      {agent
                        ? lang === "ar"
                          ? "الموظف:"
                          : "Agent:"
                        : lang === "ar"
                          ? "العميل:"
                          : "Customer:"}
                    </b>
                    {lowConfidence && !segment.suspect_terms?.length ? (
                      <mark
                        className="rounded bg-warning-soft px-1 text-text"
                        title={
                          lang === "ar"
                            ? "مقطع مشتبه به ولا يعتمد عليه في الخصم"
                            : "Suspect segment excluded from deductions"
                        }
                      >
                        {segment.text}
                      </mark>
                    ) : (
                      highlightSuspectText(segment.text, segment.suspect_terms ?? [], lang)
                    )}
                  </span>
                );
              })}
            </p>
            <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-[10px] text-text-muted">
              <span className="h-2.5 w-2.5 rounded-sm bg-warning-soft" />
              {lang === "ar"
                ? "الكلام المظلل مشتبه به ولا يستخدم كدليل خصم."
                : "Highlighted text is uncertain and is never used as deduction evidence."}
            </div>
          </div>
        ) : (
          <p className="text-xs text-text-muted">
            {lang === "ar"
              ? "النص ما زال قيد المعالجة أو لا يوجد تسجيل صالح للمكالمة."
              : "The transcript is still processing or this call has no eligible recording."}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] text-text-muted">
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 size={13} className="text-success" />
          {lang === "ar"
            ? "الحسابات تتم برمجيًا بعد استخراج الأدلة؛ الموديل لا يحدد الدرجة بنفسه."
            : "The model extracts evidence; deterministic code calculates the score."}
        </span>
        <span className="flex flex-wrap items-center gap-3">
          <a
            href={`${appUrl.replace(/\/+$/, "")}/?call=${encodeURIComponent(call.id)}#archive`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"
          >
            {lang === "ar" ? "فتح نفس المكالمة في Calls Hub" : "Open this call in Calls Hub"}
            <ExternalLink size={12} />
          </a>
          <a
            href="https://engosoft-pbx.ras.yeastar.com/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"
          >
            {lang === "ar" ? "فتح Yeastar" : "Open Yeastar"}
            <ExternalLink size={12} />
          </a>
        </span>
      </div>
    </div>
  );
}

function ProfileMetric({
  label,
  value,
  sub,
  icon,
  hero = false,
  explain,
  evidenceHref,
}: {
  label: string;
  value: string;
  sub: string;
  icon: ReactNode;
  hero?: boolean;
  /** Shows the "where does this number come from?" popover next to the label. */
  explain?: EmployeeMetricKey;
  /** A real record/calculation section; omitted when no drill-down exists. */
  evidenceHref?: string;
}) {
  const { lang } = useI18n();
  return (
    <div
      className={`rounded-2xl border p-3.5 ${hero ? "border-brand/20 bg-brand-soft" : "border-border bg-surface"}`}
    >
      <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1">
          {label}
          {explain && <EmployeeMetricInfo metric={explain} />}
        </span>
        <span className="text-brand">{icon}</span>
      </div>
      <div className="num mt-2 text-xl font-bold text-text sm:text-2xl">{value}</div>
      <div className="mt-1 text-[11px] text-text-muted">{sub}</div>
      {evidenceHref && (
        <a
          href={evidenceHref}
          className="mt-3 inline-flex items-center gap-1 text-[10px] font-semibold text-brand underline-offset-4 hover:underline"
        >
          {lang === "ar" ? "عرض الدليل" : "View evidence"}
          <ArrowUpRight size={12} aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

function CourseInsight({
  icon,
  eyebrow,
  course,
  value,
  sub,
  foot,
  tone,
  empty,
  explain,
  onOpenInvoices,
}: {
  icon: ReactNode;
  eyebrow: string;
  course: AgentCoursePerformance | null;
  value: (course: AgentCoursePerformance) => string;
  sub: (course: AgentCoursePerformance) => string;
  /**
   * The basis this card does *not* rank on. A money card shows its cohort here
   * and a conversion card shows its money, so four cards on different scales
   * can still be compared without opening the table.
   */
  foot?: (course: AgentCoursePerformance) => string;
  tone: "success" | "danger" | "brand" | "neutral";
  /** Why the card is empty, when "no reliable sample" is not the real reason. */
  empty?: string;
  /** Shows the "where does this number come from?" popover next to the eyebrow. */
  explain?: EmployeeMetricKey;
  /** Opens the card's course invoice by invoice. Omitted, the name is plain text. */
  onOpenInvoices?: (course: AgentCoursePerformance) => void;
}) {
  const { lang } = useI18n();
  const styles = {
    success: "border-success/20 bg-success/7 text-success",
    danger: "border-danger/20 bg-danger/7 text-danger",
    brand: "border-brand/20 bg-brand-soft text-brand",
    neutral: "border-border bg-surface-2 text-text-muted",
  }[tone];
  return (
    <article className={`rounded-2xl border p-4 ${styles}`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold">
        {icon}
        <span>{eyebrow}</span>
        {explain && <EmployeeMetricInfo metric={explain} align="end" />}
      </div>
      {course ? (
        <>
          {onOpenInvoices ? (
            <button
              type="button"
              onClick={() => onOpenInvoices(course)}
              title={dimensionNote(course.label, lang) ?? course.label}
              className="mt-3 flex w-full items-center gap-1.5 text-start text-base font-bold text-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <span className="truncate">{displayDimension(course.label, lang)}</span>
              <ReceiptText size={14} className="shrink-0 text-text-muted" aria-hidden="true" />
              <span className="sr-only">
                {lang === "ar" ? "اعرض فواتير الكورس" : "Show this course's invoices"}
              </span>
            </button>
          ) : (
            <div
              className="mt-3 truncate text-base font-bold text-text"
              title={dimensionNote(course.label, lang) ?? course.label}
            >
              {displayDimension(course.label, lang)}
            </div>
          )}
          <div className="num mt-1 text-lg font-bold text-text">{value(course)}</div>
          <div className="mt-1 text-[11px] text-text-muted">{sub(course)}</div>
          {foot && (
            <div className="num mt-2 border-t border-current/12 pt-2 text-[11px] text-text-muted">
              {foot(course)}
            </div>
          )}
        </>
      ) : (
        <div className="mt-4 text-sm font-medium text-text-muted">
          {empty ?? (lang === "ar" ? "لا توجد عينة كافية" : "No reliable sample yet")}
        </div>
      )}
    </article>
  );
}

/**
 * How many leads the employee's courses took, and how many of them converted.
 *
 * The summary cards each name one course, which answers "where" but never "how
 * much". Without this strip a manager had to add the table up by hand to learn
 * whether the flagged course was two leads or two hundred, and the split below
 * is what separates "he is losing his own deals" from "he is being fed leads
 * for courses he does not sell".
 */
function CourseLeadTotals({ profile }: { profile: AgentRow["courseProfile"] }) {
  const { lang } = useI18n();
  const { totals, soldTotals, unsoldTotals } = profile;
  if (!totals.leads && !totals.courses) return null;
  const share = (part: number) => (totals.leads > 0 ? (part / totals.leads) * 100 : null);

  return (
    <Card>
      <SectionTitle
        hint={
          lang === "ar"
            ? `${fmtNum(totals.courses)} كورس في الفترة`
            : `${fmtNum(totals.courses)} courses in this period`
        }
      >
        {lang === "ar"
          ? "ليدز الكورسات اللي معاه وكام اتحوّلت"
          : "Leads across his courses, and how many converted"}
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ProfileMetric
          label={lang === "ar" ? "إجمالي ليدز الكورسات" : "Total course leads"}
          value={fmtNum(totals.leads)}
          sub={
            lang === "ar"
              ? `${fmtNum(totals.won)} رابحة · ${fmtNum(totals.lost)} خاسرة · ${fmtNum(totals.openLeads)} مفتوحة`
              : `${fmtNum(totals.won)} won · ${fmtNum(totals.lost)} lost · ${fmtNum(totals.openLeads)} open`
          }
          icon={<Users size={17} />}
          hero
        />
        <ProfileMetric
          label={lang === "ar" ? "اتحوّلت لصفقة رابحة" : "Converted to won"}
          value={fmtNum(totals.won)}
          sub={`${fmtPct(totals.conversionRate, 1)} ${lang === "ar" ? "من كل الليدز" : "of all leads"} · ${fmtPct(totals.decidedConversionRate, 1)} ${lang === "ar" ? "من المحسوم" : "of decided"}`}
          icon={<Trophy size={17} />}
        />
        <ProfileMetric
          label={lang === "ar" ? "في كورسات بيبيعها" : "In courses he sells"}
          value={fmtNum(soldTotals.leads)}
          sub={`${fmtPct(share(soldTotals.leads), 1)} ${lang === "ar" ? "من ليدزه" : "of his leads"} · ${fmtNum(soldTotals.won)} ${lang === "ar" ? "رابحة" : "won"} · ${fmtPct(soldTotals.conversionRate, 1)}`}
          icon={<ChartNoAxesCombined size={17} />}
        />
        <ProfileMetric
          label={lang === "ar" ? "في كورسات مباعش فيها" : "In courses he never sold"}
          value={fmtNum(unsoldTotals.leads)}
          sub={
            unsoldTotals.leads > 0
              ? `${fmtPct(share(unsoldTotals.leads), 1)} ${lang === "ar" ? "من ليدزه" : "of his leads"} · ${fmtNum(unsoldTotals.won + unsoldTotals.lost)} ${lang === "ar" ? "محسومة بلا بيع" : "decided, no sale"}`
              : lang === "ar"
                ? "كل ليدزه في كورسات بيبيعها"
                : "every lead sits in a course he sells"
          }
          icon={<Layers3 size={17} />}
        />
      </div>
    </Card>
  );
}

/**
 * Courses that took leads and produced nothing.
 *
 * These used to be ranked against him, which is how a rep who sells CFM and PMP
 * was told he "needs support" in Management — a course he had never sold a seat
 * of. They are a routing question for the manager, so they are still shown, just
 * not as a verdict on the employee.
 */
function UnsoldCoursesNotice({ profile }: { profile: AgentRow["courseProfile"] }) {
  const { lang } = useI18n();
  const courses = profile.unsoldCourses.filter((course) => course.leads > 0);
  if (!courses.length) return null;
  const { unsoldTotals } = profile;

  return (
    <Notice
      tone="warning"
      title={
        lang === "ar"
          ? `${fmtNum(unsoldTotals.leads)} ليد في ${fmtNum(courses.length)} كورس مفيش فيهم أي بيع`
          : `${fmtNum(unsoldTotals.leads)} leads across ${fmtNum(courses.length)} courses with no sale at all`
      }
    >
      <p>
        {lang === "ar"
          ? "دي كورسات جاتله فيها ليدز ولا باع فيها ولا كسب ولا ليدة. مش محسوبة عليه كضعف — لكنها سؤال توزيع: يا إما الليدز دي مش المفروض تروح له، يا إما محتاج تدريب على المنتج ده قبل ما نحاسبه عليه."
          : "These courses received leads and produced neither a sale nor a single win. They are not counted against him — but they are a routing question: either the leads should not be reaching him, or he needs product training before he can be measured on them."}
      </p>
      <ul className="mt-2 space-y-1">
        {courses.slice(0, 6).map((course) => (
          <li key={course.key} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
            <b className="text-text" title={dimensionNote(course.label, lang)}>
              {displayDimension(course.label, lang)}
            </b>
            <span className="num text-text-muted">
              {fmtNum(course.leads)} {lang === "ar" ? "ليد" : "leads"} ·{" "}
              {fmtNum(course.won + course.lost)} {lang === "ar" ? "محسومة" : "decided"} ·{" "}
              {fmtNum(course.openLeads)} {lang === "ar" ? "لسه مفتوحة" : "still open"}
            </span>
          </li>
        ))}
      </ul>
      {courses.length > 6 && (
        <p className="mt-1 text-[11px] text-text-muted">
          {lang === "ar"
            ? `و${fmtNum(courses.length - 6)} كورس تاني — التفاصيل في جدول الكورسات تحت.`
            : `and ${fmtNum(courses.length - 6)} more — see the course table below.`}
        </p>
      )}
    </Notice>
  );
}

/**
 * The leads that never named a course, on their own line under the four cards.
 *
 * `Other` used to compete for a card, and it won one: "أقل مبيعات: أخرى $0".
 * A manager cannot act on that — it names no subject to coach and no product to
 * push, because the value is recorded before anyone knows what the customer
 * wants. It is held out of the ranking now.
 *
 * Held out is not hidden. The leads are real, they are his, and they convert at
 * a fraction of the rest, so they are stated here in one line with the number a
 * manager would act on — where they came in from — rather than dropped.
 */
/**
 * The invoices behind one course figure, by number.
 *
 * The table has always shown a course's revenue and an invoice count, and a
 * manager checking either had nowhere to go: the count is not a receipt, and
 * Odoo needs a move number to search on. This lists them — number, payment
 * date, customer, amount — so the figure on the card can be verified line by
 * line without leaving the page.
 *
 * A course with no invoices still opens: "$0 with 2 wons" and "$0 with nothing
 * sold" are different situations and the empty state has to say which.
 */
function CourseInvoicesDialog({
  course,
  agent,
  onClose,
}: {
  course: AgentCoursePerformance;
  agent: string;
  onClose: () => void;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  // Fetched on open, not shipped with the page: the full list for every course
  // of every employee was 551 KB of an 864 KB response, to fill a dialog that
  // is usually never opened.
  const { data, isPending, error } = useApi<{
    invoices: AgentCourseInvoice[];
    total: number;
  }>(
    `/api/agent-course-invoices?agent=${encodeURIComponent(agent)}&course=${encodeURIComponent(course.key)}`,
  );
  const invoices = data?.invoices ?? [];
  const listed = data?.total ?? 0;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(4,12,24,0.62)] p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-course-invoices-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface shadow-2xl"
        onClick={(click) => click.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-5 sm:p-6">
          <div className="min-w-0">
            <Pill tone="brand">{ar ? "فواتير مدفوعة" : "Paid invoices"}</Pill>
            <h3
              id="agent-course-invoices-title"
              className="mt-3 text-lg font-semibold text-text"
              title={dimensionNote(course.label, lang)}
            >
              {displayDimension(course.label, lang)}
            </h3>
            <p className="mt-1 text-xs text-text-muted">{agent}</p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-full text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            aria-label={ar ? "إغلاق" : "Close"}
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5 sm:p-6">
          {isPending ? (
            <div className="rounded-xl bg-surface-2 p-4 text-xs text-text-muted">
              {ar ? "بيحمّل الفواتير…" : "Loading invoices…"}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-danger/20 bg-danger/7 p-4 text-xs text-danger">
              {ar ? "مش قادر يجيب الفواتير: " : "Could not load the invoices: "}
              {error.message}
            </div>
          ) : invoices.length === 0 ? (
            <div className="rounded-xl bg-surface-2 p-4 text-xs leading-relaxed text-text-muted">
              {course.won > 0
                ? ar
                  ? `مفيش فاتورة مدفوعة على الكورس ده في الفترة، مع إن فيه ${fmtNum(course.won)} صفقة رابحة. التحصيل بيتحسب بتاريخ الدفع، فالفاتورة ممكن تكون لسه مجتش أو اتدفعت برّه الفترة.`
                  : `No paid invoice for this course in the period, despite ${fmtNum(course.won)} won deals. Collections are dated by payment, so the invoice has either not landed yet or was paid outside the window.`
                : ar
                  ? "مفيش فاتورة ولا صفقة رابحة على الكورس ده في الفترة — ليدز بس."
                  : "No invoice and no win on this course in the period — leads only."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                    <th className="px-3 py-2 text-start">{ar ? "رقم الفاتورة" : "Invoice no."}</th>
                    <th className="px-3 py-2 text-start">{ar ? "تاريخ الدفع" : "Payment date"}</th>
                    <th className="px-3 py-2 text-start">{ar ? "العميل" : "Customer"}</th>
                    <th className="px-3 py-2 text-end">{ar ? "المبلغ" : "Amount"}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.movement} className="border-t border-border">
                      <td className="num px-3 py-2.5 font-semibold text-text">
                        {invoice.movement}
                      </td>
                      <td className="num px-3 py-2.5 text-text-muted">
                        {invoice.paymentDate || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-text-muted">{invoice.partner || "—"}</td>
                      <td className="num px-3 py-2.5 text-end font-semibold text-text">
                        {fmtUSDFull(invoice.usdPaid)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border p-5 text-xs text-text-muted sm:p-6">
          <span>
            {isPending
              ? ar
                ? "…"
                : "…"
              : ar
                ? `${fmtNum(invoices.length)} فاتورة · المجموع ${fmtUSDFull(listed)}`
                : `${fmtNum(invoices.length)} invoices · ${fmtUSDFull(listed)} total`}
          </span>
          {/* The two can differ: a credit note is excluded from the list but
              still moves the course total, so saying nothing would look like an
              arithmetic error. */}
          {!isPending && Math.abs(listed - course.paidRevenue) >= 0.01 && (
            <span>
              {ar
                ? `إجمالي الكورس ${fmtUSDFull(course.paidRevenue)} — الفرق إشعارات دائن مش متعروضة هنا.`
                : `Course total is ${fmtUSDFull(course.paidRevenue)} — the difference is credit notes, not listed here.`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function NonCourseLine({ profile }: { profile: AgentRow["courseProfile"] }) {
  const { lang } = useI18n();
  const rows = profile.nonCourseRows.filter((row) => row.leads > 0 || row.paidRevenue !== 0);
  if (!rows.length) return null;
  const { nonCourseTotals } = profile;
  const names = rows
    .map((row) => displayDimension(row.label, lang))
    .join(lang === "ar" ? "، " : ", ");

  return (
    <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-border pt-3 text-[11px] leading-relaxed text-text-muted">
      <Info size={13} className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
      <span>
        {lang === "ar"
          ? `وكمان ${fmtNum(nonCourseTotals.leads)} ليد تحت «${names}» مش داخلة في ترتيب الكروت الأربعة —`
          : `Plus ${fmtNum(nonCourseTotals.leads)} leads under “${names}”, held out of the four cards above —`}
      </span>
      <span>
        {lang === "ar"
          ? "دي ليدز دخلت من غير ما تحدد كورس، فمينفعش تترتب كأنها كورس بيبيعه. موجودة بالكامل في جدول الكورسات تحت."
          : "these arrived without naming a course, so they cannot be ranked as a course he sells. They are in the course table below in full."}
      </span>
      <span className="num font-semibold text-text">
        {fmtNum(nonCourseTotals.won)} {lang === "ar" ? "رابحة" : "won"} ·{" "}
        {fmtUSDFull(nonCourseTotals.paidRevenue)}
      </span>
    </p>
  );
}

function SpecializationCard({
  item,
  lang,
}: {
  item: AgentSpecializationPerformance;
  lang: "ar" | "en";
}) {
  return (
    <article className="bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-text" title={dimensionNote(item.label, lang)}>
            {displayDimension(item.label, lang)}
          </h4>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {fmtPct(item.leadShare, 1)} {lang === "ar" ? "من ليدز الموظف" : "of employee leads"}
          </p>
        </div>
        <Pill tone={item.sampleStatus === "reliable" ? "success" : "neutral"}>
          {fmtPct(item.conversionRate, 1)}
        </Pill>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 min-[420px]:grid-cols-3">
        <MiniMetric label={lang === "ar" ? "الليدز" : "Leads"} value={fmtNum(item.leads)} />
        <MiniMetric
          label={lang === "ar" ? "رابحة / خاسرة" : "Won / Lost"}
          value={`${fmtNum(item.won)} / ${fmtNum(item.lost)}`}
        />
        <MiniMetric
          label={lang === "ar" ? "المبيعات" : "Sales"}
          value={fmtUSDFull(item.paidRevenue)}
        />
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: `${Math.max(1.5, Math.min(100, item.leadShare))}%` }}
        />
      </div>
    </article>
  );
}

function conversionTone(course: AgentCoursePerformance): "success" | "neutral" | "danger" {
  if (course.sampleStatus !== "reliable") return "neutral";
  if ((course.conversionRate ?? 0) >= 10) return "success";
  return "danger";
}

/**
 * Specialization colours are pinned to the specialization, never to its rank.
 * The donut sorts by lead count, so a positional palette painted Engineering
 * teal for one employee and blue for the next — which quietly made two profiles
 * impossible to read against each other. Keys are the normalized ones from
 * `agent-analytics.server`; anything unlisted falls through to the chart's own
 * palette, and the bucket that means "we don't know" is grey on purpose so a
 * gap in the data never looks like another specialization.
 */
const SPECIALIZATION_COLORS: Record<string, string> = {
  "professional certificate": "var(--chart-1)",
  "interior decor": "var(--chart-2)",
  engineering: "var(--chart-3)",
  technology: "var(--chart-4)",
  "non engineering": "var(--chart-5)",
  uncategorized: "var(--chart-muted)",
};

/**
 * "فاتورة واحدة" / "فاتورتين" / "٧ فواتير".
 *
 * Arabic pluralises on four bands, not two. "7 فاتورة" everywhere is the kind
 * of small wrongness that makes a page read as machine-written, and the dual
 * especially — "2 فاتورة" is not something anyone says.
 */
function invoiceCount(count: number, lang: "ar" | "en"): string {
  if (lang === "en") return `${fmtNum(count)} ${count === 1 ? "invoice" : "invoices"}`;
  if (count === 1) return "فاتورة واحدة";
  if (count === 2) return "فاتورتين";
  if (count >= 3 && count <= 10) return `${fmtNum(count)} فواتير`;
  return `${fmtNum(count)} فاتورة`;
}

/**
 * Two labels on this screen look like the same thing and are not.
 *
 * `Other` is a real course code, transcribed from the workbook's own `Courses`
 * tab: the lead or the invoice carries `Other` in its category column in Odoo.
 * `Uncategorized` is ours — it means the row arrived with that column blank.
 * The taxonomy deliberately keeps an unrecognised course under its own name
 * rather than sweeping it into `Other`, so the two never blur together.
 *
 * Both get an Arabic label, because a manager reading a card called `Other`
 * reasonably assumes the dashboard failed to classify something. `DIMENSION_NOTE`
 * carries that distinction to the tooltips.
 *
 * `Other` is a lead-side value only. In the live workbook 348 of 18,405 CRM
 * leads carry it, 346 of them with no campaign at all and most arriving through
 * Website, UChat or Chatwoot — a lead that started a conversation without ever
 * naming a course. The accounting side has no such category: `Other` appears in
 * no product, no product category and no revenue line. So a course card under
 * `Other` shows $0 by construction, and the tooltip has to say so, because the
 * first thing it was read as was "paid invoices with no course name".
 *
 * Money genuinely detached from a course is a different bucket — the taxonomy's
 * `Unattributed` — and it is real: $19,084.83 across 245 paid lines, being
 * certificates, website sales, private engagements, deliveries and returns.
 */
const OTHER_COURSE = "Other";

function displayDimension(value: string, lang: "ar" | "en") {
  if (lang !== "ar") return value;
  if (value === "Uncategorized") return "غير مصنف";
  if (value === OTHER_COURSE) return "أخرى";
  return value;
}

/** Hover text for the two labels above, so neither reads as a dashboard bug. */
function dimensionNote(value: string, lang: "ar" | "en"): string | undefined {
  if (value === OTHER_COURSE)
    return lang === "ar"
      ? "«أخرى» تصنيف بيتحط على الليد في أودو نفسه، مش عجز من الداشبورد — بياخده الليد اللي بيدخل من الشات أو الموقع من غير ما يقول عايز كورس إيه. جانب الفواتير مفيهوش تصنيف اسمه Other أصلاً، عشان كده الكارت ده بيفضل $0: الفلوس بتتكتب لما الليد يتحوّل لكورس حقيقي."
      : "“Other” is a category Odoo records on the lead, not a gap in the dashboard — it is what a lead gets when it arrives from chat or the website without naming a course. No invoice ever carries it, which is why this card sits at $0: revenue is booked once the lead converts onto a real course.";
  if (value === "Uncategorized")
    return lang === "ar"
      ? "الصف ده جه من أودو وخانة التصنيف فيه فاضية، فمحطّهناش على كورس بالتخمين."
      : "This row arrived from Odoo with its category column empty, so it was not guessed onto a course.";
  return undefined;
}

function monthEnd(month: string): string {
  const [year, rawMonth] = month.split("-").map(Number);
  if (!year || !rawMonth) return `${month}-31`;
  return new Date(Date.UTC(year, rawMonth, 0)).toISOString().slice(0, 10);
}

function formatCallHours(seconds: number | null, lang: "ar" | "en"): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (lang === "ar")
    return bidiArabic(
      hours > 0
        ? `${bidiNumber(hours)}\u00a0ساعة و${bidiNumber(minutes)}\u00a0دقيقة`
        : `${bidiNumber(minutes)}\u00a0دقيقة`,
    );
  return hours > 0 ? `${fmtNum(hours)}h ${fmtNum(minutes)}m` : `${fmtNum(minutes)}m`;
}

function CallHoursKpiValue({ seconds, lang }: { seconds: number | null; lang: "ar" | "en" }) {
  if (seconds === null || !Number.isFinite(seconds)) return <>—</>;
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const unitClass = "text-[0.62em] font-semibold tracking-normal text-text-muted";
  return (
    <span
      className="inline-flex max-w-full flex-wrap items-baseline justify-start gap-x-2 gap-y-1"
      dir={lang === "ar" ? "rtl" : "ltr"}
      aria-label={formatCallHours(seconds, lang)}
    >
      {hours > 0 && (
        <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
          <bdi dir="ltr">{fmtNum(hours)}</bdi>
          <span className={unitClass}>{lang === "ar" ? "ساعة" : "hours"}</span>
        </span>
      )}
      <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
        <bdi dir="ltr">{fmtNum(minutes)}</bdi>
        <span className={unitClass}>{lang === "ar" ? "دقيقة" : "minutes"}</span>
      </span>
    </span>
  );
}

function formatCallDuration(seconds: number | null, lang: "ar" | "en"): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  if (hours > 0) {
    const minuteRemainder = Math.floor((total % 3600) / 60);
    return lang === "ar"
      ? bidiArabic(`${bidiNumber(hours)}\u00a0ساعة و${bidiNumber(minuteRemainder)}\u00a0دقيقة`)
      : `${fmtNum(hours)}h ${fmtNum(minuteRemainder)}m`;
  }
  return lang === "ar"
    ? bidiArabic(`${bidiNumber(minutes)}\u00a0دقيقة و${bidiNumber(remainder)}\u00a0ثانية`)
    : `${fmtNum(minutes)}m ${fmtNum(remainder)}s`;
}

function bidiNumber(value: number): string {
  return `\u2066${fmtNum(value)}\u2069`;
}

function bidiArabic(value: string): string {
  return `\u2067${value}\u2069`;
}

function highlightSuspectText(text: string, terms: string[], lang: "ar" | "en"): ReactNode {
  const cleaned = [...new Set(terms.map((term) => term.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (!cleaned.length) return text;
  const escaped = cleaned.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const expression = new RegExp(`(${escaped.join("|")})`, "giu");
  const suspect = new Set(cleaned.map((term) => term.toLocaleLowerCase("ar")));
  return text.split(expression).map((part, index) =>
    suspect.has(part.toLocaleLowerCase("ar")) ? (
      <mark
        key={`${part}-${index}`}
        className="rounded bg-warning-soft px-1 text-text"
        title={
          lang === "ar"
            ? "كلمة مشتبه بها ولا تستخدم كدليل خصم"
            : "Suspect word excluded from deductions"
        }
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function fmtQuality(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${Math.round(value)}/100`;
}

function fmtScorePoints(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function qualityTone(value: number | null): "success" | "brand" | "warning" | "danger" | "neutral" {
  if (value === null) return "neutral";
  if (value >= 85) return "success";
  if (value >= 70) return "brand";
  if (value >= 55) return "warning";
  return "danger";
}

function formatCallDate(value: string, lang: "ar" | "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value || "—";
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function ProgressMetric({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: number | null;
  color: string;
  /** Hover explanation. See the note on `MiniMetric` for why not a popover. */
  hint?: string;
}) {
  const safe = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px]">
        <span className="text-text-muted" title={hint ? `${label} — ${hint}` : undefined}>
          {label}
        </span>
        <span className="num font-semibold text-text">{fmtPct(value, 1)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${safe}%`, background: color }}
        />
      </div>
    </div>
  );
}

/**
 * The four profit-and-loss figures, straight from Odoo.
 *
 * These are not the dashboard's own arithmetic: they are Odoo's posted Profit
 * and Loss report, in the company's own currency. Each panel names the lines it
 * is made of so a reader can trace it back to the ledger rather than to a
 * calculation this app performed.
 */
function profitabilityMetrics(
  snapshot: NonNullable<ProfitabilityResponse["snapshot"]>,
  companyScope: string,
  lang: Lang,
): Record<string, MetricDetail> {
  const A = lang === "ar";
  const money = (value: number | null) => localMoney(value, snapshot.currency);
  const margin =
    snapshot.income && snapshot.income !== 0 && snapshot.netProfit !== null
      ? fmtPct((snapshot.netProfit / snapshot.income) * 100, 1)
      : "—";
  const authority = A
    ? `تقرير Profit and Loss من Odoo ${companyScope}، قيود مرحلة فقط، للفترة ${snapshot.from} → ${snapshot.to}.`
    : `Odoo's Profit and Loss report ${companyScope}, posted entries only, ${snapshot.from} → ${snapshot.to}.`;
  const lines = (predicate: (value: number) => boolean, tone: MetricBreakdownRow["tone"]) =>
    topRows(
      snapshot.lines
        .filter((line) => Number.isFinite(line.value) && predicate(line.value))
        .map((line) => ({
          key: line.id,
          label: line.label,
          value: Math.abs(line.value),
          display: money(line.value),
          tone,
        })),
    );
  const shared = [
    { key: "income", label: A ? "الدخل" : "Income", value: money(snapshot.income) },
    { key: "expenses", label: A ? "المصروفات" : "Expenses", value: money(snapshot.expenses) },
    {
      key: "gross",
      label: A ? "إجمالي الربح" : "Gross profit",
      value: money(snapshot.grossProfit),
    },
    { key: "margin", label: A ? "هامش صافي الربح" : "Net margin", value: margin },
  ];

  return {
    netProfit: {
      id: "accounting.netProfit",
      title: A ? "صافي الربح" : "Net profit",
      value: money(snapshot.netProfit),
      tone: "mint",
      definition: A
        ? "الدخل ناقص المصروفات، كما يحسبه Odoo نفسه لهذه الفترة."
        : "Income less expenses, as Odoo itself computes it for this window.",
      formula: `${money(snapshot.income)} − ${money(snapshot.expenses)} = ${money(snapshot.netProfit)}`,
      caveat: authority,
      supporting: shared,
      breakdowns: [
        {
          id: "expenses",
          title: A ? "أكبر بنود المصروفات" : "Largest expense lines",
          rows: lines((balance) => balance < 0, "rose"),
          emptyLabel: A ? "لا توجد بنود مصروفات" : "No expense lines",
        },
      ],
    },
    income: {
      id: "accounting.income",
      title: A ? "الدخل" : "Income",
      value: money(snapshot.income),
      tone: "mint",
      definition: A
        ? "كل الدخل المسجَّل في دفاتر Odoo لهذه الفترة، تشغيليًا كان أو غير تشغيلي."
        : "All income recorded in Odoo's books for this window, operating and non-operating alike.",
      formula: A
        ? `تشغيلي ${money(snapshot.operatingIncome)} + غير تشغيلي ${money(snapshot.otherIncome)}.`
        : `Operating ${money(snapshot.operatingIncome)} plus other ${money(snapshot.otherIncome)}.`,
      caveat: authority,
      supporting: [
        {
          key: "operating",
          label: A ? "دخل تشغيلي" : "Operating income",
          value: money(snapshot.operatingIncome),
        },
        { key: "other", label: A ? "دخل آخر" : "Other income", value: money(snapshot.otherIncome) },
        {
          key: "cost",
          label: A ? "تكلفة الإيراد" : "Cost of revenue",
          value: money(snapshot.costOfRevenue),
        },
        { key: "net", label: A ? "صافي الربح" : "Net profit", value: money(snapshot.netProfit) },
      ],
      breakdowns: [
        {
          id: "income",
          title: A ? "أكبر بنود الدخل" : "Largest income lines",
          rows: lines((balance) => balance > 0, "mint"),
          emptyLabel: A ? "لا توجد بنود دخل" : "No income lines",
        },
      ],
    },
    expenses: {
      id: "accounting.expenses",
      title: A ? "المصروفات" : "Expenses",
      value: money(snapshot.expenses),
      tone: "rose",
      definition: A
        ? "كل المصروفات المرحّلة في دفاتر Odoo لهذه الفترة، بما فيها الإهلاك."
        : "All expenses posted in Odoo's books for this window, depreciation included.",
      formula: `${money(snapshot.income)} − ${money(snapshot.expenses)} = ${money(snapshot.netProfit)}`,
      caveat: authority,
      supporting: [
        {
          key: "depreciation",
          label: A ? "الإهلاك" : "Depreciation",
          value: money(snapshot.depreciation),
        },
        {
          key: "cost",
          label: A ? "تكلفة الإيراد" : "Cost of revenue",
          value: money(snapshot.costOfRevenue),
        },
        { key: "income", label: A ? "الدخل" : "Income", value: money(snapshot.income) },
        { key: "margin", label: A ? "هامش صافي الربح" : "Net margin", value: margin },
      ],
      breakdowns: [
        {
          id: "expenses",
          title: A ? "أكبر بنود المصروفات" : "Largest expense lines",
          rows: lines((balance) => balance < 0, "rose"),
          emptyLabel: A ? "لا توجد بنود مصروفات" : "No expense lines",
        },
      ],
    },
    grossProfit: {
      id: "accounting.grossProfit",
      title: A ? "إجمالي الربح" : "Gross profit",
      value: money(snapshot.grossProfit),
      tone: "cyan",
      definition: A
        ? "الدخل التشغيلي ناقص تكلفة الإيراد، قبل المصروفات العامة. يقيس ربح النشاط نفسه لا ربح الشركة."
        : "Operating income less the cost of revenue, before general expenses. It measures the activity's own profit, not the company's.",
      formula: `${money(snapshot.operatingIncome)} − ${money(snapshot.costOfRevenue)} = ${money(snapshot.grossProfit)}`,
      caveat: authority,
      supporting: shared,
      breakdowns: [
        {
          id: "income",
          title: A ? "أكبر بنود الدخل" : "Largest income lines",
          rows: lines((balance) => balance > 0, "mint"),
          emptyLabel: A ? "لا توجد بنود دخل" : "No income lines",
        },
      ],
    },
  };
}

export function AccountingProfitabilityView() {
  const { lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<ProfitabilityResponse>("/api/profitability");

  useEffect(() => {
    if (data?.status !== "loading") return;
    const timer = window.setTimeout(() => refetch(), 15_000);
    return () => window.clearTimeout(timer);
  }, [data?.status, refetch]);

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (isLoading || !data)
    return (
      <>
        <Skeleton className="h-28" />
        <Skeleton className="mt-4 h-96" />
      </>
    );
  if (!data.snapshot) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <RefreshCw
            className={data.status === "loading" ? "animate-spin text-brand" : "text-danger"}
            size={28}
          />
          <div className="font-semibold text-text">
            {data.status === "loading"
              ? lang === "ar"
                ? "Odoo يجهّز تقرير الربح والخسارة"
                : "Odoo is building the Profit and Loss report"
              : lang === "ar"
                ? "تعذر تحميل الربحية"
                : "Profitability could not be loaded"}
          </div>
          <p className="max-w-xl text-xs leading-relaxed text-text-muted">
            {data.error ||
              (lang === "ar"
                ? "التقرير ثقيل ويعمل في الخلفية؛ باقي الحسابات لا تتوقف. ستتم إعادة المحاولة تلقائيًا."
                : "The report is heavy and runs in the background; the rest of Accounting remains responsive. Retrying automatically.")}
          </p>
          <button
            onClick={() => refetch()}
            className="min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-white"
          >
            {lang === "ar" ? "إعادة المحاولة" : "Retry"}
          </button>
        </div>
      </Card>
    );
  }

  const p = data.snapshot;
  const companyNames = p.companies.map((company) => company.name).join("، ");
  const companyScope =
    p.companies.length === 1
      ? lang === "ar"
        ? `لشركة ${companyNames}`
        : `for ${companyNames}`
      : lang === "ar"
        ? `لكل الشركات المتاحة في Odoo (${p.companies.length}): ${companyNames}`
        : `for every Odoo-accessible company (${p.companies.length}): ${companyNames}`;
  // One description per figure, built from the snapshot already on screen.
  const profitFigures = profitabilityMetrics(p, companyScope, lang);

  return (
    <div className="space-y-4">
      <Notice
        tone="info"
        title={lang === "ar" ? "المصدر المحاسبي للربحية" : "Profitability authority"}
        icon={<Calculator size={16} />}
      >
        {lang === "ar"
          ? `تقرير Profit and Loss مباشر من Odoo 17 ${companyScope}، قيود مرحلة فقط، للفترة ${p.from} → ${p.to}. الربح = الدخل − المصروفات.`
          : `Direct Odoo 17 Profit and Loss ${companyScope}, posted entries only, ${p.from} → ${p.to}. Profit = income − expenses.`}
      </Notice>
      <KpiRow>
        <MetricDetailTrigger
          detail={profitFigures.netProfit}
          card={{ index: 0, hero: true, valueWrap: true }}
        />
        <MetricDetailTrigger detail={profitFigures.income} card={{ index: 1, valueWrap: true }} />
        <MetricDetailTrigger detail={profitFigures.expenses} card={{ index: 2, valueWrap: true }} />
        <MetricDetailTrigger
          detail={profitFigures.grossProfit}
          card={{ index: 3, valueWrap: true }}
        />
      </KpiRow>
      <Card>
        <SectionTitle
          action={
            <Pill tone={data.status === "refreshing" ? "warning" : "success"}>
              {data.status === "refreshing"
                ? lang === "ar"
                  ? "تحديث في الخلفية"
                  : "Refreshing"
                : lang === "ar"
                  ? "مباشر من Odoo"
                  : "Live from Odoo"}
            </Pill>
          }
        >
          {lang === "ar" ? "تفاصيل الربح والخسارة" : "Profit and Loss details"}
        </SectionTitle>
        <div className="divide-y divide-border">
          {p.lines.map((line) => (
            <div
              key={line.id}
              className="flex items-center justify-between gap-4 py-2.5"
              style={{ paddingInlineStart: `${Math.min(line.level, 4) * 12}px` }}
            >
              <span
                className={line.level <= 1 ? "font-semibold text-text" : "text-sm text-text-muted"}
              >
                {line.label}
              </span>
              <span className="num whitespace-nowrap font-semibold text-text">
                {localMoney(line.value, p.currency)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-text-muted">
          <span className="inline-flex items-center gap-1">
            <Users size={13} />
            {p.companies.map((company) => company.name).join(" · ")}
          </span>
        </div>
      </Card>
    </div>
  );
}
