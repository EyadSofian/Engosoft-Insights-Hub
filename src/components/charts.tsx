import { useEffect, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { fmtCompact, fmtDayShort, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import { EmptyState } from "./ui-bits";

export function useIsNarrow(breakpoint = 640) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [breakpoint]);
  return narrow;
}

const axisTick = { fill: "var(--text-subtle)", fontSize: 11 };
const gridStroke = "var(--border)";

/** Shared tooltip so every chart reads the same. */
function ChartTooltip({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
}: {
  active?: boolean;
  payload?: { name?: string; dataKey?: string | number; value?: number; color?: string }[];
  label?: string;
  formatter?: (v: number, key: string) => string;
  labelFormatter?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl px-3 py-2 text-xs shadow-lg pointer-events-none"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        color: "var(--text)",
        minWidth: 120,
      }}
    >
      {label != null && (
        <div className="font-medium mb-1.5 text-text">
          {labelFormatter ? labelFormatter(String(label)) : String(label)}
        </div>
      )}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-3 py-0.5">
          <span className="flex items-center gap-1.5 text-text-muted">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="num font-semibold">
            {formatter
              ? formatter(Number(p.value ?? 0), String(p.dataKey ?? ""))
              : fmtCompact(Number(p.value ?? 0))}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ChartFrame({ height = 260, children }: { height?: number; children: ReactNode }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

/* --- spend vs revenue ---------------------------------------------------- */

export function SpendRevenueChart({
  data,
  height = 280,
  moneyFormat = fmtUSD,
}: {
  data: { date: string; spend: number; revenue: number }[];
  height?: number;
  /** Tooltip formatter. Accounting passes the exact, non-abbreviated formatter. */
  moneyFormat?: (value: number) => string;
}) {
  const { t, lang } = useI18n();
  const narrow = useIsNarrow();
  if (!data.length) return <EmptyState label={t("no_data")} compact />;

  // Thin the axis labels on small screens so they never collide.
  const interval = Math.max(0, Math.ceil(data.length / (narrow ? 4 : 10)) - 1);

  return (
    <ChartFrame height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="gSpend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.32} />
            <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={gridStroke} vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          interval={interval}
          tickFormatter={(v: string) => fmtDayShort(v, lang)}
          minTickGap={8}
        />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v: number) => fmtCompact(v)}
        />
        <Tooltip
          content={
            <ChartTooltip
              formatter={(v) => moneyFormat(v)}
              labelFormatter={(l) => fmtDayShort(l, lang)}
            />
          }
          cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, color: "var(--text-muted)", paddingTop: 8 }}
        />
        <Area
          type="monotone"
          dataKey="spend"
          name={t("spend")}
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#gSpend)"
        />
        <Area
          type="monotone"
          dataKey="revenue"
          name={t("revenue")}
          stroke="var(--chart-2)"
          strokeWidth={2}
          fill="url(#gRev)"
        />
      </AreaChart>
    </ChartFrame>
  );
}

/* --- horizontal ranked bars ---------------------------------------------- */

export function HBarChart({
  data,
  height = 260,
  color = "var(--chart-1)",
  format = fmtUSD,
  labelWidth,
  name,
  showValues = false,
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  format?: (n: number) => string;
  labelWidth?: number;
  /**
   * Series name in the tooltip. Defaults to revenue because most callers plot
   * money — but a chart whose metric is switchable must pass the current one,
   * or the tooltip keeps announcing "revenue" over a count of leads.
   */
  name?: string;
  /** Print each value at the end of its bar, so reading the chart costs no hover. */
  showValues?: boolean;
}) {
  const { t } = useI18n();
  const narrow = useIsNarrow();
  if (!data.length) return <EmptyState label={t("no_data")} compact />;

  const width = labelWidth ?? (narrow ? 84 : 130);
  // Ellipsis tied to the gutter that was actually reserved, at ~6.2px per
  // character for the 11px ticks. A fixed character count either clipped inside
  // a wide gutter or overflowed a narrow one.
  const maxChars = Math.max(6, Math.floor((width - 12) / 6.2));
  const trim = (s: string) => (s.length > maxChars ? s.slice(0, maxChars - 1) + "…" : s);

  return (
    <ChartFrame height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: showValues ? 48 : 12, left: 0, bottom: 0 }}
      >
        <CartesianGrid stroke={gridStroke} horizontal={false} strokeDasharray="3 3" />
        <XAxis
          type="number"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => fmtCompact(v)}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={width}
          tickMargin={8}
          tickFormatter={trim}
        />
        <Tooltip
          content={<ChartTooltip formatter={(v) => format(v)} />}
          cursor={{ fill: "var(--surface-2)" }}
        />
        <Bar
          dataKey="value"
          name={name ?? t("revenue")}
          fill={color}
          radius={[0, 6, 6, 0]}
          maxBarSize={22}
        >
          {showValues && (
            <LabelList
              dataKey="value"
              position="right"
              fill="var(--text-muted)"
              fontSize={11}
              formatter={(v: number) => fmtCompact(v)}
            />
          )}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

/* --- vertical bars ------------------------------------------------------- */

export function VBarChart({
  data,
  height = 260,
  color = "var(--chart-1)",
  format = fmtUSD,
  name,
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  format?: (n: number) => string;
  name?: string;
}) {
  const { t } = useI18n();
  const narrow = useIsNarrow();
  if (!data.length) return <EmptyState label={t("no_data")} compact />;
  const interval = Math.max(0, Math.ceil(data.length / (narrow ? 5 : 12)) - 1);

  return (
    <ChartFrame height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={gridStroke} vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          interval={interval}
          minTickGap={6}
        />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v: number) => fmtCompact(v)}
        />
        <Tooltip
          content={<ChartTooltip formatter={(v) => format(v)} />}
          cursor={{ fill: "var(--surface-2)" }}
        />
        <Bar
          dataKey="value"
          name={name ?? t("revenue")}
          fill={color}
          radius={[6, 6, 0, 0]}
          maxBarSize={44}
        />
      </BarChart>
    </ChartFrame>
  );
}

/* --- multi-series line --------------------------------------------------- */

export function MultiLineChart({
  data,
  series,
  height = 260,
  format = fmtCompact,
}: {
  data: Record<string, string | number>[];
  series: {
    key: string;
    name: string;
    color: string;
    /**
     * Put a series on its own scale. Without this, plotting a count (~30/month)
     * against revenue (~$30K) pins the count flat to the axis and it reads as
     * zero. Only set it when the two series have genuinely different units.
     */
    axis?: "left" | "right";
  }[];
  height?: number;
  format?: (n: number) => string;
}) {
  const { t, lang } = useI18n();
  const narrow = useIsNarrow();
  if (!data.length) return <EmptyState label={t("no_data")} compact />;
  const interval = Math.max(0, Math.ceil(data.length / (narrow ? 4 : 10)) - 1);
  const hasRight = series.some((s) => s.axis === "right");

  return (
    <ChartFrame height={height}>
      {/* No negative left margin: it slid the y-axis "0" under the first x-axis
          label, so the two collided in the corner. tickMargin keeps them apart. */}
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={gridStroke} vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          interval={interval}
          tickMargin={8}
          tickFormatter={(v: string) => fmtDayShort(v, lang)}
          minTickGap={12}
        />
        <YAxis
          yAxisId="left"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={46}
          tickMargin={4}
          tickFormatter={(v: number) => fmtCompact(v)}
        />
        {hasRight && (
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={42}
            tickMargin={4}
            tickFormatter={(v: number) => fmtCompact(v)}
          />
        )}
        <Tooltip
          content={
            <ChartTooltip
              formatter={(v) => format(v)}
              labelFormatter={(l) => fmtDayShort(l, lang)}
            />
          }
          cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, color: "var(--text-muted)", paddingTop: 8 }}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            yAxisId={s.axis ?? "left"}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ChartFrame>
  );
}

/* --- scatter -------------------------------------------------------------- */

/**
 * Spend on one axis, what it produced on the other. Every dot is one campaign,
 * so the shape of the cloud answers "is more spend actually buying more?" in a
 * way no sorted table does. A reference line marks break-even where both axes
 * are money.
 */
export function ScatterPlot({
  points,
  xName,
  yName,
  height = 300,
  formatX = fmtUSD,
  formatY = fmtUSD,
  breakEven = false,
  emptyLabel,
}: {
  points: { x: number; y: number; label: string; color?: string }[];
  xName: string;
  yName: string;
  height?: number;
  formatX?: (n: number) => string;
  formatY?: (n: number) => string;
  breakEven?: boolean;
  /** Say *why* it is empty. "No data" reads as a bug when the cause is a missing source. */
  emptyLabel?: string;
}) {
  const { t } = useI18n();
  if (!points.length) return <EmptyState label={emptyLabel ?? t("no_data")} compact />;

  const maxX = Math.max(...points.map((p) => p.x), 1);
  const maxY = Math.max(...points.map((p) => p.y), 1);
  const line = breakEven
    ? [
        { x: 0, y: 0 },
        { x: Math.min(maxX, maxY), y: Math.min(maxX, maxY) },
      ]
    : null;

  return (
    <ChartFrame height={height}>
      <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
        <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="x"
          name={xName}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
          tickFormatter={(v: number) => fmtCompact(v)}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={yName}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={50}
          tickMargin={4}
          tickFormatter={(v: number) => fmtCompact(v)}
        />
        <ZAxis range={[46, 46]} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3", stroke: "var(--border-strong)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { x: number; y: number; label: string };
            return (
              <div
                className="rounded-xl px-3 py-2 text-xs shadow-lg pointer-events-none max-w-[15rem]"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              >
                <div className="font-medium mb-1 break-words">{p.label}</div>
                <div className="flex items-center justify-between gap-3 text-text-muted">
                  <span>{xName}</span>
                  <span className="num font-semibold text-text">{formatX(p.x)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-text-muted">
                  <span>{yName}</span>
                  <span className="num font-semibold text-text">{formatY(p.y)}</span>
                </div>
              </div>
            );
          }}
        />
        {line && (
          <Scatter
            data={line}
            line={{ stroke: "var(--border-strong)", strokeDasharray: "4 4" }}
            shape={() => <g />}
            legendType="none"
            isAnimationActive={false}
          />
        )}
        <Scatter data={points} name={yName} fill="var(--chart-1)">
          {points.map((p, i) => (
            <Cell key={i} fill={p.color ?? "var(--chart-1)"} fillOpacity={0.75} />
          ))}
        </Scatter>
      </ScatterChart>
    </ChartFrame>
  );
}

/* --- donut --------------------------------------------------------------- */

const DONUT_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

export function DonutChart({
  data,
  height = 260,
  format = fmtCompact,
  centerCaption,
}: {
  /**
   * `color` pins a slice to one colour. Without it the palette is positional,
   * so a category that slips a rank between two views changes colour and the
   * two views stop being comparable — callers that own the categories should
   * assign, and keep, their own.
   */
  data: { label: string; value: number; color?: string }[];
  height?: number;
  format?: (n: number) => string;
  /** Labels the total shown in the hole. Omit and the hole stays empty. */
  centerCaption?: string;
}) {
  const { t, lang } = useI18n();
  if (!data.length) return <EmptyState label={t("no_data")} compact />;

  // Beyond 6 slices a donut stops being readable — fold the rest into "Other".
  const top = data.slice(0, 6);
  const rest = data.slice(6).reduce((s, d) => s + d.value, 0);
  const slices =
    rest > 0
      ? [
          ...top,
          { label: lang === "ar" ? "أخرى" : "Other", value: rest, color: "var(--chart-muted)" },
        ]
      : top;
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const painted = slices.map((slice, i) => ({
    ...slice,
    fill: slice.color ?? DONUT_COLORS[i % DONUT_COLORS.length],
    share: total > 0 ? (slice.value / total) * 100 : 0,
  }));

  return (
    <div className="flex min-w-0 flex-col">
      <div className="relative">
        <ChartFrame height={height}>
          <PieChart>
            <Pie
              data={painted}
              dataKey="value"
              nameKey="label"
              innerRadius="58%"
              outerRadius="82%"
              paddingAngle={2}
              stroke="var(--surface)"
              strokeWidth={2}
            >
              {painted.map((slice) => (
                <Cell key={slice.label} fill={slice.fill} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip formatter={(v) => format(v)} />} />
          </PieChart>
        </ChartFrame>
        {/* The hole is the only place a donut can state its own total without
            stealing room from the ring. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-xl font-bold text-text sm:text-2xl">{format(total)}</span>
          {centerCaption && (
            <span className="mt-0.5 max-w-[9rem] text-center text-[11px] leading-tight text-text-muted">
              {centerCaption}
            </span>
          )}
        </div>
      </div>

      {/* Replaces recharts' inline legend, which wrapped into ragged rows and
          could only name the slices. A column can also carry each value and
          share, which is what the ring itself cannot show. */}
      <ul className="mt-1 space-y-2 border-t border-border pt-3">
        {painted.map((slice) => (
          <li key={slice.label} className="flex items-center gap-2 text-xs">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: slice.fill }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-text-muted" title={slice.label}>
              {slice.label}
            </span>
            <span className="num shrink-0 font-semibold text-text">{format(slice.value)}</span>
            <span className="num w-12 shrink-0 text-end text-text-subtle">
              {fmtPct(slice.share, 0)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
