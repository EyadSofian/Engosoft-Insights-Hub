import {
  DollarSign,
  FileText,
  HelpCircle,
  Layers,
  MessagesSquare,
  MousePointerClick,
  ShieldCheck,
} from "lucide-react";
import { DataTable, type Col } from "@/components/DataTable";
import { KpiRow, PageSection } from "@/components/dashboard-bits";
import { MetricDetailTrigger } from "@/components/metric-detail";
import { Card, Pill } from "@/components/ui-bits";
import { fmtNum, fmtUSD, useI18n } from "@/lib/i18n";
import type { MetricDetail } from "@/lib/metric-detail";
import { useApi } from "@/lib/use-api";

/**
 * Unified acquisition attribution. Each entity type keeps its own count:
 * a Meta lead, a Chatwoot conversation, a landing submission and a landing
 * visit are different things and are never added into one another.
 */

type Copy = { en: string; ar: string };

interface Totals {
  acquisition_events: number;
  meta_instant_form_leads: number;
  messaging_conversations: number;
  whatsapp_conversations: number;
  messenger_conversations: number;
  instagram_conversations: number;
  other_conversations: number;
  landing_submissions: number;
  landing_visits: number;
  exact_attributed: number;
  unknown: number;
  organic_direct: number;
}

interface BreakdownRow {
  entity_type: string;
  source_type: string;
  destination_channel: string;
  source_platform: string;
  events: number;
  exact: number;
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
  totals?: Totals;
  breakdown?: BreakdownRow[];
  campaigns?: CampaignRow[];
  forms?: FormRow[];
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
  meta_lead: { en: "Meta instant form lead", ar: "عميل نموذج Meta الفوري" },
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

function metrics(totals: Totals | undefined, summary: SummaryResponse | undefined, A: boolean) {
  const byDestination = new Map<string, number>();
  for (const row of summary?.breakdown ?? []) {
    if (row.entity_type === "landing_visit") continue;
    const key =
      row.entity_type === "chatwoot_conversation" ? row.destination_channel : row.entity_type;
    byDestination.set(key, (byDestination.get(key) ?? 0) + n(row.events));
  }
  const destinationBreakdown = {
    id: "destinations",
    title: A ? "حسب نوع الاستحواذ" : "By acquisition type",
    rows: [...byDestination.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => ({
        key,
        label: ENTITY[key] ? label(ENTITY, key, A) : label(DESTINATION, key, A),
        value,
        display: fmtNum(value),
      })),
    emptyLabel: A ? "لا توجد أحداث في الفترة" : "No acquisition events in this period",
  };
  const detail = (
    item: Omit<MetricDetail, "breakdowns"> & { breakdowns?: MetricDetail["breakdowns"] },
  ) => ({ breakdowns: [destinationBreakdown], ...item }) as MetricDetail;
  return {
    total: detail({
      id: "acquisition.total_events",
      title: A ? "إجمالي أحداث الاستحواذ" : "Total acquisition events",
      value: fmtNum(totals?.acquisition_events),
      tone: "violet",
      icon: <Layers size={17} />,
      definition: A
        ? "عملاء نماذج Meta ومحادثات Chatwoot وإرسالات صفحات الهبوط، كل منها يُعد مرة واحدة."
        : "Meta instant-form leads, Chatwoot conversations and landing submissions, each counted once.",
      caveat: A
        ? "زيارات صفحات الهبوط لا تُحتسب كاستحواذ."
        : "Landing visits are traffic and are not counted.",
    }),
    leads: detail({
      id: "acquisition.meta_leads",
      title: A ? "عملاء نموذج Meta الفوري" : "Meta instant form leads",
      value: fmtNum(totals?.meta_instant_form_leads),
      tone: "sky",
      icon: <FileText size={17} />,
      definition: A
        ? "سجلات عملاء حقيقية من Meta بمعرّف العميل والنموذج والإعلان."
        : "Real Meta lead records with their own lead, form and ad IDs.",
      caveat: A
        ? "لا تُستخدم أرقام العملاء الإجمالية من Meta كسجلات فردية."
        : "Meta's aggregate lead counts are never turned into individual rows.",
    }),
    messaging: detail({
      id: "acquisition.messaging_conversations",
      title: A ? "محادثات المراسلة" : "Messaging conversations",
      value: fmtNum(totals?.messaging_conversations),
      tone: "mint",
      icon: <MessagesSquare size={17} />,
      definition: A
        ? "محادثات Chatwoot عبر واتساب وماسنجر ورسائل إنستغرام."
        : "Chatwoot conversations on WhatsApp, Messenger and Instagram DM.",
      supporting: [
        { key: "whatsapp", label: "WhatsApp", value: fmtNum(totals?.whatsapp_conversations) },
        { key: "messenger", label: "Messenger", value: fmtNum(totals?.messenger_conversations) },
        { key: "instagram", label: "Instagram DM", value: fmtNum(totals?.instagram_conversations) },
      ],
    }),
    landing: detail({
      id: "acquisition.landing_submissions",
      title: A ? "إرسالات صفحات الهبوط" : "Landing submissions",
      value: fmtNum(totals?.landing_submissions),
      tone: "amber",
      icon: <MousePointerClick size={17} />,
      definition: A
        ? "نماذج صفحات الهبوط التي أكد Odoo نجاح إرسالها."
        : "Landing page forms Odoo confirmed as successfully submitted.",
      supporting: [
        {
          key: "visits",
          label: A ? "زيارات (منفصلة)" : "Visits (separate)",
          value: fmtNum(totals?.landing_visits),
        },
      ],
    }),
    exact: detail({
      id: "acquisition.exact_attributed",
      title: A ? "إسناد دقيق" : "Exact attributed",
      value: fmtNum(totals?.exact_attributed),
      tone: "sky",
      icon: <ShieldCheck size={17} />,
      definition: A
        ? "أحداث حُل فيها معرّف الحملة من دليل المزود مباشرة."
        : "Events whose campaign ID was resolved from provider evidence.",
      formula: A ? "ثقة exact ومعرّف حملة موجود" : "confidence = exact and a campaign ID present",
    }),
    unknown: detail({
      id: "acquisition.unknown",
      title: A ? "غير معروف" : "Unknown",
      value: fmtNum(totals?.unknown),
      tone: "rose",
      icon: <HelpCircle size={17} />,
      definition: A
        ? "أحداث بلا دليل مصدر كافٍ. لا تُسمى عضوية دون دليل."
        : "Events without enough source evidence. Never relabelled organic.",
      supporting: [
        {
          key: "organic",
          label: A ? "مباشر أو عضوي مثبت" : "Proven direct or organic",
          value: fmtNum(totals?.organic_direct),
        },
      ],
    }),
    spendCovered: detail({
      id: "acquisition.spend_covered",
      title: A ? "أحداث مغطاة بالصرف" : "Spend-covered events",
      value: "—",
      tone: "amber",
      icon: <DollarSign size={17} />,
      definition: A
        ? "أحداث يطابق معرّف حملتها صرفًا مسجلًا تطابقًا دقيقًا."
        : "Events whose campaign ID exactly matches recorded spend.",
      caveat: A
        ? "يظهر الرقم بعد إثبات ربط الصرف الدقيق لكل نوع استحواذ."
        : "Shown once an exact spend join is proven for each acquisition type.",
    }),
  };
}

export function AcquisitionOverviewSection() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const summary = useApi<SummaryResponse>("/api/acquisition/summary");
  const events = useApi<EventsResponse>("/api/acquisition/events?limit=500");
  const totals = summary.data?.totals;
  const detail = metrics(totals, summary.data, A);
  const loading = summary.isLoading;

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
      render: (row) => row.source_platform || "—",
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
      render: (row) => row.source_platform || "—",
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
            ? "دليل المزود فقط. CRM لاحق ولا يحدد المصدر. الكيانات لا تُجمع معًا."
            : "Provider evidence only. CRM is downstream and never decides the source. Entities are never added together."
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Pill tone="brand">{A ? "عملاء Meta ≠ محادثات" : "Meta leads ≠ conversations"}</Pill>
            <Pill>{A ? "الزيارات ليست استحواذ" : "Visits are not acquisitions"}</Pill>
            <Pill tone="warning">{A ? "بلا دليل = غير معروف" : "No evidence = unknown"}</Pill>
          </div>
          <KpiRow>
            <MetricDetailTrigger
              detail={detail.total}
              card={{
                index: 0,
                sub: A ? "عملاء + محادثات + إرسالات" : "Leads + conversations + submissions",
                loading,
              }}
            />
            <MetricDetailTrigger
              detail={detail.leads}
              card={{ index: 1, sub: A ? "سجلات Meta فعلية" : "Real Meta lead records", loading }}
            />
            <MetricDetailTrigger
              detail={detail.messaging}
              card={{
                index: 2,
                sub: A ? "واتساب · ماسنجر · إنستغرام" : "WhatsApp · Messenger · Instagram DM",
                loading,
              }}
            />
            <MetricDetailTrigger
              detail={detail.landing}
              card={{ index: 3, sub: A ? "إرسال مؤكد من Odoo" : "Confirmed by Odoo", loading }}
            />
            <MetricDetailTrigger
              detail={detail.exact}
              card={{ index: 4, sub: A ? "معرّف حملة من المزود" : "Provider campaign ID", loading }}
            />
            <MetricDetailTrigger
              detail={detail.unknown}
              card={{ index: 5, sub: A ? "ليست عضوية" : "Not called organic", loading }}
            />
            <MetricDetailTrigger
              detail={detail.spendCovered}
              card={{ index: 6, sub: A ? "بانتظار ربط دقيق" : "Awaiting exact join", loading }}
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
