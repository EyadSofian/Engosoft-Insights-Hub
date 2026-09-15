import type { ReactNode } from "react";
import {
  ArrowRight,
  BadgeDollarSign,
  CheckCircle2,
  CircleDashed,
  DollarSign,
  Filter,
  Gauge,
  Image as ImageIcon,
  Megaphone,
  Scale,
  ShieldCheck,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import { KpiRow, PageSection, SecondaryMetrics } from "@/components/dashboard-bits";
import { MetricDetailTrigger } from "@/components/metric-detail";
import { Link } from "@tanstack/react-router";
import { Card, Pill } from "@/components/ui-bits";
import { toneVars } from "@/lib/dashboard-tone";
import type { Kpi, KpiFormat, KpiStatus } from "@/lib/closed-loop-kpis";
import { fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import type { ClosedLoopResponse } from "./ClosedLoop";

/**
 * The first screen of Acquisition, for a manager rather than an analyst.
 *
 * Every figure comes from the server's scoped KPI objects, so the card, its
 * definition and its numerator/denominator can never disagree. A figure whose
 * source is not connected or not yet synced says so in words; it is never
 * drawn as 0.
 */

type Lang = "ar" | "en";

export const STATUS_TEXT: Record<Exclude<KpiStatus, "ok">, { en: string; ar: string }> = {
  no_denominator: { en: "Nothing to divide by", ar: "لا يوجد مقام للقسمة" },
  pending_sync: { en: "Pending sync", ar: "بانتظار المزامنة" },
  not_connected: { en: "Not connected", ar: "غير متصل" },
  historical_evidence_missing: {
    en: "Historical evidence missing",
    ar: "الدليل التاريخي غير متوفر",
  },
};

export function formatKpiValue(value: number, format: KpiFormat): string {
  switch (format) {
    case "usd":
      return fmtUSD(value);
    case "ratio":
      return `${value.toFixed(2)}×`;
    case "percent":
      return fmtPct(value * 100, 1);
    default:
      return fmtNum(value);
  }
}

/** A KPI's value, or the reason it has none. Never a zero standing in for "unknown". */
export function kpiDisplay(kpi: Kpi | undefined, lang: Lang): string {
  if (!kpi) return lang === "ar" ? "غير متوفر" : "Unavailable";
  if (kpi.status !== "ok" || kpi.value === null) {
    return STATUS_TEXT[kpi.status === "ok" ? "no_denominator" : kpi.status][lang];
  }
  return formatKpiValue(kpi.value, kpi.format);
}

export function KpiFigure({
  kpi,
  index,
  icon,
  tone,
  sub,
  loading,
  hero,
}: {
  kpi: Kpi | undefined;
  index: number;
  icon: ReactNode;
  tone: "violet" | "mint" | "sky" | "amber" | "rose";
  sub?: string;
  loading: boolean;
  hero?: boolean;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const label = kpi ? (A ? kpi.label.ar : kpi.label.en) : "—";
  const unavailable = kpi && (kpi.status !== "ok" || kpi.value === null);
  const supporting =
    kpi?.numerator && kpi.denominator
      ? [
          {
            key: "numerator",
            label: A ? kpi.numerator.label.ar : kpi.numerator.label.en,
            value: formatKpiValue(kpi.numerator.value, kpi.numerator.format),
          },
          {
            key: "denominator",
            label: A ? kpi.denominator.label.ar : kpi.denominator.label.en,
            value: formatKpiValue(kpi.denominator.value, kpi.denominator.format),
          },
        ]
      : undefined;
  return (
    <MetricDetailTrigger
      detail={{
        id: `acquisition_performance.overview.${kpi?.key ?? index}`,
        title: label,
        value: kpiDisplay(kpi, lang),
        tone: unavailable ? "slate" : tone,
        icon,
        definition: kpi ? (A ? kpi.definition.ar : kpi.definition.en) : "",
        formula: kpi?.formula,
        supporting,
        caveat:
          unavailable && kpi
            ? A
              ? `لا يوجد رقم: ${STATUS_TEXT[kpi.status === "ok" ? "no_denominator" : kpi.status].ar}. لا يُعرض صفر مكانه.`
              : `No figure: ${STATUS_TEXT[kpi.status === "ok" ? "no_denominator" : kpi.status].en}. A zero is never shown in its place.`
            : undefined,
      }}
      card={{ index, sub, subWrap: true, loading, hero, valueWrap: Boolean(unavailable) }}
    />
  );
}

export function OverviewKpis({ data, loading }: { data?: ClosedLoopResponse; loading: boolean }) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const k = data?.kpis;
  const shown = (key: string) => (k?.[key] ? kpiDisplay(k[key], lang) : "—");
  return (
    <PageSection
      level="headline"
      title={A ? "من الإعلان إلى الإيراد" : "From ad to revenue"}
      hint={
        A
          ? "العملاء والمبيعات والإيراد للعملاء الذين نعرف إعلانهم بالضبط. اضغط أي رقم لترى كيف حُسب."
          : "Leads, sales and revenue for leads we can trace to their exact ad. Press any figure to see how it was calculated."
      }
    >
      <KpiRow>
        <KpiFigure
          kpi={k?.adSpend}
          index={0}
          icon={<DollarSign size={17} />}
          tone="amber"
          loading={loading}
          sub={
            A
              ? `منها ${shown("trackedSpend")} على حملات متتبَّعة`
              : `${shown("trackedSpend")} on tracked campaigns`
          }
        />
        <KpiFigure
          kpi={k?.leads}
          index={1}
          icon={<Users size={17} />}
          tone="violet"
          loading={loading}
          sub={
            A
              ? `${shown("trackedLeads")} من إعلانات متتبَّعة`
              : `${shown("trackedLeads")} from tracked ads`
          }
        />
        <KpiFigure
          kpi={k?.qualified}
          index={2}
          icon={<Target size={17} />}
          tone="sky"
          loading={loading}
          sub={
            A
              ? `معدل التأهيل ${shown("qualificationRate")}`
              : `${shown("qualificationRate")} qualification rate`
          }
        />
        <KpiFigure
          kpi={k?.won}
          index={3}
          icon={<Trophy size={17} />}
          tone="mint"
          loading={loading}
          sub={A ? `معدل الفوز ${shown("winRate")}` : `${shown("winRate")} win rate`}
        />
        <KpiFigure
          kpi={k?.revenue}
          index={4}
          icon={<BadgeDollarSign size={17} />}
          tone="mint"
          loading={loading}
          hero
          sub={A ? `${shown("revenuePerLead")} لكل عميل` : `${shown("revenuePerLead")} per lead`}
        />
        <KpiFigure
          kpi={k?.roasAllSpend}
          index={5}
          icon={<Gauge size={17} />}
          tone="violet"
          loading={loading}
          sub={
            A
              ? `${shown("roasTracked")} على الحملات المتتبَّعة`
              : `${shown("roasTracked")} on tracked campaigns`
          }
        />
      </KpiRow>
      <SecondaryMetrics label={A ? "أرقام إضافية" : "More figures"} count={2}>
        <KpiRow>
          <KpiFigure
            kpi={k?.crmMatched}
            index={0}
            icon={<ShieldCheck size={17} />}
            tone="sky"
            loading={loading}
            sub={
              A ? `${shown("crmMatchRate")} من كل العملاء` : `${shown("crmMatchRate")} of all leads`
            }
          />
          <KpiFigure
            kpi={k?.costPerCustomerAll}
            index={1}
            icon={<Scale size={17} />}
            tone="rose"
            loading={loading}
            sub={
              A
                ? `${shown("costPerCustomerTracked")} على الحملات المتتبَّعة`
                : `${shown("costPerCustomerTracked")} on tracked campaigns`
            }
          />
        </KpiRow>
      </SecondaryMetrics>
    </PageSection>
  );
}

export function SimpleFunnel({ data, loading }: { data?: ClosedLoopResponse; loading: boolean }) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const k = data?.kpis;
  const clicks = data?.totals?.clicks ?? 0;
  const steps: { key: string; label: string; value: string; count?: number; note?: string }[] = [
    {
      key: "spend",
      label: A ? "صرف الإعلانات" : "Ad spend",
      value: kpiDisplay(k?.adSpend, lang),
      note: clicks ? (A ? `${fmtNum(clicks)} نقرة` : `${fmtNum(clicks)} clicks`) : undefined,
    },
    {
      key: "leads",
      label: A ? "عملاء من إعلانات متتبَّعة" : "Leads from tracked ads",
      value: kpiDisplay(k?.trackedLeads, lang),
      count: k?.trackedLeads?.value ?? undefined,
    },
    {
      key: "matched",
      label: A ? "مطابق في CRM" : "CRM matched",
      value: kpiDisplay(k?.crmMatched, lang),
      count: k?.crmMatched?.value ?? undefined,
    },
    {
      key: "qualified",
      label: A ? "مؤهل" : "Qualified",
      value: kpiDisplay(k?.qualified, lang),
      count: k?.qualified?.value ?? undefined,
    },
    {
      key: "won",
      label: A ? "مكسوب" : "Won",
      value: kpiDisplay(k?.won, lang),
      count: k?.won?.value ?? undefined,
    },
    {
      key: "revenue",
      label: A ? "إيراد مدفوع" : "Paid revenue",
      value: kpiDisplay(k?.revenue, lang),
    },
  ];
  return (
    <PageSection
      level="insight"
      title={A ? "رحلة العميل" : "Customer journey"}
      icon={<Filter size={16} />}
      tone="sky"
      hint={
        A
          ? "كل خطوة نسبة من الخطوة التي قبلها. العملاء هنا هم من نعرف إعلانهم بالضبط."
          : "Each step is a share of the step before it. Leads here are those whose exact ad is known."
      }
    >
      <Card padded>
        <ol className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {steps.map((step, index) => {
            const previous = steps[index - 1]?.count;
            const rate =
              step.count !== undefined && previous ? (step.count / previous) * 100 : null;
            return (
              <li key={step.key} className="relative rounded-xl bg-surface-2 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  {step.label}
                </div>
                <div className="num mt-1 text-lg font-bold text-text">
                  {loading ? "…" : step.value}
                </div>
                <div className="mt-0.5 min-h-4 text-[11px] text-text-muted">
                  {rate !== null && rate <= 100
                    ? A
                      ? `${fmtPct(rate, 1)} من السابق`
                      : `${fmtPct(rate, 1)} of previous`
                    : (step.note ?? "")}
                </div>
                {index < steps.length - 1 ? (
                  <ArrowRight
                    size={14}
                    aria-hidden
                    className="absolute -end-2.5 top-1/2 hidden -translate-y-1/2 text-text-subtle xl:block rtl:rotate-180"
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      </Card>
    </PageSection>
  );
}

const PLATFORM_NAME: Record<string, { en: string; ar: string }> = {
  facebook: { en: "Facebook", ar: "فيسبوك" },
  instagram: { en: "Instagram", ar: "إنستغرام" },
  messenger: { en: "Messenger", ar: "ماسنجر" },
  audience_network: { en: "Audience Network", ar: "شبكة الجمهور" },
  meta: { en: "Meta", ar: "Meta" },
  whatsapp: { en: "WhatsApp", ar: "واتساب" },
  unknown: { en: "Unknown platform", ar: "منصة غير معروفة" },
};
const ENTITY_NAME: Record<string, { en: string; ar: string }> = {
  meta_lead: { en: "Instant form", ar: "نموذج فوري" },
  chatwoot_conversation: { en: "Conversation", ar: "محادثة" },
  landing_submission: { en: "Landing page form", ar: "نموذج صفحة هبوط" },
};

export function BestPerformers({
  data,
  loading,
  onOpenCreative,
}: {
  data?: ClosedLoopResponse;
  loading: boolean;
  onOpenCreative: (id: string) => void;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const i = data?.insights;
  const roas = (value: number | null | undefined) => (value == null ? "—" : `${value.toFixed(2)}×`);
  const card = (props: {
    icon: ReactNode;
    eyebrow: string;
    title: ReactNode;
    value: string;
    lines: string[];
    thumbnail?: string;
    onClick?: () => void;
  }) => (
    <Card
      padded
      className={props.onClick ? "cursor-pointer transition-colors hover:border-brand" : ""}
    >
      <div
        role={props.onClick ? "button" : undefined}
        tabIndex={props.onClick ? 0 : undefined}
        onClick={props.onClick}
        onKeyDown={(event) => {
          if (props.onClick && (event.key === "Enter" || event.key === " ")) props.onClick();
        }}
        className="flex gap-3"
      >
        {props.thumbnail !== undefined ? (
          props.thumbnail ? (
            <img
              src={props.thumbnail}
              alt=""
              loading="lazy"
              className="h-16 w-16 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-surface-2 text-text-muted">
              <ImageIcon size={18} />
            </div>
          )
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            {props.icon}
            {props.eyebrow}
          </div>
          <div className="mt-1 line-clamp-2 text-sm font-semibold text-text">{props.title}</div>
          <div className="num mt-1 text-lg font-bold text-text">{loading ? "…" : props.value}</div>
          {props.lines.map((line) => (
            <div key={line} className="text-xs text-text-muted">
              {line}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
  const none = A ? "لا توجد بيانات كافية في الفترة" : "Not enough data in this period";
  const source = i?.bestLeadSource;
  return (
    <PageSection
      level="insight"
      title={A ? "الأفضل في الفترة" : "Best in this period"}
      icon={<Trophy size={16} />}
      tone="mint"
      hint={A ? "مرتبة بالإيراد المدفوع." : "Ranked by paid revenue."}
    >
      <div className="grid gap-3 md:grid-cols-3">
        {card({
          icon: <ImageIcon size={12} />,
          eyebrow: A ? "أفضل مادة إعلانية" : "Best creative",
          title: i?.bestCreative?.creativeName || none,
          value: i?.bestCreative ? fmtUSD(i.bestCreative.revenue) : "—",
          lines: i?.bestCreative
            ? [
                `${fmtNum(i.bestCreative.won)} ${A ? "عميل مكسوب" : "won"} · ROAS ${roas(i.bestCreative.roas)}`,
                `${fmtNum(i.bestCreative.leads)} ${A ? "عميل" : "leads"} · ${A ? "صرف" : "spend"} ${fmtUSD(i.bestCreative.spend)}`,
              ]
            : [],
          thumbnail: i?.bestCreative ? (i.bestCreative.thumbnailUrl ?? "") : undefined,
          onClick: i?.bestCreative ? () => onOpenCreative(i.bestCreative!.creativeId) : undefined,
        })}
        {card({
          icon: <Megaphone size={12} />,
          eyebrow: A ? "أفضل حملة" : "Best campaign",
          title: i?.bestCampaign?.campaignName || none,
          value: i?.bestCampaign ? fmtUSD(i.bestCampaign.revenue) : "—",
          lines: i?.bestCampaign
            ? [
                `${fmtNum(i.bestCampaign.won)} ${A ? "عميل مكسوب" : "won"} · ROAS ${roas(i.bestCampaign.roas)}`,
                `${fmtNum(i.bestCampaign.leads)} ${A ? "عميل" : "leads"} · ${A ? "صرف" : "spend"} ${fmtUSD(i.bestCampaign.spend)}`,
              ]
            : [],
        })}
        {card({
          icon: <Users size={12} />,
          eyebrow: A ? "أفضل مصدر للعملاء" : "Best lead source",
          title: source
            ? `${(A ? PLATFORM_NAME[source.sourcePlatform]?.ar : PLATFORM_NAME[source.sourcePlatform]?.en) ?? source.sourcePlatform} · ${(A ? ENTITY_NAME[source.entityType]?.ar : ENTITY_NAME[source.entityType]?.en) ?? source.entityType}`
            : none,
          value: source ? fmtUSD(source.metrics.revenue) : "—",
          lines: source
            ? [
                `${fmtNum(source.metrics.won)} ${A ? "عميل مكسوب" : "won"} · ${fmtNum(source.metrics.leads)} ${A ? "عميل" : "leads"}`,
              ]
            : [],
        })}
      </div>
    </PageSection>
  );
}

export function CheapVersusQuality({
  data,
  loading,
  onOpenCreative,
}: {
  data?: ClosedLoopResponse;
  loading: boolean;
  onOpenCreative: (id: string) => void;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const pair = data?.insights?.cheapVersusQuality;
  if (!pair && !loading) return null;
  const side = (
    row: NonNullable<typeof pair>["cheapest"] | undefined,
    title: string,
    tone: "rose" | "mint",
  ) => (
    <button
      type="button"
      onClick={() => row && onOpenCreative(row.creativeId)}
      className={`flex w-full gap-3 rounded-xl border p-3 text-start transition-colors hover:border-brand ${
        tone === "mint" ? "border-success/40 bg-success/5" : "border-danger/40 bg-danger/5"
      }`}
    >
      {row?.thumbnailUrl ? (
        <img
          src={row.thumbnailUrl}
          alt=""
          loading="lazy"
          className="h-16 w-16 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-surface-2 text-text-muted">
          <ImageIcon size={18} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          {title}
        </div>
        <div className="line-clamp-1 text-sm font-semibold text-text">
          {row?.creativeName ?? "…"}
        </div>
        <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-text-muted">{A ? "تكلفة العميل" : "Cost per lead"}</dt>
            <dd className="num font-semibold">{row?.cpl == null ? "—" : fmtUSD(row.cpl)}</dd>
          </div>
          <div>
            <dt className="text-text-muted">{A ? "مكسوب" : "Won"}</dt>
            <dd className="num font-semibold">{row ? fmtNum(row.won) : "—"}</dd>
          </div>
          <div>
            <dt className="text-text-muted">{A ? "إيراد لكل عميل" : "Revenue per lead"}</dt>
            <dd className="num font-semibold">
              {row?.revenuePerLead == null ? "—" : fmtUSD(row.revenuePerLead)}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted">ROAS</dt>
            <dd className="num font-semibold">
              {row?.roas == null ? "—" : `${row.roas.toFixed(2)}×`}
            </dd>
          </div>
        </dl>
      </div>
    </button>
  );
  return (
    <PageSection
      level="insight"
      title={
        A ? "العميل الرخيص ليس بالضرورة عميلًا جيدًا" : "Cheap leads are not always good leads"
      }
      icon={<Scale size={16} />}
      tone="amber"
      hint={
        A
          ? "بين المواد التي جاءت بـ100 عميل أو أكثر: الأقل تكلفة لكل عميل مقابل الأعلى إيرادًا لكل عميل."
          : "Among creatives with 100 or more leads: the lowest cost per lead against the highest revenue per lead."
      }
    >
      <div className="grid gap-3 lg:grid-cols-2">
        {side(pair?.cheapest, A ? "الأرخص لكل عميل" : "Cheapest per lead", "rose")}
        {side(pair?.bestQuality, A ? "الأعلى إيرادًا لكل عميل" : "Most revenue per lead", "mint")}
      </div>
    </PageSection>
  );
}

/** A coverage share that never rounds an incomplete source up to 100%. */
export function coveragePercent(numerator: number, denominator: number): string {
  const value = (numerator / denominator) * 100;
  const oneDecimal = Math.round(value * 10) / 10;
  if (numerator < denominator && oneDecimal >= 100) return fmtPct(Math.floor(value * 100) / 100, 2);
  return fmtPct(value, 1);
}

/** Status words for channel rows. A channel without exact attribution is never drawn as 0%. */
const CHANNEL_WORDS: Record<string, { en: string; ar: string; tone: "good" | "wait" | "bad" }> = {
  connected: { en: "Connected", ar: "متصل", tone: "good" },
  infrastructure_ready_awaiting_traffic: {
    en: "Ready — awaiting first message",
    ar: "جاهز — بانتظار أول رسالة",
    tone: "good",
  },
  infrastructure_ready_meta_approval_pending: {
    en: "Infrastructure ready / Meta approval pending",
    ar: "البنية جاهزة / بانتظار موافقة Meta",
    tone: "wait",
  },
  infrastructure_ready_credential_pending: {
    en: "Infrastructure ready / credential pending",
    ar: "البنية جاهزة / بانتظار بيانات الاعتماد",
    tone: "wait",
  },
  inbox_setup_required: { en: "Inbox setup required", ar: "يلزم إعداد صندوق الوارد", tone: "wait" },
  not_connected: { en: "Not connected", ar: "غير متصل", tone: "bad" },
  healthy: { en: "Healthy", ar: "سليم", tone: "good" },
  needs_attention: { en: "Needs attention", ar: "يحتاج انتباه", tone: "bad" },
  not_checked: { en: "Not checked yet", ar: "لم يُفحص بعد", tone: "wait" },
};

const TONE_ICON: Record<"good" | "wait" | "bad", ReactNode> = {
  good: <CheckCircle2 size={14} className="text-success" />,
  wait: <CircleDashed size={14} className="text-warning" />,
  bad: <CircleDashed size={14} className="text-danger" />,
};

const SIMPLE_LABEL: Record<string, { en: string; ar: string }> = {
  meta_lead_attribution: { en: "Meta Lead attribution", ar: "إسناد عملاء Meta" },
  creative_attribution: { en: "Creative attribution", ar: "إسناد المادة الإعلانية" },
  form_attribution: { en: "Form attribution", ar: "إسناد النموذج" },
  crm_match: { en: "CRM exact match", ar: "المطابقة الدقيقة في CRM" },
  messaging_whatsapp: { en: "WhatsApp", ar: "واتساب" },
  messaging_messenger: { en: "Messenger", ar: "ماسنجر" },
  messaging_instagram: { en: "Instagram", ar: "إنستغرام" },
  chatwoot_ingestion: { en: "Chatwoot ingestion", ar: "استقبال محادثات Chatwoot" },
};

/**
 * Data coverage for managers: one line per source, a percentage only where the
 * source is connected, status words everywhere else. Everything technical
 * (CRM link breakdown, ingestion counts, historical evidence) lives in
 * CoverageTechnicalDetails behind "View technical details".
 */
export function DataCoverageCard({
  data,
  loading,
  onViewDetails,
}: {
  data?: ClosedLoopResponse;
  loading: boolean;
  onViewDetails?: () => void;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const items = (data?.coverageSummary ?? []).filter((item) => SIMPLE_LABEL[item.key]);
  return (
    <PageSection
      level="insight"
      title={A ? "تغطية البيانات" : "Data coverage"}
      icon={<ShieldCheck size={16} />}
      tone="sky"
      hint={
        A
          ? "إلى أي حد نستطيع تتبع العملاء. النسبة تُعرض فقط حيث يكون المصدر متصلًا."
          : "How much of the journey we can trace. A percentage appears only where the source is connected."
      }
      action={
        onViewDetails ? (
          <button
            type="button"
            onClick={onViewDetails}
            className="text-xs font-semibold text-brand hover:underline"
          >
            {A ? "عرض التفاصيل التقنية" : "View technical details"}
          </button>
        ) : undefined
      }
    >
      <Card padded>
        <ul className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
          {items.map((item) => {
            const words = item.channelStatus ? CHANNEL_WORDS[item.channelStatus] : undefined;
            const percent =
              !words && item.status === "ok" && item.denominator
                ? coveragePercent(item.numerator, item.denominator)
                : null;
            const tone = words?.tone ?? (percent ? "good" : "wait");
            const value = loading
              ? "…"
              : words
                ? A
                  ? words.ar
                  : words.en
                : (percent ??
                  STATUS_TEXT[item.status === "ok" ? "no_denominator" : item.status][lang]);
            return (
              <li
                key={item.key}
                // The label never breaks mid-word; on a narrow phone a long status
                // ("Infrastructure ready / credential pending") drops to its own
                // line instead of squeezing the channel name to "WhatsAp / p".
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                title={A ? item.note.ar : item.note.en}
              >
                {TONE_ICON[tone]}
                <span className="whitespace-nowrap text-sm text-text">
                  {A ? SIMPLE_LABEL[item.key]!.ar : SIMPLE_LABEL[item.key]!.en}
                </span>
                <span
                  className={`num ms-auto text-end text-sm font-bold ${tone === "bad" ? "text-danger" : tone === "wait" ? "text-text-muted" : "text-text"}`}
                >
                  {value}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </PageSection>
  );
}

/** The detail behind the simple card: CRM link breakdown, ingestion counts, history. */
export function CoverageTechnicalDetails({
  data,
  loading,
}: {
  data?: ClosedLoopResponse;
  loading: boolean;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const technical = (data?.coverageSummary ?? []).filter((item) => !SIMPLE_LABEL[item.key]);
  const rows = (data?.coverageSummary ?? []).filter((item) => SIMPLE_LABEL[item.key]);
  return (
    <PageSection
      title={A ? "تفاصيل التغطية" : "Coverage details"}
      icon={<ShieldCheck size={16} />}
      tone="sky"
    >
      <Card padded className="space-y-4 text-xs">
        <ul className="space-y-1.5">
          {[...rows, ...technical].map((item) => (
            <li key={item.key} className="flex flex-wrap gap-x-2">
              <b className="text-text">
                {A
                  ? (SIMPLE_LABEL[item.key]?.ar ?? item.label.ar)
                  : (SIMPLE_LABEL[item.key]?.en ?? item.label.en)}
              </b>
              <span className="text-text-muted">
                {item.denominator
                  ? `${fmtNum(item.numerator)} / ${fmtNum(item.denominator)} · `
                  : ""}
                {A ? item.note.ar : item.note.en}
              </span>
            </li>
          ))}
        </ul>
        {data?.crmBreakdown ? (
          <div>
            <div className="mb-1 font-semibold text-text">
              {A ? "ربط العملاء بـ CRM" : "CRM links"}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
              {(
                [
                  ["exact", A ? "روابط دقيقة" : "Exact CRM links"],
                  ["inferred", A ? "روابط مستنتجة" : "Inferred CRM links"],
                  ["ambiguous", A ? "غامضة (لم يُختر سجل)" : "Ambiguous (no record chosen)"],
                  ["unmatched", A ? "غير مطابقة" : "Unmatched"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex items-baseline justify-between gap-2">
                  <dt className="text-text-muted">{label}</dt>
                  <dd className="num font-semibold">
                    {loading ? "…" : fmtNum(data.crmBreakdown![key])}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-1 text-text-muted">
              {A
                ? "مؤشرات الإدارة تستخدم الروابط الدقيقة فقط."
                : "Management KPIs use exact links only."}
            </div>
          </div>
        ) : null}
        {data?.chatwootHealth ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-semibold text-text">
              {A ? "محادثات Chatwoot" : "Chatwoot conversations"}
            </span>
            <span>
              {A ? "واردة" : "Inbound"}{" "}
              <b className="num">{fmtNum(data.chatwootHealth.inboundConversations)}</b>
            </span>
            <span>
              {A ? "صفوف موجودة" : "Rows present"}{" "}
              <b className="num">{fmtNum(data.chatwootHealth.presentRows)}</b>
            </span>
            <span className={data.chatwootHealth.missing ? "text-danger" : ""}>
              {A ? "ناقصة" : "Missing"} <b className="num">{fmtNum(data.chatwootHealth.missing)}</b>
            </span>
            <span>
              {A ? "استُعيدت تلقائيًا" : "Recovered automatically"}{" "}
              <b className="num">{fmtNum(data.chatwootHealth.recovered)}</b>
            </span>
            <span className={data.chatwootHealth.failedOrStuck ? "text-danger" : ""}>
              {A ? "فاشلة/عالقة" : "Failed/stuck"}{" "}
              <b className="num">{fmtNum(data.chatwootHealth.failedOrStuck)}</b>
            </span>
          </div>
        ) : null}
        {data?.sources?.leadAdsDirect === "not_connected" ? (
          <div className="flex flex-wrap items-center gap-2 text-text-muted">
            <Pill tone="warning">{A ? "بانتظار بيانات الاعتماد" : "Credential pending"}</Pill>
            {A
              ? "أسماء نماذج Meta وإجاباتها تصل بعد إضافة بيانات اعتماد Attribution؛ باقي الأرقام لا تتأثر."
              : "Meta form names and answers arrive once the Attribution credential is added; the other figures are unaffected."}
          </div>
        ) : null}
      </Card>
    </PageSection>
  );
}

/* --- lead sources ---------------------------------------------------------- */

const SOURCE_CARDS: {
  type: string;
  label: { ar: string; en: string };
  tone: "violet" | "sky" | "mint" | "amber";
  view?: string;
  to?: string;
}[] = [
  {
    type: "meta_instant_form",
    label: { ar: "نماذج Meta", en: "Meta forms" },
    tone: "violet",
    view: "forms",
  },
  {
    type: "landing_submission",
    label: { ar: "صفحات الهبوط", en: "Landing pages" },
    tone: "sky",
    view: "landing",
  },
  { type: "whatsapp", label: { ar: "واتساب", en: "WhatsApp" }, tone: "mint", to: "/attribution" },
  {
    type: "messenger",
    label: { ar: "ماسنجر", en: "Messenger" },
    tone: "amber",
    to: "/attribution",
  },
];

/**
 * Where this period's leads came from, as four cards a manager can open.
 *
 * Each card carries the two numbers that decide what to do with a source: how
 * many leads it produced, and how many of those we can trace to their exact ad.
 * A source with no exact attribution says so in words — it is never a zero
 * dressed up as a result.
 */
export function LeadSourceCards({
  data,
  loading,
  onSelectView,
}: {
  data?: ClosedLoopResponse;
  loading: boolean;
  onSelectView: (view: string) => void;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const byType = new Map((data?.coverageByType ?? []).map((row) => [row.type, row]));

  return (
    <PageSection
      level="primary"
      title={A ? "مصادر العملاء" : "Where leads came from"}
      hint={A ? "اضغط أي مصدر لفتح تفاصيله." : "Open any source to see its detail."}
    >
      <div className="card-grid sm:grid-cols-2 xl:grid-cols-4">
        {SOURCE_CARDS.map((source, index) => {
          const row = byType.get(source.type);
          const total = row?.total ?? 0;
          const exact = row?.exact ?? 0;
          const card = (
            <>
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-[12px] font-semibold"
                  style={{ color: "var(--tone-ink)", opacity: 0.8 }}
                >
                  {source.label[lang]}
                </span>
                <Pill tone="neutral">{A ? "افتح" : "Open"}</Pill>
              </div>
              <div
                className="num mt-2 text-[26px] font-bold leading-none"
                style={{ color: "var(--tone-ink)" }}
              >
                {loading ? "…" : fmtNum(total)}
              </div>
              <p
                className="mt-1.5 text-[11.5px] leading-snug"
                style={{ color: "var(--tone-ink)", opacity: 0.7 }}
              >
                {total === 0
                  ? A
                    ? "لا عملاء من هذا المصدر في الفترة"
                    : "No leads from this source in the period"
                  : exact > 0
                    ? A
                      ? `${fmtNum(exact)} منهم نعرف إعلانهم بالضبط`
                      : `${fmtNum(exact)} traced to their exact ad`
                    : A
                      ? "لا يوجد إسناد دقيق لهذا المصدر بعد"
                      : "No exact attribution for this source yet"}
              </p>
            </>
          );
          const className =
            "tone-surface lift pad-card flex h-full min-w-0 flex-col text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tone-strong)]";
          const style = toneVars(source.tone);
          return source.to ? (
            <Link key={source.type} to={source.to} className={className} style={style}>
              {card}
            </Link>
          ) : (
            <button
              key={source.type}
              type="button"
              onClick={() => source.view && onSelectView(source.view)}
              className={`${className} cursor-pointer`}
              style={style}
              data-index={index}
            >
              {card}
            </button>
          );
        })}
      </div>
    </PageSection>
  );
}
