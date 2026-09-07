import type { ReactNode } from "react";
import type { AnyTone } from "./dashboard-tone";
import type { DatePreset, GlobalFilters } from "./types";
import { PLATFORM_LABEL } from "./constants";
import type { Lang } from "./i18n";

/* ---------------------------------------------------------------------------
   WHAT A NUMBER HAS TO BE ABLE TO SAY ABOUT ITSELF

   A KPI card shows a figure. On its own that figure answers nothing a manager
   actually asks: what is it made of, over what window, under which filters, how
   did it move, which rows produced it, and where is the full report. This is
   the shape of that answer — one description object per metric, built by the
   page from the response it already has.

   THREE RULES, AND THEY ARE WHY THIS IS A DESCRIPTION AND NOT A FETCH.

   1. Nothing here is fetched. Every field is assembled from the payload the
      page already rendered the card from, so opening a detail costs one render
      and no request. A drill-down that re-queries on open is a drill-down that
      can disagree with the card above it.

   2. Nothing here is invented. `trend` takes a real series or is left out;
      `previous` is stated only when the previous window is genuinely
      comparable; a record links to Odoo only from a real record id. An absent
      section is information — it says the data does not exist — and a
      synthesised one is a lie the reader cannot see.

   3. Every ratio carries its own numerator and denominator. A conversion rate
      with no "51 out of 1,307" beside it cannot be checked by the person who
      has to act on it.
--------------------------------------------------------------------------- */

export interface MetricTrendPoint {
  /** ISO date. The x-axis formats it; nothing else parses it. */
  date: string;
  value: number;
}

export interface MetricTrend {
  /** A real series out of the same response the figure came from. */
  points: MetricTrendPoint[];
  label: string;
  format: (n: number) => string;
  /** Colour family for the line. Defaults to the metric's own tone. */
  color?: string;
  /**
   * The previous window, stated ONLY when comparing is valid. A period that
   * falls before the data begins is not a comparison, it is a coincidence.
   */
  previous?: { label: string; value: string } | null;
  /** How the points are bucketed, for the caption. */
  grain?: "day" | "week";
  emptyLabel?: string;
}

export interface MetricBreakdownRow {
  key: string;
  label: string;
  /** Sort/bar weight. Always the same unit within one group. */
  value: number;
  /** Already formatted for display — the group does not guess a currency. */
  display: string;
  meta?: string;
  tone?: AnyTone;
}

export interface MetricBreakdownGroup {
  id: string;
  title: string;
  hint?: string;
  rows: MetricBreakdownRow[];
  /** Where the whole list lives, when it is longer than the five shown. */
  moreTo?: string;
  moreSearch?: Record<string, unknown>;
  moreLabel?: string;
  emptyLabel?: string;
  /** Bars are drawn against this rather than the largest row, when given. */
  max?: number;
}

/** Two to four figures that explain the headline one. Never a repeat of it. */
export interface MetricSupportingFact {
  key: string;
  label: string;
  value: string;
  hint?: string;
}

export interface MetricRecordRow {
  key: string;
  title: string;
  subtitle?: string;
  value?: string;
  meta?: string;
  /**
   * A deep link to the record. Only ever built from a real id: a link that
   * runs a text search in Odoo lands the reader on a list that may not contain
   * the row they clicked, which is worse than no link.
   */
  href?: string;
}

export interface MetricRecordSet {
  title: string;
  hint?: string;
  rows: MetricRecordRow[];
  emptyLabel?: string;
}

export interface MetricReportLink {
  to: string;
  search?: Record<string, unknown>;
  label: string;
}

export interface MetricDetail {
  /**
   * The Nexus element id when the registry knows this metric, so "ask Nexus
   * about this number" resolves against the same identity the rest of the app
   * uses. Falls back to a page-local id.
   */
  id: string;
  title: string;
  value: ReactNode;
  tone?: AnyTone;
  icon?: ReactNode;
  delta?: number;
  deltaInvert?: boolean;
  /** One sentence in the reader's own words. Never the SQL. */
  definition: string;
  /** The arithmetic, for whoever wants to check it. Shown behind a control. */
  formula?: string;
  /** A caveat that changes what the figure means. Rendered, never hidden. */
  caveat?: string;
  trend?: MetricTrend;
  breakdowns?: MetricBreakdownGroup[];
  supporting?: MetricSupportingFact[];
  records?: MetricRecordSet;
  report?: MetricReportLink;
  /** The entity a question about this figure is about, when there is one. */
  entity?: { type: string; id?: string; name?: string } | null;
}

/* --- scope ---------------------------------------------------------------- */

export interface ScopeChip {
  key: string;
  label: string;
  value: string;
}

const MONTHS_AR = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * The selected window, said the way a person would say it.
 *
 * "1 – 11 August 2026", not "2026-08-01 → 2026-08-11". Two dates inside one
 * month collapse to one month name; two dates inside one year keep both month
 * names but state the year once.
 */
export function periodLabel(
  filters: Pick<GlobalFilters, "from" | "to" | "range">,
  lang: Lang,
): string {
  if (filters.range === "all" || (!filters.from && !filters.to)) {
    return lang === "ar" ? "كل الفترات المتاحة" : "All available data";
  }
  const months = lang === "ar" ? MONTHS_AR : MONTHS_EN;
  const parse = (value?: string) => {
    if (!value) return null;
    const [y, m, d] = value.split("-").map(Number);
    if (!y || !m || !d) return null;
    return { y, m, d };
  };
  const from = parse(filters.from);
  const to = parse(filters.to);
  if (!from || !to) {
    const one = from ?? to;
    if (!one) return lang === "ar" ? "كل الفترات المتاحة" : "All available data";
    return `${one.d} ${months[one.m - 1]} ${one.y}`;
  }
  if (from.y === to.y && from.m === to.m) {
    return from.d === to.d
      ? `${from.d} ${months[from.m - 1]} ${from.y}`
      : `${from.d} – ${to.d} ${months[from.m - 1]} ${from.y}`;
  }
  if (from.y === to.y) {
    return `${from.d} ${months[from.m - 1]} – ${to.d} ${months[to.m - 1]} ${from.y}`;
  }
  return `${from.d} ${months[from.m - 1]} ${from.y} – ${to.d} ${months[to.m - 1]} ${to.y}`;
}

const PRESET_LABEL: Record<DatePreset, { ar: string; en: string }> = {
  "7d": { ar: "آخر 7 أيام", en: "Last 7 days" },
  "30d": { ar: "آخر 30 يوماً", en: "Last 30 days" },
  month: { ar: "الشهر الحالي", en: "This month" },
  year: { ar: "السنة الحالية", en: "This year" },
  all: { ar: "كل الفترات", en: "All time" },
};

/**
 * Everything currently narrowing this figure, read off the filter store.
 *
 * NOT INVENTED AND NOT GUESSED: a dimension appears here only when the store
 * actually holds it. A detail panel that claims "Channels: all" while a
 * platform filter is on is worse than one that says nothing.
 */
export function scopeChips(
  filters: GlobalFilters,
  preset: DatePreset,
  lang: Lang,
  extra: ScopeChip[] = [],
): ScopeChip[] {
  const ar = lang === "ar";
  const chips: ScopeChip[] = [
    {
      key: "period",
      label: ar ? "الفترة" : "Period",
      value: filters.from || filters.to ? periodLabel(filters, lang) : PRESET_LABEL[preset][lang],
    },
  ];

  const channel = filters.channel
    ? ar
      ? "أورجانيك"
      : "Organic"
    : filters.platform
      ? PLATFORM_LABEL[filters.platform][lang]
      : ar
        ? "كل القنوات"
        : "All channels";
  chips.push({ key: "channel", label: ar ? "القنوات" : "Channels", value: channel });

  if (filters.company)
    chips.push({ key: "company", label: ar ? "الشركة" : "Company", value: filters.company });
  if (filters.account)
    chips.push({ key: "account", label: ar ? "الحساب" : "Account", value: filters.account });
  if (filters.campaign)
    chips.push({ key: "campaign", label: ar ? "الحملة" : "Campaign", value: filters.campaign });
  if (filters.adset)
    chips.push({ key: "adset", label: ar ? "المجموعة" : "Ad set", value: filters.adset });
  if (filters.course)
    chips.push({ key: "course", label: ar ? "الدورة" : "Course", value: filters.course });
  if (filters.mainCategory)
    chips.push({
      key: "mainCategory",
      label: ar ? "التصنيف" : "Category",
      value: filters.mainCategory,
    });
  if (filters.source)
    chips.push({ key: "source", label: ar ? "المصدر" : "Source", value: filters.source });
  if (filters.salesTeam)
    chips.push({ key: "salesTeam", label: ar ? "الفريق" : "Team", value: filters.salesTeam });
  if (filters.salesperson)
    chips.push({
      key: "salesperson",
      label: ar ? "الموظف" : "Salesperson",
      value: filters.salesperson,
    });
  if (filters.dateBasis)
    chips.push({
      key: "dateBasis",
      label: ar ? "أساس التاريخ" : "Date basis",
      value:
        filters.dateBasis === "invoice"
          ? ar
            ? "تاريخ الفاتورة"
            : "Invoice date"
          : ar
            ? "تاريخ الدفع"
            : "Payment date",
    });

  return [...chips, ...extra];
}

/* --- helpers pages use to build a breakdown ------------------------------- */

/**
 * The top rows of a distribution, largest first.
 *
 * Rows with no weight are dropped rather than shown as a zero bar: "Google $0"
 * in a spend breakdown reads as a platform that underperformed, when what it
 * means is a platform that did not run.
 */
export function topRows(
  rows: MetricBreakdownRow[],
  limit = 5,
  options: { keepZero?: boolean } = {},
): MetricBreakdownRow[] {
  return rows
    .filter((row) => (options.keepZero ? true : Math.abs(row.value) > 0))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, limit);
}

/** True when a detail carries something beyond the figure already on the card. */
export function hasDetailBody(detail: MetricDetail): boolean {
  return Boolean(
    detail.definition ||
    detail.trend?.points.length ||
    detail.breakdowns?.some((group) => group.rows.length) ||
    detail.supporting?.length ||
    detail.records?.rows.length,
  );
}
