import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DayPicker, DayButton, type DateRange } from "react-day-picker";
import { ar, enGB } from "date-fns/locale";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Check, X } from "lucide-react";
import { useI18n, type Lang } from "@/lib/i18n";
import { filterStore, presetWindow, useFilters } from "@/lib/filter-store";
import { useModalGuard } from "@/lib/ui-store";
import { useIsMobile } from "@/hooks/use-mobile";
import type { DatePreset, GlobalFilters } from "@/lib/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Presets                                                                    */
/* -------------------------------------------------------------------------- */

type PresetKey = "preset_7" | "preset_30" | "preset_month" | "preset_year" | "preset_all";

const PRESETS: { value: DatePreset; key: PresetKey; full?: boolean }[] = [
  { value: "7d", key: "preset_7" },
  { value: "30d", key: "preset_30" },
  { value: "month", key: "preset_month" },
  { value: "year", key: "preset_year" },
  { value: "all", key: "preset_all", full: true },
];

const PRESET_KEY: Record<DatePreset, PresetKey> = {
  "7d": "preset_7",
  "30d": "preset_30",
  month: "preset_month",
  year: "preset_year",
  all: "preset_all",
};

/** Which named preset — if any — the current range matches. Null means custom. */
function activePreset(f: GlobalFilters, latest?: string): DatePreset | null {
  if (f.range === "all") return "all";
  if (!f.from || !f.to) return null;
  for (const p of ["7d", "30d", "month", "year"] as const) {
    const w = presetWindow(p, latest);
    if (w.from === f.from && w.to === f.to) return p;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Date helpers                                                               */
/* -------------------------------------------------------------------------- */

/** ISO "YYYY-MM-DD" → local Date at midnight (no timezone drift). */
const parseISO = (s?: string): Date | undefined =>
  s ? new Date(s + "T00:00:00") : undefined;

/** Local Date → "YYYY-MM-DD" using local parts, so the picked day never shifts. */
const toISO = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Short, space-saving day label, e.g. "12 Jul". */
function shortDay(s: string, lang: Lang): string {
  const d = parseISO(s);
  if (!d || isNaN(d.getTime())) return s;
  return d.toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "short",
  });
}

/* -------------------------------------------------------------------------- */
/*  Range calendar (react-day-picker, themed with app tokens)                  */
/* -------------------------------------------------------------------------- */

function RangeDayButton({ day, modifiers, className: _c, ...props }: ComponentProps<typeof DayButton>) {
  const endpoint =
    modifiers.range_start || modifiers.range_end || (modifiers.selected && !modifiers.range_middle);

  return (
    <button
      {...props}
      className={cn(
        "grid h-full w-full place-items-center text-[13px] transition-colors cursor-pointer select-none num",
        // in-range days: text sits on the soft band the cell paints
        modifiers.range_middle && "rounded-none bg-transparent text-brand font-medium",
        // start / end / single: solid brand chip
        endpoint && "rounded-full bg-brand text-white font-semibold",
        // plain days
        !modifiers.selected && "rounded-lg text-text hover:bg-surface-2",
        !modifiers.selected && modifiers.today && "font-bold text-brand",
        !modifiers.selected && modifiers.outside && "text-text-subtle/50",
        modifiers.disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
      )}
    />
  );
}

function RangeCalendar({
  selected,
  onSelect,
  latest,
  dir,
  lang,
}: {
  selected?: DateRange;
  onSelect: (r: DateRange | undefined) => void;
  latest?: string;
  dir: "ltr" | "rtl";
  lang: Lang;
}) {
  // The in-range band. `--brand-soft` is nearly identical to the dark surface,
  // so use a translucent brand tint that reads on both light and dark.
  const band = "bg-[color-mix(in_oklab,var(--brand)_22%,transparent)]";

  return (
    <DayPicker
      mode="range"
      selected={selected}
      onSelect={onSelect}
      numberOfMonths={1}
      showOutsideDays
      weekStartsOn={6}
      dir={dir}
      locale={lang === "ar" ? ar : enGB}
      defaultMonth={selected?.to ?? selected?.from ?? parseISO(latest)}
      classNames={{
        months: "relative",
        month: "flex flex-col gap-2",
        month_caption: "flex h-9 items-center justify-center",
        caption_label: "text-sm font-semibold text-text capitalize",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous:
          "inline-grid h-8 w-8 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40 cursor-pointer",
        button_next:
          "inline-grid h-8 w-8 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40 cursor-pointer",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "grid h-8 flex-1 place-items-center text-[11px] font-medium text-text-subtle",
        week: "mt-0.5 flex w-full",
        day: "aspect-square flex-1 p-0",
      }}
      modifiersClassNames={{
        range_start: `${band} rounded-s-full`,
        range_middle: band,
        range_end: `${band} rounded-e-full`,
      }}
      components={{
        Chevron: ({ orientation }) => {
          const back = orientation === "left";
          const Icon = (dir === "rtl" ? !back : back) ? ChevronLeft : ChevronRight;
          return <Icon className="size-4" />;
        },
        DayButton: RangeDayButton,
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Shared panel — presets + calendar. Reused in the header popover/sheet and  */
/*  inline inside the filter sheet.                                            */
/* -------------------------------------------------------------------------- */

export function DateRangePanel({
  latest,
  onApply,
  collapsibleCalendar = false,
}: {
  latest?: string;
  /** Called after a preset is chosen — lets the header popover/sheet close. */
  onApply?: () => void;
  /** In the filter sheet the calendar starts collapsed to keep the sheet short. */
  collapsibleCalendar?: boolean;
}) {
  const { t, lang, dir } = useI18n();
  const filters = useFilters();
  const active = activePreset(filters, latest);

  const [showCal, setShowCal] = useState(!collapsibleCalendar || active === null);
  // Open the calendar automatically when the range becomes custom.
  useEffect(() => {
    if (active === null) setShowCal(true);
  }, [active]);

  const selected: DateRange | undefined = filters.from
    ? { from: parseISO(filters.from), to: parseISO(filters.to) }
    : undefined;

  const onSelect = (r: DateRange | undefined) => {
    if (!r || !r.from) {
      filterStore.setDates(undefined, undefined);
      return;
    }
    filterStore.setDates(toISO(r.from), r.to ? toISO(r.to) : undefined);
  };

  return (
    <div className="grid gap-3">
      {/* quick presets */}
      <div className="grid grid-cols-2 gap-1.5">
        {PRESETS.map((p) => {
          const on = active === p.value;
          return (
            <button
              key={p.value}
              onClick={() => {
                filterStore.setPreset(p.value, latest);
                onApply?.();
              }}
              className={cn(
                "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-all cursor-pointer",
                p.full && "col-span-2",
                on
                  ? "text-white shadow-sm"
                  : "bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text",
              )}
              style={on ? { background: "var(--brand)" } : undefined}
            >
              {on && <Check size={14} strokeWidth={2.5} />}
              {t(p.key)}
            </button>
          );
        })}
      </div>

      {/* custom range */}
      {collapsibleCalendar ? (
        <button
          onClick={() => setShowCal((v) => !v)}
          className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2.5 text-start transition-colors hover:bg-surface-2 cursor-pointer"
        >
          <span className="flex items-center gap-2 text-[13px] font-medium text-text">
            <CalendarDays size={15} className="text-text-muted" />
            {t("custom_range")}
          </span>
          <span className="flex items-center gap-2">
            {active === null && filters.from && (
              <span className="num text-[11px] text-text-muted">
                {shortDay(filters.from, lang)}
                {filters.to ? ` – ${shortDay(filters.to, lang)}` : ""}
              </span>
            )}
            <ChevronDown
              size={16}
              className={cn(
                "text-text-subtle transition-transform",
                showCal && "rotate-180",
              )}
            />
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-text-subtle">
          <span className="h-px flex-1 bg-border" />
          {t("custom_range")}
          <span className="h-px flex-1 bg-border" />
        </div>
      )}

      {showCal && (
        <div className="rounded-2xl border border-border bg-surface-2/40 p-1.5">
          <RangeCalendar
            selected={selected}
            onSelect={onSelect}
            latest={latest}
            dir={dir}
            lang={lang}
          />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Trigger + responsive container (popover on desktop, sheet on mobile)       */
/* -------------------------------------------------------------------------- */

function useRangeLabel(latest?: string): string {
  const { t, lang } = useI18n();
  const filters = useFilters();
  const active = activePreset(filters, latest);
  if (active) return t(PRESET_KEY[active]);
  if (filters.from) {
    return filters.to
      ? `${shortDay(filters.from, lang)} – ${shortDay(filters.to, lang)}`
      : shortDay(filters.from, lang);
  }
  return t("date_range");
}

export function DateFilter({ latest }: { latest?: string }) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const label = useRangeLabel(latest);

  const triggerClasses =
    "inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 sm:px-3 text-sm text-text transition-colors hover:bg-surface-2 cursor-pointer max-w-[60vw] sm:max-w-none";

  // Name the control AND its current value, so a screen reader announces both.
  const a11yLabel = `${t("date_range")}: ${label}`;

  const triggerInner = (
    <>
      <CalendarDays size={16} className="shrink-0 text-text-muted" />
      <span className="truncate font-medium">{label}</span>
      <ChevronDown size={14} className="shrink-0 text-text-subtle" />
    </>
  );

  // Mobile: bottom sheet, matching the app's existing filter-sheet pattern.
  if (isMobile) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={triggerClasses}
          aria-label={a11yLabel}
        >
          {triggerInner}
        </button>
        {open && (
          <BottomSheet
            title={t("date_range")}
            onClose={() => setOpen(false)}
            footer={
              <button
                onClick={() => setOpen(false)}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-white transition-colors cursor-pointer"
                style={{ background: "var(--brand)" }}
              >
                <Check size={16} />
                {t("apply")}
              </button>
            }
          >
            <DateRangePanel latest={latest} collapsibleCalendar onApply={() => setOpen(false)} />
          </BottomSheet>
        )}
      </>
    );
  }

  // Desktop: anchored popover.
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={triggerClasses} aria-label={a11yLabel}>
          {triggerInner}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[320px] rounded-2xl border-border bg-surface p-3 shadow-lg"
      >
        <DateRangePanel latest={latest} collapsibleCalendar onApply={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/*  Mobile bottom sheet                                                        */
/* -------------------------------------------------------------------------- */

function BottomSheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Pinned below the scroll area, so a primary action never scrolls away. */
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  useModalGuard(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  // Portal to the body: the header is a sticky z-30 stacking context, so a sheet
  // rendered inside it can't rise above the z-40 bottom nav no matter its z-index.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end animate-fade-in sm:items-center sm:justify-center"
      style={{ background: "rgba(4, 12, 24, 0.5)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* A column that caps at the viewport so the header and footer stay put
          while only the middle scrolls — the Apply button can't be pushed off. */}
      <div
        className="glass flex max-h-[90dvh] w-full animate-slide-up flex-col rounded-t-3xl px-5 pt-4 sm:max-h-[85vh] sm:max-w-md sm:animate-scale-in sm:rounded-3xl"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-border-strong sm:hidden" />
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h2 className="text-lg font-semibold text-text">{title}</h2>
          <button
            onClick={onClose}
            aria-label={t("close")}
            className="grid h-10 w-10 place-items-center rounded-full transition-colors hover:bg-surface-2 cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>
        <div className="-mx-1 flex-1 overflow-y-auto px-1 scrollbar-thin">{children}</div>
        {footer && <div className="shrink-0 pt-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
