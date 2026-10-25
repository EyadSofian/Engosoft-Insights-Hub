import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { BadgeCheck, ExternalLink, Route as RouteIcon } from "lucide-react";
import { DashboardPageHeader, PageSection } from "@/components/dashboard-bits";
import { Card, ErrorState, Segmented, Skeleton } from "@/components/ui-bits";
import { DataTable, type Col } from "@/components/DataTable";
import { useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { PerformanceGroup, PerformanceResult } from "@/lib/lead-performance";

type Response = PerformanceResult & {
  availability: { accounting: boolean };
};

const label = {
  ar: {
    title: "قنوات إغلاق البيع",
    subtitle: "حقل Closing Won Channel في أودو، منفصل عن مصدر الليد أو منصة الإعلان.",
    section: "كيف أُغلقت المبيعات؟",
    hint: "يعرض فرص الشهر المصنفة Won الآن أو المرتبطة بدفع مثبت. القناة هي القيمة الحالية في أودو، وليست قناة استحواذ الليد.",
    records: "سجلات بيع قابلة للتحليل",
    known: "قناة إغلاق مسجلة",
    missing: "قناة غير مسجلة",
    channel: "قناة الإغلاق",
    won: "Won في CRM",
    paid: "تسجيلات مدفوعة مرتبطة بدليل",
    revenue: "صافي دفع مثبت بالدولار",
    caveat:
      "Won لا يساوي تسجيلًا مدفوعًا. الدفع يظهر فقط مع ربط مباشر بأمر بيع وفاتورة مدفوعة؛ السجلات بلا قناة تبقى ظاهرة ولا تُوزع بالتخمين.",
    unavailable: "ربط أو بيانات الدفع غير مكتملة؛ أرقام التسجيل المدفوع مخفية.",
    details: "افتح تقرير الأداء وسجلات CRM",
    empty: "لا توجد فرص Won أو تسجيلات مدفوعة مثبتة في شهر الدخول المختار.",
  },
  en: {
    title: "Sales closing channels",
    subtitle:
      "Odoo's Closing Won Channel field, separate from lead source or advertising platform.",
    section: "How were sales closed?",
    hint: "Opportunities created in the selected month that are currently Won or have a verified linked payment. The channel is Odoo's current value, not the lead acquisition channel.",
    records: "Sales records reviewed",
    known: "Closing channel recorded",
    missing: "Closing channel missing",
    channel: "Closing channel",
    won: "CRM Won",
    paid: "Evidence-linked paid enrollments",
    revenue: "Verified net paid USD",
    caveat:
      "CRM Won is not a paid enrollment. Paid figures require an exact sale-order link and paid invoice; unassigned channel records stay visible and are never guessed into another channel.",
    unavailable: "Payment data or exact order links are unavailable; paid measures are withheld.",
    details: "Open performance report and CRM records",
    empty:
      "No currently Won or verified paid opportunities were created in the selected entry month.",
  },
} as const;

export function SalesChannelReport() {
  const { lang } = useI18n();
  const t = label[lang];
  const [month, setMonth] = useState("");
  const { data, isLoading, error } = useApi<Response>(
    `/api/lead-performance${month ? `?month=${month}` : ""}`,
  );
  if (isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-80" />
      </div>
    );
  if (error) return <ErrorState message={error.message} />;
  if (!data) return null;

  const rows = data.byClosingChannel;
  const reviewed = rows.reduce((sum, row) => sum + row.leads, 0);
  const missing = rows.find((row) => row.name === "—")?.leads ?? 0;
  const paidReady = data.coverage.linksAvailable && data.availability.accounting;
  const cols: Col<PerformanceGroup>[] = [
    {
      key: "name",
      header: t.channel,
      always: true,
      sticky: true,
      render: (row) => (
        <span className="font-semibold text-text">{row.name === "—" ? t.missing : row.name}</span>
      ),
      sortValue: (row) => row.name,
    },
    {
      key: "leads",
      header: t.records,
      align: "right",
      render: (row) => row.leads.toLocaleString(),
      sortValue: (row) => row.leads,
    },
    {
      key: "won",
      header: t.won,
      align: "right",
      render: (row) => row.crmWon.toLocaleString(),
      sortValue: (row) => row.crmWon,
    },
    {
      key: "paid",
      header: t.paid,
      align: "right",
      render: (row) => (paidReady ? row.paidLeads.toLocaleString() : "—"),
      sortValue: (row) => row.paidLeads,
    },
    {
      key: "revenue",
      header: t.revenue,
      align: "right",
      render: (row) =>
        paidReady ? row.paidRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—",
      sortValue: (row) => row.paidRevenue,
    },
  ];

  return (
    <div className="page-sections">
      <DashboardPageHeader
        flush
        icon={<RouteIcon size={21} />}
        title={t.title}
        subtitle={t.subtitle}
      />
      <PageSection
        title={t.section}
        hint={t.hint}
        icon={<BadgeCheck size={16} />}
        tone="mint"
        action={
          <Segmented
            value={data.selectedMonth}
            onChange={setMonth}
            options={data.months.map((value) => ({ value, label: value }))}
          />
        }
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {[
            { label: t.records, value: reviewed, tone: "border-brand" },
            { label: t.known, value: reviewed - missing, tone: "border-mint-strong" },
            { label: t.missing, value: missing, tone: "border-amber-strong" },
          ].map((item) => (
            <Card key={item.label} className={`border-t-[3px] ${item.tone}`}>
              <div className="text-xs text-text-muted">{item.label}</div>
              <div className="num mt-2 text-3xl font-bold text-text">
                {item.value.toLocaleString()}
              </div>
            </Card>
          ))}
        </div>
        <Card padded={false} className="overflow-hidden">
          <DataTable<PerformanceGroup>
            rows={rows}
            cols={cols}
            rowKey={(row) => row.name}
            searchable={(row) => row.name}
            initialSort={{ key: "leads", dir: -1 }}
            csvFilename={`engosoft-sales-closing-channel-${data.selectedMonth}`}
            csvRow={(row) => ({
              channel: row.name,
              records: row.leads,
              won: row.crmWon,
              paid: paidReady ? row.paidLeads : "",
              netPaidUsd: paidReady ? row.paidRevenue : "",
            })}
            emptyState={<p className="p-8 text-center text-sm text-text-muted">{t.empty}</p>}
          />
        </Card>
        <p className="mt-4 text-xs leading-6 text-text-muted">
          {t.caveat} {!paidReady && t.unavailable}
        </p>
        <Link
          to="/leads"
          search={{ view: "performance" }}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline"
        >
          {t.details}
          <ExternalLink size={13} />
        </Link>
      </PageSection>
    </div>
  );
}
