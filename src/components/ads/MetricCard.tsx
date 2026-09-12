import type { ReactNode } from "react";
import { Ban, ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { METRICS, type MetricKey } from "@/lib/metric-catalog";
import { MetricInfo } from "./MetricInfo";
import { VERDICT_STYLE, type Verdict } from "./verdict";
import { toneVars, type AnyTone } from "@/lib/dashboard-tone";

const EM = "—";

/**
 * Colour is never the only signal. Every verdict ships an icon and a word, so
 * the card still reads for a colour-blind user and in a printed screenshot.
 */
export function VerdictChip({ verdict, label }: { verdict: Verdict; label: string }) {
  const v = VERDICT_STYLE[verdict];
  const Icon = v.icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
      style={{ background: v.soft, color: v.color }}
    >
      <Icon size={11} strokeWidth={2.5} />
      {label}
    </span>
  );
}

/**
 * A value that is not measurable. Deliberately neutral — grey, not red. A
 * missing Snapchat link-click metric is not bad performance, and colouring it
 * as though it were is how a data gap turns into a wrong decision.
 */
export function Unavailable({ reason, compact = false }: { reason?: string; compact?: boolean }) {
  const { lang } = useI18n();
  return (
    <span
      className="inline-flex items-center gap-1 text-text-subtle whitespace-nowrap"
      title={
        reason ??
        (lang === "ar" ? "غير متاح في المصدر الحالي" : "Not available in the current source")
      }
    >
      <span className="num">{EM}</span>
      {!compact && (
        <span className="text-[10px] font-medium">{lang === "ar" ? "غير متاح" : "N/A"}</span>
      )}
    </span>
  );
}

/**
 * The family each advertising metric belongs to.
 *
 * Same convention as the rest of the dashboard — money out is rose, money in
 * is mint, volume is sky, a closed deal is violet, a ratio is amber — so the
 * campaigns page reads on the same colour scale as every other report rather
 * than as a page of white cards next to pages of coloured ones.
 */
const METRIC_TONE: Partial<Record<MetricKey, AnyTone>> = {
  spend: "rose",
  cpm: "rose",
  cpc: "rose",
  cpl: "amber",
  cpa: "amber",
  roas: "amber",
  acos: "amber",
  ctrAll: "amber",
  ctrLink: "amber",
  conversionRate: "amber",
  lostRate: "amber",
  revenue: "mint",
  attributedRevenue: "mint",
  revenuePerLead: "mint",
  impressions: "sky",
  clicks: "sky",
  platformLeads: "sky",
  crmLeads: "sky",
  won: "violet",
  lost: "rose",
};

export function MetricCard({
  metric,
  value,
  /** Rendered instead of the value when the source cannot produce this number. */
  unavailableReason,
  sub,
  verdict,
  verdictLabel,
  icon,
  index = 0,
  hero = false,
  tone,
  note,
  onClick,
  actionLabel,
  ariaLabel,
  testId,
}: {
  metric: MetricKey;
  value: ReactNode;
  unavailableReason?: string;
  sub?: ReactNode;
  verdict?: Verdict;
  verdictLabel?: string;
  icon?: ReactNode;
  index?: number;
  hero?: boolean;
  /** Overrides the family this metric normally takes. */
  tone?: AnyTone;
  note?: string;
  /**
   * Opens this figure's drill-down. When set the card becomes a keyboard-
   * accessible button-like control. It deliberately stays a `div` so the
   * glossary's own information button is not nested inside another button.
   */
  onClick?: () => void;
  actionLabel?: string;
  ariaLabel?: string;
  testId?: string;
}) {
  const { lang } = useI18n();
  const copy = METRICS[metric][lang];
  const unavailable = !!unavailableReason;
  const family = tone ?? METRIC_TONE[metric] ?? "slate";
  const interactive = Boolean(onClick);
  const cue = actionLabel ?? (lang === "ar" ? "عرض التفاصيل" : "View detail");

  return (
    <div
      className={`tone-surface stagger @container pad-card relative flex h-full w-full flex-col overflow-hidden text-start ${
        interactive ? "kpi-card lift cursor-pointer" : ""
      }`}
      style={{ ...toneVars(family), "--i": index } as React.CSSProperties}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-haspopup={interactive ? "dialog" : undefined}
      aria-label={interactive ? (ariaLabel ?? `${copy.label} — ${cue}`) : undefined}
      data-metric-trigger={interactive ? "" : undefined}
      data-testid={testId}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-8 h-24 w-24 rounded-full opacity-[0.13]"
        style={{ background: "var(--tone-strong)", insetInlineEnd: "-1.25rem" }}
      />

      <div className="relative flex items-start justify-between gap-1.5">
        <span className="flex min-w-0 items-center gap-2">
          {icon && (
            <span
              className="grid size-7 shrink-0 place-items-center rounded-lg text-white"
              style={{ background: "var(--tone-strong)" }}
            >
              {icon}
            </span>
          )}
          <span
            className="line-clamp-2 text-[11.5px] font-semibold leading-snug"
            style={{ color: "var(--tone-ink)", opacity: 0.78 }}
            title={copy.label}
          >
            {copy.label}
          </span>
        </span>
        <MetricInfo metric={metric} note={note} align="end" />
      </div>

      <div
        className="num relative mt-2.5 overflow-hidden text-ellipsis whitespace-nowrap text-[clamp(1rem,16cqi,1.6rem)] font-bold leading-none tracking-[-0.03em]"
        style={{ color: "var(--tone-ink)" }}
      >
        {unavailable ? <Unavailable reason={unavailableReason} /> : value}
      </div>

      <div className="relative mt-2 flex min-h-[20px] flex-wrap items-center gap-x-2 gap-y-1">
        {verdict && verdictLabel && !unavailable && (
          <VerdictChip verdict={verdict} label={verdictLabel} />
        )}
        <span
          className="line-clamp-2 min-w-0 text-[10.5px] leading-snug"
          style={{ color: "var(--tone-ink)", opacity: 0.68 }}
          dir="auto"
        >
          {sub ?? (unavailable ? unavailableReason : copy.formula)}
        </span>
      </div>

      {interactive && (
        <div className="relative mt-auto pt-2.5">
          <span
            className="kpi-cue inline-flex items-center gap-0.5 text-[10.5px] font-bold"
            style={{ color: "var(--tone-strong)" }}
          >
            {cue}
            <span className="kpi-cue-arrow inline-flex" aria-hidden="true">
              {lang === "ar" ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

/** Small inline banner for a whole platform that reports nothing at all. */
export function NoSourceBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
      <Ban size={12} className="text-text-subtle" />
      {label}
    </span>
  );
}
