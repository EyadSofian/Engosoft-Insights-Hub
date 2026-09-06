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
import { DashboardPageHeader, InsightCard, InsightRow, KpiRow } from "@/components/dashboard-bits";
import { useReportingPeriod } from "@/lib/use-reporting-period";
import { fmtNum, fmtPct, fmtUSDFull, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { AgentAnalyticsResult } from "@/lib/agent-analytics.server";
import type { Platform } from "@/lib/types";

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

function SocialMedia() {
  const reportingPeriod = useReportingPeriod();
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
  return (
    <div className="space-y-5">
      <DashboardPageHeader
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
      <KpiRow columns={5}>
        <KpiCard
          index={0}
          label={lang === "ar" ? "الظهور" : "Reach"}
          value={fmtNum(reach.impressions)}
          tone="brand"
          icon={<Radio size={15} />}
          sub={
            lang === "ar"
              ? "إجمالي مرات الظهور التي أبلغت عنها المنصات"
              : "Total impressions reported by the ad platforms"
          }
        />
        <KpiCard
          index={1}
          label={lang === "ar" ? "النقرات" : "Clicks"}
          value={fmtNum(reach.clicks)}
          tone="violet"
          icon={<MousePointerClick size={15} />}
          sub={
            reach.best
              ? `${lang === "ar" ? "أعلى منصة" : "Top platform"}: ${PLATFORM_LABEL[reach.best.platform] ?? reach.best.platform}`
              : undefined
          }
        />
        <KpiCard
          index={2}
          label={lang === "ar" ? "نسبة النقر" : "Click-through rate"}
          value={fmtPct(reach.ctr, 2)}
          tone="warning"
          icon={<BadgeCheck size={15} />}
          sub={
            lang === "ar"
              ? `${fmtNum(reach.clicks)} نقرة ÷ ${fmtNum(reach.impressions)} ظهور`
              : `${fmtNum(reach.clicks)} clicks ÷ ${fmtNum(reach.impressions)} impressions`
          }
        />
        <KpiCard
          index={3}
          label={lang === "ar" ? "العملاء من المصادر غير المدفوعة" : "Leads from non-paid sources"}
          value={fmtNum(organicTotals.leads)}
          tone="success"
          icon={<Users size={15} />}
          sub={
            lang === "ar"
              ? `${fmtNum(organicTotals.won)} صفقة مغلقة`
              : `${fmtNum(organicTotals.won)} closed`
          }
        />
        <KpiCard
          index={4}
          label={lang === "ar" ? "إيراد المصادر غير المدفوعة" : "Non-paid revenue"}
          value={fmtUSDFull(organicTotals.revenue)}
          tone="success"
          icon={<DollarSign size={15} />}
          sub={
            lang === "ar"
              ? "لا يُنسب لهذه المصادر أي إنفاق إعلاني"
              : "No ad spend is attributed to these sources"
          }
        />
      </KpiRow>

      <InsightRow>
        <InsightCard
          index={0}
          kind="best"
          eyebrow={lang === "ar" ? "أفضل منصة" : "Top platform"}
          title={
            reach.best
              ? `${PLATFORM_LABEL[reach.best.platform] ?? reach.best.platform}`
              : lang === "ar"
                ? "لا توجد منصة بها ظهور في الفترة"
                : "No platform recorded reach this period"
          }
          value={reach.best ? fmtNum(reach.best.impressions) : undefined}
          detail={
            reach.best
              ? lang === "ar"
                ? `${fmtNum(reach.best.clicksAll)} نقرة · ${fmtPct(reach.best.ctrAll, 2)} نسبة نقر`
                : `${fmtNum(reach.best.clicksAll)} clicks · ${fmtPct(reach.best.ctrAll, 2)} CTR`
              : undefined
          }
        />
        <InsightCard
          index={1}
          kind="note"
          eyebrow={lang === "ar" ? "أكبر مصدر غير مدفوع" : "Largest non-paid source"}
          title={
            organicTotals.top
              ? organicTotals.top.name
              : lang === "ar"
                ? "لا توجد مصادر غير مدفوعة في الفترة"
                : "No non-paid sources this period"
          }
          value={organicTotals.top ? fmtNum(organicTotals.top.leads) : undefined}
          detail={
            organicTotals.top
              ? lang === "ar"
                ? `${fmtNum(organicTotals.top.won)} صفقة · ${fmtUSDFull(organicTotals.top.revenue)} إيراد`
                : `${fmtNum(organicTotals.top.won)} won · ${fmtUSDFull(organicTotals.top.revenue)} revenue`
              : undefined
          }
          to="/organic"
          actionLabel={lang === "ar" ? "افتح الأورجانيك ←" : "Open Organic →"}
        />
        <InsightCard
          index={2}
          kind={awaitingReply > 0 ? "attention" : "opportunity"}
          eyebrow={lang === "ar" ? "سرعة الرد" : "Response speed"}
          title={
            awaitingReply > 0
              ? lang === "ar"
                ? "عملاء ما زالوا ينتظرون رداً"
                : "Customers still waiting for a reply"
              : lang === "ar"
                ? "لا يوجد عميل ينتظر رداً الآن"
                : "Nobody is waiting for a reply right now"
          }
          value={awaitingReply > 0 ? fmtNum(awaitingReply) : undefined}
          detail={
            chat?.chatwoot.ok === false
              ? lang === "ar"
                ? "مصدر المحادثات غير متاح حالياً، فهذه القراءة قد تكون ناقصة."
                : "The conversation source is unavailable, so this reading may be incomplete."
              : lang === "ar"
                ? `${fmtNum(openConversations)} محادثة مفتوحة الآن عبر ${fmtNum(moderators.length)} موظف`
                : `${fmtNum(openConversations)} conversations open now across ${fmtNum(moderators.length)} people`
          }
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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
              <KpiCard
                label={lang === "ar" ? "المحادثات" : "Conversations"}
                value={fmtNum(chat.summary.chatConversations)}
                icon={<MessageCircleMore size={16} />}
              />
              <KpiCard
                label={lang === "ar" ? "تم حلها" : "Resolved"}
                value={fmtNum(chat.summary.chatResolved)}
                icon={<BadgeCheck size={16} />}
              />
              <KpiCard
                label={lang === "ar" ? "تنتظر رد" : "Awaiting reply"}
                value={fmtNum(chat.summary.chatAwaitingReply)}
                icon={<Clock3 size={16} />}
                hero={(chat.summary.chatAwaitingReply ?? 0) > 0}
              />
              <KpiCard
                label={lang === "ar" ? "محادثات مفتوحة الآن" : "Open now"}
                value={fmtNum(chat.summary.chatOpenConversations)}
                icon={<Inbox size={16} />}
              />
              <KpiCard
                label={lang === "ar" ? "بدون موظف" : "Unassigned"}
                value={fmtNum(chat.chatwoot.unassignedConversations)}
                icon={<Users size={16} />}
              />
              <KpiCard
                label={lang === "ar" ? "أول رد" : "First response"}
                value={duration(chat.summary.chatAverageFirstResponseSeconds, lang)}
                icon={<MousePointerClick size={16} />}
              />
            </div>

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
