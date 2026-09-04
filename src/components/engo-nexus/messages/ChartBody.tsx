import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartMessage as ChartMessageType } from "../lib/nexus-message-schema";
import { formatMetric } from "../lib/nexus-format";
import { seriesColor } from "../lib/nexus-chart";

/**
 * The Recharts half of a chat chart, split into its own module so the chart
 * library only enters the bundle when a chart is actually rendered.
 *
 * Every value shown — axis tick and tooltip alike — goes through
 * `formatMetric`, so a chart can never be the place where raw float noise
 * escapes into the UI.
 */
export function ChartBody({ message }: { message: ChartMessageType }) {
  const common = {
    data: message.rows,
    margin: { top: 4, right: 8, bottom: 0, left: -12 },
  };

  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
      <XAxis
        dataKey={message.xKey}
        tick={{ fontSize: 10, fill: "var(--text-muted)" }}
        tickLine={false}
        axisLine={{ stroke: "var(--border)" }}
        minTickGap={16}
      />
      <YAxis
        tick={{ fontSize: 10, fill: "var(--text-muted)" }}
        tickLine={false}
        axisLine={false}
        width={48}
        tickFormatter={(value) =>
          formatMetric(value, message.series[0]?.unit ?? "count", message.series[0]?.currency)
        }
      />
      <Tooltip
        contentStyle={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          fontSize: 11,
        }}
        labelStyle={{ color: "var(--text-muted)" }}
        formatter={(value: unknown, name: unknown) => {
          const series = message.series.find((entry) => entry.label === name || entry.key === name);
          return [
            formatMetric(value, series?.unit ?? "count", series?.currency),
            series?.label ?? String(name),
          ];
        }}
      />
    </>
  );

  if (message.chartType === "bar") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart {...common}>
          {axes}
          {message.series.map((series, index) => (
            <Bar
              key={series.key}
              dataKey={series.key}
              name={series.label}
              fill={seriesColor(index)}
              radius={[3, 3, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (message.chartType === "area") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart {...common}>
          {axes}
          {message.series.map((series, index) => (
            <Area
              key={series.key}
              type="monotone"
              dataKey={series.key}
              name={series.label}
              stroke={seriesColor(index)}
              fill={seriesColor(index)}
              fillOpacity={0.15}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart {...common}>
        {axes}
        {message.series.map((series, index) => (
          <Line
            key={series.key}
            type="monotone"
            dataKey={series.key}
            name={series.label}
            stroke={seriesColor(index)}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
