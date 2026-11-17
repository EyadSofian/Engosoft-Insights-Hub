import { useState } from "react";
import { ChevronDown, Download, Trophy } from "lucide-react";
import { fmtNum, fmtPct, fmtUSDFull, useI18n } from "@/lib/i18n";
import type { CourseSellerRanking } from "@/lib/course-seller-ranking";

export function CourseSellerLeaderboard({
  course,
  report,
}: {
  course: string;
  report: CourseSellerRanking;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [expanded, setExpanded] = useState(false);
  const [exportState, setExportState] = useState<"idle" | "working" | "error">("idle");
  const { rows, availability, totalCollected } = report;
  const named = rows.filter((row) => row.name);
  const visible = expanded ? rows : [...named.slice(0, 5), ...rows.filter((row) => !row.name)];
  const numeric = (value: number | null) => (value === null ? "—" : fmtNum(value));
  const headers = ar
    ? [
        "الترتيب",
        "البياع",
        "صافي التحصيل",
        "حصة من تحصيل الكورس",
        "أوامر البيع",
        "الليدز",
        "Won",
        "Win rate (Won ÷ الليدز)",
      ]
    : [
        "Rank",
        "Salesperson",
        "Net collected",
        "Share of course collections",
        "Sales orders",
        "CRM leads",
        "Won",
        "Win rate (Won ÷ CRM leads)",
      ];
  const exportExcel = async () => {
    setExportState("working");
    try {
      const { downloadCourseSellerExcel } = await import("@/lib/course-seller-export");
      await downloadCourseSellerExcel(course, report, lang);
      setExportState("idle");
    } catch {
      setExportState("error");
    }
  };
  return (
    <section aria-labelledby="course-seller-ranking" className="card overflow-hidden !p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-brand-soft/40 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            <Trophy size={19} aria-hidden="true" />
          </span>
          <div>
            <h3 id="course-seller-ranking" className="font-bold text-text">
              {ar ? "ترتيب البياعين" : "Salesperson ranking"} · <bdi>{course}</bdi>
            </h3>
            <p className="mt-1 text-xs text-text-muted">
              {ar ? "نفس الكورس والفترة المختارة" : "Selected course and reporting period"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-text-muted">
            {ar ? "الترتيب بصافي التحصيل" : "Ranked by net collected"}
          </span>
          <button
            type="button"
            disabled={!rows.length || exportState === "working"}
            onClick={exportExcel}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-brand/20 bg-surface px-3 text-xs font-bold text-brand disabled:opacity-50"
          >
            <Download size={16} />
            {exportState === "working"
              ? ar
                ? "جاري التصدير…"
                : "Exporting…"
              : ar
                ? "تصدير Excel للكورس"
                : "Export course Excel"}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-3 sm:px-5">
        <span className="text-xs font-semibold text-text-muted">
          {ar ? "إجمالي صافي تحصيل الكورس" : "Total course net collected"}
        </span>
        <strong className="num text-lg text-text">
          <bdi>{fmtUSDFull(totalCollected)}</bdi>
        </strong>
      </div>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table
            aria-labelledby="course-seller-ranking"
            className="w-full min-w-[760px] text-start text-sm"
          >
            <thead className="bg-surface-2/60 text-xs text-text-muted">
              <tr>
                {headers.map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="whitespace-nowrap p-3 text-start font-semibold"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.key}
                  className={
                    row.rank === 1
                      ? "border-t border-border bg-brand-soft/25"
                      : "border-t border-border"
                  }
                >
                  <td className="num p-3 font-bold">{row.rank === null ? "—" : `#${row.rank}`}</td>
                  <th scope="row" className="min-w-36 p-3 text-start font-semibold">
                    <bdi>{row.name || (ar ? "غير منسوب لبياع" : "Unassigned")}</bdi>
                  </th>
                  <td className="num whitespace-nowrap p-3 font-bold text-brand">
                    {fmtUSDFull(row.collected)}
                  </td>
                  <td className="num whitespace-nowrap p-3 font-semibold">
                    {fmtPct(row.collectionShare, 1)}
                  </td>
                  <td className="num p-3">{numeric(row.orders)}</td>
                  <td className="num p-3">{numeric(row.leads)}</td>
                  <td className="num p-3">{numeric(row.won)}</td>
                  <td className="num p-3 font-semibold">{fmtPct(row.winRate, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-5 text-sm text-text-muted">
          {ar
            ? "مفيش بيانات بياعين متاحة للكورس والفترة دي."
            : "No salesperson data available for this course and period."}
        </p>
      )}
      <div className="border-t border-border p-4 sm:px-5">
        <p className="text-xs leading-5 text-text-muted">
          {ar
            ? "حصة التحصيل = صافي تحصيل البياع ÷ إجمالي صافي تحصيل الكورس لكل البياعين، حتى لو اخترت فلتر بياع أو فريق. Win rate = السجلات اللي حالتها Won ÷ سجلات CRM اللي دخلت في الفترة لنفس البياع والكورس، حسب المسؤول الحالي. Won مش دليل دفع، والتحصيل ممكن يشمل ليدز أقدم."
            : "Collection share = seller net collected ÷ course net collected across all salespeople, even when a seller or team is selected. Win rate = currently Won ÷ CRM entries in the period for the same course and current owner. Won does not prove payment; collections can include older leads."}
        </p>
        {Object.values(availability).some((ready) => !ready) && (
          <p className="mt-2 text-xs text-text-muted">
            {ar
              ? "الشرطة (—) معناها البيانات مش متاحة، الفلتر لا ينطبق على المصدر، أو مفيش مقام للنسبة."
              : "A dash (—) indicates unavailable data, an unsupported filter, or no denominator."}
          </p>
        )}
        {exportState === "error" && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {ar ? "تعذّر تصدير الملف. جرّب تاني." : "Couldn't export the file. Try again."}
          </p>
        )}
        {named.length > 5 && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className="mt-3 inline-flex min-h-9 items-center gap-2 text-sm font-bold text-brand"
          >
            <ChevronDown size={15} className={expanded ? "rotate-180" : ""} />
            {expanded
              ? ar
                ? "أول ٥ بياعين"
                : "Show first 5"
              : ar
                ? `عرض كل البياعين (${fmtNum(named.length)})`
                : `Show all salespeople (${fmtNum(named.length)})`}
          </button>
        )}
      </div>
    </section>
  );
}
