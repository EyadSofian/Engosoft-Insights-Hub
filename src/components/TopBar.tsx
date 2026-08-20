import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  Languages,
  MoreHorizontal,
  Moon,
  RefreshCw,
  SlidersHorizontal,
  Sun,
  X,
} from "lucide-react";
import { fmtDateTime, useI18n } from "@/lib/i18n";
import {
  activeDimensionCount,
  filterStore,
  setAcquisitionFilter,
  useFilters,
} from "@/lib/filter-store";
import { approvedReportingEnd } from "@/lib/reporting-window";
import { useModalGuard } from "@/lib/ui-store";
import type { AcquisitionChannel, CampaignObjective, DataHealth, Platform } from "@/lib/types";
import { ACQUISITION_CHANNEL_LABEL, ACQUISITION_CHANNELS } from "@/lib/constants";
import { acquisitionChannel } from "@/lib/acquisition-channel";
import { Segmented } from "./ui-bits";
import { DateFilter, DateRangePanel } from "./DateFilter";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export interface FiltersResp {
  accounts: {
    name: string;
    platform: Platform;
    objective: CampaignObjective;
    spend: number;
    platformLeads: number | null;
  }[];
  accountNames: string[];
  adDimensions: {
    platform: Platform;
    account: string;
    campaign: string;
    adset: string;
    ad: string;
  }[];
  campaigns: string[];
  adsets: string[];
  ads: string[];
  sources: string[];
  mainCategories: string[];
  salesTeams: string[];
  salespeople: string[];
  courses: string[];
  companies: string[];
  defaultRange: { from: string; to: string };
  years: number[];
  coverage: {
    adsDateMin: string;
    adsDateMax: string;
    crmDateMin: string;
    crmDateMax: string;
    revenueDateMin: string;
    revenueDateMax: string;
  };
  /** Freshest upstream sync. Written by the sync jobs — Refresh cannot move it. */
  syncedAt: string;
  oldestSyncedAt: string;
  tabSyncs: { key: string; label: string; syncedAt: string }[];
  /** When this app last pulled the sheet. This is what Refresh updates. */
  fetchedAt: string;
  health: DataHealth;
  fetchErrors: string[];
  /** Tabs served from the last good copy because this pull failed or was empty. */
  staleTabs: string[];
  counts: {
    ads: number;
    crm: number;
    accounting: number;
    /** Compatibility counters retained by the API during migration. */
    invoiced: number;
    sales: number;
    lost: number;
  };
}

export function useFiltersData() {
  return useQuery<FiltersResp>({
    queryKey: ["filters"],
    queryFn: async () => {
      const res = await fetch("/api/filters");
      if (!res.ok) throw new Error("Failed to load filters");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
}

/** Newest date present anywhere in the sheet — presets anchor to it, not to the clock. */
function latestDate(data?: FiltersResp): string | undefined {
  if (!data) return undefined;
  const c = data.coverage;
  const latest = [c.adsDateMax, c.crmDateMax, c.revenueDateMax].filter(Boolean).sort().pop();
  return approvedReportingEnd(latest);
}

const sortedUnique = (values: string[]): string[] =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));

export function TopBar({ title }: { title?: string }) {
  const { t, lang, setLang, theme, toggleTheme } = useI18n();
  const filters = useFilters();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data } = useFiltersData();
  const activeCount = activeDimensionCount(filters);
  const latest = latestDate(data);

  // Accountant-managed FX settings must survive navigation and reload on every page.
  useEffect(() => {
    filterStore.hydrateFx();
  }, []);

  // Anchor the default year window to the newest available source date so a
  // preset never silently hides recent valid rows.
  useEffect(() => {
    if (!latest || filters.from || filters.to || filters.range || filterStore.isManualDateMode())
      return;
    filterStore.setPreset("year", latest);
  }, [latest, filters.from, filters.to, filters.range]);

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/refresh", { method: "POST" });
      await qc.invalidateQueries();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <header className="app-topbar sticky top-0 z-30 glass border-b border-border pad-safe-x [--pad-x:0.875rem] sm:[--pad-x:1.5rem]">
        <div className="py-2 sm:py-3 flex items-center gap-2 sm:gap-3">
          {/* Desktop shows the logo in the sidebar; mobile needs branding here.
              The page title itself lives in each page's PageHeader, so the bar
              stays a controls strip and never repeats the heading. */}
          <div className="flex shrink-0 items-center gap-2 min-w-0">
            <span className="lg:hidden shrink-0 font-semibold text-[14px] sm:text-[15px] tracking-tight text-text">
              ENGOSOFT
            </span>
            {title && (
              <h1 className="text-base sm:text-lg font-semibold text-text truncate min-w-0">
                {title}
              </h1>
            )}
          </div>

          {/* Below sm only the two controls a reader reaches for on a phone stay
              on the bar — filters and refresh. Everything else moves into the
              overflow menu rather than shrinking below a usable tap size, which
              is what used to squeeze the wordmark off the left edge at 320px. */}
          <div className="ms-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
            <SyncBadge data={data} />

            <Link
              to="/guide"
              className="hidden sm:inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface transition-colors hover:bg-surface-2 active:scale-[0.97]"
              aria-label={lang === "ar" ? "دليل الاستخدام" : "User guide"}
              title={lang === "ar" ? "دليل الاستخدام" : "User guide"}
            >
              <BookOpen size={16} />
            </Link>

            <button
              onClick={() => setSheetOpen(true)}
              className="relative inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-2.5 text-sm transition-colors hover:bg-surface-2 active:scale-[0.97] sm:h-10 sm:min-w-0 sm:rounded-lg sm:px-3 cursor-pointer"
              aria-label={t("filters")}
            >
              <SlidersHorizontal size={16} />
              <span className="hidden sm:inline">{t("filters")}</span>
              {activeCount > 0 && (
                <span
                  className="absolute -top-1 -end-1 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full text-[10px] font-bold text-white num"
                  style={{ background: "var(--accent)" }}
                >
                  {activeCount}
                </span>
              )}
            </button>

            <button
              onClick={doRefresh}
              disabled={refreshing}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface transition-colors hover:bg-surface-2 active:scale-[0.97] sm:h-10 sm:w-10 sm:rounded-lg cursor-pointer disabled:opacity-60"
              aria-label={t("refresh")}
              title={t("refresh")}
            >
              <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
            </button>

            <button
              onClick={toggleTheme}
              className="hidden sm:inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface transition-colors hover:bg-surface-2 active:scale-[0.97] cursor-pointer"
              aria-label={t("theme")}
              title={t("theme")}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            <button
              onClick={() => setLang(lang === "ar" ? "en" : "ar")}
              className="hidden sm:inline-flex h-10 items-center justify-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-sm font-medium transition-colors hover:bg-surface-2 active:scale-[0.97] cursor-pointer"
              aria-label="Toggle language"
            >
              <Languages size={16} />
              <span>{lang === "ar" ? "EN" : "ع"}</span>
            </button>

            <OverflowMenu data={data} />
          </div>
        </div>

        {/* Period and platform stay visible on every screen — the most-used controls.
            The date control is now a single button that opens a preset + calendar
            picker, so custom ranges no longer hide inside the filter sheet.
            On a phone the platform strip runs to the screen edge on purpose: the
            item clipped by the edge is what tells the reader it scrolls. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 pb-2 sm:flex sm:pb-2.5">
          <div className="shrink-0">
            <DateFilter latest={latest} />
          </div>
          <div className="hscroll bleed-x [--bleed:0.875rem] min-w-0 sm:[--bleed:0px]">
            <Segmented
              value={acquisitionChannel(filters) ?? "all"}
              onChange={(v) =>
                setAcquisitionFilter(v === "all" ? undefined : (v as AcquisitionChannel))
              }
              options={[
                { value: "all", label: t("all_platforms") },
                ...ACQUISITION_CHANNELS.map((channel) => ({
                  value: channel,
                  label: ACQUISITION_CHANNEL_LABEL[channel][lang],
                })),
              ]}
            />
          </div>
        </div>

        <DataHealthBar data={data} />
      </header>

      <FilterSheet open={sheetOpen} onClose={() => setSheetOpen(false)} data={data} />
    </>
  );
}

/**
 * The controls that do not fit a phone bar: theme, language, the user guide and
 * the freshness readout that was previously invisible below `md`. Rendered only
 * below `sm`, where the inline buttons are hidden — the two never both show.
 */
function OverflowMenu({ data }: { data?: FiltersResp }) {
  const { t, lang, setLang, theme, toggleTheme } = useI18n();
  const [open, setOpen] = useState(false);

  const rowClass =
    "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-text transition-colors hover:bg-surface-2 cursor-pointer";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex sm:hidden h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface transition-colors hover:bg-surface-2 active:scale-[0.97] cursor-pointer"
          aria-label={lang === "ar" ? "خيارات إضافية" : "More options"}
        >
          <MoreHorizontal size={18} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(16rem,calc(100vw-1.75rem))] rounded-xl p-1.5"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <button type="button" onClick={toggleTheme} className={rowClass}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          <span>{t("theme")}</span>
        </button>
        <button
          type="button"
          onClick={() => setLang(lang === "ar" ? "en" : "ar")}
          className={rowClass}
        >
          <Languages size={16} />
          <span>{lang === "ar" ? "English" : "العربية"}</span>
        </button>
        <Link to="/guide" onClick={() => setOpen(false)} className={rowClass}>
          <BookOpen size={16} />
          <span>{lang === "ar" ? "دليل الاستخدام" : "User guide"}</span>
        </Link>
        {data?.fetchedAt && (
          <div className="mt-1 border-t border-border px-2.5 pt-2 pb-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
              {t("data_freshness")}
            </div>
            <div className="num mt-0.5 text-[12px] text-text-muted">
              {fmtDateTime(data.fetchedAt, lang)}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Degraded-data strip, shown on every page rather than only on the Overview.
 *
 * A tab that fails to load used to be silent everywhere except one page, so a
 * page reading zeros was indistinguishable from a period that genuinely had no
 * data. Whatever the state, the user now sees it before reading the numbers.
 */
function DataHealthBar({ data }: { data?: FiltersResp }) {
  const { lang } = useI18n();
  const failed = data?.fetchErrors ?? [];
  const stale = data?.staleTabs ?? [];
  if (!failed.length && !stale.length) return null;

  const danger = failed.length > 0;
  const tabName = (entry: string) => entry.split(":")[0];
  const text = danger
    ? lang === "ar"
      ? `تعذّر تحميل: ${failed.map(tabName).join("، ")} — الأرقام المعروضة لا تشمل هذه المصادر.`
      : `Failed to load: ${failed.map(tabName).join(", ")} — the numbers shown exclude these sources.`
    : lang === "ar"
      ? `معروض من آخر نسخة سليمة: ${stale.join("، ")} — قد تنقص أحدث الصفوف.`
      : `Served from the last good copy: ${stale.join(", ")} — the newest rows may be missing.`;

  return (
    <div
      className="py-1.5 text-[11px] font-medium flex items-center gap-2 border-t border-border"
      style={{
        background: danger
          ? "var(--danger-soft, rgba(220,38,38,.10))"
          : "var(--warning-soft, rgba(217,119,6,.10))",
        color: danger ? "var(--danger)" : "var(--warning)",
      }}
      role="status"
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "currentColor" }} />
      <span className="truncate" title={text}>
        {text}
      </span>
    </div>
  );
}

const HOUR = 3600_000;
/** Upstream jobs run a few times a day, so hours behind is normal; a day is not. */
const STALE_AFTER_H = 12;
const VERY_STALE_AFTER_H = 24;

/**
 * Two different clocks used to be collapsed into one badge, which is why
 * pressing Refresh never turned it green: the time shown was `__synced_at`, the
 * moment an upstream job last wrote the *sheet*. Nothing in this app can move
 * that. What Refresh actually controls is when we last pulled the sheet.
 *
 * So the headline is now the pull time — it updates on every refresh and proves
 * the button worked — while the dot reflects the real question, how old the
 * underlying data is, and the tooltip names which tab is lagging.
 */
function SyncBadge({ data }: { data?: FiltersResp }) {
  const { t, lang } = useI18n();
  if (!data?.fetchedAt) return null;

  const tabSyncs = data.tabSyncs ?? [];
  const ageH = (iso: string) => (Date.now() - Date.parse(iso)) / HOUR;
  const oldest = data.oldestSyncedAt ? ageH(data.oldestSyncedAt) : NaN;

  const level = !isFinite(oldest)
    ? "ok"
    : oldest > VERY_STALE_AFTER_H
      ? "bad"
      : oldest > STALE_AFTER_H
        ? "warn"
        : "ok";

  const color =
    level === "bad" ? "var(--danger)" : level === "warn" ? "var(--warning)" : "var(--success)";

  const fmtAge = (h: number) =>
    h < 1
      ? lang === "ar"
        ? `${Math.max(1, Math.round(h * 60))} د`
        : `${Math.max(1, Math.round(h * 60))}m`
      : lang === "ar"
        ? `${h.toFixed(1)} س`
        : `${h.toFixed(1)}h`;

  const tooltip = [
    `${lang === "ar" ? "آخر سحب للبيانات من الشيت" : "Dashboard last pulled the sheet"}: ${fmtDateTime(data.fetchedAt, lang)}`,
    "",
    lang === "ar"
      ? "آخر تحديث لكل مصدر داخل الشيت (يكتبها سكربت المزامنة، وزر التحديث لا يغيّرها):"
      : "When each tab was last written by its sync job (Refresh cannot change these):",
    ...tabSyncs
      .slice()
      .sort((a, b) => a.syncedAt.localeCompare(b.syncedAt))
      .map((s) => `• ${s.label}: ${fmtDateTime(s.syncedAt, lang)} — ${fmtAge(ageH(s.syncedAt))}`),
  ].join("\n");

  const lagging = tabSyncs.slice().sort((a, b) => a.syncedAt.localeCompare(b.syncedAt))[0];

  // A lagging tab can push this badge past any width, and because it used to be
  // both nowrap and unshrinkable it shoved the wordmark off the edge at tablet
  // sizes. It now gives up width before anything else on the bar does.
  return (
    <span
      className="hidden md:inline-flex min-w-0 shrink items-center gap-1.5 text-[11px] px-2.5 h-10 rounded-lg bg-surface-2 border border-border whitespace-nowrap max-w-[34vw] xl:max-w-none"
      title={tooltip}
    >
      <span
        className={`w-1.5 h-1.5 shrink-0 rounded-full ${level === "ok" ? "pulse-ring" : ""}`}
        style={{ background: color }}
      />
      <span className="hidden shrink-0 text-text-muted lg:inline">{t("data_freshness")}</span>
      <span className="num shrink-0 text-text font-medium">
        {fmtDateTime(data.fetchedAt, lang)}
      </span>
      {level !== "ok" && lagging && (
        <span className="num truncate" style={{ color }} title={tooltip}>
          · {lagging.label} {fmtAge(ageH(lagging.syncedAt))}
        </span>
      )}
    </span>
  );
}

function FilterSheet({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data?: FiltersResp;
}) {
  const { t, lang } = useI18n();
  const filters = useFilters();
  const dimensions = data?.adDimensions ?? [];
  const platformDimensions = dimensions.filter(
    (row) => !filters.platform || row.platform === filters.platform,
  );
  const accountOptions = filters.platform
    ? sortedUnique(
        (data?.accounts ?? [])
          .filter((account) => account.platform === filters.platform)
          .map((account) => account.name),
      )
    : (data?.accountNames ?? []);
  const accountDimensions = platformDimensions.filter(
    (row) => !filters.account || row.account === filters.account,
  );
  const campaignOptions =
    filters.platform || filters.account
      ? sortedUnique(accountDimensions.map((row) => row.campaign))
      : (data?.campaigns ?? []);
  const campaignDimensions = accountDimensions.filter(
    (row) => !filters.campaign || row.campaign === filters.campaign,
  );
  const adsetOptions =
    filters.platform || filters.account || filters.campaign
      ? sortedUnique(campaignDimensions.map((row) => row.adset))
      : (data?.adsets ?? []);
  const adsetDimensions = campaignDimensions.filter(
    (row) => !filters.adset || row.adset === filters.adset,
  );
  const adOptions =
    filters.platform || filters.account || filters.campaign || filters.adset
      ? sortedUnique(adsetDimensions.map((row) => row.ad))
      : (data?.ads ?? []);
  const activeCount = activeDimensionCount(filters);
  useModalGuard(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  // Portal out of the sticky z-30 header, otherwise the sheet can't stack above
  // the fixed bottom nav and the FAB.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center animate-fade-in"
      style={{ background: "rgba(4, 12, 24, 0.5)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("filters")}
    >
      <div
        className="glass flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl sm:max-w-lg sm:rounded-3xl animate-slide-up sm:animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 sm:px-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-text">{t("filters")}</h2>
              {activeCount > 0 && (
                <span className="num rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand">
                  {activeCount}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {lang === "ar"
                ? "الاختيارات تُطبق مباشرة على كل التقارير"
                : "Selections apply instantly across every report"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("close")}
            className="grid h-11 w-11 place-items-center rounded-full transition-colors hover:bg-surface-2 active:scale-95 cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          <div className="grid gap-4">
            <div>
              <span className="block text-xs font-medium text-text-muted mb-2">
                {t("platform")}
              </span>
              <div className="overflow-x-auto overscroll-x-contain scrollbar-none pb-1">
                <Segmented
                  value={acquisitionChannel(filters) ?? "all"}
                  onChange={(value) =>
                    setAcquisitionFilter(
                      value === "all" ? undefined : (value as AcquisitionChannel),
                    )
                  }
                  size="md"
                  options={[
                    { value: "all", label: t("all_platforms") },
                    ...ACQUISITION_CHANNELS.map((channel) => ({
                      value: channel,
                      label: ACQUISITION_CHANNEL_LABEL[channel][lang],
                    })),
                  ]}
                />
              </div>
            </div>

            <div>
              <span className="block text-xs font-medium text-text-muted mb-2">
                {t("date_range")}
              </span>
              <DateRangePanel latest={latestDate(data)} collapsibleCalendar />
            </div>

            <div>
              <span className="block text-xs font-medium text-text-muted mb-2">
                {lang === "ar" ? "أساس تاريخ الحسابات" : "Accounting date basis"}
              </span>
              <Segmented
                value={filters.dateBasis ?? "payment"}
                onChange={(value) =>
                  filterStore.set({
                    dateBasis: value === "invoice" ? "invoice" : undefined,
                  })
                }
                size="md"
                options={[
                  {
                    value: "payment",
                    label: lang === "ar" ? "تاريخ الدفع" : "Payment Date",
                  },
                  {
                    value: "invoice",
                    label: lang === "ar" ? "تاريخ الفاتورة" : "Invoice Date",
                  },
                ]}
              />
            </div>

            <Select
              label={lang === "ar" ? "شركة الفاتورة" : "Invoice company"}
              value={filters.company}
              options={data?.companies ?? []}
              onChange={(v) => filterStore.set({ company: v })}
            />

            <Select
              label={t("account")}
              value={filters.account}
              options={accountOptions}
              onChange={(v) =>
                filterStore.set({
                  account: v,
                  campaign: undefined,
                  campaignKey: undefined,
                  adset: undefined,
                  adsetKey: undefined,
                  ad: undefined,
                  adKey: undefined,
                })
              }
            />
            <Select
              label={t("campaign")}
              value={filters.campaign}
              options={campaignOptions}
              onChange={(v) =>
                filterStore.set({
                  campaign: v,
                  campaignKey: undefined,
                  adset: undefined,
                  adsetKey: undefined,
                  ad: undefined,
                  adKey: undefined,
                })
              }
            />
            <Select
              label={t("ad_set")}
              value={filters.adset}
              options={adsetOptions}
              onChange={(v) =>
                filterStore.set({
                  adset: v,
                  adsetKey: undefined,
                  ad: undefined,
                  adKey: undefined,
                })
              }
            />
            <Select
              label={t("ad_name")}
              value={filters.ad}
              options={adOptions}
              onChange={(v) => filterStore.set({ ad: v, adKey: undefined })}
            />
            <Select
              label={t("course")}
              value={filters.course}
              options={data?.courses ?? []}
              onChange={(v) => filterStore.set({ course: v })}
            />
            <Select
              label={t("source")}
              value={filters.source}
              options={data?.sources ?? []}
              onChange={(v) => filterStore.set({ source: v })}
            />
            <Select
              label={t("main_category")}
              value={filters.mainCategory}
              options={data?.mainCategories ?? []}
              onChange={(v) => filterStore.set({ mainCategory: v })}
            />
            <Select
              label={t("sales_team")}
              value={filters.salesTeam}
              options={data?.salesTeams ?? []}
              onChange={(v) => filterStore.set({ salesTeam: v })}
            />
            <Select
              label={t("salesperson")}
              value={filters.salesperson}
              options={data?.salespeople ?? []}
              onChange={(v) => filterStore.set({ salesperson: v })}
            />
          </div>
        </div>

        <div
          className="flex shrink-0 gap-2 border-t border-border bg-surface/95 px-4 pt-3 sm:px-5"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <button
            onClick={() => filterStore.resetDimensions()}
            className="flex-1 px-4 py-3 rounded-xl border border-border text-sm font-medium hover:bg-surface-2 transition-colors cursor-pointer min-h-[48px]"
          >
            {t("reset")}
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-white transition-colors cursor-pointer min-h-[48px] inline-flex items-center justify-center gap-2"
            style={{ background: "var(--brand)" }}
          >
            <Check size={16} />
            {t("apply")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value?: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Field label={label}>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm min-h-[44px] cursor-pointer"
      >
        <option value="">{t("all")}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Field>
  );
}
