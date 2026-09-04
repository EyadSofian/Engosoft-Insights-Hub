import { lazy, Suspense } from "react";
import type { ChartMessage as ChartMessageType } from "../lib/nexus-message-schema";
import { SourceBadges } from "./SourceBadges";
import { seriesColor } from "../lib/nexus-chart";

/**
 * A compact chart inside a chat bubble, drawn with Recharts — the library this
 * dashboard already ships. Adding a second charting library for a panel that
 * renders at most a few hundred points would be weight for nothing.
 *
 * Lazy-loaded: Recharts is one of the larger chunks in this app, and the vast
 * majority of ENGO Nexus turns are text. Loading it when the first chart
 * actually arrives keeps the launcher and the first reply fast.
 *
 * RTL: the chart itself stays LTR. Reversing a time axis because the surrounding
 * prose is Arabic would misread every trend — a rising line would appear to
 * fall. This matches how the dashboard's own charts behave, and the labels
 * around it are translated.
 */
const ChartBody = lazy(() =>
  import("./ChartBody").then((module) => ({ default: module.ChartBody })),
);

export function ChartMessage({ message, lang }: { message: ChartMessageType; lang: "ar" | "en" }) {
  return (
    <div className="rounded-xl border border-border bg-bg-subtle p-3" data-testid="nexus-chart">
      {message.title && <h4 className="mb-2 text-xs font-semibold text-text">{message.title}</h4>}
      <div className="h-40 w-full" dir="ltr">
        <Suspense
          fallback={
            <div className="grid h-full place-items-center">
              <span
                className="size-4 animate-spin rounded-full border-2 border-border border-t-transparent motion-reduce:animate-none"
                role="status"
                aria-label="Loading chart"
              />
            </div>
          }
        >
          <ChartBody message={message} />
        </Suspense>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {message.series.map((series, index) => (
          <li key={series.key} className="flex items-center gap-1 text-[11px] text-text-muted">
            <span
              className="size-2 rounded-full"
              style={{ background: seriesColor(index) }}
              aria-hidden
            />
            {series.label}
          </li>
        ))}
      </ul>
      <SourceBadges sources={message.sources} lang={lang} />
    </div>
  );
}
