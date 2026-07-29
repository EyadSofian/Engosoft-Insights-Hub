/**
 * Rows to a downloaded CSV.
 *
 * Shared rather than owned by the table, because the card grid exports the same
 * data and a second writer would quietly drift on quoting or the byte-order
 * mark — and the reader would only find out when Excel mangled the Arabic.
 */
export function exportCsv<T>(
  rows: T[],
  csvRow: (r: T) => Record<string, string | number>,
  filename: string,
) {
  const objs = rows.map(csvRow);
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
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
