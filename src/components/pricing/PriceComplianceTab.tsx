import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { DataTable, type Col } from "@/components/DataTable";
import { EmptyState, ErrorState, Notice } from "@/components/ui-bits";
import { useIsMobile } from "@/hooks/use-mobile";
import { fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import { InvoiceDetailPanel } from "./InvoiceDetailPanel";
import { RowStatusBadge, verdictOf } from "./StatusBadge";
import {
  fmtMoney,
  methodLabel,
  severityLabel,
  statusLabel,
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
  /** A column name the audit endpoint knows how to order by. */
  sort: string;
  dir: "asc" | "desc";
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
  sort: "priority",
  dir: "desc",
  offset: 0,
};

export interface ComplianceResponse {
  configured: boolean;
  book: PriceBookSummary | null;
  kpis: {
    auditedLines: number;
    eligibleLines: number;
    matchedLines: number;
    judgedLines: number;
    compliantLines: number;
    packageLines: number;
    compliantPackageLines: number;
    unresolvedPackageLines: number;
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

const rowDate = (row: AuditRow): string => row.paymentDate || row.invoiceDate || row.saleDate || "";

/* --- filter bar ----------------------------------------------------------- */

/**
 * The five verdicts a manager triages by, as one row of chips.
 *
 * These are the same values the full status list carries; they sit above the
 * table because reaching them through a select is three interactions for the
 * question most readers arrive with.
 */
function QuickStatuses({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const options: { value: string; label: string; tone?: string }[] = [
    { value: "all", label: ar ? "الكل" : "All" },
    { value: "below_minimum", label: ar ? "أقل من الحد" : "Below the floor", tone: "--danger" },
    {
      value: "unknown_payment_method",
      label: ar ? "دفع غير معروف" : "Unknown payment",
      tone: "--warning",
    },
    { value: "compliant_offer", label: ar ? "بسعر عرض" : "Offer price", tone: "--offer" },
    {
      value: "compliant_package",
      label: ar ? "سعر باقة" : "Package price",
      tone: "--success",
    },
    { value: "compliant", label: ar ? "ملتزم" : "Compliant", tone: "--success" },
    { value: "unmatched_product", label: ar ? "بيانات ناقصة" : "Incomplete data" },
  ];

  return (
    <div
      className="hscroll scroll-hint-x -mx-0.5"
      style={{ ["--scroll-hint-bg" as string]: "var(--surface)" }}
    >
      <div
        className="flex min-w-max items-center gap-1.5 px-0.5"
        role="group"
        aria-label={ar ? "تصفية سريعة بالحالة" : "Quick status filter"}
      >
        {options.map((option) => {
          const active = value === option.value;
          return (
            <button
              type="button"
              key={option.value}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-semibold transition-colors ${
                active
                  ? "border-transparent text-white"
                  : "border-border bg-surface text-text-muted hover:bg-surface-2 hover:text-text"
              }`}
              style={active ? { background: "var(--ink)" } : undefined}
            >
              {option.tone && (
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full"
                  style={{ background: `var(${option.tone})` }}
                />
              )}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* --- the tab -------------------------------------------------------------- */

/**
 * The compliance report: one line per invoice line, judged against the price
 * book that was published when it was paid.
 *
 * The rows arrive one server page at a time, so sorting and paging are the
 * server's — a table that reordered the fifty rows in hand would answer "the
 * worst of this page" while looking like it answered "the worst there is".
 */
export function PriceComplianceTab({
  data,
  filters,
  onFilters,
  loading,
  error,
  onRetry,
  facets,
  onRecalculate,
  recalculating,
  canWrite,
}: {
  data?: ComplianceResponse;
  filters: ComplianceFilters;
  onFilters: (next: ComplianceFilters) => void;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  facets: { currencies: string[] };
  onRecalculate: () => void;
  recalculating: boolean;
  canWrite: boolean;
}) {
  const { lang, t } = useI18n();
  const ar = lang === "ar";
  const isMobile = useIsMobile();
  const [openInvoice, setOpenInvoice] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [searchDraft, setSearchDraft] = useState(filters.q);

  const kpis = data?.kpis;
  const set = <K extends keyof ComplianceFilters>(key: K, value: ComplianceFilters[K]) =>
    onFilters({ ...filters, [key]: value, offset: key === "offset" ? (value as number) : 0 });

  // The search box holds its own text and hands it over once typing settles;
  // every keystroke otherwise becomes a query against the audit table.
  useEffect(() => setSearchDraft(filters.q), [filters.q]);
  useEffect(() => {
    if (searchDraft === filters.q) return;
    const timer = setTimeout(() => onFilters({ ...filters, q: searchDraft, offset: 0 }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const stale = (data?.freshness.staleHours ?? 0) > 24;
  const rows = data?.rows ?? [];

  const activeFilters = [
    filters.status !== "all" && {
      key: "status",
      label: statusLabel(filters.status, lang),
      clear: () => set("status", "all"),
    },
    filters.severity !== "all" && {
      key: "severity",
      label: severityLabel(filters.severity, lang),
      clear: () => set("severity", "all"),
    },
    filters.salesperson !== "all" && {
      key: "salesperson",
      label: filters.salesperson,
      clear: () => set("salesperson", "all"),
    },
    filters.paymentMethod !== "all" && {
      key: "paymentMethod",
      label: methodLabel(filters.paymentMethod, lang),
      clear: () => set("paymentMethod", "all"),
    },
    filters.currency !== "all" && {
      key: "currency",
      label: filters.currency,
      clear: () => set("currency", "all"),
    },
    !!filters.q && {
      key: "q",
      label: `"${filters.q}"`,
      clear: () => set("q", ""),
    },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  const cols: Col<AuditRow>[] = useMemo(
    () => [
      {
        key: "invoice",
        label: ar ? "رقم الفاتورة" : "Invoice",
        header: ar ? "الفاتورة" : "Invoice",
        sticky: true,
        always: true,
        sortable: true,
        minWidth: "132px",
        render: (row) => (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOpenInvoice(row.invoiceNumber);
            }}
            className="cursor-pointer text-start font-semibold text-brand hover:underline"
            aria-label={`${ar ? "تفاصيل الفاتورة" : "Invoice detail"} ${row.invoiceNumber}`}
          >
            <bdi className="num">{row.invoiceNumber}</bdi>
          </button>
        ),
      },
      {
        key: "priority",
        label: ar ? "الحالة" : "Verdict",
        header: ar ? "الحالة" : "Verdict",
        sortable: true,
        always: true,
        minWidth: "150px",
        render: (row) => <RowStatusBadge row={row} />,
      },
      {
        key: "course",
        label: ar ? "الدورة" : "Course",
        header: ar ? "الدورة" : "Course",
        sortable: true,
        minWidth: "220px",
        render: (row) => (
          <div className="min-w-0">
            <div className="truncate text-[12.5px] font-medium text-text">
              <bdi>{row.productName || "—"}</bdi>
            </div>
            <div className="num text-[10.5px] text-text-subtle">
              <bdi>{row.productCode || (ar ? "بدون كود" : "no code")}</bdi>
            </div>
          </div>
        ),
      },
      {
        key: "salesperson",
        label: ar ? "الموظف" : "Salesperson",
        header: ar ? "الموظف" : "Salesperson",
        sortable: true,
        minWidth: "130px",
        render: (row) => (
          <span className="truncate text-[12px]">
            <bdi>{row.salesperson || "—"}</bdi>
          </span>
        ),
      },
      {
        key: "method",
        label: ar ? "طريقة الدفع" : "Payment method",
        header: ar ? "الدفع" : "Payment",
        hideByDefault: true,
        minWidth: "104px",
        render: (row) => (
          <span className="text-[12px]">{methodLabel(row.paymentMethod, lang)}</span>
        ),
      },
      {
        key: "date",
        label: ar ? "التاريخ" : "Date",
        header: ar ? "التاريخ" : "Date",
        sortable: true,
        align: "right",
        minWidth: "104px",
        render: (row) => <bdi className="num text-[12px]">{rowDate(row) || "—"}</bdi>,
      },
      {
        key: "qty",
        label: ar ? "الكمية" : "Quantity",
        header: ar ? "الكمية" : "Qty",
        align: "right",
        hideByDefault: true,
        minWidth: "64px",
        render: (row) => <span className="num text-[12px]">{fmtNum(row.quantity)}</span>,
      },
      {
        key: "price",
        label: ar ? "سعر البيع" : "Sold at",
        header: ar ? "سعر البيع" : "Sold",
        sortable: true,
        align: "right",
        minWidth: "112px",
        render: (row) => (
          <span className="num text-[12.5px] font-semibold text-text">
            {fmtMoney(row.actualUnitPrice, row.currency, lang)}
          </span>
        ),
      },
      {
        key: "floor",
        label: ar ? "الحد الأدنى" : "Floor",
        header: ar ? "الحد الأدنى" : "Floor",
        align: "right",
        minWidth: "112px",
        render: (row) => (
          <span className="num text-[12px] text-text-muted">
            {row.allowedMinimum === null ? "—" : fmtMoney(row.allowedMinimum, row.currency, lang)}
          </span>
        ),
      },
      {
        key: "ceiling",
        label: ar ? "الحد الأعلى" : "Ceiling",
        header: ar ? "الحد الأعلى" : "Ceiling",
        align: "right",
        hideByDefault: true,
        minWidth: "112px",
        render: (row) => (
          <span className="num text-[12px] text-text-muted">
            {row.allowedMaximum === null ? "—" : fmtMoney(row.allowedMaximum, row.currency, lang)}
          </span>
        ),
      },
      {
        key: "gap",
        label: ar ? "قيمة التجاوز" : "Value given away",
        header: ar ? "التجاوز" : "Gap",
        sortable: true,
        align: "right",
        minWidth: "104px",
        headerTitle: ar
          ? "الفرق بين ما حُصّل والحد الأدنى المعتمد، مضروبًا في الكمية."
          : "Collected minus the approved floor, across the quantity sold.",
        render: (row) =>
          row.varianceAmount > 0 ? (
            <span className="num text-[12.5px] font-semibold" style={{ color: "var(--danger)" }}>
              {fmtMoney(row.varianceAmount, row.currency, lang)}
            </span>
          ) : (
            <span className="text-[12px] text-text-subtle">—</span>
          ),
      },
      {
        key: "belowBy",
        label: ar ? "أقل بنسبة" : "Below by",
        header: ar ? "أقل بنسبة" : "Below by",
        align: "right",
        hideByDefault: true,
        minWidth: "84px",
        render: (row) =>
          row.variancePercent !== null && row.variancePercent > 0 ? (
            <span className="num text-[12px]" style={{ color: "var(--danger)" }}>
              {fmtPct(row.variancePercent * 100, 1)}
            </span>
          ) : (
            <span className="text-[12px] text-text-subtle">—</span>
          ),
      },
    ],
    [ar, lang],
  );

  if (error) return <ErrorState message={error} onRetry={onRetry} />;

  const coverage = kpis?.coverage;

  return (
    <div className="space-y-3">
      {!!data?.error && <Notice tone="warning">{data.error}</Notice>}

      {!data?.freshness.lastRunAt && !loading && (
        <Notice tone="info" title={t("pb_never_audited")}>
          {ar
            ? "اضغط «إعادة التحليل» ليقارن النظام كل بند فاتورة مدفوعة بقائمة الأسعار المنشورة. التحليل يعمل عند الطلب فقط، لا مع كل فتح للصفحة."
            : "Press “Re-run audit” to compare every paid invoice line against the published price book. The audit runs on request only, never on page load."}
        </Notice>
      )}

      {stale && (
        <Notice tone="warning">
          {ar
            ? `آخر تحليل قبل ${Math.round(data?.freshness.staleHours ?? 0)} ساعة. الأرقام المعروضة هي نتيجة ذلك التشغيل.`
            : `Last audited ${Math.round(data?.freshness.staleHours ?? 0)} hours ago. These are the stored results from that run.`}
        </Notice>
      )}

      {/* --- context strip -------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border bg-surface px-3.5 py-2.5">
        <div className="min-w-0 text-[11.5px] text-text-muted">
          {data?.book ? (
            <>
              <span className="font-semibold text-text">
                <bdi>{data.book.name}</bdi>
              </span>{" "}
              · <span className="num">v{data.book.version}</span>
            </>
          ) : (
            t("pb_no_book")
          )}
        </div>

        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          <div className="flex items-center gap-1.5">
            <dt className="text-text-subtle">{ar ? "التغطية" : "Coverage"}</dt>
            <dd className="num font-semibold text-text">
              {coverage == null ? "—" : fmtPct(coverage * 100, 0)}
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-text-subtle">{ar ? "بنود بلا سعر معتمد" : "Unmatched"}</dt>
            <dd className="num font-semibold text-text">{fmtNum(kpis?.unmatchedLines ?? 0)}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-text-subtle">{ar ? "مستثناة" : "Excluded"}</dt>
            <dd className="num font-semibold text-text">{fmtNum(kpis?.excludedLines ?? 0)}</dd>
          </div>
        </dl>
      </div>

      {/* --- filters -------------------------------------------------------- */}
      <div className="rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
          <div className="flex min-h-9 min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 focus-within:border-brand">
            <Search size={14} className="shrink-0 text-text-subtle" aria-hidden="true" />
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={ar ? "رقم فاتورة، موظف، أو دورة" : "Invoice, salesperson or course"}
              aria-label={ar ? "بحث في الفواتير" : "Search invoices"}
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[12.5px] outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowFilters((open) => !open)}
            aria-expanded={showFilters}
            className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-semibold text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            {ar ? "فلاتر" : "Filters"}
            {!!activeFilters.length && (
              <span
                className="num grid h-[17px] min-w-[17px] place-items-center rounded-full px-1 text-[10px] font-bold text-white"
                style={{ background: "var(--brand)" }}
              >
                {activeFilters.length}
              </span>
            )}
          </button>

          {!!activeFilters.length && (
            <button
              type="button"
              onClick={() =>
                onFilters({
                  ...emptyComplianceFilters,
                  from: filters.from,
                  to: filters.to,
                  dateBasis: filters.dateBasis,
                  sort: filters.sort,
                  dir: filters.dir,
                })
              }
              className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold text-text-muted transition-colors hover:text-text"
            >
              <RotateCcw size={13} aria-hidden="true" />
              {ar ? "مسح الفلاتر" : "Clear filters"}
            </button>
          )}
        </div>

        <div className="border-t border-border px-3 py-2.5">
          <QuickStatuses value={filters.status} onChange={(next) => set("status", next)} />
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 gap-2.5 border-t border-border px-3 py-3 sm:grid-cols-3 lg:grid-cols-6">
            {(
              [
                ["from", ar ? "من" : "From"],
                ["to", ar ? "إلى" : "To"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-text-muted">{label}</span>
                <input
                  type="date"
                  value={filters[key]}
                  onChange={(event) => set(key, event.target.value)}
                  className="num min-h-10 rounded-lg border border-border bg-surface px-2.5 text-[12.5px]"
                />
              </label>
            ))}

            {(
              [
                [
                  "dateBasis",
                  ar ? "أساس التاريخ" : "Date basis",
                  [
                    { value: "payment", label: ar ? "تاريخ الدفع" : "Payment date" },
                    { value: "sale", label: ar ? "تاريخ البيع" : "Sale date" },
                    { value: "invoice", label: ar ? "تاريخ الفاتورة" : "Invoice date" },
                  ],
                ],
                [
                  "currency",
                  ar ? "العملة" : "Currency",
                  [
                    { value: "all", label: t("all") },
                    ...facets.currencies.map((value) => ({ value, label: value })),
                  ],
                ],
                [
                  "paymentMethod",
                  ar ? "طريقة الدفع" : "Payment method",
                  [
                    { value: "all", label: t("all") },
                    ...[
                      "tabby",
                      "tamara",
                      "cash",
                      "cashier",
                      "bank_transfer",
                      "mixed",
                      "unknown",
                    ].map((value) => ({ value, label: methodLabel(value, lang) })),
                  ],
                ],
                [
                  "status",
                  ar ? "حالة الالتزام" : "Status",
                  [
                    { value: "all", label: t("all") },
                    ...[
                      "compliant",
                      "compliant_package",
                      "compliant_offer",
                      "below_minimum",
                      "above_list",
                      "unmatched_product",
                      "unknown_payment_method",
                      "mixed_payment_review",
                      "expired_offer",
                      "package_price_unresolved",
                      "excluded",
                    ].map((value) => ({ value, label: statusLabel(value, lang) })),
                  ],
                ],
                [
                  "severity",
                  ar ? "درجة الخطورة" : "Severity",
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
                  onChange={(event) =>
                    set(key as keyof ComplianceFilters, event.target.value as never)
                  }
                  className="min-h-10 cursor-pointer rounded-lg border border-border bg-surface px-2.5 text-[12.5px]"
                >
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* --- rows ----------------------------------------------------------- */}
      {isMobile ? (
        <InvoiceCardList
          rows={rows}
          loading={loading}
          total={data?.total ?? 0}
          offset={filters.offset}
          onOffset={(offset) => onFilters({ ...filters, offset })}
          onOpen={setOpenInvoice}
        />
      ) : (
        <DataTable<AuditRow>
          rows={rows}
          cols={cols}
          loading={loading}
          rowKey={(row) => row.invoiceLineId}
          columnChooser
          maxHeight={620}
          onRowClick={(row) => setOpenInvoice(row.invoiceNumber)}
          serverSort={{
            key: filters.sort,
            dir: filters.dir === "asc" ? 1 : -1,
            onChange: (key, dir) =>
              onFilters({ ...filters, sort: key, dir: dir === 1 ? "asc" : "desc", offset: 0 }),
          }}
          serverPage={{
            offset: filters.offset,
            total: data?.total ?? 0,
            size: PAGE_SIZE,
            onOffset: (offset) => onFilters({ ...filters, offset }),
          }}
          csvFilename="engosoft-price-compliance"
          csvRow={(row) => ({
            invoice: row.invoiceNumber,
            course: row.productName,
            code: row.productCode,
            salesperson: row.salesperson,
            payment: row.paymentMethod,
            date: rowDate(row),
            sold: row.actualUnitPrice,
            floor: row.allowedMinimum ?? "",
            gap: row.varianceAmount,
            status: row.complianceStatus,
          })}
          emptyState={
            <EmptyState
              label={ar ? "لا توجد بنود مطابقة" : "No matching lines"}
              hint={
                activeFilters.length
                  ? ar
                    ? "امسح أحد الفلاتر بالأعلى، أو وسّع الفترة."
                    : "Clear one of the filters above, or widen the period."
                  : ar
                    ? "شغّل التحليل ليظهر حكم على فواتير هذه الفترة."
                    : "Run the audit to get a verdict on this period's invoices."
              }
            />
          }
        />
      )}

      {!!openInvoice && (
        <InvoiceDetailPanel movement={openInvoice} onClose={() => setOpenInvoice("")} />
      )}
    </div>
  );
}

/* --- phone ---------------------------------------------------------------- */

/**
 * The same rows as a list of compact cards.
 *
 * A twelve-column table on a 390px screen is a horizontal scroll nobody reads,
 * so the phone gets the four values the verdict rests on and sends the rest to
 * the detail sheet.
 */
function InvoiceCardList({
  rows,
  loading,
  total,
  offset,
  onOffset,
  onOpen,
}: {
  rows: AuditRow[];
  loading: boolean;
  total: number;
  offset: number;
  onOffset: (offset: number) => void;
  onOpen: (movement: string) => void;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-[104px] rounded-xl border border-border bg-surface-2/50" />
        ))}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <EmptyState label={ar ? "لا توجد بنود مطابقة" : "No matching lines"} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const breach = verdictOf(row) === "below_floor";
        return (
          <button
            type="button"
            key={row.invoiceLineId}
            onClick={() => onOpen(row.invoiceNumber)}
            className="block w-full cursor-pointer rounded-xl border bg-surface p-3 text-start transition-colors active:bg-surface-2"
            style={{
              borderColor: breach
                ? "color-mix(in oklab, var(--danger) 30%, transparent)"
                : "var(--border)",
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-text">
                  <bdi>{row.productName || "—"}</bdi>
                </div>
                <div className="num mt-0.5 text-[10.5px] text-text-subtle">
                  <bdi>{row.invoiceNumber}</bdi> · <bdi>{rowDate(row) || "—"}</bdi>
                </div>
              </div>
              <RowStatusBadge row={row} />
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-border pt-2">
              {[
                {
                  label: ar ? "سعر البيع" : "Sold",
                  value: fmtMoney(row.actualUnitPrice, row.currency, lang),
                  tone: "var(--text)",
                },
                {
                  label: ar ? "الحد الأدنى" : "Floor",
                  value:
                    row.allowedMinimum === null
                      ? "—"
                      : fmtMoney(row.allowedMinimum, row.currency, lang),
                  tone: "var(--text-muted)",
                },
                {
                  label: ar ? "التجاوز" : "Gap",
                  value:
                    row.varianceAmount > 0 ? fmtMoney(row.varianceAmount, row.currency, lang) : "—",
                  tone: row.varianceAmount > 0 ? "var(--danger)" : "var(--text-subtle)",
                },
              ].map((cell) => (
                <div key={cell.label}>
                  <div className="text-[9.5px] text-text-subtle">{cell.label}</div>
                  <div
                    className="num mt-0.5 truncate text-[12px] font-semibold"
                    style={{ color: cell.tone }}
                  >
                    {cell.value}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-2 truncate text-[10.5px] text-text-muted">
              <bdi>{row.salesperson || (ar ? "بدون موظف" : "No salesperson")}</bdi> ·{" "}
              {methodLabel(row.paymentMethod, lang)}
            </div>
          </button>
        );
      })}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-[12px]">
          <button
            type="button"
            disabled={offset <= 0}
            onClick={() => onOffset(Math.max(0, offset - PAGE_SIZE))}
            className="min-h-10 cursor-pointer rounded-lg border border-border px-3 font-medium disabled:opacity-40"
          >
            {ar ? "السابق" : "Previous"}
          </button>
          <span className="num text-text-muted">
            {Math.min(offset + 1, total)}–{Math.min(offset + PAGE_SIZE, total)} / {total}
          </span>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => onOffset(offset + PAGE_SIZE)}
            className="min-h-10 cursor-pointer rounded-lg border border-border px-3 font-medium disabled:opacity-40"
          >
            {ar ? "التالي" : "Next"}
          </button>
        </div>
      )}
    </div>
  );
}
