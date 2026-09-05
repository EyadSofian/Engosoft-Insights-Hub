import type { NexusMetric } from "../lib/nexus-message-schema";
import { formatMetric, NOT_MEASURABLE } from "../lib/nexus-format";

/**
 * A compact grid of figures — the first thing a reader sees.
 *
 * Deliberately capped: the summary card shows the four that answer "how did it
 * do", and everything else lives behind "التفاصيل". A card that opens with
 * eleven KPIs is the wall of text this replaced, drawn in boxes.
 */
export function MetricGrid({
  metrics,
  lang,
  columns = 2,
}: {
  metrics: NexusMetric[];
  lang: "ar" | "en";
  columns?: 2 | 3 | 4;
}) {
  if (metrics.length === 0) return null;
  const cols = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" }[columns];
  return (
    <dl className={`grid ${cols} gap-x-3 gap-y-2`} data-testid="nexus-metric-grid">
      {metrics.map((metric) => {
        const rendered = formatMetric(metric.value, metric.unit, metric.currency);
        const unmeasured = rendered === NOT_MEASURABLE;
        return (
          <div key={metric.key} className="min-w-0">
            <dt className="truncate text-[11px] font-medium text-text-muted">{metric.label}</dt>
            <dd
              className={`num text-base font-semibold ${
                unmeasured ? "text-text-muted" : "text-text"
              }`}
              title={unmeasured ? (metric.unavailable ?? undefined) : undefined}
              data-testid={`nexus-summary-${metric.key}`}
            >
              {rendered}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
