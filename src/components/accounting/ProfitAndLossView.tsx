import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BadgeDollarSign,
  Calculator,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  GitCompareArrows,
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
import type {
  ProfitabilityResult,
  ProfitabilitySnapshot,
  ProfitabilitySnapshotResult,
} from "@/lib/profitability.server";

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

const roundedUsd = (value: number) => Number(value.toFixed(2));

const nativeMoney = (value: number, currency: string) =>
  `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value)} ${currency || ""}`.trim();

const monthName = (month: string, lang: Lang) =>
  new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));

const previousMonth = (month: string) => {
  const [year, part] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, part - 2, 1));
  return date.toISOString().slice(0, 7);
};

const sameMonthLastYear = (month: string) => `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;

const cairoToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });

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

function ProfitabilityComparison({
  initialMonth,
  lang,
  onOpenAccount,
}: {
  initialMonth: string;
  lang: Lang;
  onOpenAccount: (account: AccountSelection) => void;
}) {
  const [baseMonth, setBaseMonth] = useState(initialMonth);
  const [comparisonMode, setComparisonMode] = useState<"year" | "previous" | "custom">("year");
  const [customMonth, setCustomMonth] = useState(previousMonth(initialMonth));
  const [section, setSection] = useState<Section>("expenses");
  const [showAccounts, setShowAccounts] = useState(false);
  const comparisonMonth =
    comparisonMode === "year"
      ? sameMonthLastYear(baseMonth)
      : comparisonMode === "previous"
        ? previousMonth(baseMonth)
        : customMonth;
  const today = cairoToday();
  const throughDay = baseMonth === today.slice(0, 7) ? Number(today.slice(8, 10)) : null;
  const suffix = throughDay ? `&throughDay=${throughDay}` : "";
  const baseQuery = useApi<ProfitabilitySnapshotResult>(
    `/api/profitability?compareMonth=${baseMonth}${suffix}`,
    { enabled: Boolean(baseMonth) && baseMonth <= today.slice(0, 7) },
  );
  const comparisonQuery = useApi<ProfitabilitySnapshotResult>(
    `/api/profitability?compareMonth=${comparisonMonth}${suffix}`,
    {
      enabled:
        Boolean(comparisonMonth) &&
        comparisonMonth <= today.slice(0, 7) &&
        comparisonMonth !== baseMonth,
    },
  );
  const baseStatus = baseQuery.data?.status;
  const comparisonStatus = comparisonQuery.data?.status;
  const refetchBase = baseQuery.refetch;
  const refetchComparison = comparisonQuery.refetch;

  useEffect(() => {
    if (
      !["loading", "refreshing"].includes(baseStatus ?? "") &&
      !["loading", "refreshing"].includes(comparisonStatus ?? "")
    )
      return;
    const timer = window.setTimeout(() => {
      if (["loading", "refreshing"].includes(baseStatus ?? "")) void refetchBase();
      if (["loading", "refreshing"].includes(comparisonStatus ?? "")) void refetchComparison();
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [baseStatus, comparisonStatus, refetchBase, refetchComparison]);

  const base = baseQuery.data?.snapshot;
  const comparison = comparisonQuery.data?.snapshot;
  const sameMonth = comparisonMonth === baseMonth;
  const metrics = [
    {
      key: "income",
      label: lang === "ar" ? "الإيرادات" : "Income",
      color: "#168b75",
      betterUp: true,
      value: (item: ProfitabilitySnapshot) => item.income,
    },
    {
      key: "expenses",
      label: lang === "ar" ? "المصروفات" : "Expenses",
      color: "#d1803f",
      betterUp: false,
      value: (item: ProfitabilitySnapshot) =>
        item.expenses === null ? null : Math.abs(item.expenses),
    },
    {
      key: "gross",
      label: lang === "ar" ? "مجمل الربح" : "Gross profit",
      help:
        lang === "ar"
          ? "نتيجة النشاط قبل الإيرادات الأخرى والمصروفات"
          : "Operating result before other income and expenses",
      color: "#3675ab",
      betterUp: true,
      value: (item: ProfitabilitySnapshot) => item.grossProfit,
    },
    {
      key: "net",
      label: lang === "ar" ? "صافي الربح / الخسارة" : "Net profit / loss",
      help:
        lang === "ar"
          ? "يشمل الإيرادات الأخرى بعد خصم المصروفات"
          : "Includes other income after expenses",
      color: "#173d69",
      betterUp: true,
      value: (item: ProfitabilitySnapshot) => item.netProfit,
    },
  ] as const;
  const categoryRows = useMemo(() => {
    if (!base || !comparison) return [];
    const currentGroups = pnlAccountGroups(base.lines, section, lang);
    const pastGroups = pnlAccountGroups(comparison.lines, section, lang);
    const rows = new Map<string, { name: string; current: number; past: number }>();
    for (const group of currentGroups)
      rows.set(group.name, { name: group.name, current: group.value, past: 0 });
    for (const group of pastGroups) {
      const row = rows.get(group.name);
      if (row) row.past = group.value;
      else rows.set(group.name, { name: group.name, current: 0, past: group.value });
    }
    return [...rows.values()]
      .sort((a, b) => Math.abs(b.current - b.past) - Math.abs(a.current - a.past))
      .slice(0, 8);
  }, [base, comparison, section, lang]);
  const largestCategory = Math.max(
    1,
    ...categoryRows.flatMap((row) => [Math.abs(row.current), Math.abs(row.past)]),
  );

  return (
    <section className="overflow-hidden rounded-[24px] border border-border bg-surface shadow-sm">
      <div className="relative overflow-hidden bg-[#0b2d4e] px-5 py-5 text-white sm:px-6">
        <div
          className="pointer-events-none absolute -end-10 -top-20 size-56 rounded-full border border-white/10"
          aria-hidden="true"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-[#aee6db]">
              <GitCompareArrows size={14} />
              {lang === "ar" ? "مقارنة محاسبية" : "Accounting comparison"}
            </span>
            <h3 className="mt-2 text-xl font-bold sm:text-2xl">
              {lang === "ar"
                ? "شهر أمام شهر، والبنود وراء الفرق"
                : "Month against month, with the detail behind the change"}
            </h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/70">
              {lang === "ar"
                ? "قارن المصروفات والإيرادات والربح، ثم افتح الحسابات لمعرفة أسباب الزيادة أو الانخفاض."
                : "Compare income, expenses, and profit, then inspect the accounts behind each change."}
            </p>
          </div>
          <span className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-[11px] text-white/75">
            Odoo · USD · {lang === "ar" ? "قيود مرحلة" : "Posted entries"}
          </span>
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[175px] flex-1 text-xs font-semibold text-text-muted">
            {lang === "ar" ? "الشهر الأساسي" : "Base month"}
            <input
              type="month"
              min="2024-01"
              max={today.slice(0, 7)}
              value={baseMonth}
              onChange={(event) => setBaseMonth(event.target.value)}
              className="mt-1.5 min-h-11 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm font-semibold text-text outline-none focus:border-brand"
            />
          </label>
          <div
            className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-surface-2 p-1"
            role="group"
            aria-label={lang === "ar" ? "نوع المقارنة" : "Comparison type"}
          >
            {(
              [
                ["year", lang === "ar" ? "نفس الشهر السنة الماضية" : "Same month last year"],
                ["previous", lang === "ar" ? "الشهر السابق" : "Previous month"],
                ["custom", lang === "ar" ? "شهر آخر" : "Another month"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={comparisonMode === mode}
                onClick={() => setComparisonMode(mode)}
                className={`min-h-9 rounded-lg px-3 text-xs font-semibold transition-colors ${comparisonMode === mode ? "bg-[#0b4a6b] text-white shadow-sm" : "text-text-muted hover:bg-surface"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {comparisonMode === "custom" && (
            <label className="min-w-[175px] flex-1 text-xs font-semibold text-text-muted">
              {lang === "ar" ? "شهر المقارنة" : "Comparison month"}
              <input
                type="month"
                min="2024-01"
                max={today.slice(0, 7)}
                value={customMonth}
                onChange={(event) => setCustomMonth(event.target.value)}
                className="mt-1.5 min-h-11 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm font-semibold text-text outline-none focus:border-brand"
              />
            </label>
          )}
        </div>

        {sameMonth ? (
          <Notice
            tone="info"
            title={lang === "ar" ? "اختر شهرين مختلفين" : "Choose two different months"}
          >
            {lang === "ar"
              ? "الشهر الأساسي وشهر المقارنة متطابقان."
              : "The two selected months are identical."}
          </Notice>
        ) : baseQuery.error ||
          comparisonQuery.error ||
          baseQuery.data?.status === "error" ||
          comparisonQuery.data?.status === "error" ? (
          <ErrorState
            message={
              baseQuery.data?.error ||
              comparisonQuery.data?.error ||
              (baseQuery.error as Error)?.message ||
              (comparisonQuery.error as Error)?.message ||
              "Odoo report unavailable"
            }
            onRetry={() => {
              void baseQuery.refetch();
              void comparisonQuery.refetch();
            }}
          />
        ) : !base || !comparison ? (
          <div className="space-y-3 rounded-2xl border border-border bg-surface-2/50 p-4">
            <p className="text-xs text-text-muted">
              {lang === "ar"
                ? "بنجهز تقرير الشهرين من أودو. قد يستغرق أول تحميل قليلًا..."
                : "Loading both months from Odoo..."}
            </p>
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-border bg-surface-2/50 px-3 py-2.5 text-xs text-text-muted">
              <span>
                <i className="me-1.5 inline-block size-2 rounded-full bg-[#168b75]" />
                {monthName(baseMonth, lang)}:{" "}
                <b className="num text-text">
                  {base.from} → {base.to}
                </b>
              </span>
              <span>
                <i className="me-1.5 inline-block size-2 rounded-full bg-[#a1aec0]" />
                {monthName(comparisonMonth, lang)}:{" "}
                <b className="num text-text">
                  {comparison.from} → {comparison.to}
                </b>
              </span>
              {throughDay && (
                <span className="text-[#a9602b]">
                  {lang === "ar"
                    ? "شهر جارٍ: نفس عدد الأيام للطرفين"
                    : "Current month: equal day cutoffs"}
                </span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => {
                const rawCurrent = metric.value(base);
                const rawPast = metric.value(comparison);
                const current = rawCurrent === null ? null : roundedUsd(rawCurrent);
                const past = rawPast === null ? null : roundedUsd(rawPast);
                const delta = current !== null && past !== null ? roundedUsd(current - past) : null;
                const improvement =
                  delta === null ? null : metric.betterUp ? delta >= 0 : delta <= 0;
                const percent =
                  delta !== null && past !== null && past !== 0
                    ? Math.abs(delta / past) * 100
                    : null;
                return (
                  <div
                    key={metric.key}
                    className="rounded-2xl border border-border bg-surface-2/40 p-4 transition-all duration-300 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-md"
                    style={{ borderTop: `3px solid ${metric.color}` }}
                  >
                    <div className="text-xs font-semibold text-text-muted">{metric.label}</div>
                    {"help" in metric && (
                      <div className="mt-1 text-[10px] leading-relaxed text-text-muted">
                        {metric.help}
                      </div>
                    )}
                    <div className="num mt-2 text-xl font-extrabold text-text">{usd(current)}</div>
                    <div className="mt-1 text-[11px] text-text-muted">
                      {lang === "ar" ? "مقابل" : "vs"} <span className="num">{usd(past)}</span>
                    </div>
                    <div
                      className={`mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-2 text-xs font-bold ${improvement === null ? "text-text-muted" : improvement ? "text-[#087a67]" : "text-[#b64b3d]"}`}
                    >
                      <span className="num" dir="ltr">
                        {delta === null ? "—" : `${delta > 0 ? "+" : ""}${usd(delta)}`}
                      </span>
                      <span>
                        {percent === null
                          ? lang === "ar"
                            ? "لا توجد نسبة قابلة للحساب"
                            : "No comparable rate"
                          : `${percent.toFixed(1)}%`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
              <div className="rounded-2xl border border-border p-4">
                <h4 className="text-sm font-bold text-text">
                  {lang === "ar" ? "الصورة المالية للشهرين" : "Financial picture of both months"}
                </h4>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  {lang === "ar"
                    ? "طول العمود حسب القيمة المطلقة، والإشارة السالبة تظهر في الرقم."
                    : "Bars use absolute magnitude; losses retain their negative sign in the value."}
                </p>
                <div className="mt-4 space-y-4">
                  {metrics
                    .filter((item) => item.key !== "gross")
                    .map((metric) => {
                      const current = metric.value(base) ?? 0;
                      const past = metric.value(comparison) ?? 0;
                      const max = Math.max(Math.abs(current), Math.abs(past), 1);
                      return (
                        <div key={metric.key}>
                          <div className="mb-1.5 text-xs font-semibold text-text">
                            {metric.label}
                          </div>
                          <div className="space-y-1.5">
                            {(
                              [
                                [current, "#168b75", baseMonth],
                                [past, "#a1aec0", comparisonMonth],
                              ] as const
                            ).map(([value, color, month]) => (
                              <div key={month} className="flex items-center gap-2">
                                <span className="num w-14 shrink-0 text-[10px] text-text-muted">
                                  {month}
                                </span>
                                <div className="h-5 min-w-0 flex-1 overflow-hidden rounded-md bg-surface-2">
                                  <div
                                    className="h-full rounded-md motion-safe:transition-[width] motion-safe:duration-500"
                                    style={{
                                      width: `${(Math.abs(value) / max) * 100}%`,
                                      background: value < 0 ? "#c65e53" : color,
                                    }}
                                  />
                                </div>
                                <span className="num w-24 shrink-0 text-end text-[11px] font-bold text-text">
                                  {usd(value)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
              <div className="rounded-2xl border border-border p-4">
                <h4 className="text-sm font-bold text-text">
                  {lang === "ar" ? "هامش صافي الربح" : "Net profit margin"}
                </h4>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {[
                    [base, baseMonth, "#168b75"],
                    [comparison, comparisonMonth, "#a1aec0"],
                  ].map(([item, month, color]) => {
                    const report = item as ProfitabilitySnapshot;
                    const margin = report.income
                      ? ((report.netProfit ?? 0) / report.income) * 100
                      : null;
                    return (
                      <div
                        key={month as string}
                        className="rounded-xl bg-surface-2/65 p-3 text-center"
                      >
                        <div className="num text-[11px] text-text-muted">{month as string}</div>
                        <div
                          className="num mt-2 text-2xl font-extrabold"
                          style={{ color: color as string }}
                        >
                          {fmtPct(margin, 1)}
                        </div>
                        <div className="mt-1 text-[10px] text-text-muted">
                          {lang === "ar" ? "من الإيراد" : "of income"}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-4 rounded-xl bg-surface-2/65 p-3 text-xs leading-relaxed text-text-muted">
                  {lang === "ar"
                    ? "الزيادة في المصروفات ليست تحسنًا؛ لون فرق الكارت يراعي اتجاه المؤشر. لو كان صافي الربح سالبًا فده خسارة فعلية، وليس عمود ربح موجب."
                    : "Expense increases are not improvements. Negative net profit is a loss, not a positive bar."}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-text">
                    {lang === "ar" ? "البنود التي صنعت الفرق" : "What drove the difference"}
                  </h4>
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    {lang === "ar"
                      ? "أكبر 8 فروق بين بنود الحسابات في الشهرين"
                      : "The 8 largest changes in account groups"}
                  </p>
                </div>
                <div className="flex rounded-lg bg-surface-2 p-1">
                  {(["expenses", "income"] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={section === item}
                      onClick={() => setSection(item)}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold ${section === item ? "bg-surface text-brand shadow-sm" : "text-text-muted"}`}
                    >
                      {item === "expenses"
                        ? lang === "ar"
                          ? "المصروفات"
                          : "Expenses"
                        : lang === "ar"
                          ? "الإيرادات"
                          : "Income"}
                    </button>
                  ))}
                </div>
              </div>
              {categoryRows.length ? (
                <div className="mt-4 divide-y divide-border">
                  {categoryRows.map((row) => (
                    <div
                      key={row.name}
                      className="grid gap-2 py-3 sm:grid-cols-[minmax(140px,1fr)_minmax(0,1.5fr)] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-text" title={row.name}>
                          {row.name}
                        </div>
                        <div className="num mt-1 text-[11px] text-text-muted" dir="ltr">
                          {roundedUsd(row.current - row.past) > 0 ? "+" : ""}
                          {usd(roundedUsd(row.current - row.past))}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {(
                          [
                            [row.current, "#168b75"],
                            [row.past, "#a1aec0"],
                          ] as const
                        ).map(([value, color], index) => (
                          <div key={index} className="flex items-center gap-2">
                            <span className="w-10 shrink-0 text-[10px] text-text-muted">
                              {index === 0
                                ? lang === "ar"
                                  ? "حالي"
                                  : "Base"
                                : lang === "ar"
                                  ? "سابق"
                                  : "Prior"}
                            </span>
                            <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                              <div
                                className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500"
                                style={{
                                  width: `${(Math.abs(value) / largestCategory) * 100}%`,
                                  background: color,
                                }}
                              />
                            </div>
                            <span className="num w-24 shrink-0 text-end text-[11px] font-bold text-text">
                              {usd(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-xs text-text-muted">
                  {lang === "ar"
                    ? "لا توجد حسابات تفصيلية لهذه البنود في الشهرين."
                    : "No account details available for these months."}
                </p>
              )}
              <button
                type="button"
                onClick={() => setShowAccounts((value) => !value)}
                aria-expanded={showAccounts}
                className="mt-4 min-h-10 rounded-xl border border-brand/25 bg-brand/5 px-4 text-xs font-bold text-brand hover:bg-brand/10"
              >
                {showAccounts
                  ? lang === "ar"
                    ? "إخفاء الحسابات"
                    : "Hide accounts"
                  : lang === "ar"
                    ? "افتح كل الحسابات والقيود وراء المقارنة"
                    : "Open all accounts and entries"}
              </button>
              {showAccounts && (
                <div className="mt-4 grid gap-5 border-t border-border pt-5 xl:grid-cols-2">
                  {[
                    { snapshot: base, month: baseMonth },
                    { snapshot: comparison, month: comparisonMonth },
                  ].map(({ snapshot, month }) => (
                    <div
                      key={`${month}-${section}`}
                      className="min-w-0 rounded-xl bg-surface-2/35 p-3"
                    >
                      <div className="mb-4 text-sm font-bold text-text">
                        {monthName(month, lang)}{" "}
                        <span className="num text-xs font-normal text-text-muted">
                          {snapshot.from} → {snapshot.to}
                        </span>
                      </div>
                      <AccountExplorer
                        snapshot={snapshot}
                        section={section}
                        lang={lang}
                        onOpenAccount={onOpenAccount}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export function ProfitAndLossView() {
  const { lang } = useI18n();
  const [activeTab, setActiveTab] = useState<"report" | "comparison">("report");
  const [focus, setFocus] = useState<Focus>("expenses");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [account, setAccount] = useState<AccountSelection | null>(null);
  const { data, isLoading, error, refetch } = useApi<ProfitabilityResult>("/api/profitability");
  const {
    data: monthDetail,
    error: monthDetailError,
    refetch: refetchMonthDetail,
  } = useApi<ProfitabilityResult>(`/api/profitability?detailMonth=${selectedMonth}`, {
    enabled: activeTab === "report" && Boolean(selectedMonth),
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
              {activeTab === "comparison"
                ? lang === "ar"
                  ? "قارن شهرين من قائمة أودو، وشوف بالتفصيل أي بند غيّر النتيجة."
                  : "Compare two Odoo months and inspect which accounts changed the result."
                : lang === "ar"
                  ? "افتح أي مؤشر لتعرف مكوّناته، ثم افتح حسابًا لتشاهد القيود والمستندات التي صنعت الرقم."
                  : "Open a metric, then an account, to inspect the entries and documents behind the number."}
            </p>
          </div>
          <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-start backdrop-blur-sm">
            {activeTab === "report" ? (
              <>
                <div className="text-[11px] text-white/70">
                  {lang === "ar" ? "هامش صافي الربح" : "Net margin"}
                </div>
                <div className="num mt-1 text-2xl font-bold">{fmtPct(netMargin, 1)}</div>
                <div className="mt-1 text-[11px] text-white/70">
                  {report.from} → {report.to}
                </div>
              </>
            ) : (
              <>
                <div className="text-[11px] text-white/70">
                  {lang === "ar" ? "المقارنة" : "Comparison"}
                </div>
                <div className="mt-1 flex items-center gap-2 text-lg font-bold">
                  <GitCompareArrows size={20} />
                  {lang === "ar" ? "شهران من اختيارك" : "Two chosen months"}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <div
        className="flex w-fit max-w-full flex-wrap gap-1 rounded-2xl border border-border bg-surface-2 p-1"
        role="tablist"
        aria-label={lang === "ar" ? "عرض الأرباح والخسائر" : "Profit and loss view"}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "report"}
          onClick={() => setActiveTab("report")}
          className={`min-h-10 rounded-xl px-4 text-sm font-bold transition-colors ${activeTab === "report" ? "bg-surface text-brand shadow-sm" : "text-text-muted hover:text-text"}`}
        >
          {lang === "ar" ? "تحليل الفترة" : "Period analysis"}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "comparison"}
          onClick={() => setActiveTab("comparison")}
          className={`min-h-10 rounded-xl px-4 text-sm font-bold transition-colors ${activeTab === "comparison" ? "bg-surface text-brand shadow-sm" : "text-text-muted hover:text-text"}`}
        >
          <span className="inline-flex items-center gap-2">
            <GitCompareArrows size={16} />
            {lang === "ar" ? "مقارنة شهرين" : "Compare two months"}
          </span>
        </button>
      </div>

      {activeTab === "report" ? (
        <>
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
                  <span className="mt-3 block text-xs font-semibold text-text-muted">
                    {card.title}
                  </span>
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
                {
                  label: lang === "ar" ? "صافي الربح" : "Net profit",
                  value: profit,
                  color: "#265b91",
                },
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
                    {
                      key: "income",
                      name: lang === "ar" ? "الإيرادات" : "Income",
                      color: "#19947d",
                    },
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
                <span className="num text-lg font-bold text-text">
                  {usd(monthSummary.netProfit)}
                </span>
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
        </>
      ) : (
        <ProfitabilityComparison
          key={`${report.from}-${report.to}`}
          initialMonth={report.to.slice(0, 7)}
          lang={lang}
          onOpenAccount={setAccount}
        />
      )}

      <Notice
        tone="info"
        title={lang === "ar" ? "مصدر الأرقام وطريقة عرض الدولار" : "Source and USD conversion"}
        icon={<FileText size={16} />}
      >
        {lang === "ar"
          ? `الأرقام مأخوذة من قائمة الأرباح والخسائر في Odoo للشركات: ${report.companies.map((item) => item.name).join("، ")}. القيود المرحلة فقط. ${activeTab === "report" ? `الفترة من ${report.from} إلى ${report.to}. ` : "تاريخ كل شهر ظاهر داخل المقارنة. "}عملة التقرير الأصلية ${report.sourceCurrency}، والتحويل إلى الدولار بسعر ${report.fxRate.toLocaleString("en-US")} ${report.sourceCurrency} لكل دولار.`
          : `Figures come from Odoo Profit and Loss for ${report.companies.map((item) => item.name).join(", ")}, posted entries only. ${activeTab === "report" ? `Period ${report.from} to ${report.to}. ` : "Each compared month shows its exact dates. "}Converted from ${report.sourceCurrency} to USD at ${report.fxRate.toLocaleString("en-US")} ${report.sourceCurrency} per USD.`}
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
