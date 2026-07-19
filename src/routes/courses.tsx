import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { X } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { filterStore } from "@/lib/filter-store";
import { fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { BarList, Card, ErrorState, PageHeader, SectionTitle, Segmented, Skeleton } from "@/components/ui-bits";
import { AcosPill, CloseTime, CountPct, RoasCell } from "@/components/metric-bits";
import { DataTable, type Col } from "@/components/DataTable";
import { MultiLineChart } from "@/components/charts";
import type { CourseAgg, DataHealth, Grouped, Maybe, Totals } from "@/lib/types";

export const Route = createFileRoute("/courses")({ component: Courses });

type RankMetric = "revenue" | "crmLeads" | "won" | "conversionRate" | "roas" | "spend";

interface Resp {
  courses: CourseAgg[];
  totals: Totals;
  drill: {
    course: string;
    campaigns: Grouped[];
    salespeople: Grouped[];
    teams: Grouped[];
    monthly: { month: string; revenue: number; leads: number; won: number }[];
  } | null;
  health: DataHealth;
}

const EM = "—";
const maybe = (n: Maybe, fmt: (v: number) => string) =>
  n === null || !isFinite(n) ? <span className="text-text-subtle">{EM}</span> : fmt(n);
const sortMaybe = (n: Maybe) => (n === null || !isFinite(n) ? -Infinity : n);

function Courses() {
  const { t, lang } = useI18n();
  const [rank, setRank] = useState<RankMetric>("revenue");
  const [detail, setDetail] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useApi<Resp>(
    `/api/courses${detail ? `?detail=${encodeURIComponent(detail)}` : ""}`,
  );

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const rankValue = (c: CourseAgg): number => {
    const v = c[rank];
    return typeof v === "number" ? v : 0;
  };
  const ranked = data ? [...data.courses].sort((a, b) => rankValue(b) - rankValue(a)) : [];
  const withLeads = ranked.filter((c) => c.crmLeads >= 20);

  const cols: Col<CourseAgg>[] = [
    { key: "course", header: t("course"), sticky: true, width: "160px", sortValue: (r) => r.course, render: (r) => r.course || EM },
    { key: "category", header: t("main_category"), sortValue: (r) => r.mainCategory, render: (r) => r.mainCategory || EM },
    { key: "crmLeads", header: t("crm_leads"), align: "right", sortValue: (r) => r.crmLeads, render: (r) => fmtNum(r.crmLeads) },
    { key: "won", header: t("won"), align: "right", sortValue: (r) => r.won, render: (r) => <CountPct count={r.won} pct={r.conversionRate} /> },
    { key: "lost", header: t("lost_count"), align: "right", sortValue: (r) => r.lost, render: (r) => <CountPct count={r.lost} pct={r.lostRate} /> },
    { key: "revenue", header: t("revenue"), align: "right", sortValue: (r) => r.revenue, render: (r) => fmtUSD(r.revenue) },
    { key: "orders", header: t("orders"), align: "right", sortValue: (r) => r.orders, render: (r) => fmtNum(r.orders) },
    { key: "avgOrder", header: t("aov"), align: "right", sortValue: (r) => sortMaybe(r.avgOrder), render: (r) => maybe(r.avgOrder, fmtUSD) },
    {
      key: "spend",
      header: t("spend"),
      align: "right",
      sortValue: (r) => r.spend,
      // Course-level spend is inferred through each campaign's modal course.
      render: (r) => (r.spend > 0 ? fmtUSD(r.spend) : <span className="text-text-subtle">{EM}</span>),
    },
    { key: "roas", header: t("roas"), align: "right", sortValue: (r) => sortMaybe(r.roas), render: (r) => <RoasCell roas={r.roas} spend={r.spend} /> },
    { key: "acos", header: t("acos"), align: "right", sortValue: (r) => sortMaybe(r.acos), render: (r) => <AcosPill acos={r.acos} /> },
    { key: "cpl", header: t("cpl"), align: "right", sortValue: (r) => sortMaybe(r.cpl), render: (r) => maybe(r.cpl, fmtUSDFull) },
    { key: "cpa", header: t("cpa"), align: "right", sortValue: (r) => sortMaybe(r.cpa), render: (r) => maybe(r.cpa, fmtUSDFull) },
    {
      key: "revenuePerLead",
      header: t("revenue_per_lead"),
      align: "right",
      sortValue: (r) => sortMaybe(r.revenuePerLead),
      render: (r) => maybe(r.revenuePerLead, fmtUSDFull),
    },
    {
      key: "close",
      header: t("avg_close_time"),
      align: "right",
      sortValue: (r) => sortMaybe(r.avgCloseDays),
      render: (r) => (r.avgCloseDays === null ? <span className="text-text-subtle">{EM}</span> : `${r.avgCloseDays.toFixed(1)} · ${fmtNum(r.closeSample)}`),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("courses")}
        subtitle={
          lang === "ar"
            ? "الإنفاق على مستوى الدورة مُستنتج من الدورة الغالبة لعملاء كل حملة، لأن تبويبات الإعلانات لا تحمل عمود دورة."
            : "Course-level spend is inferred from each campaign's dominant course, because the ads tabs carry no course column."
        }
      />

      {isLoading || !data ? (
        <>
          <Skeleton className="h-56" />
          <Skeleton className="h-96" />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-text-muted">{t("rank_by")}</span>
            <Segmented
              value={rank}
              onChange={setRank}
              options={[
                { value: "revenue", label: t("revenue") },
                { value: "crmLeads", label: t("crm_leads") },
                { value: "won", label: t("won") },
                { value: "conversionRate", label: t("conversion_rate") },
              ]}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <SectionTitle hint={lang === "ar" ? "حسب المؤشر المختار" : "By the selected metric"}>
                {t("top_performing")}
              </SectionTitle>
              <BarList
                items={ranked.slice(0, 6).map((c) => ({
                  label: c.course,
                  value: rankValue(c),
                  meta: rank === "conversionRate" ? fmtPct(c.conversionRate, 1) : rank === "revenue" || rank === "spend" ? fmtUSD(rankValue(c)) : fmtNum(rankValue(c)),
                }))}
                format={fmtUSD}
              />
            </Card>
            <Card>
              <SectionTitle hint={lang === "ar" ? "٢٠ عميلاً فأكثر، مرتبة تصاعدياً" : "20+ leads, worst first"}>
                {t("underperforming")}
              </SectionTitle>
              <BarList
                items={[...withLeads]
                  .sort((a, b) => (a.conversionRate ?? 0) - (b.conversionRate ?? 0))
                  .slice(0, 6)
                  .map((c) => ({
                    label: c.course,
                    value: c.conversionRate ?? 0,
                    meta: `${fmtPct(c.conversionRate, 1)} · ${fmtNum(c.crmLeads)} ${lang === "ar" ? "عميل" : "leads"}`,
                  }))}
                format={(n) => fmtPct(n, 1)}
                color="var(--danger)"
              />
            </Card>
          </div>

          <DataTable
            rows={data.courses}
            cols={cols}
            searchable={(r) => `${r.course} ${r.mainCategory}`}
            initialSort={{ key: "revenue", dir: -1 }}
            onRowClick={(r) => setDetail(r.course)}
            csvFilename="engosoft-courses"
            maxHeight={620}
            csvRow={(r) => ({
              course: r.course,
              main_category: r.mainCategory,
              crm_leads: r.crmLeads,
              won: r.won,
              conversion_rate: r.conversionRate?.toFixed(2) ?? "",
              lost: r.lost,
              lost_rate: r.lostRate?.toFixed(2) ?? "",
              revenue: r.revenue.toFixed(2),
              orders: r.orders,
              aov: r.avgOrder?.toFixed(2) ?? "",
              spend_inferred: r.spend.toFixed(2),
              roas: r.roas?.toFixed(4) ?? "",
              acos: r.acos?.toFixed(2) ?? "",
              cpl: r.cpl?.toFixed(2) ?? "",
              cpa: r.cpa?.toFixed(2) ?? "",
              revenue_per_lead: r.revenuePerLead?.toFixed(2) ?? "",
              avg_close_days: r.avgCloseDays?.toFixed(2) ?? "",
              close_sample: r.closeSample,
            })}
          />

          {detail && data.drill && <CourseDrawer drill={data.drill} onClose={() => setDetail(null)} />}
        </>
      )}
    </div>
  );
}

function CourseDrawer({ drill, onClose }: { drill: NonNullable<Resp["drill"]>; onClose: () => void }) {
  const { t, lang } = useI18n();
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center animate-fade-in"
      style={{ background: "rgba(4, 12, 24, 0.5)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full sm:max-w-2xl glass rounded-t-3xl sm:rounded-3xl p-5 max-h-[88vh] overflow-y-auto animate-slide-up sm:animate-scale-in"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-text text-lg">{drill.course}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                filterStore.set({ course: drill.course });
                onClose();
              }}
              className="text-xs px-3 py-2 rounded-lg text-white cursor-pointer"
              style={{ background: "var(--brand)" }}
            >
              {lang === "ar" ? "فلترة اللوحة كلها" : "Filter whole dashboard"}
            </button>
            <button onClick={onClose} aria-label={t("close")} className="w-10 h-10 grid place-items-center rounded-full hover:bg-surface-2 cursor-pointer">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <SectionTitle>{t("by_month")}</SectionTitle>
            <MultiLineChart
              data={drill.monthly.map((m) => ({ date: m.month, revenue: m.revenue, leads: m.leads, won: m.won }))}
              series={[
                { key: "revenue", name: t("revenue"), color: "var(--chart-2)" },
                { key: "leads", name: t("crm_leads"), color: "var(--chart-1)" },
              ]}
              height={200}
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <SectionTitle>{t("by_campaign")}</SectionTitle>
              <BarList
                items={drill.campaigns.slice(0, 6).map((g) => ({ label: g.label, value: g.count, meta: fmtNum(g.count) }))}
                format={fmtNum}
              />
            </div>
            <div>
              <SectionTitle>{t("by_salesperson")}</SectionTitle>
              <BarList
                items={drill.salespeople.slice(0, 6).map((g) => ({ label: g.label, value: g.count, meta: fmtNum(g.count) }))}
                format={fmtNum}
                color="var(--chart-3)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
