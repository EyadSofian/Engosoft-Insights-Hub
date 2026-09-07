import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  Building2,
  Calculator,
  CalendarDays,
  ChevronDown,
  Download,
  FileSpreadsheet,
  GraduationCap,
  Info,
  Layers,
  ListChecks,
  Receipt,
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
import {
  AccountingMonthlyView,
  AccountingProfitabilityView,
  type AccountingMonth,
} from "@/components/accounting/AccountingSubViews";
import { DataTable, type Col } from "@/components/DataTable";
import {
  BarList,
  Card,
  ErrorState,
  KpiCard,
  Notice,
  Segmented,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import {
  DashboardPageHeader,
  DataHealthSummary,
  KpiRow,
  PageSection,
  PageSections,
} from "@/components/dashboard-bits";
import { MetricDetailTrigger } from "@/components/metric-detail";
import type { MetricBreakdownGroup, MetricDetail } from "@/lib/metric-detail";
import { useReportingPeriod } from "@/lib/use-reporting-period";
import { fmtDate, fmtNum, fmtPct, fmtUSDExact, useI18n } from "@/lib/i18n";
import { filterStore, useFilters } from "@/lib/filter-store";
import { DEFAULT_FX_RATES } from "@/lib/fx-rates";
import type { DataHealth, GlobalFilters, Grouped, Totals } from "@/lib/types";
import { useModalGuard } from "@/lib/ui-store";
import { useApi } from "@/lib/use-api";
import { useFiltersData } from "@/components/TopBar";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";

export const Route = createFileRoute("/accounting")({ component: Accounting });

interface AccountingDetail {
  id: string;
  movement: string;
  orderRef: string;
  moveType: string;
  isCreditNote: boolean;
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
    creditNotes: number;
    creditNoteUsd: number;
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
  monthly: AccountingMonth[];
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
  const reportingPeriod = useReportingPeriod();
  const { t, lang } = useI18n();
  const filters = useFilters();
  const [exportOpen, setExportOpen] = useState(false);
  const [view, setView] = useState<"summary" | "months" | "profitability">("summary");

  /** Tell Nexus which view is open — the route does not change with the tab. */
  useRegisterNexusView("accounting", { tab: view });
  const [fxEgpInput, setFxEgpInput] = useState(filters.fxEgp ?? String(DEFAULT_FX_RATES.EGP));
  const [fxSarInput, setFxSarInput] = useState(filters.fxSar ?? String(DEFAULT_FX_RATES.SAR));
  const [fxError, setFxError] = useState("");
  const { data, isLoading, error, refetch } = useApi<AccountingResponse>("/api/accounting");
  const { data: filterOptions } = useFiltersData();
  const dateBasis = filters.dateBasis === "invoice" ? "invoice" : "payment";
  // Built once per response, not once per card: the five summary figures share
  // the same distributions and the same day series.
  const metrics = useMemo(() => (data ? accountingMetrics(data, lang) : null), [data, lang]);

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
      render: (row) => (
        <span className={row.isCreditNote ? "font-semibold text-danger" : undefined}>
          {row.movement || "—"}
        </span>
      ),
    },
    {
      key: "moveType",
      header: lang === "ar" ? "نوع المستند" : "Document type",
      sortValue: (row) => row.moveType,
      render: (row) =>
        row.isCreditNote ? (
          <span className="inline-flex rounded-full bg-danger/10 px-2 py-1 text-xs font-semibold text-danger">
            {lang === "ar" ? "إلغاء / إشعار خصم" : "Cancellation / credit note"}
          </span>
        ) : (
          <span className="text-xs text-text-muted">{lang === "ar" ? "فاتورة" : "Invoice"}</span>
        ),
    },
    {
      key: "orderRef",
      header: t("order_ref"),
      width: "130px",
      sortValue: (row) => row.orderRef,
      render: (row) => (
        <span className="num font-medium text-text" title={row.orderRef}>
          {row.orderRef || "—"}
        </span>
      ),
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
    <div className="page-sections">
      <DashboardPageHeader
        flush
        icon={<Receipt size={20} />}
        title={t("accounting")}
        subtitle={
          lang === "ar"
            ? `الفواتير المدفوعة على مستوى بند المنتج، حسب ${dateBasis === "invoice" ? "تاريخ الفاتورة" : "تاريخ الدفع"}`
            : `Paid invoices at product-line grain, reported by ${dateBasis === "invoice" ? "Invoice Date" : "Payment Date"}`
        }
        period={reportingPeriod}
      />

      {/* The reporting basis and the company scope are settings, not findings.
          They belong to the report and must stay reachable, but they were
          taking the first screen ahead of every figure, so they now open on
          demand with their current values named on the closed summary. */}
      <details className="group card overflow-hidden">
        <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden sm:px-5">
          <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-text">
            <CalendarDays size={16} className="text-brand" />
            {lang === "ar" ? "أساس التقرير ونطاق الشركة" : "Reporting basis and company scope"}
          </span>
          <span className="text-[11.5px] text-text-muted">
            {dateBasis === "invoice"
              ? lang === "ar"
                ? "تاريخ الفاتورة"
                : "Invoice Date"
              : lang === "ar"
                ? "تاريخ الدفع"
                : "Payment Date"}
            {" · "}
            {filters.company || (lang === "ar" ? "كل الشركات" : "All companies")}
          </span>
          <ChevronDown
            size={16}
            className="ms-auto shrink-0 text-text-muted transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="grid gap-4 border-t border-border p-3.5 sm:p-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(220px,.75fr)_auto] lg:items-end">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-text">
              <CalendarDays size={15} className="text-brand" />
              {lang === "ar" ? "أساس تاريخ الحسابات" : "Accounting date basis"}
            </div>
            <Segmented
              value={dateBasis}
              onChange={(value) =>
                filterStore.set({
                  dateBasis: value === "invoice" ? "invoice" : undefined,
                })
              }
              size="md"
              options={[
                {
                  value: "payment",
                  label: lang === "ar" ? "تاريخ الدفع — الافتراضي" : "Payment Date — default",
                },
                {
                  value: "invoice",
                  label: lang === "ar" ? "تاريخ الفاتورة" : "Invoice Date",
                },
              ]}
            />
          </div>

          <label className="block">
            <span className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-text">
              <Building2 size={15} className="text-brand" />
              {lang === "ar" ? "شركة الفاتورة" : "Invoice company"}
            </span>
            <select
              value={filters.company ?? ""}
              onChange={(event) => filterStore.set({ company: event.target.value || undefined })}
              className="min-h-11 w-full cursor-pointer rounded-xl border border-border bg-surface px-3 text-sm text-text outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15"
            >
              <option value="">{lang === "ar" ? "كل الشركات" : "All companies"}</option>
              {(filterOptions?.companies ?? []).map((company) => (
                <option key={company} value={company}>
                  {company}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-xl bg-surface-2 px-3 py-2.5 text-xs text-text-muted">
            <div className="font-semibold text-text">
              {filters.company || (lang === "ar" ? "كل الشركات" : "All companies")}
            </div>
            <div className="mt-1">
              {dateBasis === "invoice"
                ? lang === "ar"
                  ? "الفترة تُطبّق على تاريخ الفاتورة"
                  : "Range applies to Invoice Date"
                : lang === "ar"
                  ? "الفترة على تاريخ الدفع الفعلي، مش Due Date"
                  : "Range uses the actual Payment Date, never Due Date"}
            </div>
          </div>
        </div>
      </details>

      <div className="hscroll bleed-x [--bleed:0.875rem] sm:[--bleed:0px] pb-1">
        <Segmented
          value={view}
          onChange={setView}
          size="md"
          options={[
            {
              value: "summary",
              label: lang === "ar" ? "ملخص الحسابات" : "Accounting summary",
            },
            {
              value: "months",
              label: lang === "ar" ? "مقارنة الشهور" : "Monthly comparison",
            },
            {
              value: "profitability",
              label: lang === "ar" ? "الربحية" : "Profitability",
            },
          ]}
        />
      </div>

      {isLoading || !data ? (
        <>
          <Skeleton className="h-28" />
          <Skeleton className="h-96" />
        </>
      ) : (
        <>
          {view === "summary" && (
            <>
              <KpiRow>
                <MetricDetailTrigger
                  detail={{ ...metrics!.revenue, title: t("revenue") }}
                  card={{
                    index: 0,
                    hero: true,
                    valueWrap: true,
                    sub: lang === "ar" ? "USD Paid حسب Payment Date" : "USD Paid by Payment Date",
                  }}
                />
                <MetricDetailTrigger
                  detail={{ ...metrics!.invoices, title: t("invoices") }}
                  card={{ index: 1 }}
                />
                <MetricDetailTrigger
                  detail={{ ...metrics!.average, title: t("avg_invoice") }}
                  card={{ index: 2, valueWrap: true }}
                />
                <MetricDetailTrigger
                  detail={{ ...metrics!.lines, title: t("product_lines") }}
                  card={{ index: 3 }}
                />
                <MetricDetailTrigger
                  detail={metrics!.credits}
                  card={{ index: 4, valueWrap: true, sub: fmtUSDExact(data.summary.creditNoteUsd) }}
                />
              </KpiRow>

              <details className="group card overflow-hidden">
                <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden sm:px-5">
                  <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-text">
                    <BadgeDollarSign size={16} className="text-brand" />
                    {lang === "ar" ? "أسعار التحويل والتصدير" : "Conversion rates and export"}
                  </span>
                  <span className="num text-[11.5px] text-text-muted">
                    1 USD = {data.fxRates.EGP} EGP · {data.fxRates.SAR} SAR
                  </span>
                  <span className="ms-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        setExportOpen(true);
                      }}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[12px] font-semibold text-text transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      <Download size={15} />
                      {lang === "ar" ? "تصدير الحسابات كاملة" : "Export all Accounting"}
                    </button>
                    <ChevronDown
                      size={16}
                      className="shrink-0 text-text-muted transition-transform group-open:rotate-180"
                    />
                  </span>
                </summary>
                <div className="border-t border-border p-3.5 sm:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-2xl">
                      <div className="flex items-center gap-2 text-sm font-semibold text-text">
                        <BadgeDollarSign size={18} className="text-brand" />
                        {lang === "ar"
                          ? "أسعار تحويل الحسابات إلى الدولار"
                          : "Accounting USD conversion rates"}
                      </div>
                      <p className="mt-1.5 hidden text-xs leading-relaxed text-text-muted sm:block">
                        {lang === "ar"
                          ? "الحساب يتم من Total in Currency: الجنيه ÷ سعر الجنيه، والريال ÷ سعر الريال. التعديل يعيد حساب كل مؤشرات الحسابات والتصدير فورًا ويُحفظ على هذا الجهاز."
                          : "Calculated from Total in Currency: EGP ÷ EGP rate and SAR ÷ SAR rate. Applying a change refreshes every Accounting KPI and export and saves it on this device."}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:min-w-[520px]">
                      <label className="text-[11px] font-medium text-text-muted sm:text-xs">
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
                      <label className="text-[11px] font-medium text-text-muted sm:text-xs">
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
                      <div className="col-span-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={applyFxRates}
                          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-brand px-3 py-2 text-[12px] font-semibold text-white transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 sm:flex-none sm:px-4 sm:text-sm"
                        >
                          {lang === "ar" ? "تطبيق وإعادة الحساب" : "Apply and recalculate"}
                        </button>
                        <button
                          type="button"
                          onClick={resetFxRates}
                          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-[12px] font-medium text-text transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 sm:flex-none sm:px-4 sm:text-sm"
                        >
                          <RotateCcw size={15} />
                          {lang === "ar" ? "استرجاع 50.5 و3.7453" : "Restore 50.5 and 3.7453"}
                        </button>
                        <span className="w-full text-[10.5px] text-text-muted sm:w-auto sm:text-xs">
                          {lang === "ar" ? "المطبّق الآن:" : "Applied now:"} 1 USD ={" "}
                          {data.fxRates.EGP} EGP · {data.fxRates.SAR} SAR
                        </span>
                      </div>
                      {fxError && <p className="text-xs text-danger sm:col-span-2">{fxError}</p>}
                    </div>
                  </div>
                </div>
              </details>

              <DataHealthSummary
                issues={[
                  {
                    tone: "info",
                    message:
                      lang === "ar"
                        ? "الإيراد هنا هو الفواتير المدفوعة فعلياً، وليس ما تم إصداره."
                        : "Revenue here is invoices actually paid, not invoices issued.",
                    impact:
                      lang === "ar"
                        ? "الإلغاءات تظهر بالسالب في شهر الإلغاء، وأوامر البيع المؤكدة لا تدخل في الإيراد."
                        : "Cancellations appear as negatives in their reversal month, and confirmed sales orders are excluded.",
                    technical:
                      lang === "ar"
                        ? "الفاتورة الموجبة حسب Payment Date، والإلغاء بالسالب حسب Reversal/Invoice Date. الإيراد بالدولار محسوب من Total in Currency."
                        : "Positive invoices follow Payment Date; cancellations are negative on Reversal/Invoice Date. USD revenue is derived from Total in Currency.",
                  },
                ]}
              />

              <Card>
                <SectionTitle>{t("by_day")}</SectionTitle>
                <SpendRevenueChart data={data.byDay} moneyFormat={fmtUSDExact} />
                <p className="mt-3 text-xs leading-relaxed text-text-muted">
                  {lang === "ar"
                    ? "الإنفاق حسب تاريخ الإعلان؛ الفواتير الموجبة حسب Payment Date، والإلغاءات بالسالب في تاريخ عكس الفاتورة."
                    : "Spend follows ad date; positive invoices follow Payment Date and cancellations are negative on their reversal date."}
                </p>
              </Card>

              <CourseRevenueExplorer data={data.courses} />

              <div className="card-grid md:grid-cols-2 xl:grid-cols-3">
                <Money title={t("main_category")} rows={data.byMainCategory} />
                <Money title={t("product_category")} rows={data.byProductCategory} />
                <Money title={t("product")} rows={data.byProduct} />
                <Money title={t("by_salesperson")} rows={data.bySalesperson} />
                <Money title={t("by_team")} rows={data.byTeam} />
                <Money title={t("company")} rows={data.byCompany} />
                <Money title={t("currency")} rows={data.byCurrency} />
              </div>

              <Notice icon={<Info size={17} />}>
                {lang === "ar"
                  ? "تقدر تبحث برقم أمر البيع مثل S18401 أو برقم الفاتورة. الوضع الافتراضي يعرض المستند في Payment Date الموجود داخل حركة السداد في Odoo — مش Due Date — وممكن يكون قبل تاريخ الفاتورة لو العميل دفع مقدّمًا."
                  : "Search by Sales Order (for example S18401) or invoice number. The default view uses the Payment Date inside the Odoo payment movement—not Due Date—and it can precede the invoice when the customer prepaid."}
              </Notice>

              <DataTable
                rows={data.detail.rows}
                cols={detailCols}
                searchable={(row) =>
                  `${row.movement} ${row.orderRef} ${row.partner} ${row.product} ${row.productCategory} ${row.mainCategory} ${row.company} ${row.salesperson} ${row.salesTeam}`
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

          {view === "months" && <AccountingMonthlyView monthly={data.monthly} />}
          {view === "profitability" && <AccountingProfitabilityView />}
        </>
      )}
    </div>
  );
}

/** A money distribution the response already carried, as a drill-down section. */
function moneySection(
  id: string,
  title: string,
  rows: Grouped[],
  lang: "ar" | "en",
  tone: MetricBreakdownGroup["rows"][number]["tone"] = "mint",
): MetricBreakdownGroup {
  return {
    id,
    title,
    rows: [...rows]
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map((row) => ({
        key: row.label,
        label: row.label,
        value: row.value,
        display: fmtUSDExact(row.value),
        meta: fmtPct(row.share, 1),
        tone,
      })),
    emptyLabel: lang === "ar" ? "لا توجد بيانات في الفترة" : "Nothing in this period",
  };
}

/**
 * The accounting summary's five figures, and what each is made of.
 *
 * Everything here comes from the same response the cards render — the product,
 * team, salesperson and company splits, and the day-by-day collection series —
 * so a reader who opens "collected revenue" sees the very rows that produced
 * the number above their finger.
 */
function accountingMetrics(
  data: AccountingResponse,
  lang: "ar" | "en",
): Record<string, MetricDetail> {
  const A = lang === "ar";
  const S = data.summary;
  const collectionTrend = data.byDay
    .filter((row) => Number.isFinite(row.revenue))
    .map((row) => ({ date: row.date, value: row.revenue }));

  const revenue: MetricDetail = {
    id: "accounting.revenue",
    title: A ? "الإيراد المحصّل" : "Collected revenue",
    value: fmtUSDExact(S.paidUsd),
    tone: "mint",
    icon: <BadgeDollarSign size={16} />,
    definition: A
      ? "المبالغ المدفوعة فعليًا خلال الفترة، محسوبة بتاريخ الدفع من عمود USD Paid. الفاتورة التي صدرت ولم تُدفع بعد لا تدخل هنا."
      : "Money actually collected in the period, counted on payment date from the USD Paid column. An invoice raised but not yet paid is not in this figure.",
    formula: A
      ? "مجموع USD Paid لكل فاتورة يقع تاريخ دفعها داخل الفترة المحددة، بعد خصم إشعارات الخصم."
      : "Sum of USD Paid for every invoice whose payment date falls inside the window, credit notes deducted.",
    trend:
      collectionTrend.length > 1
        ? {
            points: collectionTrend,
            label: A ? "حركة التحصيل اليومية" : "Daily collection",
            format: fmtUSDExact,
          }
        : undefined,
    supporting: [
      { key: "invoices", label: A ? "عدد الفواتير" : "Invoices", value: fmtNum(S.invoices) },
      {
        key: "avg",
        label: A ? "متوسط الفاتورة" : "Average invoice",
        value: fmtUSDExact(S.averageInvoice),
      },
      { key: "lines", label: A ? "بنود المنتجات" : "Product lines", value: fmtNum(S.productLines) },
      {
        key: "credit",
        label: A ? "إشعارات خصم" : "Credit notes",
        value: fmtUSDExact(S.creditNoteUsd),
      },
    ],
    breakdowns: [
      moneySection(
        "courses",
        A ? "حسب التصنيف الرئيسي" : "By main category",
        data.byMainCategory,
        lang,
        "amber",
      ),
      moneySection("products", A ? "حسب المنتج" : "By product", data.byProduct, lang),
      moneySection(
        "salespeople",
        A ? "حسب الموظف" : "By salesperson",
        data.bySalesperson,
        lang,
        "violet",
      ),
      moneySection("teams", A ? "حسب الفريق" : "By team", data.byTeam, lang, "cyan"),
    ],
    records: {
      title: A ? "حسب الشركة والعملة" : "By company and currency",
      rows: [
        ...data.byCompany.slice(0, 3).map((row) => ({
          key: `company-${row.label}`,
          title: row.label,
          subtitle: A ? "شركة" : "Company",
          value: fmtUSDExact(row.value),
          meta: fmtPct(row.share, 1),
        })),
        ...data.byCurrency.slice(0, 2).map((row) => ({
          key: `currency-${row.label}`,
          title: row.label,
          subtitle: A ? "عملة الفاتورة" : "Invoice currency",
          value: fmtUSDExact(row.value),
          meta: fmtPct(row.share, 1),
        })),
      ],
    },
  };

  const invoices: MetricDetail = {
    id: "accounting.invoices",
    title: A ? "عدد الفواتير" : "Invoices",
    value: fmtNum(S.invoices),
    tone: "sky",
    icon: <Receipt size={16} />,
    definition: A
      ? "عدد الفواتير المدفوعة المميزة في الفترة. الفاتورة الواحدة قد تحمل أكثر من بند منتج."
      : "Distinct paid invoices in the period. One invoice can carry more than one product line.",
    formula: A
      ? `${fmtNum(S.invoices)} فاتورة تحمل ${fmtNum(S.productLines)} بند منتج، بمتوسط ${fmtUSDExact(S.averageInvoice)} للفاتورة.`
      : `${fmtNum(S.invoices)} invoices carrying ${fmtNum(S.productLines)} product lines, averaging ${fmtUSDExact(S.averageInvoice)} each.`,
    supporting: [
      { key: "revenue", label: A ? "الإيراد" : "Revenue", value: fmtUSDExact(S.paidUsd) },
      { key: "lines", label: A ? "بنود المنتجات" : "Product lines", value: fmtNum(S.productLines) },
      {
        key: "avg",
        label: A ? "متوسط الفاتورة" : "Average invoice",
        value: fmtUSDExact(S.averageInvoice),
      },
      { key: "credit", label: A ? "إشعارات خصم" : "Credit notes", value: fmtNum(S.creditNotes) },
    ],
    breakdowns: [
      {
        id: "salespeople",
        title: A ? "عدد البنود حسب الموظف" : "Lines by salesperson",
        rows: [...data.bySalesperson]
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
          .map((row) => ({
            key: row.label,
            label: row.label,
            value: row.count,
            display: fmtNum(row.count),
            meta: fmtUSDExact(row.value),
            tone: "sky" as const,
          })),
        emptyLabel: A ? "لا توجد بيانات في الفترة" : "Nothing in this period",
      },
    ],
  };

  const average: MetricDetail = {
    id: "accounting.average",
    title: A ? "متوسط الفاتورة" : "Average invoice",
    value: fmtUSDExact(S.averageInvoice),
    tone: "violet",
    icon: <Calculator size={16} />,
    definition: A
      ? "متوسط قيمة الفاتورة المدفوعة في الفترة. متوسط مرتفع مع عدد فواتير منخفض يعني اعتمادًا على صفقات قليلة كبيرة."
      : "The average value of a paid invoice in the period. A high average on few invoices means the month rests on a small number of large deals.",
    formula: A
      ? `${fmtUSDExact(S.paidUsd)} ÷ ${fmtNum(S.invoices)} فاتورة = ${fmtUSDExact(S.averageInvoice)}.`
      : `${fmtUSDExact(S.paidUsd)} ÷ ${fmtNum(S.invoices)} invoices = ${fmtUSDExact(S.averageInvoice)}.`,
    supporting: [
      {
        key: "revenue",
        label: A ? "البسط · الإيراد" : "Numerator · revenue",
        value: fmtUSDExact(S.paidUsd),
      },
      {
        key: "invoices",
        label: A ? "المقام · الفواتير" : "Denominator · invoices",
        value: fmtNum(S.invoices),
      },
      { key: "lines", label: A ? "بنود المنتجات" : "Product lines", value: fmtNum(S.productLines) },
      {
        key: "perLine",
        label: A ? "متوسط البند" : "Average line",
        value: S.productLines > 0 ? fmtUSDExact(S.paidUsd / S.productLines) : "—",
      },
    ],
    breakdowns: [
      moneySection(
        "products",
        A ? "أعلى المنتجات قيمة" : "Highest-value products",
        data.byProduct,
        lang,
        "violet",
      ),
    ],
  };

  const lines: MetricDetail = {
    id: "accounting.lines",
    title: A ? "بنود المنتجات" : "Product lines",
    value: fmtNum(S.productLines),
    tone: "cyan",
    icon: <Layers size={16} />,
    definition: A
      ? "عدد بنود المنتجات داخل الفواتير المدفوعة. هذا هو المستوى الذي تُنسب عنده الدورة والمنتج، لا مستوى الفاتورة."
      : "Product lines inside the paid invoices. This is the level at which a course and a product are attributed — not the invoice.",
    formula: A
      ? `${fmtNum(S.productLines)} بند داخل ${fmtNum(S.invoices)} فاتورة.`
      : `${fmtNum(S.productLines)} lines inside ${fmtNum(S.invoices)} invoices.`,
    supporting: [
      { key: "invoices", label: A ? "الفواتير" : "Invoices", value: fmtNum(S.invoices) },
      {
        key: "perInvoice",
        label: A ? "بنود لكل فاتورة" : "Lines per invoice",
        value: S.invoices > 0 ? (S.productLines / S.invoices).toFixed(2) : "—",
      },
      { key: "revenue", label: A ? "الإيراد" : "Revenue", value: fmtUSDExact(S.paidUsd) },
      {
        key: "categories",
        label: A ? "تصنيفات رئيسية" : "Main categories",
        value: fmtNum(data.byMainCategory.length),
      },
    ],
    breakdowns: [
      moneySection(
        "categories",
        A ? "حسب فئة المنتج" : "By product category",
        data.byProductCategory,
        lang,
        "cyan",
      ),
    ],
  };

  const credits: MetricDetail = {
    id: "accounting.credits",
    title: A ? "إلغاءات / إشعارات خصم" : "Cancellations / credit notes",
    value: fmtNum(S.creditNotes),
    tone: S.creditNotes > 0 ? "rose" : "amber",
    icon: <RotateCcw size={16} />,
    definition: A
      ? "الفواتير التي أُلغيت أو صدر لها إشعار خصم داخل الفترة. قيمتها مخصومة بالفعل من الإيراد المعروض."
      : "Invoices cancelled or credited inside the period. Their value is already deducted from the revenue shown.",
    formula: A
      ? `${fmtNum(S.creditNotes)} إشعار بقيمة ${fmtUSDExact(S.creditNoteUsd)}، مخصومة من ${fmtUSDExact(S.paidUsd + S.creditNoteUsd)} إجمالي محصّل قبل الخصم.`
      : `${fmtNum(S.creditNotes)} notes worth ${fmtUSDExact(S.creditNoteUsd)}, deducted from ${fmtUSDExact(S.paidUsd + S.creditNoteUsd)} collected before the deduction.`,
    supporting: [
      {
        key: "value",
        label: A ? "قيمة الإشعارات" : "Credit value",
        value: fmtUSDExact(S.creditNoteUsd),
      },
      {
        key: "net",
        label: A ? "الإيراد بعد الخصم" : "Revenue after deduction",
        value: fmtUSDExact(S.paidUsd),
      },
      { key: "invoices", label: A ? "الفواتير" : "Invoices", value: fmtNum(S.invoices) },
      {
        key: "share",
        label: A ? "نسبتها من التحصيل" : "Share of collection",
        value: S.paidUsd > 0 ? fmtPct((S.creditNoteUsd / S.paidUsd) * 100, 1) : "—",
      },
    ],
  };

  return { revenue, invoices, average, lines, credits };
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
            description: "كل الصفوف بدون حد 3,000 صف، ومعها رقم أمر البيع للبحث والمراجعة.",
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
            description: "Every row with no 3,000-row cap, including its Sales Order reference.",
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

        <div className="grid max-h-[70dvh] gap-3 overflow-y-auto p-4 sm:grid-cols-2 sm:p-6">
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
