import { useMemo, useState } from "react";
import {
  BadgeCheck,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  MousePointerClick,
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
}: {
  row: CreativeAnalyticsRow;
  rank: number;
  showWinner: boolean;
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
                {lang === "ar" ? "الإعلان" : "Ad"}: {row.ad || "—"}
              </p>
            </div>
            <PlatformBadges platforms={[row.platform]} />
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
