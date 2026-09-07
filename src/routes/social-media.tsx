import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  AtSign,
  BadgeCheck,
  Clock3,
  DollarSign,
  Inbox,
  MessageCircleMore,
  MessagesSquare,
  MousePointerClick,
  Radio,
  UserRoundCheck,
  Users,
} from "lucide-react";
import {
  Card,
  ErrorState,
  KpiCard,
  Notice,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { DashboardPageHeader, InsightRow, KpiRow } from "@/components/dashboard-bits";
import { InsightDetailTrigger, MetricDetailTrigger } from "@/components/metric-detail";
import { topRows, type MetricDetail } from "@/lib/metric-detail";
import { useReportingPeriod } from "@/lib/use-reporting-period";
import { fmtNum, fmtPct, fmtUSDFull, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { AgentAnalyticsResult } from "@/lib/agent-analytics.server";
import type { Platform } from "@/lib/types";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";

export const Route = createFileRoute("/social-media")({ component: SocialMedia });

interface PaidChannel {
  platform: Platform;
  rows: number;
  spend: number;
  impressions: number;
  clicksAll: number;
  platformLeads: number | null;
  ctrAll: number | null;
  platformCpl: number | null;
}

interface AdsResponse {
  byPlatform: PaidChannel[];
}

interface OrganicSource {
  key: string;
  name: string;
  leads: number;
  won: number;
  lost: number;
  conversionRate: number | null;
  revenue: number;
}

interface OrganicResponse {
  sources: OrganicSource[];
}

const PLATFORM_LABEL: Record<string, string> = {
  meta: "Meta",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  google: "Google Ads",
};

function duration(seconds: number | null, lang: "ar" | "en") {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)} ${lang === "ar" ? "ث" : "sec"}`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} ${lang === "ar" ? "د" : "min"}`;
  return `${(seconds / 3600).toFixed(1)} ${lang === "ar" ? "س" : "hr"}`;
}

/**
 * The five social figures, and where each one comes from.
 *
 * PAID AND NON-PAID ARE NEVER ADDED TOGETHER HERE. Reach, clicks and CTR are
 * what the ad platforms reported; leads and revenue are what arrived through
 * sources that carry no media cost. Mixing them would produce a "social ROAS"
 * with a numerator and a denominator from different populations.
 */
function socialMetrics(
  reach: {
    impressions: number;
    clicks: number;
    paidResults: number;
    ctr: number | null;
    best: PaidChannel | null;
  },
  channels: PaidChannel[],
  organicTotals: { leads: number; won: number; revenue: number; top: OrganicSource | null },
  organicSources: OrganicSource[],
  lang: "ar" | "en",
): Record<string, MetricDetail> {
  const A = lang === "ar";
  const byPlatform = (pick: (row: PaidChannel) => number, format: (n: number) => string) =>
    topRows(
      channels.map((channel) => ({
        key: channel.platform,
        label: PLATFORM_LABEL[channel.platform] ?? channel.platform,
        value: pick(channel),
        display: format(pick(channel)),
        meta: `${fmtNum(channel.rows)} ${A ? "صف" : "rows"}`,
        tone: "sky" as const,
      })),
    );
  const bySource = (pick: (row: OrganicSource) => number, format: (n: number) => string) =>
    topRows(
      organicSources.map((source) => ({
        key: source.key,
        label: source.name,
        value: pick(source),
        display: format(pick(source)),
        meta: `${fmtNum(source.leads)} ${A ? "ليد" : "leads"}`,
        tone: "mint" as const,
      })),
    );

  const paidNote = A
    ? "هذا رقم مدفوع بالكامل: ما أبلغت عنه منصات الإعلان. لا يُجمع مع أرقام المصادر غير المدفوعة أسفله."
    : "This is entirely a paid figure — what the ad platforms reported. It is never added to the non-paid figures beside it.";
  const organicNote = A
    ? "هذا رقم غير مدفوع بالكامل: لا يُنسب إليه أي إنفاق إعلاني، ولذلك لا يوجد عائد على الإنفاق لهذه المصادر."
    : "This is entirely a non-paid figure: no ad spend is attributed to it, so there is no return-on-spend for these sources.";

  return {
    reach: {
      id: "social_media.reach",
      title: A ? "الظهور" : "Reach",
      value: fmtNum(reach.impressions),
      tone: "sky",
      icon: <Radio size={16} />,
      definition: A
        ? "إجمالي مرات ظهور الإعلانات التي أبلغت عنها المنصات في الفترة."
        : "Total ad impressions reported by the platforms in the period.",
      caveat: paidNote,
      formula: A
        ? `${fmtNum(reach.impressions)} ظهور و${fmtNum(reach.clicks)} نقرة = ${fmtPct(reach.ctr, 2)} نسبة نقر.`
        : `${fmtNum(reach.impressions)} impressions and ${fmtNum(reach.clicks)} clicks = ${fmtPct(reach.ctr, 2)} click-through.`,
      supporting: [
        { key: "clicks", label: A ? "النقرات" : "Clicks", value: fmtNum(reach.clicks) },
        { key: "ctr", label: A ? "نسبة النقر" : "CTR", value: fmtPct(reach.ctr, 2) },
        {
          key: "results",
          label: A ? "نتائج المنصات" : "Platform results",
          value: fmtNum(reach.paidResults),
        },
        {
          key: "platforms",
          label: A ? "المنصات النشطة" : "Active platforms",
          value: fmtNum(channels.length),
        },
      ],
      breakdowns: [
        {
          id: "platforms",
          title: A ? "الظهور حسب المنصة" : "Impressions by platform",
          rows: byPlatform((channel) => channel.impressions, fmtNum),
          emptyLabel: A ? "لا توجد منصات نشطة" : "No active platform",
        },
      ],
      report: { to: "/ads", label: A ? "فتح تقرير الإعلانات" : "Open the ads report" },
    },
    clicks: {
      id: "social_media.clicks",
      title: A ? "النقرات" : "Clicks",
      value: fmtNum(reach.clicks),
      tone: "violet",
      icon: <MousePointerClick size={16} />,
      definition: A
        ? "كل النقرات التي أبلغت عنها المنصات، بما فيها النقرات التي لم تفتح رابطًا."
        : "Every click the platforms reported, including clicks that did not open a link.",
      caveat: paidNote,
      formula: `${fmtNum(reach.clicks)} ÷ ${fmtNum(reach.impressions)} = ${fmtPct(reach.ctr, 2)}`,
      supporting: [
        {
          key: "impressions",
          label: A ? "الظهور" : "Impressions",
          value: fmtNum(reach.impressions),
        },
        { key: "ctr", label: A ? "نسبة النقر" : "CTR", value: fmtPct(reach.ctr, 2) },
        {
          key: "results",
          label: A ? "نتائج المنصات" : "Platform results",
          value: fmtNum(reach.paidResults),
        },
        {
          key: "best",
          label: A ? "أعلى منصة ظهورًا" : "Top platform by reach",
          value: reach.best ? (PLATFORM_LABEL[reach.best.platform] ?? reach.best.platform) : "—",
        },
      ],
      breakdowns: [
        {
          id: "platforms",
          title: A ? "النقرات حسب المنصة" : "Clicks by platform",
          rows: byPlatform((channel) => channel.clicksAll, fmtNum),
          emptyLabel: A ? "لا توجد منصات نشطة" : "No active platform",
        },
      ],
      report: { to: "/ads", label: A ? "فتح تقرير الإعلانات" : "Open the ads report" },
    },
    ctr: {
      id: "social_media.ctr",
      title: A ? "نسبة النقر" : "Click-through rate",
      value: fmtPct(reach.ctr, 2),
      tone: "amber",
      icon: <BadgeCheck size={16} />,
      definition: A
        ? "نسبة من رأى الإعلان ثم نقر عليه. تقيس جاذبية المحتوى، لا جودة الليد."
        : "The share of people who saw an ad and clicked it. It measures how compelling the content is, not lead quality.",
      caveat: paidNote,
      formula: `${fmtNum(reach.clicks)} ÷ ${fmtNum(reach.impressions)} = ${fmtPct(reach.ctr, 2)}`,
      supporting: [
        {
          key: "clicks",
          label: A ? "البسط · النقرات" : "Numerator · clicks",
          value: fmtNum(reach.clicks),
        },
        {
          key: "impressions",
          label: A ? "المقام · الظهور" : "Denominator · impressions",
          value: fmtNum(reach.impressions),
        },
        {
          key: "results",
          label: A ? "نتائج المنصات" : "Platform results",
          value: fmtNum(reach.paidResults),
        },
        {
          key: "platforms",
          label: A ? "المنصات النشطة" : "Active platforms",
          value: fmtNum(channels.length),
        },
      ],
      breakdowns: [
        {
          id: "platforms",
          title: A ? "نسبة النقر حسب المنصة" : "CTR by platform",
          rows: byPlatform(
            (channel) => channel.ctrAll ?? 0,
            (n) => fmtPct(n, 2),
          ),
          emptyLabel: A ? "لا توجد منصات نشطة" : "No active platform",
        },
      ],
    },
    organicLeads: {
      id: "social_media.organicLeads",
      title: A ? "العملاء من المصادر غير المدفوعة" : "Leads from non-paid sources",
      value: fmtNum(organicTotals.leads),
      tone: "mint",
      icon: <Users size={16} />,
      definition: A
        ? "العملاء الذين وصلوا عبر قنوات لا يُنسب إليها إنفاق إعلاني: واتساب، الموقع، الترشيحات وما شابه."
        : "Leads that arrived through channels with no attributed ad spend: WhatsApp, the website, referrals and the like.",
      caveat: organicNote,
      formula: A
        ? `${fmtNum(organicTotals.won)} من ${fmtNum(organicTotals.leads)} أُغلقت رابحة.`
        : `${fmtNum(organicTotals.won)} of ${fmtNum(organicTotals.leads)} closed as won.`,
      supporting: [
        { key: "won", label: A ? "صفقات مغلقة" : "Closed won", value: fmtNum(organicTotals.won) },
        {
          key: "revenue",
          label: A ? "الإيراد" : "Revenue",
          value: fmtUSDFull(organicTotals.revenue),
        },
        {
          key: "top",
          label: A ? "أعلى مصدر" : "Top source",
          value: organicTotals.top?.name ?? "—",
        },
        {
          key: "sources",
          label: A ? "عدد المصادر" : "Sources",
          value: fmtNum(organicSources.length),
        },
      ],
      breakdowns: [
        {
          id: "sources",
          title: A ? "العملاء حسب المصدر" : "Leads by source",
          rows: bySource((source) => source.leads, fmtNum),
          emptyLabel: A ? "لا توجد مصادر غير مدفوعة" : "No non-paid source",
        },
      ],
      report: { to: "/organic", label: A ? "فتح تقرير الأورجانيك" : "Open the organic report" },
    },
    organicRevenue: {
      id: "social_media.organicRevenue",
      title: A ? "إيراد المصادر غير المدفوعة" : "Non-paid revenue",
      value: fmtUSDFull(organicTotals.revenue),
      tone: "mint",
      icon: <DollarSign size={16} />,
      definition: A
        ? "الإيراد المحصّل من العملاء الذين وصلوا عبر قنوات غير مدفوعة داخل الفترة."
        : "Revenue collected from leads that arrived through non-paid channels inside the period.",
      caveat: organicNote,
      formula: A
        ? `${fmtUSDFull(organicTotals.revenue)} من ${fmtNum(organicTotals.won)} صفقة مغلقة.`
        : `${fmtUSDFull(organicTotals.revenue)} from ${fmtNum(organicTotals.won)} closed deals.`,
      supporting: [
        { key: "leads", label: A ? "العملاء" : "Leads", value: fmtNum(organicTotals.leads) },
        { key: "won", label: A ? "صفقات مغلقة" : "Closed won", value: fmtNum(organicTotals.won) },
        {
          key: "perLead",
          label: A ? "الإيراد لكل ليد" : "Revenue per lead",
          value:
            organicTotals.leads > 0 ? fmtUSDFull(organicTotals.revenue / organicTotals.leads) : "—",
        },
        {
          key: "top",
          label: A ? "أعلى مصدر" : "Top source",
          value: organicTotals.top?.name ?? "—",
        },
      ],
      breakdowns: [
        {
          id: "sources",
          title: A ? "الإيراد حسب المصدر" : "Revenue by source",
          rows: bySource((source) => source.revenue, fmtUSDFull),
          emptyLabel: A ? "لا توجد مصادر غير مدفوعة" : "No non-paid source",
        },
      ],
      report: { to: "/organic", label: A ? "فتح تقرير الأورجانيك" : "Open the organic report" },
    },
  };
}

/**
 * The three readings of the period, and the figures each verdict rests on.
 *
 * A reading is a claim — "Meta reached the most people", "eleven customers are
 * still waiting" — and a claim nobody can open is one the reader has to take on
 * trust. Each of these carries the ranking, the counts and the people behind
 * the sentence on the card, so the judgement can be checked.
 */
function socialInsights(
  reach: { best: PaidChannel | null; impressions: number; clicks: number; ctr: number | null },
  channels: PaidChannel[],
  organicTotals: { leads: number; won: number; revenue: number; top: OrganicSource | null },
  organicSources: OrganicSource[],
  care: {
    awaitingReply: number;
    openConversations: number;
    moderators: AgentAnalyticsResult["agents"];
    ok: boolean;
  },
  lang: "ar" | "en",
): Record<string, MetricDetail> {
  const A = lang === "ar";
  const best = reach.best;

  return {
    topPlatform: {
      id: "social_media.topPlatform",
      title: A ? "أفضل منصة ظهورًا" : "Top platform by reach",
      value: best ? (PLATFORM_LABEL[best.platform] ?? best.platform) : "—",
      tone: "mint",
      icon: <Radio size={16} />,
      entity: best ? { type: "platform", id: best.platform, name: best.platform } : null,
      definition: A
        ? "المنصة التي أبلغت عن أكبر عدد مرات ظهور في الفترة. الترتيب بالظهور وحده، لا بالنتائج."
        : "The platform that reported the most impressions in the period. The ranking is by reach alone, not by results.",
      formula: best
        ? A
          ? `${fmtNum(best.impressions)} ظهور من إجمالي ${fmtNum(reach.impressions)} في الفترة.`
          : `${fmtNum(best.impressions)} impressions out of ${fmtNum(reach.impressions)} in the period.`
        : undefined,
      caveat: A
        ? "الظهور لا يعني نتائج: راجع النقرات وتكلفة الليد قبل نقل ميزانية إلى هذه المنصة."
        : "Reach is not results: check clicks and cost per lead before moving budget onto this platform.",
      supporting: best
        ? [
            {
              key: "impressions",
              label: A ? "الظهور" : "Impressions",
              value: fmtNum(best.impressions),
            },
            { key: "clicks", label: A ? "النقرات" : "Clicks", value: fmtNum(best.clicksAll) },
            { key: "ctr", label: A ? "نسبة النقر" : "CTR", value: fmtPct(best.ctrAll, 2) },
            {
              key: "share",
              label: A ? "حصتها من الظهور" : "Share of reach",
              value: fmtPct(
                reach.impressions > 0 ? (best.impressions / reach.impressions) * 100 : null,
                1,
              ),
            },
          ]
        : undefined,
      breakdowns: [
        {
          id: "platforms",
          title: A ? "الظهور حسب المنصة" : "Impressions by platform",
          hint: A
            ? "هذا هو الترتيب الذي اختار المنصة أعلاه."
            : "This is the ranking that named the platform above.",
          rows: topRows(
            channels.map((channel) => ({
              key: channel.platform,
              label: PLATFORM_LABEL[channel.platform] ?? channel.platform,
              value: channel.impressions,
              display: fmtNum(channel.impressions),
              meta: `${fmtNum(channel.clicksAll)} ${A ? "نقرة" : "clicks"}`,
              tone: "sky" as const,
            })),
          ),
          emptyLabel: A ? "لا توجد منصة سجّلت ظهورًا" : "No platform recorded reach",
        },
      ],
      report: { to: "/ads", label: A ? "فتح تقرير الإعلانات" : "Open the ads report" },
    },

    topOrganic: {
      id: "social_media.topOrganic",
      title: A ? "أكبر مصدر غير مدفوع" : "Largest non-paid source",
      value: organicTotals.top ? organicTotals.top.name : "—",
      tone: "cyan",
      icon: <AtSign size={16} />,
      entity: organicTotals.top
        ? { type: "source", id: organicTotals.top.key, name: organicTotals.top.name }
        : null,
      definition: A
        ? "المصدر غير المدفوع الذي جاء منه أكبر عدد عملاء محتملين في الفترة. لا يُنسب إليه أي إنفاق إعلاني."
        : "The non-paid source that produced the most leads in the period. No ad spend is attributed to it.",
      formula: organicTotals.top
        ? A
          ? `${fmtNum(organicTotals.top.leads)} ليد من إجمالي ${fmtNum(organicTotals.leads)} ليد غير مدفوع.`
          : `${fmtNum(organicTotals.top.leads)} leads out of ${fmtNum(organicTotals.leads)} non-paid leads.`
        : undefined,
      supporting: organicTotals.top
        ? [
            { key: "leads", label: A ? "الليدز" : "Leads", value: fmtNum(organicTotals.top.leads) },
            { key: "won", label: A ? "الصفقات" : "Won", value: fmtNum(organicTotals.top.won) },
            {
              key: "conversion",
              label: A ? "نسبة الإغلاق" : "Conversion",
              value: fmtPct(organicTotals.top.conversionRate, 1),
            },
            {
              key: "revenue",
              label: A ? "الإيراد" : "Revenue",
              value: fmtUSDFull(organicTotals.top.revenue),
            },
          ]
        : undefined,
      breakdowns: [
        {
          id: "sources",
          title: A ? "الليدز حسب المصدر" : "Leads by source",
          rows: topRows(
            organicSources.map((source) => ({
              key: source.key,
              label: source.name,
              value: source.leads,
              display: fmtNum(source.leads),
              meta: `${fmtNum(source.won)} ${A ? "صفقة" : "won"}`,
              tone: "mint" as const,
            })),
          ),
          moreTo: "/organic",
          moreLabel: A ? "فتح تقرير الأورجانيك" : "Open the Organic report",
          emptyLabel: A ? "لا توجد مصادر غير مدفوعة" : "No non-paid sources",
        },
      ],
      report: { to: "/organic", label: A ? "فتح تقرير الأورجانيك" : "Open the Organic report" },
    },

    responseSpeed: {
      id: "social_media.responseSpeed",
      title: A ? "عملاء ينتظرون ردًا" : "Customers waiting for a reply",
      value: fmtNum(care.awaitingReply),
      tone: care.awaitingReply > 0 ? "rose" : "mint",
      icon: <Clock3 size={16} />,
      definition: A
        ? "عدد المحادثات المفتوحة التي آخر رسالة فيها من العميل ولم يُرد عليها بعد، مجموعة من موظفي الموديريشن."
        : "Open conversations whose last message came from the customer and has not been answered yet, summed across the moderation team.",
      formula: A
        ? `${fmtNum(care.awaitingReply)} تنتظر ردًا من إجمالي ${fmtNum(care.openConversations)} محادثة مفتوحة.`
        : `${fmtNum(care.awaitingReply)} awaiting a reply out of ${fmtNum(care.openConversations)} open conversations.`,
      caveat: care.ok
        ? undefined
        : A
          ? "مصدر المحادثات غير متاح حاليًا، فهذه القراءة قد تكون ناقصة."
          : "The conversation source is unavailable, so this reading may be incomplete.",
      supporting: [
        {
          key: "open",
          label: A ? "محادثات مفتوحة" : "Open conversations",
          value: fmtNum(care.openConversations),
        },
        {
          key: "people",
          label: A ? "موظفو الموديريشن" : "Moderators",
          value: fmtNum(care.moderators.length),
        },
        {
          key: "share",
          label: A ? "نسبة المنتظر" : "Share awaiting",
          value: fmtPct(
            care.openConversations > 0 ? (care.awaitingReply / care.openConversations) * 100 : null,
            1,
          ),
        },
      ],
      breakdowns: [
        {
          id: "moderators",
          title: A ? "الانتظار حسب الموظف" : "Awaiting a reply, by person",
          hint: A
            ? "من عنده أكبر عدد محادثات لم يُرد عليها الآن."
            : "Who is carrying the most unanswered conversations right now.",
          rows: topRows(
            care.moderators.map((agent) => ({
              key: agent.key,
              label: agent.displayName || agent.name,
              value: agent.chatAwaitingReply ?? 0,
              display: fmtNum(agent.chatAwaitingReply ?? 0),
              meta: `${fmtNum(agent.chatOpenConversations ?? 0)} ${A ? "مفتوحة" : "open"}`,
              tone: "rose" as const,
            })),
          ),
          emptyLabel: A ? "لا أحد ينتظر ردًا الآن" : "Nobody is waiting for a reply",
        },
      ],
      report: { to: "/teams", label: A ? "فتح تقرير الفرق" : "Open the teams report" },
    },
  };
}

/**
 * The moderation figures, and what each one is counting.
 *
 * Six numbers that all come from the same Chatwoot snapshot and all mean
 * different things: a conversation the team handled, one it closed, one still
 * waiting on us, one still open, one nobody owns, and how long the first reply
 * took. Written out because "Open now" and "Awaiting reply" look like the same
 * figure on a card and are not — one is workload, the other is a queue of
 * people who have already been kept waiting.
 */
function careMetrics(
  /* Partial because the row renders while `/api/teams` is still in flight, and
     an absent count has to read as "—" rather than as a zero the team could
     act on. */
  summary: Partial<AgentAnalyticsResult["summary"]>,
  unassigned: number | null,
  moderators: AgentAnalyticsResult["agents"],
  lang: "ar" | "en",
): Record<string, MetricDetail> {
  const A = lang === "ar";
  const byAgent = (
    pick: (agent: AgentAnalyticsResult["agents"][number]) => number | null,
    format: (n: number) => string,
    tone: "cyan" | "mint" | "rose" | "amber",
  ) =>
    topRows(
      moderators.map((agent) => ({
        key: agent.key,
        label: agent.displayName || agent.name,
        value: pick(agent) ?? 0,
        display: format(pick(agent) ?? 0),
        meta: `${fmtNum(agent.chatConversations ?? 0)} ${A ? "محادثة" : "conversations"}`,
        tone,
      })),
    );
  const report: MetricDetail["report"] = {
    to: "/teams",
    label: A ? "فتح تقرير الفرق" : "Open the teams report",
  };
  const people = {
    key: "people",
    label: A ? "موظفو الموديريشن" : "Moderators",
    value: fmtNum(moderators.length),
  };

  return {
    conversations: {
      id: "social_media.chatConversations",
      title: A ? "المحادثات" : "Conversations",
      value: fmtNum(summary.chatConversations),
      tone: "cyan",
      icon: <MessageCircleMore size={16} />,
      definition: A
        ? "كل محادثة Chatwoot لمسها فريق الموديريشن في الفترة، مفتوحة كانت أو مغلقة."
        : "Every Chatwoot conversation the moderation team touched in the period, open or closed.",
      supporting: [
        { key: "resolved", label: A ? "تم حلها" : "Resolved", value: fmtNum(summary.chatResolved) },
        {
          key: "open",
          label: A ? "مفتوحة الآن" : "Open now",
          value: fmtNum(summary.chatOpenConversations),
        },
        {
          key: "resolveRate",
          label: A ? "نسبة الحل" : "Resolved share",
          value: fmtPct(
            (summary.chatConversations ?? 0) > 0
              ? ((summary.chatResolved ?? 0) / (summary.chatConversations ?? 1)) * 100
              : null,
            1,
          ),
        },
        people,
      ],
      breakdowns: [
        {
          id: "agents",
          title: A ? "المحادثات حسب الموظف" : "Conversations by person",
          rows: byAgent((agent) => agent.chatConversations, fmtNum, "cyan"),
          emptyLabel: A ? "لا توجد محادثات في الفترة" : "No conversations in this period",
        },
      ],
      report,
    },

    resolved: {
      id: "social_media.chatResolved",
      title: A ? "تم حلها" : "Resolved",
      value: fmtNum(summary.chatResolved),
      tone: "mint",
      icon: <BadgeCheck size={16} />,
      definition: A
        ? "المحادثات التي أُغلقت بحالة «تم الحل» في الفترة."
        : "Conversations closed as resolved during the period.",
      formula: A
        ? `${fmtNum(summary.chatResolved)} ÷ ${fmtNum(summary.chatConversations)} من المحادثات.`
        : `${fmtNum(summary.chatResolved)} ÷ ${fmtNum(summary.chatConversations)} conversations.`,
      supporting: [
        {
          key: "conversations",
          label: A ? "إجمالي المحادثات" : "All conversations",
          value: fmtNum(summary.chatConversations),
        },
        {
          key: "rate",
          label: A ? "نسبة الحل" : "Resolved share",
          value: fmtPct(
            (summary.chatConversations ?? 0) > 0
              ? ((summary.chatResolved ?? 0) / (summary.chatConversations ?? 1)) * 100
              : null,
            1,
          ),
        },
        {
          key: "open",
          label: A ? "ما زالت مفتوحة" : "Still open",
          value: fmtNum(summary.chatOpenConversations),
        },
        people,
      ],
      breakdowns: [
        {
          id: "agents",
          title: A ? "الحل حسب الموظف" : "Resolved by person",
          rows: byAgent((agent) => agent.chatResolved, fmtNum, "mint"),
          emptyLabel: A ? "لم تُحل أي محادثة في الفترة" : "Nothing was resolved in this period",
        },
      ],
      report,
    },

    awaiting: {
      id: "social_media.chatAwaitingReply",
      title: A ? "تنتظر رد" : "Awaiting reply",
      value: fmtNum(summary.chatAwaitingReply),
      tone: "rose",
      icon: <Clock3 size={16} />,
      deltaInvert: true,
      definition: A
        ? "محادثات مفتوحة آخر رسالة فيها من العميل ولم يُرد عليها بعد. هذه ليست عبء العمل، بل طابور انتظار."
        : "Open conversations whose last message came from the customer and is still unanswered. This is not workload, it is a queue of people already kept waiting.",
      caveat: A
        ? "الرقم لحظي: يقرأ حالة Chatwoot الآن، لا مجموع الفترة."
        : "This is a live figure: it reads Chatwoot's state now, not a total for the period.",
      supporting: [
        {
          key: "open",
          label: A ? "مفتوحة الآن" : "Open now",
          value: fmtNum(summary.chatOpenConversations),
        },
        {
          key: "share",
          label: A ? "نسبة المنتظر" : "Share awaiting",
          value: fmtPct(
            (summary.chatOpenConversations ?? 0) > 0
              ? ((summary.chatAwaitingReply ?? 0) / (summary.chatOpenConversations ?? 1)) * 100
              : null,
            1,
          ),
        },
        {
          key: "unassigned",
          label: A ? "بدون موظف" : "Unassigned",
          value: fmtNum(unassigned),
        },
        people,
      ],
      breakdowns: [
        {
          id: "agents",
          title: A ? "الانتظار حسب الموظف" : "Awaiting a reply, by person",
          rows: byAgent((agent) => agent.chatAwaitingReply, fmtNum, "rose"),
          emptyLabel: A ? "لا أحد ينتظر ردًا الآن" : "Nobody is waiting for a reply",
        },
      ],
      report,
    },

    openNow: {
      id: "social_media.chatOpenConversations",
      title: A ? "محادثات مفتوحة الآن" : "Open now",
      value: fmtNum(summary.chatOpenConversations),
      tone: "cyan",
      icon: <Inbox size={16} />,
      definition: A
        ? "كل محادثة لم تُغلق بعد. جزء منها ينتظر ردًا، وجزء ينتظر العميل."
        : "Every conversation not yet closed. Some are waiting on us, the rest are waiting on the customer.",
      supporting: [
        {
          key: "awaiting",
          label: A ? "تنتظر ردنا" : "Waiting on us",
          value: fmtNum(summary.chatAwaitingReply),
        },
        {
          key: "unassigned",
          label: A ? "بدون موظف" : "Unassigned",
          value: fmtNum(unassigned),
        },
        {
          key: "perPerson",
          label: A ? "متوسط لكل موظف" : "Average per person",
          value:
            moderators.length > 0
              ? ((summary.chatOpenConversations ?? 0) / moderators.length).toFixed(1)
              : "—",
        },
        people,
      ],
      breakdowns: [
        {
          id: "agents",
          title: A ? "المفتوح حسب الموظف" : "Open, by person",
          rows: byAgent((agent) => agent.chatOpenConversations, fmtNum, "cyan"),
          emptyLabel: A ? "لا توجد محادثات مفتوحة" : "Nothing is open",
        },
      ],
      report,
    },

    unassigned: {
      id: "social_media.chatUnassigned",
      title: A ? "بدون موظف" : "Unassigned",
      value: fmtNum(unassigned),
      tone: "rose",
      icon: <Users size={16} />,
      deltaInvert: true,
      definition: A
        ? "محادثات مفتوحة لا يملكها أحد. لا تظهر في قائمة أي موظف، فلا أحد مسؤول عن الرد عليها."
        : "Open conversations nobody owns. They appear on no one's list, so nobody is accountable for the reply.",
      caveat: A
        ? "الرقم لحظي ويأتي من لقطة Chatwoot، لا من مجموع الفترة."
        : "A live figure from the Chatwoot snapshot, not a total for the period.",
      supporting: [
        {
          key: "open",
          label: A ? "مفتوحة الآن" : "Open now",
          value: fmtNum(summary.chatOpenConversations),
        },
        {
          key: "awaiting",
          label: A ? "تنتظر رد" : "Awaiting reply",
          value: fmtNum(summary.chatAwaitingReply),
        },
        people,
      ],
      report,
    },

    firstResponse: {
      id: "social_media.chatFirstResponse",
      title: A ? "أول رد" : "First response",
      value: duration(summary.chatAverageFirstResponseSeconds ?? null, lang),
      tone: "amber",
      icon: <MousePointerClick size={16} />,
      deltaInvert: true,
      definition: A
        ? "متوسط الوقت بين أول رسالة من العميل وأول رد من الفريق."
        : "The average time between a customer's first message and the team's first reply.",
      supporting: [
        {
          key: "conversations",
          label: A ? "المحادثات" : "Conversations",
          value: fmtNum(summary.chatConversations),
        },
        {
          key: "awaiting",
          label: A ? "تنتظر رد" : "Awaiting reply",
          value: fmtNum(summary.chatAwaitingReply),
        },
        people,
      ],
      breakdowns: [
        {
          id: "agents",
          title: A ? "أول رد حسب الموظف" : "First response, by person",
          hint: A
            ? "الأبطأ أولًا، لأن هذا هو الصف الذي يحتاج تدخّلًا."
            : "Slowest first, because that is the row that needs attention.",
          rows: topRows(
            moderators
              .filter((agent) => agent.chatAverageFirstResponseSeconds !== null)
              .map((agent) => ({
                key: agent.key,
                label: agent.displayName || agent.name,
                value: agent.chatAverageFirstResponseSeconds ?? 0,
                display: duration(agent.chatAverageFirstResponseSeconds, lang),
                meta: `${fmtNum(agent.chatConversations ?? 0)} ${A ? "محادثة" : "conversations"}`,
                tone: "amber" as const,
              })),
          ),
          emptyLabel: A ? "لا يوجد قياس لأول رد" : "No first-response measurement",
        },
      ],
      report,
    },
  };
}

function SocialMedia() {
  const reportingPeriod = useReportingPeriod();
  // Declares this page to ENGO Nexus, so "حلل الصفحة دي" and "التاب ده"
  // have something to resolve against. Ids and state only — no figures.
  useRegisterNexusView("social_media");
  const { lang } = useI18n();
  const ads = useApi<AdsResponse>("/api/ads");
  const organic = useApi<OrganicResponse>("/api/organic");
  const workforce = useApi<AgentAnalyticsResult>("/api/teams");
  const moderators = useMemo(
    () =>
      [...(workforce.data?.agents ?? [])]
        .filter(
          (agent) =>
            agent.chatConversations !== null ||
            agent.chatAwaitingReply !== null ||
            agent.chatOpenConversations !== null,
        )
        .sort(
          (a, b) =>
            (b.chatAwaitingReply ?? 0) - (a.chatAwaitingReply ?? 0) ||
            (b.chatConversations ?? 0) - (a.chatConversations ?? 0),
        ),
    [workforce.data?.agents],
  );
  const sources = useMemo(() => organic.data?.sources.slice(0, 8) ?? [], [organic.data?.sources]);

  // The page's headline figures, summed from the two responses it already
  // loads. Reach, clicks and click-through are what the ad platforms actually
  // report; there is no engagement or follower metric in either source, so
  // none is shown — an invented number here would be indistinguishable from a
  // measured one.
  const reach = useMemo(() => {
    const channels = ads.data?.byPlatform ?? [];
    const impressions = channels.reduce((sum, c) => sum + c.impressions, 0);
    const clicks = channels.reduce((sum, c) => sum + c.clicksAll, 0);
    const paidResults = channels.reduce(
      (sum, c) => (c.platformLeads === null ? sum : sum + c.platformLeads),
      0,
    );
    const best = [...channels].sort((a, b) => b.impressions - a.impressions)[0] ?? null;
    return {
      impressions,
      clicks,
      paidResults,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
      best,
    };
  }, [ads.data?.byPlatform]);

  const organicTotals = useMemo(() => {
    const rows = organic.data?.sources ?? [];
    return {
      leads: rows.reduce((sum, r) => sum + r.leads, 0),
      won: rows.reduce((sum, r) => sum + r.won, 0),
      revenue: rows.reduce((sum, r) => sum + r.revenue, 0),
      top: [...rows].sort((a, b) => b.leads - a.leads)[0] ?? null,
    };
  }, [organic.data?.sources]);

  const metrics = socialMetrics(
    reach,
    ads.data?.byPlatform ?? [],
    organicTotals,
    organic.data?.sources ?? [],
    lang,
  );

  if (ads.error || organic.error) {
    const message = ((ads.error || organic.error) as Error).message;
    return (
      <ErrorState
        message={message}
        onRetry={() => {
          ads.refetch();
          organic.refetch();
        }}
      />
    );
  }

  if (ads.isLoading || organic.isLoading || !ads.data || !organic.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-52" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  const chat = workforce.data;
  const awaitingReply = moderators.reduce((sum, agent) => sum + (agent.chatAwaitingReply ?? 0), 0);
  const openConversations = moderators.reduce(
    (sum, agent) => sum + (agent.chatOpenConversations ?? 0),
    0,
  );
  const care = careMetrics(
    workforce.data?.summary ?? {},
    workforce.data?.chatwoot.unassignedConversations ?? null,
    moderators,
    lang,
  );
  const insights = socialInsights(
    reach,
    ads.data.byPlatform,
    organicTotals,
    organic.data.sources,
    {
      awaitingReply,
      openConversations,
      moderators,
      ok: chat?.chatwoot.ok !== false,
    },
    lang,
  );
  return (
    <div className="page-sections">
      <DashboardPageHeader
        flush
        icon={<MessagesSquare size={20} />}
        title={lang === "ar" ? "السوشيال ميديا والموديريشن" : "Social media & moderation"}
        subtitle={
          lang === "ar"
            ? "مكان واحد لأداء القنوات المدفوعة، مصادر التواصل غير المدفوعة، وسرعة متابعة محادثات Chatwoot."
            : "One workspace for paid channels, non-paid communication sources and Chatwoot follow-up speed."
        }
        period={reportingPeriod}
      />

      {/* The page's five figures, all of them reported by the sources this page
          already loads. There is no engagement or follower count in either
          response, so none is shown: an invented figure alongside measured
          ones is worse than a missing one. */}
      <KpiRow>
        <MetricDetailTrigger
          detail={metrics.reach}
          card={{
            index: 0,
            sub:
              lang === "ar"
                ? "إجمالي مرات الظهور التي أبلغت عنها المنصات"
                : "Total impressions reported by the ad platforms",
          }}
        />
        <MetricDetailTrigger
          detail={metrics.clicks}
          card={{
            index: 1,
            sub: reach.best
              ? `${lang === "ar" ? "أعلى منصة" : "Top platform"}: ${PLATFORM_LABEL[reach.best.platform] ?? reach.best.platform}`
              : undefined,
          }}
        />
        <MetricDetailTrigger
          detail={metrics.ctr}
          card={{
            index: 2,
            sub:
              lang === "ar"
                ? `${fmtNum(reach.clicks)} نقرة ÷ ${fmtNum(reach.impressions)} ظهور`
                : `${fmtNum(reach.clicks)} clicks ÷ ${fmtNum(reach.impressions)} impressions`,
          }}
        />
        <MetricDetailTrigger
          detail={metrics.organicLeads}
          card={{
            index: 3,
            sub:
              lang === "ar"
                ? `${fmtNum(organicTotals.won)} صفقة مغلقة`
                : `${fmtNum(organicTotals.won)} closed`,
          }}
        />
        <MetricDetailTrigger
          detail={metrics.organicRevenue}
          card={{
            index: 4,
            sub:
              lang === "ar"
                ? "لا يُنسب لهذه المصادر أي إنفاق إعلاني"
                : "No ad spend is attributed to these sources",
          }}
        />
      </KpiRow>

      <InsightRow>
        <InsightDetailTrigger
          detail={insights.topPlatform}
          card={{
            index: 0,
            kind: "best",
            eyebrow: lang === "ar" ? "أفضل منصة" : "Top platform",
            title: reach.best
              ? `${PLATFORM_LABEL[reach.best.platform] ?? reach.best.platform}`
              : lang === "ar"
                ? "لا توجد منصة بها ظهور في الفترة"
                : "No platform recorded reach this period",
            value: reach.best ? fmtNum(reach.best.impressions) : undefined,
            detail: reach.best
              ? lang === "ar"
                ? `${fmtNum(reach.best.clicksAll)} نقرة · ${fmtPct(reach.best.ctrAll, 2)} نسبة نقر`
                : `${fmtNum(reach.best.clicksAll)} clicks · ${fmtPct(reach.best.ctrAll, 2)} CTR`
              : undefined,
            actionLabel: lang === "ar" ? "لماذا هذه المنصة؟" : "Why this platform?",
          }}
        />
        <InsightDetailTrigger
          detail={insights.topOrganic}
          card={{
            index: 1,
            kind: "note",
            eyebrow: lang === "ar" ? "أكبر مصدر غير مدفوع" : "Largest non-paid source",
            title: organicTotals.top
              ? organicTotals.top.name
              : lang === "ar"
                ? "لا توجد مصادر غير مدفوعة في الفترة"
                : "No non-paid sources this period",
            value: organicTotals.top ? fmtNum(organicTotals.top.leads) : undefined,
            detail: organicTotals.top
              ? lang === "ar"
                ? `${fmtNum(organicTotals.top.won)} صفقة · ${fmtUSDFull(organicTotals.top.revenue)} إيراد`
                : `${fmtNum(organicTotals.top.won)} won · ${fmtUSDFull(organicTotals.top.revenue)} revenue`
              : undefined,
            actionLabel: lang === "ar" ? "ما الذي جاء منه؟" : "What came from it?",
          }}
        />
        <InsightDetailTrigger
          detail={insights.responseSpeed}
          card={{
            index: 2,
            kind: awaitingReply > 0 ? "attention" : "opportunity",
            eyebrow: lang === "ar" ? "سرعة الرد" : "Response speed",
            title:
              awaitingReply > 0
                ? lang === "ar"
                  ? "عملاء ما زالوا ينتظرون رداً"
                  : "Customers still waiting for a reply"
                : lang === "ar"
                  ? "لا يوجد عميل ينتظر رداً الآن"
                  : "Nobody is waiting for a reply right now",
            value: awaitingReply > 0 ? fmtNum(awaitingReply) : undefined,
            detail:
              chat?.chatwoot.ok === false
                ? lang === "ar"
                  ? "مصدر المحادثات غير متاح حالياً، فهذه القراءة قد تكون ناقصة."
                  : "The conversation source is unavailable, so this reading may be incomplete."
                : lang === "ar"
                  ? `${fmtNum(openConversations)} محادثة مفتوحة الآن عبر ${fmtNum(moderators.length)} موظف`
                  : `${fmtNum(openConversations)} conversations open now across ${fmtNum(moderators.length)} people`,
            actionLabel: lang === "ar" ? "من ينتظر؟" : "Who is waiting?",
          }}
        />
      </InsightRow>

      <section>
        <SectionTitle
          hint={
            lang === "ar"
              ? "أرقام المنصات نفسها: الصرف والظهور والنقر والنتائج التي أبلغت عنها كل منصة."
              : "Platform-native spend, reach, clicks and reported results."
          }
        >
          {lang === "ar" ? "أداء القنوات الإعلانية" : "Paid channel performance"}
        </SectionTitle>
        <div className="card-grid md:grid-cols-2 xl:grid-cols-4">
          {ads.data.byPlatform.map((channel) => (
            <Card key={channel.platform} className="relative overflow-hidden" hoverable>
              <div className="absolute inset-x-0 top-0 h-1 bg-brand" />
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-bold text-text">
                  {PLATFORM_LABEL[channel.platform] ?? channel.platform}
                </h3>
                <Pill tone={channel.spend > 0 ? "success" : "neutral"}>
                  {channel.rows} {lang === "ar" ? "صف" : "rows"}
                </Pill>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                <Metric
                  label={lang === "ar" ? "الصرف" : "Spend"}
                  value={fmtUSDFull(channel.spend)}
                />
                <Metric
                  label={lang === "ar" ? "نتائج المنصة" : "Results"}
                  value={channel.platformLeads === null ? "—" : fmtNum(channel.platformLeads)}
                />
                <Metric label="CTR" value={fmtPct(channel.ctrAll, 2)} />
                <Metric label="CPL" value={fmtUSDFull(channel.platformCpl)} />
                <Metric
                  label={lang === "ar" ? "الظهور" : "Impressions"}
                  value={fmtNum(channel.impressions)}
                />
                <Metric
                  label={lang === "ar" ? "النقرات" : "Clicks"}
                  value={fmtNum(channel.clicksAll)}
                />
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle
          hint={
            lang === "ar"
              ? "مصادر Odoo غير المدفوعة فقط؛ لا نخلطها بصرف الحملات ولا ننسب لها CPL مصطنع."
              : "Non-paid Odoo sources only; no ad spend or fabricated CPL is assigned to them."
          }
        >
          {lang === "ar" ? "قنوات التواصل والأورجانيك" : "Communication & organic channels"}
        </SectionTitle>
        {sources.length ? (
          <Card padded={false} className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-surface-2 text-xs text-text-muted">
                  <tr>
                    <th className="px-4 py-3 text-start">{lang === "ar" ? "المصدر" : "Source"}</th>
                    <th className="px-4 py-3 text-end">{lang === "ar" ? "الليدز" : "Leads"}</th>
                    <th className="px-4 py-3 text-end">{lang === "ar" ? "مغلقة" : "Won"}</th>
                    <th className="px-4 py-3 text-end">
                      {lang === "ar" ? "نسبة الإغلاق" : "Conversion"}
                    </th>
                    <th className="px-4 py-3 text-end">{lang === "ar" ? "الإيراد" : "Revenue"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sources.map((source) => (
                    <tr key={source.key} className="hover:bg-surface-2/60">
                      <td className="px-4 py-3 font-semibold text-text">{source.name}</td>
                      <td className="num px-4 py-3 text-end">{fmtNum(source.leads)}</td>
                      <td className="num px-4 py-3 text-end text-success">{fmtNum(source.won)}</td>
                      <td className="num px-4 py-3 text-end">{fmtPct(source.conversionRate, 2)}</td>
                      <td className="num px-4 py-3 text-end font-semibold">
                        {fmtUSDFull(source.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Notice>
            {lang === "ar"
              ? "لا توجد مصادر أورجانيك في الفترة الحالية."
              : "No organic sources in this period."}
          </Notice>
        )}
      </section>

      <section>
        <SectionTitle
          hint={
            lang === "ar"
              ? "المحادثات والرسائل غير المقروءة والمنتظرة مستخرجة من صندوق Chatwoot للفترة المختارة."
              : "Conversations, unread messages and awaiting replies come from the Chatwoot inbox for the selected period."
          }
        >
          {lang === "ar" ? "الموديريشن وخدمة العملاء" : "Moderation & customer care"}
        </SectionTitle>

        {workforce.isLoading ? (
          <Skeleton className="h-72" />
        ) : workforce.error || !chat?.chatwoot.ok ? (
          <Notice tone="warning">
            {lang === "ar"
              ? `تعذّر تحميل Chatwoot الآن${chat?.chatwoot.error ? `: ${chat.chatwoot.error}` : ""}. أداء القنوات بالأعلى ما زال متاحًا.`
              : `Chatwoot is currently unavailable${chat?.chatwoot.error ? `: ${chat.chatwoot.error}` : ""}. Channel performance above remains available.`}
          </Notice>
        ) : (
          <>
            {/* Six figures, but never six across: `KpiRow` measures the content
                column and settles on 3 + 3 rather than squeezing six cards past
                the width a figure needs to stay on one line. */}
            <KpiRow>
              <MetricDetailTrigger detail={care.conversations} card={{ index: 0, compact: true }} />
              <MetricDetailTrigger detail={care.resolved} card={{ index: 1, compact: true }} />
              <MetricDetailTrigger
                detail={care.awaiting}
                card={{ index: 2, compact: true, hero: (chat.summary.chatAwaitingReply ?? 0) > 0 }}
              />
              <MetricDetailTrigger detail={care.openNow} card={{ index: 3, compact: true }} />
              <MetricDetailTrigger detail={care.unassigned} card={{ index: 4, compact: true }} />
              <MetricDetailTrigger detail={care.firstResponse} card={{ index: 5, compact: true }} />
            </KpiRow>

            <Card padded={false} className="mt-4 overflow-hidden">
              <div className="border-b border-border px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-bold text-text">
                  <UserRoundCheck size={17} className="text-brand" />
                  {lang === "ar" ? "أداء فريق الموديريشن" : "Moderator performance"}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-surface-2 text-xs text-text-muted">
                    <tr>
                      <th className="px-4 py-3 text-start">{lang === "ar" ? "الموظف" : "Agent"}</th>
                      <th className="px-4 py-3 text-end">
                        {lang === "ar" ? "المحادثات" : "Chats"}
                      </th>
                      <th className="px-4 py-3 text-end">
                        {lang === "ar" ? "تم حلها" : "Resolved"}
                      </th>
                      <th className="px-4 py-3 text-end">
                        {lang === "ar" ? "تنتظر رد" : "Awaiting"}
                      </th>
                      <th className="px-4 py-3 text-end">
                        {lang === "ar" ? "مفتوحة الآن" : "Open now"}
                      </th>
                      <th className="px-4 py-3 text-end">
                        {lang === "ar" ? "متوسط أول رد" : "Avg first reply"}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {moderators.map((agent) => (
                      <tr key={agent.key} className="hover:bg-surface-2/60">
                        <td className="px-4 py-3 font-semibold text-text">{agent.name}</td>
                        <td className="num px-4 py-3 text-end">
                          {fmtNum(agent.chatConversations)}
                        </td>
                        <td className="num px-4 py-3 text-end text-success">
                          {fmtNum(agent.chatResolved)}
                        </td>
                        <td className="num px-4 py-3 text-end">
                          {fmtNum(agent.chatAwaitingReply)}
                        </td>
                        <td className="num px-4 py-3 text-end">
                          {fmtNum(agent.chatOpenConversations)}
                        </td>
                        <td className="num px-4 py-3 text-end">
                          {duration(agent.chatAverageFirstResponseSeconds, lang)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10.5px] text-text-muted">{label}</div>
      <div className="num mt-0.5 font-semibold text-text">{value}</div>
    </div>
  );
}
