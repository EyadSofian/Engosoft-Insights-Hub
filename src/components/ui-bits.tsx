import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, Inbox } from "lucide-react";
import { fmtDelta, fmtRoas, useI18n } from "@/lib/i18n";
import { toneOf, toneVars, type AnyTone } from "@/lib/dashboard-tone";

/* --- surfaces ------------------------------------------------------------ */

export function Card({
  children,
  className = "",
  padded = true,
  hoverable = false,
  style,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  hoverable?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={`card min-w-0 ${padded ? "p-3.5 sm:p-5" : ""} ${
        hoverable ? "card-hover hover:shadow-md hover:-translate-y-0.5" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  hint,
  action,
  className = "",
}: {
  children: ReactNode;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 mb-3.5 sm:mb-4 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-[14px] sm:text-[15px] font-semibold text-text leading-snug sm:truncate">
          {children}
        </h2>
        {hint && <p className="text-xs text-text-muted mt-0.5 leading-snug">{hint}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* --- indicators ---------------------------------------------------------- */

export function DeltaBadge({ value, invert = false }: { value?: number; invert?: boolean }) {
  const { t } = useI18n();
  if (value === undefined || !isFinite(value)) return null;

  const flat = Math.abs(value) < 0.5;
  // For cost metrics a rise is bad, so `invert` flips the colour, not the arrow.
  const good = invert ? value < 0 : value > 0;
  const color = flat ? "var(--text-subtle)" : good ? "var(--success)" : "var(--danger)";
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className="inline-flex items-center gap-0.5 text-[11px] font-semibold num"
      style={{ color }}
      title={t("vs_prev")}
    >
      <Icon size={12} strokeWidth={2.5} />
      {flat ? "0%" : fmtDelta(value)}
    </span>
  );
}

export function RoasPill({ roas, size = "sm" }: { roas: number; size?: "sm" | "md" }) {
  let bg = "var(--danger-soft)";
  let color = "var(--danger)";
  if (roas >= 2) {
    bg = "var(--success-soft)";
    color = "var(--success)";
  } else if (roas >= 1) {
    bg = "var(--warning-soft)";
    color = "var(--warning)";
  }
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold num whitespace-nowrap ${
        size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]"
      }`}
      style={{ background: bg, color }}
    >
      {fmtRoas(roas)}
    </span>
  );
}

export function Pill({
  children,
  tone = "neutral",
  wrap = false,
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger";
  /** For pills that carry a phrase rather than a figure — a nav path, a label
   *  — which would otherwise run off the side of a narrow screen. */
  wrap?: boolean;
}) {
  const map = {
    neutral: { bg: "var(--surface-2)", color: "var(--text-muted)" },
    brand: { bg: "var(--brand-soft)", color: "var(--brand)" },
    success: { bg: "var(--success-soft)", color: "var(--success)" },
    warning: { bg: "var(--warning-soft)", color: "var(--warning)" },
    danger: { bg: "var(--danger-soft)", color: "var(--danger)" },
  }[tone];
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        wrap ? "whitespace-normal text-start" : "whitespace-nowrap"
      }`}
      style={{ background: map.bg, color: map.color }}
    >
      {children}
    </span>
  );
}

/* --- KPI ----------------------------------------------------------------- */

/**
 * A single headline figure, as a coloured card.
 *
 * The whole card takes its family: pastel ground, matching hairline, the
 * figure in the family's ink, a solid icon chip in the family's strong tone,
 * and — when the caller hands over a real series — a filled sparkline in the
 * same colour. That is deliberate and it is the point: a row of five KPIs has
 * to read as five different things from across a desk, and five white cards
 * with five small coloured icons read as one grey block.
 *
 * `spark` draws only from a genuine series out of the same response the value
 * came from. Two points minimum, no synthesised curve, no placeholder: an
 * empty sparkline slot means the API returned no series, not that the metric
 * was flat.
 */
export function KpiCard({
  label,
  value,
  sub,
  delta,
  deltaInvert,
  hero = false,
  tone,
  icon,
  index = 0,
  subWrap = false,
  valueWrap = false,
  info,
  spark,
  compact = false,
  loading = false,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: number;
  deltaInvert?: boolean;
  /** Emphasis for the page's single most important figure. */
  hero?: boolean;
  /** Colour family. Defaults to slate — a figure with no story of its own. */
  tone?: AnyTone;
  icon?: ReactNode;
  index?: number;
  /** Allow explanatory KPI source text to wrap instead of silently truncating. */
  subWrap?: boolean;
  /** Allow long semantic values, such as Arabic durations, to wrap without ellipsis. */
  valueWrap?: boolean;
  /** Optional "where does this number come from?" control, shown by the label. */
  info?: ReactNode;
  /** A real time series for this metric. Anything shorter than two points is ignored. */
  spark?: number[];
  /** Shorter card for a secondary row. */
  compact?: boolean;
  loading?: boolean;
  onClick?: () => void;
}) {
  const t = toneOf(tone);

  if (loading) {
    return (
      <div
        className={`tone-surface @container relative overflow-hidden ${
          compact ? "min-h-[104px]" : "min-h-[142px] sm:min-h-[156px]"
        }`}
        style={toneVars(tone)}
        aria-busy="true"
      >
        <div className="space-y-3 p-4 sm:p-5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    );
  }

  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`tone-surface stagger @container relative overflow-hidden text-start ${
        onClick ? "lift w-full cursor-pointer" : ""
      } ${compact ? "min-h-[98px] p-3.5" : "min-h-[136px] p-4 sm:min-h-[148px] sm:px-4.5 sm:py-4"} ${
        hero ? "ring-1 ring-inset" : ""
      }`}
      style={
        {
          ...toneVars(tone),
          "--i": index,
          ...(hero ? { boxShadow: "var(--shadow-sm)" } : {}),
        } as React.CSSProperties
      }
    >
      {/* A wash of the family's strong tone bleeding in from the trailing
          corner. It is what makes the card read as coloured at a glance and at
          a distance, without lifting the pastel enough to hurt the figure. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-8 h-28 w-28 rounded-full opacity-[0.13]"
        style={{ background: "var(--tone-strong)", insetInlineEnd: "-1.5rem", filter: "blur(4px)" }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <span className="inline-flex min-w-0 items-start gap-1.5">
          <span
            className={`font-semibold leading-[1.4] ${compact ? "line-clamp-1 text-[10.5px]" : "line-clamp-2 text-[11.5px] sm:text-xs"}`}
            style={{ color: "var(--tone-ink)", opacity: 0.78 }}
          >
            {label}
          </span>
          {info}
        </span>
        {icon && (
          <span
            className={`grid shrink-0 place-items-center rounded-xl text-white shadow-sm ${
              compact ? "size-7" : "size-9"
            }`}
            style={{ background: "var(--tone-strong)" }}
          >
            {icon}
          </span>
        )}
      </div>

      <div
        className={`num relative max-w-full min-w-0 font-bold tracking-[-0.03em] ${
          compact ? "mt-1.5" : "mt-2.5"
        } ${
          valueWrap
            ? "overflow-visible whitespace-normal text-[clamp(1rem,13cqi,1.6rem)] leading-[1.15]"
            : "overflow-hidden text-ellipsis whitespace-nowrap text-[clamp(1rem,16cqi,1.95rem)] leading-none"
        }`}
        style={{ color: "var(--tone-ink)" }}
      >
        {value}
      </div>

      <div
        className={`relative flex items-end justify-between gap-2 ${compact ? "mt-1.5" : "mt-2.5 min-h-[30px]"}`}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <DeltaBadge value={delta} invert={deltaInvert} />
          {sub != null && (
            <span
              className={`min-w-0 leading-[1.5] ${compact ? "line-clamp-1 text-[10px]" : "text-[10.5px] sm:text-[11px]"} ${
                subWrap ? "leading-relaxed" : "line-clamp-2"
              }`}
              style={{ color: "var(--tone-ink)", opacity: 0.68 }}
            >
              {sub}
            </span>
          )}
        </span>
        {!compact && <Sparkline points={spark} color="var(--tone-strong)" />}
      </div>
    </Tag>
  );
}

/**
 * The shape of a metric over the selected period — nothing more.
 *
 * Draws only with at least two finite points, and is `aria-hidden` because the
 * figure and its delta beside it already carry the same information in text.
 * Filled rather than a bare stroke: at 64x26 a 1.75px line disappears against
 * a pastel ground, and the fill is what makes the card read as having a shape.
 */
export function Sparkline({
  points,
  color = "var(--chart-1)",
  width = 68,
  height = 26,
}: {
  points?: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const clean = (points ?? []).filter((n) => typeof n === "number" && isFinite(n));
  if (clean.length < 2) return null;

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const step = width / (clean.length - 1);
  const at = (n: number, i: number) =>
    `${(i * step).toFixed(2)},${(height - 2 - ((n - min) / span) * (height - 4)).toFixed(2)}`;
  const line = clean.map((n, i) => `${i === 0 ? "M" : "L"}${at(n, i)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="hidden shrink-0 @[10rem]:block"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d={area} fill={color} opacity={0.16} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* --- ranked bar list ----------------------------------------------------- */

export function BarList({
  items,
  format,
  max,
  color = "var(--chart-1)",
  emptyLabel,
}: {
  items: { label: string; value: number; meta?: ReactNode }[];
  format: (n: number) => string;
  max?: number;
  color?: string;
  emptyLabel?: string;
}) {
  const { t } = useI18n();
  if (!items.length) return <EmptyState label={emptyLabel ?? t("no_data")} compact />;
  const peak = max ?? Math.max(...items.map((i) => Math.abs(i.value)), 1);

  return (
    <div className="space-y-2.5">
      {items.map((it, i) => (
        <div key={it.label + i} className="stagger" style={{ "--i": i } as React.CSSProperties}>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-[13px] text-text truncate" title={it.label}>
              {it.label}
            </span>
            <span className="num text-[13px] font-medium text-text shrink-0">
              {it.meta ?? format(it.value)}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.max(1.5, (Math.abs(it.value) / peak) * 100)}%`,
                background: color,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* --- funnel -------------------------------------------------------------- */

export function FunnelBars({
  steps,
}: {
  steps: { label: string; value: number; display: string; accent?: boolean }[];
}) {
  const peak = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="space-y-3">
      {steps.map((s, i) => {
        const width = Math.max(4, (s.value / peak) * 100);
        // Conversion rate from the previous stage — the number that matters.
        const prev = i > 0 ? steps[i - 1].value : 0;
        // CRM can hold leads that never came from Meta, so a stage may exceed
        // the one above it. A ">100% conversion" reads as a bug — hide it.
        const raw = i > 0 && prev > 0 ? (s.value / prev) * 100 : null;
        const rate = raw !== null && raw <= 100 ? raw : null;
        return (
          <div key={s.label} className="stagger" style={{ "--i": i } as React.CSSProperties}>
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <span className="text-xs text-text-muted">{s.label}</span>
              <div className="flex items-baseline gap-2">
                {rate !== null && (
                  <span className="num text-[10px] text-text-subtle">{rate.toFixed(1)}%</span>
                )}
                <span className="num text-[13px] font-semibold text-text">{s.display}</span>
              </div>
            </div>
            <div className="h-7 rounded-lg bg-surface-2 overflow-hidden">
              <div
                className="h-full rounded-lg transition-[width] duration-700"
                style={{
                  width: `${width}%`,
                  background: s.accent
                    ? "var(--accent)"
                    : `color-mix(in oklab, var(--chart-1) ${100 - i * 9}%, var(--surface-3))`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* --- states -------------------------------------------------------------- */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`shimmer rounded-lg ${className}`} />;
}

export function KpiSkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[96px] sm:h-[118px]" />
      ))}
    </div>
  );
}

export function EmptyState({
  label,
  hint,
  compact = false,
}: {
  label: string;
  hint?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? "py-8" : "py-14"
      }`}
    >
      <Inbox size={compact ? 22 : 30} className="text-text-subtle mb-2" strokeWidth={1.5} />
      <p className="text-sm text-text-muted">{label}</p>
      {hint && <p className="text-xs text-text-subtle mt-1 max-w-xs">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { lang } = useI18n();
  return (
    <Card className="text-center py-10">
      <p className="text-sm text-text mb-1 font-medium">
        {lang === "ar" ? "تعذّر تحميل البيانات" : "Couldn't load data"}
      </p>
      <p className="text-xs text-text-muted mb-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-lg text-sm text-white transition-colors"
          style={{ background: "var(--brand)" }}
        >
          {lang === "ar" ? "إعادة المحاولة" : "Try again"}
        </button>
      )}
    </Card>
  );
}

/* --- notices ------------------------------------------------------------- */

export function Notice({
  tone = "info",
  title,
  children,
  icon,
  className = "",
}: {
  tone?: "info" | "warning" | "danger";
  title?: string;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  const map = {
    info: { bg: "var(--brand-soft)", color: "var(--brand)" },
    warning: { bg: "var(--warning-soft)", color: "var(--warning)" },
    danger: { bg: "var(--danger-soft)", color: "var(--danger)" },
  }[tone];

  return (
    <div
      className={`rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 flex gap-2.5 items-start text-[13px] sm:text-sm animate-fade-in ${className}`}
      style={{ background: map.bg, color: map.color }}
    >
      {icon && <span className="shrink-0 mt-0.5">{icon}</span>}
      <div className="min-w-0 leading-relaxed">
        {title && <div className="font-semibold mb-0.5">{title}</div>}
        <div className="opacity-90">{children}</div>
      </div>
    </div>
  );
}

/* --- controls ------------------------------------------------------------ */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  size?: "sm" | "md";
}) {
  return (
    <div
      className="inline-flex w-max items-center gap-0.5 rounded-xl border border-border bg-surface-2 p-0.5 sm:rounded-lg"
      role="tablist"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`min-h-11 min-w-11 rounded-[9px] font-medium transition-colors active:scale-[0.97] sm:min-h-0 sm:min-w-0 sm:rounded-[7px] cursor-pointer whitespace-nowrap ${
              size === "md" ? "px-3 py-1.5 text-[13px]" : "px-3 py-1 text-xs"
            } ${active ? "text-white shadow-sm" : "text-text-muted hover:text-text"}`}
            style={active ? { background: "var(--brand)" } : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
