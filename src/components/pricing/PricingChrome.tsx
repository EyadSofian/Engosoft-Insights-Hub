import { useLayoutEffect, useRef, type FormEvent, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, Search, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui-bits";
import { useI18n } from "@/lib/i18n";

/**
 * The pricing page's own chrome: a compact identity bar, the KPI strip, and a
 * tab row that turns into a context bar once the global header is away.
 *
 * The bar the reference designs opened with was a 180px dark hero. It said the
 * page's name — which the navigation already says — and pushed the first real
 * number below the fold. This keeps the identity and the search, and gives the
 * rest of the height back to the data.
 */

export function PricingPageHeader({
  title,
  description,
  period,
  searchValue,
  onSearchValue,
  onSearchSubmit,
  action,
}: {
  title: string;
  description: string;
  /** Period covered and how fresh the audit behind it is. */
  period?: ReactNode;
  searchValue: string;
  onSearchValue: (value: string) => void;
  onSearchSubmit: (event: FormEvent) => void;
  /** The one action that belongs at this level. Exactly one. */
  action?: ReactNode;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";

  return (
    <section
      className="overflow-hidden rounded-xl border border-border"
      style={{ background: "var(--ink)" }}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5 sm:px-5">
        <div className="min-w-[200px] flex-1">
          <h1 className="text-[17px] font-bold tracking-tight text-white sm:text-[19px]">
            {title}
          </h1>
          <p className="mt-0.5 text-[11.5px] leading-snug text-white/60">{description}</p>
        </div>

        {period && (
          <div className="text-[11px] leading-snug text-white/55 md:text-end">{period}</div>
        )}

        <form onSubmit={onSearchSubmit} className="relative w-full sm:w-[280px]" role="search">
          <Search
            size={15}
            className="pointer-events-none absolute inset-y-0 start-3 my-auto text-white/45"
            aria-hidden="true"
          />
          <input
            value={searchValue}
            onChange={(event) => onSearchValue(event.target.value)}
            placeholder={ar ? "ابحث باسم الدورة أو الكود" : "Search course name or code"}
            aria-label={ar ? "بحث في الأسعار" : "Search prices"}
            className="min-h-10 w-full rounded-lg border border-white/15 bg-white/[0.07] ps-9 pe-3 text-[12.5px] text-white outline-none transition-colors placeholder:text-white/40 focus:border-white/40 focus:bg-white/[0.12]"
          />
        </form>

        {action}
      </div>
    </section>
  );
}

/* --- KPI strip ------------------------------------------------------------ */

export interface PricingKpi {
  id: string;
  /** Short enough to read in one glance; the question is in `question`. */
  label: string;
  value: string;
  /** What this number answers, shown under it. */
  question?: string;
  tone?: "danger" | "warning" | "success" | "neutral";
  /** Change against the previous period of the same length, in points or %. */
  delta?: number;
  /** True when a rise in this figure is bad news. */
  deltaInvert?: boolean;
  info?: ReactNode;
  /** Applying this KPI's own filter is the point of pressing it. */
  onSelect?: () => void;
  selectHint?: string;
  Icon?: LucideIcon;
}

/**
 * Six figures at most, in one strip rather than six cards.
 *
 * Cards would put six borders, six shadows and six radii between the reader and
 * six numbers that are meant to be compared. Dividers do the same grouping job
 * and cost one pixel each.
 */
export function PricingKpiStrip({ items, loading }: { items: PricingKpi[]; loading?: boolean }) {
  const { lang } = useI18n();
  const ar = lang === "ar";

  return (
    <div
      className="hscroll scroll-hint-x rounded-xl border border-border bg-surface"
      style={{ ["--scroll-hint-bg" as string]: "var(--surface)" }}
      role="group"
      aria-label={ar ? "مؤشرات التسعير" : "Pricing indicators"}
    >
      <div className="grid min-w-[640px] grid-cols-3 lg:min-w-0 lg:grid-cols-6">
        {items.map((item, index) => {
          const Wrapper = item.onSelect ? "button" : "div";
          return (
            <Wrapper
              key={item.id}
              {...(item.onSelect
                ? {
                    type: "button" as const,
                    onClick: item.onSelect,
                    title: item.selectHint,
                    "aria-label": item.selectHint
                      ? `${item.label}: ${item.value}. ${item.selectHint}`
                      : undefined,
                  }
                : {})}
              className={`min-w-0 px-3.5 py-3 text-start transition-colors ${
                index ? "border-s border-border" : ""
              } ${index > 2 ? "border-t border-border lg:border-t-0" : ""} ${
                item.onSelect ? "cursor-pointer hover:bg-surface-2" : ""
              }`}
            >
              <div className="flex min-h-4 items-center gap-1.5">
                {item.Icon && (
                  <item.Icon size={12} className="shrink-0 text-text-subtle" aria-hidden="true" />
                )}
                <span className="truncate text-[10.5px] font-semibold text-text-muted">
                  {item.label}
                </span>
                {item.info}
              </div>

              {loading ? (
                <Skeleton className="mt-2 h-6 w-16 rounded-md" />
              ) : (
                <div className="mt-1 flex items-baseline gap-1.5">
                  {/* Leakage arrives as one figure per currency ("1,200 SAR +
                      1,780 EGP"). Clipping it would hide money, so the type
                      steps down instead and the figure stays whole. */}
                  <span
                    className={`num min-w-0 font-bold leading-tight tracking-tight ${
                      item.value.length > 20
                        ? "text-[12.5px]"
                        : item.value.length > 13
                          ? "text-[15px]"
                          : "text-[19px]"
                    }`}
                    style={{ color: toneColor(item.tone) }}
                  >
                    {item.value}
                  </span>
                  <KpiDelta value={item.delta} invert={item.deltaInvert} />
                </div>
              )}

              {item.question && (
                <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-text-subtle">
                  {item.question}
                </p>
              )}
            </Wrapper>
          );
        })}
      </div>
    </div>
  );
}

const toneColor = (tone: PricingKpi["tone"]): string =>
  tone === "danger"
    ? "var(--danger)"
    : tone === "warning"
      ? "var(--warning)"
      : tone === "success"
        ? "var(--success)"
        : "var(--text)";

function KpiDelta({ value, invert }: { value?: number; invert?: boolean }) {
  const { lang } = useI18n();
  if (value === undefined || !Number.isFinite(value)) return null;
  const flat = Math.abs(value) < 0.5;
  const good = invert ? value < 0 : value > 0;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  const color = flat ? "var(--text-subtle)" : good ? "var(--success)" : "var(--danger)";
  return (
    <span
      className="num inline-flex shrink-0 items-center gap-0.5 text-[10.5px] font-semibold"
      style={{ color }}
      title={lang === "ar" ? "مقارنة بالفترة السابقة" : "vs the previous period"}
    >
      <Icon size={11} strokeWidth={2.6} aria-hidden="true" />
      {flat ? "0" : `${value > 0 ? "+" : ""}${Math.round(value)}`}
    </span>
  );
}

/* --- tab bar -------------------------------------------------------------- */

export interface PricingTab<T extends string> {
  value: T;
  label: string;
  Icon: LucideIcon;
  /** Renders after a divider — the tabs that change data rather than read it. */
  admin?: boolean;
  badge?: number;
}

/**
 * The page's own tabs, sticky under whatever chrome is still on screen.
 *
 * Once the global header hides, this is the only thing left saying where the
 * reader is, so it parks itself at the top of the viewport and stays — a
 * context bar rather than a row that scrolled away with everything else.
 */
export function PricingTabBar<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: PricingTab<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  const ref = useRef<HTMLElement>(null);

  // Keep the selected tab in view when the reader arrives by deep link on a
  // narrow screen, where the strip scrolls sideways.
  useLayoutEffect(() => {
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({
      block: "nearest",
      inline: "center",
    });
  }, [value]);

  return (
    <nav
      ref={ref}
      aria-label={label}
      className="hscroll scroll-hint-x sticky z-10 rounded-xl border border-border bg-surface"
      style={{
        top: "calc(var(--chrome-header-h, 0px) + var(--chrome-sections-h, 0px))",
        transition: "top var(--dur-chrome) var(--ease-chrome)",
        ["--scroll-hint-bg" as string]: "var(--surface)",
      }}
    >
      <div className="flex min-w-max items-stretch px-1.5">
        {tabs.map(({ value: tab, label: tabLabel, Icon, admin, badge }) => {
          const active = tab === value;
          return (
            <button
              type="button"
              key={tab}
              onClick={() => onChange(tab)}
              aria-current={active ? "page" : undefined}
              className={`relative inline-flex min-h-12 items-center gap-2 px-3.5 text-[12.5px] font-semibold transition-colors ${
                admin ? "ms-1.5 border-s border-border ps-4" : ""
              } ${active ? "text-text" : "text-text-muted hover:text-text"}`}
            >
              <Icon
                size={15}
                strokeWidth={active ? 2.2 : 1.8}
                className={active ? "text-brand" : "text-text-subtle"}
                aria-hidden="true"
              />
              <span className="whitespace-nowrap">{tabLabel}</span>
              {!!badge && (
                <span
                  className="num grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-bold text-white"
                  style={{ background: "var(--danger)" }}
                >
                  {badge}
                </span>
              )}
              <span
                aria-hidden="true"
                className={`absolute inset-x-2.5 bottom-0 h-0.5 rounded-full transition-opacity ${
                  active ? "bg-brand opacity-100" : "opacity-0"
                }`}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
