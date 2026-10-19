import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import type { SourceDistributionRow } from "@/lib/crm-source-distribution";

export function CrmSourceDistribution({ rows, total }: { rows: SourceDistributionRow[]; total: number }) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRow = rows.find((row) => row.source === selected);
  const sourceName = (value: string) => value === "Unspecified source" ? A ? "مصدر غير محدد" : "Unspecified source" : value;
  const sums = rows.reduce((sum, row) => ({ total: sum.total + row.total, active: sum.active + row.active, won: sum.won + row.won, lost: sum.lost + row.lost }), { total: 0, active: 0, won: 0, lost: 0 });

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm" dir={A ? "rtl" : "ltr"}>
      <div className="border-b border-border bg-surface-2 px-5 py-4">
        <p className="text-sm text-text-muted">{A ? "كل ليد تُحسب مرة واحدة حسب مصدر Odoo الأصلي وحالتها الحالية. المفتوح يشمل Lead نشطة وOpportunity مفتوحة؛ Won وLost منفصلان." : "Each Odoo lead is counted once by original source and current outcome. Open includes active Leads and open Opportunities; Won and Lost are separate."}</p>
        <p className="mt-2 text-xs font-semibold text-text-muted">{A ? `مراجعة المجموع: ${fmtNum(sums.total)} من ${fmtNum(total)} سجل` : `Reconciliation: ${fmtNum(sums.total)} of ${fmtNum(total)} records`}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-sm">
          <thead className="bg-surface-2 text-text-muted"><tr>
            {[A ? "المصدر" : "Source", A ? "إجمالي الليدز" : "Total leads", A ? "من الإجمالي" : "Share", A ? "مفتوح" : "Open", "Won", "Lost", A ? "نسبة Won" : "Won rate", A ? "نسبة Lost" : "Lost rate"].map((heading) => <th key={heading} scope="col" className="px-4 py-3 text-start text-xs font-bold">{heading}</th>)}
          </tr></thead>
          <tbody>{rows.map((row) => <tr key={row.source} className="border-t border-border transition-colors hover:bg-surface-2/70">
            <th scope="row" className="px-4 py-3 text-start"><button type="button" onClick={() => setSelected(selected === row.source ? null : row.source)} aria-expanded={selected === row.source} className="inline-flex items-center gap-2 font-bold text-text hover:text-blue-700"><ChevronDown size={15} className={`transition-transform ${selected === row.source ? "rotate-180" : ""}`} />{sourceName(row.source)}</button></th>
            <td className="px-4 py-3 font-extrabold tabular-nums text-text">{fmtNum(row.total)}</td>
            <td className="px-4 py-3 text-text-muted"><span className="tabular-nums">{fmtPct(row.share, 1)}</span><span className="mt-1 block h-1.5 w-20 rounded-full bg-surface-3"><span className="block h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, row.share)}%` }} /></span></td>
            <td className="px-4 py-3 font-semibold tabular-nums text-text">{fmtNum(row.active)}</td>
            <td className="px-4 py-3 font-semibold tabular-nums text-emerald-700">{fmtNum(row.won)}</td>
            <td className="px-4 py-3 font-semibold tabular-nums text-rose-700">{fmtNum(row.lost)}</td>
            <td className="px-4 py-3 tabular-nums text-emerald-700">{fmtPct(row.wonRate, 1)}</td>
            <td className="px-4 py-3 tabular-nums font-bold text-rose-700">{fmtPct(row.lostRate, 1)}</td>
          </tr>)}</tbody>
          <tfoot><tr className="border-t-2 border-border-strong bg-surface-2 font-extrabold text-text"><th scope="row" className="px-4 py-3 text-start">{A ? "الإجمالي" : "Total"}</th><td className="px-4 py-3 tabular-nums">{fmtNum(sums.total)}</td><td className="px-4 py-3">{fmtPct(sums.total ? 100 : 0, 0)}</td><td className="px-4 py-3 tabular-nums">{fmtNum(sums.active)}</td><td className="px-4 py-3 tabular-nums text-emerald-700">{fmtNum(sums.won)}</td><td className="px-4 py-3 tabular-nums text-rose-700">{fmtNum(sums.lost)}</td><td className="px-4 py-3 tabular-nums text-emerald-700">{fmtPct(sums.total ? sums.won / sums.total * 100 : 0, 1)}</td><td className="px-4 py-3 tabular-nums text-rose-700">{fmtPct(sums.total ? sums.lost / sums.total * 100 : 0, 1)}</td></tr></tfoot>
        </table>
      </div>
      {selectedRow && <div className="border-t border-border bg-surface-2 p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-extrabold text-text">{sourceName(selectedRow.source)} · {fmtNum(selectedRow.total)}</h3><span className="text-xs text-text-muted">{A ? `أحدث ${fmtNum(selectedRow.latestRecords.length)} سجلًا فقط، من أصل ${fmtNum(selectedRow.total)}` : `Latest ${fmtNum(selectedRow.latestRecords.length)} records only, of ${fmtNum(selectedRow.total)}`}</span></div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{selectedRow.latestRecords.map((record) => <a key={record.id} href={record.odooUrl} target="_blank" rel="noreferrer" className="flex items-start justify-between gap-2 rounded-xl border border-border bg-surface p-3 hover:border-blue-300 hover:shadow-sm"><span className="min-w-0"><span className="block truncate font-semibold text-text">{record.contact || `#${record.id}`}</span><span className="mt-1 block text-xs text-text-muted">{record.createdAt.slice(0, 10)} · {record.stage || record.status}</span></span><ExternalLink size={15} className="shrink-0 text-blue-700" /></a>)}</div>
      </div>}
    </div>
  );
}
