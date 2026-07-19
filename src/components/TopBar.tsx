import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, SlidersHorizontal, Languages, X, Moon, Sun, Check } from "lucide-react";
import { fmtDateTime, useI18n } from "@/lib/i18n";
import { activeDimensionCount, filterStore, useFilters, usePreset } from "@/lib/filter-store";
import type { DatePreset } from "@/lib/types";
import { Segmented } from "./ui-bits";

export interface FiltersResp {
  accounts: string[];
  campaigns: string[];
  sources: string[];
  mainCategories: string[];
  salesTeams: string[];
  courses: string[];
  metaDateMin: string;
  metaDateMax: string;
  revenueDateMin: string;
  revenueDateMax: string;
  syncedAt: string;
  fetchedAt: string;
  matchRate: number;
  fetchErrors: string[];
}

const PRESETS: { value: DatePreset; key: "preset_meta" | "preset_7" | "preset_30" | "preset_90" | "preset_month" | "preset_all" }[] = [
  { value: "meta", key: "preset_meta" },
  { value: "7d", key: "preset_7" },
  { value: "30d", key: "preset_30" },
  { value: "month", key: "preset_month" },
  { value: "all", key: "preset_all" },
];

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

export function TopBar({ title }: { title: string }) {
  const { t, lang, setLang, theme, toggleTheme } = useI18n();
  const filters = useFilters();
  const preset = usePreset();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data } = useFiltersData();
  const activeCount = activeDimensionCount(filters);

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/refresh", { method: "POST" });
      await qc.invalidateQueries();
    } finally {
      setRefreshing(false);
    }
  };

  // Data is pulled from the sheet; anything older than 2h is worth flagging.
  const syncedMs = data?.syncedAt ? Date.parse(data.syncedAt) : NaN;
  const stale = isFinite(syncedMs) && Date.now() - syncedMs > 2 * 3600_000;

  return (
    <>
      <header className="sticky top-0 z-30 glass border-b border-border">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
          <h1 className="text-base sm:text-lg font-semibold text-text truncate min-w-0">{title}</h1>

          <div className="ms-auto flex items-center gap-1.5 sm:gap-2">
            <SyncBadge syncedAt={data?.syncedAt} stale={stale} />

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

        {/* Period chips stay visible on every screen — the most-used control. */}
        <div className="px-4 sm:px-6 pb-2.5 flex items-center gap-2 overflow-x-auto scrollbar-none">
          <Segmented
            value={preset}
            onChange={(v) =>
              filterStore.setPreset(
                v,
                data ? { from: data.metaDateMin, to: data.metaDateMax } : undefined,
              )
            }
            options={PRESETS.map((p) => ({ value: p.value, label: t(p.key) }))}
          />
          {filters.from && filters.to && (
            <span className="text-[11px] text-text-muted num whitespace-nowrap ps-1">
              {filters.from} → {filters.to}
            </span>
          )}
        </div>
      </header>

      <FilterSheet open={sheetOpen} onClose={() => setSheetOpen(false)} data={data} />
    </>
  );
}

function SyncBadge({ syncedAt, stale }: { syncedAt?: string; stale: boolean }) {
  const { t, lang } = useI18n();
  if (!syncedAt) return null;
  return (
    <span
      className="hidden md:inline-flex items-center gap-1.5 text-[11px] px-2.5 h-10 rounded-lg bg-surface-2 border border-border whitespace-nowrap"
      title={`${t("data_freshness")}: ${fmtDateTime(syncedAt, lang)}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${stale ? "" : "pulse-ring"}`}
        style={{ background: stale ? "var(--warning)" : "var(--success)" }}
      />
      <span className="text-text-muted">{stale ? t("stale") : t("live")}</span>
      <span className="num text-text font-medium">{fmtDateTime(syncedAt, lang)}</span>
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
  const { t } = useI18n();
  const filters = useFilters();

  // Escape closes, and the page must not scroll behind the sheet.
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

  if (!open) return null;

  return (
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
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("from")}>
              <input
                type="date"
                value={filters.from ?? ""}
                onChange={(e) => filterStore.setDates(e.target.value, filters.to)}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm min-h-[44px]"
              />
            </Field>
            <Field label={t("to")}>
              <input
                type="date"
                value={filters.to ?? ""}
                onChange={(e) => filterStore.setDates(filters.from, e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm min-h-[44px]"
              />
            </Field>
          </div>

          <Select
            label={t("account")}
            value={filters.account}
            options={data?.accounts ?? []}
            onChange={(v) => filterStore.set({ account: v })}
          />
          <Select
            label={t("campaign")}
            value={filters.campaign}
            options={data?.campaigns ?? []}
            onChange={(v) => filterStore.set({ campaign: v })}
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
    </div>
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
