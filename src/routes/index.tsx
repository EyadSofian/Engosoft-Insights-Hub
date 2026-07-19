import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Trophy,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  Users,
  Eye,
  MousePointerClick,
  Target,
  Percent,
  Info,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  BarList,
  Card,
  EmptyState,
  ErrorState,
  FunnelBars,
  KpiCard,
  KpiSkeletonGrid,
  Notice,
  Pill,
  RoasPill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { SpendRevenueChart } from "@/components/charts";
import { fmtNum, fmtPct, fmtUSD, fmtRoas, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { CampaignAgg, CourseAgg, Deltas, ExecSummary, Totals } from "@/lib/types";

interface OverviewResp {
  totals: Totals;
  deltas: Deltas;
  prevRange: { from: string; to: string } | null;
  trend: { date: string; spend: number; revenue: number; leads: number }[];
  best: CampaignAgg | null;
  leak: CampaignAgg | null;
  bestCPL: CampaignAgg | null;
  topLeaks: CampaignAgg[];
  topByROAS: CampaignAgg[];
  topCourses: CourseAgg[];
  summary: ExecSummary;
  appliedFilters: { from?: string; to?: string };
  metaDateMin: string;
  metaDateMax: string;
  revenueDateMin: string;
  revenueDateMax: string;
  matchRate: number;
  unmatchedCampaigns: number;
  unmatchedRevenueCampaigns: number;
  dateMismatch: boolean;
  dataQuality: {
    attributedRevenueShare: number;
    invoicedMissingDate: number;
    invoicedRows: number;
  };
  fetchErrors: string[];
  funnel: {
    impressions: number;
    clicks: number;
    metaLeads: number;
    crmLeads: number;
    won: number;
    revenue: number;
  };
}

export const Route = createFileRoute("/")({ component: OverviewPage });

function OverviewPage() {
  const { t, lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<OverviewResp>("/api/overview");

  return (
    <AppShell title={t("overview")}>
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <LoadingSkeleton />
      ) : (
        <div className="space-y-4">
          <RangeNotice data={data} />
          <SummaryCard text={lang === "ar" ? data.summary.ar : data.summary.en} />
          <KpiGrid data={data} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Spotlight kind="best" c={data.best} />
            <Spotlight kind="leak" c={data.leak} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <SectionTitle
                hint={
                  lang === "ar"
                    ? "الإنفاق اليومي على ميتا مقابل الإيراد المُحصّل في نفس اليوم."
                    : "Daily Meta spend against revenue booked the same day."
                }
              >
                {t("spend_vs_revenue")}
              </SectionTitle>
              <SpendRevenueChart data={data.trend} />
            </Card>

            <Card>
              <SectionTitle
                hint={
                  lang === "ar"
                    ? "النسبة المئوية تعني التحويل من المرحلة السابقة."
                    : "Percentages show conversion from the previous stage."
                }
              >
                {t("funnel")}
              </SectionTitle>
              <FunnelBars
                steps={[
                  { label: t("impressions"), value: data.funnel.impressions, display: fmtNum(data.funnel.impressions) },
                  { label: t("clicks"), value: data.funnel.clicks, display: fmtNum(data.funnel.clicks) },
                  { label: t("meta_leads"), value: data.funnel.metaLeads, display: fmtNum(data.funnel.metaLeads) },
                  { label: t("crm_leads"), value: data.funnel.crmLeads, display: fmtNum(data.funnel.crmLeads) },
                  { label: t("won"), value: data.funnel.won, display: fmtNum(data.funnel.won) },
                ]}
              />
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BudgetLeaks rows={data.topLeaks} />
            <Card>
              <SectionTitle
                action={
                  <Link
                    to="/campaigns"
                    className="text-xs text-brand hover:underline inline-flex items-center gap-1"
                  >
                    {t("view_all")}
                    <ArrowRight size={12} className="rtl:rotate-180" />
                  </Link>
                }
              >
                {t("top_by_roas")}
              </SectionTitle>
              <BarList
                items={data.topByROAS.map((c) => ({
                  label: c.campaign,
                  value: c.roas,
                  meta: <RoasPill roas={c.roas} />,
                }))}
                format={fmtRoas}
                color="var(--chart-6)"
              />
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <SectionTitle
                action={
                  <Link
                    to="/courses"
                    className="text-xs text-brand hover:underline inline-flex items-center gap-1"
                  >
                    {t("view_all")}
                    <ArrowRight size={12} className="rtl:rotate-180" />
                  </Link>
                }
              >
                {t("top_performing")} — {t("courses")}
              </SectionTitle>
              <BarList
                items={data.topCourses.map((c) => ({ label: c.course, value: c.revenue }))}
                format={fmtUSD}
                color="var(--chart-2)"
              />
            </Card>

            <DataHealth data={data} />
          </div>
        </div>
      )}
    </AppShell>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-[92px]" />
      <KpiSkeletonGrid />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-[190px]" />
        <Skeleton className="h-[190px]" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Skeleton className="h-[340px] lg:col-span-2" />
        <Skeleton className="h-[340px]" />
      </div>
    </div>
  );
}

function RangeNotice({ data }: { data: OverviewResp }) {
  const { t, lang } = useI18n();
  const f = data.appliedFilters;
  const alignedToMeta = f.from === data.metaDateMin && f.to === data.metaDateMax;

  if (data.dateMismatch && !alignedToMeta) {
    return (
      <Notice tone="warning" title={t("mismatch_title")} icon={<AlertTriangle size={17} />}>
        {t("mismatch_body")}{" "}
        <span className="num font-medium">
          {data.metaDateMin} → {data.metaDateMax}
        </span>
      </Notice>
    );
  }

  if (alignedToMeta) {
    return (
      <Notice tone="info" title={t("window_note_title")} icon={<Info size={17} />}>
        {t("window_note")}{" "}
        <span className="num font-medium">
          {data.metaDateMin} → {data.metaDateMax}
        </span>
        {lang === "ar" ? " — يمكنك تغيير الفترة من الأعلى." : " — change the period above."}
      </Notice>
    );
  }
  return null;
}

function SummaryCard({ text }: { text: string }) {
  const { t } = useI18n();
  // The full paragraph runs ~12 lines on a phone, pushing every KPI below the
  // fold. Clamp it there and let the reader open it; desktop shows it all.
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="animate-fade-up">
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-xl grid place-items-center shrink-0"
          style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
        >
          <Sparkles size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-text-muted mb-1.5">
            {t("exec_summary")}
          </h2>
          <p
            className={`text-[15px] leading-relaxed text-text ${
              expanded ? "" : "line-clamp-4 sm:line-clamp-none"
            }`}
          >
            {text}
          </p>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="sm:hidden mt-1.5 text-xs font-medium text-brand cursor-pointer"
          >
            {expanded ? t("show_less") : t("show_more")}
          </button>
        </div>
      </div>
    </Card>
  );
}

function KpiGrid({ data }: { data: OverviewResp }) {
  const { t } = useI18n();
  const { totals, deltas } = data;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiCard
        index={0}
        label={t("spend")}
        value={fmtUSD(totals.spend)}
        delta={deltas.spend}
        deltaInvert
        icon={<DollarSign size={14} />}
      />
      <KpiCard
        index={1}
        label={t("impressions")}
        value={fmtNum(totals.impressions)}
        delta={deltas.impressions}
        icon={<Eye size={14} />}
      />
      <KpiCard
        index={2}
        label={t("ctr_all")}
        value={fmtPct(totals.ctrAll)}
        delta={deltas.ctrAll}
        icon={<MousePointerClick size={14} />}
      />
      <KpiCard
        index={3}
        label={t("crm_leads")}
        value={fmtNum(totals.crmLeads)}
        delta={deltas.crmLeads}
        icon={<Users size={14} />}
      />
      <KpiCard
        index={4}
        label={t("won")}
        value={fmtNum(totals.won)}
        delta={deltas.won}
        icon={<Target size={14} />}
      />
      <KpiCard
        index={5}
        label={t("win_rate")}
        value={fmtPct(totals.winRate, 1)}
        delta={deltas.winRate}
        icon={<Percent size={14} />}
      />
      <KpiCard
        index={6}
        hero
        label={t("revenue")}
        value={fmtUSD(totals.revenue)}
        delta={deltas.revenue}
        sub={
          <span>
            {t("attributed_roas")} <b className="num">{fmtRoas(totals.attributedRoas)}</b>
          </span>
        }
        icon={<TrendingUp size={14} />}
      />
      <KpiCard
        index={7}
        label={t("cpl")}
        value={fmtUSD(totals.cpl)}
        delta={deltas.cpl}
        deltaInvert
        sub={`CAC ${fmtUSD(totals.cac)}`}
      />
    </div>
  );
}

function Spotlight({ kind, c }: { kind: "best" | "leak"; c: CampaignAgg | null }) {
  const { t, lang } = useI18n();
  const isBest = kind === "best";
  const label = isBest ? t("best_campaign") : t("money_leak");

  if (!c) {
    return (
      <Card className="border-dashed">
        <EmptyState label={`${label} — ${t("no_data")}`} compact />
      </Card>
    );
  }

  const accent = isBest ? "var(--success)" : "var(--danger)";
  const soft = isBest ? "var(--success-soft)" : "var(--danger-soft)";

  return (
    <div
      className="card p-5 animate-fade-up relative overflow-hidden"
      style={{ borderColor: accent, borderWidth: 1.5 }}
    >
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: accent }}
        aria-hidden
      />
      <div className="flex items-center gap-2 mb-2">
        <span
          className="w-7 h-7 rounded-lg grid place-items-center shrink-0"
          style={{ background: soft, color: accent }}
        >
          {isBest ? <Trophy size={15} /> : <AlertTriangle size={15} />}
        </span>
        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: accent }}>
          {label}
        </span>
      </div>

      <h3 className="text-lg font-semibold text-text mb-3 leading-snug line-clamp-2" title={c.campaign}>
        {c.campaign}
      </h3>

      <div className="grid grid-cols-3 gap-3">
        <MiniStat label={t("spend")} value={fmtUSD(c.spend)} />
        <MiniStat label={t("revenue")} value={fmtUSD(c.revenue)} />
        <MiniStat label={t("roas")} value={<RoasPill roas={c.roas} size="md" />} />
        <MiniStat label={t("crm_leads")} value={fmtNum(c.crmLeads)} />
        <MiniStat label={t("won")} value={fmtNum(c.won)} />
        <MiniStat label={t("cpl")} value={fmtUSD(c.cpl)} />
      </div>

      {c.topAd && (
        <div className="mt-4 pt-3 border-t border-border">
          <div className="text-[11px] text-text-muted mb-0.5">{t("top_ad_by_spend")}</div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-medium text-text truncate" title={c.topAd.name}>
              {c.topAd.name}
            </span>
            <span className="num text-[13px] text-text-muted shrink-0">{fmtUSD(c.topAd.spend)}</span>
          </div>
        </div>
      )}

      {!isBest && c.roas < 1 && (
        <p className="mt-3 text-xs leading-relaxed" style={{ color: accent }}>
          {lang === "ar"
            ? "العائد أقل من الإنفاق — راجع الاستهداف أو أوقف الحملة."
            : "Returning less than it costs — review targeting or pause it."}
        </p>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-text-muted truncate">{label}</div>
      <div className="num font-semibold text-text mt-0.5 text-sm">{value}</div>
    </div>
  );
}

function BudgetLeaks({ rows }: { rows: CampaignAgg[] }) {
  const { t, lang } = useI18n();
  return (
    <Card>
      <SectionTitle
        hint={
          lang === "ar"
            ? "حملات أنفقت أكثر مما أعادت — مرتبة من الأسوأ."
            : "Campaigns spending more than they return — worst first."
        }
      >
        {t("where_budget_goes")}
      </SectionTitle>

      {rows.length === 0 ? (
        <EmptyState label={t("no_data")} compact />
      ) : (
        <div className="space-y-1">
          {rows.map((c, i) => (
            <div
              key={c.campaign + i}
              className="flex items-center gap-3 py-2 border-b border-border last:border-0 stagger"
              style={{ "--i": i } as React.CSSProperties}
            >
              <span className="flex-1 min-w-0 truncate text-[13px] text-text" title={c.campaign}>
                {c.campaign}
              </span>
              <span className="num text-[13px] text-text-muted shrink-0 w-16 text-end">
                {fmtUSD(c.spend)}
              </span>
              <span className="num text-[13px] text-text-muted shrink-0 w-16 text-end">
                {fmtUSD(c.revenue)}
              </span>
              <RoasPill roas={c.roas} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DataHealth({ data }: { data: OverviewResp }) {
  const { t, lang } = useI18n();
  // Scoped to the selected window, so it agrees with the KPI cards above.
  const { revenue, attributedRevenue } = data.totals;
  const attributed = revenue > 0 ? (attributedRevenue / revenue) * 100 : 0;

  return (
    <Card>
      <SectionTitle
        hint={
          lang === "ar"
            ? "مدى اكتمال الربط بين الإعلانات والمبيعات في هذه الفترة."
            : "How completely ads and sales link up in this period."
        }
      >
        {t("data_notes")}
      </SectionTitle>

      <div className="space-y-3">
        <HealthRow
          label={t("attributed_revenue")}
          value={`${fmtPct(attributed, 1)} · ${fmtUSD(attributedRevenue)}`}
          tone={attributed > 50 ? "success" : attributed > 20 ? "warning" : "danger"}
          hint={t("attributed_note")}
        />
        <HealthRow
          label={t("attributed_roas")}
          value={fmtRoas(data.totals.attributedRoas)}
          tone={
            data.totals.attributedRoas >= 2
              ? "success"
              : data.totals.attributedRoas >= 1
                ? "warning"
                : "danger"
          }
        />
        <HealthRow
          label={t("match_rate")}
          value={fmtPct(data.matchRate * 100, 1)}
          tone={data.matchRate > 0.8 ? "success" : data.matchRate > 0.5 ? "warning" : "danger"}
        />
        <HealthRow
          label={`${t("unmatched")} — ${t("revenue")}`}
          value={fmtNum(data.unmatchedRevenueCampaigns)}
          tone="neutral"
        />
      </div>

      {data.fetchErrors.length > 0 && (
        <div className="mt-4">
          <Notice tone="danger" icon={<AlertTriangle size={15} />}>
            {data.fetchErrors.join(" · ")}
          </Notice>
        </div>
      )}
    </Card>
  );
}

function HealthRow({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: "neutral" | "success" | "warning" | "danger";
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[13px] text-text">{label}</div>
        {hint && <div className="text-[11px] text-text-muted mt-0.5">{hint}</div>}
      </div>
      <Pill tone={tone}>{value}</Pill>
    </div>
  );
}
