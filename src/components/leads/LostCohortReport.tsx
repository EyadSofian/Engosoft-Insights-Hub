import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink, TrendingDown } from "lucide-react";
import { DashboardPageHeader, PageSection } from "@/components/dashboard-bits";
import { Card, ErrorState, Segmented, Skeleton } from "@/components/ui-bits";
import { DataTable, type Col } from "@/components/DataTable";
import { useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { PerformanceGroup, PerformanceResult } from "@/lib/lead-performance";

type Dimension = "platform" | "source" | "course" | "salesperson" | "buyer";

const wording = {
  ar: {
    title: "اللوست حسب شهر دخول الليد",
    subtitle: "افصل الليد المفقود عن الفرصة المفقودة، ثم راجع القناة والبياع والميديا باير.",
    section: "توزيع السجلات التي أصبحت Lost",
    hint: "المقام هو سجلات CRM التي دخلت في الشهر المختار؛ Lost هي حالتها الحالية في أودو. ليست عدد ما أُغلق Lost خلال الشهر فقط.",
    all: "سجلات دخلت",
    lostLeads: "Lost Leads",
    lostOpportunities: "Lost Opportunities",
    lostRate: "نسبة Lost من المجموعة",
    platform: "القناة الإعلانية",
    source: "مصدر الليد",
    course: "الكورس",
    salesperson: "البياع",
    buyer: "الميديا باير",
    dimension: "التقسيم",
    incoming: "دخلت",
    lostTotal: "Lost إجمالي",
    unknown: "غير منسوب",
    caveat:
      "القناة الإعلانية مستنتجة من مصدر الليد، والميديا باير يُنسب بقواعد الحملة والكورس؛ غير المنسوب يظل ظاهرًا ولا يُوزع بالتخمين. الفئات المستبعدة من الاستحواذ لا تدخل هذه الأرقام.",
    details: "فتح تحليل Lost التفصيلي وأسباب الفقد",
    empty: "لا توجد سجلات في هذا التقسيم للشهر المختار.",
  },
  en: {
    title: "Lost by lead entry month",
    subtitle:
      "Separate Lost Leads from Lost Opportunities, then inspect channel, salesperson and media buyer.",
    section: "Records currently Lost",
    hint: "The denominator is CRM records created in the selected month; Lost is their current Odoo state. This is not just losses closed during the month.",
    all: "Records entered",
    lostLeads: "Lost Leads",
    lostOpportunities: "Lost Opportunities",
    lostRate: "Lost rate of cohort",
    platform: "Ad channel",
    source: "Lead source",
    course: "Course",
    salesperson: "Salesperson",
    buyer: "Media buyer",
    dimension: "Breakdown",
    incoming: "Entered",
    lostTotal: "Total Lost",
    unknown: "Unattributed",
    caveat:
      "Ad channel is derived from lead source; media buyer uses campaign/course rules. Unattributed records remain visible and are not guessed into another group. Excluded acquisition sources are not counted.",
    details: "Open detailed Lost analysis and loss reasons",
    empty: "No records in this breakdown for the selected month.",
  },
} as const;

export function LostCohortReport({ initialMonth }: { initialMonth?: string }) {
  const { lang } = useI18n();
  const t = wording[lang];
  const [month, setMonth] = useState(initialMonth ?? "");
  const [dimension, setDimension] = useState<Dimension>("platform");
  const { data, isLoading, error } = useApi<PerformanceResult>(
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

  const dimensions: { key: Dimension; label: string; rows: PerformanceGroup[] }[] = [
    { key: "platform", label: t.platform, rows: data.byPlatform },
    { key: "source", label: t.source, rows: data.bySource },
    { key: "course", label: t.course, rows: data.byCourse },
    { key: "salesperson", label: t.salesperson, rows: data.bySalesOwner },
    { key: "buyer", label: t.buyer, rows: data.byMediaBuyer },
  ];
  const rows = dimensions.find((item) => item.key === dimension)?.rows ?? [];
  const cols: Col<PerformanceGroup>[] = [
    {
      key: "name",
      header: t.dimension,
      always: true,
      sticky: true,
      render: (row) => <span className="font-semibold text-text">{row.name || t.unknown}</span>,
      sortValue: (row) => row.name,
    },
    {
      key: "leads",
      header: t.incoming,
      align: "right",
      render: (row) => row.leads.toLocaleString(),
      sortValue: (row) => row.leads,
    },
    {
      key: "lostLeads",
      header: t.lostLeads,
      align: "right",
      render: (row) => row.lostLeads.toLocaleString(),
      sortValue: (row) => row.lostLeads,
    },
    {
      key: "lostOpportunities",
      header: t.lostOpportunities,
      align: "right",
      render: (row) => row.lostOpportunities.toLocaleString(),
      sortValue: (row) => row.lostOpportunities,
    },
    {
      key: "lost",
      header: t.lostTotal,
      align: "right",
      render: (row) => row.lost.toLocaleString(),
      sortValue: (row) => row.lost,
    },
    {
      key: "lostRate",
      header: t.lostRate,
      align: "right",
      render: (row) => (row.lostRate === null ? "—" : `${row.lostRate.toFixed(1)}%`),
      sortValue: (row) => row.lostRate ?? -1,
    },
  ];

  return (
    <div className="page-sections">
      <DashboardPageHeader
        flush
        icon={<TrendingDown size={21} />}
        title={t.title}
        subtitle={t.subtitle}
      />
      <PageSection
        title={t.section}
        hint={t.hint}
        icon={<TrendingDown size={16} />}
        tone="rose"
        action={
          <Segmented
            value={data.selectedMonth}
            onChange={setMonth}
            options={data.months.map((value) => ({ value, label: value }))}
          />
        }
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          {[
            { label: t.all, value: data.selected.leads, tone: "border-brand" },
            { label: t.lostLeads, value: data.selected.lostLeads, tone: "border-amber-strong" },
            {
              label: t.lostOpportunities,
              value: data.selected.lostOpportunities,
              tone: "border-rose-strong",
            },
            {
              label: t.lostRate,
              value:
                data.selected.lostRate === null ? "—" : `${data.selected.lostRate.toFixed(1)}%`,
              tone: "border-rose-strong",
            },
          ].map((item) => (
            <Card key={item.label} className={`border-t-[3px] ${item.tone}`}>
              <div className="text-xs text-text-muted">{item.label}</div>
              <div className="num mt-2 text-3xl font-bold text-text">
                {typeof item.value === "number" ? item.value.toLocaleString() : item.value}
              </div>
            </Card>
          ))}
        </div>
        <div className="mb-3 overflow-x-auto">
          <Segmented
            value={dimension}
            onChange={setDimension}
            options={dimensions.map((item) => ({ value: item.key, label: item.label }))}
          />
        </div>
        <Card padded={false} className="overflow-hidden">
          <DataTable<PerformanceGroup>
            rows={rows}
            cols={cols}
            rowKey={(row) => row.name}
            searchable={(row) => row.name}
            initialSort={{ key: "lost", dir: -1 }}
            csvFilename={`engosoft-lost-${dimension}-${data.selectedMonth}`}
            csvRow={(row) => ({
              name: row.name,
              entered: row.leads,
              lostLeads: row.lostLeads,
              lostOpportunities: row.lostOpportunities,
              totalLost: row.lost,
              lostRate: row.lostRate ?? "",
            })}
            emptyState={<p className="p-8 text-center text-sm text-text-muted">{t.empty}</p>}
          />
        </Card>
        <p className="mt-4 text-xs leading-6 text-text-muted">{t.caveat}</p>
        <Link
          to="/lost"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline"
        >
          {t.details}
          <ExternalLink size={13} />
        </Link>
        <Link
          to="/leads"
          search={{ view: "quality", month: data.selectedMonth }}
          className="ms-4 inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline"
        >
          {lang === "ar"
            ? "جودة الليدز واللوست · قرارات المراجعة"
            : "Lead quality & Lost · audit decisions"}
          <ExternalLink size={13} />
        </Link>
      </PageSection>
    </div>
  );
}
