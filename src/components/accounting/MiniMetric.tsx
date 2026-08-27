import { ArrowUpRight } from "lucide-react";

/**
 * A compact KPI tile. When `onDrill` is present the whole tile is an explicit
 * button, so a number that has source rows behind it looks and behaves like a
 * drill-down instead of a dead counter.
 */
export function MiniMetric({
  label,
  value,
  hint,
  onDrill,
  drillLabel,
}: {
  label: string;
  value: string;
  hint?: string;
  onDrill?: () => void;
  drillLabel?: string;
}) {
  const body = (
    <>
      <div
        className="truncate text-[10px] text-text-muted"
        title={hint ? `${label} — ${hint}` : label}
      >
        {label}
      </div>
      <div className="num mt-1 truncate text-sm font-semibold text-text" title={value}>
        {value}
      </div>
    </>
  );

  if (!onDrill) {
    return (
      <div className="min-w-0 rounded-xl border border-border bg-surface px-2.5 py-2">{body}</div>
    );
  }

  return (
    <button
      type="button"
      onClick={onDrill}
      aria-label={drillLabel || label}
      className="group min-w-0 rounded-xl border border-brand/20 bg-brand-soft/15 px-2.5 py-2 text-start transition-[border-color,background-color,box-shadow] hover:border-brand/45 hover:bg-brand-soft/35 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35"
    >
      <div className="flex items-center justify-between gap-1">
        <div className="min-w-0 flex-1">{body}</div>
        <ArrowUpRight
          size={13}
          className="mt-3 shrink-0 text-brand transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5"
        />
      </div>
    </button>
  );
}
