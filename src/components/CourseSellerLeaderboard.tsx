import { useState } from "react";
import { ChevronDown, Trophy } from "lucide-react";
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
  const { rows, availability, rankBy } = report;
  const named = rows.filter((row) => row.name);
  const visible = expanded ? rows : [...named.slice(0, 5), ...rows.filter((row) => !row.name)];
  const numeric = (value: number | null) => (value === null ? "—" : fmtNum(value));
  const headers = ar
    ? [
        "الترتيب",
        "البياع",
        "قيمة أوامر البيع",
        "أوامر البيع",
        "صافي التحصيل",
        "الليدز",
        "Won",
        "نسبة الإغلاق",
      ]
    : [
        "Rank",
        "Salesperson",
        "Sales order value",
        "Sales orders",
        "Net collected",
        "CRM leads",
        "Won",
        "Win rate",
      ];
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
        {rankBy && (
          <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-text-muted">
            {rankBy === "sales"
              ? ar
                ? "الترتيب بقيمة البيع"
                : "Ranked by sales order value"
              : ar
                ? "الترتيب بالتحصيل"
                : "Ranked by net collections"}
          </span>
        )}
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
                    {fmtUSDFull(row.sales)}
                  </td>
                  <td className="num p-3">{numeric(row.orders)}</td>
                  <td className="num whitespace-nowrap p-3">{fmtUSDFull(row.collected)}</td>
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
            ? "قيمة البيع من بنود أوامر الكورس المفوترة بالكامل، والتحصيل الفعلي من الحسابات. الليدز من سجلات CRM اللي دخلت في الفترة حسب المسؤول الحالي، ونسبة الإغلاق = Won ÷ الليدز لنفس البياع. البيع والتحصيل ممكن يكونوا من ليدز أقدم."
            : "Sales value comes from fully invoiced course order lines; collections come from Accounting. CRM entries use their current owner; win rate is Won ÷ entries for that owner. Period sales and collections can include older leads."}
        </p>
        {Object.values(availability).some((ready) => !ready) && (
          <p className="mt-2 text-xs text-text-muted">
            {ar
              ? "الشرطة (—) معناها البيانات مش متاحة، الفلتر لا ينطبق على المصدر، أو مفيش مقام للنسبة."
              : "A dash (—) indicates unavailable data, an unsupported filter, or no denominator."}
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
