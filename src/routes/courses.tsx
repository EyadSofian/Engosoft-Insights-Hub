import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Trophy, TrendingDown } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  Card,
  DeltaBadge,
  EmptyState,
  ErrorState,
  RoasPill,
  SectionTitle,
  Segmented,
  Skeleton,
} from "@/components/ui-bits";
import { DataTable, type Col } from "@/components/DataTable";
import { fmtNum, fmtPct, fmtRoas, fmtUSD, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { CourseAgg } from "@/lib/types";

export const Route = createFileRoute("/courses")({ component: CoursesPage });

interface Resp {
  courses: CourseAgg[];
  top: CourseAgg[];
  underperforming: CourseAgg[];
}

type Metric = "revenue" | "roas" | "winRate" | "leads";

function CoursesPage() {
  const { t, lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/courses");
  const [metric, setMetric] = useState<Metric>("revenue");

  const format = (n: number) =>
    metric === "revenue"
      ? fmtUSD(n)
      : metric === "roas"
        ? fmtRoas(n)
        : metric === "winRate"
          ? fmtPct(n, 1)
          : fmtNum(n);

  const courses = data?.courses ?? [];
  // The chosen metric drives the "top" list; underperformers stay server-ranked
  // because "bad" means several things at once (waste, decline, low close rate).
  const top = [...courses]
    .filter((c) => (c[metric] as number) > 0)
    .sort((a, b) => (b[metric] as number) - (a[metric] as number))
    .slice(0, 8);

  const cols: Col<CourseAgg>[] = [
    { key: "course", header: t("course"), sticky: true, width: "160px", render: (r) => r.course, sortValue: (r) => r.course },
    { key: "cat", header: t("main_category"), render: (r) => <span className="text-text-muted">{r.mainCategory || "—"}</span>, sortValue: (r) => r.mainCategory },
    { key: "revenue", header: t("revenue"), align: "right", render: (r) => fmtUSD(r.revenue), sortValue: (r) => r.revenue },
    {
      key: "trend",
      header: t("vs_prev"),
      align: "right",
      render: (r) => (r.prevRevenue > 0 ? <DeltaBadge value={r.revenueDelta} /> : <span className="text-text-subtle">—</span>),
      sortValue: (r) => r.revenueDelta,
    },
    { key: "orders", header: t("orders"), align: "right", render: (r) => fmtNum(r.orders), sortValue: (r) => r.orders },
    { key: "avgOrder", header: t("avg_order"), align: "right", render: (r) => fmtUSD(r.avgOrder), sortValue: (r) => r.avgOrder },
    { key: "leads", header: t("crm_leads"), align: "right", render: (r) => fmtNum(r.leads), sortValue: (r) => r.leads },
    { key: "won", header: t("won"), align: "right", render: (r) => fmtNum(r.won), sortValue: (r) => r.won },
    { key: "winRate", header: t("win_rate"), align: "right", render: (r) => fmtPct(r.winRate, 1), sortValue: (r) => r.winRate },
    { key: "spend", header: t("spend"), align: "right", render: (r) => (r.spend > 0 ? fmtUSD(r.spend) : "—"), sortValue: (r) => r.spend },
    {
      key: "roas",
      header: t("roas"),
      align: "right",
      render: (r) => (r.spend > 0 ? <RoasPill roas={r.roas} /> : <span className="text-text-subtle">—</span>),
      sortValue: (r) => r.roas,
    },
  ];

  return (
    <AppShell title={t("courses")}>
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-[300px]" />
            <Skeleton className="h-[300px]" />
          </div>
          <Skeleton className="h-[400px]" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-muted">{t("rank_by")}</span>
            <Segmented
              value={metric}
              onChange={setMetric}
              options={[
                { value: "revenue", label: t("revenue") },
                { value: "roas", label: t("roas") },
                { value: "winRate", label: t("win_rate") },
                { value: "leads", label: t("leads_count") },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RankList
              title={t("top_performing")}
              tone="good"
              items={top}
              metric={metric}
              format={format}
            />
            <RankList
              title={t("underperforming")}
              tone="bad"
              items={data.underperforming}
              metric={metric}
              format={format}
              hint={
                lang === "ar"
                  ? "دورات أنفقت دون عائد كافٍ، أو انخفض إيرادها عن الفترة السابقة."
                  : "Courses spending without enough return, or down versus last period."
              }
            />
          </div>

          <DataTable
            rows={courses}
            cols={cols}
            searchable={(r) => `${r.course} ${r.mainCategory}`}
            initialSort={{ key: "revenue", dir: -1 }}
            csvFilename="engosoft-courses"
            csvRow={(r) => ({
              course: r.course,
              category: r.mainCategory,
              revenue: r.revenue.toFixed(2),
              revenue_change_pct: r.revenueDelta.toFixed(1),
              orders: r.orders,
              avg_order: r.avgOrder.toFixed(2),
              leads: r.leads,
              won: r.won,
              win_rate: r.winRate.toFixed(2),
              spend: r.spend.toFixed(2),
              roas: r.roas.toFixed(2),
            })}
          />
        </div>
      )}
    </AppShell>
  );
}

function RankList({
  title,
  tone,
  items,
  metric,
  format,
  hint,
}: {
  title: string;
  tone: "good" | "bad";
  items: CourseAgg[];
  metric: Metric;
  format: (n: number) => string;
  hint?: string;
}) {
  const { t } = useI18n();
  const color = tone === "good" ? "var(--success)" : "var(--danger)";
  const max = Math.max(1, ...items.map((c) => Math.abs(c[metric] as number)));

  return (
    <Card>
      <SectionTitle hint={hint}>
        <span className="inline-flex items-center gap-2">
          {tone === "good" ? (
            <Trophy size={16} style={{ color }} />
          ) : (
            <TrendingDown size={16} style={{ color }} />
          )}
          {title}
        </span>
      </SectionTitle>

      {items.length === 0 ? (
        <EmptyState label={t("no_data")} compact />
      ) : (
        <div className="space-y-3">
          {items.map((c, i) => {
            const v = Math.abs(c[metric] as number);
            return (
              <div key={c.course + i} className="stagger" style={{ "--i": i } as React.CSSProperties}>
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <span className="text-[13px] text-text truncate flex items-center gap-1.5" title={c.course}>
                    <span className="num text-[10px] text-text-subtle w-4 shrink-0">{i + 1}</span>
                    {c.course}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {c.prevRevenue > 0 && metric === "revenue" && <DeltaBadge value={c.revenueDelta} />}
                    <span className="num text-[13px] font-semibold text-text">{format(c[metric] as number)}</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${Math.max(2, (v / max) * 100)}%`, background: color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
