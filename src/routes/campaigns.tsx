import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Activity,
  BarChart3,
  CircleDollarSign,
  Megaphone,
  TrendingUp,
  Target,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { useFilters } from "@/lib/filter-store";
import { hasReportableLost } from "@/lib/lost-authority";
import { fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { Card, ErrorState, Pill, SectionTitle, Skeleton } from "@/components/ui-bits";
import {
  DashboardPageHeader,
  DataHealthSummary,
  InsightCard,
  InsightRow,
  KpiRow,
} from "@/components/dashboard-bits";
import { campaignReturnBand } from "@/lib/campaign-return-band";
import { CompareBars } from "@/components/ads/CompareBars";
import { CampaignActivityPanel } from "@/components/CampaignActivityPanel";
import { MetricCard, Unavailable } from "@/components/ads/MetricCard";
import { roasVerdict, verdictWord } from "@/components/ads/verdict";
import { MetricsGlossaryButton } from "@/components/ads/MetricsGlossary";
import { FilterSummary } from "@/components/ads/FilterSummary";
import { PerfExplorer, type Grain } from "@/components/ads/PerfExplorer";
import { ratioCell } from "@/components/ads/cells";
import type { CampaignActivity, DataHealth, PerfRow, Totals } from "@/lib/types";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";

type CampaignsSearch = { view?: "attributedRevenue" };
type CampaignWorkspaceTab = "decision" | "live" | "analysis";

export const Route = createFileRoute("/campaigns")({
  validateSearch: (search: Record<string, unknown>): CampaignsSearch => ({
    view: search.view === "attributedRevenue" ? "attributedRevenue" : undefined,
  }),
  component: Campaigns,
});

interface Resp {
  grain: Grain;
  rows: PerfRow[];
  totals: Totals;
  activity: CampaignActivity;
  unknownAdsetKey: string;
  health: DataHealth;
}

/**
 * The three campaigns worth naming, read straight off the rows the API already
 * returned for this window.
 *
 * This is a presentation view model and nothing more: no row is re-scored and
 * no threshold is invented. "Best" and "needs attention" are decided by
 * `campaignReturnBand`, the same scale the table cells and the return-band
 * tests use, so a campaign can never be green in one place and red in another.
 */
function campaignHeadlines(rows: PerfRow[]) {
  const spending = rows.filter((row) => row.spend > 0);

  const best =
    spending
      .filter((row) => campaignReturnBand(row.spend, row.revenue) === "strong")
      .sort((a, b) => b.revenue - a.revenue)[0] ?? null;

  const leak =
    spending
      .filter((row) => campaignReturnBand(row.spend, row.revenue) === "loss")
      .sort((a, b) => b.spend - b.revenue - (a.spend - a.revenue))[0] ?? null;

  const bestCpl =
    spending
      .filter((row) => row.crmLeads > 0 && row.cpl !== null && isFinite(row.cpl))
      .sort((a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity))[0] ?? null;

  return { best, leak, bestCpl, any: spending.length > 0 };
}

function Campaigns() {
  const { t, lang } = useI18n();
  const { view: initialView } = Route.useSearch();
  const filters = useFilters();
  const [grain, setGrain] = useState<Grain>("campaign");
  const [workspaceTab, setWorkspaceTab] = useState<CampaignWorkspaceTab>("decision");
  // Declares this page to ENGO Nexus, so "حلل الصفحة دي" and "التاب ده"
  // have something to resolve against. Ids and state only — no figures.
  useRegisterNexusView("campaigns", { tab: workspaceTab });
  const { data, isLoading, error, refetch } = useApi<Resp>(`/api/campaigns?grain=${grain}`);

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const unknownRow = data?.rows.find((r) => r.key === data.unknownAdsetKey);
  const totals = data?.totals;
  const spend = totals?.spend ?? 0;
  const headline = campaignHeadlines(data?.rows ?? []);
  const period = filters.from && filters.to ? `${filters.from} → ${filters.to}` : undefined;

  return (
    <div className="space-y-5">
      <DashboardPageHeader
        icon={<Megaphone size={20} />}
        title={t("campaigns")}
        subtitle={
          lang === "ar"
            ? "أداء حملاتك التسويقية عبر جميع القنوات"
            : "How your marketing campaigns performed across every channel"
        }
        period={period}
        actions={<MetricsGlossaryButton />}
      />

      <FilterSummary />

      {/* The period's five figures, and the three readings of it worth acting
          on. Both describe the selected window rather than any one workspace
          tab, so they sit above the tabs: two of the three tabs used to open
          straight onto a table with no headline context at all. */}
      {totals && (
        <KpiRow columns={5}>
          <MetricCard
            metric="spend"
            index={0}
            icon={<Wallet size={14} />}
            value={fmtUSD(totals.spend)}
          />
          <MetricCard
            metric="attributedRevenue"
            index={1}
            icon={<CircleDollarSign size={14} />}
            value={fmtUSD(totals.attributedRevenue)}
            sub={
              lang === "ar"
                ? `${fmtUSD(totals.revenue)} إجمالي التحصيل`
                : `${fmtUSD(totals.revenue)} collected in total`
            }
          />
          <MetricCard
            metric="crmLeads"
            index={2}
            icon={<Users size={14} />}
            value={fmtNum(totals.totalLeads)}
            sub={
              totals.platformLeads === null
                ? lang === "ar"
                  ? "المنصة لا تبلّغ عن عدد ليدز"
                  : "Platform reports no lead metric"
                : lang === "ar"
                  ? `${fmtNum(totals.platformLeads)} أبلغت عنهم المنصة`
                  : `${fmtNum(totals.platformLeads)} reported by the platform`
            }
          />
          <MetricCard
            metric="won"
            index={3}
            icon={<UserPlus size={14} />}
            value={fmtNum(totals.won)}
            sub={fmtPct(totals.conversionRate, 1)}
          />
          <MetricCard
            metric="roas"
            index={4}
            icon={<TrendingUp size={14} />}
            value={ratioCell(totals.roas, spend, (v) => `${v.toFixed(2)}×`)}
            unavailableReason={
              spend <= 0
                ? lang === "ar"
                  ? "مفيش إنفاق مسجّل في الفترة المختارة."
                  : "No recorded spend in the selected period."
                : undefined
            }
            verdict={roasVerdict(totals.roas, spend) ?? undefined}
            verdictLabel={verdictWord(roasVerdict(totals.roas, spend), lang)}
            note={
              lang === "ar"
                ? `البسط هنا كل التحصيل في الفترة (${fmtUSD(totals.revenue)})، مش الجزء المربوط بحملات (${fmtUSD(totals.attributedRevenue)}).`
                : `The numerator is all revenue collected in the window (${fmtUSD(totals.revenue)}), not only the campaign-linked share (${fmtUSD(totals.attributedRevenue)}).`
            }
          />
        </KpiRow>
      )}

      {headline.any && (
        <InsightRow>
          <InsightCard
            index={0}
            kind="best"
            eyebrow={lang === "ar" ? "أفضل حملة" : "Best campaign"}
            title={
              headline.best
                ? headline.best.name
                : lang === "ar"
                  ? "لا توجد حملة مؤهلة"
                  : "No eligible campaign"
            }
            value={headline.best ? fmtUSD(headline.best.revenue) : undefined}
            detail={
              headline.best
                ? lang === "ar"
                  ? `${fmtUSD(headline.best.spend)} إنفاق مقابل إيراد مرتبط`
                  : `${fmtUSD(headline.best.spend)} spent against linked revenue`
                : lang === "ar"
                  ? "لا توجد حملة صرفت وحققت إيراداً مرتبطاً في الفترة."
                  : "No campaign both spent and returned linked revenue this period."
            }
          />
          <InsightCard
            index={1}
            kind="attention"
            eyebrow={lang === "ar" ? "حملة تحتاج متابعة" : "Campaign needing attention"}
            title={
              headline.leak
                ? headline.leak.name
                : lang === "ar"
                  ? "لا توجد حملة خاسرة"
                  : "No loss-making campaign"
            }
            value={headline.leak ? fmtUSD(headline.leak.spend - headline.leak.revenue) : undefined}
            detail={
              headline.leak
                ? lang === "ar"
                  ? `صرفت ${fmtUSD(headline.leak.spend)} مقابل ${fmtUSD(headline.leak.revenue)} إيراد مرتبط.`
                  : `Spent ${fmtUSD(headline.leak.spend)} against ${fmtUSD(headline.leak.revenue)} of linked revenue.`
                : lang === "ar"
                  ? "كل حملة صرفت في الفترة غطّت تكلفتها على الأقل."
                  : "Every campaign that spent this period at least covered its cost."
            }
          />
          <InsightCard
            index={2}
            kind="opportunity"
            eyebrow={lang === "ar" ? "أفضل تكلفة لكل عميل محتمل" : "Best cost per lead"}
            title={
              headline.bestCpl
                ? headline.bestCpl.name
                : lang === "ar"
                  ? "لا توجد تكلفة قابلة للقياس"
                  : "No measurable cost per lead"
            }
            value={headline.bestCpl ? fmtUSDFull(headline.bestCpl.cpl ?? 0) : undefined}
            detail={
              headline.bestCpl
                ? lang === "ar"
                  ? `${fmtNum(headline.bestCpl.crmLeads)} عميل من ${fmtUSD(headline.bestCpl.spend)} إنفاق.`
                  : `${fmtNum(headline.bestCpl.crmLeads)} leads from ${fmtUSD(headline.bestCpl.spend)} of spend.`
                : lang === "ar"
                  ? "لا توجد حملة صرفت وجاءت منها عملاء في الفترة."
                  : "No campaign both spent and produced leads this period."
            }
          />
        </InsightRow>
      )}

      <div
        role="tablist"
        aria-label={lang === "ar" ? "أقسام صفحة الحملات" : "Campaign workspace"}
        /* Scrolls with full labels on a phone, equal 3-up from `sm`. */
        className="hscroll flex gap-1 rounded-2xl border border-border bg-surface-2 p-1 sm:grid sm:grid-cols-3"
      >
        {(
          [
            {
              key: "decision" as const,
              label: lang === "ar" ? "قرار سريع" : "Quick decision",
              description: lang === "ar" ? "ناجحة ولا محتاجة تدخل؟" : "What needs action?",
              icon: Target,
            },
            {
              key: "live" as const,
              label: lang === "ar" ? "الحملات الشغالة" : "Live campaigns",
              description: lang === "ar" ? "حالة التشغيل على المنصات" : "Platform delivery state",
              icon: Activity,
            },
            {
              key: "analysis" as const,
              label: lang === "ar" ? "تحليل الفترة" : "Period analysis",
              description: lang === "ar" ? "صرف، إيراد، وكل التفاصيل" : "Spend, revenue and detail",
              icon: BarChart3,
            },
          ] satisfies Array<{
            key: CampaignWorkspaceTab;
            label: string;
            description: string;
            icon: typeof Target;
          }>
        ).map((tab) => {
          const active = workspaceTab === tab.key;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setWorkspaceTab(tab.key)}
              className={`shrink-0 rounded-xl px-3 py-2 text-start transition-colors sm:min-w-0 sm:shrink sm:px-3 ${
                active ? "bg-surface text-text shadow-sm" : "text-text-muted hover:text-text"
              }`}
            >
              <span className="flex items-center gap-2 text-[12.5px] font-bold sm:text-[13.5px]">
                <span
                  className="grid size-6 shrink-0 place-items-center rounded-lg transition-colors"
                  style={
                    active
                      ? { background: "var(--sky-strong)", color: "#fff" }
                      : { background: "var(--surface-3)", color: "var(--text-subtle)" }
                  }
                  aria-hidden="true"
                >
                  <Icon size={13} />
                </span>
                <span className="whitespace-nowrap sm:truncate">{tab.label}</span>
              </span>
              <span className="mt-0.5 hidden truncate ps-8 text-[10.5px] text-text-subtle sm:block">
                {tab.description}
              </span>
            </button>
          );
        })}
      </div>

      {isLoading || !data || !totals ? (
        <Skeleton className="h-[520px]" />
      ) : (
        <>
          {workspaceTab === "decision" && (
            <PerfExplorer
              rows={data.rows}
              grain={grain}
              onGrainChange={setGrain}
              initialView={initialView}
              unknownAdsetKey={data.unknownAdsetKey}
              csvPrefix="engosoft"
              activeCampaignStates={Object.values(data.activity.delivery)}
              lostAvailable={hasReportableLost(data.health.lostAuthority)}
              spendAvailable={spend > 0}
              spendNote={
                spend <= 0
                  ? lang === "ar"
                    ? "مفيش إنفاق مسجّل في النطاق الحالي، فالمؤشرات المبنية على الإنفاق بتظهر شرطة."
                    : "No recorded spend in the current scope, so spend-derived metrics render as a dash."
                  : undefined
              }
              title={
                grain === "campaign"
                  ? lang === "ar"
                    ? "قرار الحملات اللي شغالة دلوقتي"
                    : "Live campaign decisions"
                  : lang === "ar"
                    ? "تفاصيل الحملة"
                    : "Campaign details"
              }
              subtitle={
                lang === "ar"
                  ? "ابدأ من هنا: ناجحة، متابعة، ضعيفة، أو بدري للحكم. حملات web-con بتتحسب كتحويلات موقع، مش ليدز CRM."
                  : "Start here: Successful, Watch, Weak, or Too early. web-con is evaluated as website conversion, not CRM lead generation."
              }
            />
          )}

          {workspaceTab === "live" && <CampaignActivityPanel activity={data.activity} />}

          {workspaceTab === "analysis" && (
            <>
              <SectionTitle
                hint={
                  lang === "ar"
                    ? "ملخص الفترة والمنصات، وبعده حالة الاتصال والمقارنة المالية."
                    : "Selected-period and platform summary, followed by delivery health and financial comparison."
                }
                className="border-t border-border/70 pt-4"
              >
                {lang === "ar" ? "الصورة الكاملة للفترة" : "Period overview"}
              </SectionTitle>

              <Card>
                <SectionTitle
                  action={
                    <Pill tone="neutral">
                      {grain === "campaign"
                        ? t("campaign")
                        : grain === "adset"
                          ? t("ad_set")
                          : t("ad_name")}
                    </Pill>
                  }
                  hint={
                    lang === "ar"
                      ? "كل الصفوف اللي صرفت في الفترة المختارة. الأزرق هو الإنفاق والبرتقالي هو التحصيل — مرّر داخل الكارت لمراجعة كل الحملات."
                      : "Every row with spend in the selected period. Blue is spend and orange is collected revenue; scroll inside the card to review all campaigns."
                  }
                >
                  <span className="inline-flex items-center gap-1.5">
                    <BarChart3 size={15} className="text-text-subtle" />
                    {lang === "ar" ? "الإنفاق مقابل التحصيل" : "Spend against collections"}
                  </span>
                </SectionTitle>
                <div className="max-h-[720px] overflow-y-auto pe-1 scrollbar-thin">
                  <CompareBars
                    rows={[...data.rows]
                      .filter((r) => r.spend > 0)
                      .sort((a, b) => b.spend - a.spend)}
                  />
                </div>
              </Card>

              {/* Four stacked technical notices became one card. Every fact
                  they carried survives — the scope rule, the revenue basis,
                  the unmatched ad-set bucket — but the sentence a manager
                  needs is now separated from the mechanics behind it. */}
              <DataHealthSummary
                issues={[
                  ...(grain === "adset"
                    ? [
                        {
                          tone: "info" as const,
                          message:
                            lang === "ar"
                              ? "بعض المجموعات الإعلانية مستنتَجة وليست مطابَقة مباشرة."
                              : "Some ad sets are inferred rather than matched directly.",
                          impact:
                            lang === "ar"
                              ? `${fmtPct(data.health.adsetResolutionRate * 100, 1)} من الصفوف مربوطة بشكل مؤكد؛ الباقي معلَّم داخل الجدول.`
                              : `${fmtPct(data.health.adsetResolutionRate * 100, 1)} of rows are matched exactly; the rest are flagged in the table.`,
                          technical:
                            lang === "ar"
                              ? "الربط يتم من معرّف الإعلان أولاً — وهو ربط مضبوط — ثم من اسم الإعلان عند اللزوم. أسماء الإعلانات ليست فريدة، فما يُحدَّد بالاسم يحمل علامة «غير مؤكد»."
                              : 'Ad set resolves from the ad id first — an exact join — then from the ad name where needed. Ad names are not unique, so name-derived values carry an "ambiguous" badge.',
                        },
                      ]
                    : []),
                  {
                    tone: "info" as const,
                    message:
                      lang === "ar"
                        ? "الإيراد هنا هو المحصَّل فعلياً بتاريخ الدفع."
                        : "Revenue here is what was actually collected, by payment date.",
                    impact:
                      lang === "ar"
                        ? "الصفوف بلا حملة معروفة غير معروضة، فمجموع الجدول قد يقل عن إجمالي الإيراد."
                        : "Rows without a known campaign are excluded, so the table may total less than headline revenue.",
                    technical: "Accounting.USD Paid · Payment Date",
                  },
                  ...(filters.account
                    ? [
                        {
                          tone: "warning" as const,
                          message:
                            lang === "ar"
                              ? "أنت تشاهد حساباً إعلانياً واحداً، وليس كل النشاط."
                              : "You are viewing a single ad account, not all activity.",
                          impact:
                            lang === "ar"
                              ? "الصفوف التي لا يمكن ربطها بهذا الحساب بشكل مؤكد مستبعدة بدل تخمينها."
                              : "Rows that cannot be tied to this account with certainty are excluded rather than guessed in.",
                          technical:
                            lang === "ar"
                              ? "الربط يتم عبر Campaign ID مطابق فعلاً داخل الحساب؛ الصفوف بلا Campaign ID تُستبعد."
                              : "Scoping runs through an exact Campaign ID observed in that account; rows without a Campaign ID are excluded.",
                        },
                      ]
                    : []),
                  ...(unknownRow
                    ? [
                        {
                          tone: "warning" as const,
                          message:
                            lang === "ar"
                              ? "جزء من النشاط لم يُربط بمجموعة إعلانية."
                              : "Part of this activity could not be tied to an ad set.",
                          impact:
                            lang === "ar"
                              ? `${fmtNum(unknownRow.crmLeads)} عميل و${fmtUSD(unknownRow.revenue)} تحصيل — معروضة كصف مستقل وليست محذوفة.`
                              : `${fmtNum(unknownRow.crmLeads)} leads and ${fmtUSD(unknownRow.revenue)} of revenue — shown as their own row, not dropped.`,
                        },
                      ]
                    : []),
                ]}
              />

              <p className="text-[11px] text-text-subtle px-1">
                {lang === "ar"
                  ? `${fmtNum(data.rows.length)} صف في المستوى ده. متوسط تكلفة الصفقة ${fmtUSDFull(totals.cpa)} على أساس ${filters.cpaBasis === "invoices" ? "عدد الفواتير" : "الصفقات الرابحة"}.`
                  : `${fmtNum(data.rows.length)} rows at this level. Blended CPA is ${fmtUSDFull(totals.cpa)} on the ${filters.cpaBasis === "invoices" ? "invoice-count" : "won-deals"} basis.`}
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
