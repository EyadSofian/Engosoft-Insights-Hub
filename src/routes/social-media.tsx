import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  AtSign,
  BadgeCheck,
  Clock3,
  DollarSign,
  Inbox,
  MessageCircleMore,
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
  PageHeader,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
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
  return (
    <div className="space-y-5">
      <PageHeader
        title={lang === "ar" ? "السوشيال ميديا والموديريشن" : "Social media & moderation"}
        subtitle={
          lang === "ar"
            ? "مكان واحد لأداء القنوات المدفوعة، مصادر التواصل غير المدفوعة، وسرعة متابعة محادثات Chatwoot."
            : "One workspace for paid channels, non-paid communication sources and Chatwoot follow-up speed."
        }
      />

      <Card className="overflow-hidden border-s-4 border-s-brand bg-[linear-gradient(110deg,var(--surface),var(--brand-soft))]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-bold text-brand">
              <Radio size={18} />
              {lang === "ar" ? "Social Command Center" : "Social Command Center"}
            </div>
            <p className="text-sm leading-7 text-text-muted">
              {lang === "ar"
                ? "نتيجة الإعلان موجودة في جزء القنوات، ونتيجة الناس التي وصلت من واتساب أو السوشيال بدون صرف موجودة في الأورجانيك، أما جودة الرد فتأتي مباشرة من Chatwoot."
                : "Paid channel outcomes, non-paid social/WhatsApp acquisition and Chatwoot response quality are kept separate and clearly sourced."}
            </p>
          </div>
          <div className="flex gap-2">
            <Pill tone="brand">Odoo</Pill>
            <Pill tone="brand">Ad platforms</Pill>
            <Pill tone={chat?.chatwoot.ok ? "success" : "warning"}>Chatwoot</Pill>
          </div>
        </div>
      </Card>

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
