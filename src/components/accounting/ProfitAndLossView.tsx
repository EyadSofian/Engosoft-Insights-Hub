import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BadgeDollarSign,
  Calculator,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  FileText,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { MultiLineChart } from "@/components/charts";
import { DetailPanel } from "@/components/DetailPanel";
import { Card, ErrorState, Notice, Pill, Skeleton } from "@/components/ui-bits";
import { useApi } from "@/lib/use-api";
import { fmtPct, useI18n, type Lang } from "@/lib/i18n";
import { pnlAccountGroups, type PnlAccountGroup } from "@/lib/profitability-analysis";
import type { ProfitabilityResult, ProfitabilitySnapshot } from "@/lib/profitability.server";

type Focus = "income" | "expenses" | "gross" | "net";
type Section = "income" | "expenses";
type AccountSelection = { code: string; label: string; from: string; to: string };

interface LedgerResponse {
  accountCode: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
  total: number;
  rows: Array<{
    id: number;
    date: string;
    description: string;
    reference: string;
    debit: number;
    credit: number;
    balance: number;
    company: string;
    companyCurrency: string;
    partner: string;
    moveName: string;
    moveId: number;
  }>;
}

const usd = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);

const nativeMoney = (value: number, currency: string) =>
  `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value)} ${currency || ""}`.trim();

const monthName = (month: string, lang: Lang) =>
  new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));

function AccountExplorer({
  snapshot,
  section,
  lang,
  onOpenAccount,
}: {
  snapshot: ProfitabilitySnapshot;
  section: Section;
  lang: Lang;
  onOpenAccount: (account: AccountSelection) => void;
}) {
  const [search, setSearch] = useState("");
  const groups = useMemo(
    () => pnlAccountGroups(snapshot.lines, section, lang),
    [snapshot.lines, section, lang],
  );
  const visible = groups.filter((group) =>
    `${group.name} ${group.accounts.map((account) => account.code).join(" ")}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  const sectionTotal = Math.abs(
    (section === "expenses" ? snapshot.expenses : snapshot.income) ??
      groups.reduce((total, group) => total + group.value, 0),
  );
  const detailedTotal = groups.reduce((total, group) => total + group.value, 0);
  const missingDetail = sectionTotal - detailedTotal;
  const hasUnreconciledDetail = Math.abs(missingDetail) > Math.max(1, sectionTotal * 0.005);
  const largest = Math.max(1, ...groups.map((group) => Math.abs(group.value)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-text">
            {section === "expenses"
              ? lang === "ar"
                ? "بنود المصروفات"
                : "Expense accounts"
              : lang === "ar"
                ? "بنود الإيرادات"
                : "Income accounts"}
          </h3>
          <p className="mt-0.5 text-xs text-text-muted">
            {lang === "ar"
              ? `${groups.length} بندًا مجمّعًا من حسابات Odoo · اضغط على البند ثم على رمز الحساب لعرض القيود`
              : `${groups.length} groups from Odoo accounts · open a group, then an account to inspect journal entries`}
          </p>
        </div>
        <label className="relative block w-full sm:w-60">
          <Search
            size={15}
            className="pointer-events-none absolute inset-s-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={lang === "ar" ? "ابحث عن إيجار، رواتب، حساب..." : "Search accounts..."}
            className="min-h-10 w-full rounded-xl border border-border bg-surface ps-9 pe-3 text-sm text-text outline-none focus:border-brand"
          />
        </label>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm text-text-muted">
          {lang === "ar"
            ? "Odoo لم يُرجع حسابات تفصيلية لهذه الفترة. راجع صلاحيات التقرير أو أعد تحميله."
            : "Odoo did not return account-level detail for this period. Check report permissions or retry."}
        </div>
      ) : (
        <>
          {hasUnreconciledDetail && (
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-xs leading-relaxed text-text-muted">
              {lang === "ar"
                ? `الحسابات التفصيلية المعروضة مجموعها ${usd(detailedTotal)} من إجمالي ${usd(sectionTotal)}. الفرق ${usd(missingDetail)} ما زال ضمن بنود Odoo غير المفصلة؛ لا ننسبه لحساب أو مصروف بعينه دون قيد واضح.`
                : `Visible account detail totals ${usd(detailedTotal)} of ${usd(sectionTotal)}. The ${usd(missingDetail)} difference is not attributed to an account without an Odoo journal line.`}
            </div>
          )}
          <div className="grid gap-2 md:grid-cols-2">
            {groups.slice(0, 6).map((group, index) => (
              <div
                key={`${group.name}-${index}`}
                className="rounded-xl border border-border bg-surface-2/50 px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate font-semibold text-text" title={group.name}>
                    {group.name}
                  </span>
                  <span className="num shrink-0 font-bold text-text">{usd(group.value)}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, (Math.abs(group.value) / largest) * 100)}%`,
                      background: section === "expenses" ? "#d58d45" : "#19947d",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {visible.map((group: PnlAccountGroup, index) => (
              <details key={`${group.name}-${index}`} className="group open:bg-surface-2/35">
                <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-3 py-2.5 hover:bg-surface-2/55 [&::-webkit-details-marker]:hidden sm:px-4">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-text-muted group-open:text-brand">
                    <ChevronLeft size={15} className="transition-transform group-open:-rotate-90" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
                    {group.name}
                  </span>
                  <span className="hidden shrink-0 text-xs text-text-muted sm:block">
                    {sectionTotal > 0
                      ? fmtPct((Math.abs(group.value) / sectionTotal) * 100, 1)
                      : "—"}
                  </span>
                  <span className="num shrink-0 text-sm font-bold text-text">
                    {usd(group.value)}
                  </span>
                </summary>
                <div className="space-y-1 border-t border-border px-3 py-2 sm:px-4">
                  {group.accounts.map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() =>
                        onOpenAccount({
                          code: account.code,
                          label: group.name,
                          from: snapshot.from,
                          to: snapshot.to,
                        })
                      }
                      className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-2 text-start text-xs hover:bg-surface"
                    >
                      <span className="font-semibold text-brand">
                        {lang === "ar" ? "حساب" : "Account"} {account.code} ·{" "}
                        {lang === "ar" ? "عرض القيود" : "View entries"}
                      </span>
                      <span className="num shrink-0 font-medium text-text">
                        {usd(account.value)}
                      </span>
                    </button>
                  ))}
                </div>
              </details>
            ))}
            {visible.length === 0 && (
              <p className="p-5 text-center text-sm text-text-muted">
                {lang === "ar" ? "لا توجد بنود تطابق البحث" : "No matching accounts"}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function LedgerPanel({
  account,
  onClose,
  lang,
}: {
  account: AccountSelection;
  onClose: () => void;
  lang: Lang;
}) {
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({
    ledgerCode: account.code,
    periodFrom: account.from,
    periodTo: account.to,
    page: String(page),
  });
  const { data, isLoading, error, refetch } = useApi<LedgerResponse>(
    `/api/profitability-ledger?${query}`,
  );
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <DetailPanel
      open
      onClose={onClose}
      width="min(900px, 100vw)"
      title={lang === "ar" ? `قيود ${account.label}` : `${account.label} journal entries`}
      subtitle={`${account.code} · ${account.from} → ${account.to}`}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-brand/20 bg-brand/5 p-3 text-xs leading-relaxed text-text-muted">
          {lang === "ar"
            ? "هذه الحركات من دفتر Odoo المرحّل. مبالغ كل قيد بعملة شركته الأصلية؛ إجمالي الأرباح والخسائر أعلى الصفحة محوّل إلى الدولار بسعر التقرير."
            : "These are posted Odoo journal lines in each company's book currency. The Profit and Loss totals above are converted to USD."}
        </div>
        {isLoading ? (
          <Skeleton className="h-64" />
        ) : error ? (
          <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
        ) : data ? (
          <>
            <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>
                {lang === "ar"
                  ? `${data.total.toLocaleString("en-US")} قيد`
                  : `${data.total.toLocaleString("en-US")} entries`}
              </span>
              <span>
                {lang === "ar" ? `صفحة ${page} من ${totalPages}` : `Page ${page} of ${totalPages}`}
              </span>
            </div>
            <div className="space-y-2">
              {data.rows.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-xl border border-border bg-surface px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-text">{entry.description}</div>
                      <div className="mt-1 text-xs text-text-muted">
                        {entry.date} · {entry.company}
                        {entry.partner ? ` · ${entry.partner}` : ""}
                      </div>
                      <div className="mt-1 text-[11px] text-text-muted">
                        {[entry.reference, entry.moveName].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <div className="text-end">
                      <div className="num text-sm font-bold text-text">
                        {nativeMoney(entry.balance, entry.companyCurrency)}
                      </div>
                      <div className="mt-1 text-[11px] text-text-muted">
                        {lang === "ar" ? "مدين" : "Debit"}{" "}
                        {nativeMoney(entry.debit, entry.companyCurrency)} ·{" "}
                        {lang === "ar" ? "دائن" : "Credit"}{" "}
                        {nativeMoney(entry.credit, entry.companyCurrency)}
                      </div>
                    </div>
                  </div>
                  {entry.moveId > 0 && (
                    <a
                      href={`https://engosoft.com/web#id=${entry.moveId}&model=account.move&view_type=form`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                    >
                      {lang === "ar" ? "فتح القيد في Odoo" : "Open in Odoo"}{" "}
                      <ArrowUpRight size={13} />
                    </a>
                  )}
                </div>
              ))}
              {data.rows.length === 0 && (
                <p className="py-10 text-center text-sm text-text-muted">
                  {lang === "ar"
                    ? "لا توجد قيود مرحلة لهذا الحساب في الفترة"
                    : "No posted entries for this account and period"}
                </p>
              )}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border pt-3">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border px-3 text-xs font-semibold text-text disabled:opacity-40"
                >
                  <ChevronRight size={15} />
                  {lang === "ar" ? "السابق" : "Previous"}
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                  className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border px-3 text-xs font-semibold text-text disabled:opacity-40"
                >
                  {lang === "ar" ? "التالي" : "Next"}
                  <ChevronLeft size={15} />
                </button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </DetailPanel>
  );
}

export function ProfitAndLossView() {
  const { lang } = useI18n();
  const [focus, setFocus] = useState<Focus>("expenses");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [account, setAccount] = useState<AccountSelection | null>(null);
  const { data, isLoading, error, refetch } = useApi<ProfitabilityResult>("/api/profitability");
  const {
    data: monthDetail,
    error: monthDetailError,
    refetch: refetchMonthDetail,
  } = useApi<ProfitabilityResult>(`/api/profitability?detailMonth=${selectedMonth}`, {
    enabled: Boolean(selectedMonth),
  });

  useEffect(() => {
    if (data?.status !== "loading" && data?.monthlyStatus !== "loading") return;
    const timer = window.setTimeout(() => refetch(), 15_000);
    return () => window.clearTimeout(timer);
  }, [data?.status, data?.monthlyStatus, refetch]);

  useEffect(() => {
    if (monthDetail?.status !== "loading") return;
    const timer = window.setTimeout(() => refetchMonthDetail(), 15_000);
    return () => window.clearTimeout(timer);
  }, [monthDetail?.status, refetchMonthDetail]);

  useEffect(() => {
    if (!data?.monthly.length || data.monthly.some((item) => item.month === selectedMonth)) return;
    const ready = [...data.monthly].reverse().find((item) => item.snapshot);
    setSelectedMonth((ready ?? data.monthly[data.monthly.length - 1]).month);
  }, [data?.monthly, selectedMonth]);

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (isLoading || !data)
    return (
      <>
        <Skeleton className="h-40" />
        <Skeleton className="mt-4 h-96" />
      </>
    );
  if (data.status === "error" && !data.snapshot)
    return (
      <ErrorState
        message={data.error || "Odoo Profit and Loss is unavailable"}
        onRetry={() => refetch()}
      />
    );
  if (!data.snapshot) {
    return (
      <Card className="py-12 text-center">
        <RefreshCw size={28} className="mx-auto animate-spin text-brand" />
        <h2 className="mt-3 font-semibold text-text">
          {lang === "ar" ? "Odoo يجهز قائمة الأرباح والخسائر" : "Odoo is building Profit and Loss"}
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-xs text-text-muted">
          {data.error ||
            (lang === "ar"
              ? "سيظهر التقرير تلقائيًا عند اكتمال الحساب."
              : "The report will appear when Odoo finishes computing it.")}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-4 min-h-10 rounded-xl bg-brand px-4 text-sm font-semibold text-white"
        >
          {lang === "ar" ? "إعادة التحميل" : "Retry"}
        </button>
      </Card>
    );
  }

  const report = data.snapshot;
  const monthSummary = data.monthly.find((item) => item.month === selectedMonth)?.snapshot ?? null;
  const monthSnapshot = monthDetail?.snapshot ?? null;
  const income = report.income ?? 0;
  const expenses = Math.abs(report.expenses ?? 0);
  const profit = report.netProfit ?? 0;
  const netMargin = income > 0 ? (profit / income) * 100 : null;
  const metricCards: Array<{
    key: Focus;
    title: string;
    value: number | null;
    hint: string;
    icon: typeof TrendingUp;
    color: string;
    soft: string;
  }> = [
    {
      key: "income",
      title: lang === "ar" ? "الإيرادات" : "Income",
      value: report.income,
      hint: lang === "ar" ? "من أين دخلت الأموال؟" : "Where income came from",
      icon: TrendingUp,
      color: "#087a67",
      soft: "#e7f6f0",
    },
    {
      key: "expenses",
      title: lang === "ar" ? "المصروفات" : "Expenses",
      value: report.expenses,
      hint: lang === "ar" ? "اتصرف على إيه بالضبط؟" : "Where money was spent",
      icon: TrendingDown,
      color: "#a9602b",
      soft: "#fff0df",
    },
    {
      key: "gross",
      title: lang === "ar" ? "مجمل الربح" : "Gross profit",
      value: report.grossProfit,
      hint: lang === "ar" ? "نتيجة النشاط قبل المصروفات" : "Operating result before overhead",
      icon: Calculator,
      color: "#246a9a",
      soft: "#e9f3fb",
    },
    {
      key: "net",
      title: lang === "ar" ? "صافي الربح" : "Net profit",
      value: report.netProfit,
      hint: lang === "ar" ? "ما تبقى بعد المصروفات" : "After all expenses",
      icon: CircleDollarSign,
      color: "#123f72",
      soft: "#e9effa",
    },
  ];
  const chosen = metricCards.find((card) => card.key === focus)!;
  const section: Section = focus === "income" || focus === "gross" ? "income" : "expenses";
  const monthlyReady = data.monthly.filter((item) => item.snapshot);
  const chartData = monthlyReady.map((item) => ({
    date: `${item.month}-01`,
    income: item.snapshot?.income ?? 0,
    expenses: Math.abs(item.snapshot?.expenses ?? 0),
    profit: item.snapshot?.netProfit ?? 0,
  }));

  return (
    <div className="space-y-5">
      <section
        className="relative overflow-hidden rounded-[24px] px-5 py-6 text-white sm:px-7"
        style={{ background: "linear-gradient(115deg, #09294e 0%, #0d4566 68%, #0b686d 100%)" }}
      >
        <div
          className="absolute -end-20 -top-24 size-64 rounded-full border border-white/10"
          aria-hidden="true"
        />
        <div
          className="absolute -end-10 -top-12 size-44 rounded-full border border-white/10"
          aria-hidden="true"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold">
              <BadgeDollarSign size={14} />
              {lang === "ar" ? "التقرير المحاسبي" : "Accounting report"}
            </div>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
              {lang === "ar" ? "من الإيراد إلى صافي الربح" : "From revenue to net profit"}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/75">
              {lang === "ar"
                ? "افتح أي مؤشر لتعرف مكوّناته، ثم افتح حسابًا لتشاهد القيود والمستندات التي صنعت الرقم."
                : "Open a metric, then an account, to inspect the entries and documents behind the number."}
            </p>
          </div>
          <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-start backdrop-blur-sm">
            <div className="text-[11px] text-white/70">
              {lang === "ar" ? "هامش صافي الربح" : "Net margin"}
            </div>
            <div className="num mt-1 text-2xl font-bold">{fmtPct(netMargin, 1)}</div>
            <div className="mt-1 text-[11px] text-white/70">
              {report.from} → {report.to}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.key}
              type="button"
              aria-pressed={focus === card.key}
              onClick={() => setFocus(card.key)}
              className={`rounded-2xl border bg-surface p-4 text-start shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${focus === card.key ? "ring-2 ring-brand/40" : "border-border"}`}
              style={focus === card.key ? { borderColor: card.color } : undefined}
            >
              <span
                className="grid size-10 place-items-center rounded-xl"
                style={{ background: card.soft, color: card.color }}
              >
                <Icon size={19} />
              </span>
              <span className="mt-3 block text-xs font-semibold text-text-muted">{card.title}</span>
              <strong className="num mt-1 block text-xl text-text sm:text-2xl">
                {usd(card.value)}
              </strong>
              <span
                className="mt-2 flex items-center gap-1 text-[11px] font-medium"
                style={{ color: card.color }}
              >
                {card.hint}
                <ChevronLeft size={13} />
              </span>
            </button>
          );
        })}
      </div>

      <Card className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <div className="text-xs font-semibold text-brand">
              {lang === "ar" ? "داخل الرقم" : "Inside the figure"}
            </div>
            <h3 className="mt-1 text-lg font-bold text-text">
              {chosen.title} · {usd(chosen.value)}
            </h3>
            <p className="mt-1 text-xs text-text-muted">{chosen.hint}</p>
          </div>
          <Pill tone="brand">{lang === "ar" ? "الفترة المحددة" : "Selected period"}</Pill>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {[
            {
              label: lang === "ar" ? "إجمالي الإيرادات" : "Income",
              value: income,
              color: "#19947d",
            },
            {
              label: lang === "ar" ? "إجمالي المصروفات" : "Expenses",
              value: expenses,
              color: "#d58d45",
            },
            { label: lang === "ar" ? "صافي الربح" : "Net profit", value: profit, color: "#265b91" },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-border bg-surface-2/50 px-3 py-3"
            >
              <div className="text-xs text-text-muted">{item.label}</div>
              <div className="num mt-1 text-lg font-bold text-text">{usd(item.value)}</div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${income > 0 ? Math.min(100, (Math.abs(item.value) / income) * 100) : 0}%`,
                    background: item.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <AccountExplorer
          key={`${report.from}-${report.to}-${section}`}
          snapshot={report}
          section={section}
          lang={lang}
          onOpenAccount={setAccount}
        />
      </Card>

      {data.monthly.length > 1 && (
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-text">
                {lang === "ar"
                  ? "حركة الإيرادات والمصروفات بالشهور"
                  : "Monthly income and expenses"}
              </h3>
              <p className="mt-0.5 text-xs text-text-muted">
                {lang === "ar"
                  ? "اضغط على شهر لعرض حساباته بالتفصيل"
                  : "Select a month to view its accounts"}
              </p>
            </div>
            <span className="text-xs text-text-muted">
              {monthlyReady.length}/{data.monthly.length}{" "}
              {lang === "ar" ? "شهر جاهز" : "months ready"}
            </span>
          </div>
          {chartData.length > 0 && (
            <MultiLineChart
              data={chartData}
              series={[
                { key: "income", name: lang === "ar" ? "الإيرادات" : "Income", color: "#19947d" },
                {
                  key: "expenses",
                  name: lang === "ar" ? "المصروفات" : "Expenses",
                  color: "#d58d45",
                },
                {
                  key: "profit",
                  name: lang === "ar" ? "صافي الربح" : "Net profit",
                  color: "#265b91",
                },
              ]}
              height={270}
              format={(value) => usd(value)}
            />
          )}
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {data.monthly.map((item) => (
              <button
                key={item.month}
                type="button"
                onClick={() => setSelectedMonth(item.month)}
                className={`min-w-28 shrink-0 rounded-xl border px-3 py-2 text-start transition-colors ${selectedMonth === item.month ? "border-brand bg-brand/5" : "border-border bg-surface hover:bg-surface-2"}`}
              >
                <span className="block text-xs font-semibold text-text">
                  {monthName(item.month, lang)}
                </span>
                <span className="num mt-1 block text-sm font-bold text-text">
                  {item.snapshot
                    ? usd(item.snapshot.netProfit)
                    : item.status === "error"
                      ? lang === "ar"
                        ? "تعذّر التحميل"
                        : "Unavailable"
                      : "…"}
                </span>
              </button>
            ))}
          </div>
          {data.monthlyStatus === "error" && (
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-3 text-xs font-semibold text-brand hover:underline"
            >
              {lang === "ar" ? "إعادة تحميل الشهور غير المتاحة" : "Retry unavailable months"}
            </button>
          )}
        </Card>
      )}

      {data.monthly.length > 1 && monthSummary && (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-brand">
                {monthName(selectedMonth, lang)}
              </div>
              <h3 className="mt-1 text-lg font-bold text-text">
                {lang === "ar" ? "تفاصيل الشهر المختار" : "Selected month details"}
              </h3>
            </div>
            <span className="num text-lg font-bold text-text">{usd(monthSummary.netProfit)}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-text-muted">
              {lang === "ar" ? "الإيرادات" : "Income"}
              <div className="num mt-1 text-base font-bold text-text">
                {usd(monthSummary.income)}
              </div>
            </div>
            <div className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-text-muted">
              {lang === "ar" ? "المصروفات" : "Expenses"}
              <div className="num mt-1 text-base font-bold text-text">
                {usd(monthSummary.expenses)}
              </div>
            </div>
            <div className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-text-muted">
              {lang === "ar" ? "هامش الربح" : "Margin"}
              <div className="num mt-1 text-base font-bold text-text">
                {monthSummary.income
                  ? fmtPct(((monthSummary.netProfit ?? 0) / monthSummary.income) * 100, 1)
                  : "—"}
              </div>
            </div>
          </div>
          {monthSnapshot ? (
            <AccountExplorer
              key={`${selectedMonth}-${section}`}
              snapshot={monthSnapshot}
              section={section}
              lang={lang}
              onOpenAccount={setAccount}
            />
          ) : monthDetailError || monthDetail?.status === "error" ? (
            <ErrorState
              message={
                monthDetail?.error ||
                (monthDetailError as Error)?.message ||
                "Odoo report unavailable"
              }
              onRetry={() => refetchMonthDetail()}
            />
          ) : (
            <div className="rounded-xl border border-border p-4">
              <p className="mb-3 text-xs text-text-muted">
                {lang === "ar"
                  ? "جارٍ جلب حسابات الشهر التفصيلية من Odoo..."
                  : "Loading this month's accounts from Odoo..."}
              </p>
              <Skeleton className="h-24" />
            </div>
          )}
        </Card>
      )}

      <Notice
        tone="info"
        title={lang === "ar" ? "مصدر الأرقام وطريقة عرض الدولار" : "Source and USD conversion"}
        icon={<FileText size={16} />}
      >
        {lang === "ar"
          ? `الأرقام مأخوذة من قائمة الأرباح والخسائر في Odoo للشركات: ${report.companies.map((item) => item.name).join("، ")}. القيود المرحلة فقط، من ${report.from} إلى ${report.to}. عملة التقرير الأصلية ${report.sourceCurrency}، والتحويل إلى الدولار بسعر ${report.fxRate.toLocaleString("en-US")} ${report.sourceCurrency} لكل دولار.`
          : `Figures come from Odoo Profit and Loss for ${report.companies.map((item) => item.name).join(", ")}, posted entries only, ${report.from} to ${report.to}. Converted from ${report.sourceCurrency} to USD at ${report.fxRate.toLocaleString("en-US")} ${report.sourceCurrency} per USD.`}
      </Notice>

      {account && (
        <LedgerPanel
          key={`${account.code}-${account.from}-${account.to}`}
          account={account}
          onClose={() => setAccount(null)}
          lang={lang}
        />
      )}
    </div>
  );
}
