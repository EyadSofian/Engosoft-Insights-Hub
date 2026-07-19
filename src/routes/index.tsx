import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  AlertTriangle,
  Award,
  DollarSign,
  Info,
  Percent,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Timer,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { filterStore, useFilters } from "@/lib/filter-store";
import { fmtCompact, fmtNum, fmtPct, fmtRoas, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import {
  Card,
  EmptyState,
  ErrorState,
  FunnelBars,
  KpiCard,
  KpiSkeletonGrid,
  Notice,
  PageHeader,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { AcosPill, CloseTime, CountPct, RoasCell } from "@/components/metric-bits";
import { HBarChart, SpendRevenueChart } from "@/components/charts";
import type {
  DataHealth,
  Deltas,
  ExecSummary,
  FunnelStep,
  Grouped,
  PerfRow,
  Totals,
} from "@/lib/types";

export const Route = createFileRoute("/")({ component: Overview });

interface OriginCohort {
  key: "campaign" | "other";
  leads: number;
  won: number;
  lost: number;
  conversionRate: number | null;
  lostRate: number | null;
  revenue: number;
  avgCloseDays: number | null;
  closeSample: number;
}

interface OverviewResp {
  totals: Totals;
  deltas: Deltas;
  prevRange: { from: string; to: string } | null;
  prevComparable: boolean;
  trend: { date: string; spend: number; revenue: number; leads: number; won: number }[];
  funnel: FunnelStep[];
  origin: { cohorts: OriginCohort[]; otherBySource: Grouped[] };
  best: PerfRow | null;
  leak: PerfRow | null;
  bestCPL: PerfRow | null;
  topLeaks: PerfRow[];
  topByROAS: PerfRow[];
  topSpend: PerfRow[];
  accounts: { name: string; objective: string; spend: number; platformLeads: number | null }[];
  summary: ExecSummary;
  health: DataHealth;
  syncedAt: string;
  fetchErrors: string[];
}

const FUNNEL_LABELS: Record<string, { ar: string; en: string }> = {
  impressions: { ar: "مرات الظهور", en: "Impressions" },
  clicks: { ar: "النقرات", en: "Clicks" },
  platform_leads: { ar: "عملاء أبلغت عنهم المنصة", en: "Platform leads" },
  crm_leads: { ar: "عملاء دخلوا النظام", en: "CRM leads" },
  won: { ar: "صفقات مغلقة", en: "Won" },
};

function Overview() {
  const { t, lang } = useI18n();
  const filters = useFilters();
  const { data, isLoading, error, refetch } = useApi<OverviewResp>("/api/overview");

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  if (isLoading || !data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28" />
        <KpiSkeletonGrid count={12} />
        <Skeleton className="h-72" />
      </div>
    );
  }

  const { totals: T, deltas, health } = data;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("overview")}
        subtitle={filters.from && filters.to ? `${filters.from} → ${filters.to}` : undefined}
      />

      {data.fetchErrors.length > 0 && (
        <Notice
          tone="danger"
          title={lang === "ar" ? "تعذّر تحميل بعض التبويبات" : "Some tabs failed to load"}
          icon={<AlertTriangle size={16} />}
        >
          {data.fetchErrors.join(" · ")}
        </Notice>
      )}

      <Card>
        <SectionTitle
          hint={lang === "ar" ? "محسوب من البيانات مباشرة، بلا ذكاء اصطناعي" : "Computed directly from the data, no LLM"}
        >
          {t("exec_summary")}
        </SectionTitle>
        <p className="text-[13px] sm:text-sm leading-relaxed text-text-muted">
          {lang === "ar" ? data.summary.ar : data.summary.en}
        </p>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          index={0}
          label={t("crm_leads")}
          value={fmtNum(T.crmLeads)}
          delta={deltas.crmLeads}
          icon={<Users size={15} />}
          sub={`${fmtNum(T.leadsFromCampaign)} ${lang === "ar" ? "من حملات" : "from campaigns"}`}
        />
        <KpiCard index={1} label={t("won")} value={fmtNum(T.won)} delta={deltas.won} icon={<Award size={15} />} sub={fmtPct(T.conversionRate, 1)} />
        <KpiCard index={2} label={t("lost_count")} value={fmtNum(T.lost)} delta={deltas.lost} deltaInvert icon={<TrendingDown size={15} />} sub={fmtPct(T.lostRate, 1)} />
        <KpiCard index={3} label={t("conversion_rate")} value={fmtPct(T.conversionRate, 2)} delta={deltas.conversionRate} icon={<Percent size={15} />} sub={`${fmtNum(T.won)} / ${fmtNum(T.crmLeads)}`} />

        <KpiCard index={4} label={t("lost_rate")} value={fmtPct(T.lostRate, 2)} delta={deltas.lostRate} deltaInvert icon={<Percent size={15} />} sub={`${fmtNum(T.lost)} / ${fmtNum(T.crmLeads)}`} />
        <KpiCard
          index={5}
          label={t("avg_close_time")}
          value={T.avgCloseDays === null ? "—" : T.avgCloseDays.toFixed(1)}
          icon={<Timer size={15} />}
          sub={T.closeSample ? `${t("based_on")} ${fmtNum(T.closeSample)} ${t("closed_leads")}` : undefined}
        />
        <KpiCard
          index={6}
          label={t("spend")}
          value={fmtUSD(T.spend)}
          delta={deltas.spend}
          deltaInvert
          icon={<DollarSign size={15} />}
          sub={`${lang === "ar" ? "ميتا" : "Meta"} ${fmtUSD(T.spendMeta)} · ${lang === "ar" ? "سناب" : "Snap"} ${fmtUSD(T.spendSnap)}`}
        />
        <KpiCard
          index={7}
          label={t("revenue")}
          value={fmtUSD(T.revenue)}
          delta={deltas.revenue}
          hero
          icon={<TrendingUp size={15} />}
          sub={`${fmtUSD(T.attributedRevenue)} ${lang === "ar" ? "مرتبط بحملة" : "attributed"}`}
        />

        <KpiCard index={8} label={t("roas")} value={fmtRoas(T.roas)} delta={deltas.roas} icon={<Target size={15} />} sub={`${t("attributed_roas")} ${fmtRoas(T.attributedRoas)}`} />
        <KpiCard index={9} label={t("acos")} value={fmtPct(T.acos, 1)} delta={deltas.acos} deltaInvert icon={<Percent size={15} />} sub={lang === "ar" ? "أقل = أفضل" : "lower is better"} />
        <KpiCard index={10} label={t("cpl")} value={fmtUSDFull(T.cpl)} delta={deltas.cpl} deltaInvert icon={<DollarSign size={15} />} sub={`${t("attributed_cpl")} ${fmtUSDFull(T.attributedCpl)}`} />
        <CpaCard totals={T} />
      </div>

      {!data.prevComparable && data.prevRange && (
        <Notice tone="info" icon={<Info size={16} />}>
          {lang === "ar"
            ? `لا تُعرض نسب التغيّر لأن الفترة السابقة (${data.prevRange.from} → ${data.prevRange.to}) تقع قبل بداية البيانات في الملف، وأي مقارنة معها ستكون مضلّلة. اختر فترة أقصر لرؤية التغيّر.`
            : `Change percentages are hidden because the previous period (${data.prevRange.from} → ${data.prevRange.to}) falls before the data begins, so any comparison against it would mislead. Pick a shorter range to see deltas.`}
        </Notice>
      )}

      {T.nonLeadSpend > 0 && (
        <Notice tone="warning" title={t("non_lead_spend")} icon={<Info size={16} />}>
          {lang === "ar"
            ? `${fmtUSDFull(T.nonLeadSpend)} أُنفقت على حسابات زيارات أو حسابات بلا اسم لا تُنتج عملاء في النظام. هذه المبالغ مستبعدة من تكلفة العميل والصفقة والعائد على الإنفاق حتى تبقى المؤشرات صحيحة، لكنها تظل ظاهرة هنا.`
            : `${fmtUSDFull(T.nonLeadSpend)} ran on traffic or unnamed accounts that produce no CRM leads. It is excluded from CPL, CPA and ROAS so those stay meaningful, but the money stays visible here.`}
          <button
            onClick={() => filterStore.set({ includeNonLead: filters.includeNonLead === "1" ? undefined : "1" })}
            className="block mt-2 underline underline-offset-2 cursor-pointer font-medium"
          >
            {filters.includeNonLead === "1"
              ? lang === "ar"
                ? "استبعدها من المؤشرات"
                : "Exclude from metrics"
              : lang === "ar"
                ? "ضمّها إلى المؤشرات"
                : "Include in metrics"}
          </button>
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle hint={lang === "ar" ? "الإنفاق بتاريخ الإعلان، الإيراد بتاريخ الطلب" : "Spend by ad date, revenue by order date"}>
            {t("spend_vs_revenue")}
          </SectionTitle>
          <SpendRevenueChart data={data.trend} />
        </Card>

        <Card>
          <SectionTitle>{t("funnel")}</SectionTitle>
          <FunnelBars
            steps={data.funnel.map((s) => ({
              label: FUNNEL_LABELS[s.key]?.[lang] ?? s.key,
              value: s.value ?? 0,
              display: s.value === null ? "—" : fmtCompact(s.value),
            }))}
          />
          <p className="text-[11px] text-text-muted mt-3 leading-relaxed">
            {lang === "ar"
              ? "عدد العملاء في النظام قد يتجاوز ما تُبلغ عنه المنصة، لأن جزءاً منهم يأتي من تيك توك وواتساب والترشيحات ولا يوجد لها إنفاق في الملف."
              : "CRM leads can exceed platform-reported leads: some arrive from TikTok, WhatsApp and referrals, which carry no spend in the sheet."}
          </p>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Spotlight tone="success" title={t("best_campaign")} row={data.best} />
        <Spotlight tone="danger" title={t("money_leak")} row={data.leak} />
      </div>

      <Card>
        <SectionTitle hint={t("origin_note")}>{t("lead_origin")}</SectionTitle>
        <div className="grid sm:grid-cols-2 gap-4">
          {data.origin.cohorts.map((c) => (
            <div key={c.key} className="rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
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
                <dd className="text-end num font-medium">{fmtUSD(c.revenue)}</dd>
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
            <div className="text-xs font-medium text-text-muted mb-2">
              {lang === "ar" ? "توزيع العملاء بلا حملة حسب المصدر" : "Non-campaign leads by source"}
            </div>
            <HBarChart
              data={data.origin.otherBySource.slice(0, 8).map((g) => ({ label: g.label, value: g.count }))}
              format={fmtNum}
              color="var(--chart-3)"
              height={200}
            />
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle hint={lang === "ar" ? "حملات أنفقت ولم تُعد ما يساوي إنفاقها" : "Campaigns that spent more than they returned"}>
          {t("where_budget_goes")}
        </SectionTitle>
        {data.topLeaks.length === 0 ? (
          <EmptyState label={lang === "ar" ? "لا توجد حملات خاسرة في هذه الفترة" : "No loss-making campaigns in this period"} compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="text-start py-2">{t("campaign")}</th>
                  <th className="text-end py-2">{t("spend")}</th>
                  <th className="text-end py-2">{t("revenue")}</th>
                  <th className="text-end py-2">{t("crm_leads")}</th>
                  <th className="text-end py-2">{t("roas")}</th>
                  <th className="text-end py-2">{t("acos")}</th>
                </tr>
              </thead>
              <tbody>
                {data.topLeaks.map((r) => (
                  <tr key={r.key} className="border-t border-border">
                    <td className="py-2.5 pe-3 max-w-[240px] truncate" title={r.name}>
                      {r.name}
                    </td>
                    <td className="py-2.5 text-end num">{fmtUSD(r.spend)}</td>
                    <td className="py-2.5 text-end num">{fmtUSD(r.revenue)}</td>
                    <td className="py-2.5 text-end num">{fmtNum(r.crmLeads)}</td>
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

      <Card>
        <SectionTitle
          hint={lang === "ar" ? "الحسابات المُعلّمة «زيارات» أو «غير معروف» مستبعدة من مؤشرات الكفاءة" : "Accounts marked traffic or unknown are excluded from efficiency metrics"}
        >
          {t("account")}
        </SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                <th className="text-start py-2">{t("account")}</th>
                <th className="text-end py-2">{t("spend")}</th>
                <th className="text-end py-2">{t("platform_leads")}</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.name} className="border-t border-border">
                  <td className="py-2.5 pe-3">
                    <span className="inline-flex items-center gap-2 flex-wrap">
                      <span className="truncate max-w-[200px]" title={a.name}>
                        {a.name}
                      </span>
                      {a.objective !== "leads" && (
                        <Pill tone="warning">
                          {a.objective === "traffic" ? (lang === "ar" ? "زيارات" : "traffic") : lang === "ar" ? "غير معروف" : "unknown"}
                        </Pill>
                      )}
                    </span>
                  </td>
                  <td className="py-2.5 text-end num">{fmtUSDFull(a.spend)}</td>
                  <td className="py-2.5 text-end num">
                    {a.platformLeads === null ? <span className="text-text-subtle">—</span> : fmtNum(a.platformLeads)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <DataHealthPanel health={health} />
    </div>
  );
}

/** CPA carries a basis toggle; both denominators stay visible in the sub-line. */
function CpaCard({ totals }: { totals: Totals }) {
  const { t, lang } = useI18n();
  const filters = useFilters();
  const basis = filters.cpaBasis === "invoices" ? "invoices" : "won";

  return (
    <div className="card stagger p-4 sm:p-5 relative overflow-hidden" style={{ "--i": 11 } as React.CSSProperties}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted truncate">{t("cpa")}</span>
        <button
          onClick={() => filterStore.set({ cpaBasis: basis === "won" ? "invoices" : undefined })}
          className="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted hover:text-text transition-colors cursor-pointer whitespace-nowrap"
          title={lang === "ar" ? "تبديل أساس الحساب" : "Switch basis"}
        >
          {basis === "won" ? t("cpa_won") : t("cpa_invoices")}
        </button>
      </div>
      <div className="num mt-2 font-semibold leading-none text-[22px] sm:text-[27px] text-text">
        {fmtUSDFull(totals.cpa)}
      </div>
      <div className="mt-2 text-[11px] text-text-muted leading-snug">
        {t("cpa_won")}: <span className="num">{fmtUSDFull(totals.cpaWon)}</span>
        {" · "}
        {t("cpa_invoices")}: <span className="num">{fmtUSDFull(totals.cpaInvoices)}</span>
      </div>
    </div>
  );
}

function Spotlight({ tone, title, row }: { tone: "success" | "danger"; title: string; row: PerfRow | null }) {
  const { t, lang } = useI18n();
  if (!row) {
    return (
      <Card>
        <SectionTitle>{title}</SectionTitle>
        <EmptyState label={t("no_data")} compact />
      </Card>
    );
  }
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      <div className="flex items-start justify-between gap-3 mb-4">
        <span className="text-sm font-semibold text-text leading-snug min-w-0" title={row.name}>
          {row.name || "—"}
        </span>
        <RoasCell roas={row.roas} spend={row.spend} />
      </div>
      <dl className="grid grid-cols-2 gap-y-2 text-[13px]">
        <dt className="text-text-muted">{t("spend")}</dt>
        <dd className="text-end num font-medium">{fmtUSD(row.spend)}</dd>
        <dt className="text-text-muted">{t("revenue")}</dt>
        <dd className="text-end num font-medium">{fmtUSD(row.revenue)}</dd>
        <dt className="text-text-muted">{t("crm_leads")}</dt>
        <dd className="text-end num font-medium">{fmtNum(row.crmLeads)}</dd>
        <dt className="text-text-muted">{t("cpl")}</dt>
        <dd className="text-end num font-medium">{fmtUSDFull(row.cpl)}</dd>
        <dt className="text-text-muted">{t("acos")}</dt>
        <dd className="text-end">
          <AcosPill acos={row.acos} />
        </dd>
      </dl>
      {tone === "danger" && row.revenue <= 0 && row.spend > 0 && (
        <p className="text-[12px] mt-3" style={{ color: "var(--danger)" }}>
          {lang === "ar"
            ? `أنفقت ${fmtUSD(row.spend)} ولم تُسجَّل أي إيراد مرتبط بها.`
            : `Spent ${fmtUSD(row.spend)} and returned nothing traceable.`}
        </p>
      )}
    </Card>
  );
}

export function DataHealthPanel({ health }: { health: DataHealth }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const pct = (n: number) => fmtPct(n * 100, 1);
  const adBearing = health.adsetExact + health.adsetDerived + health.adsetAmbiguous + health.adsetUnknown;

  const items: { label: string; value: string; warn?: boolean }[] = [
    {
      label: t("adset_resolution"),
      value: `${pct(health.adsetResolutionRate)} (${fmtNum(adBearing - health.adsetUnknown)} / ${fmtNum(adBearing)})`,
      warn: health.adsetResolutionRate < 0.9,
    },
    {
      label: lang === "ar" ? "منها تقديرية (اسم إعلان مكرر)" : "of which ambiguous (duplicate ad name)",
      value: fmtNum(health.adsetAmbiguous),
      warn: health.adsetAmbiguous > 0,
    },
    { label: t("match_rate"), value: pct(health.campaignMatchRate), warn: health.campaignMatchRate < 0.8 },
    {
      label: t("revenue_coverage"),
      value: `${pct(health.revenueCampaignCoverage)} ${lang === "ar" ? "من الصفوف" : "of rows"} · ${pct(health.revenueCampaignShare)} ${lang === "ar" ? "من الإيراد" : "of revenue"}`,
      warn: health.revenueCampaignShare < 0.6,
    },
    { label: lang === "ar" ? "تغطية اسم الإعلان في النظام" : "CRM ad-name coverage", value: pct(health.crmAdCoverage), warn: health.crmAdCoverage < 0.8 },
    { label: lang === "ar" ? "تغطية اسم الإعلان في الفواتير" : "Invoice ad-name coverage", value: pct(health.invoicedAdCoverage), warn: health.invoicedAdCoverage < 0.8 },
    {
      label: lang === "ar" ? "قياس زمن الإغلاق" : "Close-time measurability",
      value: `${fmtNum(health.closeSample)} ${lang === "ar" ? "صفقة" : "leads"} (${pct(health.closeCoverage)})`,
      warn: true,
    },
    { label: t("no_spend_source"), value: fmtNum(health.leadsWithoutSpendSource), warn: health.leadsWithoutSpendSource > 0 },
    {
      label: lang === "ar" ? "صفوف بإيراد سالب (مرتجعات)" : "Negative revenue rows (refunds)",
      value: `${fmtNum(health.negativeRevenueRows)} · ${fmtUSDFull(health.negativeRevenue)}`,
    },
  ];

  return (
    <Card>
      <SectionTitle
        action={
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-surface-2 transition-colors cursor-pointer"
          >
            {open ? t("show_less") : t("show_more")}
          </button>
        }
      >
        {t("data_health")}
      </SectionTitle>

      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
        {items.slice(0, open ? items.length : 4).map((it) => (
          <div key={it.label} className="flex items-baseline justify-between gap-3 py-1 border-b border-border/60">
            <span className="text-text-muted min-w-0">{it.label}</span>
            <span className="num font-medium shrink-0" style={it.warn ? { color: "var(--warning)" } : { color: "var(--text)" }}>
              {it.value}
            </span>
          </div>
        ))}
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          <Notice tone="info" title={t("upstream_fix")} icon={<Info size={16} />}>
            {t("upstream_adset")}
          </Notice>
          <Notice tone="warning" title={t("no_spend_source")} icon={<AlertTriangle size={16} />}>
            {t("no_spend_source_note")}
            {health.unpricedSources.length > 0 && (
              <span className="block mt-1.5 num text-[11px]">
                {health.unpricedSources.slice(0, 6).map((s) => `${s.label} ${fmtNum(s.count)}`).join(" · ")}
              </span>
            )}
          </Notice>
        </div>
      )}
    </Card>
  );
}
