import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Calculator,
  ChartNoAxesCombined,
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
import { fmtNum, fmtPct, fmtUSDExact, fmtUSDFull, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import { filterStore, useFilters } from "@/lib/filter-store";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type {
  AgentAnalyticsResult as AgentsResponse,
  AgentAnalyticsRow as AgentRow,
  AgentCoursePerformance,
  AgentSpecializationPerformance,
  AgentTarget,
} from "@/lib/agent-analytics.server";

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

export function AccountingMonthlyView({ monthly }: { monthly: AccountingMonth[] }) {
  const { lang } = useI18n();
  const filters = useFilters();
  const dateBasis = filters.dateBasis === "invoice" ? "Invoice Date" : "Payment Date";
  const latest = monthly.at(-1);
  const previous = monthly.at(-2);
  return (
    <div className="space-y-4">
      <Notice tone="info" icon={<Info size={16} />}>
        {lang === "ar"
          ? `الفواتير الموجبة حسب ${dateBasis}، والإلغاء يظهر بالسالب في شهر تاريخ العكس. كل شهر يُقارن بالشهر السابق مباشرة.`
          : `Positive invoices use ${dateBasis}; cancellations are negative in their reversal month. Each month is compared with its predecessor.`}
      </Notice>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          index={0}
          label={lang === "ar" ? "تحصيل آخر شهر" : "Latest month collections"}
          value={fmtUSDExact(latest?.revenue ?? null)}
          hero
        />
        <KpiCard
          index={1}
          label={lang === "ar" ? "فواتير آخر شهر" : "Latest month invoices"}
          value={fmtNum(latest?.invoices ?? 0)}
        />
        <KpiCard
          index={2}
          label={lang === "ar" ? "النمو الشهري" : "Month-over-month growth"}
          value={fmtPct(latest?.growthPct ?? null, 1)}
        />
        <KpiCard
          index={3}
          label={lang === "ar" ? "إلغاءات آخر شهر" : "Latest month cancellations"}
          value={fmtUSDExact(latest?.creditNoteUsd ?? null)}
          sub={`${fmtNum(latest?.creditNotes ?? 0)} ${lang === "ar" ? "إشعار خصم" : "credit notes"}`}
        />
      </div>
      <Card>
        <SectionTitle>{lang === "ar" ? "اتجاه التحصيل وعدد الفواتير" : "Collections and invoice trend"}</SectionTitle>
        <MultiLineChart
          data={monthly.map((row) => ({
            date: `${row.month}-01`,
            revenue: row.revenue,
            invoices: row.invoices,
          }))}
          series={[
            { key: "revenue", name: lang === "ar" ? "التحصيل" : "Collections", color: "var(--chart-2)" },
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
        <SectionTitle>{lang === "ar" ? "مقارنة شهر بشهر" : "Month-by-month comparison"}</SectionTitle>
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
                    row.growthPct === null
                      ? "neutral"
                      : row.growthPct >= 0
                        ? "success"
                        : "danger"
                  }
                >
                  {index === 0 ? (lang === "ar" ? "بداية القياس" : "Baseline") : fmtPct(row.growthPct, 1)}
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
                  {lang === "ar" ? "إلغاءات الشهر" : "Month cancellations"}: {fmtNum(row.creditNotes)} · {fmtUSDExact(row.creditNoteUsd)}
                </div>
              )}
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function AccountingAgentsView() {
  const { lang } = useI18n();
  const filters = useFilters();
  const [display, setDisplay] = useState<"cards" | "table">("cards");
  const [sortBy, setSortBy] = useState<"revenue" | "closing" | "calls">("revenue");
  const [search, setSearch] = useState("");
  const [selectedAgentKey, setSelectedAgentKey] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useApi<AgentsResponse>("/api/teams");
  useEffect(() => {
    if (data && !data.sla.callsAvailable && sortBy === "calls") setSortBy("revenue");
  }, [data, sortBy]);
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (isLoading || !data) return <><Skeleton className="h-28" /><Skeleton className="mt-4 h-96" /></>;

  const filterMonth = filters.from?.slice(0, 7) || "";
  const selectedMonth =
    filterMonth &&
    filters.from === `${filterMonth}-01` &&
    filters.to === monthEnd(filterMonth)
      ? filterMonth
      : "";
  const normalizedSearch = search.trim().toLocaleLowerCase(lang === "ar" ? "ar" : "en");
  const visibleAgents = data.agents
    .filter((row) =>
      normalizedSearch
        ? `${row.name} ${row.team}`.toLocaleLowerCase(lang === "ar" ? "ar" : "en").includes(normalizedSearch)
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

  const selectMonth = (month: string) => {
    if (!month) return;
    filterStore.setDates(`${month}-01`, monthEnd(month));
  };

  return (
    <div className="space-y-4">
      <Notice tone="info" icon={<Info size={16} />}>
        {lang === "ar"
          ? `التحصيل والفواتير من حسابات Odoo حسب ${data.selected.dateBasis === "invoice" ? "تاريخ الفاتورة" : "تاريخ الدفع"}${data.selected.company ? ` لشركة ${data.selected.company}` : ""}. الليدز والإغلاقات من Odoo، والمكالمات من Yeastar بعد تخزينها في PostgreSQL على Railway.`
          : `Collections use Odoo ${data.selected.dateBasis === "invoice" ? "Invoice Date" : "Payment Date"}${data.selected.company ? ` for ${data.selected.company}` : ""}. Leads and closures come from Odoo; Yeastar calls are stored in Railway PostgreSQL.`}
      </Notice>
      {!data.sla.ok && (
        <Notice tone="warning" title={lang === "ar" ? "بيانات المكالمات غير متاحة مؤقتًا" : "Call data temporarily unavailable"}>
          {data.sla.error || (lang === "ar" ? "تظهر مؤشرات الحسابات والعملاء فقط." : "Accounting and CRM metrics remain available.")}
        </Notice>
      )}
      {data.sla.ok && !data.sla.callsAvailable && (
        <Notice
          tone="warning"
          title={lang === "ar" ? "مكالمات الفترة دي لسه ماوصلتش Railway" : "Calls have not reached Railway for this period"}
        >
          {lang === "ar"
            ? `${data.sla.callsThrough ? `آخر مكالمات مكتملة عندنا: ${monthLabel(data.sla.callsThrough, lang)}. ` : ""}مش هنعرض صفر علشان ما نظلمش الموظفين؛ باقي أرقام Odoo شغالة عادي.`
            : `${data.sla.callsThrough ? `Latest complete calls: ${monthLabel(data.sla.callsThrough, lang)}. ` : ""}Calls are shown as unavailable rather than a misleading zero; Odoo metrics remain available.`}
        </Notice>
      )}
      <TargetNotices targets={data.targets} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          index={0}
          label={lang === "ar" ? "الموظفون النشطون" : "Active employees"}
          value={fmtNum(data.summary.agents)}
          sub={
            data.targets.matched > 0
              ? `${fmtNum(data.targets.matched)} ${lang === "ar" ? "بتارجت منشور" : "with a published target"}`
              : undefined
          }
          icon={<Users size={18} />}
        />
        <KpiCard
          index={1}
          label={lang === "ar" ? "التحصيل المدفوع" : "Paid collections"}
          value={fmtUSDExact(data.summary.paidRevenue)}
          sub={`${fmtNum(data.summary.invoices)} ${lang === "ar" ? "فاتورة" : "invoices"}`}
          icon={<ReceiptText size={18} />}
          hero
        />
        <KpiCard
          index={2}
          label={lang === "ar" ? "تارجت الفترة" : "Target for period"}
          // Prorated, so half a month shows half the quota. An em dash means no
          // target is published for this window — never a zero.
          value={data.targets.totalTarget === null ? "—" : fmtUSDFull(data.targets.totalTarget)}
          sub={
            data.targets.totalTarget === null
              ? lang === "ar" ? "لا يوجد تارجت منشور للفترة" : "No target published for this window"
              : `${lang === "ar" ? "الإنجاز" : "Achieved"} ${fmtPct(data.targets.totalAchievementPaid, 1)}${
                  data.targets.wholeMonths ? "" : lang === "ar" ? " · موزّع بالأيام" : " · prorated"
                }`
          }
          icon={<Target size={18} />}
        />
        <KpiCard
          index={3}
          label={lang === "ar" ? "ليدز دخلت الفترة" : "Leads created in period"}
          value={fmtNum(data.summary.cleanLeads)}
          sub={`${fmtNum(data.summary.won)} ${lang === "ar" ? "منهم Won" : "became Won"}`}
          icon={<UserRound size={18} />}
        />
        <KpiCard
          index={4}
          label={lang === "ar" ? "إغلاقات تمت في الفترة" : "Closures during period"}
          value={fmtNum(data.summary.periodClosedWon)}
          sub={`${fmtNum(data.summary.periodClosedLost)} Lost · ${fmtPct(data.summary.decidedConversionRate, 1)}`}
          icon={<Trophy size={18} />}
        />
        <KpiCard
          index={5}
          label={lang === "ar" ? "المكالمات الصادرة" : "Outbound calls"}
          value={data.summary.outboundCalls === null ? "—" : fmtNum(data.summary.outboundCalls)}
          sub={
            data.summary.answeredCalls === null
              ? lang === "ar" ? "غير متاحة للفترة" : "Unavailable for period"
              : `${fmtNum(data.summary.answeredCalls)} ${lang === "ar" ? "تم الرد" : "answered"} · ${fmtPct(data.summary.answerRate, 1)}`
          }
          icon={<PhoneCall size={18} />}
        />
      </div>

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
              {lang === "ar" ? "بحث عن موظف أو فريق" : "Search employee or team"}
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

          <div className="overflow-x-auto">
            <span className="mb-1.5 block text-xs font-medium text-text-muted">
              {lang === "ar" ? "رتّب الكروت حسب" : "Rank cards by"}
            </span>
            <Segmented
              value={sortBy}
              onChange={setSortBy}
              options={[
                { value: "revenue", label: lang === "ar" ? "التحصيل" : "Revenue" },
                { value: "closing", label: lang === "ar" ? "الإغلاقات" : "Closures" },
                ...(data.sla.callsAvailable
                  ? [{ value: "calls" as const, label: lang === "ar" ? "المكالمات" : "Calls" }]
                  : []),
              ]}
            />
            <p className="mt-1.5 text-[10px] text-text-subtle">
              {lang === "ar" ? "بيغيّر الترتيب وأهم رقم في الكارت، مش إجمالي الفترة." : "Changes card order and emphasis, not period totals."}
            </p>
          </div>

          <div className="overflow-x-auto">
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
          callsAvailable={data.sla.callsAvailable}
          onSelect={(row) => setSelectedAgentKey(row.key)}
        />
      ) : (
        <AgentTable rows={visibleAgents} onSelect={(row) => setSelectedAgentKey(row.key)} />
      )}

      <AgentPerformanceSheet
        row={selectedAgent}
        open={selectedAgent !== null}
        onOpenChange={(next) => {
          if (!next) setSelectedAgentKey(null);
        }}
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
              ? `${fmtNum(targets.unmatched.length)} تارجت منشور بلا موظف مطابق`
              : `${fmtNum(targets.unmatched.length)} published targets matched no employee`
          }
        >
          {lang === "ar"
            ? `${targets.unmatched.map((row) => row.name).join("، ")} — يا إما مفيش أي نشاط ليهم في الفترة دي، يا إما الاسم مكتوب في ملف التارجت غير المكتوب في أودو ومحتاج يتضاف كاسم بديل. مش بنوزّع التارجت ده على حد تاني.`
            : `${targets.unmatched.map((row) => row.name).join(", ")} — either they had no activity in this period, or the workbook spells them differently from Odoo and needs an alias. Their quota is never reassigned to anyone else.`}
        </Notice>
      )}
      {!targets.complete && targets.monthsMissing.length > 0 && (
        <Notice
          tone="warning"
          title={
            lang === "ar"
              ? "التارجت يغطي جزءاً من الفترة فقط"
              : "The target covers only part of this window"
          }
        >
          {lang === "ar"
            ? `التارجت منشور لـ ${targets.publishedMonths.map((month) => monthLabel(month, lang)).join("، ")} بس، والفترة المختارة بتمتد لـ ${fmtNum(targets.monthsMissing.length)} شهر تاني بلا تارجت. نسبة الإنجاز هنا بتقارن مبيعات الفترة كلها بتارجت الشهور المنشورة فقط — اختر شهراً بعينه عشان تبقى المقارنة عادلة.`
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
    <section className="rounded-2xl border border-brand/20 bg-brand-soft/40 p-4 sm:p-5">
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
              value={money(target.target)}
              sub={
                target.wholeMonths
                  ? target.monthsCovered.map((month) => monthLabel(month, lang)).join(" · ")
                  : `${lang === "ar" ? "موزّع بالأيام من" : "prorated from"} ${money(target.monthlyTarget)}`
              }
              icon={<Target size={17} />}
              hero
            />
            <ProfileMetric
              label={lang === "ar" ? "إنجاز التحصيل" : "Collections vs target"}
              value={fmtPct(target.achievementPaid, 1)}
              sub={gapLabel(target.gapPaid)}
              icon={<ReceiptText size={17} />}
            />
            <ProfileMetric
              label={lang === "ar" ? "إنجاز التشغيلي" : "Operational vs target"}
              value={fmtPct(target.achievementOperational, 1)}
              sub={
                row.operationalSales === null
                  ? lang === "ar"
                    ? "غير متاح للفترة"
                    : "Unavailable for period"
                  : gapLabel(target.gapOperational)
              }
              icon={<Calculator size={17} />}
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
                  ? "نسبة إنجاز التارجت (تحصيل مدفوع)"
                  : "Target achievement (paid collections)"
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
        </>
      )}
    </section>
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
          aria-label={lang === "ar" ? `فتح تحليل ${row.name}` : `Open ${row.name} analysis`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-sm font-bold text-brand">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-text" title={row.name}>
                    {row.name}
                  </h3>
                  <p className="mt-0.5 truncate text-[11px] text-text-muted" title={row.team}>
                    {row.team}
                  </p>
                </div>
              </div>
            </div>
            <Pill tone={row.decidedConversionRate !== null && row.decidedConversionRate >= 10 ? "success" : "neutral"}>
              {lang === "ar" ? "إغلاق الفترة" : "Period close"} {fmtPct(row.decidedConversionRate, 1)}
            </Pill>
          </div>

          <div className="mt-4 rounded-2xl bg-surface-2 p-3">
            <div className="text-[11px] font-medium text-text-muted">
              {sortBy === "closing"
                ? lang === "ar" ? "إغلاقات Won تمت في الفترة" : "Won closures in period"
                : sortBy === "calls"
                  ? lang === "ar" ? "المكالمات الصادرة" : "Outbound calls"
                  : lang === "ar" ? "التحصيل المدفوع" : "Paid collections"}
            </div>
            <div className="num mt-1 text-xl font-semibold text-text">
              {sortBy === "closing"
                ? fmtNum(row.slaWon)
                : sortBy === "calls"
                  ? row.outboundCalls === null ? "—" : fmtNum(row.outboundCalls)
                  : fmtUSDExact(row.paidRevenue)}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <MiniMetric label={lang === "ar" ? "الفواتير" : "Invoices"} value={fmtNum(row.invoices)} />
            <MiniMetric label={lang === "ar" ? "ليدز دخلت" : "New leads"} value={fmtNum(row.cleanLeads)} />
            <MiniMetric label={lang === "ar" ? "التحصيل" : "Collections"} value={fmtUSDExact(row.paidRevenue)} />
            <MiniMetric label={lang === "ar" ? "إغلاقات Won" : "Won closures"} value={fmtNum(row.slaWon)} />
            <MiniMetric label={lang === "ar" ? "إغلاقات Lost" : "Lost closures"} value={fmtNum(row.slaLost)} />
            <MiniMetric
              label={lang === "ar" ? "المكالمات" : "Calls"}
              value={!callsAvailable || row.outboundCalls === null ? "—" : fmtNum(row.outboundCalls)}
            />
          </div>

          <div className="mt-4 space-y-2.5">
            {row.target && row.target.target !== null && (
              <ProgressMetric
                label={
                  lang === "ar"
                    ? `إنجاز التارجت (${fmtUSDFull(row.target.target)}${row.target.wholeMonths ? "" : " موزّع بالأيام"})`
                    : `Target achievement (${fmtUSDFull(row.target.target)}${row.target.wholeMonths ? "" : ", prorated"})`
                }
                value={row.target.achievementPaid}
                color="var(--brand)"
              />
            )}
            <ProgressMetric
              label={lang === "ar" ? "نسبة الإغلاق في الفترة" : "Period closure rate"}
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
              {lang === "ar" ? "Won من ليدز الفترة" : "Cohort Won"}:{" "}
              <b className="num text-text">{fmtNum(row.won)}</b>
            </span>
            <span>
              {lang === "ar" ? "تم الرد" : "Answered"}:{" "}
              <b className="num text-text">{row.answeredCalls === null ? "—" : fmtNum(row.answeredCalls)}</b>
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

function AgentTable({ rows, onSelect }: { rows: AgentRow[]; onSelect: (row: AgentRow) => void }) {
  const { lang } = useI18n();
  return (
    <Card padded={false}>
      <div className="border-b border-border p-4 sm:p-5">
        <SectionTitle className="mb-0">{lang === "ar" ? "كل الموظفين" : "All employees"}</SectionTitle>
      </div>
      <div className="max-h-[680px] overflow-auto">
        <table className="w-full min-w-[1400px] text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr className="text-[11px] uppercase tracking-wide text-text-muted">
              {[
                lang === "ar" ? "الموظف" : "Employee",
                lang === "ar" ? "التارجت" : "Target",
                lang === "ar" ? "التحصيل المدفوع" : "Paid collections",
                lang === "ar" ? "إنجاز التحصيل" : "Collections vs target",
                lang === "ar" ? "إنجاز التشغيلي" : "Operational vs target",
                lang === "ar" ? "الفواتير" : "Invoices",
                lang === "ar" ? "العملاء" : "Leads",
                "Won",
                "Lost",
                lang === "ar" ? "نسبة الإغلاق" : "Conversion",
                lang === "ar" ? "إغلاقات الفترة" : "Period closures",
                lang === "ar" ? "المكالمات" : "Calls",
                lang === "ar" ? "تم الرد" : "Answered",
                lang === "ar" ? "نسبة الرد" : "Answer rate",
                lang === "ar" ? "لم يتم التواصل" : "Uncontacted",
                lang === "ar" ? "مبيعات SLA التشغيلية" : "SLA operational sales",
              ].map((label, index) => (
                <th key={label} className={`px-3 py-2.5 ${index === 0 ? "text-start" : "text-end"}`}>{label}</th>
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
                    {row.name}
                  </button>
                  <div className="mt-0.5 max-w-[220px] truncate text-[11px] text-text-muted" title={row.team}>{row.team}</div>
                </td>
                <td className="px-3 py-3 text-end">
                  <div className="num font-semibold">
                    {row.target?.target === null || !row.target ? "—" : fmtUSDFull(row.target.target)}
                  </div>
                  <div className="mt-0.5 text-[10px] text-text-muted">
                    {!row.target
                      ? lang === "ar"
                        ? "بدون تارجت"
                        : "No target"
                      : row.target.target === null
                        ? row.target.note || (lang === "ar" ? "غير مستهدف" : "Untargeted")
                        : row.target.wholeMonths
                          ? row.target.teamLeader
                          : `${lang === "ar" ? "من" : "of"} ${fmtUSDFull(row.target.monthlyTarget ?? 0)} ${lang === "ar" ? "شهرياً" : "monthly"}`}
                  </div>
                </td>
                <td className="num px-3 py-3 text-end font-semibold">
                  {fmtUSDExact(row.paidRevenue)}
                </td>
                <td className="px-3 py-3 text-end">
                  <TargetPill value={row.target?.achievementPaid ?? null} />
                </td>
                <td className="px-3 py-3 text-end">
                  <TargetPill value={row.target?.achievementOperational ?? null} />
                </td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.invoices)}</td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.cleanLeads)}</td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.won)}</td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.lost)}</td>
                <td className="px-3 py-3 text-end"><Pill tone={row.conversionRate !== null && row.conversionRate >= 10 ? "success" : "neutral"}>{fmtPct(row.conversionRate, 1)}</Pill></td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.slaWon)} / {fmtNum(row.slaLost)}</td>
                <td className="num px-3 py-3 text-end">{row.outboundCalls === null ? "—" : fmtNum(row.outboundCalls)}</td>
                <td className="num px-3 py-3 text-end">{row.answeredCalls === null ? "—" : fmtNum(row.answeredCalls)}</td>
                <td className="num px-3 py-3 text-end">{fmtPct(row.answerRate, 1)}</td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.uncontactedLeads)}</td>
                <td className="num px-3 py-3 text-end">
                  {row.operationalSales === null
                    ? "—"
                    : row.operationalSales.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  <span className="ms-1 text-[10px] text-text-muted">{lang === "ar" ? "عملة أودو" : "Odoo currency"}</span>
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { lang } = useI18n();
  const [courseMetric, setCourseMetric] = useState<"revenue" | "invoices" | "leads">("revenue");
  useEffect(() => setCourseMetric("revenue"), [row?.key]);
  if (!row) return null;

  const { courseProfile } = row;
  const metricConfig = {
    revenue: {
      value: (course: AgentCoursePerformance) => course.paidRevenue,
      format: fmtUSDFull,
    },
    invoices: {
      value: (course: AgentCoursePerformance) => course.invoices,
      format: fmtNum,
    },
    leads: {
      value: (course: AgentCoursePerformance) => course.leads,
      format: fmtNum,
    },
  }[courseMetric];
  const courseChart = [...courseProfile.courses]
    .filter((course) => metricConfig.value(course) > 0)
    .sort((left, right) => metricConfig.value(right) - metricConfig.value(left))
    .slice(0, 10)
    .map((course) => ({ label: course.label, value: metricConfig.value(course) }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
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
            <SheetTitle className="text-2xl font-bold text-white sm:text-3xl">{row.name}</SheetTitle>
            <SheetDescription className="max-w-3xl text-xs leading-relaxed text-white/72 sm:text-sm">
              {lang === "ar"
                ? "تفصيل التحصيل والليدز والتحويل حسب كل كورس وتخصص داخل الفترة والفلاتر المختارة."
                : "Paid collections, leads, and conversion by course and specialization for the selected period and filters."}
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="space-y-5 p-4 sm:p-7">
          {row.target && <AgentTargetPanel target={row.target} row={row} />}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ProfileMetric
              label={lang === "ar" ? "التحصيل المدفوع" : "Paid collections"}
              value={fmtUSDFull(row.paidRevenue)}
              sub={`${fmtNum(row.invoices)} ${lang === "ar" ? "فاتورة" : "invoices"}`}
              icon={<ReceiptText size={17} />}
              hero
            />
            <ProfileMetric
              label={lang === "ar" ? "إجمالي الليدز" : "Total leads"}
              value={fmtNum(row.cleanLeads)}
              sub={`${fmtNum(row.won)} Won · ${fmtNum(row.lost)} Lost`}
              icon={<Users size={17} />}
            />
            <ProfileMetric
              label={lang === "ar" ? "تحويل كل الليدز" : "Lead conversion"}
              value={fmtPct(row.conversionRate, 1)}
              sub={lang === "ar" ? "Won ÷ إجمالي الليدز" : "Won ÷ all leads"}
              icon={<ChartNoAxesCombined size={17} />}
            />
            <ProfileMetric
              label={lang === "ar" ? "تحويل الحالات المحسومة" : "Decided conversion"}
              value={fmtPct(row.decidedConversionRate, 1)}
              sub={lang === "ar" ? "Won ÷ (Won + Lost)" : "Won ÷ (Won + Lost)"}
              icon={<Trophy size={17} />}
            />
          </div>

          {!courseProfile.lostDataAvailable && (
            <Notice
              tone="warning"
              title={lang === "ar" ? "بيانات Lost غير مكتملة حاليًا" : "Lost data is currently incomplete"}
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
                  {lang === "ar" ? "فين الموظف قوي وفين محتاج دعم؟" : "Where is this employee strongest?"}
                </h3>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <CourseInsight
                icon={<TrendingUp size={18} />}
                eyebrow={lang === "ar" ? "أفضل مبيعات" : "Best sales"}
                course={courseProfile.bestSellingCourse}
                value={(course) => fmtUSDFull(course.paidRevenue)}
                sub={(course) => `${fmtPct(course.salesShare, 1)} ${lang === "ar" ? "من مبيعات الموظف" : "of employee sales"}`}
                tone="success"
              />
              <CourseInsight
                icon={<TrendingDown size={18} />}
                eyebrow={lang === "ar" ? "أقل مبيعات" : "Lowest sales"}
                course={courseProfile.leastSellingCourse}
                value={(course) => fmtUSDFull(course.paidRevenue)}
                sub={(course) => `${fmtNum(course.invoices)} ${lang === "ar" ? "فاتورة" : "invoices"}`}
                tone="neutral"
              />
              <CourseInsight
                icon={<Sparkles size={18} />}
                eyebrow={lang === "ar" ? "أفضل تحويل بعينة كافية" : "Best reliable conversion"}
                course={courseProfile.bestConvertingCourse}
                value={(course) => fmtPct(course.conversionRate, 1)}
                sub={(course) => `${fmtNum(course.won)} Won / ${fmtNum(course.leads)} ${lang === "ar" ? "ليد" : "leads"}`}
                tone="brand"
                // A cohort can be perfectly large and still hold no win yet, so
                // this must not read as "not enough data".
                empty={
                  courseProfile.bestReason === "no_win_yet"
                    ? lang === "ar"
                      ? "لسه مفيش Won في أي كورس من ليدز الفترة دي"
                      : "No lead from this period's cohort has been won yet"
                    : undefined
                }
              />
              <CourseInsight
                icon={<Layers3 size={18} />}
                eyebrow={lang === "ar" ? "يحتاج دعم" : "Needs support"}
                course={courseProfile.needsSupportCourse}
                value={(course) => fmtPct(course.conversionRate, 1)}
                sub={(course) =>
                  `${fmtNum(course.won + course.lost)} ${lang === "ar" ? "محسومة من" : "decided of"} ${fmtNum(course.leads)} ${lang === "ar" ? "ليد" : "leads"}`
                }
                tone="danger"
                // A course whose cohort is mostly still open is not a proven
                // weakness. Saying "not enough sample" would be wrong — the
                // sample is large, it just has not finished.
                empty={
                  courseProfile.needsSupportReason === "cohort_still_open"
                    ? lang === "ar"
                      ? `لسه بدري — أغلب الليدز مفتوحة ولسه بتتشغل. الحكم بيبدأ بعد ${fmtPct(courseProfile.minimumDecidedShare * 100, 0)} من الليدز تتحسم.`
                      : `Too early — most leads are still open. Judging starts once ${fmtPct(courseProfile.minimumDecidedShare * 100, 0)} of the cohort is decided.`
                    : undefined
                }
              />
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
            <Card>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <SectionTitle className="mb-0">
                  {lang === "ar" ? "أداء كل كورس" : "Performance by course"}
                </SectionTitle>
                <Segmented
                  value={courseMetric}
                  onChange={setCourseMetric}
                  options={[
                    { value: "revenue", label: lang === "ar" ? "المبيعات" : "Sales" },
                    { value: "invoices", label: lang === "ar" ? "الفواتير" : "Invoices" },
                    { value: "leads", label: lang === "ar" ? "الليدز" : "Leads" },
                  ]}
                />
              </div>
              <HBarChart
                data={courseChart}
                height={Math.max(260, courseChart.length * 34)}
                color="var(--chart-1)"
                format={metricConfig.format}
                labelWidth={118}
              />
            </Card>

            <Card>
              <SectionTitle hint={lang === "ar" ? "حسب عدد الليدز" : "By lead count"}>
                {lang === "ar" ? "توزيع الليدز حسب التخصص" : "Lead distribution by specialization"}
              </SectionTitle>
              <DonutChart
                data={courseProfile.specializations
                  .filter((item) => item.leads > 0)
                  .map((item) => ({ label: displayDimension(item.label, lang), value: item.leads }))}
                height={Math.max(280, courseProfile.specializations.length * 28)}
                format={fmtNum}
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
                      "Won",
                      "Lost",
                      lang === "ar" ? "مفتوح" : "Open",
                      lang === "ar" ? "تحويل الليدز" : "Lead conversion",
                      lang === "ar" ? "تحويل المحسوم" : "Decided conversion",
                      lang === "ar" ? "الفواتير" : "Invoices",
                      lang === "ar" ? "المبيعات" : "Sales",
                      lang === "ar" ? "% المبيعات" : "Sales share",
                      lang === "ar" ? "حجم العينة" : "Sample",
                    ].map((label, index) => (
                      <th key={`${label}-${index}`} className={`px-3 py-2.5 ${index < 2 ? "text-start" : "text-end"}`}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {courseProfile.courses.map((course) => (
                    <tr key={course.key} className="border-t border-border hover:bg-surface-2/70">
                      <td className="px-3 py-3 font-semibold text-text">{displayDimension(course.label, lang)}</td>
                      <td className="px-3 py-3 text-text-muted">{displayDimension(course.mainCategory, lang)}</td>
                      <td className="num px-3 py-3 text-end">{fmtNum(course.leads)}</td>
                      <td className="num px-3 py-3 text-end text-success">{fmtNum(course.won)}</td>
                      <td className="num px-3 py-3 text-end text-danger">{fmtNum(course.lost)}</td>
                      <td className="num px-3 py-3 text-end">{fmtNum(course.openLeads)}</td>
                      <td className="px-3 py-3 text-end"><Pill tone={conversionTone(course)}>{fmtPct(course.conversionRate, 1)}</Pill></td>
                      <td className="num px-3 py-3 text-end">{fmtPct(course.decidedConversionRate, 1)}</td>
                      <td className="num px-3 py-3 text-end">{fmtNum(course.invoices)}</td>
                      <td className="num px-3 py-3 text-end font-semibold">{fmtUSDFull(course.paidRevenue)}</td>
                      <td className="num px-3 py-3 text-end">{fmtPct(course.salesShare, 1)}</td>
                      <td className="px-3 py-3 text-end">
                        <Pill tone={course.sampleStatus === "reliable" ? "success" : "neutral"}>
                          {course.sampleStatus === "reliable"
                            ? lang === "ar" ? "كافية" : "Reliable"
                            : lang === "ar" ? "استرشادية" : "Directional"}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Notice tone="info" icon={<Info size={16} />}>
            {lang === "ar"
              ? `المبيعات هي صافي التحصيل من فواتير Odoo المدفوعة بتاريخ الدفع، فممكن تكون من ليدز اتعملت قبل الفترة. تحويل الليدز = Won ÷ ليدز الفترة نفسها، عشان كده الرقمين ممكن يختلفوا. «أفضل تحويل» محتاج ${courseProfile.minimumLeadSample} ليدز على الأقل ومعاهم Won حقيقي واحد؛ و«يحتاج دعم» محتاج كمان إن ${fmtPct(courseProfile.minimumDecidedShare * 100, 0)} من ليدز الكورس تكون اتحسمت — الكورس اللي لسه أغلب ليدزه مفتوحة ما يتحاسبش على إنه ضعيف.`
              : `Sales are net paid Odoo collections dated by payment, so they can come from cohorts created before this period. Lead conversion is Won ÷ this period's cohort, which is why the two can disagree. "Best conversion" needs at least ${courseProfile.minimumLeadSample} leads and one real win; "needs support" additionally requires ${fmtPct(courseProfile.minimumDecidedShare * 100, 0)} of the cohort to be decided — a course still mostly in play is never marked weak.`}
          </Notice>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ProfileMetric({
  label,
  value,
  sub,
  icon,
  hero = false,
}: {
  label: string;
  value: string;
  sub: string;
  icon: ReactNode;
  hero?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-3.5 ${hero ? "border-brand/20 bg-brand-soft" : "border-border bg-surface"}`}>
      <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
        <span>{label}</span>
        <span className="text-brand">{icon}</span>
      </div>
      <div className="num mt-2 text-xl font-bold text-text sm:text-2xl">{value}</div>
      <div className="mt-1 text-[11px] text-text-muted">{sub}</div>
    </div>
  );
}

function CourseInsight({
  icon,
  eyebrow,
  course,
  value,
  sub,
  tone,
  empty,
}: {
  icon: ReactNode;
  eyebrow: string;
  course: AgentCoursePerformance | null;
  value: (course: AgentCoursePerformance) => string;
  sub: (course: AgentCoursePerformance) => string;
  tone: "success" | "danger" | "brand" | "neutral";
  /** Why the card is empty, when "no reliable sample" is not the real reason. */
  empty?: string;
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
      </div>
      {course ? (
        <>
          <div className="mt-3 truncate text-base font-bold text-text" title={course.label}>
            {displayDimension(course.label, lang)}
          </div>
          <div className="num mt-1 text-lg font-bold text-text">{value(course)}</div>
          <div className="mt-1 text-[11px] text-text-muted">{sub(course)}</div>
        </>
      ) : (
        <div className="mt-4 text-sm font-medium text-text-muted">
          {empty ?? (lang === "ar" ? "لا توجد عينة كافية" : "No reliable sample yet")}
        </div>
      )}
    </article>
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
          <h4 className="font-semibold text-text">{displayDimension(item.label, lang)}</h4>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {fmtPct(item.leadShare, 1)} {lang === "ar" ? "من ليدز الموظف" : "of employee leads"}
          </p>
        </div>
        <Pill tone={item.sampleStatus === "reliable" ? "success" : "neutral"}>
          {fmtPct(item.conversionRate, 1)}
        </Pill>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniMetric label={lang === "ar" ? "الليدز" : "Leads"} value={fmtNum(item.leads)} />
        <MiniMetric label="Won / Lost" value={`${fmtNum(item.won)} / ${fmtNum(item.lost)}`} />
        <MiniMetric label={lang === "ar" ? "المبيعات" : "Sales"} value={fmtUSDFull(item.paidRevenue)} />
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

function displayDimension(value: string, lang: "ar" | "en") {
  return value === "Uncategorized" && lang === "ar" ? "غير مصنف" : value;
}

function monthEnd(month: string): string {
  const [year, rawMonth] = month.split("-").map(Number);
  if (!year || !rawMonth) return `${month}-31`;
  return new Date(Date.UTC(year, rawMonth, 0)).toISOString().slice(0, 10);
}

function monthLabel(month: string, lang: "ar" | "en"): string {
  const [year, rawMonth] = month.split("-").map(Number);
  if (!year || !rawMonth) return month;
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, rawMonth - 1, 1)));
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface px-2.5 py-2">
      <div className="truncate text-[10px] text-text-muted" title={label}>
        {label}
      </div>
      <div className="num mt-1 truncate text-sm font-semibold text-text" title={value}>
        {value}
      </div>
    </div>
  );
}

function ProgressMetric({
  label,
  value,
  color,
}: {
  label: string;
  value: number | null;
  color: string;
}) {
  const safe = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px]">
        <span className="text-text-muted">{label}</span>
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

export function AccountingProfitabilityView() {
  const { lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<ProfitabilityResponse>("/api/profitability");

  useEffect(() => {
    if (data?.status !== "loading") return;
    const timer = window.setTimeout(() => refetch(), 15_000);
    return () => window.clearTimeout(timer);
  }, [data?.status, refetch]);

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (isLoading || !data) return <><Skeleton className="h-28" /><Skeleton className="mt-4 h-96" /></>;
  if (!data.snapshot) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <RefreshCw className={data.status === "loading" ? "animate-spin text-brand" : "text-danger"} size={28} />
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
          <button onClick={() => refetch()} className="min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-white">
            {lang === "ar" ? "إعادة المحاولة" : "Retry"}
          </button>
        </div>
      </Card>
    );
  }

  const p = data.snapshot;
  return (
    <div className="space-y-4">
      <Notice tone="info" title={lang === "ar" ? "المصدر المحاسبي للربحية" : "Profitability authority"} icon={<Calculator size={16} />}>
        {lang === "ar"
          ? `تقرير Profit and Loss مباشر من Odoo 17 للشركات 2 و3 و4، قيود مرحلة فقط، للفترة ${p.from} → ${p.to}. الربح = الدخل − المصروفات.`
          : `Direct Odoo 17 Profit and Loss for companies 2, 3 and 4, posted entries only, ${p.from} → ${p.to}. Profit = income − expenses.`}
      </Notice>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard index={0} label={lang === "ar" ? "صافي الربح" : "Net profit"} value={localMoney(p.netProfit, p.currency)} hero />
        <KpiCard index={1} label={lang === "ar" ? "الدخل" : "Income"} value={localMoney(p.income, p.currency)} />
        <KpiCard index={2} label={lang === "ar" ? "المصروفات" : "Expenses"} value={localMoney(p.expenses, p.currency)} />
        <KpiCard index={3} label={lang === "ar" ? "إجمالي الربح" : "Gross profit"} value={localMoney(p.grossProfit, p.currency)} />
      </div>
      <Card>
        <SectionTitle action={<Pill tone={data.status === "refreshing" ? "warning" : "success"}>{data.status === "refreshing" ? (lang === "ar" ? "تحديث في الخلفية" : "Refreshing") : (lang === "ar" ? "مباشر من Odoo" : "Live from Odoo")}</Pill>}>
          {lang === "ar" ? "تفاصيل الربح والخسارة" : "Profit and Loss details"}
        </SectionTitle>
        <div className="divide-y divide-border">
          {p.lines.map((line) => (
            <div key={line.id} className="flex items-center justify-between gap-4 py-2.5" style={{ paddingInlineStart: `${Math.min(line.level, 4) * 12}px` }}>
              <span className={line.level <= 1 ? "font-semibold text-text" : "text-sm text-text-muted"}>{line.label}</span>
              <span className="num whitespace-nowrap font-semibold text-text">{localMoney(line.value, p.currency)}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-text-muted">
          <span className="inline-flex items-center gap-1"><Users size={13} />{p.companies.map((company) => company.name).join(" · ")}</span>
        </div>
      </Card>
    </div>
  );
}
