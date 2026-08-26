import { useMemo, useState } from "react";
import { Link2, Link2Off, Loader2, Radio, RefreshCw, ShieldCheck } from "lucide-react";
import { Card, EmptyState, Notice, Pill, SectionTitle, Skeleton } from "@/components/ui-bits";
import { PLATFORM_LABEL, PLATFORMS } from "@/lib/constants";
import { fmtNum, fmtUSD, useI18n } from "@/lib/i18n";
import type { CampaignPlatformHealth, Platform } from "@/lib/types";
import { useApi } from "@/lib/use-api";

interface ActiveCampaign {
  key: string;
  name: string;
  platform: Platform;
  account: string;
  courseKey: string | null;
  course: string;
  owners: string[];
  linked: boolean;
  configuredStatus: string;
  effectiveStatus: string;
  servingStatus: string;
  activeAdsets: number;
  activeAds: number;
  checkedAt: string;
  spend: number;
  platformLeads: number | null;
  crmLeads: number;
  won: number;
  revenueUsd: number;
}

interface ActivityResponse {
  month: string;
  window: { from: string; to: string };
  definition: "official_status";
  source: string;
  generatedAt: string;
  platformHealth: CampaignPlatformHealth[];
  campaigns: ActiveCampaign[];
  linkedCount: number;
  unlinkedCount: number;
  courses: {
    key: string;
    label: string;
    owners: string[];
    activeCampaigns: number;
    platforms: Platform[];
    periodSpend: number;
    periodLeads: number;
  }[];
}

export function MediaPlanActivityPanel({ month }: { month: string }) {
  const { lang } = useI18n();
  const [platform, setPlatform] = useState<Platform | "all">("all");
  const [course, setCourse] = useState("all");
  const { data, isLoading, isFetching, error, refetch } = useApi<ActivityResponse>(
    `/api/media-plan-activity?month=${month}`,
  );

  const rows = useMemo(
    () =>
      (data?.campaigns ?? []).filter(
        (row) =>
          (platform === "all" || row.platform === platform) &&
          (course === "all" || (course === "unlinked" ? !row.linked : row.courseKey === course)),
      ),
    [data, platform, course],
  );

  if (isLoading && !data) return <Skeleton className="h-[420px]" />;
  if (error && !data) {
    return (
      <Notice tone="warning" title={lang === "ar" ? "تعذر فحص الحملات" : "Campaign check failed"}>
        <div>{(error as Error).message}</div>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-2 text-xs font-semibold underline"
        >
          {lang === "ar" ? "حاول تاني" : "Retry"}
        </button>
      </Notice>
    );
  }
  if (!data) return null;

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="p-4 sm:p-5">
        <SectionTitle
          hint={
            lang === "ar"
              ? "Active هنا من سويتش وحالة التشغيل الرسمية في Meta وTikTok وSnapchat وGoogle، مش استنتاج من الصرف. أرقام الأداء تتبع شهر الخطة المختار."
              : "Active comes from each platform's official switch and delivery state, never inferred from spend. Performance follows the selected plan month."
          }
          action={
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-brand disabled:opacity-50"
            >
              {isFetching ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {lang === "ar" ? "تحديث الحالة" : "Refresh status"}
            </button>
          }
        >
          <span className="inline-flex items-center gap-1.5">
            <Radio size={16} className="text-brand" />
            {lang === "ar" ? "الحملات Active المرتبطة بالخطة" : "Active campaigns linked to plan"}
          </span>
        </SectionTitle>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {PLATFORMS.map((item) => (
            <PlatformCard
              key={item}
              platform={item}
              health={data.platformHealth.find((row) => row.platform === item)}
              selected={platform === item}
              onClick={() => setPlatform((current) => (current === item ? "all" : item))}
            />
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Pill tone="success">
            <span className="inline-flex items-center gap-1">
              <Link2 size={12} /> {fmtNum(data.linkedCount)}{" "}
              {lang === "ar" ? "مربوطة بالخطة" : "linked to plan"}
            </span>
          </Pill>
          <Pill tone={data.unlinkedCount ? "warning" : "neutral"}>
            <span className="inline-flex items-center gap-1">
              <Link2Off size={12} /> {fmtNum(data.unlinkedCount)}{" "}
              {lang === "ar" ? "تحتاج ربط" : "need mapping"}
            </span>
          </Pill>
          <Pill tone="neutral">
            {lang === "ar" ? "آخر فحص" : "Checked"}:{" "}
            {data.generatedAt
              ? new Date(data.generatedAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")
              : "—"}
          </Pill>
        </div>
      </div>

      <div className="border-y border-border bg-surface-2/55 px-4 py-3 sm:px-5">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setCourse("all")}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${course === "all" ? "bg-brand text-white" : "border border-border bg-surface text-text-muted"}`}
          >
            {lang === "ar" ? "كل الدورات" : "All courses"}
          </button>
          {data.courses.map((row) => (
            <button
              key={row.key}
              type="button"
              onClick={() => setCourse(row.key)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${course === row.key ? "bg-brand text-white" : "border border-border bg-surface text-text-muted"}`}
            >
              {row.label} · {fmtNum(row.activeCampaigns)}
            </button>
          ))}
          {data.unlinkedCount > 0 && (
            <button
              type="button"
              onClick={() => setCourse("unlinked")}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${course === "unlinked" ? "bg-warning text-white" : "border border-warning/30 bg-warning-soft text-warning"}`}
            >
              {lang === "ar" ? "غير مربوطة" : "Unlinked"} · {fmtNum(data.unlinkedCount)}
            </button>
          )}
        </div>
      </div>

      {!rows.length ? (
        <div className="p-5">
          <EmptyState
            compact
            label={
              lang === "ar"
                ? "مفيش حملة Active رسمية مطابقة للفلتر ده دلوقتي."
                : "No officially active campaign matches this filter right now."
            }
          />
        </div>
      ) : (
        <>
          <div className="hidden table-wrap scroll-hint-x lg:block">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="bg-surface-2 text-[11px] text-text-muted">
                <tr>
                  {[
                    lang === "ar" ? "الحملة" : "Campaign",
                    lang === "ar" ? "المنصة" : "Platform",
                    lang === "ar" ? "الدورة" : "Course",
                    lang === "ar" ? "المسؤول" : "Owner",
                    lang === "ar" ? "حالة المنصة" : "Official state",
                    lang === "ar" ? "صرف الشهر" : "Month spend",
                    lang === "ar" ? "ليدز المنصة" : "Platform leads",
                    lang === "ar" ? "Won" : "Won",
                    lang === "ar" ? "إيراد" : "Revenue",
                  ].map((label) => (
                    <th key={label} className="px-3 py-3 text-start font-semibold">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={`${row.platform}:${row.key}`} className="hover:bg-surface-2/50">
                    <td className="max-w-80 px-3 py-3">
                      <div className="truncate font-semibold text-text" title={row.name}>
                        {row.name}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-text-subtle">
                        {row.account || "—"}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Pill tone="neutral">{PLATFORM_LABEL[row.platform][lang]}</Pill>
                    </td>
                    <td className="px-3 py-3">
                      {row.linked ? (
                        <span className="font-semibold text-text">{row.course}</span>
                      ) : (
                        <Pill tone="warning">{lang === "ar" ? "تحتاج ربط" : "Unlinked"}</Pill>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <OwnerPills owners={row.owners} />
                    </td>
                    <td className="px-3 py-3">
                      <Pill tone="success">Active</Pill>
                      <div className="mt-1 text-[9px] text-text-subtle">
                        {row.configuredStatus}
                        {row.servingStatus ? ` · ${row.servingStatus}` : ""}
                      </div>
                    </td>
                    <td className="num px-3 py-3">{fmtUSD(row.spend)}</td>
                    <td className="num px-3 py-3">
                      {row.platformLeads === null ? "—" : fmtNum(row.platformLeads)}
                    </td>
                    <td className="num px-3 py-3">{fmtNum(row.won)}</td>
                    <td className="num px-3 py-3 font-semibold text-text">
                      {fmtUSD(row.revenueUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 p-3 lg:hidden">
            {rows.map((row) => (
              <article
                key={`${row.platform}:${row.key}`}
                className="rounded-2xl border border-border p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-text">{row.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Pill tone="neutral">{PLATFORM_LABEL[row.platform][lang]}</Pill>
                      <Pill tone={row.linked ? "brand" : "warning"}>
                        {row.linked ? row.course : lang === "ar" ? "تحتاج ربط" : "Unlinked"}
                      </Pill>
                    </div>
                  </div>
                  <Pill tone="success">Active</Pill>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <Mini label={lang === "ar" ? "صرف الشهر" : "Spend"} value={fmtUSD(row.spend)} />
                  <Mini
                    label={lang === "ar" ? "ليدز" : "Leads"}
                    value={row.platformLeads === null ? "—" : fmtNum(row.platformLeads)}
                  />
                  <Mini
                    label={lang === "ar" ? "إيراد" : "Revenue"}
                    value={fmtUSD(row.revenueUsd)}
                  />
                </div>
                <div className="mt-2">
                  <OwnerPills owners={row.owners} />
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function PlatformCard({
  platform,
  health,
  selected,
  onClick,
}: {
  platform: Platform;
  health?: CampaignPlatformHealth;
  selected: boolean;
  onClick: () => void;
}) {
  const { lang } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-3 text-start transition-colors ${selected ? "border-brand bg-brand-soft" : "border-border bg-surface-2/60 hover:border-brand/40"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-text">{PLATFORM_LABEL[platform][lang]}</span>
        <ShieldCheck size={15} className={health?.ok ? "text-success" : "text-warning"} />
      </div>
      <div className="num mt-2 text-xl font-bold text-text">{fmtNum(health?.active ?? 0)}</div>
      <div className="mt-0.5 text-[10px] text-text-muted">
        {health?.ok
          ? lang === "ar"
            ? "متصلة · Active رسمي"
            : "Connected · officially active"
          : lang === "ar"
            ? "الربط يحتاج مراجعة"
            : "Connection needs review"}
      </div>
    </button>
  );
}

function OwnerPills({ owners }: { owners: string[] }) {
  if (!owners.length) return <span className="text-[10px] text-text-subtle">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {owners.map((owner) => (
        <Pill key={owner} tone="brand">
          {owner}
        </Pill>
      ))}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-2">
      <div className="text-[9px] text-text-subtle">{label}</div>
      <div className="num mt-1 text-xs font-bold text-text">{value}</div>
    </div>
  );
}
