import { useMemo, useState } from "react";
import { BadgeDollarSign, CalendarClock, Megaphone, Users } from "lucide-react";
import { DataTable, type Col } from "@/components/DataTable";
import { PageSection } from "@/components/dashboard-bits";
import { Card, Notice, Segmented } from "@/components/ui-bits";
import { fmtNum, fmtUSD, useI18n } from "@/lib/i18n";
import { CreativeDetail, outcomeColumns, useClosedLoop } from "./ClosedLoop";
import { OverviewKpis } from "./ManagementOverview";

/**
 * Sales performance, from the sales side: which lead source, campaign, ad and
 * creative produced each CRM outcome, order, invoice and paid revenue.
 *
 * It reads the same closed-loop response as /acquisition, so the two pages
 * cannot disagree. It deliberately does NOT reuse the accounting totals: those
 * are dated by payment, these by when the lead arrived.
 */
export function SalesPerformance() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const { data, isLoading, error } = useClosedLoop();
  const [creativeId, setCreativeId] = useState<string | null>(null);
  const [result, setResult] = useState<"won" | "all" | "lost">("won");
  const [dimension, setDimension] = useState<"campaign" | "creative" | "salesperson" | "course">(
    "campaign",
  );

  const outcomes = useMemo(
    () =>
      (data?.outcomes ?? []).filter((row) =>
        result === "won" ? row.won : result === "lost" ? row.lost : true,
      ),
    [data, result],
  );

  type Bucket = NonNullable<NonNullable<typeof data>["byDimension"]>[string][number];
  const rankCols: Col<Bucket>[] = [
    {
      key: "label",
      header:
        dimension === "campaign"
          ? A
            ? "الحملة"
            : "Campaign"
          : dimension === "creative"
            ? A
              ? "المادة الإعلانية"
              : "Creative"
            : dimension === "salesperson"
              ? A
                ? "المندوب"
                : "Salesperson"
              : A
                ? "الدورة"
                : "Course",
      always: true,
      sticky: true,
      minWidth: "220px",
      render: (row) => row.label || "—",
      sortValue: (row) => row.label,
    },
    {
      key: "leads",
      header: A ? "العملاء" : "Leads",
      align: "right",
      render: (row) => fmtNum(row.metrics.leads),
      sortValue: (row) => row.metrics.leads,
    },
    {
      key: "won",
      header: A ? "مكسوب" : "Won",
      align: "right",
      render: (row) => fmtNum(row.metrics.won),
      sortValue: (row) => row.metrics.won,
    },
    {
      key: "orders",
      header: A ? "أوامر البيع" : "Orders",
      align: "right",
      render: (row) => fmtNum(row.metrics.saleOrders),
      sortValue: (row) => row.metrics.saleOrders,
    },
    {
      key: "invoices",
      header: A ? "فواتير مدفوعة" : "Paid invoices",
      align: "right",
      render: (row) => fmtNum(row.metrics.invoices),
      sortValue: (row) => row.metrics.invoices,
    },
    {
      key: "revenue",
      header: A ? "الإيراد المدفوع" : "Paid revenue",
      align: "right",
      render: (row) => fmtUSD(row.metrics.revenue),
      sortValue: (row) => row.metrics.revenue,
    },
    ...(dimension === "campaign" || dimension === "creative"
      ? [
          {
            key: "roas",
            header: "ROAS",
            align: "right" as const,
            render: (row: Bucket) =>
              row.metrics.roas == null ? "—" : `${row.metrics.roas.toFixed(2)}×`,
            sortValue: (row: Bucket) => row.metrics.roas ?? -1,
          },
        ]
      : []),
  ];

  if (error) {
    return (
      <Card padded className="text-sm text-danger">
        {A ? "تعذر تحميل أداء المبيعات: " : "Sales performance could not load: "}
        {(error as Error).message}
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Notice tone="info" icon={<CalendarClock size={16} />}>
        {A
          ? "هذا العرض يؤرخ الإيراد بتاريخ وصول العميل (إسناد بتاريخ الاستحواذ): عميل وصل في الفترة ودفع لاحقًا يُحسب هنا. «ملخص الحسابات» يؤرخ نفس الإيراد بتاريخ الدفع. لذلك لا يتساوى الرقمان، ولا يُجمعان معًا."
          : "This view dates revenue by when the lead arrived (acquisition-date attribution): a lead acquired in the period who paid later counts here. The Accounting summary dates the same money by payment date. The two totals are not expected to match and must not be added together."}
      </Notice>
      <OverviewKpis data={data} loading={isLoading} />

      <PageSection
        title={A ? "من أين جاء الإيراد" : "Where the revenue came from"}
        icon={<Megaphone size={16} />}
        tone="violet"
        hint={A ? "للعملاء المتتبَّعين بدقة فقط." : "Exactly tracked leads only."}
      >
        <div className="space-y-3">
          <Segmented
            value={dimension}
            onChange={setDimension}
            options={[
              { value: "campaign", label: A ? "الحملة" : "Campaign" },
              { value: "creative", label: A ? "المادة الإعلانية" : "Creative" },
              { value: "salesperson", label: A ? "المندوب" : "Salesperson" },
              { value: "course", label: A ? "الدورة" : "Course" },
            ]}
          />
          <DataTable
            rows={data?.byDimension?.[dimension] ?? []}
            cols={rankCols}
            loading={isLoading}
            rowKey={(row) => row.key}
            initialSort={{ key: "revenue", dir: -1 }}
            csvFilename={`engosoft-revenue-by-${dimension}.csv`}
            searchable={(row) => row.label}
          />
        </div>
      </PageSection>

      <PageSection
        title={A ? "العملاء والصفقات" : "Leads and deals"}
        icon={<Users size={16} />}
        tone="mint"
        hint={
          A
            ? "مصدر العميل والحملة والإعلان والمادة ومرحلة CRM والمندوب والطلب والفاتورة والإيراد المدفوع. الأعمدة التقنية من «الأعمدة»."
            : "Lead source, campaign, ad, creative, CRM stage, salesperson, order, invoice and paid revenue. Technical columns are under Columns."
        }
      >
        <div className="space-y-3">
          <Segmented
            value={result}
            onChange={setResult}
            options={[
              { value: "won", label: A ? "المكسوب" : "Won" },
              { value: "all", label: A ? "الكل" : "All" },
              { value: "lost", label: A ? "الخسارة" : "Lost" },
            ]}
          />
          <DataTable
            rows={outcomes}
            cols={outcomeColumns(A, setCreativeId)}
            loading={isLoading}
            columnChooser
            rowKey={(row) => `${row.acquisitionEventId}|${row.crmLeadId}`}
            initialSort={{ key: "revenue", dir: -1 }}
            csvFilename="engosoft-marketing-to-revenue.csv"
            searchable={(row) =>
              `${row.campaignName} ${row.adName} ${row.creativeName} ${row.salesperson} ${row.course} ${row.crmLeadId}`
            }
          />
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <BadgeDollarSign size={12} aria-hidden />
            {A
              ? "يعرض حتى 1,000 نتيجة مرتبة بالإيراد ثم الأحدث."
              : "Shows up to 1,000 outcomes, by revenue then newest."}
          </div>
        </div>
      </PageSection>
      <CreativeDetail creativeId={creativeId} onClose={() => setCreativeId(null)} />
    </div>
  );
}
