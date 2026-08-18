import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Columns3,
  Check,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { EmptyState } from "./ui-bits";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { exportCsv } from "@/lib/csv";

export interface Col<T> {
  key: string;
  header: ReactNode;
  render: (r: T) => ReactNode;
  sortValue?: (r: T) => number | string;
  align?: "right" | "left" | "center";
  width?: string;
  /** Keeps dense numeric tables aligned when the viewport gets narrow. */
  minWidth?: string;
  /** Pins the column while the table scrolls sideways. Use on the label column. */
  sticky?: boolean;
  /** Band this column belongs to, rendered as a grouped header above it. */
  group?: string;
  /** Off until the reader turns it on. Keeps the default table readable. */
  hideByDefault?: boolean;
  /** Cannot be hidden — the column that identifies the row. */
  always?: boolean;
  /** Plain-language name for the column chooser, when `header` is a node. */
  label?: string;
  /** Native tooltip on the header cell. */
  headerTitle?: string;
}

export function DataTable<T>({
  rows,
  cols,
  searchable,
  search,
  onSearchChange,
  pageSize = 25,
  className = "",
  onRowClick,
  csvFilename,
  csvRow,
  initialSort,
  maxHeight = 560,
  toolbar,
  belowToolbar,
  truncatedNote,
  groupLabels,
  columnChooser = false,
  emptyState,
}: {
  rows: T[];
  cols: Col<T>[];
  searchable?: (r: T) => string;
  /** Controlled search text. Omit to let the table own it. */
  search?: string;
  onSearchChange?: (v: string) => void;
  pageSize?: number;
  className?: string;
  onRowClick?: (r: T) => void;
  csvFilename?: string;
  csvRow?: (r: T) => Record<string, string | number>;
  initialSort?: { key: string; dir: 1 | -1 };
  maxHeight?: number;
  toolbar?: ReactNode;
  /** Full-width strip under the toolbar — filter chips, quick views. */
  belowToolbar?: ReactNode;
  truncatedNote?: string;
  /** Display names for the `group` values used on the columns. */
  groupLabels?: Record<string, string>;
  columnChooser?: boolean;
  emptyState?: ReactNode;
}) {
  const { t, lang } = useI18n();
  // Controlled when the caller passes `search`, so a sibling layout can share
  // one query and switching between them cannot change the visible rows.
  const [ownQ, setOwnQ] = useState("");
  const q = search ?? ownQ;
  const setQ = onSearchChange ?? setOwnQ;
  const [sortKey, setSortKey] = useState<string | null>(initialSort?.key ?? null);
  const [sortDir, setSortDir] = useState<1 | -1>(initialSort?.dir ?? -1);
  const [page, setPage] = useState(0);

  // A column set changes when the table switches grain, and the old hidden set
  // would then be meaningless. Re-seeding on identity change keeps the defaults
  // honest without wiping a choice the reader just made on the same set.
  const colIdentity = cols.map((c) => c.key).join("|");
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(cols.filter((c) => c.hideByDefault && !c.always).map((c) => c.key)),
  );
  useEffect(() => {
    setHidden(new Set(cols.filter((c) => c.hideByDefault && !c.always).map((c) => c.key)));
    // Re-seed on the column set itself, not on every render of new col objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colIdentity]);

  const visibleCols = useMemo(
    () => cols.filter((c) => c.always || !hidden.has(c.key)),
    [cols, hidden],
  );

  const filtered = useMemo(() => {
    let out = rows;
    if (q && searchable) {
      const nq = q.trim().toLowerCase();
      out = out.filter((r) => searchable(r).toLowerCase().includes(nq));
    }
    if (sortKey) {
      const col = cols.find((c) => c.key === sortKey);
      if (col?.sortValue) {
        const get = col.sortValue;
        out = [...out].sort((a, b) => {
          const va = get(a);
          const vb = get(b);
          if (typeof va === "number" && typeof vb === "number") return (va - vb) * sortDir;
          return String(va).localeCompare(String(vb), lang === "ar" ? "ar" : "en") * sortDir;
        });
      }
    }
    return out;
  }, [rows, q, sortKey, sortDir, searchable, cols, lang]);

  // Any change to the result set should bring the reader back to page 1.
  useEffect(() => {
    setPage(0);
  }, [q, sortKey, sortDir, rows]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const toggleSort = (c: Col<T>) => {
    if (!c.sortValue) return;
    if (sortKey === c.key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(c.key);
      setSortDir(-1);
    }
  };

  // Contiguous runs of the same group, so the band sits exactly over its columns.
  const bands = useMemo(() => {
    if (!groupLabels) return null;
    const out: { group?: string; span: number }[] = [];
    for (const c of visibleCols) {
      const last = out[out.length - 1];
      if (last && last.group === c.group) last.span += 1;
      else out.push({ group: c.group, span: 1 });
    }
    return out.some((b) => b.group) ? out : null;
  }, [visibleCols, groupLabels]);

  const hiddenCount = cols.filter((c) => !c.always && hidden.has(c.key)).length;

  return (
    <div className={`card overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-center gap-2 p-2.5 sm:p-3 border-b border-border">
        {searchable && (
          <div className="flex min-h-11 items-center gap-2 flex-1 min-w-[160px] max-w-[340px] px-2.5 rounded-xl sm:rounded-lg bg-surface-2 border border-border focus-within:border-brand transition-colors">
            <Search size={15} className="text-text-subtle shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("search")}
              aria-label={t("search")}
              className="flex-1 bg-transparent text-sm outline-none py-2 min-w-0"
            />
          </div>
        )}
        {toolbar}
        <div className="ms-auto flex items-center gap-2">
          <span className="text-xs text-text-muted num whitespace-nowrap">
            {filtered.length.toLocaleString("en-US")} {t("rows")}
          </span>

          {columnChooser && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="text-xs inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-3 py-2 transition-colors hover:bg-surface-2 active:scale-[0.98] sm:min-h-9 sm:rounded-lg sm:px-2.5 cursor-pointer"
                  aria-label={t("columns")}
                >
                  <Columns3 size={14} />
                  <span className="hidden sm:inline">{t("columns")}</span>
                  {hiddenCount > 0 && (
                    <span className="num text-[10px] text-text-muted">({hiddenCount})</span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-64 max-h-[60dvh] overflow-y-auto p-2 rounded-xl"
                style={{ background: "var(--surface)", borderColor: "var(--border)" }}
              >
                <p className="px-2 py-1.5 text-[11px] text-text-muted leading-relaxed">
                  {t("columns_hint")}
                </p>
                {Object.entries(
                  cols.reduce<Record<string, Col<T>[]>>((acc, c) => {
                    const g = c.group ?? "";
                    (acc[g] ??= []).push(c);
                    return acc;
                  }, {}),
                ).map(([group, groupCols]) => (
                  <div key={group} className="mb-1.5 last:mb-0">
                    {group && groupLabels?.[group] && (
                      <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
                        {groupLabels[group]}
                      </div>
                    )}
                    {groupCols.map((c) => {
                      const on = c.always || !hidden.has(c.key);
                      return (
                        <button
                          key={c.key}
                          disabled={c.always}
                          onClick={() =>
                            setHidden((prev) => {
                              const next = new Set(prev);
                              if (next.has(c.key)) next.delete(c.key);
                              else next.add(c.key);
                              return next;
                            })
                          }
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] text-start hover:bg-surface-2 transition-colors cursor-pointer disabled:cursor-default disabled:opacity-60"
                        >
                          <span
                            className="w-4 h-4 grid place-items-center rounded border shrink-0"
                            style={{
                              background: on ? "var(--brand)" : "transparent",
                              borderColor: on ? "var(--brand)" : "var(--border-strong)",
                            }}
                          >
                            {on && <Check size={11} color="#fff" strokeWidth={3} />}
                          </span>
                          <span className="truncate">{c.label ?? c.key}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </PopoverContent>
            </Popover>
          )}

          {csvRow && (
            <button
              onClick={() =>
                csvRow && exportCsv(filtered, csvRow, csvFilename ?? "engosoft-export")
              }
              className="text-xs inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-3 py-2 transition-colors hover:bg-surface-2 active:scale-[0.98] sm:min-h-9 sm:rounded-lg sm:px-2.5 cursor-pointer"
            >
              <Download size={14} />
              <span className="hidden sm:inline">{t("export_csv")}</span>
            </button>
          )}
        </div>
      </div>

      {belowToolbar && <div className="px-3 py-2 border-b border-border">{belowToolbar}</div>}

      {truncatedNote && (
        <div className="px-3 py-2 text-[11px] text-text-muted bg-warning-soft border-b border-border">
          {truncatedNote}
        </div>
      )}

      <div className="sm:hidden border-b border-border bg-surface-2/60 px-3 py-1.5 text-[10.5px] text-text-muted">
        {lang === "ar"
          ? "اسحب الجدول يمينًا ويسارًا لعرض باقي الأعمدة"
          : "Swipe sideways to view the remaining columns"}
      </div>

      {/* `table-wrap` already carries the thin bar on a desktop and none on a
          phone, where a native scrollbar reads as a grey slab across the data. */}
      <div className="table-wrap" style={{ maxHeight }}>
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            {bands && (
              <tr>
                {bands.map((b, i) => (
                  <th
                    key={i}
                    colSpan={b.span}
                    scope="colgroup"
                    className={`px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide bg-surface-2 whitespace-nowrap text-start ${
                      i === 0 && visibleCols[0]?.sticky ? "sticky-col z-20" : ""
                    }`}
                    style={{
                      color: b.group ? "var(--text-muted)" : "transparent",
                      background: "var(--surface-2)",
                      borderInlineStart: i > 0 && b.group ? "1px solid var(--border)" : undefined,
                    }}
                  >
                    {b.group ? (groupLabels?.[b.group] ?? b.group) : " "}
                  </th>
                ))}
              </tr>
            )}
            <tr>
              {visibleCols.map((c) => {
                const sorted = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c)}
                    aria-sort={sorted ? (sortDir === 1 ? "ascending" : "descending") : undefined}
                    scope="col"
                    title={c.headerTitle}
                    className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide bg-surface-2 border-b border-border whitespace-nowrap select-none ${
                      c.sortValue ? "cursor-pointer hover:text-text" : ""
                    } ${
                      c.align === "center"
                        ? "text-center"
                        : c.align === "right"
                          ? "text-end"
                          : "text-start"
                    } ${
                      c.sticky ? "sticky-col z-20" : ""
                    } ${sorted ? "text-text" : "text-text-muted"}`}
                    style={{
                      width: c.width,
                      minWidth: c.minWidth,
                      ...(c.sticky ? { background: "var(--surface-2)" } : {}),
                    }}
                  >
                    <span
                      className={`inline-flex items-center gap-1 ${
                        c.align === "center"
                          ? "justify-center"
                          : c.align === "right"
                            ? "flex-row-reverse"
                            : ""
                      }`}
                    >
                      {c.header}
                      {c.sortValue &&
                        (sorted ? (
                          sortDir === 1 ? (
                            <ArrowUp size={12} />
                          ) : (
                            <ArrowDown size={12} />
                          )
                        ) : (
                          <ArrowUpDown size={11} className="opacity-40" />
                        ))}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr
                key={i}
                onClick={() => onRowClick?.(r)}
                // A clickable row has to be reachable without a mouse, otherwise
                // the drill-down simply does not exist for keyboard users.
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? "button" : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(r);
                        }
                      }
                    : undefined
                }
                className={`group ${onRowClick ? "cursor-pointer" : ""}`}
              >
                {visibleCols.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2.5 border-b border-border align-middle transition-colors ${
                      i % 2 === 1 ? "bg-surface-2/40" : "bg-surface"
                    } group-hover:bg-brand-soft ${
                      c.align === "center"
                        ? "text-center num whitespace-nowrap"
                        : c.align === "right"
                          ? "text-end num whitespace-nowrap"
                          : ""
                    } ${c.sticky ? "sticky-col font-medium" : ""}`}
                    style={{ minWidth: c.minWidth }}
                  >
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {visible.length === 0 &&
          (emptyState ?? <EmptyState label={q ? t("no_results") : t("no_data")} compact />)}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 p-3 border-t border-border">
          <button
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs transition-colors hover:bg-surface-2 active:scale-[0.98] disabled:cursor-default disabled:opacity-40 sm:min-h-9 sm:rounded-lg cursor-pointer"
          >
            <ChevronLeft size={14} className="rtl:rotate-180" />
            {lang === "ar" ? "السابق" : "Prev"}
          </button>
          <span className="text-xs text-text-muted num">
            {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, filtered.length)}{" "}
            {t("of")} {filtered.length.toLocaleString("en-US")}
          </span>
          <button
            disabled={safePage + 1 >= pageCount}
            onClick={() => setPage((p) => p + 1)}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs transition-colors hover:bg-surface-2 active:scale-[0.98] disabled:cursor-default disabled:opacity-40 sm:min-h-9 sm:rounded-lg cursor-pointer"
          >
            {lang === "ar" ? "التالي" : "Next"}
            <ChevronRight size={14} className="rtl:rotate-180" />
          </button>
        </div>
      )}
    </div>
  );
}
