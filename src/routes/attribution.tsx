import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  BarChart3,
  DollarSign,
  MessagesSquare,
  ShieldCheck,
  Target,
  UsersRound,
} from "lucide-react";
import { HBarChart, MultiLineChart } from "@/components/charts";
import { DataTable, type Col } from "@/components/DataTable";
import {
  DashboardPageHeader,
  KpiRow,
  PageSection,
  PageSections,
} from "@/components/dashboard-bits";
import { MetaDestinationMixSection } from "@/components/attribution/MetaDestinationMixSection";
import { MetricDetailTrigger } from "@/components/metric-detail";
import { FunnelBars } from "@/components/ui-bits";
import { useApi } from "@/lib/use-api";
import { fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import { buildQuery, useFilters } from "@/lib/filter-store";
import type { MetricDetail } from "@/lib/metric-detail";
import { useReportingPeriod } from "@/lib/use-reporting-period";

export const Route = createFileRoute("/attribution")({ component: Attribution });

interface AttributionTotals {
  conversations: number;
  attributedConversations: number;
  metaCtwaConversations: number;
  paidCampaignConversations: number;
  organicDirectConversations: number;
  unknownConversations: number;
  exactConversations: number;
  uniqueContacts: number;
  crmMatched: number;
  won: number;
  revenue: number | null;
  unknownRate: number | null;
  spend: number | null;
  spendAvailable: boolean;
  spendCoveredConversations: number;
  costPerConversation: number | null;
  costPerAcquisition: number | null;
  roas: number | null;
}

interface AttributionCampaign {
  platform: string;
  source: string;
  medium: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  conversations: number;
  crmLeads: number;
  won: number;
  lost: number;
  revenue: number | null;
  spend: number | null;
  costPerAttributedConversation: number | null;
  conversionRate: number | null;
  cpa: number | null;
  roas: number | null;
}

interface AttributionSummary {
  configured: boolean;
  totals: AttributionTotals | null;
  campaigns: AttributionCampaign[];
  sources: {
    channel: string;
    platform: string;
    source: string;
    medium: string;
    conversations: number;
    won: number;
    revenue: number | null;
  }[];
  branches: {
    branch_id: string;
    branch_name: string;
    conversations: number;
    won: number;
    revenue: number | null;
  }[];
  trend: { date: string; conversations: number; unknownConversations: number }[];
}

interface AttributionConversation {
  conversation_id: number;
  latest_touch_at: string | null;
  platform: string;
  channel: string;
  source: string;
  medium: string;
  campaign_name: string;
  campaign_id: string;
  adset_name: string;
  adset_id: string;
  ad_name: string;
  ad_id: string;
  creative_name: string;
  creative_id: string;
  placement: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  branch_name: string;
  branch_id: string;
  attribution_method: string;
  confidence: string;
  unknown_reason: string;
  crm_status: string;
  crm_won: boolean;
  crm_lost: boolean;
  revenue: number | null;
  chatwootUrl: string | null;
}

interface AttributionConversationsResponse {
  configured: boolean;
  total: number;
  rows: AttributionConversation[];
}

function attributionMetrics(
  totals: AttributionTotals | null | undefined,
  data: AttributionSummary | undefined,
  ar: boolean,
): Record<string, MetricDetail> {
  const campaignBreakdown = {
    id: "campaigns",
    title: ar ? "أعلى الحملات حسب المحادثات" : "Top campaigns by conversations",
    rows: (data?.campaigns || []).slice(0, 8).map((row) => ({
      key: `${row.platform}:${row.campaign_id || row.campaign_name || row.source}`,
      label: row.campaign_name || row.campaign_id || row.source || (ar ? "غير معروف" : "Unknown"),
      value: row.conversations,
      display: fmtNum(row.conversations),
      meta: row.platform,
    })),
    moreTo: "/attribution",
    moreLabel: ar ? "عرض تقرير الإسناد" : "Open attribution report",
    emptyLabel: ar ? "لا توجد حملات مثبتة في الفترة" : "No evidenced campaigns in this period",
  };
  const report = {
    to: "/attribution",
    label: ar ? "فتح تقرير الإسناد" : "Open attribution report",
  };
  const spendCaveat = totals?.spendAvailable
    ? ar
      ? "التكلفة تشمل الحملات التي تطابق معرّفها تطابقًا دقيقًا فقط."
      : "Cost covers only campaigns with an exact campaign-ID match."
    : ar
      ? "لا يظهر رقم تكلفة لأن معرّفات الحملات لم تتطابق تطابقًا دقيقًا."
      : "No cost is shown because campaign IDs did not match exactly.";
  const trend = (data?.trend || []).map((point) => ({
    date: point.date,
    value: point.conversations,
  }));

  return {
    conversations: {
      id: "attribution.conversations",
      title: ar ? "المحادثات" : "Conversations",
      value: fmtNum(totals?.conversations),
      tone: "violet",
      icon: <MessagesSquare size={17} />,
      definition: ar
        ? "كل محادثة دخلت سجل الإسناد مرة واحدة في الفترة المختارة."
        : "Every conversation recorded once by attribution in the selected period.",
      formula: ar ? "عدد معرّفات المحادثة المختلفة" : "Count of distinct conversation IDs",
      breakdowns: [campaignBreakdown],
      ...(trend.length
        ? {
            trend: {
              points: trend,
              label: ar ? "المحادثات يوميًا" : "Daily conversations",
              format: fmtNum,
              grain: "day" as const,
            },
          }
        : {}),
      report,
    },
    attributed: {
      id: "attribution.evidence_attributed",
      title: ar ? "منسوبة بدليل" : "Evidence-attributed",
      value: fmtNum(totals?.attributedConversations),
      tone: "sky",
      icon: <Target size={17} />,
      definition: ar
        ? "محادثات معها دليل مصدر قابل للمراجعة: CTWA أو UTM أو توكن تتبع."
        : "Conversations with reviewable CTWA, UTM, or tracking-token evidence.",
      formula: ar
        ? "المحادثات التي تحمل دليل مزوّد أو UTM أو رابط إحالة أو توكن موثوق"
        : "Conversations with provider, UTM, referral-link, or trusted-token evidence",
      supporting: [
        {
          key: "exact",
          label: ar ? "إسناد دقيق" : "Exact attribution",
          value: fmtNum(totals?.exactConversations),
        },
        {
          key: "unknown",
          label: ar ? "غير معروف" : "Unknown",
          value: fmtNum(totals?.unknownConversations),
        },
      ],
      breakdowns: [campaignBreakdown],
      report,
    },
    paidCampaigns: {
      id: "attribution.paid_campaigns",
      title: ar ? "محادثات حملات مدفوعة" : "Paid campaign conversations",
      value: fmtNum(totals?.paidCampaignConversations),
      tone: "mint",
      icon: <Target size={17} />,
      definition: ar
        ? "محادثات تحمل دليل Meta أصليًا وتم حل معرّف حملتها بدقة."
        : "Conversations with native Meta evidence and an exactly resolved campaign ID.",
      caveat: ar
        ? "القناة وحدها لا تُصنّف المحادثة كإعلان مدفوع."
        : "Channel alone never classifies a conversation as paid.",
      breakdowns: [campaignBreakdown],
      report,
    },
    organicDirect: {
      id: "attribution.organic_direct",
      title: ar ? "عضوي / مباشر" : "Organic / direct",
      value: fmtNum(totals?.organicDirectConversations),
      tone: "sky",
      icon: <MessagesSquare size={17} />,
      definition: ar
        ? "القناة معروفة، لكن رسالة المزوّد لا تحمل إحالة إعلان مدفوع."
        : "The channel is known but the provider message carries no paid referral.",
      report,
    },
    ctwa: {
      id: "attribution.ctwa",
      title: "Click-to-WhatsApp",
      value: fmtNum(totals?.metaCtwaConversations),
      tone: "mint",
      icon: <BarChart3 size={17} />,
      definition: ar
        ? "محادثات تحمل إحالة إعلان Meta الأصلية داخل رسالة واتساب الواردة."
        : "Conversations carrying Meta's native ad referral on the inbound WhatsApp message.",
      caveat: ar
        ? "وجود المحادثة وحده لا يكفي؛ الرقم يتطلب كائن referral الأصلي."
        : "A conversation alone is insufficient; the native referral object is required.",
      breakdowns: [campaignBreakdown],
      report,
    },
    unknownRate: {
      id: "attribution.unknown_rate",
      title: ar ? "نسبة غير معروفة" : "Unknown rate",
      value: fmtPct(totals?.unknownRate, 1),
      tone: "rose",
      icon: <ShieldCheck size={17} />,
      definition: ar
        ? "نسبة المحادثات التي لا يوجد معها دليل كافٍ لإثبات المصدر."
        : "Share of conversations without enough evidence to prove their source.",
      formula: ar
        ? "المحادثات غير المعروفة ÷ كل المحادثات × 100"
        : "Unknown conversations ÷ all conversations × 100",
      caveat: ar
        ? "غير معروف لا يعني أورجانيك، لذلك لا يعيد النظام تصنيفه تلقائيًا."
        : "Unknown does not mean organic, so it is never silently reclassified.",
      supporting: [
        {
          key: "unknown",
          label: ar ? "محادثات غير معروفة" : "Unknown conversations",
          value: fmtNum(totals?.unknownConversations),
        },
        {
          key: "all",
          label: ar ? "كل المحادثات" : "All conversations",
          value: fmtNum(totals?.conversations),
        },
      ],
      report,
    },
    crmMatched: {
      id: "attribution.crm_matched",
      title: ar ? "عملاء CRM مطابقون" : "CRM matched",
      value: fmtNum(totals?.crmMatched),
      tone: "amber",
      icon: <UsersRound size={17} />,
      definition: ar
        ? "محادثات تم ربطها بنتيجة CRM مع الحفاظ على بيانات العميل خارج سجل الدليل."
        : "Conversations linked to a CRM outcome while customer data stays outside the evidence record.",
      supporting: [
        {
          key: "won",
          label: ar ? "مغلق بنجاح" : "Won",
          value: fmtNum(totals?.won),
        },
        {
          key: "contacts",
          label: ar ? "جهات اتصال مختلفة" : "Unique contacts",
          value: fmtNum(totals?.uniqueContacts),
        },
      ],
      report,
    },
    spend: {
      id: "attribution.spend",
      title: ar ? "الصرف المطابق" : "Matched spend",
      value: totals?.spendAvailable ? fmtUSD(totals.spend) : "—",
      tone: "amber",
      icon: <DollarSign size={17} />,
      definition: ar
        ? "إنفاق Meta الذي تطابق معرّف حملته مع دليل المحادثة تطابقًا دقيقًا."
        : "Meta spend whose campaign ID exactly matches conversation evidence.",
      caveat: spendCaveat,
      supporting: [
        {
          key: "coverage",
          label: ar ? "محادثات مغطاة" : "Covered conversations",
          value: fmtNum(totals?.spendCoveredConversations),
        },
      ],
      breakdowns: [campaignBreakdown],
      report,
    },
    cpl: {
      id: "attribution.cpl",
      title: ar ? "تكلفة المحادثة المنسوبة" : "Cost / attributed conversation",
      value: totals?.spendAvailable ? fmtUSD(totals.costPerConversation) : "—",
      tone: "sky",
      icon: <Target size={17} />,
      definition: ar
        ? "متوسط تكلفة المحادثة المغطاة بإسناد حملة دقيق."
        : "Average cost of a conversation covered by exact campaign attribution.",
      formula: ar ? "الصرف المطابق ÷ المحادثات المغطاة" : "Matched spend ÷ covered conversations",
      caveat: spendCaveat,
      report,
    },
    cpa: {
      id: "attribution.cpa",
      title: "CPA",
      value: totals?.spendAvailable ? fmtUSD(totals.costPerAcquisition) : "—",
      tone: "mint",
      icon: <Target size={17} />,
      definition: ar
        ? "متوسط تكلفة كل محادثة مطابقة أُغلقت بنجاح في CRM."
        : "Average cost of each matched conversation won in CRM.",
      formula: ar ? "الصرف المطابق ÷ المحادثات المغلقة" : "Matched spend ÷ CRM-won conversations",
      caveat: spendCaveat,
      supporting: [{ key: "won", label: ar ? "مغلق بنجاح" : "Won", value: fmtNum(totals?.won) }],
      report,
    },
    roas: {
      id: "attribution.roas",
      title: "ROAS",
      value: totals?.spendAvailable && totals.roas !== null ? `${totals.roas.toFixed(2)}×` : "—",
      tone: "violet",
      icon: <BarChart3 size={17} />,
      definition: ar
        ? "العائد من إيراد محادثات CRM المغطاة فقط مقابل الصرف المطابق."
        : "Return from covered CRM conversation revenue against matched spend only.",
      formula: ar
        ? "إيراد المحادثات المغطاة ÷ الصرف المطابق"
        : "Covered conversation revenue ÷ matched spend",
      caveat: spendCaveat,
      supporting: [
        {
          key: "revenue",
          label: ar ? "الإيراد المغطى" : "Covered revenue",
          value: fmtUSD(totals?.revenue),
        },
        {
          key: "spend",
          label: ar ? "الصرف المطابق" : "Matched spend",
          value: fmtUSD(totals?.spend),
        },
      ],
      report,
    },
  };
}

function Attribution() {
  const { lang } = useI18n();
  const filters = useFilters();
  const reportingPeriod = useReportingPeriod();
  const [localFilters, setLocalFilters] = useState({
    channel: "",
    platform: "",
    source: "",
    medium: "",
    campaignId: "",
    adsetId: "",
    adId: "",
    inboxId: "",
    branchId: "",
    method: "",
    confidence: "",
    unknownReason: "",
  });
  const baseQuery = buildQuery(filters);
  const queryParams = new URLSearchParams(
    baseQuery.startsWith("?") ? baseQuery.slice(1) : baseQuery,
  );
  for (const [key, value] of Object.entries(localFilters)) {
    if (value) queryParams.set(key, value);
  }
  const query = queryParams.size ? `?${queryParams.toString()}` : "";
  const summary = useApi<AttributionSummary>(`/api/attribution/summary${query}`);
  const conversations = useApi<AttributionConversationsResponse>(
    `/api/attribution/conversations?limit=100${query ? `&${query.slice(1)}` : ""}`,
  );
  const data = summary.data;
  const totals = data?.totals;
  const A = lang === "ar";
  const period = reportingPeriod || (A ? "كل البيانات المسجلة" : "All recorded data");
  const metrics = attributionMetrics(totals, data, A);
  const updateLocalFilter = (key: keyof typeof localFilters, value: string) =>
    setLocalFilters((current) => ({ ...current, [key]: value }));

  const cols: Col<AttributionConversation>[] = [
    {
      key: "conversation",
      header: A ? "المحادثة" : "Conversation",
      always: true,
      sticky: true,
      sortValue: (row) => row.conversation_id,
      render: (row) =>
        row.chatwootUrl ? (
          <a
            className="font-semibold text-brand hover:underline"
            href={row.chatwootUrl}
            target="_blank"
            rel="noreferrer"
          >
            #{row.conversation_id}
          </a>
        ) : (
          `#${row.conversation_id}`
        ),
    },
    {
      key: "channel",
      header: A ? "القناة" : "Channel",
      render: (row) => row.channel || "—",
      sortValue: (row) => row.channel,
    },
    {
      key: "source",
      header: A ? "المصدر" : "Source",
      render: (row) => [row.platform || row.source || "—", row.medium].filter(Boolean).join(" · "),
      sortValue: (row) => `${row.platform}:${row.source}:${row.medium}`,
    },
    {
      key: "campaign",
      header: A ? "الحملة" : "Campaign",
      render: (row) => row.campaign_name || row.campaign_id || "—",
      sortValue: (row) => row.campaign_name || row.campaign_id,
    },
    {
      key: "adset",
      header: A ? "مجموعة الإعلانات" : "Ad Set",
      render: (row) => row.adset_name || row.adset_id || "—",
      sortValue: (row) => row.adset_name || row.adset_id,
    },
    {
      key: "ad",
      header: A ? "الإعلان" : "Ad",
      render: (row) => row.ad_name || row.ad_id || "—",
      sortValue: (row) => row.ad_name || row.ad_id,
    },
    {
      key: "creative",
      header: A ? "المادة الإعلانية" : "Creative",
      render: (row) => row.creative_name || row.creative_id || "—",
      sortValue: (row) => row.creative_name || row.creative_id,
    },
    {
      key: "placement",
      header: A ? "الموضع" : "Placement",
      render: (row) => row.placement || "—",
      sortValue: (row) => row.placement,
    },
    {
      key: "utm",
      header: "UTM",
      render: (row) =>
        [row.utm_source, row.utm_medium, row.utm_campaign, row.utm_content, row.utm_term]
          .filter(Boolean)
          .join(" · ") || "—",
      sortValue: (row) =>
        `${row.utm_source}:${row.utm_medium}:${row.utm_campaign}:${row.utm_content}:${row.utm_term}`,
    },
    {
      key: "method",
      header: A ? "الطريقة" : "Method",
      render: (row) => row.attribution_method || "unknown",
      sortValue: (row) => row.attribution_method,
    },
    {
      key: "branch",
      header: A ? "الفرع" : "Branch",
      render: (row) => row.branch_name || row.branch_id || "—",
      sortValue: (row) => row.branch_name || row.branch_id,
    },
    {
      key: "confidence",
      header: A ? "الثقة" : "Confidence",
      render: (row) => row.confidence || "unknown",
      sortValue: (row) => row.confidence,
    },
    {
      key: "crm",
      header: "CRM",
      render: (row) =>
        row.crm_won
          ? A
            ? "مغلق بنجاح"
            : "Won"
          : row.crm_lost
            ? A
              ? "خسارة"
              : "Lost"
            : row.crm_status || "—",
      sortValue: (row) => `${row.crm_won}:${row.crm_lost}:${row.crm_status}`,
    },
    {
      key: "revenue",
      header: A ? "الإيراد" : "Revenue",
      align: "right",
      render: (row) => fmtUSD(row.revenue),
      sortValue: (row) => row.revenue ?? -1,
    },
  ];

  const campaignCols: Col<AttributionCampaign>[] = [
    {
      key: "platform",
      header: A ? "المنصة" : "Platform",
      always: true,
      render: (row) => row.platform || row.source || "—",
      sortValue: (row) => row.platform || row.source,
    },
    {
      key: "campaign",
      header: A ? "الحملة" : "Campaign",
      render: (row) => row.campaign_name || row.campaign_id || "—",
      sortValue: (row) => row.campaign_name || row.campaign_id,
    },
    {
      key: "adset",
      header: A ? "مجموعة الإعلان" : "Ad Set",
      render: (row) => row.adset_name || row.adset_id || "—",
      sortValue: (row) => row.adset_name || row.adset_id,
    },
    {
      key: "ad",
      header: A ? "الإعلان" : "Ad",
      render: (row) => row.ad_name || row.ad_id || "—",
      sortValue: (row) => row.ad_name || row.ad_id,
    },
    {
      key: "conversations",
      header: A ? "المحادثات" : "Conversations",
      align: "right",
      render: (row) => fmtNum(row.conversations),
      sortValue: (row) => row.conversations,
    },
    {
      key: "spend",
      header: A ? "الصرف المطابق" : "Matched spend",
      align: "right",
      render: (row) => fmtUSD(row.spend),
      sortValue: (row) => row.spend ?? -1,
    },
    {
      key: "cost",
      header: A ? "تكلفة المحادثة" : "Cost / conversation",
      align: "right",
      render: (row) => fmtUSD(row.costPerAttributedConversation),
      sortValue: (row) => row.costPerAttributedConversation ?? -1,
    },
    {
      key: "crm",
      header: "CRM",
      align: "right",
      render: (row) => `${fmtNum(row.crmLeads)} · ${fmtNum(row.won)}W · ${fmtNum(row.lost)}L`,
      sortValue: (row) => row.crmLeads,
    },
    {
      key: "conversion",
      header: A ? "التحويل" : "Conversion",
      align: "right",
      render: (row) => fmtPct(row.conversionRate, 1),
      sortValue: (row) => row.conversionRate ?? -1,
    },
    {
      key: "revenue",
      header: A ? "الإيراد" : "Revenue",
      align: "right",
      render: (row) => fmtUSD(row.revenue),
      sortValue: (row) => row.revenue ?? -1,
    },
    {
      key: "cpa",
      header: "CPA",
      align: "right",
      render: (row) => fmtUSD(row.cpa),
      sortValue: (row) => row.cpa ?? -1,
    },
    {
      key: "roas",
      header: "ROAS",
      align: "right",
      render: (row) => (row.roas === null ? "—" : `${row.roas.toFixed(2)}×`),
      sortValue: (row) => row.roas ?? -1,
    },
  ];

  return (
    <PageSections>
      <DashboardPageHeader
        icon={<MessagesSquare size={22} />}
        title={A ? "إسناد المحادثات متعدد القنوات" : "Multi-channel conversation attribution"}
        subtitle={
          A
            ? "إسناد على مستوى المحادثة من دليل دقيق فقط. تقارير Meta الإجمالية معروضة منفصلة في آخر الصفحة ولا تُحتسب هنا."
            : "Conversation-level attribution from exact evidence only. Meta's aggregate reporting is shown separately at the end and is never counted here."
        }
        period={period}
        tone="violet"
      />

      <PageSection
        title={A ? "فلاتر الإسناد" : "Attribution filters"}
        hint={
          A ? "الحملة والإعلان يُطابقان بالمعرّف الدقيق." : "Campaign and ad filters use exact IDs."
        }
        tone="sky"
      >
        <div className="card grid gap-3 p-3.5 sm:grid-cols-2 sm:p-5 lg:grid-cols-5">
          {(
            [
              ["channel", A ? "القناة" : "Channel", ["", "whatsapp", "messenger", "instagram_dm"]],
              [
                "platform",
                A ? "منصة المصدر" : "Source platform",
                ["", "meta", "facebook", "instagram", "website", "direct_or_unknown"],
              ],
              [
                "method",
                A ? "طريقة الإسناد" : "Method",
                [
                  "",
                  "meta_whatsapp_referral",
                  "meta_messenger_referral",
                  "meta_instagram_referral",
                  "meta_referral",
                  "signed_tracking_token",
                  "utm",
                  "referrer",
                  "inbox_only",
                  "inbox_mapping",
                  "manual",
                  "unknown",
                ],
              ],
              [
                "confidence",
                A ? "الثقة" : "Confidence",
                ["", "exact", "strong", "inferred", "unknown"],
              ],
              [
                "unknownReason",
                A ? "سبب عدم المعرفة" : "Unknown reason",
                [
                  "",
                  "no_paid_referral",
                  "provider_message_unmatched",
                  "meta_source_id_unresolved",
                  "meta_identity_missing",
                  "no_utm",
                  "organic_direct",
                  "unsupported_channel",
                  "historical_evidence_missing",
                  "chatwoot_payload_missing",
                ],
              ],
            ] as const
          ).map(([key, label, options]) => (
            <label key={key} className="grid gap-1 text-xs font-semibold text-text-muted">
              {label}
              <select
                value={localFilters[key]}
                onChange={(event) => updateLocalFilter(key, event.target.value)}
                className="min-h-10 rounded-xl border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand"
              >
                {options.map((option) => (
                  <option key={option || "all"} value={option}>
                    {option || (A ? "الكل" : "All")}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {(
            [
              ["campaignId", A ? "معرّف الحملة" : "Campaign ID"],
              ["adsetId", A ? "معرّف مجموعة الإعلان" : "Ad Set ID"],
              ["adId", A ? "معرّف الإعلان" : "Ad ID"],
              ["source", A ? "المصدر" : "Source"],
              ["medium", A ? "الوسيط" : "Medium"],
              ["inboxId", "Inbox ID"],
              ["branchId", A ? "معرّف الفرع" : "Branch ID"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="grid gap-1 text-xs font-semibold text-text-muted">
              {label}
              <input
                value={localFilters[key]}
                onChange={(event) => updateLocalFilter(key, event.target.value.trim())}
                inputMode={key.endsWith("Id") ? "numeric" : "text"}
                className="min-h-10 rounded-xl border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand"
                placeholder={A ? "الكل" : "All"}
              />
            </label>
          ))}
        </div>
      </PageSection>

      <PageSection level="headline" aria-label={A ? "مؤشرات الإسناد" : "Attribution metrics"}>
        <KpiRow>
          <MetricDetailTrigger
            detail={metrics.conversations}
            card={{
              index: 0,
              sub: A ? "كل المحادثات المسجلة" : "All recorded conversations",
              loading: summary.isLoading,
            }}
          />
          <MetricDetailTrigger
            detail={metrics.attributed}
            card={{
              index: 1,
              sub: A ? "تشمل CTWA وUTM والتوكن" : "CTWA, UTM, and tracking tokens",
              loading: summary.isLoading,
            }}
          />
          <MetricDetailTrigger
            detail={metrics.paidCampaigns}
            card={{
              index: 2,
              sub: A ? "معرّف حملة Meta مُثبت" : "Resolved Meta campaign ID",
              loading: summary.isLoading,
            }}
          />
          <MetricDetailTrigger
            detail={metrics.organicDirect}
            card={{
              index: 3,
              sub: A ? "قناة معروفة دون إحالة مدفوعة" : "Known channel, no paid referral",
              loading: summary.isLoading,
            }}
          />
          <MetricDetailTrigger
            detail={metrics.ctwa}
            card={{
              index: 4,
              sub: A ? "إحالات Meta الأصلية" : "Native Meta referrals",
              loading: summary.isLoading,
            }}
          />
          <MetricDetailTrigger
            detail={metrics.unknownRate}
            card={{
              index: 5,
              sub: A ? "حالة قابلة للقياس وليست أورجانيك" : "Measured, not silently called organic",
              loading: summary.isLoading,
            }}
          />
          <MetricDetailTrigger
            detail={metrics.crmMatched}
            card={{
              index: 4,
              sub: A ? `مغلق بنجاح: ${fmtNum(totals?.won)}` : `Won: ${fmtNum(totals?.won)}`,
              loading: summary.isLoading,
            }}
          />
          <MetricDetailTrigger
            detail={metrics.spend}
            card={{
              index: 5,
              sub: totals?.spendAvailable
                ? A
                  ? "بمعرّف حملة Meta دقيق"
                  : "Exact Meta campaign-ID join"
                : A
                  ? "غير متاح بلا تطابق دقيق"
                  : "Unavailable without an exact join",
              loading: summary.isLoading,
            }}
          />
          <MetricDetailTrigger
            detail={metrics.cpl}
            card={{
              index: 6,
              sub: totals?.spendAvailable
                ? A
                  ? `تغطية: ${fmtNum(totals.spendCoveredConversations)} محادثة`
                  : `Coverage: ${fmtNum(totals.spendCoveredConversations)} conversations`
                : A
                  ? "لا يُقدّر من أسماء الحملات"
                  : "Never estimated from names",
              loading: summary.isLoading,
            }}
          />
          <MetricDetailTrigger
            detail={metrics.cpa}
            card={{
              index: 7,
              sub: A ? "الصرف المطابق ÷ فرص CRM المغلقة" : "Matched spend ÷ CRM-won conversations",
              loading: summary.isLoading,
            }}
          />
          <MetricDetailTrigger
            detail={metrics.roas}
            card={{
              index: 8,
              sub: A ? "إيراد المحادثات المطابقة ÷ الصرف" : "Covered conversation revenue ÷ spend",
              loading: summary.isLoading,
            }}
          />
        </KpiRow>
      </PageSection>

      <PageSection
        title={A ? "المحادثات حسب الحملة" : "Conversations by campaign"}
        hint={
          A
            ? "الإسناد يعرض المصدر والحملة الفعلية فقط عندما تكون الأدلة موجودة."
            : "Only evidence-backed source and campaign values are shown."
        }
        icon={<BarChart3 size={16} />}
        tone="violet"
      >
        <div className="card p-3.5 sm:p-5">
          <HBarChart
            data={(data?.campaigns || []).slice(0, 10).map((row) => ({
              label:
                row.campaign_name || row.campaign_id || row.source || (A ? "غير معروف" : "Unknown"),
              value: row.conversations,
            }))}
            format={fmtNum}
            name={A ? "المحادثات" : "Conversations"}
            color="var(--chart-4)"
            showValues
          />
        </div>
        <DataTable
          rows={data?.campaigns || []}
          cols={campaignCols}
          loading={summary.isLoading}
          searchable={(row) =>
            `${row.platform} ${row.campaign_name} ${row.campaign_id} ${row.adset_name} ${row.adset_id} ${row.ad_name} ${row.ad_id}`
          }
          csvFilename="engosoft-attribution-campaign-drilldown.csv"
          rowKey={(row) =>
            `${row.platform}:${row.source}:${row.medium}:${row.campaign_id}:${row.adset_id}:${row.ad_id}`
          }
        />
      </PageSection>

      <PageSection
        title={A ? "اتجاه جودة الإسناد" : "Attribution quality trend"}
        hint={
          A
            ? "المحادثات اليومية مقابل الحالات التي ظل مصدرها غير معروف."
            : "Daily conversations against those whose source remained unknown."
        }
        icon={<ShieldCheck size={16} />}
        tone="sky"
      >
        <div className="card p-3.5 sm:p-5">
          <MultiLineChart
            data={(data?.trend || []).map((row) => ({
              date: row.date,
              conversations: row.conversations,
              unknown: row.unknownConversations,
            }))}
            series={[
              {
                key: "conversations",
                name: A ? "كل المحادثات" : "All conversations",
                color: "var(--sky-strong)",
              },
              {
                key: "unknown",
                name: A ? "غير معروف" : "Unknown",
                color: "var(--rose-strong)",
              },
            ]}
            format={fmtNum}
          />
        </div>
      </PageSection>

      <PageSection
        title={A ? "المصدر والفرع" : "Source and branch"}
        hint={
          A
            ? "الفرع يظهر فقط من خريطة inbox/رقم معتمدة أو من توكن تتبع موثوق."
            : "Branch appears only from an approved inbox/number map or trusted tracking token."
        }
        icon={<BarChart3 size={16} />}
        tone="mint"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-3.5 sm:p-5">
            <h3 className="mb-3 text-sm font-semibold text-text">
              {A ? "المحادثات حسب المصدر" : "Conversations by source"}
            </h3>
            <HBarChart
              data={(data?.sources || []).slice(0, 10).map((row) => ({
                label:
                  [row.platform, "→", row.channel, row.medium].filter(Boolean).join(" ") ||
                  (A ? "غير معروف" : "Unknown"),
                value: row.conversations,
              }))}
              height={240}
              format={fmtNum}
              name={A ? "المحادثات" : "Conversations"}
              color="var(--chart-2)"
              showValues
            />
          </div>
          <div className="card p-3.5 sm:p-5">
            <h3 className="mb-3 text-sm font-semibold text-text">
              {A ? "المحادثات حسب الفرع" : "Conversations by branch"}
            </h3>
            <HBarChart
              data={(data?.branches || []).slice(0, 10).map((row) => ({
                label: row.branch_name || row.branch_id || (A ? "غير معروف" : "Unknown"),
                value: row.conversations,
              }))}
              height={240}
              format={fmtNum}
              name={A ? "المحادثات" : "Conversations"}
              color="var(--chart-3)"
              showValues
            />
          </div>
        </div>
      </PageSection>

      <PageSection
        title={A ? "مسار المحادثة إلى البيع" : "Conversation-to-sale funnel"}
        hint={
          A
            ? "كل مرحلة مبنية على سجل الإسناد وربط CRM الفعلي."
            : "Every stage is based on the attribution record and actual CRM match."
        }
        icon={<Target size={16} />}
        tone="amber"
      >
        <div className="card p-3.5 sm:p-5">
          <FunnelBars
            steps={[
              {
                label: A ? "المحادثات" : "Conversations",
                value: totals?.conversations || 0,
                display: fmtNum(totals?.conversations),
              },
              {
                label: A ? "منسوبة بدليل" : "Evidence-attributed",
                value: totals?.attributedConversations || 0,
                display: fmtNum(totals?.attributedConversations),
              },
              {
                label: A ? "مطابقة مع CRM" : "CRM matched",
                value: totals?.crmMatched || 0,
                display: fmtNum(totals?.crmMatched),
              },
              {
                label: A ? "مغلق بنجاح" : "Won",
                value: totals?.won || 0,
                display: fmtNum(totals?.won),
              },
            ]}
          />
        </div>
      </PageSection>

      <PageSection
        level="records"
        title={A ? "تفاصيل المحادثات" : "Conversation details"}
        hint={
          A
            ? "افتح المحادثة في Chatwoot لمراجعة الدليل والسياق."
            : "Open Chatwoot to review the supporting evidence and context."
        }
      >
        <DataTable
          rows={conversations.data?.rows || []}
          cols={cols}
          loading={conversations.isLoading}
          searchable={(row) =>
            `${row.conversation_id} ${row.channel} ${row.platform} ${row.source} ${row.campaign_name} ${row.campaign_id} ${row.adset_name} ${row.adset_id} ${row.ad_name} ${row.ad_id} ${row.creative_name} ${row.creative_id} ${row.placement} ${row.utm_source} ${row.utm_medium} ${row.utm_campaign} ${row.utm_content} ${row.utm_term} ${row.unknown_reason} ${row.branch_name}`
          }
          csvFilename="engosoft-conversation-attribution.csv"
          rowKey={(row) => String(row.conversation_id)}
          truncatedNote={
            conversations.data && conversations.data.total > conversations.data.rows.length
              ? A
                ? `يعرض أول ${conversations.data.rows.length} من ${conversations.data.total} محادثة.`
                : `Showing the first ${conversations.data.rows.length} of ${conversations.data.total} conversations.`
              : undefined
          }
        />
      </PageSection>

      <MetaDestinationMixSection />
    </PageSections>
  );
}
