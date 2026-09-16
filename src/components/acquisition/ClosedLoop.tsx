import { useMemo, useState, type ReactNode } from "react";
import {
  BadgeDollarSign,
  Filter,
  Gauge,
  Image as ImageIcon,
  Layers,
  Link2,
  ShieldCheck,
  Trophy,
  X,
} from "lucide-react";
import { DataTable, type Col } from "@/components/DataTable";
import { DetailPanel } from "@/components/DetailPanel";
import { KpiRow, PageSection } from "@/components/dashboard-bits";
import { MetricDetailTrigger } from "@/components/metric-detail";
import { Card, Pill, Segmented } from "@/components/ui-bits";
import { nameWithId } from "@/components/attribution/acquisition-labels";
import type { ClosedLoopGrain, FunnelStep, GrainRow, QualityMetrics } from "@/lib/closed-loop";
import type { Kpi, KpiStatus } from "@/lib/closed-loop-kpis";
import type {
  ManagementHealthIndicator,
  ManagementScope,
  RevenueReconciliation,
  ScopeSpend,
} from "@/lib/management-scope";
import { kpiDisplay } from "./ManagementOverview";
import { fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";

/**
 * Closed-loop Marketing → Sales views. Every entity row is credited only with
 * acquisitions that carry its exact provider ID; CRM outcomes arrive through
 * acquisition_crm_links. Coverage is always shown next to the figures, because
 * a win rate means nothing without its denominator.
 */

type CreativeGrainRow = GrainRow & {
  thumbnailUrl?: string;
  mediaType?: string;
  videoId?: string;
  headline?: string;
};

interface CoverageNumbers {
  total: number;
  withCampaignId: number;
  withAdsetId: number;
  withAdId: number;
  withCreativeId: number;
  withFormId: number;
  exact: number;
  crmMatched: number;
  crmMatchedExact: number;
  unknown: number;
}

export interface OutcomeRecord {
  acquisitionEventId: string;
  occurredAt: string;
  entityType: string;
  destinationChannel: string;
  sourcePlatform: string;
  attributionConfidence: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  adId: string;
  adName: string;
  creativeId: string;
  creativeName: string;
  formId: string;
  landingPageId: string;
  crmLeadId: string;
  matchMethod: string;
  matchConfidence: string;
  stageKey: string;
  businessStatus: string;
  salesperson: string;
  salesTeam: string;
  course: string;
  interested: boolean;
  qualified: boolean;
  quotation: boolean;
  won: boolean;
  lost: boolean;
  saleOrderIds: string[];
  invoiceCount: number;
  revenue: number;
  wonAt: string;
  firstInvoiceAt: string;
}

interface DimensionBucket {
  key: string;
  label: string;
  metrics: QualityMetrics;
}

export interface ClosedLoopResponse {
  configured: boolean;
  period?: { from: string; to: string };
  /** The platform scope every figure was computed in (the global filter). */
  scope?: ManagementScope;
  /** False off Meta: exact attribution figures are then unavailable, never Meta under another name. */
  exactAttributionAvailable?: boolean;
  scopeTotals?: {
    spend: ScopeSpend;
    uniqueCrmLeads: number | null;
    uniqueWonCustomers: number | null;
    collectedRevenue: number | null;
    scopeLabel: { en: string; ar: string };
  };
  health?: ManagementHealthIndicator[];
  revenueReconciliation?: {
    paymentDate: RevenueReconciliation;
    leadCohort: RevenueReconciliation;
    linksAvailable: boolean;
    exactCohortDifference: number;
  } | null;
  refresh?: { status: string; finishedAt: string | null; lastError: string };
  marketing?: {
    campaigns: number;
    adsets: number;
    ads: number;
    creatives: number;
    assets: number;
    videoAssets: number;
    imageAssets: number;
    imageAssetsWithUrl?: number;
    copyVariations?: number;
    adsWithLeadForm?: number;
    leadForms?: number;
  };
  kpis?: Record<string, Kpi>;
  coverageSummary?: {
    key: string;
    label: { en: string; ar: string };
    numerator: number;
    denominator: number;
    status: KpiStatus;
    /** Channel rows: a status word instead of a percentage (see CHANNEL_WORDS). */
    channelStatus?: string;
    technical?: boolean;
    note: { en: string; ar: string };
  }[];
  crmBreakdown?: { exact: number; inferred: number; ambiguous: number; unmatched: number };
  chatwootHealth?: {
    inboundConversations: number;
    expectedRows: number;
    presentRows: number;
    missing: number;
    recovered: number;
    failedOrStuck: number;
    flagged: boolean;
    checkedAt: string | null;
  } | null;
  sources?: {
    leadAdsDirect: KpiStatus;
    messaging: KpiStatus;
    metaAdsSyncedThrough: string;
    catalogReconciledAt: string | null;
  };
  insights?: {
    bestCampaign: CreativeGrainRow | null;
    bestCreative: CreativeGrainRow | null;
    bestLeadSource: {
      key: string;
      sourcePlatform: string;
      entityType: string;
      metrics: QualityMetrics;
    } | null;
    cheapVersusQuality: { cheapest: CreativeGrainRow; bestQuality: CreativeGrainRow } | null;
  };
  crm?: {
    records: number;
    createdInPeriod: number;
    withFacebookLeadId: number;
    saleOrdersLinked: number;
  };
  coverage?: CoverageNumbers;
  coverageByType?: (CoverageNumbers & { type: string })[];
  matches?: { exact: number; inferred: number; unmatched: number };
  totals?: QualityMetrics;
  exactTotals?: QualityMetrics;
  funnel?: FunnelStep[];
  grains?: Record<ClosedLoopGrain, CreativeGrainRow[]>;
  assets?: {
    assetType: string;
    assetId: string;
    assetUrl: string;
    thumbnailUrl: string;
    creativeId: string;
    creativeName: string;
    attributionLevel: string;
    spend: number;
    leads: number;
    crmMatched: number;
    won: number;
    revenue: number;
  }[];
  leadQuality?: Record<ClosedLoopGrain, GrainRow[]>;
  byDimension?: Record<string, DimensionBucket[]>;
  best?: Record<string, CreativeGrainRow | null>;
  outcomes?: OutcomeRecord[];
}

export function useClosedLoop() {
  return useApi<ClosedLoopResponse>("/api/acquisition/closed-loop");
}

const pct = (value: number | null | undefined) => (value == null ? "—" : fmtPct(value * 100, 1));
const share = (part: number | undefined, whole: number | undefined) =>
  whole ? fmtPct(((part ?? 0) / whole) * 100, 1) : "—";
const money = (value: number | null | undefined) => (value == null ? "—" : fmtUSD(value));

const COVERAGE_TYPE: Record<string, { en: string; ar: string }> = {
  meta_instant_form: { en: "Meta instant form", ar: "نموذج Meta الفوري" },
  whatsapp: { en: "WhatsApp", ar: "واتساب" },
  messenger: { en: "Messenger", ar: "ماسنجر" },
  instagram: { en: "Instagram", ar: "إنستغرام" },
  website_chat: { en: "Website chat", ar: "دردشة الموقع" },
  landing_submission: { en: "Landing submission", ar: "إرسال صفحة هبوط" },
};

const MATCH_METHOD: Record<string, { en: string; ar: string }> = {
  crm_carried_provider_lead_id: {
    en: "Meta lead ID on CRM record",
    ar: "معرّف عميل Meta على سجل CRM",
  },
  provider_lead_id: { en: "Provider lead ID", ar: "معرّف العميل من المزود" },
  chatwoot_phone_key: { en: "Chatwoot phone key (inferred)", ar: "مفتاح هاتف Chatwoot (مستنتج)" },
};

const DIMENSION_LABEL: Record<string, { en: string; ar: string }> = {
  platform: { en: "Platform", ar: "المنصة" },
  campaign: { en: "Campaign", ar: "الحملة" },
  adset: { en: "Ad set", ar: "مجموعة الإعلان" },
  ad: { en: "Ad", ar: "الإعلان" },
  creative: { en: "Creative", ar: "المادة" },
  form: { en: "Lead form", ar: "النموذج" },
  landing_page: { en: "Landing page", ar: "صفحة الهبوط" },
  course: { en: "Course", ar: "الدورة" },
  salesperson: { en: "Salesperson", ar: "مندوب المبيعات" },
};

const FUNNEL_LABEL: Record<string, { en: string; ar: string }> = {
  impressions: { en: "Impressions", ar: "مرات الظهور" },
  clicks: { en: "Link clicks", ar: "نقرات الروابط" },
  acquisitions: { en: "Exact acquisitions", ar: "استحواذ دقيق" },
  crm_matched: { en: "CRM matched", ar: "مطابق في CRM" },
  interested: { en: "Interested", ar: "مهتم" },
  quotation: { en: "Quotation", ar: "عرض سعر" },
  won: { en: "Won", ar: "مغلق بنجاح" },
  sales_orders: { en: "Sales orders", ar: "أوامر البيع" },
  invoices: { en: "Invoices", ar: "الفواتير" },
  revenue: { en: "Paid revenue", ar: "الإيراد المدفوع" },
};

function Figure(props: {
  id: string;
  index: number;
  title: string;
  value: string;
  sub?: string;
  definition: string;
  caveat?: string;
  tone: "violet" | "mint" | "sky" | "amber" | "rose";
  icon: ReactNode;
  loading: boolean;
}) {
  return (
    <MetricDetailTrigger
      detail={{
        id: `acquisition_performance.closed_loop.${props.id}`,
        title: props.title,
        value: props.value,
        tone: props.tone,
        icon: props.icon,
        definition: props.definition,
        caveat: props.caveat,
      }}
      card={{ index: props.index, sub: props.sub, subWrap: true, loading: props.loading }}
    />
  );
}

/* --- coverage ------------------------------------------------------------- */

export function ClosedLoopCoverage({
  data,
  loading,
}: {
  data?: ClosedLoopResponse;
  loading: boolean;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const c = data?.coverage;
  const m = data?.marketing;
  const cols: Col<CoverageNumbers & { type: string }>[] = [
    {
      key: "type",
      header: A ? "نوع الاستحواذ" : "Acquisition type",
      always: true,
      render: (row) => (A ? COVERAGE_TYPE[row.type]?.ar : COVERAGE_TYPE[row.type]?.en) ?? row.type,
    },
    {
      key: "total",
      header: A ? "الإجمالي" : "Total",
      align: "right",
      render: (row) => fmtNum(row.total),
      sortValue: (row) => row.total,
    },
    ...(
      [
        ["withCampaignId", A ? "معرّف الحملة" : "Campaign ID"],
        ["withAdsetId", A ? "معرّف المجموعة" : "Ad set ID"],
        ["withAdId", A ? "معرّف الإعلان" : "Ad ID"],
        ["withCreativeId", A ? "معرّف المادة" : "Creative ID"],
        ["withFormId", A ? "معرّف النموذج" : "Form ID"],
        ["exact", A ? "دقيق" : "Exact"],
        ["crmMatched", A ? "مطابق CRM" : "CRM matched"],
      ] as const
    ).map(([key, header]) => ({
      key,
      header,
      align: "right" as const,
      render: (row: CoverageNumbers & { type: string }) => (
        <span>
          {fmtNum(row[key])}{" "}
          <span className="text-[11px] text-text-muted">{share(row[key], row.total)}</span>
        </span>
      ),
      sortValue: (row: CoverageNumbers & { type: string }) => row[key],
    })),
  ];
  return (
    <PageSection
      title={A ? "تغطية الربط المغلق" : "Closed-loop coverage"}
      icon={<ShieldCheck size={16} />}
      tone="sky"
      hint={
        A
          ? "كل معدل أدناه يحسب على العملاء المطابقين في CRM فقط. غير المعروف لا يدخل في معدلات الحملات أو المواد."
          : "Every rate below uses CRM-matched leads as its denominator. Unknown acquisitions never enter campaign or creative rates."
      }
    >
      <div className="space-y-3">
        <KpiRow>
          <Figure
            id="total"
            index={0}
            tone="violet"
            icon={<Layers size={17} />}
            loading={loading}
            title={A ? "إجمالي الاستحواذ" : "Total acquisitions"}
            value={fmtNum(c?.total)}
            sub={A ? "عملاء Meta + محادثات + إرسالات" : "Meta leads + conversations + submissions"}
            definition={
              A
                ? "كل أحداث الاستحواذ في الفترة بغض النظر عن الإسناد."
                : "Every acquisition event in the period, whatever its attribution."
            }
          />
          <Figure
            id="crm_matched"
            index={1}
            tone="mint"
            icon={<Link2 size={17} />}
            loading={loading}
            title={A ? "مطابق في CRM" : "Matched to CRM"}
            value={fmtNum(c?.crmMatched)}
            sub={`${share(c?.crmMatched, c?.total)} · ${A ? "دقيق" : "exact"} ${fmtNum(data?.matches?.exact)} · ${A ? "مستنتج" : "inferred"} ${fmtNum(data?.matches?.inferred)}`}
            definition={
              A
                ? "استحواذ له سجل CRM عبر معرّف عميل المزود (دقيق) أو علاقة Chatwoot بالهاتف (مستنتج)."
                : "Acquisitions with a CRM record through the provider lead ID (exact) or the Chatwoot phone relation (inferred)."
            }
            caveat={
              A
                ? "الربط المستنتج لا يعد إسنادًا دقيقًا."
                : "Inferred links are never counted as exact attribution."
            }
          />
          <Figure
            id="exact_campaign"
            index={2}
            tone="sky"
            icon={<ShieldCheck size={17} />}
            loading={loading}
            title={A ? "حملة دقيقة" : "Exact campaign"}
            value={fmtNum(c?.exact)}
            sub={share(c?.exact, c?.total)}
            definition={
              A
                ? "استحواذ حُل إعلانه في كتالوج Meta بمعرّف المزود."
                : "Acquisitions whose ad resolved in the Meta catalog by provider ID."
            }
          />
          <Figure
            id="exact_creative"
            index={3}
            tone="sky"
            icon={<ImageIcon size={17} />}
            loading={loading}
            title={A ? "مادة دقيقة" : "Exact creative"}
            value={fmtNum(c?.withCreativeId)}
            sub={share(c?.withCreativeId, c?.total)}
            definition={
              A
                ? "استحواذ معروف معرّف مادته الإعلانية من كتالوج Meta."
                : "Acquisitions whose creative ID is known from the Meta catalog."
            }
            caveat={
              A
                ? "الإعلانات القديمة قبل مزامنة المواد لا تحمل معرّف المادة."
                : "Older ads synced before creative sync carry no creative ID."
            }
          />
          <Figure
            id="unknown"
            index={4}
            tone="rose"
            icon={<Filter size={17} />}
            loading={loading}
            title={A ? "غير معروف" : "Unknown"}
            value={fmtNum(c?.unknown)}
            sub={share(c?.unknown, c?.total)}
            definition={
              A
                ? "استحواذ بلا دليل مصدر؛ يبقى غير معروف ولا يُنسب لمادة."
                : "Acquisitions without source evidence; they stay unknown and are never assigned a creative."
            }
          />
        </KpiRow>
        <Card padded className="text-xs text-text-muted">
          {A ? "كتالوج Meta: " : "Meta catalog: "}
          <b>{fmtNum(m?.campaigns)}</b> {A ? "حملة" : "campaigns"} · <b>{fmtNum(m?.adsets)}</b>{" "}
          {A ? "مجموعة" : "ad sets"} · <b>{fmtNum(m?.ads)}</b> {A ? "إعلان" : "ads"} ·{" "}
          <b>{fmtNum(m?.creatives)}</b> {A ? "مادة" : "creatives"} · <b>{fmtNum(m?.assets)}</b>{" "}
          {A ? "أصل (فيديو/صورة)" : "assets (video/image)"} · CRM{" "}
          <b>{fmtNum(data?.crm?.records)}</b> ·{" "}
          {A ? "أوامر بيع مرتبطة بفرصة" : "sales orders linked to an opportunity"}{" "}
          <b>{fmtNum(data?.crm?.saleOrdersLinked)}</b>
          {data?.refresh?.finishedAt
            ? ` · ${A ? "آخر تحديث للربط" : "graph refreshed"} ${String(data.refresh.finishedAt).replace("T", " ").slice(0, 16)}`
            : ""}
        </Card>
        <DataTable
          rows={data?.coverageByType ?? []}
          cols={cols}
          loading={loading}
          rowKey={(row) => row.type}
          csvFilename="engosoft-closed-loop-coverage.csv"
        />
      </div>
    </PageSection>
  );
}

/* --- sales bridge ----------------------------------------------------------- */

/**
 * The closed loop as seen from the sales side. Accounting counts revenue by
 * payment date; this counts the paid revenue of leads ACQUIRED in the period,
 * reached only through exact provider-ID links. The two bases never add up to
 * each other and the card says so.
 */
export function ClosedLoopSalesBridge() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const { data, isLoading, error } = useClosedLoop();
  if (error || (data && !data.configured)) return null;
  const e = data?.exactTotals;
  const c = data?.coverage;
  const top = data?.best?.revenue;
  return (
    <PageSection
      title={A ? "من الإعلان إلى الإيراد (ربط دقيق)" : "From ad to revenue (exact links)"}
      icon={<BadgeDollarSign size={16} />}
      tone="mint"
      hint={
        A
          ? "إيراد العملاء الذين وصلوا في الفترة ومرتبطون بإعلانهم بمعرّف المزود. أساسه تاريخ الاستحواذ، لذلك لا يساوي إيراد الحسابات بتاريخ الدفع."
          : "Paid revenue from leads acquired in the period and tied to their ad by provider ID. It is dated by acquisition, so it will not equal accounting revenue by payment date."
      }
    >
      <div className="space-y-3">
        <KpiRow>
          <Figure
            id="bridge_revenue"
            index={0}
            tone="mint"
            icon={<BadgeDollarSign size={17} />}
            loading={isLoading}
            title={A ? "إيراد مرتبط بإعلان" : "Ad-linked paid revenue"}
            value={fmtUSD(e?.revenue ?? 0)}
            sub={
              A
                ? `عائد الكوهورت على كل صرف Meta ${kpiDisplay(data?.kpis?.roasAllSpend, lang)} · على الحملات المتتبَّعة ${kpiDisplay(data?.kpis?.roasTracked, lang)}`
                : `Cohort ROAS on all Meta spend ${kpiDisplay(data?.kpis?.roasAllSpend, lang)} · on tracked campaigns ${kpiDisplay(data?.kpis?.roasTracked, lang)}`
            }
            definition={
              A
                ? "الإيراد المدفوع لأوامر بيع فرص CRM المرتبطة بعميل إعلان بمعرّف المزود."
                : "Paid revenue on sale orders of CRM opportunities linked to an ad lead by provider ID."
            }
            caveat={
              A
                ? "مؤرخ بتاريخ الاستحواذ وليس بتاريخ الدفع."
                : "Dated by acquisition, not by payment."
            }
          />
          <Figure
            id="bridge_won"
            index={1}
            tone="violet"
            icon={<Trophy size={17} />}
            loading={isLoading}
            title={A ? "فوز من إعلان" : "Wins from ads"}
            value={fmtNum(e?.won)}
            sub={`${A ? "معدل الفوز" : "win rate"} ${pct(e?.winRate)} · ${A ? "من" : "of"} ${fmtNum(e?.crmMatched)} ${A ? "مطابق" : "matched"}`}
            definition={
              A
                ? "فرص CRM بحالة فوز مرتبطة بعميل إعلان بمعرّف دقيق."
                : "Won CRM opportunities linked to an ad lead by exact ID."
            }
            caveat={
              A
                ? "المقام هو العملاء المطابقون في CRM فقط."
                : "The denominator is CRM-matched leads only."
            }
          />
          <Figure
            id="bridge_orders"
            index={2}
            tone="sky"
            icon={<Link2 size={17} />}
            loading={isLoading}
            title={A ? "أوامر بيع من إعلان" : "Sale orders from ads"}
            value={fmtNum(e?.saleOrders)}
            sub={`${A ? "فواتير" : "invoices"} ${fmtNum(e?.invoices)} · ${A ? "تكلفة العميل المكسوب (كل الصرف)" : "cost per customer (all ad spend)"} ${kpiDisplay(data?.kpis?.costPerCustomerAll, lang)}`}
            definition={
              A
                ? "أوامر بيع مؤكدة مرتبطة بالفرصة عبر opportunity_id في Odoo."
                : "Confirmed sale orders tied to the opportunity through Odoo opportunity_id."
            }
          />
          <Figure
            id="bridge_coverage"
            index={3}
            tone="amber"
            icon={<ShieldCheck size={17} />}
            loading={isLoading}
            title={A ? "تغطية الربط" : "Link coverage"}
            value={share(c?.crmMatchedExact, c?.total)}
            sub={`${fmtNum(c?.crmMatchedExact)} / ${fmtNum(c?.total)} ${A ? "استحواذ" : "acquisitions"}`}
            definition={
              A
                ? "الاستحواذ المرتبط بسجل CRM عبر معرّف عميل المزود، من كل الاستحواذ في الفترة."
                : "Acquisitions linked to a CRM record through the provider lead ID, out of every acquisition in the period."
            }
            caveat={
              A
                ? "غير المرتبط نتيجته غير معروفة، وليس خسارة."
                : "An unlinked lead has an unknown outcome, not a loss."
            }
          />
        </KpiRow>
        <Card padded className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          {top ? (
            <span>
              {A ? "أعلى مادة إيرادًا: " : "Top creative by revenue: "}
              <b className="text-text">{nameWithId(top.creativeName, top.creativeId)}</b> ·{" "}
              {fmtUSD(top.revenue)} · {fmtNum(top.won)} {A ? "فوز" : "won"}
            </span>
          ) : null}
          <span className="ms-auto flex flex-wrap gap-3">
            <a
              href="/accounting?view=marketing"
              className="font-semibold text-brand hover:underline"
            >
              {A ? "أداء المبيعات من التسويق ←" : "Sales performance →"}
            </a>
            <a href="/acquisition" className="font-semibold text-brand hover:underline">
              {A ? "التحليل حسب الحملة والمادة ←" : "By campaign and creative →"}
            </a>
          </span>
        </Card>
      </div>
    </PageSection>
  );
}

/* --- funnel ---------------------------------------------------------------- */

export function ClosedLoopFunnel({
  data,
  loading,
}: {
  data?: ClosedLoopResponse;
  loading: boolean;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const [dimension, setDimension] = useState("campaign");
  const rows = data?.byDimension?.[dimension] ?? [];
  const cols: Col<DimensionBucket>[] = [
    {
      key: "label",
      header: A ? DIMENSION_LABEL[dimension].ar : DIMENSION_LABEL[dimension].en,
      always: true,
      sticky: true,
      render: (row) => nameWithId(row.label, row.key !== row.label ? row.key : ""),
    },
    ...metricColumns<DimensionBucket>(A, (row) => row.metrics, [
      "leads",
      "crmMatched",
      "interested",
      "quotations",
      "won",
      "saleOrders",
      "invoices",
      "revenue",
      "spend",
      "interestRate",
      "winRate",
      "roas",
    ]),
  ];
  return (
    <PageSection
      title={A ? "قمع التسويق ← المبيعات" : "Marketing → sales funnel"}
      icon={<Gauge size={16} />}
      tone="violet"
      hint={
        A
          ? "الظهور والنقرات من Meta، ثم الاستحواذ الدقيق وما حدث له في CRM والمبيعات. الإيراد مدفوع لأوامر فرصة العميل نفسه."
          : "Impressions and clicks from Meta, then exact acquisitions and what happened to them in CRM and sales. Revenue is paid on the lead's own opportunity orders."
      }
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {(data?.funnel ?? []).map((step) => (
            <Card key={step.key} padded>
              <div className="text-[11px] font-semibold text-text-muted">
                {A ? FUNNEL_LABEL[step.key]?.ar : FUNNEL_LABEL[step.key]?.en}
              </div>
              <div className="text-lg font-bold text-text">
                {step.value == null
                  ? "—"
                  : step.key === "revenue"
                    ? fmtUSD(step.value)
                    : fmtNum(step.value)}
              </div>
              <div className="text-[11px] text-text-muted">
                {step.rateFromPrevious == null
                  ? " "
                  : `${pct(step.rateFromPrevious)} ${A ? "من السابق" : "of previous"}`}
              </div>
            </Card>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-muted">{A ? "تفصيل حسب" : "Drill down by"}</span>
          <Segmented
            value={dimension}
            onChange={setDimension}
            options={Object.keys(DIMENSION_LABEL).map((value) => ({
              value,
              label: A ? DIMENSION_LABEL[value].ar : DIMENSION_LABEL[value].en,
            }))}
          />
        </div>
        <DataTable
          rows={rows}
          cols={cols}
          loading={loading}
          rowKey={(row) => row.key}
          csvFilename={`engosoft-funnel-${dimension}.csv`}
          searchable={(row) => `${row.label} ${row.key}`}
        />
      </div>
    </PageSection>
  );
}

/* --- shared metric columns --------------------------------------------------- */

/** What a manager decides on. Every other metric is one click away in the column chooser. */
const CORE_METRICS = new Set<keyof QualityMetrics>([
  "spend",
  "leads",
  "qualified",
  "won",
  "revenue",
  "roas",
  "cac",
]);

const METRIC_DEFINITION: Partial<Record<keyof QualityMetrics, { en: string; ar: string }>> = {
  spend: {
    en: "Meta ad spend on this entity's exact ID.",
    ar: "صرف Meta على المعرّف الدقيق لهذا العنصر.",
  },
  leads: {
    en: "Leads traced to this entity's exact ID.",
    ar: "العملاء المتتبَّعون إلى المعرّف الدقيق لهذا العنصر.",
  },
  crmMatched: { en: "Leads matched to a CRM record.", ar: "العملاء المطابقون لسجل CRM." },
  qualified: {
    en: "Matched leads meeting the CRM qualification rule.",
    ar: "العملاء المطابقون المستوفون لقاعدة التأهيل في CRM.",
  },
  won: { en: "CRM opportunities marked Won.", ar: "فرص CRM المسجلة كفوز." },
  revenue: {
    en: "Paid invoice revenue of these leads.",
    ar: "إيراد الفواتير المدفوعة لهؤلاء العملاء.",
  },
  roas: { en: "Paid revenue ÷ ad spend of this entity.", ar: "الإيراد المدفوع ÷ صرف هذا العنصر." },
  cac: { en: "Ad spend ÷ customers won.", ar: "صرف الإعلانات ÷ العملاء المكسوبون." },
  cpl: { en: "Ad spend ÷ leads.", ar: "صرف الإعلانات ÷ العملاء." },
  winRate: {
    en: "Customers won ÷ CRM-matched leads.",
    ar: "العملاء المكسوبون ÷ العملاء المطابقون في CRM.",
  },
  revenuePerLead: { en: "Paid revenue ÷ leads.", ar: "الإيراد المدفوع ÷ العملاء." },
};

type MetricKey = keyof QualityMetrics;

function metricColumns<T>(
  A: boolean,
  get: (row: T) => QualityMetrics,
  keys: MetricKey[],
  /** False while Meta spend is not synced for the period: spend then reads "Pending sync", never $0. */
  spendAvailable = true,
): Col<T>[] {
  const pending = A ? "بانتظار المزامنة" : "Pending sync";
  const defs: Record<
    MetricKey,
    { en: string; ar: string; render: (m: QualityMetrics) => string; hide?: boolean }
  > = {
    leads: { en: "Leads", ar: "العملاء", render: (m) => fmtNum(m.leads) },
    conversations: { en: "Conversations", ar: "المحادثات", render: (m) => fmtNum(m.conversations) },
    metaFormLeads: {
      en: "Meta form leads",
      ar: "عملاء نماذج Meta",
      render: (m) => fmtNum(m.metaFormLeads),
    },
    landingLeads: {
      en: "Landing leads",
      ar: "عملاء الهبوط",
      render: (m) => fmtNum(m.landingLeads),
    },
    crmMatched: { en: "CRM matched", ar: "مطابق CRM", render: (m) => fmtNum(m.crmMatched) },
    interested: { en: "Interested", ar: "مهتم", render: (m) => fmtNum(m.interested) },
    qualified: { en: "Qualified", ar: "مؤهل", render: (m) => fmtNum(m.qualified) },
    quotations: { en: "Quotations", ar: "عروض أسعار", render: (m) => fmtNum(m.quotations) },
    won: { en: "Customers won", ar: "عملاء مكسوبون", render: (m) => fmtNum(m.won) },
    saleOrders: { en: "Sales orders", ar: "أوامر البيع", render: (m) => fmtNum(m.saleOrders) },
    invoices: { en: "Invoices", ar: "الفواتير", render: (m) => fmtNum(m.invoices) },
    revenue: { en: "Paid revenue", ar: "الإيراد المدفوع", render: (m) => fmtUSD(m.revenue) },
    spend: {
      en: "Ad spend",
      ar: "صرف الإعلانات",
      render: (m) => (spendAvailable ? fmtUSD(m.spend) : pending),
    },
    impressions: { en: "Impressions", ar: "الظهور", render: (m) => fmtNum(m.impressions) },
    clicks: { en: "Clicks", ar: "النقرات", render: (m) => fmtNum(m.clicks) },
    cpl: { en: "Cost per lead", ar: "تكلفة العميل", render: (m) => money(m.cpl) },
    costPerInterested: {
      en: "Cost / interested",
      ar: "تكلفة المهتم",
      render: (m) => money(m.costPerInterested),
    },
    costPerQualified: {
      en: "Cost / qualified",
      ar: "تكلفة المؤهل",
      render: (m) => money(m.costPerQualified),
    },
    costPerQuotation: {
      en: "Cost / quotation",
      ar: "تكلفة عرض السعر",
      render: (m) => money(m.costPerQuotation),
    },
    cac: { en: "Cost per customer", ar: "تكلفة العميل المكسوب", render: (m) => money(m.cac) },
    interestRate: {
      en: "Matched → interested",
      ar: "مطابق ← مهتم",
      render: (m) => pct(m.interestRate),
    },
    qualificationRate: {
      en: "Matched → qualified",
      ar: "مطابق ← مؤهل",
      render: (m) => pct(m.qualificationRate),
    },
    quotationRate: {
      en: "Matched → quotation",
      ar: "مطابق ← عرض سعر",
      render: (m) => pct(m.quotationRate),
    },
    winRate: {
      en: "Win rate (of matched)",
      ar: "معدل الفوز (من المطابق)",
      render: (m) => pct(m.winRate),
    },
    revenuePerLead: {
      en: "Revenue / lead",
      ar: "الإيراد لكل عميل",
      render: (m) => money(m.revenuePerLead),
    },
    roas: {
      en: "ROAS",
      ar: "العائد على الصرف",
      render: (m) => (m.roas == null ? "—" : `${m.roas.toFixed(2)}×`),
    },
  };
  return keys.map((key) => ({
    key,
    header: A ? defs[key].ar : defs[key].en,
    headerTitle: A ? METRIC_DEFINITION[key]?.ar : METRIC_DEFINITION[key]?.en,
    hideByDefault: !CORE_METRICS.has(key),
    align: "right" as const,
    render: (row: T) => defs[key].render(get(row)),
    sortValue: (row: T) => {
      const value = get(row)[key];
      return typeof value === "number" ? value : -1;
    },
  }));
}

// Spend, Revenue and ROAS lead as one financial decision group (order only).
const QUALITY_KEYS: MetricKey[] = [
  "spend",
  "revenue",
  "roas",
  "leads",
  "conversations",
  "metaFormLeads",
  "landingLeads",
  "crmMatched",
  "interested",
  "qualified",
  "quotations",
  "won",
  "cpl",
  "costPerInterested",
  "costPerQualified",
  "costPerQuotation",
  "cac",
  "interestRate",
  "qualificationRate",
  "winRate",
  "revenuePerLead",
];

/* --- hierarchy grains -------------------------------------------------------- */

const NEXT: Record<ClosedLoopGrain, ClosedLoopGrain | null> = {
  campaign: "adset",
  adset: "ad",
  ad: null,
  creative: null,
};

/**
 * The name columns for one level of the campaign drill-down. A level the reader
 * has already drilled through is named in the breadcrumb, so its column is not
 * repeated — the table keeps its room for the figures (ROAS included). At ad
 * level the ad name carries the step down to its creative.
 */
function identityColumns(
  grain: ClosedLoopGrain,
  filter: { campaignId?: string; adsetId?: string },
  A: boolean,
  onOpenCreative: (creativeId: string) => void,
): Col<CreativeGrainRow>[] {
  const columns: Col<CreativeGrainRow>[] = [];
  if (grain === "campaign" || !filter.campaignId)
    columns.push({
      key: "campaign",
      header: A ? "الحملة" : "Campaign",
      minWidth: "240px",
      render: (row) => nameWithId(row.campaignName, row.campaignId),
      sortValue: (row) => row.campaignName,
    });
  if (grain === "adset" || (grain === "ad" && !filter.adsetId))
    columns.push({
      key: "adset",
      header: A ? "مجموعة الإعلان" : "Ad set",
      minWidth: "240px",
      render: (row) => nameWithId(row.adsetName, row.adsetId),
      sortValue: (row) => row.adsetName,
    });
  if (grain === "ad")
    columns.push({
      key: "ad",
      header: A ? "الإعلان" : "Ad",
      minWidth: "240px",
      render: (row) => (
        <div className="min-w-0">
          {nameWithId(row.adName, row.adId)}
          {row.creativeId ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenCreative(row.creativeId);
              }}
              className="mt-0.5 block text-[11.5px] font-semibold text-brand hover:underline"
            >
              {A ? "عرض المادة الإعلانية ←" : "View creative →"}
            </button>
          ) : null}
        </div>
      ),
      sortValue: (row) => row.adName,
    });
  if (columns[0]) columns[0] = { ...columns[0], always: true, sticky: true };
  return columns;
}

export function GrainPerformance({
  data,
  loading,
  grain,
  filter,
  onDrill,
  onClearFilter,
  onOpenCreative,
  onShowRecords,
}: {
  data?: ClosedLoopResponse;
  loading: boolean;
  grain: ClosedLoopGrain;
  filter: { campaignId?: string; adsetId?: string; label?: string };
  onDrill: (grain: ClosedLoopGrain, row: GrainRow) => void;
  onClearFilter: () => void;
  onOpenCreative: (creativeId: string) => void;
  onShowRecords: (filter: {
    campaignId?: string;
    adsetId?: string;
    adId?: string;
    creativeId?: string;
    label: string;
  }) => void;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const [onlyWithAcquisitions, setOnlyWithAcquisitions] = useState(false);
  const rows = useMemo(
    () =>
      (data?.grains?.[grain] ?? []).filter(
        (row) =>
          (!filter.campaignId || row.campaignId === filter.campaignId) &&
          (!filter.adsetId || row.adsetId === filter.adsetId) &&
          (!onlyWithAcquisitions || row.leads > 0),
      ),
    [data, grain, filter, onlyWithAcquisitions],
  );
  const identity: Col<CreativeGrainRow>[] =
    grain === "creative"
      ? [
          {
            key: "preview",
            header: A ? "معاينة" : "Preview",
            always: true,
            render: (row) =>
              row.thumbnailUrl ? (
                <img
                  src={row.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  className="h-12 w-12 rounded-md object-cover"
                />
              ) : (
                <div className="grid h-12 w-12 place-items-center rounded-md bg-surface-2 text-text-muted">
                  <ImageIcon size={16} />
                </div>
              ),
          },
          {
            key: "creative",
            header: A ? "المادة" : "Creative",
            minWidth: "240px",
            sticky: true,
            render: (row) => (
              <button
                type="button"
                className="text-start hover:text-brand"
                onClick={() => onOpenCreative(row.creativeId)}
              >
                {nameWithId(row.creativeName, row.creativeId)}
                {row.mediaType ? (
                  <div className="text-[11px] text-text-muted">{row.mediaType}</div>
                ) : null}
              </button>
            ),
            sortValue: (row) => row.creativeName || row.creativeId,
          },
        ]
      : identityColumns(grain, filter, A, onOpenCreative);
  const cols: Col<CreativeGrainRow>[] = [
    ...identity,
    ...metricColumns<CreativeGrainRow>(
      A,
      (row) => row,
      QUALITY_KEYS,
      // Grain rows carry Meta spend, so they follow the Meta spend figure, not the scope total.
      data?.kpis?.metaSpend ? data.kpis.metaSpend.status === "ok" : true,
    ),
    // Technical IDs, off by default: available from the column chooser.
    {
      key: "metaId",
      header: A ? "معرّف Meta" : "Meta ID",
      hideByDefault: true,
      render: (row) => (
        <span className="font-mono text-[11px] text-text-muted">
          {grain === "creative"
            ? row.creativeId
            : grain === "ad"
              ? row.adId
              : grain === "adset"
                ? row.adsetId
                : row.campaignId}
        </span>
      ),
    },
    {
      key: "records",
      header: A ? "السجلات" : "Records",
      render: (row) =>
        row.crmMatched ? (
          <button
            type="button"
            className="text-xs font-semibold text-brand hover:underline"
            onClick={() =>
              onShowRecords({
                campaignId: grain === "creative" ? undefined : row.campaignId,
                adsetId: grain === "adset" || grain === "ad" ? row.adsetId : undefined,
                adId: grain === "ad" ? row.adId : undefined,
                creativeId: grain === "creative" ? row.creativeId : undefined,
                label: row.creativeName || row.adName || row.adsetName || row.campaignName,
              })
            }
          >
            {A ? "عرض النتائج" : "Outcomes"}
          </button>
        ) : (
          "—"
        ),
    },
  ];
  const next = NEXT[grain];
  return (
    <PageSection
      title={
        {
          campaign: A ? "الحملات" : "Campaigns",
          adset: A ? "مجموعات الإعلانات" : "Ad sets",
          ad: A ? "الإعلانات" : "Ads",
          creative: A ? "المواد الإعلانية" : "Creatives",
        }[grain]
      }
      icon={grain === "creative" ? <ImageIcon size={16} /> : <Layers size={16} />}
      tone="violet"
      hint={
        A
          ? "استحواذ دقيق فقط، بمعرّف المزود. معدلات الجودة مقامها العملاء المطابقون في CRM. الصرف من بيانات Meta بنفس المعرّف."
          : "Exact acquisitions only, by provider ID. Quality rates use CRM-matched leads as the denominator. Spend is Meta data on the same ID."
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {filter.label ? (
            <button
              type="button"
              onClick={onClearFilter}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs hover:border-brand"
            >
              {filter.label} <X size={12} aria-hidden />
            </button>
          ) : null}
          {next ? (
            <span className="text-xs text-text-muted">
              {A
                ? "اضغط صفًا للنزول إلى المستوى التالي"
                : "Click a row to drill into the next level"}
            </span>
          ) : grain === "ad" ? (
            <span className="text-xs text-text-muted">
              {A ? "اضغط صفًا لفتح مادته الإعلانية" : "Click a row to open its creative"}
            </span>
          ) : null}
          <label className="ms-auto inline-flex items-center gap-1.5 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={onlyWithAcquisitions}
              onChange={(event) => setOnlyWithAcquisitions(event.target.checked)}
            />
            {A ? "صفوف بها استحواذ دقيق فقط" : "Only rows with exact acquisitions"}
          </label>
        </div>
        <DataTable
          rows={rows}
          cols={cols}
          loading={loading}
          onRowClick={grain === "creative" ? undefined : (row) => onDrill(grain, row)}
          searchable={(row) =>
            `${row.campaignName} ${row.campaignId} ${row.adsetName} ${row.adsetId} ${row.adName} ${row.adId} ${row.creativeName} ${row.creativeId}`
          }
          rowKey={(row) => row.key}
          csvFilename={`engosoft-closed-loop-${grain}.csv`}
        />
      </div>
    </PageSection>
  );
}

/* --- assets ----------------------------------------------------------------- */

export function AssetPerformance({
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
  type AssetRow = NonNullable<ClosedLoopResponse["assets"]>[number];
  const assetsPerCreative = new Map<string, number>();
  for (const row of data?.assets ?? []) {
    assetsPerCreative.set(row.creativeId, (assetsPerCreative.get(row.creativeId) ?? 0) + 1);
  }
  const cols: Col<AssetRow>[] = [
    {
      key: "preview",
      header: A ? "معاينة" : "Preview",
      always: true,
      render: (row) =>
        row.thumbnailUrl ? (
          <img
            src={row.thumbnailUrl}
            alt=""
            loading="lazy"
            className="h-12 w-12 rounded-md object-cover"
          />
        ) : (
          "—"
        ),
    },
    {
      key: "asset",
      header: A ? "الأصل" : "Asset",
      sticky: true,
      render: (row) => (
        <span className="text-text" title={`ID ${row.assetId}`}>
          {row.assetType === "video" ? (A ? "فيديو" : "Video") : A ? "صورة" : "Image"}
        </span>
      ),
    },
    {
      key: "creative",
      header: A ? "المادة" : "Creative",
      minWidth: "240px",
      render: (row) => (
        <button
          type="button"
          className="text-start hover:text-brand"
          onClick={() => onOpenCreative(row.creativeId)}
        >
          {nameWithId(row.creativeName, row.creativeId)}
        </button>
      ),
    },
    {
      key: "level",
      header: A ? "ماذا تعني الأرقام" : "What the figures mean",
      render: (row) =>
        (assetsPerCreative.get(row.creativeId) ?? 0) <= 1 ? (
          <Pill tone="success">
            {A ? "نتيجة المادة (الأصل الوحيد فيها)" : "Creative result (its only asset)"}
          </Pill>
        ) : (
          <Pill tone="neutral">
            {A
              ? "إسناد الأصل غير متاح — إجمالي المادة"
              : "Asset attribution unavailable — creative total"}
          </Pill>
        ),
    },
    {
      key: "assetId",
      header: A ? "معرّف الأصل" : "Asset ID",
      hideByDefault: true,
      render: (row) => <span className="font-mono text-[11px]">{row.assetId}</span>,
    },
    {
      key: "spend",
      header: A ? "صرف المادة" : "Creative spend",
      align: "right",
      render: (row) => fmtUSD(row.spend),
      sortValue: (row) => row.spend,
    },
    {
      key: "leads",
      header: A ? "عملاء المادة" : "Creative leads",
      align: "right",
      render: (row) => fmtNum(row.leads),
      sortValue: (row) => row.leads,
    },
    {
      key: "won",
      header: A ? "مكسوب (المادة)" : "Creative won",
      align: "right",
      render: (row) => fmtNum(row.won),
      sortValue: (row) => row.won,
    },
    {
      key: "revenue",
      header: A ? "إيراد المادة المدفوع" : "Creative paid revenue",
      align: "right",
      render: (row) => fmtUSD(row.revenue),
      sortValue: (row) => row.revenue,
    },
  ];
  return (
    <PageSection
      title={A ? "الأصول الإعلانية" : "Assets"}
      icon={<ImageIcon size={16} />}
      tone="mint"
      hint={
        A
          ? "فيديوهات وصور بمعرّف Meta. تنسب Meta النتائج للإعلان والمادة وليس لأصل واحد، لذلك أرقام الأصل هي أرقام مادته للعرض فقط."
          : "Videos and images with a Meta ID. Meta attributes results to the ad and creative, not to one asset, so an asset shows its creative's results as reporting context only."
      }
    >
      <div className="space-y-3">
        <Card padded className="grid gap-2 text-xs text-text-muted sm:grid-cols-3">
          <div>
            <b className="text-text">{A ? "إسناد دقيق للمادة" : "Exact creative attribution"}</b>
            <div>
              {A
                ? "العميل مرتبط بإعلانه ومادته بمعرّف Meta."
                : "A lead is tied to its ad and creative by Meta ID."}
            </div>
          </div>
          <div>
            <b className="text-text">{A ? "تقارير الأصل" : "Asset reporting"}</b>
            <div>
              {A
                ? "صورة أو فيديو داخل المادة، مع أرقام المادة كسياق فقط."
                : "An image or video inside a creative, shown with the creative's figures as context."}
            </div>
          </div>
          <div>
            <b className="text-text">
              {A ? "إسناد الأصل غير متاح" : "Asset attribution unavailable"}
            </b>
            <div>
              {A
                ? "Meta لا تُرجع نتائج لكل صورة أو عنوان داخل المادة المرنة، فلا يُنسب بيع لأصل بعينه."
                : "Meta returns no result per image or headline inside a flexible creative, so no sale is credited to one asset."}
            </div>
          </div>
        </Card>
        <DataTable
          rows={data?.assets ?? []}
          cols={cols}
          loading={loading}
          columnChooser
          rowKey={(row) => `${row.creativeId}:${row.assetType}:${row.assetId}`}
          csvFilename="engosoft-creative-assets.csv"
          searchable={(row) => `${row.assetId} ${row.creativeName} ${row.creativeId}`}
        />
      </div>
    </PageSection>
  );
}

/* --- lead quality ------------------------------------------------------------ */

export function LeadQuality({
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
  const [grain, setGrain] = useState<ClosedLoopGrain>("creative");
  const rows = data?.leadQuality?.[grain] ?? [];
  const cheapest = [...rows]
    .filter((row) => row.cpl != null && row.leads >= 20)
    .sort((a, b) => (a.cpl ?? 0) - (b.cpl ?? 0))[0];
  const bestQuality = rows.find((row) => row.crmMatched >= 10);
  const name = (row?: GrainRow) =>
    row ? row.creativeName || row.adName || row.adsetName || row.campaignName : "—";
  const cols: Col<GrainRow>[] = [
    {
      key: "entity",
      header: A ? "العنصر" : "Entity",
      always: true,
      sticky: true,
      render: (row) =>
        grain === "creative" ? (
          <button
            type="button"
            className="text-start hover:text-brand"
            onClick={() => onOpenCreative(row.creativeId)}
          >
            {nameWithId(row.creativeName, row.creativeId)}
          </button>
        ) : (
          nameWithId(name(row), row.adId || row.adsetId || row.campaignId)
        ),
    },
    ...metricColumns<GrainRow>(A, (row) => row, [
      "leads",
      "crmMatched",
      "interestRate",
      "qualificationRate",
      "quotationRate",
      "winRate",
      "revenue",
      "revenuePerLead",
      "cpl",
      "cac",
      "roas",
    ]),
  ];
  return (
    <PageSection
      title={A ? "جودة العملاء" : "Lead quality"}
      icon={<Trophy size={16} />}
      tone="amber"
      hint={
        A
          ? "الترتيب بالإيراد لكل عميل ثم معدل الإغلاق. العناصر بأقل من 10 عملاء مطابقين تظهر بعد العناصر ذات الدليل الكافي."
          : "Ranked by revenue per lead, then win rate. Entities with fewer than 10 CRM-matched leads rank after those with enough evidence."
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card padded>
            <div className="text-[11px] font-semibold text-text-muted">
              {A ? "أرخص عملاء (20 عميلًا على الأقل)" : "Cheapest leads (20+ leads)"}
            </div>
            <div className="truncate text-sm font-semibold text-text">{name(cheapest)}</div>
            <div className="text-xs text-text-muted">
              CPL {money(cheapest?.cpl)} · {A ? "إغلاق" : "win"} {pct(cheapest?.winRate)} ·{" "}
              {A ? "إيراد/عميل" : "rev/lead"} {money(cheapest?.revenuePerLead)}
            </div>
          </Card>
          <Card padded>
            <div className="text-[11px] font-semibold text-text-muted">
              {A ? "أفضل عملاء (جودة المبيعات)" : "Best leads (sales quality)"}
            </div>
            <div className="truncate text-sm font-semibold text-text">{name(bestQuality)}</div>
            <div className="text-xs text-text-muted">
              {A ? "إيراد/عميل" : "rev/lead"} {money(bestQuality?.revenuePerLead)} ·{" "}
              {A ? "إغلاق" : "win"} {pct(bestQuality?.winRate)} · CPL {money(bestQuality?.cpl)}
            </div>
          </Card>
        </div>
        <Segmented
          value={grain}
          onChange={setGrain}
          options={[
            { value: "campaign", label: A ? "الحملة" : "Campaign" },
            { value: "adset", label: A ? "مجموعة الإعلان" : "Ad set" },
            { value: "ad", label: A ? "الإعلان" : "Ad" },
            { value: "creative", label: A ? "المادة" : "Creative" },
          ]}
        />
        <DataTable
          rows={rows}
          cols={cols}
          loading={loading}
          rowKey={(row) => row.key}
          csvFilename={`engosoft-lead-quality-${grain}.csv`}
        />
      </div>
    </PageSection>
  );
}

/* --- sales outcomes ----------------------------------------------------------- */

const STAGE_LABEL: Record<string, { en: string; ar: string }> = {
  preparation: { en: "Preparation", ar: "تحضير" },
  new: { en: "New", ar: "جديد" },
  open: { en: "In progress", ar: "قيد المتابعة" },
  quotation: { en: "Quotation", ar: "عرض سعر" },
  won: { en: "Won", ar: "مكسوب" },
  lost: { en: "Lost", ar: "خسارة" },
};

const SOURCE_LABEL = (row: OutcomeRecord, A: boolean): string => {
  const platform =
    {
      facebook: "Facebook",
      instagram: "Instagram",
      messenger: "Messenger",
      audience_network: "Audience Network",
    }[row.sourcePlatform] ??
    (row.sourcePlatform && row.sourcePlatform !== "unknown" ? row.sourcePlatform : "");
  const kind =
    row.entityType === "meta_lead"
      ? A
        ? "نموذج فوري"
        : "Instant form"
      : row.destinationChannel === "whatsapp"
        ? A
          ? "واتساب"
          : "WhatsApp"
        : row.destinationChannel === "messenger"
          ? A
            ? "ماسنجر"
            : "Messenger"
          : row.destinationChannel === "website_chat"
            ? A
              ? "دردشة الموقع"
              : "Website chat"
            : row.entityType === "landing_submission"
              ? A
                ? "صفحة هبوط"
                : "Landing page"
              : A
                ? "غير معروف"
                : "Unknown";
  return platform ? `${platform} · ${kind}` : kind;
};

const CONFIDENCE_LABEL: Record<string, { en: string; ar: string }> = {
  exact: { en: "Tracked exactly", ar: "متتبَّع بدقة" },
  declared: { en: "Declared in CRM", ar: "مُعلن في CRM" },
  inferred: { en: "Inferred", ar: "مستنتج" },
  unknown: { en: "Unknown source", ar: "مصدر غير معروف" },
};

export function outcomeColumns(
  A: boolean,
  onOpenCreative?: (id: string) => void,
): Col<OutcomeRecord>[] {
  return [
    {
      key: "date",
      header: A ? "تاريخ وصول العميل" : "Lead date",
      always: true,
      sticky: true,
      render: (row) => row.occurredAt.slice(0, 10),
      sortValue: (row) => row.occurredAt,
    },
    {
      key: "source",
      header: A ? "مصدر العميل" : "Lead source",
      render: (row) => SOURCE_LABEL(row, A),
    },
    {
      key: "campaign",
      header: A ? "الحملة" : "Campaign",
      minWidth: "220px",
      render: (row) => nameWithId(row.campaignName, row.campaignId),
      sortValue: (row) => row.campaignName,
    },
    {
      key: "adset",
      header: A ? "مجموعة الإعلان" : "Ad set",
      hideByDefault: true,
      render: (row) => nameWithId(row.adsetName, row.adsetId),
    },
    {
      key: "ad",
      header: A ? "الإعلان" : "Ad",
      minWidth: "200px",
      render: (row) => nameWithId(row.adName, row.adId),
    },
    {
      key: "creative",
      header: A ? "المادة الإعلانية" : "Creative",
      minWidth: "220px",
      render: (row) =>
        row.creativeId && onOpenCreative ? (
          <button
            type="button"
            className="text-start hover:text-brand"
            onClick={() => onOpenCreative(row.creativeId)}
          >
            {nameWithId(row.creativeName, row.creativeId)}
          </button>
        ) : (
          nameWithId(row.creativeName, row.creativeId)
        ),
    },
    {
      key: "stage",
      header: A ? "مرحلة CRM" : "CRM stage",
      render: (row) =>
        (A ? STAGE_LABEL[row.stageKey]?.ar : STAGE_LABEL[row.stageKey]?.en) ??
        (row.stageKey || "—"),
      sortValue: (row) => row.stageKey,
    },
    {
      key: "salesperson",
      header: A ? "المندوب" : "Salesperson",
      render: (row) => row.salesperson || "—",
      sortValue: (row) => row.salesperson,
    },
    {
      key: "result",
      header: A ? "النتيجة" : "Won / lost",
      render: (row) =>
        row.won ? (
          <Pill tone="success">{A ? "مكسوب" : "Won"}</Pill>
        ) : row.lost ? (
          <Pill tone="danger">{A ? "خسارة" : "Lost"}</Pill>
        ) : (
          <span className="text-text-muted">{A ? "مفتوح" : "Open"}</span>
        ),
      sortValue: (row) => (row.won ? 2 : row.lost ? 0 : 1),
    },
    {
      key: "orders",
      header: A ? "أوامر البيع" : "Orders",
      align: "right",
      render: (row) => fmtNum(row.saleOrderIds.length),
      sortValue: (row) => row.saleOrderIds.length,
    },
    {
      key: "invoices",
      header: A ? "فواتير مدفوعة" : "Paid invoices",
      align: "right",
      render: (row) => fmtNum(row.invoiceCount),
      sortValue: (row) => row.invoiceCount,
    },
    {
      key: "revenue",
      header: A ? "الإيراد المدفوع" : "Paid revenue",
      align: "right",
      render: (row) => fmtUSD(row.revenue),
      sortValue: (row) => row.revenue,
    },
    {
      key: "course",
      header: A ? "الدورة" : "Course",
      hideByDefault: true,
      render: (row) => row.course || "—",
    },
    {
      key: "progress",
      header: A ? "التقدم" : "Progress",
      hideByDefault: true,
      render: (row) =>
        [
          row.interested && (A ? "مهتم" : "Interested"),
          row.qualified && (A ? "مؤهل" : "Qualified"),
          row.quotation && (A ? "عرض سعر" : "Quotation"),
        ]
          .filter(Boolean)
          .join(" · ") || "—",
    },
    {
      key: "confidence",
      header: A ? "دقة الإسناد" : "Attribution",
      hideByDefault: true,
      render: (row) => (
        <Pill
          tone={
            row.attributionConfidence === "exact"
              ? "success"
              : row.attributionConfidence === "unknown"
                ? "warning"
                : "neutral"
          }
        >
          {(A
            ? CONFIDENCE_LABEL[row.attributionConfidence]?.ar
            : CONFIDENCE_LABEL[row.attributionConfidence]?.en) ?? row.attributionConfidence}
        </Pill>
      ),
    },
    {
      key: "crm",
      header: A ? "رقم سجل CRM" : "CRM record",
      hideByDefault: true,
      render: (row) => (
        <div>
          <div className="font-mono text-xs">#{row.crmLeadId}</div>
          <div className="text-[11px] text-text-muted">
            {(A ? MATCH_METHOD[row.matchMethod]?.ar : MATCH_METHOD[row.matchMethod]?.en) ??
              row.matchMethod}
          </div>
        </div>
      ),
    },
  ];
}

export function SalesOutcomes({
  data,
  loading,
  recordFilter,
  onClearRecordFilter,
  onOpenCreative,
}: {
  data?: ClosedLoopResponse;
  loading: boolean;
  recordFilter: {
    campaignId?: string;
    adsetId?: string;
    adId?: string;
    creativeId?: string;
    label: string;
  } | null;
  onClearRecordFilter: () => void;
  onOpenCreative: (id: string) => void;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const [confidence, setConfidence] = useState<string>("all");
  const rows = (data?.outcomes ?? []).filter(
    (row) =>
      (confidence === "all" || row.attributionConfidence === confidence) &&
      (!recordFilter ||
        ((!recordFilter.campaignId || row.campaignId === recordFilter.campaignId) &&
          (!recordFilter.adsetId || row.adsetId === recordFilter.adsetId) &&
          (!recordFilter.adId || row.adId === recordFilter.adId) &&
          (!recordFilter.creativeId || row.creativeId === recordFilter.creativeId))),
  );
  const t = data?.totals;
  const e = data?.exactTotals;
  return (
    <>
      <PageSection
        title={A ? "نتائج المبيعات" : "Sales outcomes"}
        icon={<BadgeDollarSign size={16} />}
        tone="mint"
        hint={
          A
            ? "ما حدث لكل استحواذ في CRM والمبيعات. CRM هو مرجع دورة حياة العميل، والتسويق مرجع هوية الاستحواذ."
            : "What happened to each acquisition in CRM and sales. CRM is the authority for lifecycle; marketing is the authority for acquisition identity."
        }
      >
        <div className="space-y-3">
          <KpiRow>
            <Figure
              id="outcomes_interested"
              index={0}
              tone="sky"
              icon={<Link2 size={17} />}
              loading={loading}
              title={A ? "مهتمون (مطابق)" : "Matched interested"}
              value={fmtNum(t?.interested)}
              sub={`${A ? "دقيق" : "exact"} ${fmtNum(e?.interested)}`}
              definition={
                A
                  ? "عملاء مطابقون حالتهم في Odoo مهتم أو تجاوزوا مرحلة Open."
                  : "Matched leads whose Odoo Open Status is Interested or whose stage is past Open."
              }
            />
            <Figure
              id="outcomes_quotations"
              index={1}
              tone="amber"
              icon={<Link2 size={17} />}
              loading={loading}
              title={A ? "عروض أسعار (مطابق)" : "Matched quotations"}
              value={fmtNum(t?.quotations)}
              sub={`${A ? "دقيق" : "exact"} ${fmtNum(e?.quotations)}`}
              definition={
                A
                  ? "مرحلة Quotation Sent أو Won، أو أمر بيع مؤكد للفرصة."
                  : "Quotation Sent or Won stage, or a confirmed sales order on the opportunity."
              }
            />
            <Figure
              id="outcomes_won"
              index={2}
              tone="mint"
              icon={<Trophy size={17} />}
              loading={loading}
              title={A ? "مغلق بنجاح (مطابق)" : "Matched won"}
              value={fmtNum(t?.won)}
              sub={`${A ? "دقيق" : "exact"} ${fmtNum(e?.won)}`}
              definition={
                A ? "حالة Won حسب عقد CRM." : "Won by the CRM contract's business status."
              }
            />
            <Figure
              id="outcomes_revenue"
              index={3}
              tone="violet"
              icon={<BadgeDollarSign size={17} />}
              loading={loading}
              title={A ? "إيراد مدفوع (مطابق)" : "Matched revenue"}
              value={fmtUSD(t?.revenue)}
              sub={`${A ? "دقيق" : "exact"} ${fmtUSD(e?.revenue)} · ROAS ${e?.roas == null ? "—" : `${e.roas.toFixed(2)}×`}`}
              definition={
                A
                  ? "مدفوعات الفواتير لأوامر بيع فرصة العميل نفسه (sale.order.opportunity_id)، بالدولار."
                  : "Paid invoice amounts on the lead's own opportunity orders (sale.order.opportunity_id), in USD."
              }
              caveat={
                A
                  ? "إيراد مجموعة العملاء المكتسبة في الفترة حتى اليوم، وليس إيراد الفترة."
                  : "Revenue to date of the leads acquired in the period, not revenue booked in the period."
              }
            />
          </KpiRow>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={confidence}
              onChange={setConfidence}
              options={[
                { value: "all", label: A ? "الكل" : "All" },
                { value: "exact", label: A ? "دقيق" : "Exact" },
                { value: "declared", label: A ? "مُعلن" : "Declared" },
                { value: "inferred", label: A ? "مُستنتج" : "Inferred" },
                { value: "unknown", label: A ? "غير معروف" : "Unknown" },
              ]}
            />
            {recordFilter ? (
              <button
                type="button"
                onClick={onClearRecordFilter}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs hover:border-brand"
              >
                {recordFilter.label} <X size={12} aria-hidden />
              </button>
            ) : null}
          </div>
          <DataTable
            rows={rows}
            cols={outcomeColumns(A, onOpenCreative)}
            loading={loading}
            rowKey={(row) => row.acquisitionEventId}
            searchable={(row) =>
              `${row.crmLeadId} ${row.campaignName} ${row.adName} ${row.creativeName} ${row.salesperson} ${row.course}`
            }
            csvFilename="engosoft-sales-outcomes.csv"
            truncatedNote={
              A
                ? "يعرض حتى 1000 نتيجة مرتبة بالإيراد ثم الأحدث."
                : "Shows up to 1,000 outcomes, by revenue then newest."
            }
          />
        </div>
      </PageSection>
      <ClosedLoopFunnel data={data} loading={loading} />
    </>
  );
}

/* --- creative detail ------------------------------------------------------------ */

interface CreativeDetailResponse {
  configured: boolean;
  found?: boolean;
  creative?: {
    creativeId: string;
    creativeName: string;
    mediaType: string;
    headline: string;
    thumbnailUrl: string;
    imageUrl: string;
    videoId: string;
    landingPageUrl: string;
    permalinkUrl: string;
  };
  hierarchy?: {
    campaignId: string;
    campaignName: string;
    adsetId: string;
    adsetName: string;
    adId: string;
    adName: string;
  }[];
  assets?: { asset_type: string; asset_id: string; thumbnail_url: string }[];
  metrics?: QualityMetrics;
  funnel?: FunnelStep[];
  coverage?: CoverageNumbers & { exactForCreative: number; unmatched: number };
  allTime?: { crmLeads: number; won: number; revenue: number };
  records?: OutcomeRecord[];
}

export function CreativeDetail({
  creativeId,
  onClose,
}: {
  creativeId: string | null;
  onClose: () => void;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const detail = useApi<CreativeDetailResponse>(
    `/api/acquisition/creative-detail?creativeId=${encodeURIComponent(creativeId ?? "")}`,
    { enabled: Boolean(creativeId) },
  );
  const d = detail.data;
  const m = d?.metrics;
  const stat = (label: string, value: string) => (
    <div className="rounded-lg border border-border bg-surface-2/60 px-3 py-2">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="text-sm font-semibold text-text">{value}</div>
    </div>
  );
  return (
    <DetailPanel
      open={Boolean(creativeId)}
      onClose={onClose}
      width="min(920px, 100vw)"
      eyebrow={A ? "مادة إعلانية" : "Creative"}
      title={d?.creative?.creativeName || (A ? "مادة إعلانية" : "Creative")}
      subtitle={
        d?.hierarchy?.[0]
          ? `${d.hierarchy[0].campaignName} → ${d.hierarchy[0].adsetName}`
          : undefined
      }
    >
      {detail.isLoading ? (
        <div className="text-sm text-text-muted">{A ? "جارِ التحميل…" : "Loading…"}</div>
      ) : !d?.found ? (
        <div className="text-sm text-text-muted">
          {A
            ? "المادة غير موجودة في كتالوج Meta المتزامن."
            : "This creative is not in the synced Meta catalog."}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            {d.creative?.thumbnailUrl ? (
              <a
                href={d.creative.permalinkUrl || d.creative.imageUrl || d.creative.thumbnailUrl}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={d.creative.thumbnailUrl}
                  alt=""
                  className="aspect-square w-full rounded-lg object-cover"
                />
              </a>
            ) : (
              <div className="grid aspect-square place-items-center rounded-lg bg-surface-2 text-text-muted">
                <ImageIcon />
              </div>
            )}
            <div className="space-y-1 text-xs text-text-muted">
              <div>
                <Pill tone="neutral">{d.creative?.mediaType || "—"}</Pill>
              </div>
              {d.creative?.headline ? (
                <div className="text-sm text-text">{d.creative.headline}</div>
              ) : null}
              {d.creative?.landingPageUrl ? (
                <div className="truncate">
                  {A ? "الوجهة: " : "Destination: "}
                  {d.creative.landingPageUrl}
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold text-text">
              {A ? "التسلسل: حملة ← مجموعة ← إعلان" : "Hierarchy: campaign → ad set → ad"}
            </div>
            <div className="space-y-1">
              {(d.hierarchy ?? []).map((row) => (
                <div
                  key={row.adId}
                  className="rounded-md border border-border px-2 py-1 text-[11.5px] text-text"
                >
                  {row.campaignName} → {row.adsetName} → {row.adName}
                </div>
              ))}
            </div>
          </div>

          {/* Identifiers reconcile a row with Meta; a manager reading the
              creative's story does not need them in the way. */}
          <details className="group rounded-lg border border-border">
            <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-text-muted [&::-webkit-details-marker]:hidden">
              {A ? "تفاصيل تقنية" : "Technical details"}
            </summary>
            <div className="space-y-1 border-t border-border px-3 py-2 font-mono text-[11px] text-text-muted">
              <div>creative {creativeId}</div>
              {d.creative?.videoId ? <div>video {d.creative.videoId}</div> : null}
              {(d.hierarchy ?? []).map((row) => (
                <div key={`ids-${row.adId}`} className="break-all">
                  campaign {row.campaignId} · ad set {row.adsetId} · ad {row.adId}
                </div>
              ))}
              <div className="break-all">
                {(d.assets ?? []).length
                  ? `${A ? "الأصول" : "Assets"}: ${(d.assets ?? []).map((a) => `${a.asset_type} ${a.asset_id}`).join(" · ")}`
                  : A
                    ? "لا أصول بمعرّف Meta"
                    : "No assets with a Meta ID"}
              </div>
            </div>
          </details>

          <div>
            <div className="mb-1 text-xs font-semibold text-text">
              {A ? "أداء الإعلان" : "Media performance"}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {stat(A ? "الصرف" : "Spend", fmtUSD(m?.spend))}
              {stat(A ? "الظهور" : "Impressions", fmtNum(m?.impressions))}
              {stat(A ? "النقرات" : "Link clicks", fmtNum(m?.clicks))}
              {stat(
                "CTR",
                m?.impressions ? fmtPct(((m?.clicks ?? 0) / m.impressions) * 100, 2) : "—",
              )}
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold text-text">
              {A ? "الاستحواذ وجودة العملاء" : "Acquisition and lead quality"}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {stat(A ? "عملاء دقيقون" : "Exact leads", fmtNum(m?.leads))}
              {stat(
                A ? "مطابق CRM" : "CRM matched",
                `${fmtNum(m?.crmMatched)} (${share(m?.crmMatched, m?.leads)})`,
              )}
              {stat("CPL", money(m?.cpl))}
              {stat(
                A ? "مهتم" : "Interested",
                `${fmtNum(m?.interested)} · ${pct(m?.interestRate)}`,
              )}
              {stat(
                A ? "مؤهل" : "Qualified",
                `${fmtNum(m?.qualified)} · ${pct(m?.qualificationRate)}`,
              )}
              {stat(
                A ? "عروض أسعار" : "Quotations",
                `${fmtNum(m?.quotations)} · ${money(m?.costPerQuotation)}`,
              )}
              {stat(A ? "مغلق" : "Won", `${fmtNum(m?.won)} · ${pct(m?.winRate)}`)}
              {stat("CAC", money(m?.cac))}
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold text-text">
              {A ? "المبيعات" : "Sales outcomes"}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {stat(A ? "أوامر البيع" : "Sales orders", fmtNum(m?.saleOrders))}
              {stat(A ? "الفواتير" : "Invoices", fmtNum(m?.invoices))}
              {stat(A ? "الإيراد المدفوع" : "Paid revenue", fmtUSD(m?.revenue))}
              {stat("ROAS", m?.roas == null ? "—" : `${m.roas.toFixed(2)}×`)}
            </div>
            <div className="mt-1 text-[11px] text-text-muted">
              {A
                ? "كل الوقت (عملاء CRM بمعرّف Meta لإعلانات هذه المادة): "
                : "All time (CRM leads with a Meta lead ID on this creative's ads): "}
              {fmtNum(d.allTime?.crmLeads)} · {A ? "مغلق" : "won"} {fmtNum(d.allTime?.won)} ·{" "}
              {fmtUSD(d.allTime?.revenue)}
            </div>
          </div>

          <Card padded className="text-xs text-text-muted">
            {A ? "التغطية: " : "Coverage: "}
            {fmtNum(d.coverage?.total)}{" "}
            {A ? "استحواذ على إعلانات المادة" : "acquisitions on this creative's ads"} ·{" "}
            {fmtNum(d.coverage?.exactForCreative)} {A ? "دقيق للمادة" : "exact for the creative"} ·{" "}
            {fmtNum(d.coverage?.crmMatched)} {A ? "مطابق CRM" : "CRM matched"} ·{" "}
            {fmtNum(d.coverage?.unmatched)} {A ? "دقيق بلا سجل CRM" : "exact without a CRM record"}{" "}
            · {fmtNum(d.coverage?.unknown)} {A ? "غير معروف" : "unknown"}
          </Card>

          <DataTable
            rows={d.records ?? []}
            cols={outcomeColumns(A)}
            rowKey={(row) => row.acquisitionEventId}
            csvFilename={`engosoft-creative-${creativeId}.csv`}
            pageSize={10}
          />
        </div>
      )}
    </DetailPanel>
  );
}

/* --- inferred link audit ---------------------------------------------------- */

interface InferredLinkAuditResponse {
  configured: boolean;
  links?: number;
  conversations?: number;
  crmRecords?: number;
  window?: { fromDays: number; toDays: number; rule: string };
  dayGap?: { sameDay: number; withinWeek: number; withinMonth: number; outsideWindow: number };
  ambiguity?: { phoneKeyWithOtherCrmRecords: number; conversationsWithSeveralLinks: number };
  duplicateRisk?: { crmRecordsClaimedBySeveralConversations: number };
  outcomes?: { won: number; revenue: number };
  rows?: {
    acquisitionEventId: string;
    crmLeadId: string;
    businessStatus: string;
    dayGap: number | null;
    phoneCandidates: number;
  }[];
}

export function InferredLinkAudit() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const { data, isLoading } = useApi<InferredLinkAuditResponse>("/api/acquisition/inferred-links");
  const facts: [string, string][] = data?.configured
    ? [
        [A ? "روابط مستنتجة" : "Inferred links", fmtNum(data.links)],
        [A ? "محادثات" : "Conversations", fmtNum(data.conversations)],
        [A ? "سجلات CRM" : "CRM records", fmtNum(data.crmRecords)],
        [A ? "نفس اليوم" : "Same day", fmtNum(data.dayGap?.sameDay)],
        [A ? "خلال أسبوع" : "Within a week", fmtNum(data.dayGap?.withinWeek)],
        [A ? "خلال شهر" : "Within a month", fmtNum(data.dayGap?.withinMonth)],
        [
          A ? "الهاتف مرتبط بسجلات CRM أخرى" : "Phone key with other CRM records",
          fmtNum(data.ambiguity?.phoneKeyWithOtherCrmRecords),
        ],
        [
          A ? "سجل CRM لأكثر من محادثة" : "CRM record claimed by several conversations",
          fmtNum(data.duplicateRisk?.crmRecordsClaimedBySeveralConversations),
        ],
        [
          A ? "مكسوب (غير محسوب في الدقيق)" : "Won (never counted as exact)",
          fmtNum(data.outcomes?.won),
        ],
      ]
    : [];
  return (
    <PageSection
      title={A ? "تدقيق الروابط المستنتجة" : "Inferred link audit"}
      icon={<Link2 size={16} />}
      tone="amber"
      hint={
        A
          ? "روابط بالهاتف بين محادثة وسجل CRM، مقبولة فقط إذا أُنشئ السجل من يوم قبل المحادثة حتى 30 يومًا بعدها. لا تُرفع أبدًا إلى دقيق ولا تدخل مؤشرات الإدارة."
          : "Phone-key links between a conversation and a CRM record, accepted only when the record was created from one day before to 30 days after the conversation. Never promoted to exact and never used in management KPIs."
      }
    >
      <div className="space-y-3">
        <Card padded>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
            {(isLoading ? [] : facts).map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-2 text-sm">
                <dt className="text-text-muted">{label}</dt>
                <dd className="num font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <DataTable
          rows={data?.rows ?? []}
          loading={isLoading}
          rowKey={(row) => `${row.acquisitionEventId}|${row.crmLeadId}`}
          cols={[
            {
              key: "conversation",
              header: A ? "المحادثة" : "Conversation",
              render: (row) => row.acquisitionEventId.replace("chatwoot_conversation:", "#"),
            },
            {
              key: "crm",
              header: A ? "سجل CRM" : "CRM record",
              render: (row) => `#${row.crmLeadId}`,
            },
            {
              key: "status",
              header: A ? "الحالة" : "Status",
              render: (row) => row.businessStatus || "—",
            },
            {
              key: "gap",
              header: A ? "فرق الأيام" : "Day gap",
              align: "right",
              render: (row) => (row.dayGap == null ? "—" : fmtNum(row.dayGap)),
              sortValue: (row) => row.dayGap ?? -99,
            },
            {
              key: "candidates",
              header: A ? "سجلات بنفس الهاتف" : "CRM records on the phone key",
              align: "right",
              render: (row) => fmtNum(row.phoneCandidates),
              sortValue: (row) => row.phoneCandidates,
            },
          ]}
          csvFilename="engosoft-inferred-crm-links.csv"
        />
      </div>
    </PageSection>
  );
}

/* --- Chatwoot attribution health -------------------------------------------- */

interface ChatwootHealthResponse {
  configured: boolean;
  running?: boolean;
  pipeline?: {
    attribution_rows?: number;
    failed_events?: number;
    stuck_events?: number;
    processed_without_row?: number;
    unknown_without_reason?: number;
  };
  reconciliation?: Record<string, number>;
  lastRun?: {
    status: string;
    updated_at: string;
    summary: { message?: string; windowDays?: number };
  } | null;
}

export function ChatwootAttributionHealth() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const { data, isLoading } = useApi<ChatwootHealthResponse>("/api/attribution/chatwoot-reconcile");
  const p = data?.pipeline ?? {};
  const r = data?.reconciliation ?? {};
  const rows: [string, number | undefined, boolean][] = [
    [A ? "صفوف إسناد المحادثات" : "Conversation attribution rows", p.attribution_rows, false],
    [
      A ? "محادثات بلا صف رغم وصول رسالة" : "Missing rows found (inbound message, no row)",
      r.replayable,
      true,
    ],
    [A ? "صفوف أعيد بناؤها" : "Rows rebuilt from Chatwoot", r.replayed, false],
    [
      A ? "محادثات بلا رسالة واردة (لا يلزم صف)" : "No inbound message (no row needed)",
      r.no_inbound_message,
      false,
    ],
    [A ? "أحداث فشلت معالجتها" : "Failed webhook events", p.failed_events, true],
    [A ? "أحداث عالقة" : "Stuck webhook events", p.stuck_events, true],
    [A ? "أحداث معالجة بلا صف" : "Processed events without a row", p.processed_without_row, true],
    [A ? "غير معروف بلا سبب" : "Unknown without a reason", p.unknown_without_reason, true],
  ];
  return (
    <PageSection
      title={A ? "صحة إسناد محادثات Chatwoot" : "Chatwoot attribution health"}
      icon={<ShieldCheck size={16} />}
      tone="sky"
      hint={
        A
          ? "كل 6 ساعات تُقارن محادثات Chatwoot بصفوف الإسناد؛ أي محادثة لها رسالة واردة بلا صف يُعاد بناؤها في قاعدة البيانات فقط وتُسجل كـ«لم يصل الـwebhook»."
          : "Every 6 hours Chatwoot conversations are compared with attribution rows; a conversation with an inbound message and no row is rebuilt in the database only and recorded as webhook_delivery_missed."
      }
    >
      <Card padded>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {rows.map(([label, value, alarm]) => (
            <div key={label} className="flex items-baseline justify-between gap-2 text-sm">
              <dt className="text-text-muted">{label}</dt>
              <dd className={`num font-semibold ${alarm && (value ?? 0) > 0 ? "text-danger" : ""}`}>
                {isLoading
                  ? "…"
                  : value === undefined
                    ? A
                      ? "لم يُفحص بعد"
                      : "Not checked yet"
                    : fmtNum(value)}
              </dd>
            </div>
          ))}
        </dl>
        {data?.lastRun?.summary?.message ? (
          <div className="mt-3 border-t border-border pt-3 text-xs text-text-muted">
            {A ? "آخر فحص: " : "Last check: "}
            {String(data.lastRun.updated_at).replace("T", " ").slice(0, 16)} —{" "}
            {data.lastRun.summary.message}
          </div>
        ) : null}
      </Card>
    </PageSection>
  );
}
