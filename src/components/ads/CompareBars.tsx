import { fmtUSD, useI18n } from "@/lib/i18n";
import { PLATFORM_COLOR } from "@/lib/constants";
import type { PerfRow } from "@/lib/types";
import { EmptyState } from "@/components/ui-bits";

/**
 * Spend against revenue, one campaign per block.
 *
 * This deliberately is not a charting-library bar chart. A category axis has to
 * fit the label in a fixed gutter, and these names — "INTERIOR-21/11/25- sayed",
 * "cfm-creative -sayed-15-6-26" — are long, mixed Arabic/Latin, and were being
 * painted straight over the bars, then word-wrapped onto a second line that
 * collided with the row below. On a 375px phone the gutter and the plot area
 * overlapped almost completely.
 *
 * Giving the name its own full-width line solves all of it: one truncation rule,
 * real CSS ellipsis, correct RTL, and the bars keep the entire width to
 * themselves. The comparison the reader actually makes — is the orange bar
 * shorter than the blue one? — gets clearer, not weaker.
 */
export function CompareBars({
  rows,
  emptyLabel,
  onRowClick,
}: {
  rows: PerfRow[];
  emptyLabel?: string;
  onRowClick?: (r: PerfRow) => void;
}) {
  const { t, lang } = useI18n();
  if (!rows.length) return <EmptyState label={emptyLabel ?? t("no_data")} compact />;

  // One shared scale across both measures, so the two bars in a block are
  // directly comparable and so are the blocks against each other.
  const peak = Math.max(...rows.flatMap((r) => [r.spend, r.revenue]), 1);
  const pct = (v: number) => `${Math.max(v > 0 ? 1.5 : 0, (v / peak) * 100)}%`;

  return (
    <div>
      <div className="flex items-center gap-4 mb-3 text-[11px] text-text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "var(--chart-1)" }} />
          {lang === "ar" ? "الإنفاق" : "Spend"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "var(--chart-2)" }} />
          {lang === "ar" ? "الإيراد المحصّل" : "Collected revenue"}
        </span>
      </div>

      <ul className="space-y-3">
        {rows.map((r, i) => {
          const recovered = r.revenue >= r.spend;
          const Row = onRowClick ? "button" : "div";
          return (
            <li key={r.key} className="stagger" style={{ "--i": i } as React.CSSProperties}>
              <Row
                {...(onRowClick
                  ? {
                      type: "button" as const,
                      onClick: () => onRowClick(r),
                      "aria-label": `${r.name || "—"} — ${t("spend")} ${fmtUSD(r.spend)}، ${t("revenue")} ${fmtUSD(r.revenue)}`,
                    }
                  : {})}
                className={`w-full text-start block rounded-lg -mx-1.5 px-1.5 py-1 transition-colors ${
                  onRowClick ? "cursor-pointer hover:bg-surface-2" : ""
                }`}
              >
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: PLATFORM_COLOR[r.platforms[0] ?? "meta"] }}
                    />
                    <span
                      className="text-[12.5px] text-text truncate"
                      dir="auto"
                      title={r.name || "—"}
                    >
                      {r.name || "—"}
                    </span>
                  </span>
                  <span
                    className="num text-[11px] shrink-0 font-medium"
                    style={{ color: recovered ? "var(--success)" : "var(--text-muted)" }}
                  >
                    {r.roas === null || r.spend <= 0 ? "—" : `${r.roas.toFixed(2)}×`}
                  </span>
                </div>

                <Bar value={r.spend} width={pct(r.spend)} color="var(--chart-1)" />
                <Bar value={r.revenue} width={pct(r.revenue)} color="var(--chart-2)" />
              </Row>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Bar({ value, width, color }: { value: number; width: string; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-1 last:mb-0">
      <div className="flex-1 h-2.5 rounded-full bg-surface-2 overflow-hidden min-w-0">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width, background: color }}
        />
      </div>
      <span className="num text-[11px] text-text-muted w-[58px] text-end shrink-0">
        {fmtUSD(value)}
      </span>
    </div>
  );
}
