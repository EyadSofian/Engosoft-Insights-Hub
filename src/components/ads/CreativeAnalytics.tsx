import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  CircleAlert,
  ExternalLink,
  Image as ImageIcon,
  Search,
  Sparkles,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import {
  Card,
  EmptyState,
  ErrorState,
  Notice,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import type {
  AcquisitionChannel,
  CreativeAnalyticsRow,
  GlobalFilters,
  PlatformSourceHealth,
} from "@/lib/types";

interface CreativeResponse {
  rows: CreativeAnalyticsRow[];
  health: PlatformSourceHealth;
  facets: {
    accounts: string[];
    campaigns: string[];
    adsets: string[];
    statuses: string[];
    reviewStatuses: string[];
  };
  appliedFilters: GlobalFilters;
}

type Focus =
  | "all"
  | "best_roas"
  | "best_ctr"
  | "highest_spend"
  | "worst"
  | "spend_no_conversions"
  | "leads_no_won";
type Sort = "spend" | "roas" | "ctr" | "revenue" | "name";

const sourceDate = (value: string, lang: "ar" | "en") => {
  if (!value || !Number.isFinite(Date.parse(value)))
    return lang === "ar" ? "غير متاح" : "Unavailable";
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

function focusRows(rows: CreativeAnalyticsRow[], focus: Focus): CreativeAnalyticsRow[] {
  switch (focus) {
    case "best_roas":
      return rows.filter((row) => row.roas !== null && row.spend !== null && row.spend > 0);
    case "best_ctr":
      return rows.filter(
        (row) => row.ctrAll !== null && row.impressions !== null && row.impressions > 0,
      );
    case "highest_spend":
      return rows.filter((row) => row.spend !== null && row.spend > 0);
    case "worst":
      return rows.filter((row) => row.spend !== null && row.spend > 0 && row.revenue < row.spend);
    case "spend_no_conversions":
      return rows.filter((row) => row.spend !== null && row.spend > 0 && row.platformLeads === 0);
    case "leads_no_won":
      return rows.filter((row) => row.crmLeads > 0 && row.won === 0);
    default:
      return rows;
  }
}

function sortRows(rows: CreativeAnalyticsRow[], sort: Sort, focus: Focus): CreativeAnalyticsRow[] {
  const value = (row: CreativeAnalyticsRow): number => {
    if (focus === "worst") return (row.spend ?? 0) - row.revenue;
    if (focus === "best_roas" || sort === "roas") return row.roas ?? -Infinity;
    if (focus === "best_ctr" || sort === "ctr") return row.ctrAll ?? -Infinity;
    if (sort === "revenue") return row.revenue;
    return row.spend ?? -Infinity;
  };
  return [...rows].sort((a, b) =>
    sort === "name" ? a.ad.localeCompare(b.ad) : value(b) - value(a) || a.ad.localeCompare(b.ad),
  );
}

export function CreativeAnalytics({ selected }: { selected?: AcquisitionChannel }) {
  const { lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<CreativeResponse>("/api/ads-creatives");
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<Focus>("all");
  const [sort, setSort] = useState<Sort>("spend");
  const [review, setReview] = useState("all");

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matched = (data?.rows ?? []).filter((row) => {
      if (review !== "all" && row.reviewStatus !== review) return false;
      if (!normalizedQuery) return true;
      return [row.headline, row.body, row.ad, row.campaign, row.adset, row.landingPageUrl]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });
    return sortRows(focusRows(matched, focus), sort, focus);
  }, [data?.rows, focus, query, review, sort]);

  if (isLoading || !data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-24" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[420px]" />
          <Skeleton className="h-[420px]" />
        </div>
      </div>
    );
  }
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const incompatible = selected === "organic" || (selected && selected !== "chatgpt");
  if (incompatible) {
    return (
      <Card>
        <EmptyState
          label={
            lang === "ar"
              ? "بيانات الكرياتيف المتصلة متاحة حاليًا لإعلانات ChatGPT"
              : "Connected creative metadata is currently available for ChatGPT Ads"
          }
          hint={
            lang === "ar"
              ? "اختار «الكل» أو «إعلانات ChatGPT» من شريط المنصات."
              : "Choose All or ChatGPT Ads in the platform switcher."
          }
        />
      </Card>
    );
  }

  if (!data.health.configured && !data.rows.length) {
    return (
      <Card className="overflow-hidden">
        <div className="mx-auto max-w-2xl py-8 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600">
            <Sparkles size={25} />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-text">
            {lang === "ar" ? "وصّل حساب إعلانات ChatGPT" : "Connect ChatGPT Ads"}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-text-muted">
            {lang === "ar"
              ? "أنشئ API key للقراءة من إعدادات Ads Manager، وبعدها أضفه كمتغير سري OPENAI_ADS_API_KEY. أسرار الحساب لا تصل للمتصفح."
              : "Create a read-capable API key in Ads Manager settings, then add it as the OPENAI_ADS_API_KEY secret. Account credentials never reach the browser."}
          </p>
          <code className="mt-4 inline-flex rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-text">
            OPENAI_ADS_API_KEY
          </code>
        </div>
      </Card>
    );
  }

  const focuses: { key: Focus; ar: string; en: string }[] = [
    { key: "all", ar: "كل الكرياتيف", en: "All creatives" },
    { key: "best_roas", ar: "أفضل ROAS", en: "Best ROAS" },
    { key: "best_ctr", ar: "أفضل CTR", en: "Best CTR" },
    { key: "highest_spend", ar: "أعلى إنفاق", en: "Highest spend" },
    { key: "worst", ar: "أكبر تسريب", en: "Worst return" },
    { key: "spend_no_conversions", ar: "إنفاق بلا نتائج", en: "Spend, no results" },
    { key: "leads_no_won", ar: "ليدز بلا صفقات", en: "Leads, no wins" },
  ];

  return (
    <div className="space-y-4">
      {data.health.source === "postgres-last-good" && (
        <Notice
          tone="warning"
          title={lang === "ar" ? "عرض آخر نسخة سليمة" : "Showing last-good data"}
          icon={<CircleAlert size={16} />}
        >
          {lang === "ar"
            ? "اتصال OpenAI Ads الحالي غير متاح. باقي الداشبورد مستمر، والكرياتيف المعروضة جاية من آخر نسخة PostgreSQL سليمة."
            : "The live OpenAI Ads connection is unavailable. The rest of the dashboard remains live, while these creatives come from the last good PostgreSQL snapshot."}
        </Notice>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600">
                <Sparkles size={18} />
              </span>
              <div>
                <h2 className="text-base font-semibold text-text">
                  {lang === "ar" ? "مكتبة كرياتيف ChatGPT" : "ChatGPT creative library"}
                </h2>
                <p className="text-xs text-text-muted">
                  {lang === "ar"
                    ? `${fmtNum(data.rows.length)} كرياتيف · آخر مزامنة ${sourceDate(data.health.syncedAt, lang)}`
                    : `${fmtNum(data.rows.length)} creatives · synced ${sourceDate(data.health.syncedAt, lang)}`}
                </p>
              </div>
            </div>
          </div>
          <Pill tone={data.health.ok ? "success" : "warning"}>
            {data.health.ok
              ? lang === "ar"
                ? "OpenAI API متصل"
                : "OpenAI API connected"
              : lang === "ar"
                ? "اتصال يحتاج مراجعة"
                : "Connection needs attention"}
          </Pill>
        </div>

        <div className="mt-5 flex gap-2 overflow-x-auto pb-1 scrollbar-none" role="tablist">
          {focuses.map((item) => (
            <button
              key={item.key}
              role="tab"
              aria-selected={focus === item.key}
              onClick={() => setFocus(item.key)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                focus === item.key
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
                  : "border-border text-text-muted hover:bg-surface-2"
              }`}
            >
              {item[lang]}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="relative block">
            <Search
              size={15}
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-text-subtle"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                lang === "ar" ? "دوّر في العنوان أو الحملة..." : "Search title or campaign..."
              }
              className="h-10 w-full rounded-lg border border-border bg-surface ps-9 pe-3 text-sm text-text outline-none focus:border-emerald-500"
            />
          </label>
          <select
            value={review}
            onChange={(event) => setReview(event.target.value)}
            aria-label={lang === "ar" ? "حالة المراجعة" : "Review status"}
            className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-emerald-500"
          >
            <option value="all">
              {lang === "ar" ? "كل حالات المراجعة" : "All review statuses"}
            </option>
            {data.facets.reviewStatuses.map((status) => (
              <option key={status} value={status}>
                {status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            aria-label={lang === "ar" ? "الترتيب" : "Sort"}
            className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-emerald-500"
          >
            <option value="spend">{lang === "ar" ? "الإنفاق" : "Spend"}</option>
            <option value="roas">ROAS</option>
            <option value="ctr">CTR</option>
            <option value="revenue">{lang === "ar" ? "التحصيل" : "Revenue"}</option>
            <option value="name">{lang === "ar" ? "الاسم" : "Name"}</option>
          </select>
        </div>
      </Card>

      {!rows.length ? (
        <Card>
          <EmptyState
            label={lang === "ar" ? "مفيش كرياتيف مطابقة" : "No matching creatives"}
            hint={
              data.rows.length
                ? lang === "ar"
                  ? "غيّر البحث أو فلتر التحليل."
                  : "Adjust search or the analysis filter."
                : lang === "ar"
                  ? "الحساب متصل لكن مفيش إعلانات متاحة مع الفلاتر الحالية."
                  : "The account is connected, but no ads are available under the current filters."
            }
          />
        </Card>
      ) : (
        <section>
          <SectionTitle
            hint={
              lang === "ar"
                ? "أداء المنصة وأرقام Odoo متجمعين على Ad ID ثابت؛ الشرطة معناها إن القياس غير متاح."
                : "Platform delivery and Odoo outcomes join on stable Ad ID; a dash means the metric is unavailable."
            }
          >
            {lang === "ar" ? `${fmtNum(rows.length)} نتيجة` : `${fmtNum(rows.length)} results`}
          </SectionTitle>
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {rows.map((row) => (
              <CreativeCard key={`${row.accountId}:${row.adId}`} row={row} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CreativeCard({ row }: { row: CreativeAnalyticsRow }) {
  const { lang } = useI18n();
  const approved = row.reviewStatus === "approved";
  const reviewTone = approved ? "success" : row.reviewStatus === "rejected" ? "danger" : "warning";
  const metric = (label: string, value: React.ReactNode) => (
    <div className="min-w-0 rounded-lg bg-surface-2 px-2.5 py-2">
      <dt className="truncate text-[10px] text-text-muted">{label}</dt>
      <dd className="num mt-0.5 truncate text-sm font-semibold text-text">{value}</dd>
    </div>
  );

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="relative aspect-[16/8.5] overflow-hidden border-b border-border bg-surface-2">
        {row.imageUrl ? (
          <img
            src={row.imageUrl}
            alt={row.headline || row.ad}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full place-items-center text-text-subtle">
            <span className="flex flex-col items-center gap-2 text-xs">
              <ImageIcon size={28} strokeWidth={1.5} />
              {lang === "ar" ? "معاينة الصورة غير متاحة" : "Image preview unavailable"}
            </span>
          </div>
        )}
        <div className="absolute start-3 top-3 flex gap-1.5">
          <Pill tone={reviewTone}>
            {approved && <BadgeCheck size={11} className="me-1" />}
            {row.reviewStatus ? row.reviewStatus.replaceAll("_", " ") : "—"}
          </Pill>
          {row.status && <Pill tone="neutral">{row.status}</Pill>}
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-text-subtle">
              {row.creativeType.replaceAll("_", " ") || "ChatGPT ad"}
            </p>
            <h3 className="mt-1 text-[15px] font-semibold leading-snug text-text" dir="auto">
              {row.headline || row.ad}
            </h3>
          </div>
          {row.landingPageUrl && (
            <a
              href={row.landingPageUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={lang === "ar" ? "فتح صفحة الهبوط" : "Open landing page"}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border text-text-muted transition-colors hover:border-emerald-500/40 hover:text-emerald-600"
            >
              <ExternalLink size={15} />
            </a>
          )}
        </div>
        {row.body && (
          <p className="mt-2 line-clamp-3 text-xs leading-5 text-text-muted" dir="auto">
            {row.body}
          </p>
        )}

        <div className="mt-3 space-y-1 text-[11px] text-text-muted">
          <p className="truncate" title={row.campaign}>
            <span className="text-text-subtle">{lang === "ar" ? "الحملة:" : "Campaign:"}</span>{" "}
            {row.campaign || "—"}
          </p>
          <p className="truncate" title={`${row.adset} · ${row.ad}`}>
            <span className="text-text-subtle">{lang === "ar" ? "المجموعة:" : "Ad group:"}</span>{" "}
            {row.adset || "—"} · {row.ad}
          </p>
        </div>

        <dl className="mt-4 grid grid-cols-4 gap-1.5">
          {metric(lang === "ar" ? "الإنفاق" : "Spend", fmtUSDFull(row.spend))}
          {metric("CTR", fmtPct(row.ctrAll, 2))}
          {metric(lang === "ar" ? "ليدز" : "Leads", fmtNum(row.crmLeads))}
          {metric("ROAS", row.roas === null ? "—" : `${row.roas.toFixed(2)}×`)}
        </dl>

        <div className="mt-3 grid grid-cols-3 divide-x divide-border rounded-lg border border-border py-2 text-center rtl:divide-x-reverse">
          <SmallMetric
            label={lang === "ar" ? "ظهور" : "Impressions"}
            value={fmtNum(row.impressions)}
          />
          <SmallMetric label={lang === "ar" ? "نقرات" : "Clicks"} value={fmtNum(row.clicksAll)} />
          <SmallMetric label={lang === "ar" ? "تحصيل" : "Revenue"} value={fmtUSD(row.revenue)} />
        </div>

        {row.reviewReason && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-danger-soft px-2.5 py-2 text-[11px] text-danger">
            <CircleAlert size={13} className="mt-0.5 shrink-0" />
            <span>{row.reviewReason.replaceAll("_", " ")}</span>
          </p>
        )}
        {row.landingPageUrl && (
          <a
            href={row.landingPageUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex items-center justify-between gap-2 text-[11px] text-text-subtle hover:text-emerald-600"
          >
            <span className="truncate" dir="ltr">
              {row.landingPageUrl}
            </span>
            <ArrowUpRight size={13} className="shrink-0" />
          </a>
        )}
      </div>
    </Card>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-1.5">
      <div className="text-[9.5px] text-text-subtle">{label}</div>
      <div className="num mt-0.5 truncate text-xs font-semibold text-text">{value}</div>
    </div>
  );
}
