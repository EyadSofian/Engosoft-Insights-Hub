import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarClock, Info } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { fmtDate, fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import {
  BarList,
  Card,
  ErrorState,
  Notice,
  PageHeader,
  SectionTitle,
  Segmented,
  Skeleton,
} from "@/components/ui-bits";
import { DataTable, type Col } from "@/components/DataTable";
import type { DataHealth, Grouped, LostBreakdown, Matrix, Totals } from "@/lib/types";
import { hasReportableLost, usesStoredLost } from "@/lib/lost-authority";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";

export const Route = createFileRoute("/lost")({ component: Lost });

type ShareView = "reason" | "course" | "team" | "salesperson" | "source" | "month";

interface LostRowView {
  createdAt: string;
  closeDate: string;
  reportingDate: string;
  campaign: string;
  adName: string;
  reason: string;
  course: string;
  mainCategory: string;
  salesTeam: string;
  salesperson: string;
  source: string;
  stage: string;
}

interface Resp {
  breakdown: LostBreakdown;
  teamLostRates: { team: string; leads: number; lost: number; rate: number | null }[];
  totals: Totals;
  closureMovement: {
    closedLost: number;
    fromCampaign: number;
    createdInPeriod: number;
    campaignCreatedInPeriod: number;
    fromOlderCohorts: number;
  };
  detail: { rows: LostRowView[]; total: number; truncated: boolean };
  health: DataHealth;
}

function Lost() {
  const { t, lang } = useI18n();
  const [matrixView, setMatrixView] = useState<"team" | "course">("team");

  /** Tell Nexus which view is open — the route does not change with the tab. */
  useRegisterNexusView("lost", { tab: matrixView });
  const [shareView, setShareView] = useState<ShareView>("reason");
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/lost");

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const cols: Col<LostRowView>[] = [
    {
      key: "reportingDate",
      header: lang === "ar" ? "تاريخ إنشاء الليد" : "Lead creation date",
      sticky: true,
      width: "120px",
      sortValue: (r) => r.reportingDate,
      render: (r) => fmtDate(r.reportingDate, lang),
    },
    {
      key: "closeDate",
      header: lang === "ar" ? "اتقفل Lost إمتى" : "Lost close date",
      width: "120px",
      sortValue: (r) => r.closeDate,
      render: (r) => fmtDate(r.closeDate, lang),
    },
    {
      key: "reason",
      header: t("loss_reason"),
      sortValue: (r) => r.reason,
      render: (r) => (
        <span className="truncate block max-w-[220px]" title={r.reason}>
          {r.reason || "—"}
        </span>
      ),
    },
    {
      key: "course",
      header: t("course"),
      sortValue: (r) => r.course,
      render: (r) => r.course || "—",
    },
    {
      key: "salesTeam",
      header: t("sales_team"),
      sortValue: (r) => r.salesTeam,
      render: (r) => (
        <span className="truncate block max-w-[160px]" title={r.salesTeam}>
          {r.salesTeam || "—"}
        </span>
      ),
    },
    {
      key: "salesperson",
      header: t("salesperson"),
      sortValue: (r) => r.salesperson,
      render: (r) => (
        <span className="truncate block max-w-[150px]" title={r.salesperson}>
          {r.salesperson || "—"}
        </span>
      ),
    },
    {
      key: "source",
      header: t("source"),
      sortValue: (r) => r.source,
      render: (r) => r.source || "—",
    },
    {
      key: "campaign",
      header: t("campaign"),
      sortValue: (r) => r.campaign,
      render: (r) => (
        <span className="truncate block max-w-[180px]" title={r.campaign}>
          {r.campaign || "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("lost")}
        subtitle={
          lang === "ar"
            ? "تحليل جودة التسويق حسب تاريخ دخول الليد، وحركة الإغلاق ظاهرة لوحدها"
            : "Marketing quality by lead creation date, with closures reported separately"
        }
      />

      {isLoading || !data ? (
        <>
          <Skeleton className="h-28" />
          <Skeleton className="h-96" />
        </>
      ) : (
        <>
          {!hasReportableLost(data.health.lostAuthority) && (
            <Notice tone="danger" title={t("data_notes")} icon={<Info size={16} />}>
              {lang === "ar"
                ? "بيانات Archived Lost غير متاحة لا من Odoo ولا من آخر نسخة آمنة في PostgreSQL، لذلك أوقفنا أرقام Lost بدل ما نعرض صفر مضلل."
                : "Archived Lost is unavailable from both Odoo and the safe PostgreSQL snapshot, so Lost figures are stopped instead of showing a misleading zero."}
            </Notice>
          )}
          {usesStoredLost(data.health.lostAuthority) && (
            <Notice tone="warning" title={t("data_notes")} icon={<Info size={16} />}>
              {lang === "ar"
                ? "أرقام Lost المعروضة جاية من آخر نسخة ناجحة من Odoo Archived Lost محفوظة في PostgreSQL؛ المصدر المباشر متعذر مؤقتًا، لكن البيانات مش مفقودة ومش محسوبة صفر."
                : "Lost figures come from the last successful Odoo Archived Lost snapshot stored in PostgreSQL. The direct source is temporarily unavailable, but the data is present and is not treated as zero."}
            </Notice>
          )}

          <Card padded={false} className="overflow-hidden">
            <div className="grid grid-cols-2 divide-x divide-y divide-border md:grid-cols-4 md:divide-y-0 rtl:divide-x-reverse">
              <LostMetric
                label={t("total_lost")}
                value={fmtNum(data.breakdown.total)}
                note={lang === "ar" ? "حسب تاريخ إنشاء الليد" : "By lead creation date"}
              />
              <LostMetric
                label={t("lost_rate")}
                value={fmtPct(data.totals.lostRate, 2)}
                note={`${fmtNum(data.totals.lost)} / ${fmtNum(data.totals.totalLeads)}`}
              />
              <LostMetric
                label={lang === "ar" ? "اتقفل خلال الفترة" : "Closed in period"}
                value={fmtNum(data.closureMovement.closedLost)}
                note={lang === "ar" ? "حسب تاريخ الإغلاق" : "By close date"}
              />
              <LostMetric
                label={lang === "ar" ? "أقدم سبب متكرر" : "Top recurring reason"}
                value={data.breakdown.byReason[0]?.label || "—"}
                note={
                  data.breakdown.byReason[0]
                    ? `${fmtNum(data.breakdown.byReason[0].count)} · ${fmtPct(data.breakdown.byReason[0].share, 1)}`
                    : undefined
                }
                compact
              />
            </div>
          </Card>

          <Card className="border-brand/20 bg-brand-soft/35">
            <SectionTitle
              hint={
                lang === "ar"
                  ? "ده تقرير حركة تشغيلية بتاريخ الإغلاق؛ منفصل عن تحليل جودة حملات الفترة اللي فوق."
                  : "This operational movement uses close date and stays separate from the acquisition cohort above."
              }
            >
              <span className="inline-flex items-center gap-2">
                <CalendarClock size={17} className="text-brand" />
                {lang === "ar"
                  ? "إيه اللي اتقفل Lost خلال الفترة؟"
                  : "What closed Lost in the period?"}
              </span>
            </SectionTitle>
            <p className="mb-4 text-sm leading-7 text-text-muted">
              {lang === "ar"
                ? `خلال الفترة اتقفل ${fmtNum(data.closureMovement.closedLost)} ليد Lost. منهم ${fmtNum(data.closureMovement.campaignCreatedInPeriod)} جايين من Campaign واتعملوا أصلًا في نفس الفترة، و${fmtNum(data.closureMovement.fromOlderCohorts)} كانوا ليدز أقدم واتقفلوا دلوقتي.`
                : `${fmtNum(data.closureMovement.closedLost)} leads closed Lost in the period. ${fmtNum(data.closureMovement.campaignCreatedInPeriod)} were campaign leads created in the same period, while ${fmtNum(data.closureMovement.fromOlderCohorts)} came from older cohorts.`}
            </p>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {[
                [lang === "ar" ? "اتقفل Lost" : "Closed Lost", data.closureMovement.closedLost],
                [
                  lang === "ar" ? "عليه Campaign" : "With campaign",
                  data.closureMovement.fromCampaign,
                ],
                [
                  lang === "ar" ? "اتعمل في نفس الفترة" : "Created in period",
                  data.closureMovement.createdInPeriod,
                ],
                [
                  lang === "ar" ? "Campaign من نفس الفترة" : "Period campaign cohort",
                  data.closureMovement.campaignCreatedInPeriod,
                ],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="rounded-xl border border-border bg-surface/85 p-3"
                >
                  <div className="text-[11px] text-text-muted">{label}</div>
                  <div className="num mt-1 text-xl font-semibold text-text">
                    {fmtNum(Number(value))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle
              hint={
                lang === "ar"
                  ? "اختار زاوية واحدة بدل عرض كل الرسومات معًا."
                  : "Choose one lens instead of displaying every chart at once."
              }
            >
              {lang === "ar" ? "أين تتجمع الخسائر؟" : "Where are losses concentrated?"}
            </SectionTitle>
            <div className="hscroll mb-5 flex gap-2">
              {(
                [
                  ["reason", t("loss_reason")],
                  ["course", t("by_course")],
                  ["team", t("by_team")],
                  ["salesperson", t("by_salesperson")],
                  ["source", t("by_source")],
                  ["month", t("by_month")],
                ] as [ShareView, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setShareView(key)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${shareView === key ? "border-danger bg-danger-soft text-danger" : "border-border text-text-muted hover:bg-surface-2"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <ShareRows rows={shareRows(data.breakdown, shareView)} sorted={shareView === "month"} />
          </Card>

          <details className="card overflow-hidden">
            <summary className="cursor-pointer list-none px-4 py-4 text-sm font-semibold text-text sm:px-5">
              {lang === "ar"
                ? "تحليل متقدم: نسب الفرق ومصفوفة الأسباب"
                : "Advanced: team rates and reason matrix"}
            </summary>
            <div className="space-y-5 border-t border-border p-4 sm:p-5">
              <div className="table-wrap scroll-hint-x">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                      <th className="py-2 text-start">{t("team")}</th>
                      <th className="py-2 text-end">{t("crm_leads")}</th>
                      <th className="py-2 text-end">{t("lost_count")}</th>
                      <th className="py-2 text-end">{t("lost_rate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.teamLostRates.map((row) => (
                      <tr key={row.team} className="border-t border-border">
                        <td className="max-w-[220px] truncate py-2.5 pe-3" title={row.team}>
                          {row.team}
                        </td>
                        <td className="num py-2.5 text-end">{fmtNum(row.leads)}</td>
                        <td className="num py-2.5 text-end">{fmtNum(row.lost)}</td>
                        <td className="num py-2.5 text-end font-medium">{fmtPct(row.rate, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <SectionTitle
                action={
                  <Segmented
                    value={matrixView}
                    onChange={setMatrixView}
                    options={[
                      { value: "team", label: t("by_team") },
                      { value: "course", label: t("by_course") },
                    ]}
                  />
                }
              >
                {lang === "ar" ? "سبب الضياع × " : "Loss reason × "}
                {matrixView === "team" ? t("team") : t("course")}
              </SectionTitle>
              <MatrixTable
                matrix={
                  matrixView === "team"
                    ? data.breakdown.reasonByTeam
                    : data.breakdown.reasonByCourse
                }
              />
            </div>
          </details>

          <details className="card overflow-hidden">
            <summary className="cursor-pointer list-none px-4 py-4 text-sm font-semibold text-text sm:px-5">
              {lang === "ar"
                ? `السجلات التفصيلية (${fmtNum(data.detail.total)})`
                : `Detailed records (${fmtNum(data.detail.total)})`}
            </summary>
            <div className="border-t border-border p-3">
              <DataTable
                rows={data.detail.rows}
                cols={cols}
                searchable={(r) =>
                  `${r.reason} ${r.course} ${r.salesTeam} ${r.salesperson} ${r.campaign}`
                }
                initialSort={{ key: "reportingDate", dir: -1 }}
                csvFilename="engosoft-lost"
                maxHeight={620}
                csvRow={(r) => ({
                  created: r.createdAt,
                  close_date: r.closeDate,
                  reporting_date: r.reportingDate,
                  reason: r.reason,
                  course: r.course,
                  main_category: r.mainCategory,
                  sales_team: r.salesTeam,
                  salesperson: r.salesperson,
                  source: r.source,
                  campaign: r.campaign,
                  ad_name: r.adName,
                  stage: r.stage,
                })}
              />
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function LostMetric({
  label,
  value,
  note,
  compact = false,
}: {
  label: string;
  value: string;
  note?: string;
  compact?: boolean;
}) {
  return (
    <div className="min-h-28 p-4 sm:p-5">
      <div className="text-[11px] font-semibold text-text-muted">{label}</div>
      <div
        className={`mt-2 font-semibold text-text ${compact ? "line-clamp-2 text-base leading-snug" : "num text-2xl"}`}
      >
        {value}
      </div>
      {note && <div className="mt-2 text-[10px] text-text-subtle">{note}</div>}
    </div>
  );
}

function shareRows(breakdown: LostBreakdown, view: ShareView): Grouped[] {
  return {
    reason: breakdown.byReason,
    course: breakdown.byCourse,
    team: breakdown.byTeam,
    salesperson: breakdown.bySalesperson,
    source: breakdown.bySource,
    month: breakdown.byMonth,
  }[view];
}

function ShareRows({ rows, sorted }: { rows: Grouped[]; sorted?: boolean }) {
  const items = (sorted ? rows : [...rows].sort((a, b) => b.count - a.count)).slice(0, 10);
  return (
    <BarList
      items={items.map((g) => ({
        label: g.label,
        value: g.count,
        meta: (
          <span>
            <span className="num">{fmtNum(g.count)}</span>
            <span className="num text-[11px] text-text-muted ms-1.5">({fmtPct(g.share, 1)})</span>
          </span>
        ),
      }))}
      format={fmtNum}
      color="var(--danger)"
    />
  );
}

function MatrixTable({ matrix }: { matrix: Matrix }) {
  const { lang } = useI18n();
  if (!matrix.rows.length) return null;
  const share = (n: number) => (matrix.total > 0 ? (n / matrix.total) * 100 : 0);
  // Cell tint scales with the largest single cell so the hot spots stand out.
  const peak = Math.max(...matrix.cells.flat(), 1);

  return (
    <div className="table-wrap" style={{ maxHeight: 480 }}>
      <table className="text-sm border-separate border-spacing-0 min-w-full">
        <thead className="sticky top-0 z-10">
          <tr>
            <th
              className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide bg-surface-2 border-b border-border text-start sticky-col z-20 text-text-muted"
              style={{ background: "var(--surface-2)", minWidth: 200 }}
            >
              {lang === "ar" ? "السبب" : "Reason"}
            </th>
            {matrix.cols.map((c) => (
              <th
                key={c}
                className="px-2 py-2.5 text-[11px] font-semibold bg-surface-2 border-b border-border text-end text-text-muted whitespace-nowrap"
                title={c}
              >
                <span className="block max-w-[110px] truncate">{c}</span>
              </th>
            ))}
            <th className="px-3 py-2.5 text-[11px] font-semibold uppercase bg-surface-2 border-b border-border text-end text-text-muted">
              {lang === "ar" ? "الإجمالي" : "Total"}
            </th>
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((r, i) => (
            <tr key={r} className="group">
              <td className="px-3 py-2 border-b border-border sticky-col bg-surface group-hover:bg-brand-soft transition-colors">
                <span className="block max-w-[220px] truncate" title={r}>
                  {r}
                </span>
              </td>
              {matrix.cells[i].map((v, j) => (
                <td
                  key={j}
                  className="px-2 py-2 border-b border-border text-end num whitespace-nowrap"
                  style={{
                    background:
                      v > 0
                        ? `color-mix(in oklab, var(--danger-soft) ${Math.round((v / peak) * 100)}%, transparent)`
                        : undefined,
                  }}
                  title={`${v} · ${fmtPct(share(v), 1)}`}
                >
                  {v === 0 ? (
                    <span className="text-text-subtle">—</span>
                  ) : (
                    <>
                      {fmtNum(v)}
                      <span className="text-[10px] text-text-muted ms-1">
                        {share(v).toFixed(1)}%
                      </span>
                    </>
                  )}
                </td>
              ))}
              <td className="px-3 py-2 border-b border-border text-end num font-semibold bg-surface-2/60">
                {fmtNum(matrix.rowTotals[i])}
                <span className="text-[10px] text-text-muted ms-1">
                  {share(matrix.rowTotals[i]).toFixed(1)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
