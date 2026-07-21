import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, SlidersHorizontal, Languages, X, Moon, Sun, Check } from "lucide-react";
import { fmtDateTime, useI18n } from "@/lib/i18n";
import { activeDimensionCount, filterStore, useFilters } from "@/lib/filter-store";
import { useModalGuard } from "@/lib/ui-store";
import type { CampaignObjective, DataHealth, Platform } from "@/lib/types";
import { PLATFORM_LABEL, PLATFORMS } from "@/lib/constants";
import { Segmented } from "./ui-bits";
import { DateFilter, DateRangePanel } from "./DateFilter";

export interface FiltersResp {
  accounts: { name: string; platform: Platform; objective: CampaignObjective; spend: number; platformLeads: number | null }[];
  accountNames: string[];
  campaigns: string[];
  adsets: string[];
  ads: string[];
  sources: string[];
  mainCategories: string[];
  salesTeams: string[];
  salespeople: string[];
  courses: string[];
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
  counts: { ads: number; crm: number; invoiced: number; sales: number; lost: number };
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
  return [c.adsDateMax, c.crmDateMax, c.revenueDateMax].filter(Boolean).sort().pop();
}

export function TopBar({ title }: { title?: string }) {
  const { t, lang, setLang, theme, toggleTheme } = useI18n();
  const filters = useFilters();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data } = useFiltersData();
  const activeCount = activeDimensionCount(filters);
  const latest = latestDate(data);

  // The first payload tells us the sheet's real end date; re-anchor the default
  // year-to-date window to it so the chip label and the query agree.
  useEffect(() => {
    if (!latest || filters.from || filters.to || filters.range) return;
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
      <header className="sticky top-0 z-30 glass border-b border-border">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
          {/* Desktop shows the logo in the sidebar; mobile needs branding here.
              The page title itself lives in each page's PageHeader, so the bar
              stays a controls strip and never repeats the heading. */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="lg:hidden font-semibold text-[15px] tracking-tight text-text">ENGOSOFT</span>
            {title && (
              <h1 className="text-base sm:text-lg font-semibold text-text truncate min-w-0">{title}</h1>
            )}
          </div>

          <div className="ms-auto flex items-center gap-1.5 sm:gap-2">
            <SyncBadge data={data} />

            <button
              onClick={() => setSheetOpen(true)}
              className="relative inline-flex items-center gap-1.5 px-2.5 sm:px-3 h-10 rounded-lg border border-border bg-surface text-sm hover:bg-surface-2 transition-colors cursor-pointer"
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
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-60"
              aria-label={t("refresh")}
              title={t("refresh")}
            >
              <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
            </button>

            <button
              onClick={toggleTheme}
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer"
              aria-label={t("theme")}
              title={t("theme")}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            <button
              onClick={() => setLang(lang === "ar" ? "en" : "ar")}
              className="inline-flex items-center gap-1 px-2.5 h-10 rounded-lg border border-border bg-surface text-sm font-medium hover:bg-surface-2 transition-colors cursor-pointer"
              aria-label="Toggle language"
            >
              <Languages size={16} />
              <span>{lang === "ar" ? "EN" : "ع"}</span>
            </button>
          </div>
        </div>

        {/* Period and platform stay visible on every screen — the most-used controls.
            The date control is now a single button that opens a preset + calendar
            picker, so custom ranges no longer hide inside the filter sheet. */}
        <div className="px-4 sm:px-6 pb-2.5 flex items-center gap-2 overflow-x-auto scrollbar-none">
          <DateFilter latest={latest} />
          <Segmented
            value={filters.platform ?? "all"}
            onChange={(v) => filterStore.set({ platform: v === "all" ? undefined : (v as Platform) })}
            options={[
              { value: "all", label: t("all_platforms") },
              ...PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABEL[p][lang] })),
            ]}
          />
        </div>
      </header>

      <FilterSheet open={sheetOpen} onClose={() => setSheetOpen(false)} data={data} />
    </>
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

  const lagging = tabSyncs
    .slice()
    .sort((a, b) => a.syncedAt.localeCompare(b.syncedAt))[0];

  return (
    <span
      className="hidden md:inline-flex items-center gap-1.5 text-[11px] px-2.5 h-10 rounded-lg bg-surface-2 border border-border whitespace-nowrap"
      title={tooltip}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${level === "ok" ? "pulse-ring" : ""}`}
        style={{ background: color }}
      />
      <span className="text-text-muted">{t("data_freshness")}</span>
      <span className="num text-text font-medium">{fmtDateTime(data.fetchedAt, lang)}</span>
      {level !== "ok" && lagging && (
        <span className="num" style={{ color }} title={tooltip}>
          · {lagging.label} {fmtAge(ageH(lagging.syncedAt))}
        </span>
      )}
    </span>
  );
}

function FilterSheet({ open, onClose, data }: { open: boolean; onClose: () => void; data?: FiltersResp }) {
  const { t, lang } = useI18n();
  const filters = useFilters();
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
        className="w-full sm:max-w-lg glass rounded-t-3xl sm:rounded-3xl p-5 max-h-[88vh] overflow-y-auto animate-slide-up sm:animate-scale-in"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-text text-lg">{t("filters")}</h2>
          <button
            onClick={onClose}
            aria-label={t("close")}
            className="w-10 h-10 grid place-items-center rounded-full hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-4">
          <div>
            <span className="block text-xs font-medium text-text-muted mb-2">{t("date_range")}</span>
            <DateRangePanel latest={latestDate(data)} collapsibleCalendar />
          </div>

          <Select
            label={t("account")}
            value={filters.account}
            options={data?.accountNames ?? []}
            onChange={(v) => filterStore.set({ account: v })}
          />
          <Select
            label={t("campaign")}
            value={filters.campaign}
            options={data?.campaigns ?? []}
            onChange={(v) => filterStore.set({ campaign: v })}
          />
          <Select
            label={t("ad_set")}
            value={filters.adset}
            options={data?.adsets ?? []}
            onChange={(v) => filterStore.set({ adset: v })}
          />
          <Select
            label={t("ad_name")}
            value={filters.ad}
            options={data?.ads ?? []}
            onChange={(v) => filterStore.set({ ad: v })}
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

          <div className="border-t border-border pt-4 grid gap-3">
            <Field label={t("cpa_basis")}>
              <Segmented
                value={filters.cpaBasis ?? "won"}
                onChange={(v) => filterStore.set({ cpaBasis: v === "invoices" ? "invoices" : undefined })}
                options={[
                  { value: "won", label: t("cpa_won") },
                  { value: "invoices", label: t("cpa_invoices") },
                ]}
                size="md"
              />
            </Field>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.includeNonLead === "1"}
                onChange={(e) => filterStore.set({ includeNonLead: e.target.checked ? "1" : undefined })}
                className="mt-1 w-4 h-4 cursor-pointer"
              />
              <span className="text-sm">
                <span className="block font-medium text-text">{t("include_non_lead")}</span>
                <span className="block text-xs text-text-muted mt-0.5">
                  {lang === "ar"
                    ? "حسابات الزيارات تُنفق دون إنتاج عملاء، وهي مستبعدة من مؤشرات الكفاءة افتراضياً."
                    : "Traffic accounts spend without producing leads and are excluded from efficiency metrics by default."}
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
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
