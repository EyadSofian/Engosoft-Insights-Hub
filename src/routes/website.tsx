import { createFileRoute } from "@tanstack/react-router";
import {
  Banknote,
  CircleCheckBig,
  CircleDot,
  CircleX,
  Clock3,
  GitMerge,
  Globe2,
} from "lucide-react";
import { DataTable, type Col } from "@/components/DataTable";
import {
  BarList,
  Card,
  ErrorState,
  KpiCard,
  PageHeader,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { fmtDate, fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";

export const Route = createFileRoute("/website")({ component: Website });

interface SpecialtyRow {
  specialty: string;
  total: number;
  won: number;
  lost: number;
  open: number;
  notContacted: number;
  conversionRate: number | null;
  lostRate: number | null;
  sales: number;
  quantity: number;
  salesOrders: number;
}

interface ContactRow {
  createdAt: string;
  contact: string;
  course: string;
  stage: string;
  salesperson: string;
  callingReply: string;
  lastStageUpdate: string;
  waitingSince: string;
  daysWaiting: number;
}

interface SalesOrderRow {
  orderRef: string;
  saleDate: string;
  customer: string;
  courses: string;
  salesperson: string;
  currency: string;
  localTotal: number;
  usdSales: number;
  source: string;
  externalPrice: number;
  externalCurrency: string;
  externalSalesSource: string;
  externalPhone: string;
  reconciliationStatus: string;
  priceDifference: number | null;
}

interface Resp {
  totals: {
    leads: number;
    won: number;
    lost: number;
    open: number;
    notContacted: number;
    sales: number;
    salesOrders: number;
    soldCourses: number;
    unsoldCourses: number;
    averageOrder: number | null;
  };
  specialties: SpecialtyRow[];
  waitingBuckets: { label: string; count: number }[];
  soldCourses: { label: string; value: number; orders: number; quantity: number }[];
  unsoldCourses: {
    label: string;
    leads: number;
    open: number;
    lost: number;
    notContacted: number;
  }[];
  insights: {
    bestSellingCourse: { label: string; value: number; orders: number } | null;
    highestDemandUnsoldCourse: { label: string; leads: number; open: number } | null;
    conversionRate: number | null;
    averageOrder: number | null;
  };
  reconciliation: {
    totalOrders: number;
    odooOnlyOrders: number;
    matchedOrders: number;
    externalOnlyOrders: number;
    discrepancyOrders: number;
    externalOnlySales: number;
  };
  salesDetail: { rows: SalesOrderRow[]; total: number; truncated: boolean };
  detail: { rows: ContactRow[]; total: number; truncated: boolean };
  asOf: string;
}

const fmtAmount = (value: number) =>
  value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function Website() {
  const { t, lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/website");
  const copy =
    lang === "ar"
      ? {
          subtitle: "تحليل ليدز الموقع ومبيعاته الموحّدة من Odoo وشيت المبيعات الإضافي",
          sourceNote:
            "المصدر: ليدز الموقع من Odoo CRM. المبيعات تُدمج حسب Order ID بين Odoo وشيت Website Sales الخارجي؛ الأوردر المتطابق لا يُحسب مرتين، والجديد فقط يُضاف للإيراد. بيانات Meta وSnap غير مستخدمة هنا.",
          orders: "أوامر بيع",
          quickAnalysis: "ملخص تنفيذي",
          bestSelling: "الأكثر مبيعًا",
          unsoldDemand: "أعلى طلب بدون بيع",
          averageOrder: "متوسط أمر البيع",
          noData: "لا توجد بيانات كافية في الفترة المحددة",
          soldCourses: "الكورسات المباعة من الموقع",
          soldHint: "حسب تاريخ الدفع عند توفره، وإلا تاريخ المصدر/الأوردر، بعد منع تكرار Order ID",
          unsoldCourses: "كورسات عليها طلب ولم تُبع",
          unsoldHint: "وصلت لها Website Leads في الفترة، لكن لا يوجد لها Sales Order مؤكد",
          leads: "ليد",
          open: "مفتوح",
          lost: "مفقود",
          specialtyNote: "يجمع ليدز CRM ومبيعات الموقع الموحّدة حسب الكورس",
          reconciliation: "مطابقة مصادر المبيعات",
          reconciliationHint: "Odoo + شيت Website Sales الخارجي حسب Order ID",
          matchedOrders: "متطابق بين المصدرين",
          externalOnlyOrders: "إضافي من الشيت",
          discrepancyOrders: "يحتاج مراجعة",
          salesDetails: "تفاصيل أوردرات مبيعات الموقع",
          salesDetailsHint: "صف واحد لكل أوردر بعد الدمج ومنع التكرار",
          source: "مصدر السجل",
          externalReference: "مرجع الشيت الخارجي",
          reconciliationStatus: "حالة المطابقة",
          localAmount: "المبلغ بالعملة",
          orderId: "رقم الأوردر",
        }
      : {
          subtitle:
            "Engosoft website leads and reconciled sales from Odoo and the external sales sheet",
          sourceNote:
            "Source: Odoo CRM website leads. Sales are reconciled by Order ID across Odoo and the external Website Sales sheet; matched orders are never counted twice, and only external-only orders add revenue. Meta and Snap are not used here.",
          orders: "sales orders",
          quickAnalysis: "Executive summary",
          bestSelling: "Best-selling course",
          unsoldDemand: "Highest demand without a sale",
          averageOrder: "Average sales order",
          noData: "Not enough data in the selected period",
          soldCourses: "Courses sold on the website",
          soldHint:
            "Payment date when available, otherwise source/order date, after Order-ID deduplication",
          unsoldCourses: "Courses with demand but no sale",
          unsoldHint: "Website leads exist in the period, but no confirmed sales order exists",
          leads: "leads",
          open: "open",
          lost: "lost",
          specialtyNote: "Combines Odoo CRM website leads and reconciled website sales by course",
          reconciliation: "Sales-source reconciliation",
          reconciliationHint: "Odoo + external Website Sales sheet matched by Order ID",
          matchedOrders: "Matched across both sources",
          externalOnlyOrders: "Added from external sheet",
          discrepancyOrders: "Needs review",
          salesDetails: "Website sales-order details",
          salesDetailsHint: "One row per order after source reconciliation and deduplication",
          source: "Record source",
          externalReference: "External-sheet reference",
          reconciliationStatus: "Reconciliation status",
          localAmount: "Amount in currency",
          orderId: "Order ID",
        };

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const specialtyCols: Col<SpecialtyRow>[] = [
    {
      key: "specialty",
      header: t("course"),
      sticky: true,
      sortValue: (r) => r.specialty,
      render: (r) => r.specialty,
    },
    {
      key: "total",
      header: t("leads_count"),
      align: "right",
      sortValue: (r) => r.total,
      render: (r) => fmtNum(r.total),
    },
    {
      key: "won",
      header: t("won"),
      align: "right",
      sortValue: (r) => r.won,
      render: (r) => fmtNum(r.won),
    },
    {
      key: "lost",
      header: t("lost_count"),
      align: "right",
      sortValue: (r) => r.lost,
      render: (r) => fmtNum(r.lost),
    },
    {
      key: "open",
      header: t("open_leads"),
      align: "right",
      sortValue: (r) => r.open,
      render: (r) => fmtNum(r.open),
    },
    {
      key: "notContacted",
      header: t("not_contacted"),
      align: "right",
      sortValue: (r) => r.notContacted,
      render: (r) => fmtNum(r.notContacted),
    },
    {
      key: "conversionRate",
      header: t("conversion_rate"),
      align: "right",
      sortValue: (r) => r.conversionRate ?? -1,
      render: (r) => fmtPct(r.conversionRate, 1),
    },
    {
      key: "sales",
      header: t("website_sales"),
      align: "right",
      sortValue: (r) => r.sales,
      render: (r) => fmtUSD(r.sales),
    },
  ];

  const contactCols: Col<ContactRow>[] = [
    {
      key: "waitingSince",
      header: t("waiting_since"),
      sticky: true,
      width: "120px",
      sortValue: (r) => r.waitingSince,
      render: (r) => fmtDate(r.waitingSince, lang),
    },
    {
      key: "daysWaiting",
      header: t("waiting_days"),
      align: "right",
      sortValue: (r) => r.daysWaiting,
      render: (r) => `${fmtNum(r.daysWaiting)} ${t("days")}`,
    },
    {
      key: "contact",
      header: t("contact"),
      sortValue: (r) => r.contact,
      render: (r) => r.contact || "—",
    },
    {
      key: "course",
      header: t("course"),
      sortValue: (r) => r.course,
      render: (r) => r.course || "—",
    },
    {
      key: "stage",
      header: t("stage"),
      sortValue: (r) => r.stage,
      render: (r) => <Pill tone="warning">{r.stage || "—"}</Pill>,
    },
    {
      key: "salesperson",
      header: t("salesperson"),
      sortValue: (r) => r.salesperson,
      render: (r) => r.salesperson || "—",
    },
    {
      key: "callingReply",
      header: t("calling_reply"),
      sortValue: (r) => r.callingReply,
      render: (r) => r.callingReply || "—",
    },
  ];

  const salesCols: Col<SalesOrderRow>[] = [
    {
      key: "saleDate",
      header: t("date"),
      width: "120px",
      sortValue: (r) => r.saleDate,
      render: (r) => fmtDate(r.saleDate, lang),
    },
    {
      key: "orderRef",
      header: copy.orderId,
      sticky: true,
      sortValue: (r) => r.orderRef,
      render: (r) => r.orderRef || "—",
    },
    {
      key: "customer",
      header: t("partner"),
      sortValue: (r) => r.customer,
      render: (r) => r.customer || "—",
    },
    {
      key: "courses",
      header: t("course"),
      sortValue: (r) => r.courses,
      render: (r) => r.courses || "—",
    },
    {
      key: "salesperson",
      header: t("salesperson"),
      sortValue: (r) => r.salesperson,
      render: (r) => r.salesperson || "—",
    },
    {
      key: "localTotal",
      header: copy.localAmount,
      align: "right",
      sortValue: (r) => r.localTotal,
      render: (r) => `${fmtAmount(r.localTotal)} ${r.currency}`,
    },
    {
      key: "usdSales",
      header: t("website_sales"),
      align: "right",
      sortValue: (r) => r.usdSales,
      render: (r) => fmtUSD(r.usdSales),
    },
    {
      key: "source",
      header: copy.source,
      sortValue: (r) => r.source,
      render: (r) => (
        <Pill
          tone={
            r.source === "External Google Sheet"
              ? "brand"
              : r.source === "Odoo + External Google Sheet"
                ? "success"
                : "neutral"
          }
        >
          {r.source || "Odoo"}
        </Pill>
      ),
    },
    {
      key: "externalPrice",
      header: copy.externalReference,
      align: "right",
      sortValue: (r) => r.externalPrice,
      render: (r) =>
        r.externalPrice ? `${fmtAmount(r.externalPrice)} ${r.externalCurrency}` : "—",
    },
    {
      key: "reconciliationStatus",
      header: copy.reconciliationStatus,
      sortValue: (r) => r.reconciliationStatus,
      render: (r) => (
        <Pill tone={/mismatch/i.test(r.reconciliationStatus) ? "danger" : "neutral"}>
          {r.reconciliationStatus || "—"}
        </Pill>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t("website")} subtitle={copy.subtitle} />

      {isLoading || !data ? (
        <>
          <Skeleton className="h-28" />
          <Skeleton className="h-80" />
        </>
      ) : (
        <>
          <div className="rounded-xl border border-brand/20 bg-brand-soft px-4 py-3 text-xs text-text-muted leading-relaxed">
            {copy.sourceNote}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard
              index={0}
              label={t("website_leads")}
              value={fmtNum(data.totals.leads)}
              icon={<Globe2 size={18} />}
            />
            <KpiCard
              index={1}
              label={t("won")}
              value={fmtNum(data.totals.won)}
              sub={fmtPct(
                data.totals.leads ? (data.totals.won / data.totals.leads) * 100 : null,
                1,
              )}
              icon={<CircleCheckBig size={18} />}
            />
            <KpiCard
              index={2}
              label={t("lost_count")}
              value={fmtNum(data.totals.lost)}
              sub={fmtPct(
                data.totals.leads ? (data.totals.lost / data.totals.leads) * 100 : null,
                1,
              )}
              icon={<CircleX size={18} />}
            />
            <KpiCard
              index={3}
              label={t("open_leads")}
              value={fmtNum(data.totals.open)}
              icon={<CircleDot size={18} />}
            />
            <KpiCard
              index={4}
              label={t("not_contacted")}
              value={fmtNum(data.totals.notContacted)}
              icon={<Clock3 size={18} />}
            />
            <KpiCard
              index={5}
              hero
              label={t("website_sales")}
              value={fmtUSD(data.totals.sales)}
              sub={`${fmtNum(data.totals.salesOrders)} ${copy.orders}`}
              icon={<Banknote size={18} />}
            />
          </div>

          <Card>
            <SectionTitle>{copy.quickAnalysis}</SectionTitle>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-border bg-surface-2/40 p-3">
                <div className="text-xs text-text-muted">{copy.bestSelling}</div>
                <div className="mt-1 font-semibold text-text">
                  {data.insights.bestSellingCourse?.label || copy.noData}
                </div>
                {data.insights.bestSellingCourse && (
                  <div className="mt-1 text-xs text-success">
                    {fmtUSD(data.insights.bestSellingCourse.value)} ·{" "}
                    {fmtNum(data.insights.bestSellingCourse.orders)} {copy.orders}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-border bg-surface-2/40 p-3">
                <div className="text-xs text-text-muted">{copy.unsoldDemand}</div>
                <div className="mt-1 font-semibold text-text">
                  {data.insights.highestDemandUnsoldCourse?.label || copy.noData}
                </div>
                {data.insights.highestDemandUnsoldCourse && (
                  <div className="mt-1 text-xs text-warning">
                    {fmtNum(data.insights.highestDemandUnsoldCourse.leads)} {copy.leads} ·{" "}
                    {fmtNum(data.insights.highestDemandUnsoldCourse.open)} {copy.open}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-border bg-surface-2/40 p-3">
                <div className="text-xs text-text-muted">{copy.averageOrder}</div>
                <div className="mt-1 font-semibold text-text">
                  {data.insights.averageOrder === null
                    ? copy.noData
                    : fmtUSD(data.insights.averageOrder)}
                </div>
                <div className="mt-1 text-xs text-text-muted">
                  {fmtNum(data.totals.salesOrders)} {copy.orders}
                </div>
              </div>
              <div className="rounded-lg border border-brand/20 bg-brand-soft/50 p-3">
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <GitMerge size={15} className="text-brand" />
                  {copy.reconciliation}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Pill tone="success">
                    {fmtNum(data.reconciliation.matchedOrders)} {copy.matchedOrders}
                  </Pill>
                  <Pill tone="brand">
                    {fmtNum(data.reconciliation.externalOnlyOrders)} {copy.externalOnlyOrders}
                  </Pill>
                  <Pill tone={data.reconciliation.discrepancyOrders ? "danger" : "neutral"}>
                    {fmtNum(data.reconciliation.discrepancyOrders)} {copy.discrepancyOrders}
                  </Pill>
                </div>
                <div className="mt-2 text-xs text-text-muted">
                  {fmtUSD(data.reconciliation.externalOnlySales)} · {copy.reconciliationHint}
                </div>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle>{t("website_pipeline")}</SectionTitle>
              <BarList
                max={data.totals.leads}
                items={[
                  { label: t("won"), value: data.totals.won },
                  { label: t("lost_count"), value: data.totals.lost },
                  { label: t("open_leads"), value: data.totals.open },
                  { label: t("not_contacted"), value: data.totals.notContacted },
                ]}
                format={fmtNum}
              />
            </Card>
            <Card>
              <SectionTitle hint={`${t("as_of")} ${fmtDate(data.asOf, lang)}`}>
                {t("waiting_age")}
              </SectionTitle>
              <BarList
                items={data.waitingBuckets.map((row) => ({
                  label: row.label === "0" ? t("today") : `${row.label} ${t("days")}`,
                  value: row.count,
                }))}
                format={fmtNum}
                color="var(--warning)"
              />
            </Card>
          </div>

          <div>
            <SectionTitle hint={copy.salesDetailsHint}>{copy.salesDetails}</SectionTitle>
            <DataTable
              rows={data.salesDetail.rows}
              cols={salesCols}
              searchable={(r) =>
                `${r.orderRef} ${r.customer} ${r.courses} ${r.salesperson} ${r.source} ${r.externalSalesSource} ${r.externalPhone} ${r.reconciliationStatus}`
              }
              initialSort={{ key: "saleDate", dir: -1 }}
              csvFilename="engosoft-website-sales-reconciled"
              maxHeight={640}
              truncatedNote={
                data.salesDetail.truncated
                  ? `${t("showing")} ${fmtNum(data.salesDetail.rows.length)} ${t("of")} ${fmtNum(data.salesDetail.total)}`
                  : undefined
              }
              csvRow={(r) => ({
                sale_date: r.saleDate,
                order_id: r.orderRef,
                customer: r.customer,
                courses: r.courses,
                salesperson: r.salesperson,
                local_total: r.localTotal,
                currency: r.currency,
                sales_usd: r.usdSales,
                record_source: r.source,
                external_price: r.externalPrice,
                external_currency: r.externalCurrency,
                external_sales_source: r.externalSalesSource,
                external_phone: r.externalPhone,
                reconciliation_status: r.reconciliationStatus,
                price_difference: r.priceDifference ?? "",
              })}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle hint={copy.soldHint}>{copy.soldCourses}</SectionTitle>
              {data.soldCourses.length ? (
                <BarList
                  items={data.soldCourses.slice(0, 12).map((row) => ({
                    label: row.label,
                    value: row.value,
                    meta: (
                      <span>
                        {fmtUSD(row.value)} · {fmtNum(row.orders)} {copy.orders}
                      </span>
                    ),
                  }))}
                  format={fmtUSD}
                  color="var(--success)"
                />
              ) : (
                <p className="text-sm text-text-muted">{copy.noData}</p>
              )}
            </Card>
            <Card>
              <SectionTitle hint={copy.unsoldHint}>{copy.unsoldCourses}</SectionTitle>
              {data.unsoldCourses.length ? (
                <BarList
                  items={data.unsoldCourses.slice(0, 12).map((row) => ({
                    label: row.label,
                    value: row.leads,
                    meta: (
                      <span>
                        {fmtNum(row.open)} {copy.open} · {fmtNum(row.lost)} {copy.lost}
                      </span>
                    ),
                  }))}
                  format={fmtNum}
                  color="var(--warning)"
                />
              ) : (
                <p className="text-sm text-text-muted">{copy.noData}</p>
              )}
            </Card>
          </div>

          <div>
            <SectionTitle hint={copy.specialtyNote}>{t("website_by_specialty")}</SectionTitle>
            <DataTable
              rows={data.specialties}
              cols={specialtyCols}
              searchable={(r) => r.specialty}
              initialSort={{ key: "total", dir: -1 }}
              csvFilename="engosoft-website-specialties"
              csvRow={(r) => ({
                specialty: r.specialty,
                leads: r.total,
                won: r.won,
                lost: r.lost,
                open: r.open,
                not_contacted: r.notContacted,
                conversion_rate: r.conversionRate ?? "",
                sales_usd: r.sales,
                sales_orders: r.salesOrders,
              })}
            />
          </div>

          <div>
            <SectionTitle hint={t("contact_age_note")}>{t("not_contacted_detail")}</SectionTitle>
            <DataTable
              rows={data.detail.rows}
              cols={contactCols}
              searchable={(r) =>
                `${r.contact} ${r.course} ${r.stage} ${r.salesperson} ${r.callingReply}`
              }
              initialSort={{ key: "daysWaiting", dir: -1 }}
              csvFilename="engosoft-website-not-contacted"
              maxHeight={620}
              truncatedNote={
                data.detail.truncated
                  ? `${t("showing")} ${fmtNum(data.detail.rows.length)} ${t("of")} ${fmtNum(data.detail.total)}`
                  : undefined
              }
              csvRow={(r) => ({
                created_at: r.createdAt,
                contact: r.contact,
                course: r.course,
                stage: r.stage,
                salesperson: r.salesperson,
                calling_reply: r.callingReply,
                last_stage_update: r.lastStageUpdate,
                waiting_since: r.waitingSince,
                waiting_days: r.daysWaiting,
              })}
            />
          </div>
        </>
      )}
    </div>
  );
}
