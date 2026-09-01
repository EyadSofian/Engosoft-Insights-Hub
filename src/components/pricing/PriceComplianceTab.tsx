import { useEffect, useState } from "react";
import {
  ExternalLink,
  Gauge,
  Link2Off,
  ScanSearch,
  ShieldCheck,
  TrendingDown,
  Wallet,
} from "lucide-react";
import {
  Card,
  EmptyState,
  KpiCard,
  Notice,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import {
  fmtMoney,
  matchLabel,
  methodLabel,
  severityLabel,
  severityTone,
  statusLabel,
  statusTone,
  type AuditRow,
  type PriceBookSummary,
} from "./pricing-ui";

export interface ComplianceFilters {
  from: string;
  to: string;
  dateBasis: "payment" | "sale" | "invoice";
  company: string;
  currency: string;
  paymentMethod: string;
  salesperson: string;
  salesTeam: string;
  status: string;
  severity: string;
  q: string;
  offset: number;
}

const currentMonthRange = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return { from: `${year}-${month}-01`, to: `${year}-${month}-${day}` };
};

const DEFAULT_MONTH = currentMonthRange();

export const emptyComplianceFilters: ComplianceFilters = {
  from: DEFAULT_MONTH.from,
  to: DEFAULT_MONTH.to,
  dateBasis: "payment",
  company: "all",
  currency: "all",
  paymentMethod: "all",
  salesperson: "all",
  salesTeam: "all",
  status: "all",
  severity: "all",
  q: "",
  offset: 0,
};

export interface ComplianceResponse {
  configured: boolean;
  book: PriceBookSummary | null;
  kpis: {
    auditedLines: number;
    eligibleLines: number;
    matchedLines: number;
    coverage: number | null;
    complianceRate: number | null;
    belowMinimumLines: number;
    belowMinimumValue: number;
    unmatchedLines: number;
    unknownPaymentLines: number;
    mixedPaymentLines: number;
    aboveListLines: number;
    needsReviewLines: number;
    criticalLines: number;
    excludedLines: number;
  };
  byStatus: { status: string; lines: number; leakage: number }[];
  bySalesperson: { salesperson: string; lines: number; breaches: number; leakage: number }[];
  byCurrency: { currency: string; breaches: number; leakage: number }[];
  rows: AuditRow[];
  total: number;
  page: { limit: number; offset: number };
  freshness: { lastRunAt: string; staleHours: number | null };
  error: string;
}

const PAGE_SIZE = 50;

function InvoiceDialog({ movement, onClose }: { movement: string; onClose: () => void }) {
  const { lang } = useI18n();
  const [data, setData] = useState<{
    lines: AuditRow[];
    payment: {
      method: string;
      raw: string[];
      breakdown: { method: string; raw: string; amount: number }[];
      source: string;
    } | null;
    odooSearchUrl: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch(`/api/pricing/invoices/${encodeURIComponent(movement)}`);
        const body = (await response.json()) as typeof data;
        if (live) setData(body);
      } catch {
        if (live) {
          setData({
            lines: [],
            payment: null,
            odooSearchUrl: "",
            error: "Could not load the invoice.",
          });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [movement]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/40 sm:place-items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={movement}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-surface p-4 sm:rounded-2xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-text">{movement}</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 cursor-pointer rounded-lg border border-border px-3 text-[13px]"
          >
            {lang === "ar" ? "إغلاق" : "Close"}
          </button>
        </div>

        {!data && <Skeleton className="mt-3 h-40 w-full rounded-xl" />}

        {!!data?.payment && (
          <div className="mt-3 rounded-xl bg-surface-2 p-3 text-[12px]">
            <div className="font-semibold text-text">
              {lang === "ar" ? "طريقة الدفع الفعلية" : "Settled payment"}:{" "}
              {methodLabel(data.payment.method, lang)}
            </div>
            <div className="mt-1 text-text-muted">
              {lang === "ar" ? "المصدر" : "Source"}: {data.payment.source}
            </div>
            {!!data.payment.breakdown.length && (
              <ul className="mt-1 space-y-0.5 text-text-muted">
                {data.payment.breakdown.map((entry, index) => (
                  <li key={`${entry.raw}${index}`}>
                    {methodLabel(entry.method, lang)} — {entry.raw || "—"} · {entry.amount}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!!data?.lines.length && (
          <ul className="mt-3 space-y-2">
            {data.lines.map((line) => (
              <li
                key={line.invoiceLineId}
                className="rounded-xl border border-border p-3 text-[12px]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-text">
                    {line.productName} ({line.productCode || "—"})
                  </span>
                  <Pill tone={statusTone(line.complianceStatus)}>
                    {statusLabel(line.complianceStatus, lang)}
                  </Pill>
                </div>
                <p className="mt-1 text-text-muted">{line.reason}</p>
                <p className="mt-1 tabular-nums text-text-muted">
                  {fmtMoney(line.actualUnitPrice, line.currency, lang)} ×{line.quantity} ·{" "}
                  {lang === "ar" ? "المسموح" : "allowed"}{" "}
                  {fmtMoney(line.allowedMinimum, line.currency, lang)}
                  {line.allowedMaximum !== null
                    ? ` – ${fmtMoney(line.allowedMaximum, line.currency, lang)}`
                    : ""}{" "}
                  · {matchLabel(line.matchType, lang)}
                </p>
              </li>
            ))}
          </ul>
        )}

        {!!data?.odooSearchUrl && (
          <a
            href={data.odooSearchUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-brand"
          >
            <ExternalLink size={14} aria-hidden="true" />
            {lang === "ar" ? "افتح الفاتورة في أودو" : "Open this invoice in Odoo"}
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * The compliance report.
 *
 * The KPI row is deliberately two numbers, not one: coverage says how much of
 * the invoice population the price book can actually speak to, and compliance
 * says how the part it can speak to behaved. A single "compliance %" over an
 * unmatched population would look like discipline collapsing every time a
 * product was renamed.
 */
export function PriceComplianceTab({
  data,
  filters,
  onFilters,
  loading,
  facets,
  onRecalculate,
  recalculating,
  canWrite,
  showOverview = true,
  showTeamBreakdown = true,
}: {
  data?: ComplianceResponse;
  filters: ComplianceFilters;
  onFilters: (next: ComplianceFilters) => void;
  loading: boolean;
  facets: { currencies: string[] };
  onRecalculate: () => void;
  recalculating: boolean;
  canWrite: boolean;
  showOverview?: boolean;
  showTeamBreakdown?: boolean;
}) {
  const { lang, t } = useI18n();
  const [openInvoice, setOpenInvoice] = useState("");

  const kpis = data?.kpis;
  const set = <K extends keyof ComplianceFilters>(key: K, value: ComplianceFilters[K]) =>
    onFilters({ ...filters, [key]: value, offset: key === "offset" ? (value as number) : 0 });

  const leakageByCurrency = (data?.byCurrency ?? []).filter((entry) => entry.leakage > 0);
  const stale = (data?.freshness.staleHours ?? 0) > 24;

  return (
    <div className="space-y-4">
      {!!data?.error && <Notice tone="warning">{data.error}</Notice>}

      {!data?.freshness.lastRunAt && !loading && (
        <Notice tone="info" title={t("pb_never_audited")}>
          {lang === "ar"
            ? "اضغط «إعادة التحليل» عشان يتقارن كل بند فاتورة مدفوعة بقائمة الأسعار المنشورة. التحليل بيشتغل بالطلب فقط، مش مع كل فتح للصفحة."
            : "Press “Re-run audit” to compare every paid invoice line against the published price book. The audit runs on request only, never on page load."}
        </Notice>
      )}
      {stale && (
        <Notice tone="warning">
          {lang === "ar"
            ? `آخر تحليل من ${Math.round(data?.freshness.staleHours ?? 0)} ساعة. الأرقام المعروضة هي آخر نتيجة محفوظة.`
            : `Last audited ${Math.round(data?.freshness.staleHours ?? 0)} hours ago. These are the stored results from that run.`}
        </Notice>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12px] text-text-muted">
          {data?.book
            ? `${data.book.name} · v${data.book.version}${
                data.freshness.lastRunAt
                  ? ` · ${t("pb_last_audit")} ${data.freshness.lastRunAt.slice(0, 16).replace("T", " ")}`
                  : ""
              }`
            : t("pb_no_book")}
        </div>
        <button
          type="button"
          onClick={onRecalculate}
          disabled={!canWrite || recalculating}
          className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: "var(--brand)" }}
        >
          <ScanSearch
            size={15}
            className={recalculating ? "animate-pulse" : ""}
            aria-hidden="true"
          />
          {recalculating ? t("pb_recalculating") : t("pb_recalculate")}
        </button>
      </div>

      {showOverview && loading && !kpis ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-32 w-full rounded-2xl" />
          ))}
        </div>
      ) : showOverview ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            index={0}
            label={t("pb_audited_lines")}
            value={fmtNum(kpis?.auditedLines ?? 0)}
            sub={
              lang === "ar"
                ? `${fmtNum(kpis?.eligibleLines ?? 0)} بند مؤهل للحكم`
                : `${fmtNum(kpis?.eligibleLines ?? 0)} eligible for a verdict`
            }
            subWrap
            icon={<ScanSearch size={16} aria-hidden="true" />}
          />
          <KpiCard
            index={1}
            label={t("pb_coverage")}
            value={
              kpis?.coverage === null || kpis?.coverage === undefined
                ? "—"
                : fmtPct(kpis.coverage * 100, 1)
            }
            sub={
              lang === "ar"
                ? `${fmtNum(kpis?.matchedLines ?? 0)} بند مطابق بقائمة الأسعار`
                : `${fmtNum(kpis?.matchedLines ?? 0)} lines matched to a price rule`
            }
            subWrap
            icon={<Gauge size={16} aria-hidden="true" />}
          />
          <KpiCard
            index={2}
            label={t("pb_compliance_rate")}
            value={
              kpis?.complianceRate === null || kpis?.complianceRate === undefined
                ? "—"
                : fmtPct(kpis.complianceRate * 100, 1)
            }
            sub={lang === "ar" ? "محسوبة على البنود المطابقة فقط" : "over matched lines only"}
            subWrap
            icon={<ShieldCheck size={16} aria-hidden="true" />}
          />
          <KpiCard
            index={3}
            hero
            label={t("pb_below_min")}
            value={fmtNum(kpis?.belowMinimumLines ?? 0)}
            sub={
              lang === "ar"
                ? `${fmtNum(kpis?.criticalLines ?? 0)} منها حرجة`
                : `${fmtNum(kpis?.criticalLines ?? 0)} of them critical`
            }
            subWrap
            icon={<TrendingDown size={16} aria-hidden="true" />}
          />
          <KpiCard
            index={4}
            label={t("pb_leakage")}
            value={
              leakageByCurrency.length
                ? leakageByCurrency
                    .map((entry) => fmtMoney(entry.leakage, entry.currency, lang))
                    .join(" + ")
                : "—"
            }
            valueWrap
            sub={t("pb_leakage_note")}
            subWrap
            icon={<Wallet size={16} aria-hidden="true" />}
          />
          <KpiCard
            index={5}
            label={t("pb_unmatched")}
            value={fmtNum(kpis?.unmatchedLines ?? 0)}
            sub={
              lang === "ar"
                ? "لا تُحتسب مخالفة ولا التزام"
                : "counted as neither a breach nor a pass"
            }
            subWrap
            icon={<Link2Off size={16} aria-hidden="true" />}
          />
          <KpiCard
            index={6}
            label={t("pb_unknown_payment")}
            value={fmtNum(kpis?.unknownPaymentLines ?? 0)}
            sub={
              lang === "ar"
                ? `${fmtNum(kpis?.mixedPaymentLines ?? 0)} دفع مختلط`
                : `${fmtNum(kpis?.mixedPaymentLines ?? 0)} mixed payments`
            }
            subWrap
          />
          <KpiCard
            index={7}
            label={t("pb_needs_review_lines")}
            value={fmtNum(kpis?.needsReviewLines ?? 0)}
            sub={
              lang === "ar"
                ? `${fmtNum(kpis?.aboveListLines ?? 0)} بيع أعلى من السعر الرسمي`
                : `${fmtNum(kpis?.aboveListLines ?? 0)} sold above list`
            }
            subWrap
          />
        </div>
      ) : null}

      <div className="hscroll -mb-1">
        <div className="flex min-w-max gap-2 pb-1">
          {[
            ["all", lang === "ar" ? "كل الفواتير" : "All invoices"],
            ["below_minimum", lang === "ar" ? "تحت الحد الأدنى" : "Below floor"],
            ["compliant_offer", lang === "ar" ? "بسعر عرض" : "Offer price"],
            ["compliant", lang === "ar" ? "ملتزم" : "Compliant"],
            ["unknown_payment_method", lang === "ar" ? "يحتاج مراجعة" : "Needs review"],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              onClick={() => set("status", value)}
              className={`min-h-9 rounded-xl border px-3 text-[12px] font-semibold transition ${
                filters.status === value
                  ? "border-[#10262d] bg-[#10262d] text-white"
                  : "border-border bg-surface text-text-muted hover:bg-surface-2"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Card className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            ["from", lang === "ar" ? "من" : "From", "date"],
            ["to", lang === "ar" ? "إلى" : "To", "date"],
          ] as const
        ).map(([key, label, type]) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-text-muted">{label}</span>
            <input
              type={type}
              value={filters[key]}
              onChange={(event) => set(key, event.target.value)}
              className="min-h-11 rounded-lg border border-border bg-surface px-2.5 text-[13px]"
            />
          </label>
        ))}
        {(
          [
            [
              "dateBasis",
              lang === "ar" ? "أساس التاريخ" : "Date basis",
              [
                { value: "payment", label: lang === "ar" ? "تاريخ الدفع" : "Payment date" },
                { value: "sale", label: lang === "ar" ? "تاريخ البيع" : "Sale date" },
                { value: "invoice", label: lang === "ar" ? "تاريخ الفاتورة" : "Invoice date" },
              ],
            ],
            [
              "currency",
              lang === "ar" ? "العملة" : "Currency",
              [
                { value: "all", label: t("all") },
                ...facets.currencies.map((value) => ({ value, label: value })),
              ],
            ],
            [
              "paymentMethod",
              lang === "ar" ? "طريقة الدفع" : "Payment method",
              [
                { value: "all", label: t("all") },
                ...["tabby", "tamara", "cash", "cashier", "bank_transfer", "mixed", "unknown"].map(
                  (value) => ({ value, label: methodLabel(value, lang) }),
                ),
              ],
            ],
            [
              "status",
              lang === "ar" ? "حالة الالتزام" : "Status",
              [
                { value: "all", label: t("all") },
                ...[
                  "compliant",
                  "compliant_offer",
                  "below_minimum",
                  "above_list",
                  "unmatched_product",
                  "unknown_payment_method",
                  "mixed_payment_review",
                  "expired_offer",
                  "excluded",
                ].map((value) => ({ value, label: statusLabel(value, lang) })),
              ],
            ],
            [
              "severity",
              lang === "ar" ? "درجة الخطورة" : "Severity",
              [
                { value: "all", label: t("all") },
                ...["critical", "warning", "needs_review", "informational"].map((value) => ({
                  value,
                  label: severityLabel(value, lang),
                })),
              ],
            ],
          ] as const
        ).map(([key, label, options]) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-text-muted">{label}</span>
            <select
              value={filters[key as keyof ComplianceFilters] as string}
              onChange={(event) => set(key as keyof ComplianceFilters, event.target.value as never)}
              className="min-h-11 rounded-lg border border-border bg-surface px-2.5 text-[13px]"
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="col-span-2 flex flex-col gap-1 sm:col-span-3 lg:col-span-6">
          <span className="text-[11px] font-medium text-text-muted">
            {lang === "ar"
              ? "بحث برقم الفاتورة أو الموظف أو الدورة"
              : "Invoice, salesperson or course"}
          </span>
          <input
            value={filters.q}
            onChange={(event) => set("q", event.target.value)}
            className="min-h-11 rounded-lg border border-border bg-surface px-3 text-[13px]"
          />
        </label>
      </Card>

      {showTeamBreakdown && !!data?.bySalesperson.length && (
        <Card>
          <SectionTitle
            hint={
              lang === "ar"
                ? "الموظفون اللي عندهم بنود مباعة تحت الحد الأدنى المنشور، مرتّبين بحجم الفارق."
                : "Salespeople with lines under the published floor, ordered by the size of the gap."
            }
          >
            {lang === "ar" ? "حسب موظف المبيعات" : "By salesperson"}
          </SectionTitle>
          <div className="hscroll">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-subtle">
                  <th className="py-2 text-start font-semibold">
                    {lang === "ar" ? "الموظف" : "Salesperson"}
                  </th>
                  <th className="py-2 text-start font-semibold">
                    {lang === "ar" ? "بنود" : "Lines"}
                  </th>
                  <th className="py-2 text-start font-semibold">{t("pb_below_min")}</th>
                  <th className="py-2 text-start font-semibold">{t("pb_leakage")}</th>
                </tr>
              </thead>
              <tbody>
                {data.bySalesperson.map((row) => (
                  <tr key={row.salesperson} className="border-t border-border">
                    <td className="py-2">{row.salesperson}</td>
                    <td className="py-2 tabular-nums">{fmtNum(row.lines)}</td>
                    <td className="py-2 tabular-nums">{fmtNum(row.breaches)}</td>
                    <td className="py-2 tabular-nums">{fmtNum(Math.round(row.leakage))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <SectionTitle
          hint={
            lang === "ar"
              ? `${fmtNum(data?.total ?? 0)} بند مطابق للفلاتر. الجدول مقسّم صفحات عشان ما نبعتش آلاف الصفوف في رد واحد.`
              : `${fmtNum(data?.total ?? 0)} lines match. The table is paginated so a response never carries thousands of rows.`
          }
        >
          {lang === "ar" ? "تفاصيل البنود" : "Line detail"}
        </SectionTitle>

        {loading && <Skeleton className="h-72 w-full rounded-xl" />}
        {!loading && !data?.rows.length && <EmptyState label={t("no_data")} />}

        {!loading && !!data?.rows.length && (
          <>
            <div className="hscroll">
              <table className="w-full min-w-[1100px] text-[12px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-text-subtle">
                    {[
                      lang === "ar" ? "الفاتورة" : "Invoice",
                      lang === "ar" ? "تاريخ البيع" : "Sale",
                      lang === "ar" ? "الفاتورة" : "Invoiced",
                      lang === "ar" ? "الدفع" : "Paid",
                      lang === "ar" ? "الموظف" : "Salesperson",
                      lang === "ar" ? "المنتج" : "Product",
                      lang === "ar" ? "الطريقة" : "Method",
                      lang === "ar" ? "الكمية" : "Qty",
                      lang === "ar" ? "سعر الوحدة" : "Unit price",
                      lang === "ar" ? "المسموح" : "Allowed",
                      lang === "ar" ? "الفرق" : "Gap",
                      lang === "ar" ? "الخصم %" : "Below %",
                      lang === "ar" ? "الحالة" : "Status",
                    ].map((label) => (
                      <th key={label} className="py-2 pe-3 text-start font-semibold">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.invoiceLineId} className="border-t border-border align-top">
                      <td className="py-2 pe-3">
                        <button
                          type="button"
                          onClick={() => setOpenInvoice(row.invoiceNumber)}
                          className="cursor-pointer font-medium text-brand underline-offset-2 hover:underline"
                        >
                          {row.invoiceNumber}
                        </button>
                      </td>
                      <td className="py-2 pe-3 tabular-nums">{row.saleDate || "—"}</td>
                      <td className="py-2 pe-3 tabular-nums">{row.invoiceDate || "—"}</td>
                      <td className="py-2 pe-3 tabular-nums">{row.paymentDate || "—"}</td>
                      <td className="py-2 pe-3">{row.salesperson || "—"}</td>
                      <td className="py-2 pe-3">
                        <div className="font-medium text-text">{row.productName}</div>
                        <div className="text-[11px] text-text-subtle">{row.productCode || "—"}</div>
                      </td>
                      <td className="py-2 pe-3">{methodLabel(row.paymentMethod, lang)}</td>
                      <td className="py-2 pe-3 tabular-nums">{row.quantity}</td>
                      <td className="py-2 pe-3 tabular-nums">
                        {fmtMoney(row.actualUnitPrice, row.currency, lang)}
                      </td>
                      <td className="py-2 pe-3 tabular-nums">
                        {fmtMoney(row.allowedMinimum, row.currency, lang)}
                        {row.allowedMaximum !== null && row.allowedMaximum !== row.allowedMinimum
                          ? ` – ${fmtMoney(row.allowedMaximum, row.currency, lang)}`
                          : ""}
                      </td>
                      <td className="py-2 pe-3 tabular-nums">
                        {row.varianceAmount > 0
                          ? fmtMoney(row.varianceAmount, row.currency, lang)
                          : "—"}
                      </td>
                      <td className="py-2 pe-3 tabular-nums">
                        {row.variancePercent !== null && row.variancePercent > 0
                          ? fmtPct(row.variancePercent * 100, 1)
                          : "—"}
                      </td>
                      <td className="py-2 pe-3">
                        <Pill tone={statusTone(row.complianceStatus)}>
                          {statusLabel(row.complianceStatus, lang)}
                        </Pill>
                        <p className="mt-1 max-w-[280px] text-[11px] leading-snug text-text-muted">
                          {row.reason}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 text-[12px]">
              <button
                type="button"
                disabled={filters.offset <= 0}
                onClick={() =>
                  onFilters({ ...filters, offset: Math.max(0, filters.offset - PAGE_SIZE) })
                }
                className="min-h-11 cursor-pointer rounded-lg border border-border px-3 font-medium disabled:opacity-40"
              >
                {lang === "ar" ? "السابق" : "Previous"}
              </button>
              <span className="text-text-muted tabular-nums">
                {filters.offset + 1}–{Math.min(filters.offset + PAGE_SIZE, data.total)} /{" "}
                {data.total}
              </span>
              <button
                type="button"
                disabled={filters.offset + PAGE_SIZE >= data.total}
                onClick={() => onFilters({ ...filters, offset: filters.offset + PAGE_SIZE })}
                className="min-h-11 cursor-pointer rounded-lg border border-border px-3 font-medium disabled:opacity-40"
              >
                {lang === "ar" ? "التالي" : "Next"}
              </button>
            </div>
          </>
        )}
      </Card>

      {!!openInvoice && <InvoiceDialog movement={openInvoice} onClose={() => setOpenInvoice("")} />}
    </div>
  );
}
