import { LayoutGrid, TriangleAlert } from "lucide-react";
import { fmtNum, fmtUSD, useI18n } from "@/lib/i18n";
import { setPlatformFilter, useFilters } from "@/lib/filter-store";
import { PLATFORM_COLOR, PLATFORM_LABEL, PLATFORMS } from "@/lib/constants";
import type { Maybe, Platform } from "@/lib/types";

export interface PlatformCoverage {
  platform: Platform;
  adRows: number;
  /** False means this platform has no spend tab, so its cost is unknown. */
  spendAvailable: boolean;
  spend: number;
  impressions: number;
  clicksAll: number;
  ctrAll: Maybe;
  platformLeads: Maybe;
  linkClicks: Maybe;
  /** Clean lead total (CRM + Lost Analysis) reaching this platform. */
  crmLeads: number;
  won: number;
  lost: number;
  revenue: number;
  accounts: string[];
}

/**
 * Platform selection, wired to the global `platform` filter so the whole page —
 * cards, charts and every drill-down level — re-scopes together.
 *
 * Each tab carries its own availability line. That is the point: TikTok has to
 * be selectable and has to say "leads yes, spend no" out loud, instead of either
 * disappearing or implying its ads were free.
 */
export function PlatformSwitcher({
  coverage,
  overall,
}: {
  coverage: PlatformCoverage[];
  /** Unscoped totals. Not a sum of the rows — leads with no ad platform count here too. */
  overall: { spend: number; crmLeads: number };
}) {
  const { t, lang } = useI18n();
  const filters = useFilters();
  const active = filters.platform ?? "all";

  const byKey = new Map(coverage.map((c) => [c.platform, c]));
  const anyData = overall.spend > 0 || overall.crmLeads > 0;

  const select = (value: Platform | "all") => {
    // A campaign belongs to exactly one platform, so a drill-down cannot
    // survive a platform change — clear it rather than show an empty table.
    setPlatformFilter(value === "all" ? undefined : value);
  };

  return (
    <div
      className="flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain scrollbar-none pb-1"
      role="tablist"
      aria-label={t("platform")}
    >
      <Tab
        active={active === "all"}
        onClick={() => select("all")}
        color="var(--brand)"
        icon={<LayoutGrid size={14} />}
        title={t("all_platforms")}
        line={
          anyData
            ? `${fmtUSD(overall.spend)} · ${fmtNum(overall.crmLeads)} ${lang === "ar" ? "عميل" : "leads"}`
            : lang === "ar"
              ? "مفيش بيانات في الفترة دي"
              : "No data in this period"
        }
      />
      {PLATFORMS.map((p) => {
        const c = byKey.get(p);
        const leads = c?.crmLeads ?? 0;
        const hasAnything = !!c && (c.adRows > 0 || leads > 0);
        return (
          <Tab
            key={p}
            active={active === p}
            onClick={() => select(p)}
            color={PLATFORM_COLOR[p]}
            title={PLATFORM_LABEL[p][lang]}
            warn={!!c && !c.spendAvailable && leads > 0}
            line={
              !hasAnything
                ? lang === "ar"
                  ? "مفيش بيانات في الفترة دي"
                  : "No data in this period"
                : c!.spendAvailable
                  ? `${fmtUSD(c!.spend)} · ${fmtNum(leads)} ${lang === "ar" ? "عميل" : "leads"}`
                  : lang === "ar"
                    ? `${fmtNum(leads)} عميل · الإنفاق غير متاح`
                    : `${fmtNum(leads)} leads · spend not available`
            }
          />
        );
      })}
    </div>
  );
}

function Tab({
  active,
  onClick,
  title,
  line,
  color,
  icon,
  warn = false,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  line: string;
  color: string;
  icon?: React.ReactNode;
  warn?: boolean;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      // The visible label lives in nested spans, which some assistive tech
      // flattens into nothing; name the tab explicitly, availability included.
      aria-label={`${title} — ${line}`}
      onClick={onClick}
      className={`min-h-[64px] min-w-[8.5rem] shrink-0 snap-start text-start rounded-xl border px-3 py-2 transition-colors active:scale-[0.98] sm:min-w-[9.5rem] cursor-pointer ${
        active ? "shadow-sm" : "hover:bg-surface-2"
      }`}
      style={{
        borderColor: active ? color : "var(--border)",
        background: active ? `color-mix(in oklab, ${color} 10%, var(--surface))` : "var(--surface)",
      }}
    >
      <span className="flex items-center gap-1.5">
        {icon ? (
          <span style={{ color }}>{icon}</span>
        ) : (
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
        )}
        <span className="text-[13px] font-semibold text-text truncate">{title}</span>
        {warn && <TriangleAlert size={12} style={{ color: "var(--warning)" }} />}
      </span>
      <span className="block text-[10.5px] text-text-muted mt-0.5 num truncate">{line}</span>
    </button>
  );
}
