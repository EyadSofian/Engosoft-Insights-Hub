import { useMemo, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  BarChart3,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  Megaphone,
  MousePointerClick,
  Radio,
  Sparkles,
  Trophy,
} from "lucide-react";
import { fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { CreativeAnalyticsRow, PlatformSourceHealth } from "@/lib/types";
import { PlatformBadges } from "@/components/metric-bits";
import { Skeleton } from "@/components/ui-bits";

interface CreativeResponse {
  rows: CreativeAnalyticsRow[];
  health: PlatformSourceHealth;
  sync?: {
    mode: "meta-direct";
    requested: number;
    fetched: number;
    failed: number;
    persisted: boolean;
  } | null;
}

type CreativeSort = "won" | "leads" | "ctr" | "spend" | "roas";

const SORTS: Record<
  CreativeSort,
  { ar: string; en: string; value: (row: CreativeAnalyticsRow) => number }
> = {
  won: { ar: "الصفقات الرابحة", en: "Won deals", value: (row) => row.won },
  leads: { ar: "عملاء CRM", en: "CRM leads", value: (row) => row.crmLeads },
  ctr: { ar: "نسبة النقر", en: "CTR", value: (row) => row.ctrAll ?? -1 },
  spend: { ar: "الإنفاق", en: "Spend", value: (row) => row.spend ?? -1 },
  roas: { ar: "العائد", en: "ROAS", value: (row) => row.roas ?? -1 },
};

function mediaLabel(row: CreativeAnalyticsRow, lang: "ar" | "en") {
  const type = row.mediaType.toLowerCase();
  if (type.includes("video")) return lang === "ar" ? "فيديو / ريل" : "Video / reel";
  if (type.includes("carousel")) return lang === "ar" ? "كاروسيل" : "Carousel";
  if (type.includes("image")) return lang === "ar" ? "صورة" : "Image";
  if (type.includes("text")) return lang === "ar" ? "نصي" : "Text";
  return lang === "ar" ? "النوع غير محدد" : "Type unavailable";
}

function CreativeMedia({ row }: { row: CreativeAnalyticsRow }) {
  const [failed, setFailed] = useState(false);
  const { lang } = useI18n();
  const preview = row.imageUrl || row.thumbnailUrl;
  const video = row.videoUrl;

  if (video && !failed) {
    return (
      <video
        className="h-full w-full object-cover"
        controls
        preload="metadata"
        poster={preview || undefined}
        onError={() => setFailed(true)}
      >
        <source src={video} />
      </video>
    );
  }

  if (preview && !failed) {
    return (
      <img
        src={preview}
        alt={row.creativeName || row.headline || row.ad}
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }

  const isVideo = row.mediaType.toLowerCase().includes("video") || !!row.videoId;
  const Icon = isVideo ? Film : ImageIcon;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_top_left,var(--brand-soft),transparent_54%),linear-gradient(145deg,var(--surface-2),var(--surface))] px-6 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl border border-border bg-surface text-brand shadow-sm">
        <Icon size={22} />
      </span>
      <span className="text-[11px] leading-4 text-text-muted">
        {lang === "ar"
          ? "المعاينة البصرية لم تصل من Meta بعد"
          : "Visual preview has not synced from Meta yet"}
      </span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-surface-2/70 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-text-subtle">{label}</div>
      <div className="num mt-0.5 truncate text-[11.5px] font-semibold text-text">{value}</div>
    </div>
  );
}

function CreativeCard({
  row,
  rank,
  showWinner,
  showCampaign = false,
}: {
  row: CreativeAnalyticsRow;
  rank: number;
  showWinner: boolean;
  showCampaign?: boolean;
}) {
  const { lang } = useI18n();
  const previewUrl = row.permalinkUrl || row.landingPageUrl;
  const title =
    row.creativeName || row.ad || (lang === "ar" ? "كرياتيف بدون اسم" : "Unnamed creative");

  return (
    <article className="group overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md">
      <div className="relative aspect-[16/10] overflow-hidden border-b border-border bg-surface-2">
        <CreativeMedia row={row} />
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5 pointer-events-none">
          <span className="inline-flex items-center gap-1 rounded-full border border-white/40 bg-slate-950/70 px-2 py-1 text-[9.5px] font-semibold text-white shadow-sm backdrop-blur">
            {row.mediaType.includes("video") ? (
              <Film size={10} />
            ) : row.mediaType.includes("carousel") ? (
              <Images size={10} />
            ) : (
              <ImageIcon size={10} />
            )}
            {mediaLabel(row, lang)}
          </span>
          {showWinner && rank === 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-1 text-[9.5px] font-bold text-amber-950 shadow-sm">
              <Trophy size={10} />
              {lang === "ar" ? "الأفضل" : "Top"}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3 p-3">
        <div>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h5
                className="line-clamp-2 text-[12.5px] font-semibold leading-5 text-text"
                dir="auto"
                title={title}
              >
                {title}
              </h5>
              <p className="mt-0.5 truncate text-[9.5px] text-text-subtle" title={row.ad}>
                {showCampaign
                  ? `${lang === "ar" ? "الحملة" : "Campaign"}: ${row.campaign || "—"}`
                  : `${lang === "ar" ? "الإعلان" : "Ad"}: ${row.ad || "—"}`}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <PlatformBadges platforms={[row.platform]} />
              {showCampaign && row.status.toUpperCase() === "ACTIVE" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[8.5px] font-bold text-emerald-700">
                  <Radio size={8} />
                  {lang === "ar" ? "شغّال" : "Live"}
                </span>
              )}
            </div>
          </div>
          {row.headline && (
            <p className="mt-2 text-[11.5px] font-medium leading-5 text-text" dir="auto">
              {row.headline}
            </p>
          )}
          <p
            className={`mt-1 text-[11px] leading-5 ${row.body ? "line-clamp-3 text-text-muted" : "italic text-text-subtle"}`}
            dir="auto"
          >
            {row.body ||
              (lang === "ar"
                ? "نص الإعلان غير متاح في المصدر الحالي."
                : "Primary text is unavailable in the current source.")}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <Metric
            label={lang === "ar" ? "إنفاق" : "Spend"}
            value={row.spend === null ? "—" : fmtUSD(row.spend)}
          />
          <Metric label="CTR" value={fmtPct(row.ctrAll, 2)} />
          <Metric label={lang === "ar" ? "ليد CRM" : "CRM leads"} value={fmtNum(row.crmLeads)} />
          <Metric label={lang === "ar" ? "رابحة" : "Won"} value={fmtNum(row.won)} />
          <Metric label={lang === "ar" ? "إيراد" : "Revenue"} value={fmtUSD(row.revenue)} />
          <Metric label="ROAS" value={row.roas === null ? "—" : `${row.roas.toFixed(2)}×`} />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-2">
          <span
            className="num max-w-[68%] truncate text-[9px] text-text-subtle"
            title={row.creativeId}
          >
            ID {row.creativeId || "—"}
          </span>
          {previewUrl ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand hover:underline"
            >
              {lang === "ar" ? "فتح الأصل" : "Open source"}
              <ExternalLink size={10} />
            </a>
          ) : (
            <span className="text-[9.5px] text-text-subtle">
              {row.videoId ? `Video ${row.videoId}` : ""}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

export function CampaignCreativeGallery({
  campaignKey,
  campaignName,
}: {
  campaignKey: string;
  campaignName: string;
}) {
  const { lang } = useI18n();
  const [sort, setSort] = useState<CreativeSort>("won");
  const { data, isLoading, isError } = useApi<CreativeResponse>(
    `/api/ads-creatives?campaignKey=${encodeURIComponent(campaignKey)}`,
    { enabled: !!campaignKey },
  );
  const rows = useMemo(
    () => [...(data?.rows ?? [])].sort((a, b) => SORTS[sort].value(b) - SORTS[sort].value(a)),
    [data?.rows, sort],
  );
  const formatCounts = useMemo(() => {
    const counts = { image: 0, video: 0, carousel: 0, other: 0 };
    for (const row of rows) {
      const type = row.mediaType.toLowerCase();
      if (type.includes("video")) counts.video++;
      else if (type.includes("carousel")) counts.carousel++;
      else if (type.includes("image")) counts.image++;
      else counts.other++;
    }
    return counts;
  }, [rows]);

  return (
    <section className="rounded-2xl border border-border bg-surface-2/45 p-3 sm:p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-soft text-brand">
              <LayoutGrid size={16} />
            </span>
            <div>
              <h4 className="text-[13px] font-semibold text-text">
                {lang === "ar" ? "مكتبة محتوى الحملة" : "Campaign creative library"}
              </h4>
              <p className="text-[10px] text-text-subtle">
                {lang === "ar"
                  ? "الصورة والنص والنتيجة في مكان واحد"
                  : "Visual, copy and outcome in one place"}
              </p>
            </div>
          </div>
          {!isLoading && rows.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-[9.5px] text-text-muted">
              {data?.health.source === "api" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 font-semibold text-emerald-700">
                  <BadgeCheck size={11} />
                  {lang === "ar" ? "Meta API مباشر" : "Direct Meta API"}
                </span>
              )}
              <span className="rounded-full border border-border bg-surface px-2 py-1">
                {fmtNum(rows.length)} {lang === "ar" ? "كرياتيف" : "creatives"}
              </span>
              {formatCounts.image > 0 && (
                <span className="rounded-full border border-border bg-surface px-2 py-1">
                  {fmtNum(formatCounts.image)} {lang === "ar" ? "صورة" : "images"}
                </span>
              )}
              {formatCounts.video > 0 && (
                <span className="rounded-full border border-border bg-surface px-2 py-1">
                  {fmtNum(formatCounts.video)} {lang === "ar" ? "فيديو/ريل" : "videos/reels"}
                </span>
              )}
              {formatCounts.carousel > 0 && (
                <span className="rounded-full border border-border bg-surface px-2 py-1">
                  {fmtNum(formatCounts.carousel)} {lang === "ar" ? "كاروسيل" : "carousels"}
                </span>
              )}
            </div>
          )}
        </div>

        {rows.length > 1 && (
          <label className="flex items-center gap-2 text-[10px] text-text-muted">
            {lang === "ar" ? "رتّب حسب" : "Sort by"}
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as CreativeSort)}
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[10.5px] font-medium text-text outline-none focus:border-brand"
            >
              {(Object.keys(SORTS) as CreativeSort[]).map((key) => (
                <option key={key} value={key}>
                  {SORTS[key][lang]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-danger/20 bg-danger-soft px-3 py-4 text-[11px] text-danger">
          {lang === "ar"
            ? "تعذر تحميل محتوى الحملة دلوقتي. جرّب تحديث الصفحة."
            : "Campaign creatives could not be loaded. Refresh and try again."}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-4 py-7 text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-brand-soft text-brand">
            <MousePointerClick size={20} />
          </span>
          <h5 className="mt-3 text-[12px] font-semibold text-text">
            {lang === "ar"
              ? "مفيش Creative metadata للحملة دي لسه"
              : "No creative metadata for this campaign yet"}
          </h5>
          <p className="mx-auto mt-1 max-w-md text-[10.5px] leading-5 text-text-muted" dir="auto">
            {lang === "ar"
              ? `الحملة «${campaignName}» موجودة في أرقام الأداء، لكن Meta لم ترجع محتوى للإعلانات المطابقة حاليًا.`
              : `“${campaignName}” has performance data, but Meta returned no content for its matching ads.`}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.slice(0, 30).map((row, index) => (
            <CreativeCard
              key={`${row.platform}:${row.creativeId}:${row.adId}`}
              row={row}
              rank={index}
              showWinner={SORTS[sort].value(row) > 0}
            />
          ))}
        </div>
      )}

      {rows.length > 30 && (
        <p className="mt-3 text-center text-[10px] text-text-subtle">
          {lang === "ar"
            ? `معروض أول ٣٠ من ${fmtNum(rows.length)} كرياتيف.`
            : `Showing the first 30 of ${fmtNum(rows.length)} creatives.`}
        </p>
      )}
    </section>
  );
}

/**
 * Executive creative view for one course. The default scope is deliberately
 * limited to ads Meta currently reports as ACTIVE, so management sees what can
 * be acted on today before historical winners. The same endpoint keeps the
 * global date/channel filters and joins creative resources to CRM outcomes.
 */
export function CourseCreativeGallery({ courseName }: { courseName: string }) {
  const { lang } = useI18n();
  const [sort, setSort] = useState<CreativeSort>("won");
  const [scope, setScope] = useState<"live" | "all">("live");
  const { data, isLoading, isError } = useApi<CreativeResponse>(
    `/api/ads-creatives?course=${encodeURIComponent(courseName)}`,
    { enabled: !!courseName },
  );
  const allRows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const liveRows = useMemo(
    () => allRows.filter((row) => row.status.toUpperCase() === "ACTIVE"),
    [allRows],
  );
  const effectiveScope = scope === "live" && liveRows.length === 0 ? "all" : scope;
  const rows = useMemo(() => {
    const selected = effectiveScope === "live" ? liveRows : allRows;
    return [...selected].sort(
      (a, b) =>
        SORTS[sort].value(b) - SORTS[sort].value(a) || b.won - a.won || b.crmLeads - a.crmLeads,
    );
  }, [allRows, effectiveScope, liveRows, sort]);
  const campaignCount = useMemo(
    () => new Set(rows.map((row) => row.campaignKey || row.campaign).filter(Boolean)).size,
    [rows],
  );
  const mediaCounts = useMemo(
    () =>
      rows.reduce(
        (counts, row) => {
          const type = row.mediaType.toLowerCase();
          if (type.includes("video")) counts.video++;
          else if (type.includes("carousel")) counts.carousel++;
          else counts.image++;
          return counts;
        },
        { image: 0, video: 0, carousel: 0 },
      ),
    [rows],
  );
  const top = rows[0] ?? null;

  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
      <div
        className="relative overflow-hidden border-b border-border px-4 py-5 sm:px-6"
        style={{
          background:
            "radial-gradient(circle at 12% 20%, color-mix(in oklab, var(--brand) 16%, transparent), transparent 34%), linear-gradient(135deg, var(--surface), var(--surface-2))",
        }}
      >
        <div className="absolute -end-8 -top-10 h-36 w-36 rounded-full border border-brand/10" />
        <div className="relative flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/20">
                <Sparkles size={18} />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand">
                  {lang === "ar" ? "Creative intelligence" : "Creative intelligence"}
                </p>
                <h3 className="text-lg font-bold text-text sm:text-xl">
                  {lang === "ar" ? `أفضل كرياتيفات ${courseName}` : `Best ${courseName} creatives`}
                </h3>
              </div>
            </div>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-text-muted">
              {lang === "ar"
                ? "ترتيب موحّد من كل حملات الكورس: الصورة أو الريل، نص الإعلان، ونتيجته في CRM. العرض يبدأ بالإعلانات الشغّالة الآن."
                : "One ranking across every course campaign: visual, copy and CRM outcome. The view starts with ads that are live now."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-border bg-surface/85 p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setScope("live")}
                disabled={liveRows.length === 0}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-[10.5px] font-bold transition-colors ${
                  effectiveScope === "live"
                    ? "bg-brand text-white"
                    : "text-text-muted hover:text-text disabled:opacity-40"
                }`}
              >
                <Radio size={11} />
                {lang === "ar" ? "الشغّالة الآن" : "Live now"}
                <span className="num opacity-75">{fmtNum(liveRows.length)}</span>
              </button>
              <button
                type="button"
                onClick={() => setScope("all")}
                className={`min-h-8 rounded-lg px-3 text-[10.5px] font-bold transition-colors ${
                  effectiveScope === "all"
                    ? "bg-brand text-white"
                    : "text-text-muted hover:text-text"
                }`}
              >
                {lang === "ar" ? "كل الكرياتيفات" : "All creatives"} · {fmtNum(allRows.length)}
              </button>
            </div>
            <label className="flex min-h-10 items-center gap-2 rounded-xl border border-border bg-surface/85 px-3 text-[10px] text-text-muted shadow-sm">
              <BarChart3 size={12} className="text-brand" />
              {lang === "ar" ? "الأفضل حسب" : "Rank by"}
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as CreativeSort)}
                className="bg-transparent text-[10.5px] font-bold text-text outline-none"
              >
                {(Object.keys(SORTS) as CreativeSort[]).map((key) => (
                  <option key={key} value={key}>
                    {SORTS[key][lang]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-3 p-4 md:grid-cols-2 2xl:grid-cols-3 sm:p-5">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-[390px] rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <div className="m-4 rounded-2xl border border-danger/20 bg-danger-soft p-5 text-sm text-danger">
          {lang === "ar"
            ? "تعذر تحميل كرياتيفات الكورس دلوقتي. جرّب تحديث الصفحة."
            : "Course creatives could not be loaded. Refresh and try again."}
        </div>
      ) : rows.length === 0 ? (
        <div className="p-5">
          <div className="rounded-2xl border border-dashed border-border bg-surface-2/40 px-5 py-9 text-center">
            <Megaphone className="mx-auto text-brand" size={25} />
            <h4 className="mt-3 text-sm font-bold text-text">
              {lang === "ar" ? "مفيش كرياتيفات مرتبطة بالكورس" : "No course creatives found"}
            </h4>
            <p className="mt-1 text-xs text-text-muted">
              {lang === "ar"
                ? "هنظهرها هنا أول ما اسم الحملة أو الإعلان أو الكرياتيف يطابق اسم الكورس."
                : "They will appear when the campaign, ad or creative name matches this course."}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-2 border-b border-border bg-surface-2/30 p-3 sm:grid-cols-2 lg:grid-cols-4 sm:px-5">
            <CourseCreativeStat
              label={lang === "ar" ? "كرياتيف في العرض" : "Creatives in view"}
              value={fmtNum(rows.length)}
              icon={<LayoutGrid size={14} />}
            />
            <CourseCreativeStat
              label={lang === "ar" ? "حملات ممثلة" : "Campaigns represented"}
              value={fmtNum(campaignCount)}
              icon={<Megaphone size={14} />}
            />
            <CourseCreativeStat
              label={lang === "ar" ? "فيديو / ريل" : "Videos / reels"}
              value={fmtNum(mediaCounts.video)}
              icon={<Film size={14} />}
            />
            <CourseCreativeStat
              label={lang === "ar" ? "صور / كاروسيل" : "Images / carousel"}
              value={fmtNum(mediaCounts.image + mediaCounts.carousel)}
              icon={<Images size={14} />}
            />
          </div>

          {top && (
            <div className="mx-4 mt-4 flex flex-col gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 sm:mx-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <Trophy size={16} className="shrink-0 text-amber-600" />
                <p className="truncate text-xs text-text">
                  <strong>{lang === "ar" ? "متصدر العرض:" : "Current leader:"}</strong>{" "}
                  <span dir="auto">{top.creativeName || top.ad}</span>
                </p>
              </div>
              <span className="shrink-0 text-[10.5px] font-bold text-amber-700">
                {SORTS[sort][lang]}: {formatCreativeSortValue(top, sort)}
              </span>
            </div>
          )}

          <div className="grid gap-3 p-4 md:grid-cols-2 2xl:grid-cols-3 sm:p-5">
            {rows.slice(0, 24).map((row, index) => (
              <CreativeCard
                key={`${row.platform}:${row.creativeId}:${row.adId}`}
                row={row}
                rank={index}
                showWinner={SORTS[sort].value(row) > 0}
                showCampaign
              />
            ))}
          </div>
          {rows.length > 24 && (
            <p className="border-t border-border px-5 py-3 text-center text-[10.5px] text-text-muted">
              {lang === "ar"
                ? `معروض أفضل 24 من ${fmtNum(rows.length)} كرياتيف حسب الاختيار الحالي.`
                : `Showing the best 24 of ${fmtNum(rows.length)} creatives for the current ranking.`}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function CourseCreativeStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border/70 bg-surface px-3 py-2.5">
      <div>
        <p className="text-[9.5px] text-text-muted">{label}</p>
        <p className="num mt-0.5 text-base font-bold text-text">{value}</p>
      </div>
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-soft text-brand">
        {icon}
      </span>
    </div>
  );
}

function formatCreativeSortValue(row: CreativeAnalyticsRow, sort: CreativeSort) {
  if (sort === "won") return fmtNum(row.won);
  if (sort === "leads") return fmtNum(row.crmLeads);
  if (sort === "ctr") return fmtPct(row.ctrAll, 2);
  if (sort === "spend") return row.spend === null ? "—" : fmtUSD(row.spend);
  return row.roas === null ? "—" : `${row.roas.toFixed(2)}×`;
}
