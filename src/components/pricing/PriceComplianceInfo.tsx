import { CalendarDays, Calculator, Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtDate, fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import type { ComplianceResponse } from "./PriceComplianceTab";

const dateBasisLabel = (basis: "payment" | "sale" | "invoice", ar: boolean): string => {
  if (basis === "payment") return ar ? "تاريخ الدفع" : "payment date";
  if (basis === "invoice") return ar ? "تاريخ الفاتورة" : "invoice date";
  return ar ? "تاريخ البيع" : "sale date";
};

export function PriceComplianceInfo({
  from,
  to,
  dateBasis,
  kpis,
}: {
  from: string;
  to: string;
  dateBasis: "payment" | "sale" | "invoice";
  kpis?: ComplianceResponse["kpis"];
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const compliant = kpis?.compliantLines ?? 0;
  const judged = kpis?.judgedLines ?? 0;
  const rate = kpis?.complianceRate;
  const review = kpis?.needsReviewLines ?? 0;
  const period =
    !from && !to
      ? ar
        ? "كل الفترات"
        : "All time"
      : from === to
        ? fmtDate(from, lang)
        : `${ar ? "من" : "from"} ${fmtDate(from, lang)} ${ar ? "إلى" : "to"} ${fmtDate(to, lang)}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ar ? "شرح نسبة الالتزام والفترة المحسوبة" : "Explain compliance and period"}
          className="relative inline-grid size-5 shrink-0 cursor-pointer place-items-center rounded-full border border-danger/25 bg-danger-soft text-danger transition hover:scale-105 hover:border-danger/45 after:absolute after:-inset-2 after:content-['']"
        >
          <Info size={12} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={ar ? "end" : "start"}
        className="w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border-border bg-surface p-0 shadow-xl"
      >
        <div className="border-b border-border bg-[#10262d] px-4 py-3 text-white">
          <div className="text-[13px] font-black">
            {ar ? "ماذا تعني نسبة الالتزام؟" : "What does compliance mean?"}
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-white/65">
            {ar
              ? "تقيس البنود التي بيعت داخل السعر المعتمد من البنود التي أمكن الحكم عليها فقط."
              : "It measures judged invoice lines sold within the approved price."}
          </p>
        </div>

        <div className="space-y-3 p-4 text-[11px] leading-relaxed">
          <div className="rounded-xl border border-danger/20 bg-danger-soft/45 p-3">
            <div className="flex items-center gap-2 font-bold text-danger">
              <Calculator size={14} aria-hidden="true" />
              {ar ? "الحساب الحالي" : "Current calculation"}
            </div>
            <div className="mt-1.5 text-[17px] font-black tabular-nums text-text" dir="ltr">
              {fmtNum(compliant)} ÷ {fmtNum(judged)} × 100 ={" "}
              {rate == null ? "—" : fmtPct(rate * 100, 0)}
            </div>
            <p className="mt-1 text-text-muted">
              {ar
                ? judged > 0 && compliant === 0
                  ? `يعني أن كل البنود الـ${fmtNum(judged)} التي أمكن الحكم عليها بيعت تحت الحد الأدنى.`
                  : `${fmtNum(compliant)} بند ملتزم من أصل ${fmtNum(judged)} بند أمكن الحكم عليه.`
                : `${fmtNum(compliant)} compliant of ${fmtNum(judged)} judged lines.`}
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2.5">
            <CalendarDays size={14} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
            <div>
              <div className="font-bold text-text">
                {ar ? "الفترة المحسوبة" : "Measured period"}
              </div>
              <div className="mt-0.5 text-text-muted">{period}</div>
              <div className="text-text-subtle">
                {ar ? "التصفية حسب" : "Filtered by"} {dateBasisLabel(dateBasis, ar)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border p-2.5">
              <div className="text-[9px] font-bold text-text-subtle">
                {ar ? "يدخل في النسبة" : "Included"}
              </div>
              <div className="mt-1 text-text-muted">
                {ar ? "ملتزم أو تحت الحد الأدنى" : "Compliant or below floor"}
              </div>
            </div>
            <div className="rounded-xl border border-border p-2.5">
              <div className="text-[9px] font-bold text-text-subtle">
                {ar ? "لا يدخل في النسبة" : "Not included"}
              </div>
              <div className="mt-1 text-text-muted">
                {ar ? `${fmtNum(review)} حالة تحتاج مراجعة` : `${fmtNum(review)} cases need review`}
              </div>
            </div>
          </div>

          <p className="border-t border-border pt-2 text-[10px] font-semibold text-text-muted">
            {ar
              ? "هذه النسبة لا تعني كل مبيعات الشركة؛ هي تخص فترة التاريخ الظاهرة أعلى الداشبورد. فلتر القنوات الإعلانية لا يؤثر على تقرير الأسعار."
              : "This is not all company sales. It follows the top date period; advertising-channel filters do not affect pricing compliance."}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
