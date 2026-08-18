import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  CircleDollarSign,
  Download,
  Layers,
  PanelRightOpen,
  Search,
  SlidersHorizontal,
  Target,
  X,
} from "lucide-react";
import { fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n, type DictKey, type Lang } from "@/lib/i18n";
import { filterStore, useFilters } from "@/lib/filter-store";
import { useApi } from "@/lib/use-api";
import { METRIC_GROUP_LABEL, METRICS, type MetricKey } from "@/lib/metric-catalog";
import type { CampaignOperationalState, PerfRow } from "@/lib/types";
import { DataTable, type Col } from "@/components/DataTable";
import { exportCsv } from "@/lib/csv";
import { EmptyState, Segmented, Skeleton } from "@/components/ui-bits";
import { useIsNarrow } from "@/components/charts";
import { AdSetOriginBadge, InferredCourse, PlatformBadges } from "@/components/metric-bits";
import { MetricInfo } from "./MetricInfo";
import { Unavailable, VerdictChip } from "./MetricCard";
import { PerfCards } from "./PerfCards";
import { acosVerdict, roasVerdict } from "./verdict";
import { csvMaybe, csvRatio, maybeCell, ratioCell, sortMaybe, sortRatio } from "./cells";
import {
  ownerCampaignVerdict,
  ownerStatusLabel,
  type OwnerCampaignStatus,
  type OwnerCampaignVerdict,
} from "./owner-campaign-verdict";

export type Grain = "campaign" | "adset" | "ad";

type Layout = "table" | "cards";

const EM = "—";

/** Cards are taller than rows, so they load in batches rather than all at once. */
const CARD_PAGE = 12;

type CardSortKey = "spend" | "revenue" | "roas" | "crmLeads" | "won" | "cpl";

const CARD_SORTS: Record<CardSortKey, { ar: string; en: string; value: (r: PerfRow) => number }> = {
  spend: { ar: "الإنفاق", en: "Spend", value: (r) => r.spend },
  revenue: { ar: "الإيراد", en: "Revenue", value: (r) => r.revenue },
  roas: { ar: "العائد", en: "ROAS", value: (r) => sortRatio(r.roas, r.spend) },
  crmLeads: { ar: "عملاء النظام", en: "CRM leads", value: (r) => r.crmLeads },
  won: { ar: "الصفقات الرابحة", en: "Won", value: (r) => r.won },
  cpl: { ar: "تكلفة العميل", en: "CPL", value: (r) => sortRatio(r.cpl, r.spend) },
};

/** One export shape, whichever layout the reader is in. */
function buildCsvRow(
  r: PerfRow,
  nameOf: (r: PerfRow) => string,
  lang: Lang,
  spendAvailable: boolean,
): Record<string, string | number> {
  return {
    [lang === "ar" ? "الاسم" : "name"]: nameOf(r),
    campaign: r.campaignName,
    ad_set: r.adsetName,
    campaign_key: r.campaignKey,
    adset_key: r.adsetKey,
    ad_key: r.adKey,
    platform: r.platforms.join("|"),
    course: r.course,
    course_inferred: r.courseInferred ? "yes" : "no",
    adset_origin: r.adsetOrigin ?? "",
    // Blank, not "0.00", when the platform has no spend tab — the export has to
    // carry the same "unknown" the screen shows.
    spend: spendAvailable ? r.spend.toFixed(2) : "",
    impressions: r.impressions,
    clicks: r.clicksAll,
    link_clicks: r.linkClicks ?? "",
    ctr_all: csvMaybe(r.ctrAll, 4),
    ctr_link: csvMaybe(r.ctrLink, 4),
    platform_leads: r.platformLeads ?? "",
    crm_leads: r.crmLeads,
    won: r.won,
    paid_invoices: r.invoices,
    fully_invoiced_sales_orders: r.salesOrders,
    conversion_rate: csvMaybe(r.conversionRate),
    lost: r.lost,
    lost_rate: csvMaybe(r.lostRate),
    revenue: r.revenue.toFixed(2),
    revenue_per_lead: csvMaybe(r.revenuePerLead),
    cpl: csvRatio(r.cpl, r.spend),
    cpa: csvRatio(r.cpa, r.spend),
    roas: csvRatio(r.roas, r.spend, 4),
    acos: csvRatio(r.acos, r.spend),
    spend_from: r.spendDateMin,
    spend_to: r.spendDateMax,
    partial_spend: r.partialSpend ? "yes" : "no",
  };
}

/* --- quick views ----------------------------------------------------------
 * Saved questions, not new metrics. Each one filters and sorts the rows the
 * server already returned; none of them recomputes anything. `partialSpend` is
 * respected on the performance views because a row with five days of cost and
 * seven months of revenue is not a winner, it is a reporting artefact.
-------------------------------------------------------------------------- */

type QuickViewKey =
  | "all"
  | "attributedRevenue"
  | "successful"
  | "watch"
  | "weak"
  | "early"
  | "bestRoas"
  | "worst"
  | "topSpend"
  | "topRevenue"
  | "highCpl"
  | "spendNoRevenue"
  | "leadsNoWon"
  | "noCreative"
  | "unmatched";

const OWNER_VIEW_KEYS: OwnerCampaignStatus[] = ["successful", "watch", "weak", "early"];
const isOwnerView = (value: QuickViewKey): value is OwnerCampaignStatus =>
  OWNER_VIEW_KEYS.includes(value as OwnerCampaignStatus);

interface QuickView {
  key: QuickViewKey;
  ar: string;
  en: string;
  hint: { ar: string; en: string };
  /** Ad grain only — a campaign has no creative name. */
  adOnly?: boolean;
  apply: (rows: PerfRow[]) => PerfRow[];
}

const QUICK_VIEWS: QuickView[] = [
  {
    key: "all",
    ar: "الكل",
    en: "All",
    hint: { ar: "كل الصفوف في النطاق الحالي", en: "Every row in the current scope" },
    apply: (rows) => rows,
  },
  {
    key: "successful",
    ar: "ناجحة",
    en: "Successful",
    hint: {
      ar: "حملات Live وعدّت حد العينة وحققت معايير الجودة والإغلاق والعائد",
      en: "Live campaigns with enough data that meet quality, conversion and return targets",
    },
    apply: (rows) => rows,
  },
  {
    key: "watch",
    ar: "متابعة",
    en: "Watch",
    hint: {
      ar: "حملات Live نتيجتها مختلطة أو عندها معيار محتاج تدخل",
      en: "Live campaigns with mixed results or one area that needs attention",
    },
    apply: (rows) => rows,
  },
  {
    key: "weak",
    ar: "ضعيفة",
    en: "Weak",
    hint: {
      ar: "حملات Live عدّت وقت الحكم وفشلت في معيارين أو في استرداد المصروف",
      en: "Live campaigns mature enough to judge that fail two rules or break-even",
    },
    apply: (rows) => rows,
  },
  {
    key: "early",
    ar: "بدري للحكم",
    en: "Too early",
    hint: {
      ar: "أقل من 30 ليد أو لسه ماكملتش دورة بيع كاملة",
      en: "Fewer than 30 leads or not through a full sales cycle yet",
    },
    apply: (rows) => rows,
  },
  {
    key: "attributedRevenue",
    ar: "الإيراد المرتبط",
    en: "Campaign-linked revenue",
    hint: {
      ar: "الحملات الموجودة في مصدر الإعلانات خلال الفترة ولها تحصيل محاسبي — مجموعها يطابق الرقم المرتبط في كارت الإيراد",
      en: "Campaigns present in the ad feed during the period with accounting collections — their sum matches the linked figure on the revenue card",
    },
    apply: (rows) =>
      rows
        .filter((row) => row.platforms.length > 0 && row.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue),
  },
  {
    key: "bestRoas",
    ar: "أفضل أداء",
    en: "Best performers",
    hint: {
      ar: "أعلى عائد على الإنفاق، مع استبعاد الصفوف اللي بيانات إنفاقها بتغطي جزء من الفترة بس",
      en: "Highest return on ad spend, excluding rows whose spend data covers only part of the period",
    },
    apply: (rows) =>
      rows
        .filter((r) => r.spend > 0 && r.roas !== null && r.roas >= 2 && !r.partialSpend)
        .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0)),
  },
  {
    key: "worst",
    ar: "أسوأ أداء",
    en: "Worst performers",
    hint: {
      ar: "أكبر فرق بين الإنفاق والإيراد، للصفوف اللي لسه ما رجّعتش فلوسها",
      en: "Biggest gap between spend and revenue, among rows that have not paid for themselves",
    },
    apply: (rows) =>
      rows
        .filter((r) => r.spend > 0 && !r.partialSpend && (r.roas === null || r.roas < 1))
        .sort((a, b) => b.spend - b.revenue - (a.spend - a.revenue)),
  },
  {
    key: "topSpend",
    ar: "أعلى إنفاق",
    en: "Highest spend",
    hint: { ar: "الترتيب حسب الإنفاق من الأكبر", en: "Ranked by spend, largest first" },
    apply: (rows) => rows.filter((r) => r.spend > 0).sort((a, b) => b.spend - a.spend),
  },
  {
    key: "topRevenue",
    ar: "أعلى إيراد",
    en: "Highest revenue",
    hint: { ar: "الترتيب حسب الإيراد المحصّل", en: "Ranked by collected revenue" },
    apply: (rows) => rows.filter((r) => r.revenue > 0).sort((a, b) => b.revenue - a.revenue),
  },
  {
    key: "highCpl",
    ar: "أغلى تكلفة عميل",
    en: "Most expensive leads",
    hint: {
      ar: "أعلى تكلفة للعميل المحتمل — الصفوف اللي محتاجة مراجعة استهداف",
      en: "Highest cost per lead — the rows whose targeting needs a look",
    },
    apply: (rows) =>
      rows.filter((r) => r.cpl !== null && r.spend > 0).sort((a, b) => (b.cpl ?? 0) - (a.cpl ?? 0)),
  },
  {
    key: "spendNoRevenue",
    ar: "صرفت وما جابتش إيراد",
    en: "Spent, no revenue",
    hint: {
      ar: "فيها إنفاق ومفيش أي تحصيل مربوط بيها في الفترة",
      en: "Has spend and no collected revenue attached to it in this period",
    },
    apply: (rows) =>
      rows.filter((r) => r.spend > 0 && r.revenue <= 0).sort((a, b) => b.spend - a.spend),
  },
  {
    key: "leadsNoWon",
    ar: "ليدز من غير صفقات",
    en: "Leads, no wins",
    hint: {
      ar: "جابت عملاء محتملين ومفيش ولا صفقة قفلت",
      en: "Produced leads but closed nothing",
    },
    apply: (rows) =>
      rows.filter((r) => r.crmLeads > 0 && r.won === 0).sort((a, b) => b.crmLeads - a.crmLeads),
  },
  {
    key: "noCreative",
    ar: "إعلانات من غير اسم",
    en: "Ads with no creative name",
    adOnly: true,
    hint: {
      ar: "الإعلان واصل بمعرّف من غير اسم إبداعي في المصدر",
      en: "The ad arrived with an id but no creative name in the source",
    },
    apply: (rows) => rows.filter((r) => !r.name || r.name === EM),
  },
  {
    key: "unmatched",
    ar: "من غير تطابق مع النظام",
    en: "No CRM or accounting match",
    hint: {
      ar: "صرفت ومفيش ليدز ولا إيراد مربوطين بيها — غالبًا مشكلة ربط مش مشكلة أداء",
      en: "Spent, with no leads and no revenue joined to it — usually an attribution gap, not performance",
    },
    apply: (rows) =>
      rows
        .filter((r) => r.spend > 0 && r.crmLeads === 0 && r.revenue <= 0)
        .sort((a, b) => b.spend - a.spend),
  },
];

/* --- explorer -------------------------------------------------------------- */

export function PerfExplorer({
  rows,
  grain,
  onGrainChange,
  unknownAdsetKey,
  loading = false,
  csvPrefix,
  /** False when the selected platform has no spend tab at all. */
  spendAvailable = true,
  /** Extra context appended to every spend-derived metric explanation. */
  spendNote,
  activeCampaignStates,
  lostAvailable = true,
  title,
  subtitle,
  initialView,
}: {
  rows: PerfRow[];
  grain: Grain;
  onGrainChange: (g: Grain) => void;
  unknownAdsetKey?: string;
  loading?: boolean;
  csvPrefix: string;
  spendAvailable?: boolean;
  spendNote?: string;
  /** Campaigns the live platform-status collector says are eligible to run now. */
  activeCampaignStates?: CampaignOperationalState[];
  /** False while the direct Odoo Lost archive is unavailable. */
  lostAvailable?: boolean;
  title?: string;
  subtitle?: string;
  /** Deep-link from the overview into one decision-ready quick view. */
  initialView?: "attributedRevenue";
}) {
  const { t, lang } = useI18n();
  const filters = useFilters();
  const narrow = useIsNarrow(768);
  const [view, setView] = useState<QuickViewKey>(initialView ?? "all");
  const [layout, setLayout] = useState<Layout | null>(null);
  const [query, setQuery] = useState("");
  const [cardSort, setCardSort] = useState<CardSortKey>("spend");
  const [cardLimit, setCardLimit] = useState(CARD_PAGE);
  const [detail, setDetail] = useState<PerfRow | null>(null);
  const [showAdvancedViews, setShowAdvancedViews] = useState(false);

  // Cards by default on a phone, where a twenty-column table is a sideways
  // scroll with the labels left behind on the far edge. Once the reader picks a
  // layout that choice sticks, whatever the screen does afterwards.
  const effectiveLayout: Layout = layout ?? (narrow ? "cards" : "table");

  const nameOf = (r: PerfRow) => (r.key === unknownAdsetKey ? t("unknown_adset") : r.name || EM);

  const decisionMode = grain === "campaign" && activeCampaignStates !== undefined;
  const ownerViewMode = decisionMode && (view === "all" || isOwnerView(view));
  const views = QUICK_VIEWS.filter((v) => {
    if (v.adOnly && grain !== "ad") return false;
    if (v.key === "attributedRevenue" && grain !== "campaign") return false;
    if (decisionMode && (v.key === "bestRoas" || v.key === "worst")) return false;
    if (!decisionMode && isOwnerView(v.key)) return false;
    return true;
  });
  const activeView = views.find((v) => v.key === view) ?? views[0];
  const activeCampaignStateByKey = useMemo(() => {
    const map = new Map<string, CampaignOperationalState>();
    for (const state of activeCampaignStates ?? []) {
      if (state.campaignKey) map.set(state.campaignKey, state);
      if (state.campaignId) map.set(`id:${state.campaignId}`, state);
    }
    return map;
  }, [activeCampaignStates]);
  const activeCampaignKeySet = useMemo(
    () => new Set(activeCampaignStateByKey.keys()),
    [activeCampaignStateByKey],
  );
  const ownerVerdicts = useMemo(() => {
    const map = new Map<string, OwnerCampaignVerdict>();
    for (const row of rows) {
      const state =
        activeCampaignStateByKey.get(row.campaignKey) ?? activeCampaignStateByKey.get(row.key);
      map.set(row.key, ownerCampaignVerdict(row, rows, state?.startTime, lostAvailable));
    }
    return map;
  }, [activeCampaignStateByKey, lostAvailable, rows]);
  const ownerCounts = useMemo(() => {
    const counts: Record<OwnerCampaignStatus, number> = {
      successful: 0,
      watch: 0,
      weak: 0,
      early: 0,
    };
    for (const row of rows) {
      if (!activeCampaignKeySet.has(row.campaignKey) && !activeCampaignKeySet.has(row.key))
        continue;
      const status = ownerVerdicts.get(row.key)?.status;
      if (status) counts[status]++;
    }
    return counts;
  }, [activeCampaignKeySet, ownerVerdicts, rows]);
  const evaluatedLiveCount = OWNER_VIEW_KEYS.reduce((sum, status) => sum + ownerCounts[status], 0);
  const activePlatformCount = useMemo(
    () => new Set((activeCampaignStates ?? []).map((state) => state.campaignKey)).size,
    [activeCampaignStates],
  );
  const shown = useMemo(() => {
    const applied = activeView.apply(rows);
    if (decisionMode && view === "all") {
      return applied
        .filter(
          (row) => activeCampaignKeySet.has(row.campaignKey) || activeCampaignKeySet.has(row.key),
        )
        .sort((a, b) => b.spend - a.spend);
    }
    if (decisionMode && isOwnerView(view)) {
      return applied
        .filter(
          (row) =>
            (activeCampaignKeySet.has(row.campaignKey) || activeCampaignKeySet.has(row.key)) &&
            ownerVerdicts.get(row.key)?.status === view,
        )
        .sort((a, b) => {
          const va = ownerVerdicts.get(a.key)!;
          const vb = ownerVerdicts.get(b.key)!;
          if (view === "successful") return vb.passes - va.passes || (b.roas ?? 0) - (a.roas ?? 0);
          if (view === "weak")
            return vb.failures - va.failures || b.spend - b.revenue - (a.spend - a.revenue);
          if (view === "watch")
            return vb.failures - va.failures || vb.watches - va.watches || b.spend - a.spend;
          return b.crmLeads - a.crmLeads || b.spend - a.spend;
        });
    }
    if (view === "worst" && activeCampaignStates !== undefined) {
      return applied.filter(
        (row) => activeCampaignKeySet.has(row.campaignKey) || activeCampaignKeySet.has(row.key),
      );
    }
    return applied;
  }, [
    activeCampaignKeySet,
    activeCampaignStates,
    activeView,
    decisionMode,
    ownerVerdicts,
    rows,
    view,
  ]);

  const quickViewHint = activeView.hint[lang];

  const searchable = (r: PerfRow) =>
    `${nameOf(r)} ${r.campaignName} ${r.adsetName} ${r.course}`.toLowerCase();

  // The card grid does its own filtering and sorting; the table keeps using the
  // DataTable machinery. Both read the same query so switching layout never
  // changes which rows the reader is looking at.
  const cardRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? shown.filter((r) => searchable(r).includes(q)) : shown;
    if (decisionMode && isOwnerView(view)) return filtered;
    const pick = CARD_SORTS[cardSort].value;
    return [...filtered].sort((a, b) => pick(b) - pick(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, query, cardSort, unknownAdsetKey, decisionMode, view]);

  useEffect(() => {
    setCardLimit(CARD_PAGE);
  }, [query, cardSort, view, grain, rows]);

  useEffect(() => {
    if (initialView) setView(initialView);
  }, [initialView]);

  useEffect(() => {
    if (grain !== "campaign")
      setView((current) =>
        current === "attributedRevenue" || isOwnerView(current) ? "all" : current,
      );
  }, [grain]);

  useEffect(() => {
    if (decisionMode && (view === "bestRoas" || view === "worst")) setView("all");
  }, [decisionMode, view]);

  const relatedRows = useMemo(() => {
    if (!detail?.course || grain !== "campaign") return [];
    const course = detail.course.trim().toLocaleLowerCase().replace(/\s+/g, " ");
    return rows
      .filter(
        (row) =>
          row.key !== detail.key &&
          row.course.trim().toLocaleLowerCase().replace(/\s+/g, " ") === course,
      )
      .sort((a, b) => b.spend - a.spend);
  }, [detail, grain, rows]);

  const csvRow = (r: PerfRow) => buildCsvRow(r, nameOf, lang, spendAvailable);

  const emptyState = (
    <EmptyState
      label={
        lang === "ar" ? "مفيش صفوف مطابقة للاختيار الحالي" : "No rows match the current selection"
      }
      hint={
        view !== "all"
          ? lang === "ar"
            ? decisionMode && isOwnerView(view)
              ? `مفيش حملة Live في تصنيف «${ownerStatusLabel(view, lang)}» حسب الفترة الحالية.`
              : "جرّب ترجع لعرض «الكل» أو توسّع الفترة."
            : decisionMode && isOwnerView(view)
              ? `No live campaign is classified as “${ownerStatusLabel(view, lang)}” in this period.`
              : "Try the All view, or widen the period."
          : lang === "ar"
            ? "غيّر المنصة أو الفترة من فوق."
            : "Change the platform or period above."
      }
    />
  );

  const primaryViews = decisionMode
    ? views.filter((item) => item.key === "all" || isOwnerView(item.key))
    : views;
  const advancedViews = decisionMode
    ? views.filter((item) => item.key !== "all" && !isOwnerView(item.key))
    : [];
  const advancedOpen = showAdvancedViews || advancedViews.some((item) => item.key === view);
  const viewButton = (v: QuickView) => {
    const active = v.key === view;
    return (
      <button
        key={v.key}
        onClick={() => setView(v.key)}
        title={v.hint[lang]}
        aria-pressed={active}
        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11.5px] font-medium whitespace-nowrap transition-colors cursor-pointer touch-manipulation ${
          active
            ? "border-transparent text-white"
            : "border-border text-text-muted hover:bg-surface-2"
        }`}
        style={active ? { background: "var(--brand)" } : undefined}
      >
        {decisionMode && v.key === "all" ? (lang === "ar" ? "كل الـLive" : "All live") : v[lang]}
        {decisionMode && v.key === "all" && (
          <span className="opacity-75 num">{evaluatedLiveCount}</span>
        )}
        {decisionMode && isOwnerView(v.key) && (
          <span className="ms-1 opacity-75 num">{ownerCounts[v.key]}</span>
        )}
      </button>
    );
  };

  const quickViews = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {primaryViews.map(viewButton)}
        {decisionMode && advancedViews.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAdvancedViews((open) => !open)}
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-[11.5px] font-medium text-text-muted transition-colors hover:bg-surface-2 cursor-pointer"
            aria-expanded={advancedOpen}
          >
            <SlidersHorizontal size={12} />
            {lang === "ar" ? "فلاتر إضافية" : "More filters"}
            <ChevronDown
              size={12}
              className={`transition-transform ${advancedOpen ? "rotate-180" : ""}`}
            />
          </button>
        )}
      </div>
      {decisionMode && advancedOpen && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/70 bg-surface-2/60 p-2">
          {advancedViews.map(viewButton)}
        </div>
      )}
      {decisionMode && !lostAvailable && (
        <p
          className="rounded-lg px-2.5 py-1.5 text-[10.5px] leading-5"
          style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
        >
          {lang === "ar"
            ? "بيانات Lost المباشرة مش متاحة حاليًا؛ علشان مانضللكش، الحملات الناضجة مش هتظهر «ناجحة» لحد ما المصدر يرجع."
            : "Direct Lost data is unavailable. To avoid a misleading result, mature campaigns will not be marked Successful until the source recovers."}
        </p>
      )}
      {decisionMode && activePlatformCount > evaluatedLiveCount && (
        <p className="text-[10.5px] leading-5 text-text-subtle">
          {lang === "ar"
            ? `${fmtNum(activePlatformCount - evaluatedLiveCount)} حملة Live ظاهرة في حالة المنصات فوق، لكن ملهاش صف أداء قابل للربط في الفترة؛ مش داخلة في الحكم.`
            : `${fmtNum(activePlatformCount - evaluatedLiveCount)} live campaigns appear in platform status above but have no linkable performance row in this period, so they are not classified.`}
        </p>
      )}
      {view !== "all" && <p className="text-[11px] leading-5 text-text-muted">{quickViewHint}</p>}
    </div>
  );

  const layoutToggle = (
    <Segmented
      value={effectiveLayout}
      onChange={setLayout}
      options={[
        { value: "table", label: lang === "ar" ? "جدول" : "Table" },
        { value: "cards", label: lang === "ar" ? "كروت" : "Cards" },
      ]}
    />
  );

  const cols = useMemo<Col<PerfRow>[]>(
    () => buildColumns({ grain, nameOf, unknownAdsetKey, lang, t, spendAvailable, spendNote }),
    // `t` and `nameOf` are stable enough for the label strings; grain and
    // language are what actually change the column set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grain, lang, unknownAdsetKey, spendAvailable, spendNote],
  );

  const drillTo = (r: PerfRow) => {
    if (r.key === unknownAdsetKey) return;
    if (grain === "campaign") {
      filterStore.set({
        campaign: r.campaignName || r.name,
        campaignKey: r.campaignKey || r.key,
        adset: undefined,
        adsetKey: undefined,
        ad: undefined,
        adKey: undefined,
      });
      onGrainChange("adset");
    } else if (grain === "adset") {
      filterStore.set({
        campaign: r.campaignName || filters.campaign,
        campaignKey: r.campaignKey || filters.campaignKey,
        adset: r.adsetName || r.name,
        adsetKey: r.adsetKey || r.key,
        ad: undefined,
        adKey: undefined,
      });
      onGrainChange("ad");
    } else {
      filterStore.set({
        campaign: r.campaignName || filters.campaign,
        campaignKey: r.campaignKey || filters.campaignKey,
        adset: r.adsetName || filters.adset,
        adsetKey: r.adsetKey || filters.adsetKey,
        ad: r.name,
        adKey: r.adKey || r.key,
      });
    }
    setDetail(null);
  };

  return (
    <div className="space-y-3">
      {(title || subtitle) && (
        <div>
          {title && <h2 className="text-[15px] font-semibold text-text">{title}</h2>}
          {subtitle && <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{subtitle}</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Breadcrumbs grain={grain} onGrainChange={onGrainChange} />
        {/* The layout switch and the three grain buttons together need ~355px,
            which is wider than a small phone. Below `sm` they take the full row
            and scroll rather than being clipped at the edge. */}
        <div className="max-sm:hscroll flex w-full items-center gap-2 sm:ms-auto sm:w-auto">
          {layoutToggle}
          <Segmented
            value={grain}
            onChange={onGrainChange}
            size="md"
            options={[
              { value: "campaign", label: t("campaign") },
              { value: "adset", label: t("ad_set") },
              { value: "ad", label: t("ad_name") },
            ]}
          />
        </div>
      </div>

      {view === "attributedRevenue" && !loading && (
        <div
          className="flex flex-col gap-3 rounded-xl border px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"
          style={{
            background: "var(--accent-soft)",
            borderColor: "color-mix(in oklab, var(--accent) 35%, transparent)",
          }}
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface text-accent-ink">
              <CircleDollarSign size={17} />
            </span>
            <div>
              <div className="text-sm font-semibold text-text">
                {lang === "ar"
                  ? "الحملات الداخلة في رقم الإيراد المرتبط"
                  : "Campaigns included in linked revenue"}
              </div>
              <p className="mt-0.5 text-xs leading-5 text-text-muted">
                {lang === "ar"
                  ? "كل صف له منصة إعلانية في الفترة وتحصيل من Accounting. الصفوف بدون منصة أو Organic مستبعدة."
                  : "Every row has an ad platform in the period and Accounting collections. Platform-less and organic rows are excluded."}
              </p>
            </div>
          </div>
          <div className="shrink-0 rounded-xl border border-border bg-surface px-3 py-2 text-start sm:min-w-[160px]">
            <div className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
              {lang === "ar"
                ? `${fmtNum(shown.length)} حملات · مجموع الصفوف`
                : `${fmtNum(shown.length)} campaigns · row total`}
            </div>
            <div className="num mt-0.5 text-lg font-semibold text-text">
              {fmtUSDFull(shown.reduce((sum, row) => sum + row.revenue, 0))}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <Skeleton className="h-[420px]" />
      ) : effectiveLayout === "table" ? (
        <DataTable
          rows={shown}
          cols={cols}
          searchable={searchable}
          search={query}
          onSearchChange={setQuery}
          initialSort={{ key: "spend", dir: -1 }}
          onRowClick={setDetail}
          csvFilename={`${csvPrefix}-${grain}`}
          maxHeight={620}
          columnChooser
          groupLabels={{
            advertising: METRIC_GROUP_LABEL.advertising[lang],
            crm: METRIC_GROUP_LABEL.crm[lang],
            accounting: METRIC_GROUP_LABEL.accounting[lang],
            efficiency: METRIC_GROUP_LABEL.efficiency[lang],
            identity: lang === "ar" ? "التعريف" : "Identity",
          }}
          emptyState={emptyState}
          belowToolbar={quickViews}
          csvRow={csvRow}
        />
      ) : (
        <div className="space-y-3">
          <CardToolbar
            query={query}
            onQuery={setQuery}
            sort={cardSort}
            onSort={setCardSort}
            count={cardRows.length}
            rows={cardRows}
            csvRow={csvRow}
            csvFilename={`${csvPrefix}-${grain}`}
            hideSort={ownerViewMode}
          />
          {quickViews}
          <PerfCards
            rows={cardRows.slice(0, cardLimit)}
            grain={grain}
            nameOf={nameOf}
            spendAvailable={spendAvailable}
            spendNote={spendNote}
            activeCampaignKeys={activeCampaignKeySet}
            showLivePerformance={ownerViewMode}
            ownerMode={ownerViewMode}
            ownerVerdicts={ownerVerdicts}
            onRowClick={setDetail}
            emptyState={emptyState}
          />
          {cardRows.length > cardLimit && (
            <button
              onClick={() => setCardLimit((n) => n + CARD_PAGE)}
              className="w-full py-2.5 rounded-xl border border-border text-[13px] font-medium text-text-muted hover:bg-surface-2 transition-colors cursor-pointer"
            >
              {lang === "ar"
                ? `وريني ${Math.min(CARD_PAGE, cardRows.length - cardLimit)} كمان (${cardLimit} من ${cardRows.length})`
                : `Show ${Math.min(CARD_PAGE, cardRows.length - cardLimit)} more (${cardLimit} of ${cardRows.length})`}
            </button>
          )}
        </div>
      )}

      {detail && (
        <RowDrawer
          row={detail}
          grain={grain}
          nameOf={nameOf}
          spendAvailable={spendAvailable}
          spendNote={spendNote}
          ownerVerdict={ownerViewMode ? ownerVerdicts.get(detail.key) : undefined}
          relatedRows={relatedRows}
          onClose={() => setDetail(null)}
          onDrill={() => drillTo(detail)}
        />
      )}
    </div>
  );
}

/* --- card toolbar ----------------------------------------------------------- */

function CardToolbar({
  query,
  onQuery,
  sort,
  onSort,
  count,
  rows,
  csvRow,
  csvFilename,
  hideSort = false,
}: {
  query: string;
  onQuery: (v: string) => void;
  sort: CardSortKey;
  onSort: (v: CardSortKey) => void;
  count: number;
  rows: PerfRow[];
  csvRow: (r: PerfRow) => Record<string, string | number>;
  csvFilename: string;
  hideSort?: boolean;
}) {
  const { t, lang } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 flex-1 min-w-[150px] max-w-[320px] px-2.5 rounded-lg bg-surface border border-border focus-within:border-brand transition-colors">
        <Search size={15} className="text-text-subtle shrink-0" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("search")}
          aria-label={t("search")}
          className="flex-1 bg-transparent text-sm outline-none py-2 min-w-0"
        />
      </div>

      {!hideSort && (
        <label className="inline-flex items-center gap-1.5 text-[12px] text-text-muted">
          <span className="hidden sm:inline">{lang === "ar" ? "رتّب حسب" : "Sort by"}</span>
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as CardSortKey)}
            aria-label={lang === "ar" ? "ترتيب الكروت" : "Sort cards"}
            className="px-2.5 py-2 rounded-lg bg-surface border border-border text-[13px] min-h-[38px] cursor-pointer"
          >
            {(Object.keys(CARD_SORTS) as CardSortKey[]).map((k) => (
              <option key={k} value={k}>
                {CARD_SORTS[k][lang]}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="ms-auto flex items-center gap-2">
        <span className="text-xs text-text-muted num whitespace-nowrap">
          {count.toLocaleString("en-US")} {t("rows")}
        </span>
        <button
          onClick={() => exportCsv(rows, csvRow, csvFilename)}
          className="text-xs inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-border hover:bg-surface-2 transition-colors cursor-pointer min-h-[36px]"
        >
          <Download size={14} />
          <span className="hidden sm:inline">{t("export_csv")}</span>
        </button>
      </div>
    </div>
  );
}

/* --- breadcrumbs ----------------------------------------------------------- */

function Breadcrumbs({
  grain,
  onGrainChange,
}: {
  grain: Grain;
  onGrainChange: (g: Grain) => void;
}) {
  const { t, lang } = useI18n();
  const filters = useFilters();

  const crumbs: { label: string; onClick?: () => void }[] = [
    {
      label: lang === "ar" ? "كل الحملات" : "All campaigns",
      onClick:
        filters.campaign || filters.adset || filters.ad || grain !== "campaign"
          ? () => {
              filterStore.set({
                campaign: undefined,
                campaignKey: undefined,
                adset: undefined,
                adsetKey: undefined,
                ad: undefined,
                adKey: undefined,
              });
              onGrainChange("campaign");
            }
          : undefined,
    },
  ];

  if (filters.campaign)
    crumbs.push({
      label: filters.campaign,
      onClick:
        filters.adset || filters.ad || grain !== "adset"
          ? () => {
              filterStore.set({
                adset: undefined,
                adsetKey: undefined,
                ad: undefined,
                adKey: undefined,
              });
              onGrainChange("adset");
            }
          : undefined,
    });

  if (filters.adset)
    crumbs.push({
      label: filters.adset,
      onClick:
        filters.ad || grain !== "ad"
          ? () => {
              filterStore.set({ ad: undefined, adKey: undefined });
              onGrainChange("ad");
            }
          : undefined,
    });

  if (filters.ad) crumbs.push({ label: filters.ad });

  return (
    <nav
      aria-label={lang === "ar" ? "مسار التنقل" : "Breadcrumb"}
      className="flex items-center gap-1 text-[12.5px] min-w-0 flex-wrap"
    >
      <Layers size={14} className="text-text-subtle shrink-0" />
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1 min-w-0">
          {i > 0 && <ChevronLeft size={13} className="text-text-subtle shrink-0 rtl:rotate-180" />}
          {c.onClick ? (
            <button
              onClick={c.onClick}
              className="text-brand hover:underline cursor-pointer truncate max-w-[12rem]"
              title={c.label}
            >
              {c.label}
            </button>
          ) : (
            <span className="text-text font-medium truncate max-w-[14rem]" title={c.label}>
              {c.label}
            </span>
          )}
        </span>
      ))}
      <span className="text-text-subtle text-[11px] ms-1">
        · {grain === "campaign" ? t("campaign") : grain === "adset" ? t("ad_set") : t("ad_name")}
      </span>
    </nav>
  );
}

/* --- row detail ------------------------------------------------------------ */

/** Pulls the platform id back out of a stable bucket key, when there is one. */
function idFromKey(key: string, prefix: string): string {
  if (!key.startsWith(`${prefix}:`)) return "";
  const parts = key.split(":");
  return parts.length > 3 ? parts.slice(3).join(":") : "";
}

function RowDrawer({
  row,
  grain,
  nameOf,
  spendAvailable,
  spendNote,
  ownerVerdict,
  relatedRows,
  onClose,
  onDrill,
}: {
  row: PerfRow;
  grain: Grain;
  nameOf: (r: PerfRow) => string;
  spendAvailable: boolean;
  spendNote?: string;
  ownerVerdict?: OwnerCampaignVerdict;
  relatedRows: PerfRow[];
  onClose: () => void;
  onDrill: () => void;
}) {
  const { t, lang } = useI18n();
  const childGrain: Grain | null = grain === "campaign" ? "adset" : grain === "adset" ? "ad" : null;
  const adId = idFromKey(row.adKey, "ad");
  const adsetId = idFromKey(row.adsetKey, "adset");
  const campaignId = row.campaignKey.startsWith("id:") ? row.campaignKey.slice(3) : "";

  const facts: { label: string; value: React.ReactNode }[] = [];
  if (grain === "ad") {
    facts.push({
      label: lang === "ar" ? "اسم الإعلان (Creative)" : "Creative name",
      value: row.name || (
        <Unavailable reason={lang === "ar" ? "الاسم مش موجود في المصدر" : "Absent in the source"} />
      ),
    });
    facts.push({
      label: lang === "ar" ? "معرّف الإعلان (Ad ID)" : "Ad ID",
      value: adId ? <span className="num text-[11px] break-all">{adId}</span> : <Unavailable />,
    });
  }
  if (grain !== "campaign" && row.adsetName)
    facts.push({ label: t("ad_set"), value: row.adsetName });
  if (grain === "adset" && adsetId)
    facts.push({
      label: lang === "ar" ? "معرّف المجموعة" : "Ad set ID",
      value: <span className="num text-[11px] break-all">{adsetId}</span>,
    });
  if (row.campaignName) facts.push({ label: t("campaign"), value: row.campaignName });
  if (campaignId)
    facts.push({
      label: lang === "ar" ? "معرّف الحملة" : "Campaign ID",
      value: <span className="num text-[11px] break-all">{campaignId}</span>,
    });
  if (row.spendDateMin)
    facts.push({
      label: lang === "ar" ? "أيام الإنفاق المتاحة" : "Spend data covers",
      value: <span className="num text-[11px]">{`${row.spendDateMin} → ${row.spendDateMax}`}</span>,
    });
  facts.push({
    label: lang === "ar" ? "الفواتير المدفوعة" : "Paid invoices",
    value: <span className="num">{fmtNum(row.invoices)}</span>,
  });
  facts.push({
    label: lang === "ar" ? "أوامر البيع المفوترة بالكامل" : "Fully invoiced sales orders",
    value: <span className="num">{fmtNum(row.salesOrders)}</span>,
  });

  const groups: {
    group: keyof typeof METRIC_GROUP_LABEL;
    items: { key: MetricKey; node: React.ReactNode }[];
  }[] = [
    {
      group: "advertising",
      items: [
        {
          key: "spend",
          node:
            row.spend > 0 || spendAvailable ? (
              fmtUSDFull(row.spend)
            ) : (
              <Unavailable reason={spendNote} />
            ),
        },
        { key: "impressions", node: fmtNum(row.impressions) },
        { key: "clicks", node: fmtNum(row.clicksAll) },
        { key: "ctrAll", node: ratioCell(row.ctrAll, row.impressions, (v) => fmtPct(v, 2)) },
        { key: "ctrLink", node: maybeCell(row.ctrLink, (v) => fmtPct(v, 2)) },
        { key: "platformLeads", node: maybeCell(row.platformLeads, fmtNum) },
      ],
    },
    {
      group: "crm",
      items: [
        { key: "crmLeads", node: fmtNum(row.crmLeads) },
        { key: "won", node: fmtNum(row.won) },
        { key: "conversionRate", node: maybeCell(row.conversionRate, (v) => fmtPct(v, 2)) },
        { key: "lost", node: fmtNum(row.lost) },
        { key: "lostRate", node: maybeCell(row.lostRate, (v) => fmtPct(v, 2)) },
      ],
    },
    {
      group: "accounting",
      items: [
        { key: "revenue", node: fmtUSDFull(row.revenue) },
        { key: "revenuePerLead", node: maybeCell(row.revenuePerLead, fmtUSDFull) },
      ],
    },
    {
      group: "efficiency",
      items: [
        { key: "cpl", node: ratioCell(row.cpl, row.spend, fmtUSDFull, spendNote) },
        { key: "cpa", node: ratioCell(row.cpa, row.spend, fmtUSDFull, spendNote) },
        { key: "cpm", node: ratioCell(row.cpm, row.spend, fmtUSDFull, spendNote) },
        { key: "cpc", node: ratioCell(row.cpc, row.spend, fmtUSDFull, spendNote) },
        {
          key: "roas",
          node: ratioCell(row.roas, row.spend, (v) => `${v.toFixed(2)}×`, spendNote),
        },
        { key: "acos", node: ratioCell(row.acos, row.spend, (v) => fmtPct(v, 1), spendNote) },
      ],
    },
  ];

  const roas = roasVerdict(row.roas, row.spend);
  const acos = acosVerdict(row.spend > 0 ? row.acos : null);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end animate-fade-in"
      style={{ background: "rgba(4, 12, 24, 0.5)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={nameOf(row)}
    >
      <div
        className="w-full sm:max-w-md h-dvh overflow-y-auto overscroll-contain bg-surface border-s border-border shadow-xl animate-slide-up sm:animate-fade-in pb-[env(safe-area-inset-bottom)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-4 py-3 border-b border-border bg-surface/95 backdrop-blur">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <PlatformBadges platforms={row.platforms} />
              {row.objective === "website_conversion" && (
                <span className="rounded-full bg-brand-soft px-2 py-1 text-[10px] font-semibold text-brand">
                  {lang === "ar" ? "تحويلات موقع" : "Website conversions"}
                </span>
              )}
              {row.adsetOrigin && <AdSetOriginBadge origin={row.adsetOrigin} />}
              {ownerVerdict ? (
                ownerVerdict.status === "early" ? (
                  <span className="rounded-full bg-surface-2 px-2 py-1 text-[10px] font-semibold text-text-muted">
                    {ownerStatusLabel(ownerVerdict.status, lang)}
                  </span>
                ) : (
                  <VerdictChip
                    verdict={
                      ownerVerdict.status === "successful"
                        ? "good"
                        : ownerVerdict.status === "watch"
                          ? "watch"
                          : "weak"
                    }
                    label={ownerStatusLabel(ownerVerdict.status, lang)}
                  />
                )
              ) : roas ? (
                <VerdictChip
                  verdict={roas}
                  label={
                    roas === "good"
                      ? lang === "ar"
                        ? "أداء كويس"
                        : "Healthy"
                      : roas === "watch"
                        ? lang === "ar"
                          ? "محتاج متابعة"
                          : "Watch"
                        : lang === "ar"
                          ? "أداء ضعيف"
                          : "Weak"
                  }
                />
              ) : null}
            </div>
            <h3 className="text-[15px] font-semibold text-text mt-1.5 leading-snug break-words">
              {nameOf(row)}
            </h3>
            {row.course && (
              <p className="text-[11px] text-text-muted mt-0.5">
                <InferredCourse course={row.course} inferred={row.courseInferred} />
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={t("close")}
            className="w-9 h-9 grid place-items-center rounded-full hover:bg-surface-2 transition-colors cursor-pointer shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {ownerVerdict && (
            <section className="rounded-xl border border-border bg-surface-2/60 p-3">
              <h4 className="text-[12px] font-semibold text-text">
                {lang === "ar" ? "ليه أخدت الحكم ده؟" : "Why this verdict?"}
              </h4>
              <p className="mt-1 text-[11.5px] leading-5 text-text-muted">
                {ownerVerdict.reason[lang]}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-subtle">
                <span>
                  {lang === "ar"
                    ? row.objective === "website_conversion"
                      ? `الحكم مبني على ${fmtNum(row.platformLeads ?? 0)} تحويل موقع، مش ليدز CRM`
                      : `الحكم مبني على ${fmtNum(row.crmLeads)} ليد`
                    : row.objective === "website_conversion"
                      ? `Based on ${fmtNum(row.platformLeads ?? 0)} website conversions, not CRM leads`
                      : `Based on ${fmtNum(row.crmLeads)} leads`}
                </span>
                {row.objective !== "website_conversion" && ownerVerdict.benchmark.days !== null && (
                  <span>
                    {lang === "ar"
                      ? `مرجع دورة البيع ${ownerVerdict.benchmark.days.toFixed(1)} يوم`
                      : `Sales-cycle benchmark ${ownerVerdict.benchmark.days.toFixed(1)} days`}
                  </span>
                )}
              </div>
            </section>
          )}

          {row.partialSpend && (
            <p
              className="text-[11.5px] leading-relaxed rounded-lg px-3 py-2"
              style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
            >
              {lang === "ar"
                ? "بيانات الإنفاق بتغطي جزء من الفترة بس، والإيراد بيمتد بره النطاق ده — يعني نسب العائد هنا مش قابلة للمقارنة بباقي الصفوف."
                : "Spend data covers only part of this period while revenue extends beyond it, so the ratios here are not comparable with other rows."}
            </p>
          )}

          {facts.length > 0 && (
            <dl className="grid grid-cols-1 gap-2 text-[12.5px]">
              {facts.map((f) => (
                <div
                  key={f.label}
                  className="flex items-start justify-between gap-3 py-1 border-b border-border/60"
                >
                  <dt className="text-text-muted shrink-0">{f.label}</dt>
                  <dd className="text-text font-medium text-end min-w-0 break-words">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {groups.map((g) => (
            <section key={g.group}>
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle mb-1.5">
                {METRIC_GROUP_LABEL[g.group][lang]}
              </h4>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
                {g.items.map((it) => (
                  <div key={it.key} className="contents">
                    <dt className="text-text-muted py-1 border-b border-border/60 flex items-center gap-1 min-w-0">
                      <span className="truncate">{METRICS[it.key][lang].short}</span>
                      <MetricInfo metric={it.key} size={11} note={spendNote} />
                    </dt>
                    <dd className="num text-end font-medium py-1 border-b border-border/60">
                      {it.node}
                    </dd>
                  </div>
                ))}
              </dl>
              {g.group === "efficiency" && acos && (
                <div className="mt-1.5">
                  <VerdictChip
                    verdict={acos}
                    label={
                      acos === "good"
                        ? lang === "ar"
                          ? "الإعلانات بتاكل جزء صغير من التحصيل"
                          : "Advertising takes a small share"
                        : acos === "watch"
                          ? lang === "ar"
                            ? "الإعلانات بتاكل نص التحصيل تقريبًا"
                            : "Advertising takes about half"
                          : lang === "ar"
                            ? "الإنفاق أكبر من التحصيل"
                            : "Spend exceeds collections"
                    }
                  />
                </div>
              )}
            </section>
          ))}

          {grain === "campaign" && relatedRows.length > 0 && (
            <details className="group rounded-xl border border-border bg-surface">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-[12px] font-semibold text-text">
                <span>
                  {lang === "ar"
                    ? `حملات مرتبطة بنفس الدورة (${fmtNum(relatedRows.length)})`
                    : `Related campaigns for the same course (${fmtNum(relatedRows.length)})`}
                </span>
                <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
              </summary>
              <ul className="border-t border-border px-2 py-2 space-y-1">
                {relatedRows.slice(0, 10).map((related) => (
                  <li
                    key={related.key}
                    className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-2.5 py-2 text-[11px]"
                  >
                    <span className="min-w-0 truncate text-text" dir="auto" title={nameOf(related)}>
                      {nameOf(related)}
                    </span>
                    <span className="num shrink-0 text-text-muted">
                      {fmtUSD(related.spend)} · {fmtPct(related.conversionRate, 1)} ·{" "}
                      {related.roas === null ? "—" : `${related.roas.toFixed(2)}×`}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <button
            onClick={onDrill}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-colors cursor-pointer"
            style={{ background: "var(--brand)" }}
          >
            <Target size={15} />
            {grain === "ad"
              ? lang === "ar"
                ? "ركّز الصفحة كلها على الإعلان ده"
                : "Scope the whole page to this ad"
              : lang === "ar"
                ? "ركّز الصفحة كلها على الصف ده"
                : "Scope the whole page to this row"}
          </button>

          {childGrain && row.campaignKey && (
            <ChildLevel
              parentGrain={grain}
              childGrain={childGrain}
              campaignKey={row.campaignKey}
              adsetKey={row.adsetKey}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The level below the row being inspected — a campaign's ad sets, an ad set's
 * ads. Fetched only while the drawer is open, and scoped through the same
 * campaign/ad-set keys the tables use, so it can never disagree with them.
 */
function ChildLevel({
  parentGrain,
  childGrain,
  campaignKey,
  adsetKey,
}: {
  parentGrain: Grain;
  childGrain: Grain;
  campaignKey: string;
  adsetKey: string;
}) {
  const { t, lang } = useI18n();
  const scope =
    parentGrain === "campaign"
      ? `campaignKey=${encodeURIComponent(campaignKey)}`
      : `campaignKey=${encodeURIComponent(campaignKey)}&adsetKey=${encodeURIComponent(adsetKey)}`;
  // The campaigns endpoint returns rows and nothing else, which is all this
  // needs — asking /api/ads would also recompute per-platform coverage the
  // drawer never shows.
  const { data, isLoading } = useApi<{ rows: PerfRow[] }>(
    `/api/campaigns?grain=${childGrain}&${scope}`,
  );

  const rows = (data?.rows ?? []).slice(0, 25);

  return (
    <section>
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle mb-1.5 flex items-center gap-1.5">
        <PanelRightOpen size={12} />
        {childGrain === "adset"
          ? lang === "ar"
            ? "المجموعات الإعلانية جواها"
            : "Ad sets inside"
          : lang === "ar"
            ? "الإعلانات جواها"
            : "Ads inside"}
      </h4>

      {isLoading ? (
        <Skeleton className="h-24" />
      ) : rows.length === 0 ? (
        <p className="text-[11.5px] text-text-muted">
          {lang === "ar"
            ? "مفيش مستوى أعمق متاح للصف ده في الفترة المختارة."
            : "No deeper level available for this row in the selected period."}
        </p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li
              key={r.key}
              className="flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-lg bg-surface-2 text-[12px]"
            >
              <span className="truncate text-text min-w-0" title={r.name || EM}>
                {r.name || EM}
              </span>
              <span className="num text-text-muted shrink-0 flex items-center gap-2">
                <span title={t("spend")}>{fmtUSD(r.spend)}</span>
                <span className="text-text-subtle">·</span>
                <span title={t("crm_leads")}>{fmtNum(r.crmLeads)}</span>
                <span className="text-text-subtle">·</span>
                <span title={t("revenue")}>{fmtUSD(r.revenue)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {(data?.rows?.length ?? 0) > 25 && (
        <p className="text-[10.5px] text-text-subtle mt-1">
          {lang === "ar"
            ? `معروض ٢٥ من ${data!.rows.length} — افتح المستوى ده في الجدول لعرض الباقي.`
            : `Showing 25 of ${data!.rows.length} — open this level in the table to see the rest.`}
        </p>
      )}
    </section>
  );
}

/* --- columns --------------------------------------------------------------- */

function buildColumns({
  grain,
  nameOf,
  unknownAdsetKey,
  lang,
  t,
  spendAvailable,
  spendNote,
}: {
  grain: Grain;
  nameOf: (r: PerfRow) => string;
  unknownAdsetKey?: string;
  lang: "ar" | "en";
  t: (k: DictKey) => string;
  spendAvailable: boolean;
  spendNote?: string;
}): Col<PerfRow>[] {
  const label = (key: MetricKey) => METRICS[key][lang].short;
  const header = (key: MetricKey) => (
    <span className="inline-flex items-center gap-1">
      {METRICS[key][lang].short}
      <MetricInfo metric={key} size={11} note={spendNote} />
    </span>
  );

  return [
    {
      key: "name",
      group: "identity",
      always: true,
      label: lang === "ar" ? "الاسم" : "Name",
      header: grain === "campaign" ? t("campaign") : grain === "adset" ? t("ad_set") : t("ad_name"),
      sticky: true,
      width: "250px",
      sortValue: (r) => nameOf(r),
      render: (r) => (
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0">
            <div
              className={`truncate max-w-[210px] ${
                r.key === unknownAdsetKey ? "text-text-muted italic" : ""
              }`}
              title={nameOf(r)}
            >
              {nameOf(r)}
            </div>
            {grain !== "campaign" && r.key !== unknownAdsetKey && (
              <div
                className="mt-0.5 max-w-[210px] truncate text-[10px] text-text-subtle"
                title={[r.campaignName, grain === "ad" ? r.adsetName : ""]
                  .filter(Boolean)
                  .join(" › ")}
              >
                {[r.campaignName, grain === "ad" ? r.adsetName : ""].filter(Boolean).join(" › ")}
              </div>
            )}
          </div>
          {grain === "adset" && r.key !== unknownAdsetKey && (
            <AdSetOriginBadge origin={r.adsetOrigin} />
          )}
        </div>
      ),
    },
    {
      key: "platform",
      group: "identity",
      label: t("platform"),
      header: t("platform"),
      sortValue: (r) => r.platforms.join(","),
      render: (r) => <PlatformBadges platforms={r.platforms} />,
    },
    {
      key: "course",
      group: "identity",
      label: t("course"),
      header: t("course"),
      hideByDefault: true,
      sortValue: (r) => r.course,
      render: (r) => <InferredCourse course={r.course} inferred={r.courseInferred} />,
    },

    {
      key: "spend",
      group: "advertising",
      label: label("spend"),
      header: header("spend"),
      align: "right",
      sortValue: (r) => r.spend,
      // With no spend tab behind the platform, a `$0` here would be a claim the
      // source never made. The dash says "unknown", which is the truth.
      render: (r) =>
        spendAvailable ? fmtUSD(r.spend) : <Unavailable reason={spendNote} compact />,
    },
    {
      key: "impressions",
      group: "advertising",
      label: label("impressions"),
      header: header("impressions"),
      align: "right",
      hideByDefault: true,
      sortValue: (r) => r.impressions,
      render: (r) => fmtNum(r.impressions),
    },
    {
      key: "clicks",
      group: "advertising",
      label: label("clicks"),
      header: header("clicks"),
      align: "right",
      hideByDefault: true,
      sortValue: (r) => r.clicksAll,
      render: (r) => fmtNum(r.clicksAll),
    },
    {
      key: "ctrAll",
      group: "advertising",
      label: label("ctrAll"),
      header: header("ctrAll"),
      align: "right",
      sortValue: (r) => sortRatio(r.ctrAll, r.impressions),
      render: (r) => ratioCell(r.ctrAll, r.impressions, (v) => fmtPct(v, 2)),
    },
    {
      key: "ctrLink",
      group: "advertising",
      label: label("ctrLink"),
      header: header("ctrLink"),
      align: "right",
      hideByDefault: true,
      // Snapchat does not report link clicks; this stays an em dash, never 0.
      sortValue: (r) => sortMaybe(r.ctrLink),
      render: (r) => maybeCell(r.ctrLink, (v) => fmtPct(v, 2)),
    },
    {
      key: "platformLeads",
      group: "advertising",
      label: label("platformLeads"),
      header: header("platformLeads"),
      align: "right",
      sortValue: (r) => sortMaybe(r.platformLeads),
      render: (r) => maybeCell(r.platformLeads, fmtNum),
    },

    {
      key: "crmLeads",
      group: "crm",
      label: label("crmLeads"),
      header: header("crmLeads"),
      align: "right",
      sortValue: (r) => r.crmLeads,
      render: (r) => fmtNum(r.crmLeads),
    },
    {
      key: "won",
      group: "crm",
      label: label("won"),
      header: header("won"),
      align: "right",
      sortValue: (r) => r.won,
      render: (r) => fmtNum(r.won),
    },
    {
      key: "conversionRate",
      group: "crm",
      label: label("conversionRate"),
      header: header("conversionRate"),
      align: "right",
      hideByDefault: true,
      sortValue: (r) => sortMaybe(r.conversionRate),
      render: (r) => maybeCell(r.conversionRate, (v) => fmtPct(v, 2)),
    },
    {
      key: "lost",
      group: "crm",
      label: label("lost"),
      header: header("lost"),
      align: "right",
      hideByDefault: true,
      sortValue: (r) => r.lost,
      render: (r) => fmtNum(r.lost),
    },
    {
      key: "lostRate",
      group: "crm",
      label: label("lostRate"),
      header: header("lostRate"),
      align: "right",
      hideByDefault: true,
      sortValue: (r) => sortMaybe(r.lostRate),
      render: (r) => maybeCell(r.lostRate, (v) => fmtPct(v, 2)),
    },

    {
      key: "revenue",
      group: "accounting",
      label: label("revenue"),
      header: header("revenue"),
      align: "right",
      sortValue: (r) => r.revenue,
      render: (r) => fmtUSD(r.revenue),
    },
    {
      key: "invoices",
      group: "accounting",
      label: lang === "ar" ? "الفواتير المدفوعة" : "Paid invoices",
      header: lang === "ar" ? "الفواتير" : "Invoices",
      align: "right",
      sortValue: (r) => r.invoices,
      render: (r) => fmtNum(r.invoices),
    },
    {
      key: "salesOrders",
      group: "accounting",
      label: lang === "ar" ? "أوامر البيع المفوترة بالكامل" : "Fully invoiced sales orders",
      header: lang === "ar" ? "أوامر البيع" : "Sales orders",
      align: "right",
      sortValue: (r) => r.salesOrders,
      render: (r) => fmtNum(r.salesOrders),
    },
    {
      key: "revenuePerLead",
      group: "accounting",
      label: label("revenuePerLead"),
      header: header("revenuePerLead"),
      align: "right",
      hideByDefault: true,
      sortValue: (r) => sortMaybe(r.revenuePerLead),
      render: (r) => maybeCell(r.revenuePerLead, fmtUSDFull),
    },

    {
      key: "cpl",
      group: "efficiency",
      label: label("cpl"),
      header: header("cpl"),
      align: "right",
      sortValue: (r) => sortRatio(r.cpl, r.spend),
      render: (r) => ratioCell(r.cpl, r.spend, fmtUSDFull, spendNote),
    },
    {
      key: "cpa",
      group: "efficiency",
      label: label("cpa"),
      header: header("cpa"),
      align: "right",
      hideByDefault: true,
      sortValue: (r) => sortRatio(r.cpa, r.spend),
      render: (r) => ratioCell(r.cpa, r.spend, fmtUSDFull, spendNote),
    },
    {
      key: "roas",
      group: "efficiency",
      label: label("roas"),
      header: header("roas"),
      align: "right",
      sortValue: (r) => sortRatio(r.roas, r.spend),
      render: (r) => <RoasBadge row={r} />,
    },
    {
      key: "acos",
      group: "efficiency",
      label: label("acos"),
      header: header("acos"),
      align: "right",
      hideByDefault: true,
      sortValue: (r) => sortRatio(r.acos, r.spend),
      render: (r) => <AcosBadge row={r} />,
    },
  ];
}

function RoasBadge({ row }: { row: PerfRow }) {
  const { lang } = useI18n();
  const verdict = roasVerdict(row.roas, row.spend);
  if (!verdict || row.roas === null) return <span className="text-text-subtle">{EM}</span>;

  const text = `${row.roas.toFixed(2)}×`;
  if (row.partialSpend) {
    const window =
      row.spendDateMin && row.spendDateMax ? ` (${row.spendDateMin} → ${row.spendDateMax})` : "";
    return (
      <span
        className="inline-flex items-center gap-1"
        title={
          lang === "ar"
            ? `بيانات الإنفاق بتغطي جزء من الفترة${window} والإيراد بيمتد بره النطاق ده — النسبة دي مش قابلة للمقارنة.`
            : `Spend data covers only part of the period${window} while revenue extends beyond it — this ratio is not comparable.`
        }
      >
        <span className="num text-text-muted">{text}</span>
        <span
          className="text-[9px] px-1 rounded"
          style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
        >
          {lang === "ar" ? "جزئي" : "partial"}
        </span>
      </span>
    );
  }
  return <VerdictChip verdict={verdict} label={text} />;
}

function AcosBadge({ row }: { row: PerfRow }) {
  const verdict = acosVerdict(row.spend > 0 ? row.acos : null);
  if (!verdict || row.acos === null) return <span className="text-text-subtle">{EM}</span>;
  return <VerdictChip verdict={verdict} label={fmtPct(row.acos, 1)} />;
}
