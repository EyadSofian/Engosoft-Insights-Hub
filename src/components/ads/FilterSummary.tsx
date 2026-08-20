import { X, Filter } from "lucide-react";
import { fmtDate, useI18n } from "@/lib/i18n";
import { filterStore, useFilters } from "@/lib/filter-store";
import { ACQUISITION_CHANNEL_LABEL } from "@/lib/constants";
import { acquisitionChannel } from "@/lib/acquisition-channel";
import type { GlobalFilters } from "@/lib/types";

/**
 * What the reader is currently looking at, spelled out above the numbers.
 *
 * Without this, a filtered page and an unfiltered one look identical and a
 * screenshot of either is unattributable. Every chip clears its own dimension;
 * the period chip is not clearable because there is always a period.
 */
export function FilterSummary({ className = "" }: { className?: string }) {
  const { t, lang } = useI18n();
  const filters = useFilters();

  const chips: {
    key: keyof GlobalFilters;
    label: string;
    value: string;
    clears?: Partial<GlobalFilters>;
  }[] = [];
  if (filters.dateBasis === "invoice")
    chips.push({
      key: "dateBasis",
      label: lang === "ar" ? "أساس التاريخ" : "Date basis",
      value: lang === "ar" ? "تاريخ الفاتورة" : "Invoice Date",
    });
  if (filters.company)
    chips.push({
      key: "company",
      label: lang === "ar" ? "شركة الفاتورة" : "Invoice company",
      value: filters.company,
    });

  const selectedChannel = acquisitionChannel(filters);
  if (selectedChannel) {
    chips.push({
      key: filters.channel ? "channel" : "platform",
      label: lang === "ar" ? "قناة الاكتساب" : "Acquisition channel",
      value: ACQUISITION_CHANNEL_LABEL[selectedChannel][lang],
      clears: {
        platform: undefined,
        channel: undefined,
        campaign: undefined,
        campaignKey: undefined,
        adset: undefined,
        adsetKey: undefined,
        ad: undefined,
        adKey: undefined,
      },
    });
  }
  if (filters.account) chips.push({ key: "account", label: t("account"), value: filters.account });
  if (filters.campaign)
    chips.push({
      key: "campaign",
      label: t("campaign"),
      value: filters.campaign,
      clears: {
        campaign: undefined,
        campaignKey: undefined,
        adset: undefined,
        adsetKey: undefined,
        ad: undefined,
        adKey: undefined,
      },
    });
  if (filters.adset)
    chips.push({
      key: "adset",
      label: t("ad_set"),
      value: filters.adset,
      clears: { adset: undefined, adsetKey: undefined, ad: undefined, adKey: undefined },
    });
  if (filters.ad)
    chips.push({
      key: "ad",
      label: t("ad_name"),
      value: filters.ad,
      clears: { ad: undefined, adKey: undefined },
    });
  if (filters.course) chips.push({ key: "course", label: t("course"), value: filters.course });
  if (filters.source) chips.push({ key: "source", label: t("source"), value: filters.source });
  if (filters.mainCategory)
    chips.push({ key: "mainCategory", label: t("main_category"), value: filters.mainCategory });
  if (filters.salesTeam)
    chips.push({ key: "salesTeam", label: t("sales_team"), value: filters.salesTeam });
  if (filters.salesperson)
    chips.push({ key: "salesperson", label: t("salesperson"), value: filters.salesperson });
  if (filters.cpaBasis === "invoices")
    chips.push({ key: "cpaBasis", label: t("cpa_basis"), value: t("cpa_invoices") });

  const period =
    filters.range === "all"
      ? t("preset_all")
      : filters.from || filters.to
        ? `${fmtDate(filters.from, lang)} → ${fmtDate(filters.to, lang)}`
        : t("preset_all");

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted me-0.5">
        <Filter size={12} />
        {lang === "ar" ? "المعروض دلوقتي" : "Currently showing"}
      </span>

      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium bg-brand-soft text-brand whitespace-nowrap">
        <span className="opacity-70">{t("date_range")}:</span>
        <span className="num">{period}</span>
      </span>

      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex items-center gap-1 ps-2 pe-1 py-1 rounded-full text-[11px] font-medium bg-surface-2 border border-border text-text max-w-[16rem]"
        >
          <span className="text-text-muted shrink-0">{c.label}:</span>
          <span className="truncate" title={c.value}>
            {c.value}
          </span>
          <button
            onClick={() =>
              filterStore.set(c.clears ?? ({ [c.key]: undefined } as Partial<GlobalFilters>))
            }
            aria-label={`${t("clear")} ${c.label}`}
            className="w-4 h-4 grid place-items-center rounded-full hover:bg-surface-3 transition-colors cursor-pointer shrink-0"
          >
            <X size={11} />
          </button>
        </span>
      ))}

      {chips.length > 0 && (
        <button
          onClick={() => filterStore.resetDimensions()}
          className="text-[11px] px-2 py-1 rounded-full border border-border text-text-muted hover:bg-surface-2 transition-colors cursor-pointer"
        >
          {lang === "ar" ? "امسح الكل" : "Clear all"}
        </button>
      )}
    </div>
  );
}
