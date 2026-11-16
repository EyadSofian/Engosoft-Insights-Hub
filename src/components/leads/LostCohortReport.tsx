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
    section: "دخلت واتقفلت Lost في نفس الشهر",
    hint: "العدد يشمل السجلات اللي دخلت في الشهر المختار وما زالت Lost في أودو، وتاريخ فقدها الموثّق في نفس الشهر. اللي دخل قبل الشهر أو اتقفل بعده مش محسوب.",
    all: "إجمالي السجلات الداخلة",
    lostLeads: "ليدز مفقودة",
    lostOpportunities: "فرص بيعية مفقودة",
    lostRate: "نسبة الفقد من السجلات الداخلة",
    unverified: "تاريخ الفقد غير مؤكد",
    notCounted: "ضمن السجلات الداخلة، لكن مش في عدد الفقد المؤكّد",
    denominator: "المقام لكل النسب",
    of: "من",
    platform: "القناة الإعلانية",
    source: "مصدر الليد",
    course: "الكورس",
    salesperson: "البياع",
    buyer: "الميديا باير",
    dimension: "التقسيم",
    incoming: "دخلت",
    lostTotal: "إجمالي الفقد في نفس الشهر",
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
    section: "Entered and lost in the same month",
    hint: "Counts currently Lost Odoo records with both entry and a verified loss date in the selected month. Earlier arrivals and later losses are excluded.",
    all: "Total records entered",
    lostLeads: "Lost Leads",
    lostOpportunities: "Lost Opportunities",
    lostRate: "Lost rate of entered records",
    unverified: "Unverified loss date",
    notCounted: "Included in entries, not in verified losses",
    denominator: "Denominator for all rates",
    of: "of",
    platform: "Ad channel",
    source: "Lead source",
    course: "Course",
    salesperson: "Salesperson",
    buyer: "Media buyer",
    dimension: "Breakdown",
    incoming: "Entered",
    lostTotal: "Total lost in the same month",
    unknown: "Unattributed",
    caveat:
      "Ad channel is derived from lead source; media buyer uses campaign/course rules. Unattributed records remain visible and are not guessed into another group. Excluded acquisition sources are not counted.",
    details: "Open detailed Lost analysis and loss reasons",
    empty: "No records in this breakdown for the selected month.",
  },
} as const;

const count = (n: number) => n.toLocaleString();
const rate = (n: number, total: number) => (total ? `${((n / total) * 100).toFixed(1)}%` : "—");

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
  const selected = data.selected;
  const share = (n: number, total: number) => (
    <>
      <bdi>{rate(n, total)}</bdi> · <bdi>{count(n)}</bdi> {t.of} <bdi>{count(total)}</bdi>
    </>
  );
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
      render: (row) => (
        <>
          <bdi>{count(row.lostLeadsSameEntryMonth)}</bdi>{" "}
          <span className="text-xs text-text-muted">
            · <bdi>{rate(row.lostLeadsSameEntryMonth, row.leads)}</bdi>
          </span>
        </>
      ),
      sortValue: (row) => row.lostLeadsSameEntryMonth,
    },
    {
      key: "lostOpportunities",
      header: t.lostOpportunities,
      align: "right",
      render: (row) => (
        <>
          <bdi>{count(row.lostOpportunitiesSameEntryMonth)}</bdi>{" "}
          <span className="text-xs text-text-muted">
            · <bdi>{rate(row.lostOpportunitiesSameEntryMonth, row.leads)}</bdi>
          </span>
        </>
      ),
      sortValue: (row) => row.lostOpportunitiesSameEntryMonth,
    },
    {
      key: "lost",
      header: t.lostTotal,
      align: "right",
      render: (row) => count(row.lostSameEntryMonth),
      sortValue: (row) => row.lostSameEntryMonth,
    },
    {
      key: "lostRate",
      header: t.lostRate,
      align: "right",
      render: (row) => <span className="text-xs">{share(row.lostSameEntryMonth, row.leads)}</span>,
      sortValue: (row) => (row.leads ? row.lostSameEntryMonth / row.leads : -1),
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
        <p className="mb-3 text-xs text-text-muted">
          <bdi className="font-bold">{data.selectedMonth}</bdi> ·{" "}
          {lang === "ar" ? "البيانات حتى" : "Data through"} <bdi>{data.asOf}</bdi>
        </p>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: t.all, value: selected.leads, tone: "border-brand", note: t.denominator },
            {
              label: t.lostLeads,
              value: selected.lostLeadsSameEntryMonth,
              tone: "border-amber-strong",
              note: share(selected.lostLeadsSameEntryMonth, selected.leads),
            },
            {
              label: t.lostOpportunities,
              value: selected.lostOpportunitiesSameEntryMonth,
              tone: "border-rose-strong",
              note: share(selected.lostOpportunitiesSameEntryMonth, selected.leads),
            },
            {
              label: t.lostTotal,
              value: selected.lostSameEntryMonth,
              tone: "border-rose-strong bg-rose-soft/40",
              note: share(selected.lostSameEntryMonth, selected.leads),
            },
            {
              label: t.unverified,
              value: selected.lostTimingUnverified,
              tone: "border-border",
              note: t.notCounted,
            },
          ].map((item) => (
            <Card key={item.label} className={`border-t-[3px] ${item.tone}`}>
              <div className="text-xs text-text-muted">{item.label}</div>
              <div className="num mt-2 text-3xl font-bold text-text">{count(item.value)}</div>
              <p className="mt-2 text-xs leading-5 text-text-muted">{item.note}</p>
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
              lostLeadsSameEntryMonth: row.lostLeadsSameEntryMonth,
              lostLeadsPctOfEntered: rate(row.lostLeadsSameEntryMonth, row.leads),
              lostOpportunitiesSameEntryMonth: row.lostOpportunitiesSameEntryMonth,
              lostOpportunitiesPctOfEntered: rate(row.lostOpportunitiesSameEntryMonth, row.leads),
              totalLostSameEntryMonth: row.lostSameEntryMonth,
              totalLostPctOfEntered: rate(row.lostSameEntryMonth, row.leads),
              lostTimingUnverified: row.lostTimingUnverified,
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
