import { useEffect, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtCompact, fmtDayShort, fmtUSD, useI18n } from "@/lib/i18n";
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
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: p.color }}
            />
            {p.name}
          </span>
          <span className="num font-semibold">
            {formatter ? formatter(Number(p.value ?? 0), String(p.dataKey ?? "")) : fmtCompact(Number(p.value ?? 0))}
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
}: {
  data: { date: string; spend: number; revenue: number }[];
  height?: number;
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
              formatter={(v) => fmtUSD(v)}
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
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  format?: (n: number) => string;
  labelWidth?: number;
}) {
  const { t } = useI18n();
  const narrow = useIsNarrow();
  if (!data.length) return <EmptyState label={t("no_data")} compact />;

  const width = labelWidth ?? (narrow ? 84 : 130);
  const trim = (s: string) => {
    const max = narrow ? 12 : 20;
    return s.length > max ? s.slice(0, max) + "…" : s;
  };

  return (
    <ChartFrame height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
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
          tickFormatter={trim}
        />
        <Tooltip
          content={<ChartTooltip formatter={(v) => format(v)} />}
          cursor={{ fill: "var(--surface-2)" }}
        />
        <Bar dataKey="value" name={t("revenue")} fill={color} radius={[0, 6, 6, 0]} maxBarSize={22} />
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
        <Bar dataKey="value" name={name ?? t("revenue")} fill={color} radius={[6, 6, 0, 0]} maxBarSize={44} />
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
  series: { key: string; name: string; color: string }[];
  height?: number;
  format?: (n: number) => string;
}) {
  const { t, lang } = useI18n();
  const narrow = useIsNarrow();
  if (!data.length) return <EmptyState label={t("no_data")} compact />;
  const interval = Math.max(0, Math.ceil(data.length / (narrow ? 4 : 10)) - 1);

  return (
    <ChartFrame height={height}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
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
          content={<ChartTooltip formatter={(v) => format(v)} labelFormatter={(l) => fmtDayShort(l, lang)} />}
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
}: {
  data: { label: string; value: number }[];
  height?: number;
  format?: (n: number) => string;
}) {
  const { t } = useI18n();
  if (!data.length) return <EmptyState label={t("no_data")} compact />;

  // Beyond 6 slices a donut stops being readable — fold the rest into "Other".
  const top = data.slice(0, 6);
  const rest = data.slice(6).reduce((s, d) => s + d.value, 0);
  const slices = rest > 0 ? [...top, { label: "—", value: rest }] : top;

  return (
    <ChartFrame height={height}>
      <PieChart>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="label"
          innerRadius="52%"
          outerRadius="78%"
          paddingAngle={2}
          stroke="var(--surface)"
          strokeWidth={2}
        >
          {slices.map((_, i) => (
            <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<ChartTooltip formatter={(v) => format(v)} />} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, color: "var(--text-muted)" }}
        />
      </PieChart>
    </ChartFrame>
  );
}
