import type { ReactNode } from "react";
import { Ban } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { METRICS, type MetricKey } from "@/lib/metric-catalog";
import { MetricInfo } from "./MetricInfo";
import { VERDICT_STYLE, type Verdict } from "./verdict";

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
  note,
  onClick,
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
  note?: string;
  onClick?: () => void;
}) {
  const { lang } = useI18n();
  const copy = METRICS[metric][lang];
  const unavailable = !!unavailableReason;

  return (
    <div
      className="card stagger p-3.5 sm:p-4 flex flex-col gap-1.5 relative"
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
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-1.5">
        <span className="flex items-center gap-1.5 min-w-0">
          {icon && (
            <span
              className="text-text-subtle shrink-0"
              style={hero ? { color: "var(--accent-ink)" } : undefined}
            >
              {icon}
            </span>
          )}
          <span
            className="text-[11.5px] font-medium text-text-muted leading-snug line-clamp-2"
            title={copy.label}
          >
            {copy.label}
          </span>
        </span>
        <MetricInfo metric={metric} note={note} align="end" />
      </div>

      <div
        className="num font-semibold leading-none text-[21px] sm:text-[25px] mt-0.5"
        style={{ color: hero ? "var(--accent-ink)" : "var(--text)" }}
      >
        {unavailable ? <Unavailable reason={unavailableReason} /> : value}
      </div>

      <p className="text-[10.5px] text-text-subtle leading-snug mt-auto pt-1" dir="auto">
        {unavailable ? unavailableReason : copy.formula}
      </p>

      {(verdict || sub) && (
        <div className="flex items-center gap-2 flex-wrap min-h-[18px]">
          {verdict && verdictLabel && !unavailable && (
            <VerdictChip verdict={verdict} label={verdictLabel} />
          )}
          {sub != null && <span className="text-[10.5px] text-text-muted truncate">{sub}</span>}
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
