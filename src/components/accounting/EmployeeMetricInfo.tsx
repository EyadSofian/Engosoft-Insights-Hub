import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { EMPLOYEE_METRICS, type EmployeeMetricKey } from "@/lib/employee-metric-catalog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * The "what is this number?" affordance for the employee screen.
 *
 * Same shape as the ads pages' `MetricInfo`, against its own catalog: this
 * screen's figures are about a person rather than a campaign, and every
 * question raised about them has come down to one thing — two numbers sitting
 * side by side that are measured on different dates. So `dateBasis` is not an
 * optional footnote here, it is usually the answer.
 */
export function EmployeeMetricInfo({
  metric,
  size = 13,
  align = "start",
}: {
  metric: EmployeeMetricKey;
  size?: number;
  align?: "start" | "center" | "end";
}) {
  const { lang } = useI18n();
  const copy = EMPLOYEE_METRICS[metric][lang];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          // The card behind this is a click target of its own; without this the
          // popover would also open the employee sheet.
          onClick={(event) => event.stopPropagation()}
          aria-label={`${copy.label} — ${lang === "ar" ? "الرقم ده جاي منين؟" : "how this is calculated"}`}
          // 20px so it does not shout, with a 36px tap target behind it so it is
          // reachable on a phone without changing the layout.
          className="relative inline-grid h-5 w-5 shrink-0 cursor-pointer touch-manipulation place-items-center rounded-full align-middle text-text-subtle transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-brand-soft hover:text-brand"
        >
          <Info size={size} strokeWidth={2} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        onClick={(event) => event.stopPropagation()}
        className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl p-0"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="border-b border-border bg-surface-2 px-3.5 py-2.5">
          <div className="text-[13px] font-semibold leading-snug text-text">{copy.label}</div>
          <div className="num mt-0.5 text-[11px] text-brand" dir="auto">
            {copy.formula}
          </div>
        </div>
        <dl className="space-y-2.5 px-3.5 py-3 text-[12px] leading-relaxed">
          <Row label={lang === "ar" ? "يعني إيه؟" : "What it means"}>{copy.what}</Row>
          <Row label={lang === "ar" ? "بيتحسب إزاي؟" : "How it is calculated"}>{copy.how}</Row>
          <Row label={lang === "ar" ? "جاي منين؟" : "Where it comes from"}>{copy.source}</Row>
          <Row label={lang === "ar" ? "محسوب بأي تاريخ؟" : "Date basis"}>{copy.dateBasis}</Row>
          <Row label={lang === "ar" ? "امتى يبقى فاضي؟" : "When it is empty"}>{copy.whenEmpty}</Row>
        </dl>
      </PopoverContent>
    </Popover>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 text-text-muted">{children}</dd>
    </div>
  );
}
