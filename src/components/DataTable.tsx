import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Search, Download, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { EmptyState } from "./ui-bits";

export interface Col<T> {
  key: string;
  header: ReactNode;
  render: (r: T) => ReactNode;
  sortValue?: (r: T) => number | string;
  align?: "right" | "left";
  width?: string;
  /** Pins the column while the table scrolls sideways. Use on the label column. */
  sticky?: boolean;
}

export function DataTable<T>({
  rows,
  cols,
  searchable,
  pageSize = 25,
  className = "",
  onRowClick,
  csvFilename,
  csvRow,
  initialSort,
  maxHeight = 560,
  toolbar,
  truncatedNote,
}: {
  rows: T[];
  cols: Col<T>[];
  searchable?: (r: T) => string;
  pageSize?: number;
  className?: string;
  onRowClick?: (r: T) => void;
  csvFilename?: string;
  csvRow?: (r: T) => Record<string, string | number>;
  initialSort?: { key: string; dir: 1 | -1 };
  maxHeight?: number;
  toolbar?: ReactNode;
  truncatedNote?: string;
}) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(initialSort?.key ?? null);
  const [sortDir, setSortDir] = useState<1 | -1>(initialSort?.dir ?? -1);
  const [page, setPage] = useState(0);

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

  const exportCsv = () => {
    if (!csvRow) return;
    const objs = filtered.map(csvRow);
    if (!objs.length) return;
    const headers = Object.keys(objs[0]);
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(","), ...objs.map((o) => headers.map((h) => esc(o[h])).join(","))];
    // BOM keeps Arabic readable when the file is opened in Excel.
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${csvFilename ?? "engosoft-export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSort = (c: Col<T>) => {
    if (!c.sortValue) return;
    if (sortKey === c.key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(c.key);
      setSortDir(-1);
    }
  };

  return (
    <div className={`card overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border">
        {searchable && (
          <div className="flex items-center gap-2 flex-1 min-w-[160px] max-w-[340px] px-2.5 rounded-lg bg-surface-2 border border-border focus-within:border-brand transition-colors">
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
          {csvRow && (
            <button
              onClick={exportCsv}
              className="text-xs inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-border hover:bg-surface-2 transition-colors cursor-pointer min-h-[36px]"
            >
              <Download size={14} />
              <span className="hidden sm:inline">{t("export_csv")}</span>
            </button>
          )}
        </div>
      </div>

      {truncatedNote && (
        <div className="px-3 py-2 text-[11px] text-text-muted bg-warning-soft border-b border-border">
          {truncatedNote}
        </div>
      )}

      <div className="table-wrap" style={{ maxHeight }}>
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr>
              {cols.map((c) => {
                const sorted = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c)}
                    aria-sort={sorted ? (sortDir === 1 ? "ascending" : "descending") : undefined}
                    scope="col"
                    className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide bg-surface-2 border-b border-border whitespace-nowrap select-none ${
                      c.sortValue ? "cursor-pointer hover:text-text" : ""
                    } ${c.align === "right" ? "text-end" : "text-start"} ${
                      c.sticky ? "sticky-col z-20" : ""
                    } ${sorted ? "text-text" : "text-text-muted"}`}
                    style={{ width: c.width, ...(c.sticky ? { background: "var(--surface-2)" } : {}) }}
                  >
                    <span
                      className={`inline-flex items-center gap-1 ${
                        c.align === "right" ? "flex-row-reverse" : ""
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
                className={`group ${onRowClick ? "cursor-pointer" : ""}`}
              >
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2.5 border-b border-border align-middle transition-colors ${
                      i % 2 === 1 ? "bg-surface-2/40" : "bg-surface"
                    } group-hover:bg-brand-soft ${
                      c.align === "right" ? "text-end num whitespace-nowrap" : ""
                    } ${c.sticky ? "sticky-col font-medium" : ""}`}
                  >
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {visible.length === 0 && (
          <EmptyState label={q ? t("no_results") : t("no_data")} compact />
        )}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 p-3 border-t border-border">
          <button
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border text-xs disabled:opacity-40 hover:bg-surface-2 transition-colors cursor-pointer disabled:cursor-default min-h-[36px]"
          >
            <ChevronLeft size={14} className="rtl:rotate-180" />
            {lang === "ar" ? "السابق" : "Prev"}
          </button>
          <span className="text-xs text-text-muted num">
            {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, filtered.length)} {t("of")}{" "}
            {filtered.length.toLocaleString("en-US")}
          </span>
          <button
            disabled={safePage + 1 >= pageCount}
            onClick={() => setPage((p) => p + 1)}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border text-xs disabled:opacity-40 hover:bg-surface-2 transition-colors cursor-pointer disabled:cursor-default min-h-[36px]"
          >
            {lang === "ar" ? "التالي" : "Next"}
            <ChevronRight size={14} className="rtl:rotate-180" />
          </button>
        </div>
      )}
    </div>
  );
}
