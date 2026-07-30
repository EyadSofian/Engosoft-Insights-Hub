import { useEffect, useState } from "react";
import {
  Calculator,
  Info,
  PhoneCall,
  ReceiptText,
  RefreshCw,
  Search,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import { MultiLineChart } from "@/components/charts";
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
import { fmtNum, fmtPct, fmtUSDExact, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import { filterStore, useFilters } from "@/lib/filter-store";

export interface AccountingMonth {
  month: string;
  revenue: number;
  invoices: number;
  productLines: number;
  averageInvoice: number | null;
  growthPct: number | null;
}

interface AgentRow {
  key: string;
  name: string;
  team: string;
  paidRevenue: number;
  invoices: number;
  cleanLeads: number;
  won: number;
  lost: number;
  conversionRate: number | null;
  openLeads: number;
  uncontactedLeads: number;
  outboundCalls: number;
  answeredCalls: number;
  answerRate: number | null;
  avgFirstCallMinutes: number | null;
  operationalSales: number;
  operationalDeals: number;
}

interface AgentsResponse {
  agents: AgentRow[];
  months: string[];
  selected: {
    from?: string;
    to?: string;
    dateBasis: "payment" | "invoice";
    company: string;
  };
  summary: {
    agents: number;
    paidRevenue: number;
    invoices: number;
    cleanLeads: number;
    won: number;
    lost: number;
    conversionRate: number | null;
    outboundCalls: number;
    answeredCalls: number;
    answerRate: number | null;
  };
  sla: {
    ok: boolean;
    source: string;
    fetchedAt: string;
    error?: string;
  };
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
          ? `المقارنة مبنية على الفواتير المدفوعة حسب ${dateBasis}. كل شهر يُقارن بالشهر السابق مباشرة.`
          : `Comparison uses paid invoices by ${dateBasis}. Every month is compared with its immediate predecessor.`}
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
          label={lang === "ar" ? "تحصيل الشهر السابق" : "Previous month collections"}
          value={fmtUSDExact(previous?.revenue ?? null)}
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
  const [sortBy, setSortBy] = useState<"revenue" | "conversion" | "calls">("revenue");
  const [search, setSearch] = useState("");
  const { data, isLoading, error, refetch } = useApi<AgentsResponse>("/api/teams");
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
      sortBy === "conversion"
        ? (b.conversionRate ?? -1) - (a.conversionRate ?? -1) ||
          b.paidRevenue - a.paidRevenue
        : sortBy === "calls"
          ? b.outboundCalls - a.outboundCalls || b.answeredCalls - a.answeredCalls
          : b.paidRevenue - a.paidRevenue || b.invoices - a.invoices,
    );

  const selectMonth = (month: string) => {
    if (!month) return;
    filterStore.setDates(`${month}-01`, monthEnd(month));
  };

  return (
    <div className="space-y-4">
      <Notice tone="info" icon={<Info size={16} />}>
        {lang === "ar"
          ? `التحصيل والفواتير من الحسابات حسب ${data.selected.dateBasis === "invoice" ? "تاريخ الفاتورة" : "تاريخ الدفع"}${data.selected.company ? ` لشركة ${data.selected.company}` : ""}. المكالمات والعملاء من SLA وCRM، ولا تُنسب تكلفة إعلانية لموظف من غير قاعدة توزيع معتمدة.`
          : `Collections and invoices use ${data.selected.dateBasis === "invoice" ? "Invoice Date" : "Payment Date"}${data.selected.company ? ` for ${data.selected.company}` : ""}. Calls and leads come from SLA and CRM; ad spend is not assigned without an approved allocation rule.`}
      </Notice>
      {!data.sla.ok && (
        <Notice tone="warning" title={lang === "ar" ? "بيانات المكالمات غير متاحة مؤقتًا" : "Call data temporarily unavailable"}>
          {data.sla.error || (lang === "ar" ? "تظهر مؤشرات الحسابات والعملاء فقط." : "Accounting and CRM metrics remain available.")}
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          index={0}
          label={lang === "ar" ? "الموظفون النشطون" : "Active employees"}
          value={fmtNum(data.summary.agents)}
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
          label={lang === "ar" ? "الصفقات المغلقة" : "Closed won"}
          value={fmtNum(data.summary.won)}
          sub={fmtPct(data.summary.conversionRate, 1)}
          icon={<Trophy size={18} />}
        />
        <KpiCard
          index={3}
          label={lang === "ar" ? "المكالمات الصادرة" : "Outbound calls"}
          value={fmtNum(data.summary.outboundCalls)}
          icon={<PhoneCall size={18} />}
        />
        <KpiCard
          index={4}
          label={lang === "ar" ? "المكالمات المجاب عنها" : "Answered calls"}
          value={fmtNum(data.summary.answeredCalls)}
          sub={fmtPct(data.summary.answerRate, 1)}
          icon={<UserRound size={18} />}
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
              {lang === "ar" ? "الترتيب" : "Sort by"}
            </span>
            <Segmented
              value={sortBy}
              onChange={setSortBy}
              options={[
                { value: "revenue", label: lang === "ar" ? "التحصيل" : "Revenue" },
                { value: "conversion", label: lang === "ar" ? "الإغلاق" : "Conversion" },
                { value: "calls", label: lang === "ar" ? "المكالمات" : "Calls" },
              ]}
            />
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
        <AgentCards rows={visibleAgents} />
      ) : (
        <AgentTable rows={visibleAgents} />
      )}
    </div>
  );
}

function AgentCards({ rows }: { rows: AgentRow[] }) {
  const { lang } = useI18n();
  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {rows.map((row, index) => (
        <article
          key={row.key}
          className="card overflow-hidden p-4 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand/35 hover:shadow-md sm:p-5"
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
            <Pill tone={row.conversionRate !== null && row.conversionRate >= 10 ? "success" : "neutral"}>
              {lang === "ar" ? "إغلاق" : "CVR"} {fmtPct(row.conversionRate, 1)}
            </Pill>
          </div>

          <div className="mt-4 rounded-2xl bg-surface-2 p-3">
            <div className="text-[11px] font-medium text-text-muted">
              {lang === "ar" ? "التحصيل المدفوع" : "Paid collections"}
            </div>
            <div className="num mt-1 text-xl font-semibold text-text">
              {fmtUSDExact(row.paidRevenue)}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <MiniMetric label={lang === "ar" ? "الفواتير" : "Invoices"} value={fmtNum(row.invoices)} />
            <MiniMetric label={lang === "ar" ? "العملاء" : "Leads"} value={fmtNum(row.cleanLeads)} />
            <MiniMetric label="Won" value={fmtNum(row.won)} />
            <MiniMetric label="Lost" value={fmtNum(row.lost)} />
            <MiniMetric label={lang === "ar" ? "المكالمات" : "Calls"} value={fmtNum(row.outboundCalls)} />
            <MiniMetric label={lang === "ar" ? "تم الرد" : "Answered"} value={fmtNum(row.answeredCalls)} />
          </div>

          <div className="mt-4 space-y-2.5">
            <ProgressMetric
              label={lang === "ar" ? "نسبة الإغلاق" : "Conversion rate"}
              value={row.conversionRate}
              color="var(--success)"
            />
            <ProgressMetric
              label={lang === "ar" ? "نسبة الرد" : "Answer rate"}
              value={row.answerRate}
              color="var(--chart-1)"
            />
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3 text-[11px] text-text-muted">
            <span>
              {lang === "ar" ? "لم يتم التواصل" : "Uncontacted"}:{" "}
              <b className="num text-text">{fmtNum(row.uncontactedLeads)}</b>
            </span>
            <span>
              {lang === "ar" ? "صفقات SLA" : "SLA deals"}:{" "}
              <b className="num text-text">{fmtNum(row.operationalDeals)}</b>
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

function AgentTable({ rows }: { rows: AgentRow[] }) {
  const { lang } = useI18n();
  return (
    <Card padded={false}>
      <div className="border-b border-border p-4 sm:p-5">
        <SectionTitle className="mb-0">{lang === "ar" ? "كل الموظفين" : "All employees"}</SectionTitle>
      </div>
      <div className="max-h-[680px] overflow-auto">
        <table className="w-full min-w-[1120px] text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr className="text-[11px] uppercase tracking-wide text-text-muted">
              {[
                lang === "ar" ? "الموظف" : "Employee",
                lang === "ar" ? "التحصيل المدفوع" : "Paid collections",
                lang === "ar" ? "الفواتير" : "Invoices",
                lang === "ar" ? "العملاء" : "Leads",
                "Won",
                "Lost",
                lang === "ar" ? "نسبة الإغلاق" : "Conversion",
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
              <tr key={row.key} className="border-t border-border">
                <td className="px-3 py-3">
                  <div className="font-semibold text-text">{row.name}</div>
                  <div className="mt-0.5 max-w-[220px] truncate text-[11px] text-text-muted" title={row.team}>{row.team}</div>
                </td>
                <td className="num px-3 py-3 text-end font-semibold">{fmtUSDExact(row.paidRevenue)}</td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.invoices)}</td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.cleanLeads)}</td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.won)}</td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.lost)}</td>
                <td className="px-3 py-3 text-end"><Pill tone={row.conversionRate !== null && row.conversionRate >= 10 ? "success" : "neutral"}>{fmtPct(row.conversionRate, 1)}</Pill></td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.outboundCalls)}</td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.answeredCalls)}</td>
                <td className="num px-3 py-3 text-end">{fmtPct(row.answerRate, 1)}</td>
                <td className="num px-3 py-3 text-end">{fmtNum(row.uncontactedLeads)}</td>
                <td className="num px-3 py-3 text-end">
                  {row.operationalSales.toLocaleString("en-US", { maximumFractionDigits: 0 })}
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
