import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarClock, Info, MessageSquareWarning, Percent, TrendingDown } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { fmtDate, fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import {
  BarList,
  Card,
  ErrorState,
  Notice,
  SectionTitle,
  Segmented,
  Skeleton,
} from "@/components/ui-bits";
import { DashboardPageHeader, DataHealthSummary, KpiRow } from "@/components/dashboard-bits";
import { MetricDetailTrigger } from "@/components/metric-detail";
import type { MetricBreakdownGroup, MetricDetail } from "@/lib/metric-detail";
import { useReportingPeriod } from "@/lib/use-reporting-period";
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

/** A Lost distribution the response already carried, as a drill-down section. */
function lostSection(
  id: string,
  title: string,
  rows: Grouped[],
  lang: "ar" | "en",
): MetricBreakdownGroup {
  return {
    id,
    title,
    rows: [...rows]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((row) => ({
        key: row.label,
        label: row.label,
        value: row.count,
        display: fmtNum(row.count),
        meta: fmtPct(row.share, 1),
        tone: "rose" as const,
      })),
    emptyLabel: lang === "ar" ? "لا توجد بيانات في الفترة" : "Nothing in this period",
  };
}

/**
 * What the four Lost figures are made of.
 *
 * The two dates matter more here than anywhere else on the dashboard: "total
 * lost" counts leads CREATED in the window, and "closed in period" counts deals
 * CLOSED in it. They are different populations and the drill-down says so.
 */
function lostMetrics(data: Resp, lang: "ar" | "en"): Record<string, MetricDetail> {
  const A = lang === "ar";
  const B = data.breakdown;
  const T = data.totals;
  const M = data.closureMovement;
  const topReason = B.byReason[0] ?? null;

  const common = [
    lostSection("reasons", A ? "أهم أسباب الخسارة" : "Main loss reasons", B.byReason, lang),
    lostSection("teams", A ? "أكثر الفرق تأثرًا" : "Most affected teams", B.byTeam, lang),
    lostSection("courses", A ? "أكثر الدورات تأثرًا" : "Most affected courses", B.byCourse, lang),
    lostSection("sources", A ? "حسب المصدر" : "By source", B.bySource, lang),
  ];

  return {
    total: {
      id: "lost.lost",
      title: A ? "إجمالي الصفقات الضائعة" : "Total lost",
      value: fmtNum(B.total),
      tone: "rose",
      icon: <TrendingDown size={16} />,
      definition: A
        ? "العملاء الذين أُنشئوا داخل الفترة وانتهت صفقتهم بالخسارة، من مصدر الخسائر المعتمد وحده."
        : "Leads created inside the window whose deal ended as lost, from the approved Lost source only.",
      formula: A
        ? `${fmtNum(B.total)} صفقة ضائعة، محسوبة بتاريخ إنشاء الليد لا بتاريخ إغلاقه.`
        : `${fmtNum(B.total)} lost deals, counted on the lead's creation date and not on its close date.`,
      supporting: [
        { key: "rate", label: A ? "نسبة الخسارة" : "Lost rate", value: fmtPct(T.lostRate, 2) },
        { key: "leads", label: A ? "إجمالي العملاء" : "All leads", value: fmtNum(T.totalLeads) },
        { key: "won", label: A ? "صفقات رابحة" : "Won deals", value: fmtNum(T.won) },
        {
          key: "closed",
          label: A ? "أُغلقت في الفترة" : "Closed in period",
          value: fmtNum(M.closedLost),
        },
      ],
      breakdowns: common,
      records: {
        title: A ? "نسبة الخسارة حسب الفريق" : "Lost rate by team",
        rows: [...data.teamLostRates]
          .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
          .slice(0, 5)
          .map((row) => ({
            key: row.team,
            title: row.team,
            subtitle: `${fmtNum(row.lost)} / ${fmtNum(row.leads)}`,
            value: fmtPct(row.rate, 1),
          })),
      },
    },
    rate: {
      id: "lost.lostRate",
      title: A ? "نسبة الخسارة" : "Lost rate",
      value: fmtPct(T.lostRate, 2),
      tone: "rose",
      icon: <Percent size={16} />,
      definition: A
        ? "نسبة العملاء المحتملين الذين انتهت صفقتهم بالخسارة داخل الفترة. النسبة وحدها بلا معنى بغير عدديها."
        : "The share of leads whose deal ended as lost inside the period. The percentage means nothing without both of its numbers.",
      formula: `${fmtNum(T.lost)} ÷ ${fmtNum(T.totalLeads)} = ${fmtPct(T.lostRate, 2)}`,
      supporting: [
        { key: "lost", label: A ? "البسط · ضائعة" : "Numerator · lost", value: fmtNum(T.lost) },
        {
          key: "leads",
          label: A ? "المقام · كل العملاء" : "Denominator · all leads",
          value: fmtNum(T.totalLeads),
        },
        { key: "won", label: A ? "رابحة" : "Won", value: fmtNum(T.won) },
        {
          key: "open",
          label: A ? "ما زال مفتوحًا" : "Still open",
          value: fmtNum(Math.max(0, T.totalLeads - T.won - T.lost)),
        },
      ],
      breakdowns: [
        {
          id: "teams",
          title: A ? "النسبة حسب الفريق" : "Rate by team",
          rows: [...data.teamLostRates]
            .filter((row) => row.leads > 0)
            .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
            .slice(0, 5)
            .map((row) => ({
              key: row.team,
              label: row.team,
              value: row.rate ?? 0,
              display: fmtPct(row.rate, 1),
              meta: `${fmtNum(row.lost)} / ${fmtNum(row.leads)}`,
              tone: "rose" as const,
            })),
          emptyLabel: A ? "لا توجد فرق بعملاء" : "No team carries leads",
        },
        ...common.slice(0, 2),
      ],
    },
    closed: {
      id: "lost.closed",
      title: A ? "اتقفل خلال الفترة" : "Closed in period",
      value: fmtNum(M.closedLost),
      tone: "amber",
      icon: <CalendarClock size={16} />,
      definition: A
        ? "الصفقات التي أُغلقت خاسرة داخل الفترة أيًا كان تاريخ إنشائها. هذا مقياس عمل الفترة، بخلاف الرقم المجاور الذي يقيس كوهورت الليدز."
        : "Deals closed as lost inside the window, whatever their creation date. This measures the period's work, unlike the figure beside it, which measures the period's lead cohort.",
      formula: A
        ? `منها ${fmtNum(M.createdInPeriod)} أُنشئت داخل الفترة و${fmtNum(M.fromOlderCohorts)} من كوهورتات أقدم.`
        : `Of these, ${fmtNum(M.createdInPeriod)} were created inside the window and ${fmtNum(M.fromOlderCohorts)} came from older cohorts.`,
      supporting: [
        {
          key: "created",
          label: A ? "أُنشئت داخل الفترة" : "Created in period",
          value: fmtNum(M.createdInPeriod),
        },
        {
          key: "older",
          label: A ? "من كوهورتات أقدم" : "From older cohorts",
          value: fmtNum(M.fromOlderCohorts),
        },
        {
          key: "campaign",
          label: A ? "من حملات" : "From campaigns",
          value: fmtNum(M.fromCampaign),
        },
        { key: "cohort", label: A ? "كوهورت الفترة" : "Cohort lost", value: fmtNum(B.total) },
      ],
      breakdowns: common.slice(0, 3),
    },
    reason: {
      id: "lost.reason",
      title: A ? "أقدم سبب متكرر" : "Top recurring reason",
      value: topReason?.label ?? "—",
      tone: "amber",
      icon: <MessageSquareWarning size={16} />,
      definition: topReason
        ? A
          ? `أكثر سبب خسارة تكرارًا في الفترة: ${fmtNum(topReason.count)} صفقة، أي ${fmtPct(topReason.share, 1)} من كل الخسائر المصنّفة.`
          : `The most frequent loss reason in the period: ${fmtNum(topReason.count)} deals, ${fmtPct(topReason.share, 1)} of all classified losses.`
        : A
          ? "لا توجد أسباب خسارة مصنّفة في هذه الفترة."
          : "No classified loss reason in this period.",
      supporting: topReason
        ? [
            { key: "count", label: A ? "عدد الصفقات" : "Deals", value: fmtNum(topReason.count) },
            { key: "share", label: A ? "نسبتها" : "Share", value: fmtPct(topReason.share, 1) },
            { key: "total", label: A ? "إجمالي الخسائر" : "Total lost", value: fmtNum(B.total) },
            {
              key: "reasons",
              label: A ? "عدد الأسباب المصنّفة" : "Classified reasons",
              value: fmtNum(B.byReason.length),
            },
          ]
        : undefined,
      breakdowns: [common[0], common[2]],
    },
  };
}

function Lost() {
  const reportingPeriod = useReportingPeriod();
  const { t, lang } = useI18n();
  const [matrixView, setMatrixView] = useState<"team" | "course">("team");

  /** Tell Nexus which view is open — the route does not change with the tab. */
  useRegisterNexusView("lost", { tab: matrixView });
  const [shareView, setShareView] = useState<ShareView>("reason");
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/lost");

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  // Built from the response the strip already renders, so a card and its panel
  // can never disagree.
  const metrics = data ? lostMetrics(data, lang) : null;

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
    <div className="page-sections">
      <DashboardPageHeader
        flush
        icon={<TrendingDown size={20} />}
        title={t("lost")}
        subtitle={
          lang === "ar"
            ? "تحليل جودة التسويق حسب تاريخ دخول الليد، وحركة الإغلاق ظاهرة لوحدها"
            : "Marketing quality by lead creation date, with closures reported separately"
        }
        period={reportingPeriod}
      />

      {isLoading || !data ? (
        <>
          <Skeleton className="h-28" />
          <Skeleton className="h-96" />
        </>
      ) : (
        <>
          {/* The reader is told exactly what is wrong with the figures — that
              they are stopped, or that they are a stored copy — because both
              change what the page means. What they are not told on the page
              itself is which store the copy lives in: naming the database is
              an instruction to nobody who reads this report. It stays one
              disclosure away, for whoever can act on it. */}
          {!hasReportableLost(data.health.lostAuthority) && (
            <DataHealthSummary
              issues={[
                {
                  tone: "danger",
                  message:
                    lang === "ar"
                      ? "أرقام الخسائر متوقفة في هذه الفترة."
                      : "Lost figures are stopped for this period.",
                  impact:
                    lang === "ar"
                      ? "المصدر المعتمد للخسائر غير متاح، ونعرض توقفاً بدلاً من صفر مضلل."
                      : "The approved Lost source is unavailable, so the report stops rather than showing a misleading zero.",
                  technical:
                    lang === "ar"
                      ? "Archived Lost غير متاح من Odoo مباشرة ولا من آخر نسخة مخزّنة."
                      : "Archived Lost is unavailable from Odoo directly and from the last stored snapshot.",
                },
              ]}
            />
          )}
          {usesStoredLost(data.health.lostAuthority) && (
            <DataHealthSummary
              issues={[
                {
                  tone: "warning",
                  message:
                    lang === "ar"
                      ? "أرقام الخسائر معروضة من آخر نسخة ناجحة."
                      : "Lost figures are served from the last good copy.",
                  impact:
                    lang === "ar"
                      ? "البيانات موجودة وغير محسوبة صفراً، لكن أحدث الصفوف قد تنقص."
                      : "The data is present and is not counted as zero, but the newest rows may be missing.",
                  technical:
                    lang === "ar"
                      ? "المصدر المباشر Odoo Archived Lost متعذر مؤقتاً؛ يتم استخدام النسخة المخزّنة."
                      : "The direct Odoo Archived Lost source is temporarily unreachable; the stored snapshot is in use.",
                },
              ]}
            />
          )}

          {/* Four coloured cards rather than four cells of a divided strip
              inside a card. Same four figures, each of them now openable — and
              one less card-inside-a-card. */}
          <KpiRow>
            <MetricDetailTrigger
              detail={{ ...metrics!.total, title: t("total_lost") }}
              card={{
                index: 0,
                sub: lang === "ar" ? "حسب تاريخ إنشاء الليد" : "By lead creation date",
              }}
            />
            <MetricDetailTrigger
              detail={{ ...metrics!.rate, title: t("lost_rate") }}
              card={{
                index: 1,
                sub: `${fmtNum(data.totals.lost)} / ${fmtNum(data.totals.totalLeads)}`,
              }}
            />
            <MetricDetailTrigger
              detail={metrics!.closed}
              card={{ index: 2, sub: lang === "ar" ? "حسب تاريخ الإغلاق" : "By close date" }}
            />
            <MetricDetailTrigger
              detail={metrics!.reason}
              card={{
                index: 3,
                valueWrap: true,
                sub: data.breakdown.byReason[0]
                  ? `${fmtNum(data.breakdown.byReason[0].count)} · ${fmtPct(data.breakdown.byReason[0].share, 1)}`
                  : undefined,
              }}
            />
          </KpiRow>

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
