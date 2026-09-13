import { createFileRoute } from "@tanstack/react-router";
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

interface AttributionSummary {
  configured: boolean;
  totals: AttributionTotals | null;
  campaigns: {
    platform: string;
    source: string;
    medium: string;
    campaign_id: string;
    campaign_name: string;
    branch_id: string;
    conversations: number;
    won: number;
    revenue: number | null;
  }[];
  sources: {
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
  source: string;
  medium: string;
  campaign_name: string;
  campaign_id: string;
  branch_name: string;
  branch_id: string;
  attribution_method: string;
  confidence: string;
  crm_status: string;
  crm_won: boolean;
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
      meta: [row.platform, row.branch_id].filter(Boolean).join(" · "),
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
        ? "المحادثات التي طريقة إسنادها ليست unknown"
        : "Conversations whose method is not unknown",
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
      title: ar ? "CPL — محادثة واتساب" : "CPL — WhatsApp conversation",
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
  const query = buildQuery(filters);
  const summary = useApi<AttributionSummary>(`/api/attribution/summary${query}`);
  const conversations = useApi<AttributionConversationsResponse>(
    `/api/attribution/conversations?limit=100${query ? `&${query.slice(1)}` : ""}`,
  );
  const data = summary.data;
  const totals = data?.totals;
  const A = lang === "ar";
  const period = reportingPeriod || (A ? "كل البيانات المسجلة" : "All recorded data");
  const metrics = attributionMetrics(totals, data, A);

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
      render: (row) => (row.crm_won ? (A ? "مغلق بنجاح" : "Won") : row.crm_status || "—"),
      sortValue: (row) => `${row.crm_won}:${row.crm_status}`,
    },
    {
      key: "revenue",
      header: A ? "الإيراد" : "Revenue",
      align: "right",
      render: (row) => fmtUSD(row.revenue),
      sortValue: (row) => row.revenue ?? -1,
    },
  ];

  return (
    <PageSections>
      <DashboardPageHeader
        icon={<MessagesSquare size={22} />}
        title={A ? "إسناد محادثات واتساب" : "Conversation attribution"}
        subtitle={
          A
            ? "من الإعلان أو الرابط إلى المحادثة ثم نتيجة CRM، دون افتراض مصدر غير مثبت."
            : "From ad or link to conversation and CRM outcome, without inventing unproven sources."
        }
        period={period}
        tone="violet"
      />

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
            detail={metrics.ctwa}
            card={{
              index: 2,
              sub: A ? "إحالات Meta الأصلية" : "Native Meta referrals",
              loading: summary.isLoading,
            }}
          />
          <MetricDetailTrigger
            detail={metrics.unknownRate}
            card={{
              index: 3,
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
                  [row.platform, row.source, row.medium].filter(Boolean).join(" · ") ||
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
            `${row.conversation_id} ${row.platform} ${row.source} ${row.campaign_name} ${row.branch_name}`
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
    </PageSections>
  );
}
