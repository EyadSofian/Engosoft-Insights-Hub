import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { KpiCardMessage, KpiGroupMessage, NexusMetric } from "../lib/nexus-message-schema";
import {
  formatDelta,
  formatMetric,
  inferDirection,
  trendTone,
  NOT_MEASURABLE,
} from "../lib/nexus-format";
import { SourceBadges } from "./SourceBadges";

/**
 * A single measured figure.
 *
 * THE COLOUR DECISION IS MADE HERE, NOT BY THE MODEL. `trendTone` resolves the
 * metric's own semantics — a falling CPL is green, a falling revenue is red —
 * from `direction`, which the payload may declare and which is otherwise
 * inferred from the metric key. A metric whose direction is unknown renders
 * neutral, because a guessed colour is a claim about the business.
 *
 * An unmeasurable value renders the dash and its reason. It never renders `0`.
 */
const TONE_CLASS = {
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-rose-600 dark:text-rose-400",
  neutral: "text-text-muted",
} as const;

const TONE_ICON = {
  positive: ArrowUpRight,
  negative: ArrowDownRight,
  neutral: Minus,
} as const;

export function Metric({ metric, lang }: { metric: NexusMetric; lang: "ar" | "en" }) {
  const direction = metric.direction ?? inferDirection(metric.key);
  const tone = trendTone(metric.delta, direction);
  const Icon = TONE_ICON[tone];
  const rendered = formatMetric(metric.value, metric.unit, metric.currency);
  const unmeasured = rendered === NOT_MEASURABLE;

  return (
    <div className="min-w-0" data-testid={`nexus-metric-${metric.key}`}>
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-text-muted">
        {metric.label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span
          className={`num text-lg font-semibold ${unmeasured ? "text-text-muted" : "text-text"}`}
          data-testid={`nexus-metric-value-${metric.key}`}
        >
          {rendered}
        </span>
        {metric.delta !== null && metric.delta !== undefined && (
          <span
            className={`inline-flex items-center gap-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}
            data-tone={tone}
            data-testid={`nexus-metric-delta-${metric.key}`}
          >
            <Icon className="size-3" aria-hidden />
            <span className="num">{formatDelta(metric.delta, metric.deltaUnit ?? "percent")}</span>
          </span>
        )}
      </div>
      {unmeasured && metric.unavailable && (
        <p className="mt-1 text-[11px] leading-snug text-text-subtle">{metric.unavailable}</p>
      )}
    </div>
  );
}

export function KpiCard({ message, lang }: { message: KpiCardMessage; lang: "ar" | "en" }) {
  return (
    <div className="rounded-xl border border-border bg-bg-subtle p-3" data-testid="nexus-kpi-card">
      <Metric metric={message.metric} lang={lang} />
      {message.period && <p className="mt-2 text-[11px] text-text-subtle num">{message.period}</p>}
      <SourceBadges sources={message.sources} lang={lang} />
    </div>
  );
}

export function KpiGroup({ message, lang }: { message: KpiGroupMessage; lang: "ar" | "en" }) {
  return (
    <div className="rounded-xl border border-border bg-bg-subtle p-3" data-testid="nexus-kpi-group">
      {message.title && <h4 className="mb-2 text-xs font-semibold text-text">{message.title}</h4>}
      <div className="grid grid-cols-2 gap-3">
        {message.metrics.map((metric) => (
          <Metric key={metric.key} metric={metric} lang={lang} />
        ))}
      </div>
      {message.period && <p className="mt-2 text-[11px] text-text-subtle num">{message.period}</p>}
      <SourceBadges sources={message.sources} lang={lang} />
    </div>
  );
}
