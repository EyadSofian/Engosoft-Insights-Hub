import { useEffect } from "react";
import { Activity, Calculator, Info, PhoneCall, RefreshCw, TrendingUp, Users } from "lucide-react";
import { MultiLineChart } from "@/components/charts";
import {
  Card,
  ErrorState,
  KpiCard,
  Notice,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { fmtNum, fmtPct, fmtUSDExact, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";

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
  const latest = monthly.at(-1);
  const previous = monthly.at(-2);
  return (
    <div className="space-y-4">
      <Notice tone="info" icon={<Info size={16} />}>
        {lang === "ar"
          ? "المقارنة مبنية على الفواتير المدفوعة حسب Payment Date. كل شهر يُقارن بالشهر السابق مباشرة."
          : "Comparison uses paid invoices by Payment Date. Every month is compared with its immediate predecessor."}
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
      <Card padded={false}>
        <div className="border-b border-border p-4 sm:p-5">
          <SectionTitle className="mb-0">{lang === "ar" ? "مقارنة شهر بشهر" : "Month-by-month comparison"}</SectionTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="bg-surface-2 text-[11px] uppercase tracking-wide text-text-muted">
                <th className="px-3 py-2.5 text-start">{lang === "ar" ? "الشهر" : "Month"}</th>
                <th className="px-3 py-2.5 text-end">{lang === "ar" ? "التحصيل" : "Collections"}</th>
                <th className="px-3 py-2.5 text-end">{lang === "ar" ? "الفواتير" : "Invoices"}</th>
                <th className="px-3 py-2.5 text-end">{lang === "ar" ? "متوسط الفاتورة" : "Average invoice"}</th>
                <th className="px-3 py-2.5 text-end">{lang === "ar" ? "التغير" : "Change"}</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((row) => (
                <tr key={row.month} className="border-t border-border">
                  <td className="px-3 py-3 font-semibold text-text">{row.month}</td>
                  <td className="num px-3 py-3 text-end">{fmtUSDExact(row.revenue)}</td>
                  <td className="num px-3 py-3 text-end">{fmtNum(row.invoices)}</td>
                  <td className="num px-3 py-3 text-end">{fmtUSDExact(row.averageInvoice)}</td>
                  <td className="px-3 py-3 text-end">
                    <Pill
                      tone={
                        row.growthPct === null
                          ? "neutral"
                          : row.growthPct >= 0
                            ? "success"
                            : "danger"
                      }
                    >
                      {fmtPct(row.growthPct, 1)}
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function AccountingAgentsView() {
  const { lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<AgentsResponse>("/api/teams");
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (isLoading || !data) return <><Skeleton className="h-28" /><Skeleton className="mt-4 h-96" /></>;
  return (
    <div className="space-y-4">
      <Notice tone="info" icon={<Info size={16} />}>
        {lang === "ar"
          ? "التحصيل لكل موظف من الفواتير المدفوعة في الحسابات. المكالمات وسرعة التواصل من نظام SLA وبياناته شهرية؛ عند اختيار جزء من شهر تظهر حركة الشهر المتقاطع كاملة. لا يُنسب إنفاق إعلاني لموظف بدون قاعدة توزيع معتمدة."
          : "Employee collections come from paid Accounting invoices. Calls and contact speed come from monthly SLA data, so a partial-month filter includes the intersecting month in full. Ad spend is not assigned to employees without an approved allocation rule."}
      </Notice>
      {!data.sla.ok && (
        <Notice tone="warning" title={lang === "ar" ? "بيانات المكالمات غير متاحة مؤقتًا" : "Call data temporarily unavailable"}>
          {data.sla.error || (lang === "ar" ? "تظهر مؤشرات الحسابات والعملاء فقط." : "Accounting and CRM metrics remain available.")}
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard index={0} label={lang === "ar" ? "الموظفون" : "Employees"} value={fmtNum(data.summary.agents)} />
        <KpiCard index={1} label={lang === "ar" ? "التحصيل" : "Collections"} value={fmtUSDExact(data.summary.paidRevenue)} hero />
        <KpiCard index={2} label={lang === "ar" ? "Won" : "Won"} value={fmtNum(data.summary.won)} sub={fmtPct(data.summary.conversionRate, 1)} />
        <KpiCard index={3} label={lang === "ar" ? "مكالمات صادرة" : "Outbound calls"} value={fmtNum(data.summary.outboundCalls)} />
        <KpiCard index={4} label={lang === "ar" ? "تم الرد" : "Answered"} value={fmtNum(data.summary.answeredCalls)} sub={fmtPct(data.summary.answerRate, 1)} />
      </div>
      <AgentTable rows={data.agents} />
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
          <span className="inline-flex items-center gap-1"><Activity size={13} />{new Date(p.fetchedAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</span>
          <span className="inline-flex items-center gap-1"><PhoneCall size={13} />{lang === "ar" ? "لا علاقة له بمؤشرات المكالمات أو أوامر البيع" : "Independent of calls and sales orders"}</span>
          <span className="inline-flex items-center gap-1"><TrendingUp size={13} />{lang === "ar" ? "عملة التقرير كما يعرضها Odoo" : "Report currency as displayed by Odoo"}</span>
        </div>
      </Card>
    </div>
  );
}
