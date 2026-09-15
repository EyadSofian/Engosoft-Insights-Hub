import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BookOpenCheck, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { useFilters } from "@/lib/filter-store";
import { fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { Card, EmptyState, Notice, Pill, SectionTitle, Skeleton } from "@/components/ui-bits";
import { DashboardPanel, KpiRow, MoreDetails, PageSection } from "@/components/dashboard-bits";
import { AcosPill, CloseTime, CountPct, RoasCell } from "@/components/metric-bits";
import { MetricDetailTrigger } from "@/components/metric-detail";
import { CampaignActivityPanel } from "@/components/CampaignActivityPanel";
import { HBarChart } from "@/components/charts";
import {
  overviewEfficiencyMetrics,
  type CourseSaleContribution,
  type OverviewResp,
} from "@/components/overview-metrics";
import {
  formatDisplayMoney,
  usdToDisplayCurrency,
  type DisplayCurrency,
} from "@/lib/display-currency";
import { fxRatesFromFilters } from "@/lib/fx-rates";
import type { AgentAnalyticsResult } from "@/lib/agent-analytics.server";
import type { PerfRow } from "@/lib/types";

/* -------------------------------------------------------------------------
   THE RECORDS THAT USED TO SIT UNDER THE EXECUTIVE SUMMARY

   Every block here was on the home page, below the figures it supports, and
   each one made that page longer without answering the question the page
   exists to answer. They are the same components, reading the same response —
   they now live in the report each one belongs to, behind a disclosure:
   campaign records under Campaigns, CRM efficiency under Leads, course
   contribution under Courses.
------------------------------------------------------------------------- */

function useOverview() {
  return useApi<OverviewResp>("/api/overview");
}

function LeadOriginCard({ data, lang }: { data: OverviewResp; lang: "ar" | "en" }) {
  const { t } = useI18n();
  return (
    <>
      <Card>
        <SectionTitle hint={t("origin_note")}>{t("lead_origin")}</SectionTitle>
        <div className="card-grid sm:grid-cols-2">
          {data.origin.cohorts.map((c) => (
            <div key={c.key} className="rounded-xl border border-border p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-text">
                  {c.key === "campaign" ? t("from_campaigns") : t("other_sources")}
                </span>
                <Pill tone={c.key === "campaign" ? "brand" : "neutral"}>{fmtNum(c.leads)}</Pill>
              </div>
              <dl className="grid grid-cols-2 gap-y-2 text-[13px]">
                <dt className="text-text-muted">{t("won")}</dt>
                <dd className="text-end">
                  <CountPct count={c.won} pct={c.conversionRate} />
                </dd>
                <dt className="text-text-muted">{t("lost_count")}</dt>
                <dd className="text-end">
                  <CountPct count={c.lost} pct={c.lostRate} />
                </dd>
                <dt className="text-text-muted">{t("revenue")}</dt>
                <dd className="num text-end font-medium">{fmtUSD(c.revenue)}</dd>
                <dt className="text-text-muted">{t("avg_close_time")}</dt>
                <dd className="text-end text-[12px]">
                  <CloseTime days={c.avgCloseDays} sample={c.closeSample} />
                </dd>
              </dl>
            </div>
          ))}
        </div>
        {data.origin.otherBySource.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-text-muted">
              {lang === "ar" ? "توزيع العملاء بلا حملة حسب المصدر" : "Non-campaign leads by source"}
            </div>
            <HBarChart
              data={data.origin.otherBySource
                .slice(0, 8)
                .map((g) => ({ label: g.label, value: g.count }))}
              format={fmtNum}
              name={t("leads")}
              color="var(--chart-3)"
              height={200}
            />
          </div>
        )}
      </Card>
    </>
  );
}

function BudgetLeaksCard({ rows, lang }: { rows: PerfRow[]; lang: "ar" | "en" }) {
  const { t } = useI18n();
  return (
    <>
      <Card>
        <SectionTitle
          hint={
            lang === "ar"
              ? "حملات أنفقت ولم تُعد ما يساوي إنفاقها"
              : "Campaigns that spent more than they returned"
          }
        >
          {t("where_budget_goes")}
        </SectionTitle>
        {rows.length === 0 ? (
          <EmptyState
            label={
              lang === "ar"
                ? "لا توجد حملات خاسرة في هذه الفترة"
                : "No loss-making campaigns in this period"
            }
            compact
          />
        ) : (
          <div className="table-wrap scroll-hint-x">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="py-2 text-start">{t("campaign")}</th>
                  <th className="py-2 text-end">{t("spend")}</th>
                  <th className="py-2 text-end">{t("revenue")}</th>
                  <th className="py-2 text-end">{t("crm_leads")}</th>
                  <th className="py-2 text-end">{t("roas")}</th>
                  <th className="py-2 text-end">{t("acos")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-border">
                    <td className="max-w-[240px] truncate py-2.5 pe-3" title={r.name}>
                      {r.name}
                    </td>
                    <td className="num py-2.5 text-end">{fmtUSD(r.spend)}</td>
                    <td className="num py-2.5 text-end">{fmtUSD(r.revenue)}</td>
                    <td className="num py-2.5 text-end">{fmtNum(r.crmLeads)}</td>
                    <td className="py-2.5 text-end">
                      <RoasCell roas={r.roas} spend={r.spend} />
                    </td>
                    <td className="py-2.5 text-end">
                      <AcosPill acos={r.acos} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function AccountsCard({
  accounts,
  nonLeadSpend,
  lang,
}: {
  accounts: OverviewResp["accounts"];
  nonLeadSpend: number;
  lang: "ar" | "en";
}) {
  const { t } = useI18n();
  return (
    <>
      <Card>
        <SectionTitle
          hint={
            lang === "ar"
              ? "كل الحسابات، بما فيها «زيارات» و«غير معروف»، داخلة في إجمالي الإنفاق ومعادلات الكفاءة"
              : "Every account, including traffic and unknown, is included in total spend and efficiency formulas"
          }
        >
          {t("account")}
        </SectionTitle>
        <div className="table-wrap scroll-hint-x">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                <th className="py-2 text-start">{t("account")}</th>
                <th className="py-2 text-end">{t("spend")}</th>
                <th className="py-2 text-end">{t("platform_leads")}</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.name} className="border-t border-border">
                  <td className="py-2.5 pe-3">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span className="max-w-[200px] truncate" title={a.name}>
                        {a.name}
                      </span>
                      {a.objective !== "leads" && (
                        <Pill tone="warning">
                          {a.objective === "traffic"
                            ? lang === "ar"
                              ? "زيارات"
                              : "traffic"
                            : lang === "ar"
                              ? "غير معروف"
                              : "unknown"}
                        </Pill>
                      )}
                    </span>
                  </td>
                  <td className="num py-2.5 text-end">{fmtUSDFull(a.spend)}</td>
                  <td className="num py-2.5 text-end">
                    {a.platformLeads === null ? (
                      <span className="text-text-subtle">—</span>
                    ) : (
                      fmtNum(a.platformLeads)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {nonLeadSpend > 0 && (
        <Notice tone="warning" title={t("non_lead_spend")} icon={<Info size={16} />}>
          {lang === "ar"
            ? `${fmtUSDFull(nonLeadSpend)} أُنفقت على حسابات زيارات أو حسابات بلا اسم. المبلغ داخل إجمالي الإنفاق وكل معادلات الكفاءة طبقاً لتعريف الإدارة.`
            : `${fmtUSDFull(nonLeadSpend)} ran on traffic or unnamed accounts. It remains included in total spend and every efficiency formula by the approved management definition.`}
        </Notice>
      )}
    </>
  );
}

/**
 * "أفضل الكورسات في الفترة" — the shortest honest answer to "what is selling".
 *
 * Five rows out of `data.courseSales`, which is already sorted by revenue, and
 * a link to the full report. Rank, name, revenue and — where the response
 * carries it — how many paid invoices are behind that revenue, because "أعلى
 * إيراد" from three invoices and from ninety are different facts.
 *
 * Deliberately not a table: the column that would answer the next question is
 * on /courses, and this card's job is to get the reader there.
 */
function TopCoursesPanel({
  rows,
  currency,
  sarRate,
  lang,
}: {
  rows: CourseSaleContribution[];
  currency: DisplayCurrency;
  sarRate: number;
  lang: "ar" | "en";
}) {
  const shown = rows.slice(0, 5);
  return (
    <DashboardPanel
      tone="amber"
      icon={<BookOpenCheck size={16} />}
      title={lang === "ar" ? "أفضل الكورسات في الفترة" : "Top courses this period"}
      hint={lang === "ar" ? "مرتبة بالإيراد المحصّل." : "Ranked by collected revenue."}
      footer={
        <Link
          to="/courses"
          className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"
        >
          {lang === "ar" ? "عرض كل الكورسات" : "View all courses"}
          {lang === "ar" ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </Link>
      }
    >
      {shown.length === 0 ? (
        <EmptyState
          label={
            lang === "ar" ? "لا توجد مبيعات كورسات في الفترة" : "No course sales in this period"
          }
          compact
        />
      ) : (
        <ol className="space-y-2.5">
          {shown.map((row, index) => (
            <li key={row.course} className="flex items-center gap-2.5">
              <span
                className="num grid size-6 shrink-0 place-items-center rounded-lg text-[11px] font-bold"
                style={
                  index === 0
                    ? { background: "var(--amber-strong)", color: "#fff" }
                    : { background: "var(--amber-surface)", color: "var(--amber-ink)" }
                }
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-[13px] font-semibold text-text"
                  title={row.course}
                >
                  {row.course}
                </span>
                {row.paidInvoices > 0 && (
                  <span className="block text-[10.5px] text-text-muted">
                    {fmtNum(row.paidInvoices)} {lang === "ar" ? "فاتورة مدفوعة" : "paid invoices"}
                  </span>
                )}
              </span>
              <bdi className="num shrink-0 text-[13px] font-bold text-text">
                {formatDisplayMoney(
                  usdToDisplayCurrency(row.revenue, currency, sarRate),
                  currency,
                  lang,
                )}
              </bdi>
            </li>
          ))}
        </ol>
      )}
    </DashboardPanel>
  );
}

function CourseContributionChart({
  rows,
  currency,
  sarRate,
  lang,
}: {
  rows: CourseSaleContribution[];
  currency: DisplayCurrency;
  sarRate: number;
  lang: "ar" | "en";
}) {
  if (!rows.length)
    return (
      <EmptyState
        label={lang === "ar" ? "لا توجد مبيعات دورات في الفترة" : "No course sales in this period"}
        compact
      />
    );
  return (
    <div>
      <div className="mb-2 grid grid-cols-[minmax(72px,0.8fr)_minmax(108px,1.5fr)_minmax(70px,0.7fr)] gap-2 px-2 text-[9.5px] font-semibold uppercase tracking-wide text-text-subtle sm:grid-cols-[minmax(100px,0.8fr)_minmax(160px,2fr)_minmax(88px,0.7fr)] sm:gap-3">
        <span>{lang === "ar" ? "الدورة" : "Course"}</span>
        <span>{lang === "ar" ? "المساهمة في المبيعات" : "Sales contribution"}</span>
        <span className="text-end">
          {lang === "ar" ? "متوسط البيع" : "Average sale"} ({currency})
        </span>
      </div>
      <div className="max-h-[390px] space-y-1.5 overflow-y-auto pe-1">
        {rows.map((row, index) => (
          <div
            key={row.course}
            className="grid grid-cols-[minmax(72px,0.8fr)_minmax(108px,1.5fr)_minmax(70px,0.7fr)] items-center gap-2 rounded-xl border border-border bg-surface-2/45 px-2.5 py-2.5 sm:grid-cols-[minmax(100px,0.8fr)_minmax(160px,2fr)_minmax(88px,0.7fr)] sm:gap-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="num text-[9px] text-text-subtle">#{index + 1}</span>
                <span className="truncate text-xs font-semibold text-text" title={row.course}>
                  {row.course}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[9.5px] text-text-muted">
                {fmtNum(row.paidInvoices)} {lang === "ar" ? "فاتورة مدفوعة" : "paid invoices"}
              </div>
            </div>
            <div className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
                <span className="num font-semibold text-brand">{fmtPct(row.contribution, 1)}</span>
                <span className="num text-text-muted">
                  {formatDisplayMoney(
                    usdToDisplayCurrency(row.revenue, currency, sarRate),
                    currency,
                    lang,
                  )}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-border/70">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-500"
                  style={{ width: `${Math.min(100, Math.max(1.5, row.contribution))}%` }}
                />
              </div>
            </div>
            <div className="text-end">
              <div className="num text-xs font-semibold text-text">
                {formatDisplayMoney(
                  usdToDisplayCurrency(row.averageSalePrice, currency, sarRate),
                  currency,
                  lang,
                  true,
                )}
              </div>
              <div className="mt-0.5 text-[9px] text-text-muted">
                {lang === "ar" ? "لكل فاتورة" : "per invoice"}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <Link to="/courses" className="text-[11px] font-semibold text-brand hover:underline">
          {lang === "ar" ? "فتح تقرير الدورات الكامل ←" : "Open full courses report →"}
        </Link>
      </div>
    </div>
  );
}

/** Campaign delivery, loss-making campaigns and ad accounts, for the Campaigns report. */
export function OverviewCampaignRecords() {
  const { lang } = useI18n();
  const { data } = useOverview();
  if (!data) return <Skeleton className="h-64" />;
  return (
    <>
      <CampaignActivityPanel activity={data.activity} />
      <BudgetLeaksCard rows={data.topLeaks} lang={lang} />
      <AccountsCard accounts={data.accounts} nonLeadSpend={data.totals.nonLeadSpend} lang={lang} />
    </>
  );
}

/** Conversion, loss and cost efficiency, plus where leads came from — for the CRM report. */
export function OverviewEfficiency() {
  const { t, lang } = useI18n();
  const { data } = useOverview();
  const workforce = useApi<AgentAnalyticsResult>("/api/teams");
  const efficiency = useMemo(
    () => (data ? overviewEfficiencyMetrics({ data, workforce: workforce.data, lang }) : null),
    [data, workforce.data, lang],
  );
  if (!data || !efficiency) return <Skeleton className="h-48" />;
  const T = data.totals;
  return (
    <>
      <KpiRow>
        <MetricDetailTrigger
          detail={efficiency.conversion}
          card={{ index: 0, compact: true, sub: `${fmtNum(T.won)} / ${fmtNum(T.totalLeads)}` }}
        />
        <MetricDetailTrigger
          detail={efficiency.lostRate}
          card={{ index: 1, compact: true, sub: `${fmtNum(T.lost)} / ${fmtNum(T.totalLeads)}` }}
        />
        <MetricDetailTrigger
          detail={efficiency.closeTime}
          card={{
            index: 2,
            compact: true,
            sub: T.closeSample
              ? `${t("based_on")} ${fmtNum(T.closeSample)} ${t("closed_leads")}`
              : undefined,
          }}
        />
        <MetricDetailTrigger
          detail={efficiency.cpl}
          card={{
            index: 3,
            compact: true,
            sub:
              lang === "ar"
                ? `${fmtUSD(T.spend)} ÷ ${fmtNum(T.platformLeads ?? 0)} ليد إعلانية`
                : `${fmtUSD(T.spend)} ÷ ${fmtNum(T.platformLeads ?? 0)} ad leads`,
          }}
        />
        <MetricDetailTrigger
          detail={efficiency.cpa}
          card={{
            index: 4,
            compact: true,
            sub:
              lang === "ar"
                ? `${fmtUSD(T.spend)} ÷ ${fmtNum(T.won)} صفقة`
                : `${fmtUSD(T.spend)} ÷ ${fmtNum(T.won)} won`,
          }}
        />
        <MetricDetailTrigger
          detail={efficiency.acos}
          card={{
            index: 5,
            compact: true,
            sub: lang === "ar" ? "الإنفاق ÷ الإيراد المحصّل" : "Spend ÷ collected revenue",
          }}
        />
      </KpiRow>
      <LeadOriginCard data={data} lang={lang} />
    </>
  );
}

/** Course contribution and average selling price, for the Courses report. */
export function OverviewCourseContribution() {
  const { lang } = useI18n();
  const filters = useFilters();
  const { data } = useOverview();
  const [currency] = useState<DisplayCurrency>("USD");
  if (!data) return <Skeleton className="h-64" />;
  const sarRate = fxRatesFromFilters(filters).SAR;
  return (
    <>
      <TopCoursesPanel rows={data.courseSales} currency={currency} sarRate={sarRate} lang={lang} />
      <DashboardPanel
        tone="amber"
        icon={<BookOpenCheck size={16} />}
        title={
          lang === "ar"
            ? "مساهمة الكورسات ومتوسط سعر البيع"
            : "Course contribution and average sale price"
        }
        hint={
          lang === "ar"
            ? "المساهمة = إيراد الكورس ÷ إجمالي إيراد الكورسات المصنّف."
            : "Contribution = course revenue ÷ classified course revenue."
        }
      >
        <CourseContributionChart
          rows={data.courseSales}
          currency={currency}
          sarRate={sarRate}
          lang={lang}
        />
      </DashboardPanel>
    </>
  );
}

/** One disclosure a report can mount to offer the records above. */
export function OverviewRecordsDisclosure({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <MoreDetails label={label} hint={hint}>
      <PageSection level="records">{children}</PageSection>
    </MoreDetails>
  );
}
