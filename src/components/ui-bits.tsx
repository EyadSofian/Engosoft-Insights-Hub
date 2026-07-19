import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, Inbox } from "lucide-react";
import { fmtDelta, fmtRoas, useI18n } from "@/lib/i18n";

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
      className={`card ${padded ? "p-4 sm:p-5" : ""} ${
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
    <div className={`flex items-start justify-between gap-3 mb-4 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-text truncate">{children}</h2>
        {hint && <p className="text-xs text-text-muted mt-0.5 leading-snug">{hint}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl sm:text-2xl font-semibold text-text">{title}</h1>
      {subtitle && <p className="text-sm text-text-muted mt-1">{subtitle}</p>}
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
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger";
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
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap"
      style={{ background: map.bg, color: map.color }}
    >
      {children}
    </span>
  );
}

/* --- KPI ----------------------------------------------------------------- */

export function KpiCard({
  label,
  value,
  sub,
  delta,
  deltaInvert,
  hero = false,
  icon,
  index = 0,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: number;
  deltaInvert?: boolean;
  hero?: boolean;
  icon?: ReactNode;
  index?: number;
}) {
  return (
    <div
      className="card stagger p-4 sm:p-5 relative overflow-hidden"
      style={
        {
          "--i": index,
          ...(hero
            ? {
                background: "var(--accent-soft)",
                borderColor: "color-mix(in oklab, var(--accent) 35%, transparent)",
              }
            : {}),
        } as React.CSSProperties
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted truncate">
          {label}
        </span>
        {icon && (
          <span className="text-text-subtle shrink-0" style={hero ? { color: "var(--accent-ink)" } : undefined}>
            {icon}
          </span>
        )}
      </div>

      <div
        className="num mt-2 font-semibold leading-none text-[22px] sm:text-[27px]"
        style={{ color: hero ? "var(--accent-ink)" : "var(--text)" }}
      >
        {value}
      </div>

      <div className="mt-2 flex items-center gap-2 min-h-[18px] flex-wrap">
        <DeltaBadge value={delta} invert={deltaInvert} />
        {sub != null && <span className="text-[11px] text-text-muted truncate">{sub}</span>}
      </div>
    </div>
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
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[104px]" />
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
}: {
  tone?: "info" | "warning" | "danger";
  title?: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  const map = {
    info: { bg: "var(--brand-soft)", color: "var(--brand)" },
    warning: { bg: "var(--warning-soft)", color: "var(--warning)" },
    danger: { bg: "var(--danger-soft)", color: "var(--danger)" },
  }[tone];

  return (
    <div
      className="rounded-xl px-4 py-3 flex gap-2.5 items-start text-sm animate-fade-in"
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
      className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border"
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
            className={`rounded-[7px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
              size === "md" ? "px-3 py-1.5 text-[13px]" : "px-2.5 py-1 text-xs"
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
