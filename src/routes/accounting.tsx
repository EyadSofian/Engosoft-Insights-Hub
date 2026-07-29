import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  BadgeDollarSign,
  Calculator,
  Download,
  FileSpreadsheet,
  GraduationCap,
  Info,
  ListChecks,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { SpendRevenueChart } from "@/components/charts";
import {
  CourseRevenueExplorer,
  type AccountingCourses,
} from "@/components/accounting/CourseRevenueExplorer";
import { DataTable, type Col } from "@/components/DataTable";
import {
  BarList,
  Card,
  ErrorState,
  KpiCard,
  Notice,
  PageHeader,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { fmtDate, fmtNum, fmtPct, fmtUSDExact, useI18n } from "@/lib/i18n";
import { filterStore, useFilters } from "@/lib/filter-store";
import { DEFAULT_FX_RATES } from "@/lib/fx-rates";
import type { DataHealth, GlobalFilters, Grouped, Totals } from "@/lib/types";
import { useModalGuard } from "@/lib/ui-store";
import { useApi } from "@/lib/use-api";

export const Route = createFileRoute("/accounting")({ component: Accounting });

interface AccountingDetail {
  id: string;
  movement: string;
  paymentDate: string;
  invoiceDate: string;
  partner: string;
  country: string;
  company: string;
  salesperson: string;
  salesTeam: string;
  code: string;
  productCode: string;
  quantity: number;
  product: string;
  productCategory: string;
  mainCategory: string;
  untaxedTotal: number;
  totalInCurrency: number;
  currency: string;
  companyCurrency: string;
  usdPaid: number;
  website: string;
  event: string;
  eventStage: string;
  source: string;
}

interface AccountingResponse {
  totals: Totals;
  summary: {
    paidUsd: number;
    invoices: number;
    productLines: number;
    averageInvoice: number | null;
  };
  byProduct: Grouped[];
  byProductCategory: Grouped[];
  byMainCategory: Grouped[];
  byCompany: Grouped[];
  byCurrency: Grouped[];
  byTeam: Grouped[];
  bySalesperson: Grouped[];
  byMonth: Grouped[];
  byDay: { date: string; spend: number; revenue: number }[];
  courses: AccountingCourses;
  detail: { rows: AccountingDetail[]; total: number; truncated: boolean };
  health: DataHealth;
  source: {
    tab: string;
    dateBasis: string;
    valueBasis: string;
    grain: string;
  };
  fxRates: {
    EGP: number;
    SAR: number;
  };
}

function Accounting() {
  const { t, lang } = useI18n();
  const filters = useFilters();
  const [exportOpen, setExportOpen] = useState(false);
  const [fxEgpInput, setFxEgpInput] = useState(filters.fxEgp ?? String(DEFAULT_FX_RATES.EGP));
  const [fxSarInput, setFxSarInput] = useState(filters.fxSar ?? String(DEFAULT_FX_RATES.SAR));
  const [fxError, setFxError] = useState("");
  const { data, isLoading, error, refetch } = useApi<AccountingResponse>("/api/accounting");

  useEffect(() => {
    filterStore.hydrateFx();
  }, []);

  useEffect(() => {
    setFxEgpInput(filters.fxEgp ?? String(DEFAULT_FX_RATES.EGP));
    setFxSarInput(filters.fxSar ?? String(DEFAULT_FX_RATES.SAR));
  }, [filters.fxEgp, filters.fxSar]);

  const applyFxRates = () => {
    const egp = Number(fxEgpInput);
    const sar = Number(fxSarInput);
    if (!Number.isFinite(egp) || egp <= 0 || !Number.isFinite(sar) || sar <= 0) {
      setFxError(lang === "ar" ? "أدخل سعرين أكبر من صفر." : "Enter two rates greater than zero.");
      return;
    }
    setFxError("");
    filterStore.setFxRates(egp, sar);
  };

  const resetFxRates = () => {
    setFxError("");
    setFxEgpInput(String(DEFAULT_FX_RATES.EGP));
    setFxSarInput(String(DEFAULT_FX_RATES.SAR));
    filterStore.setFxRates(DEFAULT_FX_RATES.EGP, DEFAULT_FX_RATES.SAR);
  };

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const cols: Col<AccountingDetail>[] = [
    {
      key: "movement",
      header: t("movement"),
      sticky: true,
      width: "150px",
      sortValue: (row) => row.movement,
      render: (row) => row.movement || "—",
    },
    {
      key: "paymentDate",
      header: t("payment_date"),
      sortValue: (row) => row.paymentDate,
      render: (row) => fmtDate(row.paymentDate, lang),
    },
    {
      key: "invoiceDate",
      header: t("invoice_date"),
      sortValue: (row) => row.invoiceDate,
      render: (row) => fmtDate(row.invoiceDate, lang),
    },
    {
      key: "partner",
      header: t("partner"),
      sortValue: (row) => row.partner,
      render: (row) => (
        <span className="block max-w-[180px] truncate" title={row.partner}>
          {row.partner || "—"}
        </span>
      ),
    },
    {
      key: "productCode",
      header: lang === "ar" ? "كود المنتج" : "Product code",
      sortValue: (row) => row.productCode,
      render: (row) => row.productCode || "—",
    },
    {
      key: "product",
      header: t("product"),
      sortValue: (row) => row.product,
      render: (row) => (
        <span className="block max-w-[220px] truncate" title={row.product}>
          {row.product || "—"}
        </span>
      ),
    },
    {
      key: "productCategory",
      header: t("product_category"),
      sortValue: (row) => row.productCategory,
      render: (row) => row.productCategory || "—",
    },
    {
      key: "quantity",
      header: lang === "ar" ? "الكمية" : "Quantity",
      align: "right",
      sortValue: (row) => row.quantity,
      render: (row) => <span className="num">{fmtNum(row.quantity)}</span>,
    },
    {
      key: "mainCategory",
      header: t("main_category"),
      sortValue: (row) => row.mainCategory,
      render: (row) => row.mainCategory || "—",
    },
    {
      key: "company",
      header: t("company"),
      sortValue: (row) => row.company,
      render: (row) => row.company || "—",
    },
    {
      key: "salesperson",
      header: t("salesperson"),
      sortValue: (row) => row.salesperson,
      render: (row) => row.salesperson || "—",
    },
    {
      key: "salesTeam",
      header: t("sales_team"),
      sortValue: (row) => row.salesTeam,
      render: (row) => row.salesTeam || "—",
    },
    {
      key: "untaxedTotal",
      header: t("untaxed_total"),
      align: "right",
      sortValue: (row) => row.untaxedTotal,
      render: (row) => (
        <span className="num whitespace-nowrap">
          {row.untaxedTotal.toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}
          <span className="text-[11px] text-text-muted">{row.companyCurrency || "—"}</span>
        </span>
      ),
    },
    {
      key: "totalInCurrency",
      header: t("total_in_currency"),
      align: "right",
      sortValue: (row) => row.totalInCurrency,
      render: (row) => (
        <span className="num whitespace-nowrap">
          {row.totalInCurrency.toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}
          <span className="text-[11px] text-text-muted">{row.currency}</span>
        </span>
      ),
    },
    {
      key: "usdPaid",
      header: t("usd_paid"),
      align: "right",
      sortValue: (row) => row.usdPaid,
      render: (row) => (
        <span
          className="num font-medium"
          style={row.usdPaid < 0 ? { color: "var(--danger)" } : undefined}
        >
          {fmtUSDExact(row.usdPaid)}
        </span>
      ),
    },
  ];
  const detailCols = data?.courses.summary.quantityAvailable
    ? cols
    : cols.filter((column) => column.key !== "quantity");

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("accounting")}
        subtitle={
          lang === "ar"
            ? `الفواتير المدفوعة على مستوى بند المنتج، مؤرخة بتاريخ الدفع.${filters.from && filters.to ? ` ${filters.from} → ${filters.to}` : ""}`
            : `Paid invoices at product-line grain, reported by Payment Date.${filters.from && filters.to ? ` ${filters.from} → ${filters.to}` : ""}`
        }
      />

      {isLoading || !data ? (
        <>
          <Skeleton className="h-28" />
          <Skeleton className="h-96" />
        </>
      ) : (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              <Download size={17} />
              {lang === "ar" ? "تصدير الحسابات كاملة" : "Export all Accounting"}
            </button>
          </div>

          <Card>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <div className="flex items-center gap-2 text-sm font-semibold text-text">
                  <BadgeDollarSign size={18} className="text-brand" />
                  {lang === "ar" ? "أسعار تحويل الحسابات إلى الدولار" : "Accounting USD conversion rates"}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
                  {lang === "ar"
                    ? "الحساب يتم من Total in Currency: الجنيه ÷ سعر الجنيه، والريال ÷ سعر الريال. التعديل يعيد حساب كل مؤشرات الحسابات والتصدير فورًا ويُحفظ على هذا الجهاز."
                    : "Calculated from Total in Currency: EGP ÷ EGP rate and SAR ÷ SAR rate. Applying a change refreshes every Accounting KPI and export and saves it on this device."}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[520px]">
                <label className="text-xs font-medium text-text-muted">
                  <span className="mb-1.5 block">
                    {lang === "ar" ? "1 دولار = جنيه مصري" : "1 USD = EGP"}
                  </span>
                  <input
                    type="number"
                    min="0.000001"
                    step="0.0001"
                    inputMode="decimal"
                    value={fxEgpInput}
                    onChange={(event) => setFxEgpInput(event.target.value)}
                    className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-end font-mono text-sm text-text outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
                  />
                </label>
                <label className="text-xs font-medium text-text-muted">
                  <span className="mb-1.5 block">
                    {lang === "ar" ? "1 دولار = ريال سعودي" : "1 USD = SAR"}
                  </span>
                  <input
                    type="number"
                    min="0.000001"
                    step="0.0001"
                    inputMode="decimal"
                    value={fxSarInput}
                    onChange={(event) => setFxSarInput(event.target.value)}
                    className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-end font-mono text-sm text-text outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                  <button
                    type="button"
                    onClick={applyFxRates}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                  >
                    {lang === "ar" ? "تطبيق وإعادة الحساب" : "Apply and recalculate"}
                  </button>
                  <button
                    type="button"
                    onClick={resetFxRates}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-text transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                  >
                    <RotateCcw size={15} />
                    {lang === "ar" ? "استرجاع 50.5 و3.7453" : "Restore 50.5 and 3.7453"}
                  </button>
                  <span className="text-xs text-text-muted">
                    {lang === "ar" ? "المطبّق الآن:" : "Applied now:"} 1 USD = {data.fxRates.EGP} EGP · {data.fxRates.SAR} SAR
                  </span>
                </div>
                {fxError && <p className="text-xs text-danger sm:col-span-2">{fxError}</p>}
              </div>
            </div>
          </Card>

          <Notice tone="info" title={t("data_notes")} icon={<Info size={16} />}>
            {lang === "ar"
              ? "المصدر المالي المعتمد: الفواتير المدفوعة فقط من تحليل الفواتير، حسب Payment Date. الإيراد هو USD Paid المحسوب من Total in Currency، وعدد الفواتير مميز حسب Move؛ ولا تدخل أوامر البيع المؤكدة أو تبويب Full Invoiced Orders في حساب الإيراد."
              : "Accounting authority: paid invoices only from invoice analysis, by Payment Date. Revenue is USD Paid calculated from Total in Currency, and invoice count is distinct Move; confirmed sales orders and Full Invoiced Orders are not revenue inputs."}
          </Notice>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              index={0}
              label={t("revenue")}
              value={fmtUSDExact(data.summary.paidUsd)}
              sub={lang === "ar" ? "USD Paid حسب Payment Date" : "USD Paid by Payment Date"}
              hero
            />
            <KpiCard index={1} label={t("invoices")} value={fmtNum(data.summary.invoices)} />
            <KpiCard
              index={2}
              label={t("product_lines")}
              value={fmtNum(data.summary.productLines)}
            />
            <KpiCard
              index={3}
              label={t("avg_invoice")}
              value={fmtUSDExact(data.summary.averageInvoice)}
            />
          </div>

          <Card>
            <SectionTitle>{t("by_day")}</SectionTitle>
            <SpendRevenueChart
              data={data.byDay}
              moneyFormat={fmtUSDExact}
            />
            <p className="mt-3 text-xs leading-relaxed text-text-muted">
              {lang === "ar"
                ? "الإنفاق من صفوف Meta وSnapchat وTikTok حسب تاريخ الإعلان؛ الإيراد من الفواتير المدفوعة حسب Payment Date."
                : "Spend comes from dated Meta, Snapchat, and TikTok rows; revenue comes from paid invoices by Payment Date."}
            </p>
          </Card>

          <CourseRevenueExplorer data={data.courses} />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Money title={t("main_category")} rows={data.byMainCategory} />
            <Money title={t("product_category")} rows={data.byProductCategory} />
            <Money title={t("product")} rows={data.byProduct} />
            <Money title={t("by_salesperson")} rows={data.bySalesperson} />
            <Money title={t("by_team")} rows={data.byTeam} />
            <Money title={t("company")} rows={data.byCompany} />
            <Money title={t("currency")} rows={data.byCurrency} />
          </div>

          <DataTable
            rows={data.detail.rows}
            cols={detailCols}
            searchable={(row) =>
              `${row.movement} ${row.partner} ${row.product} ${row.productCategory} ${row.mainCategory} ${row.company} ${row.salesperson} ${row.salesTeam}`
            }
            initialSort={{ key: "paymentDate", dir: -1 }}
            maxHeight={640}
            truncatedNote={
              data.detail.truncated
                ? `${t("showing")} ${fmtNum(data.detail.rows.length)} ${t("of")} ${fmtNum(data.detail.total)}`
                : undefined
            }
          />

          {exportOpen && (
            <AccountingExportDialog
              filters={filters}
              lang={lang}
              onClose={() => setExportOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

function Money({ title, rows }: { title: string; rows: Grouped[] }) {
  const items = [...rows].sort((a, b) => b.value - a.value).slice(0, 8);
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      <BarList
        items={items.map((row) => ({
          label: row.label,
          value: row.value,
          meta: (
            <span>
              <span className="num">{fmtUSDExact(row.value)}</span>
              <span className="num ms-1.5 text-[11px] text-text-muted">
                ({fmtPct(row.share, 1)})
              </span>
            </span>
          ),
        }))}
        format={fmtUSDExact}
        color="var(--chart-2)"
      />
    </Card>
  );
}

type AccountingExportView = "summary" | "invoices" | "lines" | "courses";

function exportHref(view: AccountingExportView, filters: GlobalFilters, lang: "ar" | "en") {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, String(value));
  }
  params.set("view", view);
  params.set("lang", lang);
  return `/api/accounting-export?${params.toString()}`;
}

function AccountingExportDialog({
  filters,
  lang,
  onClose,
}: {
  filters: GlobalFilters;
  lang: "ar" | "en";
  onClose: () => void;
}) {
  useModalGuard(true);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const options: {
    view: AccountingExportView;
    icon: typeof Calculator;
    title: string;
    description: string;
  }[] =
    lang === "ar"
      ? [
          {
            view: "summary",
            icon: Calculator,
            title: "ملخص الحسابات والمعادلات",
            description: "الإيراد، عدد الفواتير، المتوسط، وطريقة حساب كل مؤشر.",
          },
          {
            view: "invoices",
            icon: ReceiptText,
            title: "الفواتير المجمعة",
            description: "صف واحد لكل فاتورة مدفوعة مع إجمالياتها ومنتجاتها.",
          },
          {
            view: "lines",
            icon: ListChecks,
            title: "كل بنود الفواتير",
            description: "كل الصفوف بدون حد 3,000 صف وبدون أي أعمدة Sales Order.",
          },
          {
            view: "courses",
            icon: GraduationCap,
            title: "تحليل الكورسات والمنتجات",
            description: "الإيراد والنسب والأنواع والفعاليات لكل منتج داخل الكورس.",
          },
        ]
      : [
          {
            view: "summary",
            icon: Calculator,
            title: "Summary and formulas",
            description: "Revenue, invoice count, averages and every calculation rule.",
          },
          {
            view: "invoices",
            icon: ReceiptText,
            title: "Invoice-level export",
            description: "One row per paid invoice with its totals and products.",
          },
          {
            view: "lines",
            icon: ListChecks,
            title: "All invoice lines",
            description: "Every row with no 3,000-row cap and no Sales Order columns.",
          },
          {
            view: "courses",
            icon: GraduationCap,
            title: "Courses and products",
            description: "Revenue, shares, types and events for every invoiced product.",
          },
        ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,12,24,0.58)] p-3 backdrop-blur-[2px] animate-fade-in sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="accounting-export-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-semibold text-success">
              <ShieldCheck size={14} />
              {lang === "ar" ? "الفواتير المدفوعة فقط" : "Paid invoices only"}
            </div>
            <h2 id="accounting-export-title" className="text-lg font-semibold text-text">
              {lang === "ar" ? "تصدير الحسابات للمراجعة" : "Export Accounting for review"}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              {lang === "ar"
                ? "كل ملف يلتزم بالفترة والفلاتر المختارة حاليًا. لا تدخل أوامر البيع في أي رقم أو معادلة."
                : "Every file follows the current period and filters. Sales orders are excluded from every number and formula."}
            </p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-full text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            aria-label={lang === "ar" ? "إغلاق" : "Close"}
          >
            <X size={20} />
          </button>
        </header>

        <div className="grid max-h-[70vh] gap-3 overflow-y-auto p-4 sm:grid-cols-2 sm:p-6">
          {options.map((option) => {
            const Icon = option.icon;
            return (
              <a
                key={option.view}
                href={exportHref(option.view, filters, lang)}
                onClick={onClose}
                className="group flex min-h-32 items-start gap-3 rounded-xl border border-border p-4 text-start transition-colors hover:border-brand/40 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                  <Icon size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-text">{option.title}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-text-muted">
                    {option.description}
                  </span>
                  <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-brand">
                    <FileSpreadsheet size={14} />
                    {lang === "ar" ? "تنزيل CSV كامل" : "Download full CSV"}
                  </span>
                </span>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
