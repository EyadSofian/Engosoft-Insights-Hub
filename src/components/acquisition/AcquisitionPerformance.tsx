import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  DollarSign,
  Eye,
  FileText,
  Globe2,
  HelpCircle,
  Layers,
  MessagesSquare,
  MousePointerClick,
  Network,
  ShieldCheck,
  Target,
  X,
} from "lucide-react";
import { HBarChart } from "@/components/charts";
import { DataTable, type Col } from "@/components/DataTable";
import { KpiRow, PageSection } from "@/components/dashboard-bits";
import { MetricDetailTrigger } from "@/components/metric-detail";
import {
  DESTINATION,
  PLATFORM,
  label,
  nameWithId,
  type Copy,
} from "@/components/attribution/acquisition-labels";
import { Card, Pill, Segmented } from "@/components/ui-bits";
import type { AnyTone } from "@/lib/dashboard-tone";
import type { PerformanceGrain } from "@/lib/acquisition-performance";
import { fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";

/**
 * Acquisition performance: how many leads and messages came in, and exactly
 * where from. Every event count comes from the canonical acquisition layer and
 * is credited to a campaign, ad set, ad or creative only through its exact
 * provider ID. Spend and Meta's aggregate lead totals come from synced ad rows
 * and are labelled as such; they are never turned into events.
 */

interface PerfRow {
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  creative_id: string;
  creative_name: string;
  platforms: string[];
  destinations: string[];
  placements: string[];
  conversations: number;
  meta_leads: number;
  landing_visits: number;
  landing_submissions: number;
  exact_acquisitions: number;
  spend: number;
  has_spend_rows: boolean;
  platform_leads_aggregate: number;
  cost_per_acquisition: number | null;
}

interface Kpis {
  totalEvents: number;
  messagingConversations: number;
  metaInstantFormLeads: number;
  landingVisits: number;
  landingSubmissions: number;
  exactAttribution: number;
  knownSourceEvents: number;
  unknownEvents: number;
  spendCoveredEvents: number | null;
  whatsappConversations: number;
  messengerConversations: number;
  instagramConversations: number;
  websiteConversations: number;
  landingViews: number;
  landingUniqueVisitors: number;
  landingSessions: number;
  landingFormStarts: number;
  landingPageSubmissions: number;
  spend: number | null;
  spendThrough: string | null;
  spendCoveredSpend: number | null;
  costPerExactAcquisition: number | null;
}

interface Confidence {
  exact: number;
  declared: number;
  inferred: number;
  unknown: number;
}

interface LandingPageRow {
  landing_page_id: string;
  landing_page_name: string;
  landing_page_slug: string;
  views: number;
  unique_visitors: number;
  sessions: number;
  form_starts: number;
  submissions: number;
  declared_submissions: number;
  inferred_submissions: number;
  exact_submissions: number;
  conversion_rate: number | null;
}

interface LandingBreakdownRow {
  landing_page_id: string;
  source: string;
  medium: string;
  campaign: string;
  content: string;
  method: string;
  views: number;
  unique_visitors: number;
  sessions: number;
  form_starts: number;
  submissions: number;
}

interface LandingSessionRow {
  session_id: string;
  landing_page_id: string;
  first_seen: string;
  source: string;
  medium: string;
  campaign: string;
  content: string;
  method: string;
  referrer_type: string;
  view_count: number;
  form_started: boolean;
  submitted: boolean;
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
  creative_id: string;
  creative_name: string;
  leads: number;
  exact_leads: number;
  organic_leads: number;
  ad_spend: number | null;
}

interface MatrixCell {
  source_platform: string;
  destination_channel: string;
  events: number;
  exact: number;
  unknown: number;
  landing_visits: number;
  exact_campaigns: number;
  spend: number;
  conversion_rate: number | null;
}

interface Blocker {
  id: string;
  ok: boolean;
  en: string;
  ar: string;
}

interface PerformanceResponse {
  configured: boolean;
  empty?: boolean;
  businessTimeZone?: string;
  period?: { from: string; to: string };
  kpis?: Kpis;
  confidence?: Confidence;
  metaAggregate?: { available: boolean; platformLeads: number; campaigns: number };
  unmatched?: {
    withoutExactCampaign: number;
    exactWithoutSpendRows: number;
    spendingCampaignsWithoutAcquisitions: number;
    spendWithoutAcquisitions: number;
  };
  hierarchy?: Record<PerformanceGrain, PerfRow[]>;
  messaging?: {
    destination_channel: string;
    source_category: string;
    conversations: number;
    exact: number;
  }[];
  matrix?: MatrixCell[];
  forms?: FormRow[];
  aggregateLeadsByCampaign?: {
    campaign_id: string;
    campaign_name: string;
    platform_leads: number;
    spend: number;
  }[];
  landing?: {
    pages: LandingPageRow[];
    breakdown: LandingBreakdownRow[];
    sessions: LandingSessionRow[];
    pointingCampaigns: {
      landing_page_id: string;
      campaigns: { campaign_id: string; campaign_name: string }[];
    }[];
    unresolvedCreativeUrls: number;
  };
  today?: {
    date: string;
    kpis: Kpis;
    confidence: Confidence;
    topCampaign: PerfRow | null;
    topCreative: PerfRow | null;
    topLandingPage: LandingPageRow | null;
    topMetaLeadForm: { form_id: string; form_name: string; leads: number } | null;
  };
  blockers?: Blocker[];
}

const SOURCE_CATEGORY: Record<string, Copy> = {
  meta_referral: { en: "Meta referral", ar: "إحالة إعلان Meta" },
  website_chat: { en: "Website chat (UTM / token)", ar: "دردشة الموقع (UTM / توكن)" },
  direct_or_organic: { en: "Direct / organic (proven)", ar: "مباشر / عضوي (مثبت)" },
  unknown: { en: "Unknown", ar: "غير معروف" },
};

const METHOD: Record<string, Copy> = {
  utm: { en: "UTM (declared)", ar: "UTM (مُعلن)" },
  tracking_token: { en: "Tracking token (declared)", ar: "توكن تتبع (مُعلن)" },
  referrer: { en: "Referrer (inferred)", ar: "المُحيل (مُستنتج)" },
  direct: { en: "Direct", ar: "مباشر" },
  unknown: { en: "Unknown", ar: "غير معروف" },
};

const n = (value: unknown): number => Number(value ?? 0) || 0;
const money = (value: number | null | undefined) => (value == null ? "—" : fmtUSD(value));
const rate = (value: number | null | undefined) => (value == null ? "—" : fmtPct(value * 100, 1));
const costPer = (spend: number, events: number) =>
  spend > 0 && events > 0 ? Math.round((spend / events) * 100) / 100 : null;

/** A headline figure that opens its own definition, like every card on the dashboard. */
function Figure({
  id,
  index,
  tone,
  icon,
  title,
  value,
  sub,
  definition,
  formula,
  caveat,
  loading,
  hero,
  compact,
}: {
  id: string;
  index: number;
  tone: AnyTone;
  icon: ReactNode;
  title: string;
  value: string;
  sub?: string;
  definition: string;
  formula?: string;
  caveat?: string;
  loading: boolean;
  hero?: boolean;
  compact?: boolean;
}) {
  return (
    <MetricDetailTrigger
      detail={{
        id: `acquisition_performance.${id}`,
        title,
        value,
        tone,
        icon,
        definition,
        formula,
        caveat,
      }}
      card={{ index, sub, subWrap: true, loading, hero, compact }}
    />
  );
}

function Crumb({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-text hover:border-brand"
    >
      {children}
      <X size={12} aria-hidden />
    </button>
  );
}

export type AcquisitionPerformanceView = "overview" | "landing" | "forms";

export function AcquisitionPerformance({
  view = "overview",
  before,
}: {
  view?: AcquisitionPerformanceView;
  /** Rendered after the provider evidence, before the view's own sections. */
  before?: ReactNode;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const { data, isLoading, error } = useApi<PerformanceResponse>("/api/acquisition/performance");

  if (error) {
    return (
      <Card padded className="text-sm text-danger">
        {A ? "تعذر تحميل تحليل الاستحواذ: " : "Acquisition performance could not load: "}
        {(error as Error).message}
      </Card>
    );
  }
  if (data && !data.configured) {
    return (
      <Card padded className="text-sm text-text-muted">
        {A ? "قاعدة بيانات الاستحواذ غير مهيأة." : "The acquisition database is not configured."}
      </Card>
    );
  }

  return (
    <>
      {view === "overview" ? (
        <>
          <ProviderEvidence blockers={data?.blockers} loading={isLoading} A={A} />
          {before}
          <TodaySection data={data} loading={isLoading} A={A} />
          <PeriodKpis data={data} loading={isLoading} A={A} />
          <MessagingAcquisition data={data} loading={isLoading} A={A} />
          <SourceDestinationMatrix data={data} loading={isLoading} A={A} />
        </>
      ) : null}
      {view === "landing" ? <LandingPerformance data={data} loading={isLoading} A={A} /> : null}
      {view === "forms" ? <MetaFormAnalysis data={data} loading={isLoading} A={A} /> : null}
    </>
  );
}

type SectionProps = { data: PerformanceResponse | undefined; loading: boolean; A: boolean };

function ProviderEvidence({
  blockers,
  loading,
  A,
}: {
  blockers: Blocker[] | undefined;
  loading: boolean;
  A: boolean;
}) {
  if (loading || !blockers?.length) return null;
  const missing = blockers.filter((item) => !item.ok);
  return (
    <PageSection
      title={A ? "حالة دليل المزودين" : "Provider evidence status"}
      icon={<AlertTriangle size={16} />}
      tone={missing.length ? "amber" : "mint"}
      hint={
        A
          ? "الإسناد الدقيق يحتاج دليلًا من Meta. ما يلي يشرح لماذا قد تكون أرقام الحملات صفرًا."
          : "Exact attribution needs evidence from Meta. This explains why campaign counts may be zero."
      }
    >
      <Card padded className="space-y-2">
        {blockers.map((item) => (
          <div key={item.id} className="flex items-start gap-2 text-xs leading-relaxed">
            <Pill tone={item.ok ? "success" : "warning"}>
              {item.ok ? (A ? "يعمل" : "Working") : A ? "متوقف" : "Blocked"}
            </Pill>
            <span className="text-text-muted">{A ? item.ar : item.en}</span>
          </div>
        ))}
      </Card>
    </PageSection>
  );
}

function TodaySection({ data, loading, A }: SectionProps) {
  const today = data?.today;
  const k = today?.kpis;
  const top = (name: string, id: string, detail: string) =>
    name || id ? (
      <div>
        <div className="truncate text-sm font-semibold text-text">{name || id}</div>
        {id && name ? <div className="font-mono text-[11px] text-text-muted">{id}</div> : null}
        <div className="text-xs text-text-muted">{detail}</div>
      </div>
    ) : (
      <div className="text-xs text-text-muted">
        {A ? "لا يوجد إسناد دقيق اليوم" : "No exact attribution today"}
      </div>
    );
  const exactLabel = (value: number) =>
    A ? `${fmtNum(value)} استحواذ دقيق` : `${fmtNum(value)} exact acquisitions`;
  return (
    <PageSection
      title={A ? `اليوم · ${today?.date ?? ""}` : `Today · ${today?.date ?? ""}`}
      icon={<CalendarDays size={16} />}
      tone="violet"
      hint={
        A
          ? `يوم العمل بتوقيت ${data?.businessTimeZone ?? "Africa/Cairo"}، بغض النظر عن الفترة المختارة.`
          : `The business day in ${data?.businessTimeZone ?? "Africa/Cairo"}, whatever period is selected.`
      }
    >
      <div className="space-y-3">
        <KpiRow>
          <Figure
            id="today_total"
            index={0}
            hero
            tone="violet"
            icon={<Layers size={17} />}
            title={A ? "استحواذ اليوم" : "Today's acquisitions"}
            value={fmtNum(k?.totalEvents)}
            sub={A ? "محادثات + عملاء + إرسالات" : "Conversations + leads + submissions"}
            definition={
              A
                ? "محادثات Chatwoot الجديدة وعملاء نماذج Meta وإرسالات صفحات الهبوط في يوم العمل الحالي. الزيارات ليست استحواذًا."
                : "New Chatwoot conversations, Meta form leads and landing submissions in the current business day. Visits are not acquisitions."
            }
            loading={loading}
          />
          <Figure
            id="today_messaging"
            index={1}
            tone="mint"
            icon={<MessagesSquare size={17} />}
            title={A ? "المراسلة" : "Messaging"}
            value={fmtNum(k?.messagingConversations)}
            sub={`WA ${fmtNum(k?.whatsappConversations)} · Msg ${fmtNum(k?.messengerConversations)} · IG ${fmtNum(k?.instagramConversations)} · Web ${fmtNum(k?.websiteConversations)}`}
            definition={
              A
                ? "محادثات Chatwoot الجديدة اليوم على كل القنوات."
                : "New Chatwoot conversations today on every channel."
            }
            loading={loading}
          />
          <Figure
            id="today_meta_forms"
            index={2}
            tone="sky"
            icon={<FileText size={17} />}
            title={A ? "نماذج Meta" : "Meta forms"}
            value={fmtNum(k?.metaInstantFormLeads)}
            sub={A ? "سجلات عملاء فعلية" : "Real lead records"}
            definition={
              A
                ? "سجلات عملاء Meta Lead Ads الفعلية بمعرّف العميل اليوم."
                : "Real Meta Lead Ads records with their own lead ID today."
            }
            caveat={
              A
                ? "أرقام Meta المجمّعة لا تُحسب هنا."
                : "Meta's aggregate lead totals are never counted here."
            }
            loading={loading}
          />
          <Figure
            id="today_landing_submissions"
            index={3}
            tone="amber"
            icon={<MousePointerClick size={17} />}
            title={A ? "إرسالات صفحات الهبوط" : "Landing submissions"}
            value={fmtNum(k?.landingSubmissions)}
            sub={A ? `${fmtNum(k?.landingViews)} مشاهدة` : `${fmtNum(k?.landingViews)} views`}
            definition={
              A
                ? "نماذج صفحات الهبوط التي أكد Odoo إرسالها اليوم."
                : "Landing page forms Odoo confirmed as submitted today."
            }
            loading={loading}
          />
          <Figure
            id="today_exact"
            index={4}
            tone="sky"
            icon={<ShieldCheck size={17} />}
            title={A ? "إسناد دقيق" : "Exact attributed"}
            value={fmtNum(k?.exactAttribution)}
            sub={A ? "بمعرّف المزود" : "Provider ID"}
            definition={
              A
                ? "استحواذ اليوم الذي أثبت المزود معرّف حملته."
                : "Today's acquisitions whose campaign ID was proven by the provider."
            }
            loading={loading}
          />
          <Figure
            id="today_unknown"
            index={5}
            tone="rose"
            icon={<HelpCircle size={17} />}
            title={A ? "غير معروف" : "Unknown"}
            value={fmtNum(k?.unknownEvents)}
            sub={A ? "بلا دليل مصدر" : "No source evidence"}
            definition={
              A
                ? "استحواذ اليوم بلا دليل مصدر. لا يُسمى عضويًا."
                : "Today's acquisitions without source evidence. Never called organic."
            }
            loading={loading}
          />
        </KpiRow>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card padded>
            <div className="mb-1 text-xs font-semibold text-text-muted">
              {A ? "أعلى حملة" : "Top campaign"}
            </div>
            {top(
              today?.topCampaign?.campaign_name ?? "",
              today?.topCampaign?.campaign_id ?? "",
              exactLabel(n(today?.topCampaign?.exact_acquisitions)),
            )}
          </Card>
          <Card padded>
            <div className="mb-1 text-xs font-semibold text-text-muted">
              {A ? "أعلى مادة إعلانية" : "Top creative"}
            </div>
            {top(
              today?.topCreative?.creative_name ?? "",
              today?.topCreative?.creative_id ?? "",
              exactLabel(n(today?.topCreative?.exact_acquisitions)),
            )}
          </Card>
          <Card padded>
            <div className="mb-1 text-xs font-semibold text-text-muted">
              {A ? "أعلى صفحة هبوط" : "Top landing page"}
            </div>
            {today?.topLandingPage ? (
              top(
                today.topLandingPage.landing_page_name,
                "",
                A
                  ? `${fmtNum(today.topLandingPage.submissions)} إرسال · ${fmtNum(today.topLandingPage.views)} مشاهدة`
                  : `${fmtNum(today.topLandingPage.submissions)} submissions · ${fmtNum(today.topLandingPage.views)} views`,
              )
            ) : (
              <div className="text-xs text-text-muted">
                {A ? "لا زيارات اليوم" : "No visits today"}
              </div>
            )}
          </Card>
          <Card padded>
            <div className="mb-1 text-xs font-semibold text-text-muted">
              {A ? "أعلى نموذج Meta" : "Top Meta lead form"}
            </div>
            {today?.topMetaLeadForm ? (
              top(
                today.topMetaLeadForm.form_name,
                today.topMetaLeadForm.form_id,
                A
                  ? `${fmtNum(today.topMetaLeadForm.leads)} عميل`
                  : `${fmtNum(today.topMetaLeadForm.leads)} leads`,
              )
            ) : (
              <div className="text-xs text-text-muted">
                {A ? "لا سجلات عملاء Meta اليوم" : "No Meta lead records today"}
              </div>
            )}
          </Card>
          <Card padded>
            <div className="mb-1 text-xs font-semibold text-text-muted">
              {A ? "صرف Meta اليوم" : "Meta spend today"}
            </div>
            <div className="text-sm font-semibold text-text">{money(k?.spend)}</div>
            <div className="text-xs text-text-muted">
              {k?.spendThrough
                ? A
                  ? `آخر مزامنة بيانات إعلانات: ${k.spendThrough}`
                  : `Ad data synced through ${k.spendThrough}`
                : A
                  ? "لم تُزامن بيانات صرف اليوم بعد"
                  : "No spend synced for today yet"}
            </div>
          </Card>
          <Card padded>
            <div className="mb-1 text-xs font-semibold text-text-muted">
              {A ? "تكلفة الاستحواذ الدقيق" : "Cost per exact acquisition"}
            </div>
            <div className="text-sm font-semibold text-text">
              {money(k?.costPerExactAcquisition)}
            </div>
            <div className="text-xs text-text-muted">
              {A
                ? "صرف الحملات ذات الإسناد الدقيق ÷ استحواذها الدقيق"
                : "Spend of exactly attributed campaigns ÷ their exact acquisitions"}
            </div>
          </Card>
        </div>
      </div>
    </PageSection>
  );
}

function PeriodKpis({ data, loading, A }: SectionProps) {
  const k = data?.kpis;
  const c = data?.confidence;
  const agg = data?.metaAggregate;
  const card = (
    index: number,
    tone: AnyTone,
    icon: ReactNode,
    title: string,
    value: string,
    sub: string,
    definition: string,
  ) => (
    <Figure
      key={title}
      id={`period_${index}`}
      index={index}
      tone={tone}
      icon={icon}
      title={title}
      value={value}
      sub={sub}
      definition={definition}
      compact={index > 3}
      loading={loading}
    />
  );
  return (
    <PageSection
      title={A ? "مؤشرات الفترة" : "Period KPIs"}
      icon={<BarChart3 size={16} />}
      tone="sky"
      hint={
        A
          ? `${data?.period?.from ?? ""} → ${data?.period?.to ?? ""}. الأحداث فعلية؛ أرقام Meta المجمّعة منفصلة ولا تُضاف.`
          : `${data?.period?.from ?? ""} → ${data?.period?.to ?? ""}. Events are individual records; Meta's aggregate figures are separate and never added.`
      }
    >
      <div className="space-y-3">
        <KpiRow>
          {card(
            0,
            "violet",
            <Layers size={17} />,
            A ? "إجمالي الاستحواذ" : "Total acquisitions",
            fmtNum(k?.totalEvents),
            A ? "محادثات + عملاء Meta + إرسالات" : "Conversations + Meta leads + submissions",
            A
              ? "محادثات Chatwoot وعملاء نماذج Meta وإرسالات صفحات الهبوط في الفترة. الزيارات حركة مرور وليست استحواذًا."
              : "Chatwoot conversations, Meta form leads and landing submissions in the period. Visits are traffic, not acquisitions.",
          )}
          {card(
            1,
            "mint",
            <MessagesSquare size={17} />,
            A ? "محادثات المراسلة" : "Messaging conversations",
            fmtNum(k?.messagingConversations),
            A ? "كل قنوات Chatwoot" : "Every Chatwoot channel",
            A
              ? "كل محادثة Chatwoot جديدة سجلها الإسناد في الفترة."
              : "Every new Chatwoot conversation recorded by attribution in the period.",
          )}
          {card(
            2,
            "sky",
            <FileText size={17} />,
            A ? "عملاء نماذج Meta" : "Meta instant form leads",
            fmtNum(k?.metaInstantFormLeads),
            A ? "سجلات فعلية فقط" : "Real lead records only",
            A
              ? "سجلات Meta Lead Ads الفعلية بمعرّف العميل. أرقام Meta المجمّعة منفصلة."
              : "Real Meta Lead Ads records with a lead ID. Meta's aggregate totals are separate.",
          )}
          {card(
            3,
            "amber",
            <MousePointerClick size={17} />,
            A ? "إرسالات صفحات الهبوط" : "Landing page submissions",
            fmtNum(k?.landingSubmissions),
            A ? "مؤكدة من Odoo" : "Confirmed by Odoo",
            A
              ? "نماذج صفحات الهبوط المتتبعة التي أكد Odoo إرسالها."
              : "Tracked landing page forms Odoo confirmed as submitted.",
          )}
        </KpiRow>
        <KpiRow>
          {card(
            4,
            "mint",
            <MessagesSquare size={17} />,
            A ? "محادثات واتساب" : "WhatsApp conversations",
            fmtNum(k?.whatsappConversations),
            A ? "صناديق واتساب" : "WhatsApp inboxes",
            A
              ? "محادثات على صناديق واتساب في Chatwoot."
              : "Conversations on Chatwoot WhatsApp inboxes.",
          )}
          {card(
            5,
            "mint",
            <MessagesSquare size={17} />,
            A ? "محادثات ماسنجر" : "Messenger conversations",
            fmtNum(k?.messengerConversations),
            A ? "صفحات فيسبوك" : "Facebook Pages",
            A
              ? "محادثات على صناديق صفحات فيسبوك في Chatwoot."
              : "Conversations on Chatwoot Facebook Page inboxes.",
          )}
          {card(
            6,
            "mint",
            <MessagesSquare size={17} />,
            A ? "محادثات إنستغرام" : "Instagram conversations",
            fmtNum(k?.instagramConversations),
            A ? "رسائل إنستغرام" : "Instagram DM",
            A
              ? "محادثات على صناديق إنستغرام في Chatwoot."
              : "Conversations on Chatwoot Instagram inboxes.",
          )}
          {card(
            7,
            "mint",
            <Globe2 size={17} />,
            A ? "محادثات الموقع" : "Website conversations",
            fmtNum(k?.websiteConversations),
            A ? "ويدجت ومجد" : "Widget and Majed",
            A
              ? "محادثات ويدجت الموقع وصندوق مجد (API) في Chatwoot."
              : "Conversations on the website widget and the Majed (API) inbox.",
          )}
        </KpiRow>
        <KpiRow>
          {card(
            8,
            "sky",
            <ShieldCheck size={17} />,
            A ? "دقيق" : "Exact attributed",
            fmtNum(c?.exact),
            A ? "معرّف حملة من المزود" : "Provider campaign ID",
            A
              ? "استحواذ أثبت المزود معرّف حملته مباشرة."
              : "Acquisitions whose campaign ID the provider proved directly.",
          )}
          {card(
            9,
            "sky",
            <CheckCircle2 size={17} />,
            A ? "مُعلن" : "Declared",
            fmtNum(c?.declared),
            A ? "UTM أو توكن تتبع" : "UTM or tracking token",
            A
              ? "استحواذ مصدره UTM أو توكن تتبع وضعه صاحب الرابط."
              : "Acquisitions sourced from UTM parameters or a tracking token set by whoever built the link.",
          )}
          {card(
            10,
            "sky",
            <Target size={17} />,
            A ? "مُستنتج" : "Inferred",
            fmtNum(c?.inferred),
            A ? "من المُحيل" : "From the referrer",
            A
              ? "استحواذ مصدره مستنتج من الموقع المُحيل."
              : "Acquisitions whose source is inferred from the referring site.",
          )}
          {card(
            11,
            "rose",
            <HelpCircle size={17} />,
            A ? "غير معروف" : "Unknown attribution",
            fmtNum(c?.unknown),
            A ? "لا يُسمى عضويًا" : "Never called organic",
            A
              ? "استحواذ بلا دليل مصدر. لا يُعاد تصنيفه عضويًا."
              : "Acquisitions with no source evidence. Never relabelled organic.",
          )}
        </KpiRow>
        <KpiRow>
          {card(
            12,
            "amber",
            <Eye size={17} />,
            A ? "زيارات صفحات الهبوط" : "Landing visits",
            fmtNum(k?.landingSessions),
            A
              ? `${fmtNum(k?.landingViews)} مشاهدة · ${fmtNum(k?.landingUniqueVisitors)} زائر فريد`
              : `${fmtNum(k?.landingViews)} views · ${fmtNum(k?.landingUniqueVisitors)} unique visitors`,
            A
              ? "جلسات صفحات الهبوط المتتبعة التي بدأت في الفترة."
              : "Tracked landing page sessions that started in the period.",
          )}
          {card(
            13,
            "amber",
            <MousePointerClick size={17} />,
            A ? "بدء النموذج" : "Landing form starts",
            fmtNum(k?.landingFormStarts),
            A ? "تفاعل مع نموذج الصفحة" : "Interacted with the page form",
            A
              ? "جلسات تفاعل فيها الزائر مع نموذج الصفحة في الفترة."
              : "Sessions where the visitor interacted with the page form in the period.",
          )}
          {card(
            14,
            "amber",
            <MousePointerClick size={17} />,
            A ? "إرسالات الهبوط" : "Landing submissions",
            fmtNum(k?.landingPageSubmissions),
            A ? "حسب وقت الإرسال" : "By submission time",
            A
              ? "إرسالات النماذج المؤكدة حسب وقت الإرسال."
              : "Confirmed form submissions by submission time.",
          )}
          {card(
            15,
            "sky",
            <BarChart3 size={17} />,
            A ? "عملاء Meta (مجمّع)" : "Meta aggregate leads",
            agg?.available ? fmtNum(agg.platformLeads) : "—",
            A
              ? `تقارير Meta · ${fmtNum(agg?.campaigns)} حملة · ليست سجلات`
              : `Meta-reported · ${fmtNum(agg?.campaigns)} campaigns · not records`,
            A
              ? "نتائج نماذج العملاء كما تبلغ عنها Meta في بيانات الإعلانات المتزامنة. رقم مجمّع لا يُضاف إلى الأحداث."
              : "Lead-form results as Meta reports them in synced ad data. An aggregate that is never added to events.",
          )}
        </KpiRow>
        <KpiRow>
          {card(
            16,
            "amber",
            <DollarSign size={17} />,
            A ? "صرف Meta" : "Meta spend",
            money(k?.spend),
            k?.spendThrough
              ? A
                ? `حتى ${k.spendThrough}`
                : `Synced through ${k.spendThrough}`
              : A
                ? "لا بيانات صرف"
                : "No spend data",
            A
              ? "صرف إعلانات Meta في بيانات الإعلانات المتزامنة للفترة."
              : "Meta ad spend in the synced ad data for the period.",
          )}
          {card(
            17,
            "amber",
            <DollarSign size={17} />,
            A ? "استحواذ مغطى بالصرف" : "Spend-covered acquisitions",
            k?.spendCoveredEvents == null ? "—" : fmtNum(k.spendCoveredEvents),
            A ? "حملة دقيقة لها صرف" : "Exact campaign with spend",
            A
              ? "استحواذ دقيق لحملته صرف مسجل في الفترة."
              : "Exact acquisitions whose campaign has recorded spend in the period.",
          )}
          {card(
            18,
            "amber",
            <DollarSign size={17} />,
            A ? "صرف الحملات الدقيقة" : "Spend of exact campaigns",
            money(k?.spendCoveredSpend),
            A ? "ربط بمعرّف الحملة فقط" : "Joined on campaign ID only",
            A
              ? "صرف الحملات التي لها استحواذ دقيق واحد على الأقل، بالربط على معرّف الحملة."
              : "Spend of campaigns with at least one exact acquisition, joined on campaign ID.",
          )}
          {card(
            19,
            "violet",
            <DollarSign size={17} />,
            A ? "تكلفة الاستحواذ الدقيق" : "Cost per exact acquisition",
            money(k?.costPerExactAcquisition),
            A ? "— حتى يوجد إسناد دقيق" : "— until exact attribution exists",
            A
              ? "صرف الحملات الدقيقة ÷ استحواذها الدقيق. لا يظهر رقم دون إسناد دقيق."
              : "Spend of exact campaigns ÷ their exact acquisitions. No figure without exact attribution.",
          )}
        </KpiRow>
        <Card padded className="text-xs leading-relaxed text-text-muted">
          <span className="font-semibold text-text">{A ? "الفئات: " : "Categories: "}</span>
          {A
            ? "دقيق = معرّف حملة صادر من المزود · مُعلن = UTM أو توكن تتبع · مُستنتج = المُحيل · غير معروف = لا دليل · مجمّع Meta = تقارير المنصة وليست أحداثًا."
            : "EXACT = provider-issued campaign ID · DECLARED = UTM or tracking token · INFERRED = referrer · UNKNOWN = no evidence · AGGREGATE META = platform reporting, not events."}
        </Card>
      </div>
    </PageSection>
  );
}

function MessagingAcquisition({ data, loading, A }: SectionProps) {
  const k = data?.kpis;
  const byCategory = useMemo(() => {
    const totals: Record<string, { conversations: number; exact: number }> = {};
    for (const row of data?.messaging ?? []) {
      const item = totals[row.source_category] ?? { conversations: 0, exact: 0 };
      item.conversations += row.conversations;
      item.exact += row.exact;
      totals[row.source_category] = item;
    }
    return ["meta_referral", "website_chat", "direct_or_organic", "unknown"].map((key) => ({
      key,
      ...(totals[key] ?? { conversations: 0, exact: 0 }),
    }));
  }, [data]);
  const channels = [
    { label: A ? "واتساب" : "WhatsApp", value: n(k?.whatsappConversations) },
    { label: A ? "ماسنجر" : "Messenger", value: n(k?.messengerConversations) },
    { label: A ? "إنستغرام" : "Instagram", value: n(k?.instagramConversations) },
    { label: A ? "الموقع" : "Website", value: n(k?.websiteConversations) },
  ];
  const topBy = (grain: PerformanceGrain, name: (row: PerfRow) => string) =>
    (data?.hierarchy?.[grain] ?? [])
      .filter((row) => row.conversations > 0)
      .sort((a, b) => b.conversations - a.conversations)
      .slice(0, 8)
      .map((row) => ({ label: name(row), value: row.conversations }));
  const tops = [
    {
      id: "campaign",
      title: A ? "حسب الحملة" : "By campaign",
      data: topBy("campaign", (r) => r.campaign_name || r.campaign_id),
    },
    {
      id: "adset",
      title: A ? "حسب مجموعة الإعلان" : "By ad set",
      data: topBy("adset", (r) => r.adset_name || r.adset_id),
    },
    {
      id: "ad",
      title: A ? "حسب الإعلان" : "By ad",
      data: topBy("ad", (r) => r.ad_name || r.ad_id),
    },
    {
      id: "creative",
      title: A ? "حسب المادة" : "By creative",
      data: topBy("creative", (r) => r.creative_name || r.creative_id).filter((row) => row.label),
    },
  ];
  const exactConversations = byCategory.reduce((sum, row) => sum + row.exact, 0);

  return (
    <PageSection
      title={A ? "استحواذ المراسلة" : "Messaging acquisition"}
      icon={<MessagesSquare size={16} />}
      tone="mint"
      hint={
        A
          ? "محادثات Chatwoot الفعلية. أرقام محادثات Meta المجمّعة لا تُحسب هنا."
          : "Real Chatwoot conversations. Meta's aggregate messaging metrics are never counted here."
      }
    >
      <div className="space-y-3">
        <KpiRow>
          <Figure
            id="messaging_total"
            index={0}
            tone="mint"
            icon={<MessagesSquare size={17} />}
            title={A ? "إجمالي المحادثات" : "Total conversations"}
            value={fmtNum(k?.messagingConversations)}
            definition={
              A
                ? "محادثات Chatwoot الجديدة في الفترة."
                : "New Chatwoot conversations in the period."
            }
            loading={loading}
          />
          <Figure
            id="messaging_exact"
            index={1}
            tone="sky"
            icon={<ShieldCheck size={17} />}
            title={A ? "إسناد حملة Meta دقيق" : "Exact Meta campaign attribution"}
            value={fmtNum(exactConversations)}
            definition={
              A
                ? "محادثات أثبتت إحالة Meta معرّف حملتها."
                : "Conversations whose Meta referral proved the campaign ID."
            }
            caveat={
              A
                ? "يحتاج إحالة Meta داخل رسالة العميل الأولى."
                : "Needs a Meta referral inside the customer's first message."
            }
            loading={loading}
          />
          <Figure
            id="messaging_unknown"
            index={2}
            tone="rose"
            icon={<HelpCircle size={17} />}
            title={A ? "غير معروف" : "Unknown"}
            value={fmtNum(byCategory.find((row) => row.key === "unknown")?.conversations)}
            definition={A ? "محادثات بلا دليل مصدر." : "Conversations with no source evidence."}
            loading={loading}
          />
        </KpiRow>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card padded>
            <div className="mb-2 text-xs font-semibold text-text-muted">
              {A ? "حسب القناة" : "By channel"}
            </div>
            <HBarChart data={channels} format={fmtNum} height={180} showValues />
          </Card>
          <Card padded>
            <div className="mb-2 text-xs font-semibold text-text-muted">
              {A ? "حسب نوع المصدر" : "By source type"}
            </div>
            <div className="divide-y divide-border text-sm">
              {byCategory.map((row) => (
                <div key={row.key} className="flex items-center justify-between py-2">
                  <span>{label(SOURCE_CATEGORY, row.key, A)}</span>
                  <span className="font-semibold tabular-nums">{fmtNum(row.conversations)}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
              {A
                ? "دردشة الموقع كمصدر تحتاج UTM أو توكن تتبع؛ صندوق الموقع وحده قناة وليس مصدرًا."
                : "Website chat as a source needs UTM or a tracking token; the website inbox alone is a channel, not a source."}
            </p>
          </Card>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {tops.map((item) => (
            <Card padded key={item.id}>
              <div className="mb-2 text-xs font-semibold text-text-muted">{item.title}</div>
              {item.data.length ? (
                <HBarChart
                  data={item.data}
                  format={fmtNum}
                  height={Math.max(120, item.data.length * 32)}
                  showValues
                />
              ) : (
                <div className="py-4 text-xs text-text-muted">
                  {A
                    ? "لا محادثات بإسناد دقيق في الفترة"
                    : "No exactly attributed conversations in this period"}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </PageSection>
  );
}

function LandingPerformance({ data, loading, A }: SectionProps) {
  const [pageId, setPageId] = useState<string | null>(null);
  const [source, setSource] = useState<LandingBreakdownRow | null>(null);
  const landing = data?.landing;
  const campaignSpend = useMemo(
    () =>
      new Map(
        (data?.hierarchy?.campaign ?? []).map((row) => [row.campaign_id, row.spend] as const),
      ),
    [data],
  );
  const pointing = useMemo(
    () =>
      new Map(
        (landing?.pointingCampaigns ?? []).map(
          (item) => [item.landing_page_id, item.campaigns] as const,
        ),
      ),
    [landing],
  );

  const pageCols: Col<LandingPageRow>[] = [
    {
      key: "page",
      header: A ? "صفحة الهبوط" : "Landing page",
      always: true,
      sticky: true,
      render: (row) => (
        <div>
          <div className="text-text">{row.landing_page_name}</div>
          <div className="font-mono text-[11px] text-text-muted">
            /{row.landing_page_slug || row.landing_page_id}
          </div>
        </div>
      ),
      sortValue: (row) => row.landing_page_name,
    },
    {
      key: "views",
      header: A ? "المشاهدات" : "Views",
      align: "right",
      render: (row) => fmtNum(row.views),
      sortValue: (row) => row.views,
    },
    {
      key: "visitors",
      header: A ? "زوار فريدون" : "Unique visitors",
      align: "right",
      render: (row) => fmtNum(row.unique_visitors),
      sortValue: (row) => row.unique_visitors,
    },
    {
      key: "starts",
      header: A ? "بدء النموذج" : "Form starts",
      align: "right",
      render: (row) => fmtNum(row.form_starts),
      sortValue: (row) => row.form_starts,
    },
    {
      key: "submissions",
      header: A ? "الإرسالات" : "Submissions",
      align: "right",
      render: (row) => fmtNum(row.submissions),
      sortValue: (row) => row.submissions,
    },
    {
      key: "evidence",
      header: A ? "دقيق · مُعلن · مُستنتج" : "Exact · declared · inferred",
      align: "right",
      render: (row) =>
        `${fmtNum(row.exact_submissions)} · ${fmtNum(row.declared_submissions)} · ${fmtNum(row.inferred_submissions)}`,
    },
    {
      key: "rate",
      header: A ? "معدل التحويل" : "Conversion rate",
      align: "right",
      render: (row) => rate(row.conversion_rate),
      sortValue: (row) => row.conversion_rate ?? -1,
    },
    {
      key: "pointing",
      header: A ? "حملات Meta تشير للصفحة" : "Meta campaigns pointing here",
      render: (row) => {
        const campaigns = pointing.get(row.landing_page_id) ?? [];
        if (!campaigns.length) return "—";
        return (
          <span title={campaigns.map((c) => c.campaign_name || c.campaign_id).join("\n")}>
            {A ? `${fmtNum(campaigns.length)} حملة` : `${fmtNum(campaigns.length)} campaigns`}
          </span>
        );
      },
      sortValue: (row) => (pointing.get(row.landing_page_id) ?? []).length,
    },
    {
      key: "spend",
      header: A ? "صرف تلك الحملات (سياق)" : "Their spend (context)",
      align: "right",
      render: (row) => {
        const campaigns = pointing.get(row.landing_page_id) ?? [];
        if (!campaigns.length) return "—";
        return fmtUSD(
          campaigns.reduce((sum, c) => sum + (campaignSpend.get(c.campaign_id) ?? 0), 0),
        );
      },
    },
  ];

  const breakdownRows = (landing?.breakdown ?? []).filter((row) => row.landing_page_id === pageId);
  const breakdownCols: Col<LandingBreakdownRow>[] = [
    {
      key: "source",
      header: A ? "المصدر" : "Source",
      always: true,
      render: (row) => row.source || "(not set)",
      sortValue: (row) => row.source,
    },
    { key: "medium", header: A ? "الوسيط" : "Medium", render: (row) => row.medium || "—" },
    {
      key: "campaign",
      header: A ? "الحملة (UTM)" : "Campaign (UTM)",
      render: (row) => row.campaign || "—",
    },
    { key: "content", header: A ? "المحتوى" : "Content", render: (row) => row.content || "—" },
    {
      key: "method",
      header: A ? "الدليل" : "Evidence",
      render: (row) => label(METHOD, row.method, A),
    },
    {
      key: "sessions",
      header: A ? "الجلسات" : "Sessions",
      align: "right",
      render: (row) => fmtNum(row.sessions),
      sortValue: (row) => row.sessions,
    },
    {
      key: "starts",
      header: A ? "بدء النموذج" : "Form starts",
      align: "right",
      render: (row) => fmtNum(row.form_starts),
      sortValue: (row) => row.form_starts,
    },
    {
      key: "submissions",
      header: A ? "الإرسالات" : "Submissions",
      align: "right",
      render: (row) => fmtNum(row.submissions),
      sortValue: (row) => row.submissions,
    },
    {
      key: "rate",
      header: A ? "التحويل" : "Conversion",
      align: "right",
      render: (row) => rate(row.sessions ? row.submissions / row.sessions : null),
    },
  ];

  const sessionRows = (landing?.sessions ?? []).filter(
    (row) =>
      row.landing_page_id === pageId &&
      (!source ||
        (row.source === source.source &&
          row.medium === source.medium &&
          row.campaign === source.campaign &&
          row.content === source.content)),
  );
  const sessionCols: Col<LandingSessionRow>[] = [
    {
      key: "seen",
      header: A ? "أول ظهور" : "First seen",
      always: true,
      render: (row) => row.first_seen,
      sortValue: (row) => row.first_seen,
    },
    {
      key: "source",
      header: A ? "المصدر" : "Source",
      render: (row) => [row.source || "(not set)", row.medium].filter(Boolean).join(" / "),
    },
    { key: "campaign", header: A ? "الحملة" : "Campaign", render: (row) => row.campaign || "—" },
    { key: "content", header: A ? "المحتوى" : "Content", render: (row) => row.content || "—" },
    {
      key: "evidence",
      header: A ? "الدليل" : "Evidence",
      render: (row) =>
        `${label(METHOD, row.method, A)}${row.referrer_type ? ` · ${row.referrer_type}` : ""}`,
    },
    {
      key: "views",
      header: A ? "مشاهدات" : "Views",
      align: "right",
      render: (row) => fmtNum(row.view_count),
    },
    {
      key: "outcome",
      header: A ? "النتيجة" : "Outcome",
      render: (row) =>
        row.submitted ? (
          <Pill tone="success">{A ? "أرسل" : "Submitted"}</Pill>
        ) : row.form_started ? (
          <Pill tone="neutral">{A ? "بدأ النموذج" : "Started form"}</Pill>
        ) : (
          "—"
        ),
    },
  ];

  const selectedPage = landing?.pages.find((row) => row.landing_page_id === pageId);

  return (
    <PageSection
      title={A ? "أداء صفحات الهبوط" : "Landing page performance"}
      icon={<Globe2 size={16} />}
      tone="amber"
      hint={
        A
          ? "اضغط صفحة للمصادر، ثم مصدرًا للجلسات. حملات Meta التي تشير للصفحة سياق وجهة فقط، وليست دليلًا على مصدر الجلسة."
          : "Click a page for its sources, then a source for sessions. Meta campaigns pointing to a page are destination context only, not proof of where a session came from."
      }
    >
      <div className="space-y-3">
        <DataTable
          rows={landing?.pages ?? []}
          cols={pageCols}
          loading={loading}
          onRowClick={(row) => {
            setPageId(row.landing_page_id);
            setSource(null);
          }}
          rowKey={(row) => row.landing_page_id}
          csvFilename="engosoft-landing-page-performance.csv"
        />
        {landing?.unresolvedCreativeUrls ? (
          <p className="text-[11px] text-text-muted">
            {A
              ? `${fmtNum(landing.unresolvedCreativeUrls)} رابط مادة إعلانية مختصر (engosoft.com/r/…) لم يُحل إلى صفحة، لذلك لا يُحسب هنا.`
              : `${fmtNum(landing.unresolvedCreativeUrls)} creative short links (engosoft.com/r/…) are not resolved to a page, so they are not counted here.`}
          </p>
        ) : null}
        {selectedPage ? (
          <Card padded className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Crumb
                onClear={() => {
                  setPageId(null);
                  setSource(null);
                }}
              >
                {selectedPage.landing_page_name}
              </Crumb>
              {source ? (
                <Crumb onClear={() => setSource(null)}>
                  {[source.source || "(not set)", source.medium, source.campaign]
                    .filter(Boolean)
                    .join(" / ")}
                </Crumb>
              ) : null}
            </div>
            {source ? (
              <DataTable
                rows={sessionRows}
                cols={sessionCols}
                rowKey={(row) => row.session_id}
                csvFilename="engosoft-landing-sessions.csv"
                truncatedNote={
                  A
                    ? "يعرض آخر 500 جلسة في الفترة."
                    : "Shows up to the latest 500 sessions in the period."
                }
              />
            ) : (
              <DataTable
                rows={breakdownRows}
                cols={breakdownCols}
                onRowClick={(row) => setSource(row)}
                rowKey={(row) =>
                  `${row.source}:${row.medium}:${row.campaign}:${row.content}:${row.method}`
                }
                csvFilename="engosoft-landing-sources.csv"
              />
            )}
          </Card>
        ) : null}
      </div>
    </PageSection>
  );
}

const FORM_GRAINS = ["form", "campaign", "adset", "ad", "creative"] as const;
type FormGrain = (typeof FORM_GRAINS)[number];

interface FormAgg {
  key: string;
  form_id: string;
  form_name: string;
  page_name: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  creative_id: string;
  creative_name: string;
  leads: number;
  exact_leads: number;
  spend: number;
  hasSpend: boolean;
}

function MetaFormAnalysis({ data, loading, A }: SectionProps) {
  const [grain, setGrain] = useState<FormGrain>("form");
  const [parents, setParents] = useState<Partial<Record<FormGrain, string>>>({});
  const forms = useMemo(() => data?.forms ?? [], [data]);

  const rows = useMemo(() => {
    const idOf: Record<FormGrain, (row: FormRow) => string> = {
      form: (row) => row.form_id,
      campaign: (row) => row.campaign_id,
      adset: (row) => row.adset_id,
      ad: (row) => row.ad_id,
      creative: (row) => row.creative_id,
    };
    const level = FORM_GRAINS.indexOf(grain);
    const map = new Map<string, FormAgg & { adSpend: Map<string, number> }>();
    for (const row of forms) {
      if (
        !FORM_GRAINS.slice(0, level).every(
          (parent) => !parents[parent] || idOf[parent](row) === parents[parent],
        )
      )
        continue;
      const key = FORM_GRAINS.slice(0, level + 1)
        .map((g) => idOf[g](row))
        .join("|");
      const item = map.get(key) ?? {
        key,
        form_id: row.form_id,
        form_name: row.form_name,
        page_name: row.page_name,
        campaign_id: level >= 1 ? row.campaign_id : "",
        campaign_name: level >= 1 ? row.campaign_name : "",
        adset_id: level >= 2 ? row.adset_id : "",
        adset_name: level >= 2 ? row.adset_name : "",
        ad_id: level >= 3 ? row.ad_id : "",
        ad_name: level >= 3 ? row.ad_name : "",
        creative_id: level >= 4 ? row.creative_id : "",
        creative_name: level >= 4 ? row.creative_name : "",
        leads: 0,
        exact_leads: 0,
        spend: 0,
        hasSpend: false,
        adSpend: new Map<string, number>(),
      };
      item.leads += row.leads;
      item.exact_leads += row.exact_leads;
      // An ad's spend is counted once however many form rows share the ad.
      if (row.ad_id && row.ad_spend != null) item.adSpend.set(row.ad_id, row.ad_spend);
      map.set(key, item);
    }
    return [...map.values()].map(({ adSpend, ...item }) => {
      const spend = [...adSpend.values()].reduce((sum, value) => sum + value, 0);
      return { ...item, spend, hasSpend: adSpend.size > 0 };
    });
  }, [forms, grain, parents]);

  const drill = (row: FormAgg) => {
    const level = FORM_GRAINS.indexOf(grain);
    const next = FORM_GRAINS[level + 1];
    if (!next) return;
    const ids: Record<FormGrain, string> = {
      form: row.form_id,
      campaign: row.campaign_id,
      adset: row.adset_id,
      ad: row.ad_id,
      creative: row.creative_id,
    };
    setParents((current) => ({ ...current, [grain]: ids[grain] }));
    setGrain(next);
  };

  const grainLabels: Record<FormGrain, string> = {
    form: A ? "النموذج" : "Form",
    campaign: A ? "الحملة" : "Campaign",
    adset: A ? "مجموعة الإعلان" : "Ad set",
    ad: A ? "الإعلان" : "Ad",
    creative: A ? "المادة" : "Creative",
  };
  const level = FORM_GRAINS.indexOf(grain);
  const cols: Col<FormAgg>[] = [
    {
      key: "form",
      header: A ? "النموذج" : "Form",
      always: true,
      sticky: true,
      render: (row) => (
        <div>
          {nameWithId(row.form_name, row.form_id)}
          {row.page_name ? (
            <div className="text-[11px] text-text-muted">{row.page_name}</div>
          ) : null}
        </div>
      ),
    },
    ...(level >= 1
      ? [
          {
            key: "campaign",
            header: A ? "الحملة" : "Campaign",
            render: (row: FormAgg) => nameWithId(row.campaign_name, row.campaign_id),
          },
        ]
      : []),
    ...(level >= 2
      ? [
          {
            key: "adset",
            header: A ? "مجموعة الإعلان" : "Ad set",
            render: (row: FormAgg) => nameWithId(row.adset_name, row.adset_id),
          },
        ]
      : []),
    ...(level >= 3
      ? [
          {
            key: "ad",
            header: A ? "الإعلان" : "Ad",
            render: (row: FormAgg) => nameWithId(row.ad_name, row.ad_id),
          },
        ]
      : []),
    ...(level >= 4
      ? [
          {
            key: "creative",
            header: A ? "المادة" : "Creative",
            render: (row: FormAgg) => nameWithId(row.creative_name, row.creative_id),
          },
        ]
      : []),
    {
      key: "leads",
      header: A ? "العملاء" : "Leads",
      align: "right",
      render: (row) => fmtNum(row.leads),
      sortValue: (row) => row.leads,
    },
    {
      key: "exact",
      header: A ? "دقيق" : "Exact",
      align: "right",
      render: (row) => fmtNum(row.exact_leads),
      sortValue: (row) => row.exact_leads,
    },
    {
      key: "spend",
      header: A ? "صرف الإعلانات" : "Ad spend",
      align: "right",
      render: (row) => (row.hasSpend ? fmtUSD(row.spend) : "—"),
      sortValue: (row) => row.spend,
    },
    {
      key: "cpl",
      header: "CPL",
      align: "right",
      render: (row) => money(costPer(row.spend, row.leads)),
      sortValue: (row) => costPer(row.spend, row.leads) ?? Number.MAX_SAFE_INTEGER,
    },
  ];

  const aggregateCols: Col<NonNullable<PerformanceResponse["aggregateLeadsByCampaign"]>[number]>[] =
    [
      {
        key: "campaign",
        header: A ? "الحملة" : "Campaign",
        always: true,
        render: (row) => nameWithId(row.campaign_name, row.campaign_id),
        sortValue: (row) => row.campaign_name,
      },
      {
        key: "leads",
        header: A ? "عملاء (مجمّع من Meta)" : "Leads (Meta aggregate)",
        align: "right",
        render: (row) => fmtNum(row.platform_leads),
        sortValue: (row) => row.platform_leads,
      },
      {
        key: "spend",
        header: A ? "الصرف" : "Spend",
        align: "right",
        render: (row) => fmtUSD(row.spend),
        sortValue: (row) => row.spend,
      },
      {
        key: "cpl",
        header: A ? "CPL حسب Meta" : "Meta-reported CPL",
        align: "right",
        render: (row) => money(costPer(row.spend, row.platform_leads)),
      },
    ];

  return (
    <PageSection
      title={A ? "تحليل نماذج Meta الفورية" : "Meta instant form analysis"}
      icon={<FileText size={16} />}
      tone="sky"
      hint={
        A
          ? "المقاييس الفعلية من سجلات عملاء Meta الحقيقية فقط. اضغط صفًا للنزول: نموذج ← حملة ← مجموعة ← إعلان ← مادة."
          : "Event-level metrics use real Meta lead records only. Click a row to drill: form → campaign → ad set → ad → creative."
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="success">{A ? "فعلي" : "Event-level"}</Pill>
          <Segmented
            value={grain}
            onChange={(value) => setGrain(value)}
            options={FORM_GRAINS.map((value) => ({ value, label: grainLabels[value] }))}
          />
          {FORM_GRAINS.filter((g) => parents[g]).map((g) => (
            <Crumb
              key={g}
              onClear={() => {
                const index = FORM_GRAINS.indexOf(g);
                setParents(
                  Object.fromEntries(FORM_GRAINS.slice(0, index).map((p) => [p, parents[p]])),
                );
                setGrain(g);
              }}
            >
              {grainLabels[g]}: {parents[g]}
            </Crumb>
          ))}
        </div>
        <DataTable
          rows={rows}
          cols={cols}
          loading={loading}
          onRowClick={grain === "creative" ? undefined : drill}
          rowKey={(row) => row.key}
          csvFilename={`engosoft-meta-forms-${grain}.csv`}
          emptyState={
            <div className="py-6 text-center text-xs text-text-muted">
              {A
                ? "لا توجد سجلات عملاء Meta في الفترة. راجع حالة دليل المزودين أعلى الصفحة."
                : "No Meta lead records in this period. See provider evidence status at the top of the page."}
            </div>
          }
        />
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Pill tone="brand">{A ? "مجمّع من Meta" : "Aggregate from Meta"}</Pill>
          <span className="text-xs text-text-muted">
            {A
              ? "نتائج نماذج العملاء كما تبلغ عنها Meta لكل حملة. ليست سجلات عملاء ولا تُضاف إلى الأرقام أعلاه."
              : "Lead-form results as Meta reports them per campaign. Not lead records and never added to the figures above."}
          </span>
        </div>
        <DataTable
          rows={data?.aggregateLeadsByCampaign ?? []}
          cols={aggregateCols}
          loading={loading}
          rowKey={(row) => row.campaign_id}
          csvFilename="engosoft-meta-aggregate-leads.csv"
        />
      </div>
    </PageSection>
  );
}

function SourceDestinationMatrix({ data, loading, A }: SectionProps) {
  const cols: Col<MatrixCell>[] = [
    {
      key: "source",
      header: A ? "منصة المصدر" : "Source platform",
      always: true,
      sticky: true,
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
      sortValue: (row) => row.events,
    },
    {
      key: "exact",
      header: A ? "دقيق" : "Exact attributed",
      align: "right",
      render: (row) => fmtNum(row.exact),
      sortValue: (row) => row.exact,
    },
    {
      key: "unknown",
      header: A ? "غير معروف" : "Unknown",
      align: "right",
      render: (row) => fmtNum(row.unknown),
      sortValue: (row) => row.unknown,
    },
    {
      key: "visits",
      header: A ? "زيارات الهبوط" : "Landing visits",
      align: "right",
      render: (row) =>
        row.destination_channel === "landing_page" ? fmtNum(row.landing_visits) : "—",
      sortValue: (row) => row.landing_visits,
    },
    {
      key: "spend",
      header: A ? "صرف الحملات الدقيقة" : "Spend (exact campaigns)",
      align: "right",
      render: (row) => (row.exact_campaigns ? fmtUSD(row.spend) : "—"),
      sortValue: (row) => row.spend,
    },
    {
      key: "rate",
      header: A ? "معدل التحويل" : "Conversion rate",
      align: "right",
      render: (row) => rate(row.conversion_rate),
      sortValue: (row) => row.conversion_rate ?? -1,
    },
  ];
  const rows = (data?.matrix ?? [])
    .filter((row) => row.events > 0 || row.landing_visits > 0)
    .sort((a, b) => b.events - a.events || b.landing_visits - a.landing_visits);
  return (
    <PageSection
      title={A ? "مصفوفة المصدر × الوجهة" : "Source × destination matrix"}
      icon={<Network size={16} />}
      tone="violet"
      hint={
        A
          ? "الأحداث لا تشمل الزيارات. المصدر غير المعروف يبقى غير معروف. التحويل لصفحات الهبوط = الإرسالات ÷ الزيارات."
          : "Events exclude landing visits. An unknown source stays unknown. Landing conversion = submissions ÷ visits."
      }
    >
      <DataTable
        rows={rows}
        cols={cols}
        loading={loading}
        rowKey={(row) => `${row.source_platform}:${row.destination_channel}`}
        csvFilename="engosoft-source-destination-matrix.csv"
      />
    </PageSection>
  );
}
