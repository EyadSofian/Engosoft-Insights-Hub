import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarClock, Info } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { fmtDate, fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import {
  BarList,
  Card,
  ErrorState,
  KpiCard,
  Notice,
  PageHeader,
  SectionTitle,
  Segmented,
  Skeleton,
} from "@/components/ui-bits";
import { DataTable, type Col } from "@/components/DataTable";
import type { DataHealth, Grouped, LostBreakdown, Matrix, Totals } from "@/lib/types";

export const Route = createFileRoute("/lost")({ component: Lost });

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
          {data.health.lostAuthority !== "odoo-direct" && (
            <Notice tone="danger" title={t("data_notes")} icon={<Info size={16} />}>
              {lang === "ar"
                ? "تعذّر قراءة أرشيف Odoo المباشر، لذلك أوقفنا أرقام Lost بدل ما نعرض نسخة قديمة بتاريخ غلط. جرّب تحديث الصفحة أو راجع اتصال Odoo."
                : "Direct Odoo archive is unavailable, so Lost figures are stopped instead of showing a legacy file under the wrong date. Refresh or check the Odoo connection."}
            </Notice>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              index={0}
              label={t("total_lost")}
              value={fmtNum(data.breakdown.total)}
              sub={
                lang === "ar"
                  ? "ليدز الفترة دي حسب تاريخ الإنشاء"
                  : "This period's lead cohort by creation date"
              }
            />
            <KpiCard
              index={1}
              label={lang === "ar" ? "CRM بدون Lost" : "Non-lost CRM"}
              value={fmtNum(data.totals.crmLeads)}
            />
            <KpiCard
              index={2}
              label={t("lost_rate")}
              value={fmtPct(data.totals.lostRate, 2)}
              sub={`${fmtNum(data.totals.lost)} / ${fmtNum(data.totals.totalLeads)}`}
            />
            <KpiCard
              index={3}
              label={lang === "ar" ? "عدد الأسباب" : "Distinct reasons"}
              value={fmtNum(data.breakdown.byReason.length)}
            />
          </div>

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

          <div className="grid gap-4 md:grid-cols-2">
            <Share title={t("loss_reason")} rows={data.breakdown.byReason} />
            <Share title={t("by_course")} rows={data.breakdown.byCourse} />
            <Share title={t("by_team")} rows={data.breakdown.byTeam} />
            <Share title={t("by_month")} rows={data.breakdown.byMonth} sorted />
            <Share title={t("by_salesperson")} rows={data.breakdown.bySalesperson} />
            <Share title={t("by_source")} rows={data.breakdown.bySource} />
          </div>

          <Card>
            <SectionTitle
              hint={
                lang === "ar"
                  ? "نسبة ضياع كل فريق محسوبة على عملائه هو، لا على إجمالي الخسائر — الفريق الكبير يخسر أكثر عدداً وأقل نسبةً."
                  : "Each team's lost rate is measured against its own leads, not the total lost pile."
              }
            >
              {lang === "ar" ? "نسبة الضياع لكل فريق" : "Lost rate per team"}
            </SectionTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[420px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                    <th className="text-start py-2">{t("team")}</th>
                    <th className="text-end py-2">{t("crm_leads")}</th>
                    <th className="text-end py-2">{t("lost_count")}</th>
                    <th className="text-end py-2">{t("lost_rate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.teamLostRates.map((r) => (
                    <tr key={r.team} className="border-t border-border">
                      <td className="py-2.5 pe-3 truncate max-w-[220px]" title={r.team}>
                        {r.team}
                      </td>
                      <td className="py-2.5 text-end num">{fmtNum(r.leads)}</td>
                      <td className="py-2.5 text-end num">{fmtNum(r.lost)}</td>
                      <td className="py-2.5 text-end num font-medium">{fmtPct(r.rate, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
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
              hint={
                lang === "ar"
                  ? "النسبة من إجمالي الخسائر في كل خلية"
                  : "Each cell is a share of total lost"
              }
            >
              {lang === "ar" ? "سبب الضياع × " : "Loss reason × "}
              {matrixView === "team" ? t("team") : t("course")}
            </SectionTitle>
            <MatrixTable
              matrix={
                matrixView === "team" ? data.breakdown.reasonByTeam : data.breakdown.reasonByCourse
              }
            />
          </Card>

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
        </>
      )}
    </div>
  );
}

function Share({ title, rows, sorted }: { title: string; rows: Grouped[]; sorted?: boolean }) {
  const items = (sorted ? rows : [...rows].sort((a, b) => b.count - a.count)).slice(0, 10);
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
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
    </Card>
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
