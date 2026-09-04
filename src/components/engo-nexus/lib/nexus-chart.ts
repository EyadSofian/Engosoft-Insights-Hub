/**
 * Chart constants, kept out of the component files so those export components
 * only (which is what React Fast Refresh needs) and so the palette is testable
 * without rendering.
 *
 * The ramp is fixed and chosen once. A model never picks a colour — it names a
 * series, and the series' position in the payload decides its colour, so the
 * same chart re-rendered twice looks the same.
 */
export const SERIES_COLORS = ["#1656a0", "#0ea5e9", "#f59e0b", "#10b981", "#8b5cf6"] as const;

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length]!;
}
