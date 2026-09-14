import {
  BarChart3,
  CheckCircle2,
  DollarSign,
  Eye,
  FileText,
  HelpCircle,
  Layers,
  MessagesSquare,
  MousePointerClick,
  Percent,
  ShieldCheck,
} from "lucide-react";
import { DataTable, type Col } from "@/components/DataTable";
import { KpiRow, PageSection } from "@/components/dashboard-bits";
import { MetricDetailTrigger } from "@/components/metric-detail";
import { Card, Pill } from "@/components/ui-bits";
import { fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import type { MetricBreakdownGroup, MetricDetail } from "@/lib/metric-detail";
import { useApi } from "@/lib/use-api";

/**
 * Unified acquisition attribution.
 *
 * Every event-level card is a sum over the grouped rows the table below renders,
 * computed once on the server, so the cards and the table cannot disagree.
 * Meta's own aggregate lead reporting sits in its own, separately labelled row
 * and is never added to event counts.
 */

type Copy = { en: string; ar: string };

interface Cards {
  totalEvents: number;
  messagingConversations: number;
  metaInstantFormLeads: number;
  landingVisits: number;
  landingSubmissions: number;
  exactAttribution: number;
  knownSourceEvents: number;
  unknownEvents: number;
  spendCoveredEvents: number | null;
  attributionRate: number | null;
  eventsByEntity: Record<string, number>;
  conversationsByChannel: Record<string, number>;
  eventsByPlatform: Record<string, number>;
}

interface MetaAggregate {
  available: boolean;
  platformLeads: number;
  campaigns: number;
  from: string | null;
  to: string | null;
  ignoredFilters: string[];
}

interface BreakdownRow {
  entity_type: string;
  source_type: string;
  destination_channel: string;
  source_platform: string;
  events: number;
  exact: number;
  spend_covered: number;
}

interface CampaignRow {
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  entity_type: string;
  destination_channel: string;
  events: number;
}

interface FormRow {
  form_id: string;
  form_name: string;
  page_id: string;
  page_name: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  leads: number;
  organic_leads: number;
}

interface SummaryResponse {
  configured: boolean;
  empty?: boolean;
  cards?: Cards;
  breakdown?: BreakdownRow[];
  campaigns?: CampaignRow[];
  forms?: FormRow[];
  spendDataAvailable?: boolean;
  metaAggregate?: MetaAggregate;
}

interface EventRow {
  acquisition_event_id: string;
  entity_type: string;
  entity_id: string;
  source_type: string;
  source_platform: string;
  destination_channel: string;
  provider_lead_id: string;
  page_name: string;
  form_id: string;
  form_name: string;
  landing_page_id: string;
  landing_page_name: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  creative_id: string;
  creative_name: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  attribution_method: string;
  attribution_confidence: string;
  occurred_at: string | null;
  unknown_reason: string;
  crm_status: string | null;
  crm_won: boolean | null;
  revenue: number | null;
  chatwootUrl: string | null;
}

interface EventsResponse {
  configured: boolean;
  total: number;
  rows: EventRow[];
}

const ENTITY: Record<string, Copy> = {
  meta_lead: { en: "Meta instant form lead", ar: "عميل Meta Lead Form" },
  chatwoot_conversation: { en: "Chatwoot conversation", ar: "محادثة Chatwoot" },
  landing_submission: { en: "Landing submission", ar: "إرسال صفحة هبوط" },
  landing_visit: { en: "Landing visit", ar: "زيارة صفحة هبوط" },
};

const DESTINATION: Record<string, Copy> = {
  meta_instant_form: { en: "Meta instant form", ar: "نموذج Meta الفوري" },
  whatsapp: { en: "WhatsApp", ar: "واتساب" },
  messenger: { en: "Messenger", ar: "ماسنجر" },
  instagram_dm: { en: "Instagram DM", ar: "رسائل إنستغرام" },
  website_chat: { en: "Website chat", ar: "دردشة الموقع" },
  landing_page: { en: "Landing page", ar: "صفحة هبوط" },
  unknown: { en: "Unknown", ar: "غير معروف" },
};

const SOURCE: Record<string, Copy> = {
  meta_instant_form: { en: "Meta instant form", ar: "نموذج Meta الفوري" },
  meta_whatsapp_referral: { en: "Meta ad → WhatsApp", ar: "إعلان Meta ← واتساب" },
  meta_messenger_referral: { en: "Meta ad → Messenger", ar: "إعلان Meta ← ماسنجر" },
  meta_instagram_referral: { en: "Meta ad → Instagram DM", ar: "إعلان Meta ← إنستغرام" },
  landing_page_form: { en: "Landing page form", ar: "نموذج صفحة الهبوط" },
  landing_page_visit: { en: "Landing page visit", ar: "زيارة صفحة الهبوط" },
  website_chat: { en: "Website chat", ar: "دردشة الموقع" },
  direct_or_organic: { en: "Direct or organic", ar: "مباشر أو عضوي" },
  unknown: { en: "Unknown", ar: "غير معروف" },
};

const PLATFORM: Record<string, Copy> = {
  facebook: { en: "Facebook", ar: "فيسبوك" },
  instagram: { en: "Instagram", ar: "إنستغرام" },
  messenger: { en: "Messenger", ar: "ماسنجر" },
  whatsapp: { en: "WhatsApp", ar: "واتساب" },
  audience_network: { en: "Meta Audience Network", ar: "شبكة جمهور Meta" },
  google: { en: "Google", ar: "جوجل" },
  tiktok: { en: "TikTok", ar: "تيك توك" },
  snapchat: { en: "Snapchat", ar: "سناب شات" },
  website: { en: "Website", ar: "الموقع" },
  direct: { en: "Direct", ar: "مباشر" },
  other: { en: "Other", ar: "أخرى" },
  unknown: { en: "Unknown", ar: "غير معروف" },
};

const n = (value: unknown): number => Number(value ?? 0) || 0;

function label(map: Record<string, Copy>, key: string, A: boolean): string {
  const copy = map[key];
  return copy ? (A ? copy.ar : copy.en) : key || "—";
}

function nameWithId(name: string, id: string) {
  if (!name && !id) return "—";
  return (
    <div>
      <div className="text-text">{name || "—"}</div>
      {id ? <div className="font-mono text-[11px] text-text-muted">{id}</div> : null}
    </div>
  );
}

function breakdown(
  id: string,
  title: string,
  values: Record<string, number> | undefined,
  map: Record<string, Copy>,
  A: boolean,
): MetricBreakdownGroup {
  return {
    id,
    title,
    rows: Object.entries(values ?? {})
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => ({ key, label: label(map, key, A), value, display: fmtNum(value) })),
    emptyLabel: A ? "لا توجد أحداث في الفترة" : "No events in this period",
  };
}

function metrics(cards: Cards | undefined, aggregate: MetaAggregate | undefined, A: boolean) {
  const byEntity = breakdown(
    "entities",
    A ? "حسب نوع الكيان" : "By entity type",
    cards?.eventsByEntity,
    ENTITY,
    A,
  );
  const byPlatform = breakdown(
    "platforms",
    A ? "حسب المنصة" : "By platform",
    cards?.eventsByPlatform,
    PLATFORM,
    A,
  );
  const byChannel = breakdown(
    "channels",
    A ? "حسب القناة" : "By channel",
    cards?.conversationsByChannel,
    DESTINATION,
    A,
  );
  const eventLevel = A
    ? "فعلي: يُحسب من صفوف جدول الاستحواذ نفسه."
    : "Event-level: summed from the same rows as the acquisition table.";
  const detail = (item: MetricDetail): MetricDetail => ({
    breakdowns: [byEntity, byPlatform],
    ...item,
  });
  const period =
    aggregate?.from && aggregate?.to ? `${aggregate.from} → ${aggregate.to}` : A ? "—" : "—";

  return {
    total: detail({
      id: "acquisition.total_events",
      title: A ? "إجمالي أحداث الاستحواذ" : "Total acquisition events",
      value: fmtNum(cards?.totalEvents),
      tone: "violet",
      icon: <Layers size={17} />,
      definition: A
        ? "كل كيانات بيانات الاستحواذ الموحدة: عملاء Meta ومحادثات Chatwoot وزيارات وإرسالات صفحات الهبوط."
        : "Every entity in the unified acquisition dataset: Meta leads, Chatwoot conversations, landing visits and landing submissions.",
      formula: A ? "مجموع أحداث كل صفوف الجدول" : "Sum of events across every table row",
      caveat: A
        ? "الجلسة التي أرسلت نموذجًا تُعد زيارة وإرسالًا معًا."
        : "A landing session that submitted a form counts as both a visit and a submission.",
    }),
    messaging: detail({
      id: "acquisition.messaging_conversations",
      title: A ? "محادثات المراسلة" : "Messaging conversations",
      value: fmtNum(cards?.messagingConversations),
      tone: "mint",
      icon: <MessagesSquare size={17} />,
      definition: A
        ? "كل محادثات Chatwoot (نوع الكيان chatwoot_conversation) على كل القنوات."
        : "Every Chatwoot conversation (entity type chatwoot_conversation) on every channel.",
      caveat: eventLevel,
      breakdowns: [byChannel, byPlatform],
    }),
    leads: detail({
      id: "acquisition.meta_leads_exact",
      title: A ? "عملاء Meta Lead Forms" : "Meta instant form leads",
      value: fmtNum(cards?.metaInstantFormLeads),
      tone: "sky",
      icon: <FileText size={17} />,
      definition: A
        ? "فعلي: سجلات عملاء Meta حقيقية بمعرّف العميل (نوع الكيان meta_lead)."
        : "Event-level: real Meta lead records with their own lead ID (entity type meta_lead).",
      caveat: A
        ? "أرقام Meta المجمّعة معروضة منفصلة ولا تُحوَّل إلى سجلات فردية."
        : "Meta's aggregate lead totals are shown separately and are never turned into records.",
    }),
    visits: detail({
      id: "acquisition.landing_visits",
      title: A ? "زيارات صفحات الهبوط" : "Landing page visits",
      value: fmtNum(cards?.landingVisits),
      tone: "amber",
      icon: <Eye size={17} />,
      definition: A
        ? "جلسات صفحات الهبوط المسجلة (نوع الكيان landing_visit)."
        : "Recorded landing page sessions (entity type landing_visit).",
      caveat: eventLevel,
    }),
    submissions: detail({
      id: "acquisition.landing_submissions",
      title: A ? "إرسالات صفحات الهبوط" : "Landing page submissions",
      value: fmtNum(cards?.landingSubmissions),
      tone: "amber",
      icon: <MousePointerClick size={17} />,
      definition: A
        ? "نماذج صفحات الهبوط التي أكد Odoo نجاح إرسالها (نوع الكيان landing_submission)."
        : "Landing page forms Odoo confirmed as submitted (entity type landing_submission).",
      caveat: eventLevel,
    }),
    exact: detail({
      id: "acquisition.exact_attributed",
      title: A ? "إسناد دقيق" : "Exact attribution",
      value: fmtNum(cards?.exactAttribution),
      tone: "sky",
      icon: <ShieldCheck size={17} />,
      definition: A
        ? "أحداث حُل فيها معرّف الحملة من دليل المزود مباشرة."
        : "Events whose campaign ID was proven by provider evidence.",
      formula: A ? "ثقة exact ومعرّف حملة موجود" : "confidence = exact and a campaign ID present",
      caveat: A
        ? "UTM والمُحيل يُعدان مصدرًا معروفًا لكن ليس إسنادًا دقيقًا."
        : "UTM and referrer evidence count as a known source, not exact attribution.",
    }),
    known: detail({
      id: "acquisition.known_source",
      title: A ? "أحداث معروفة المصدر" : "Known-source events",
      value: fmtNum(cards?.knownSourceEvents),
      tone: "mint",
      icon: <CheckCircle2 size={17} />,
      definition: A ? "أحداث نوع مصدرها ليس unknown." : "Events whose source type is not unknown.",
      formula: A ? "الإجمالي − غير المعروفة" : "Total − unknown",
    }),
    unknown: detail({
      id: "acquisition.unknown",
      title: A ? "أحداث غير معروفة" : "Unknown events",
      value: fmtNum(cards?.unknownEvents),
      tone: "rose",
      icon: <HelpCircle size={17} />,
      definition: A
        ? "أحداث نوع مصدرها unknown. لا تُسمى عضوية دون دليل."
        : "Events whose source type is unknown. Never relabelled organic.",
      breakdowns: [byEntity, byChannel],
    }),
    spendCovered: detail({
      id: "acquisition.spend_covered",
      title: A ? "أحداث مغطاة بالصرف" : "Spend-covered events",
      value: fmtNum(cards?.spendCoveredEvents),
      tone: "amber",
      icon: <DollarSign size={17} />,
      definition: A
        ? "أحداث دقيقة الإسناد لحملتها صرف مسجل في بيانات الإعلانات المتزامنة للفترة نفسها."
        : "Exactly attributed events whose campaign has recorded spend in the synced ad data for the same period.",
      caveat:
        cards && cards.spendCoveredEvents === null
          ? A
            ? "لا توجد بيانات صرف متزامنة للمقارنة."
            : "No synced spend data to compare against."
          : A
            ? "الربط بمعرّف الحملة فقط، وليس بالاسم."
            : "Joined on campaign ID only, never by name.",
    }),
    rate: detail({
      id: "acquisition.attribution_rate",
      title: A ? "نسبة الإسناد" : "Attribution rate",
      value:
        cards?.attributionRate === null || cards?.attributionRate === undefined
          ? "—"
          : fmtPct(cards.attributionRate * 100, 1),
      tone: "violet",
      icon: <Percent size={17} />,
      definition: A
        ? "نسبة الأحداث ذات الإسناد الدقيق من إجمالي أحداث الاستحواذ."
        : "Share of all acquisition events with exact attribution.",
      formula: A ? "إسناد دقيق ÷ إجمالي الأحداث" : "Exact attribution ÷ total acquisition events",
    }),
    aggregateLeads: {
      id: "acquisition.meta_leads_aggregate",
      title: A ? "عملاء Meta (مجمّع من Meta)" : "Meta leads (aggregate)",
      value: aggregate?.available ? fmtNum(aggregate.platformLeads) : "—",
      tone: "sky",
      icon: <BarChart3 size={17} />,
      definition: A
        ? "نتائج نماذج العملاء كما تُبلغ عنها Meta في تقارير الإعلانات. رقم مجمّع وليس سجلات عملاء."
        : "Lead-form results as Meta reports them in ad insights. An aggregate, not lead records.",
      formula: A ? "مجموع Leads (on facebook Leads)" : "Sum of Leads (on facebook Leads)",
      caveat: A
        ? `فترة بيانات Meta: ${period}. لا يُضاف إلى إجمالي الأحداث ولا يُحسب في نسبة الإسناد.`
        : `Meta data period: ${period}. Never added to event totals or the attribution rate.`,
    } satisfies MetricDetail,
    aggregateCampaigns: {
      id: "acquisition.meta_lead_campaigns_aggregate",
      title: A ? "حملات بها عملاء (مجمّع من Meta)" : "Campaigns with leads (aggregate)",
      value: aggregate?.available ? fmtNum(aggregate.campaigns) : "—",
      tone: "sky",
      icon: <BarChart3 size={17} />,
      definition: A
        ? "عدد الحملات التي أبلغت Meta عن نتائج نماذج عملاء لها في الفترة."
        : "Campaigns for which Meta reported lead-form results in the period.",
      caveat: A ? `فترة بيانات Meta: ${period}.` : `Meta data period: ${period}.`,
    } satisfies MetricDetail,
  };
}

export function AcquisitionOverviewSection() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const summary = useApi<SummaryResponse>("/api/acquisition/summary");
  const events = useApi<EventsResponse>("/api/acquisition/events?limit=500");
  const cards = summary.data?.cards;
  const aggregate = summary.data?.metaAggregate;
  const detail = metrics(cards, aggregate, A);
  const loading = summary.isLoading;
  const aggregatePeriod =
    aggregate?.from && aggregate?.to ? `${aggregate.from} → ${aggregate.to}` : "";

  const breakdownCols: Col<BreakdownRow>[] = [
    {
      key: "entity",
      header: A ? "نوع الكيان" : "Entity type",
      always: true,
      render: (row) => label(ENTITY, row.entity_type, A),
      sortValue: (row) => row.entity_type,
    },
    {
      key: "source",
      header: A ? "نوع المصدر" : "Source type",
      render: (row) => label(SOURCE, row.source_type, A),
      sortValue: (row) => row.source_type,
    },
    {
      key: "platform",
      header: A ? "المنصة" : "Platform",
      render: (row) => label(PLATFORM, row.source_platform, A),
      sortValue: (row) => row.source_platform,
    },
    {
      key: "destination",
      header: A ? "الوجهة" : "Destination",
      render: (row) => label(DESTINATION, row.destination_channel, A),
      sortValue: (row) => row.destination_channel,
    },
    {
      key: "events",
      header: A ? "الأحداث" : "Events",
      align: "right",
      render: (row) => fmtNum(row.events),
      sortValue: (row) => n(row.events),
    },
    {
      key: "exact",
      header: A ? "دقيق" : "Exact",
      align: "right",
      render: (row) => fmtNum(row.exact),
      sortValue: (row) => n(row.exact),
    },
    {
      key: "spend",
      header: A ? "مغطى بالصرف" : "Spend-covered",
      align: "right",
      render: (row) => (summary.data?.spendDataAvailable ? fmtNum(row.spend_covered) : "—"),
      sortValue: (row) => n(row.spend_covered),
    },
  ];

  const eventCols: Col<EventRow>[] = [
    {
      key: "date",
      header: A ? "التاريخ" : "Date",
      always: true,
      sticky: true,
      render: (row) => (row.occurred_at ? row.occurred_at.replace("T", " ").slice(0, 16) : "—"),
      sortValue: (row) => row.occurred_at ?? "",
    },
    {
      key: "entity",
      header: A ? "الكيان" : "Entity type",
      render: (row) => label(ENTITY, row.entity_type, A),
      sortValue: (row) => row.entity_type,
    },
    {
      key: "source",
      header: A ? "المصدر" : "Source type",
      render: (row) => label(SOURCE, row.source_type, A),
      sortValue: (row) => row.source_type,
    },
    {
      key: "platform",
      header: A ? "المنصة" : "Platform",
      render: (row) => label(PLATFORM, row.source_platform, A),
      sortValue: (row) => row.source_platform,
    },
    {
      key: "destination",
      header: A ? "الوجهة" : "Destination",
      render: (row) => label(DESTINATION, row.destination_channel, A),
      sortValue: (row) => row.destination_channel,
    },
    {
      key: "campaign",
      header: A ? "الحملة" : "Campaign",
      render: (row) => nameWithId(row.campaign_name, row.campaign_id),
      sortValue: (row) => row.campaign_name || row.campaign_id,
    },
    {
      key: "adset",
      header: A ? "مجموعة الإعلان" : "Ad set",
      render: (row) => nameWithId(row.adset_name, row.adset_id),
      sortValue: (row) => row.adset_name || row.adset_id,
    },
    {
      key: "ad",
      header: A ? "الإعلان" : "Ad",
      render: (row) => nameWithId(row.ad_name, row.ad_id),
      sortValue: (row) => row.ad_name || row.ad_id,
    },
    {
      key: "creativeForm",
      header: A ? "المادة / النموذج" : "Creative / form",
      render: (row) =>
        row.entity_type === "meta_lead"
          ? nameWithId(row.form_name, row.form_id)
          : nameWithId(row.creative_name, row.creative_id),
    },
    {
      key: "landing",
      header: A ? "صفحة الهبوط" : "Landing page",
      render: (row) =>
        row.landing_page_id ? nameWithId(row.landing_page_name, row.landing_page_id) : "—",
    },
    {
      key: "method",
      header: A ? "الطريقة" : "Method",
      render: (row) => row.attribution_method || "—",
      sortValue: (row) => row.attribution_method,
    },
    {
      key: "confidence",
      header: A ? "الثقة" : "Confidence",
      render: (row) => (
        <Pill
          tone={
            row.attribution_confidence === "exact"
              ? "success"
              : row.attribution_confidence === "unknown"
                ? "warning"
                : "neutral"
          }
        >
          {row.attribution_confidence || "unknown"}
        </Pill>
      ),
      sortValue: (row) => row.attribution_confidence,
    },
    {
      key: "outcome",
      header: A ? "النتيجة" : "Outcome",
      render: (row) =>
        row.crm_status || row.crm_won
          ? `${row.crm_won ? (A ? "مغلق بنجاح" : "Won") : row.crm_status}${row.revenue ? ` · ${fmtUSD(row.revenue)}` : ""}`
          : "—",
    },
    {
      key: "link",
      header: A ? "السجل" : "Record",
      render: (row) =>
        row.chatwootUrl ? (
          <a
            className="font-semibold text-brand hover:underline"
            href={row.chatwootUrl}
            target="_blank"
            rel="noreferrer"
          >
            #{row.entity_id}
          </a>
        ) : row.entity_type === "meta_lead" ? (
          <span className="font-mono text-[11px]">
            {A ? "عميل" : "Lead"} {row.provider_lead_id}
          </span>
        ) : (
          <span className="font-mono text-[11px]">{row.entity_id}</span>
        ),
    },
  ];

  const campaignCols: Col<CampaignRow>[] = [
    {
      key: "campaign",
      header: A ? "الحملة" : "Campaign",
      always: true,
      sticky: true,
      render: (row) => nameWithId(row.campaign_name, row.campaign_id),
      sortValue: (row) => row.campaign_name || row.campaign_id,
    },
    {
      key: "adset",
      header: A ? "مجموعة الإعلان" : "Ad set",
      render: (row) => nameWithId(row.adset_name, row.adset_id),
      sortValue: (row) => row.adset_name || row.adset_id,
    },
    {
      key: "ad",
      header: A ? "الإعلان" : "Ad",
      render: (row) => nameWithId(row.ad_name, row.ad_id),
      sortValue: (row) => row.ad_name || row.ad_id,
    },
    {
      key: "type",
      header: A ? "نوع الاستحواذ" : "Acquisition type",
      render: (row) =>
        `${label(ENTITY, row.entity_type, A)} · ${label(DESTINATION, row.destination_channel, A)}`,
      sortValue: (row) => `${row.entity_type}:${row.destination_channel}`,
    },
    {
      key: "events",
      header: A ? "الأحداث" : "Events",
      align: "right",
      render: (row) => fmtNum(row.events),
      sortValue: (row) => n(row.events),
    },
  ];

  const formCols: Col<FormRow>[] = [
    {
      key: "form",
      header: A ? "النموذج" : "Form",
      always: true,
      sticky: true,
      render: (row) => nameWithId(row.form_name, row.form_id),
      sortValue: (row) => row.form_name || row.form_id,
    },
    {
      key: "page",
      header: A ? "الصفحة" : "Page",
      render: (row) => nameWithId(row.page_name, row.page_id),
      sortValue: (row) => row.page_name || row.page_id,
    },
    {
      key: "leads",
      header: A ? "العملاء" : "Leads",
      align: "right",
      render: (row) => (
        <div>
          <div>{fmtNum(row.leads)}</div>
          {n(row.organic_leads) ? (
            <div className="text-[11px] text-text-muted">
              {fmtNum(row.organic_leads)} {A ? "عضوي" : "organic"}
            </div>
          ) : null}
        </div>
      ),
      sortValue: (row) => n(row.leads),
    },
    {
      key: "campaign",
      header: A ? "الحملة" : "Campaign",
      render: (row) => nameWithId(row.campaign_name, row.campaign_id),
      sortValue: (row) => row.campaign_name || row.campaign_id,
    },
    {
      key: "adset",
      header: A ? "مجموعة الإعلان" : "Ad set",
      render: (row) => nameWithId(row.adset_name, row.adset_id),
    },
    {
      key: "ad",
      header: A ? "الإعلان" : "Ad",
      render: (row) => nameWithId(row.ad_name, row.ad_id),
    },
  ];

  return (
    <>
      <PageSection
        title={A ? "إسناد الاستحواذ الموحد" : "Unified acquisition attribution"}
        icon={<Layers size={16} />}
        tone="violet"
        hint={
          A
            ? "دليل المزود فقط. CRM لاحق ولا يحدد المصدر. البطاقات تُحسب من صفوف الجدول نفسه."
            : "Provider evidence only. CRM is downstream and never decides the source. Cards are summed from the table rows."
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="success">{A ? "فعلي" : "Event-level"}</Pill>
            <span className="text-xs text-text-muted">
              {A
                ? "سجل لكل حدث: عميل أو محادثة أو زيارة أو إرسال. بلا دليل = غير معروف."
                : "One record per event: a lead, conversation, visit or submission. No evidence = unknown."}
            </span>
          </div>
          <KpiRow>
            <MetricDetailTrigger
              detail={detail.total}
              card={{ index: 0, sub: A ? "كل صفوف الجدول" : "Every table row", loading }}
            />
            <MetricDetailTrigger
              detail={detail.messaging}
              card={{
                index: 1,
                sub: A ? "واتساب · ماسنجر · الموقع" : "WhatsApp · Messenger · website",
                loading,
              }}
            />
            <MetricDetailTrigger
              detail={detail.leads}
              card={{ index: 2, sub: A ? "فعلي · سجل لكل عميل" : "Event-level records", loading }}
            />
            <MetricDetailTrigger
              detail={detail.visits}
              card={{ index: 3, sub: A ? "جلسات مسجلة" : "Recorded sessions", loading }}
            />
            <MetricDetailTrigger
              detail={detail.submissions}
              card={{ index: 4, sub: A ? "إرسال مؤكد من Odoo" : "Confirmed by Odoo", loading }}
            />
          </KpiRow>
          <KpiRow>
            <MetricDetailTrigger
              detail={detail.exact}
              card={{ index: 5, sub: A ? "معرّف حملة من المزود" : "Provider campaign ID", loading }}
            />
            <MetricDetailTrigger
              detail={detail.known}
              card={{ index: 6, sub: A ? "نوع مصدر محدد" : "Source type identified", loading }}
            />
            <MetricDetailTrigger
              detail={detail.unknown}
              card={{ index: 7, sub: A ? "ليست عضوية" : "Not called organic", loading }}
            />
            <MetricDetailTrigger
              detail={detail.spendCovered}
              card={{
                index: 8,
                sub: summary.data?.spendDataAvailable
                  ? A
                    ? "حملة دقيقة لها صرف مسجل"
                    : "Exact campaign with recorded spend"
                  : A
                    ? "لا توجد بيانات صرف"
                    : "No spend data",
                loading,
              }}
            />
            <MetricDetailTrigger
              detail={detail.rate}
              card={{ index: 9, sub: A ? "دقيق ÷ الإجمالي" : "Exact ÷ total", loading }}
            />
          </KpiRow>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Pill tone="brand">{A ? "مجمّع من Meta" : "Aggregate from Meta"}</Pill>
            <span className="text-xs text-text-muted">
              {A
                ? `تقارير المنصة وليست أحداثًا فردية، ولا تُضاف إلى الأرقام أعلاه${aggregatePeriod ? ` · ${aggregatePeriod}` : ""}.`
                : `Platform reporting, not individual events, and never added to the figures above${aggregatePeriod ? ` · ${aggregatePeriod}` : ""}.`}
            </span>
          </div>
          <KpiRow>
            <MetricDetailTrigger
              detail={detail.aggregateLeads}
              card={{ index: 10, sub: A ? "مجمّع من Meta" : "Meta-reported", loading }}
            />
            <MetricDetailTrigger
              detail={detail.aggregateCampaigns}
              card={{ index: 11, sub: A ? "مجمّع من Meta" : "Meta-reported", loading }}
            />
          </KpiRow>

          <DataTable
            rows={summary.data?.breakdown || []}
            cols={breakdownCols}
            loading={loading}
            searchable={(row) =>
              `${row.entity_type} ${row.source_type} ${row.destination_channel} ${row.source_platform}`
            }
            rowKey={(row) =>
              `${row.entity_type}:${row.source_type}:${row.destination_channel}:${row.source_platform}`
            }
            csvFilename="engosoft-acquisition-breakdown.csv"
          />
        </div>
      </PageSection>

      <PageSection
        level="records"
        title={A ? "أحداث الاستحواذ" : "Acquisition events"}
        hint={
          A
            ? "كل صف يرتبط بسجله الأصلي حيثما أمكن."
            : "Each row links to its underlying record where possible."
        }
      >
        <DataTable
          rows={events.data?.rows || []}
          cols={eventCols}
          loading={events.isLoading}
          searchable={(row) =>
            `${row.entity_type} ${row.entity_id} ${row.source_type} ${row.destination_channel} ${row.campaign_name} ${row.campaign_id} ${row.adset_id} ${row.ad_id} ${row.form_id} ${row.form_name} ${row.landing_page_id}`
          }
          rowKey={(row) => row.acquisition_event_id}
          csvFilename="engosoft-acquisition-events.csv"
          truncatedNote={
            events.data && events.data.total > events.data.rows.length
              ? A
                ? `يعرض أحدث ${events.data.rows.length} من ${events.data.total} حدث.`
                : `Showing the latest ${events.data.rows.length} of ${events.data.total} events.`
              : undefined
          }
        />
      </PageSection>

      <PageSection
        title={A ? "تفصيل الحملات" : "Campaign drill-down"}
        hint={
          A
            ? "بالمعرّف الدقيق. الحملة الواحدة قد تملك أكثر من مسار."
            : "By exact ID. One campaign can have several destination paths."
        }
      >
        <DataTable
          rows={summary.data?.campaigns || []}
          cols={campaignCols}
          loading={loading}
          searchable={(row) =>
            `${row.campaign_name} ${row.campaign_id} ${row.adset_name} ${row.adset_id} ${row.ad_name} ${row.ad_id}`
          }
          rowKey={(row) =>
            `${row.campaign_id}:${row.adset_id}:${row.ad_id}:${row.entity_type}:${row.destination_channel}`
          }
          csvFilename="engosoft-acquisition-campaigns.csv"
        />
      </PageSection>

      <PageSection
        title={A ? "تفصيل نماذج Meta" : "Meta lead form drill-down"}
        icon={<FileText size={16} />}
      >
        <div className="space-y-3">
          <Card padded className="text-xs leading-relaxed text-text-muted">
            {A
              ? "الصرف وتكلفة العميل ونتائج CRM تظهر هنا فقط بعد إثبات ربط دقيق بمعرّف العميل أو الإعلان."
              : "Spend, cost per lead and CRM outcomes appear here only after an exact lead- or ad-level join is proven."}
          </Card>
          <DataTable
            rows={summary.data?.forms || []}
            cols={formCols}
            loading={loading}
            searchable={(row) =>
              `${row.form_name} ${row.form_id} ${row.page_name} ${row.campaign_name} ${row.campaign_id} ${row.ad_id}`
            }
            rowKey={(row) => `${row.form_id}:${row.campaign_id}:${row.adset_id}:${row.ad_id}`}
            csvFilename="engosoft-meta-lead-forms.csv"
          />
        </div>
      </PageSection>
    </>
  );
}
