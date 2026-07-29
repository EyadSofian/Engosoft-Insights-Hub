import { Info } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { METRICS, type MetricKey } from "@/lib/metric-catalog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * The "what is this number?" affordance.
 *
 * Every metric on the ads pages carries one. A manager who does not know what
 * ACOS is should be able to find out without leaving the card, and should learn
 * four things: what it means, how it is computed, which sheet each side of the
 * fraction came from, and why it is sometimes a dash. Anything less and a dash
 * reads as a bug.
 */
export function MetricInfo({
  metric,
  size = 13,
  align = "start",
  note,
}: {
  metric: MetricKey;
  size?: number;
  align?: "start" | "center" | "end";
  /** Extra line for context the catalog cannot know, e.g. "Snapchat has no link clicks". */
  note?: string;
}) {
  const { lang } = useI18n();
  const def = METRICS[metric];
  const copy = def[lang];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`${copy.label} — ${lang === "ar" ? "تفاصيل الحساب" : "how this is calculated"}`}
          // The icon stays 20px so it does not shout, but the pseudo-element
          // gives it a 36px tap target on a phone without moving any layout.
          className="relative inline-grid place-items-center w-5 h-5 rounded-full text-text-subtle hover:text-brand hover:bg-brand-soft transition-colors cursor-pointer shrink-0 align-middle touch-manipulation after:absolute after:-inset-2 after:content-['']"
        >
          <Info size={size} strokeWidth={2} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        onClick={(e) => e.stopPropagation()}
        className="w-[min(21rem,calc(100vw-2rem))] p-0 rounded-xl overflow-hidden"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="px-3.5 py-2.5 border-b border-border bg-surface-2">
          <div className="text-[13px] font-semibold text-text leading-snug">{copy.label}</div>
          <div className="num text-[11px] text-brand mt-0.5" dir="auto">
            {copy.formula}
          </div>
        </div>
        <dl className="px-3.5 py-3 space-y-2.5 text-[12px] leading-relaxed">
          <Row label={lang === "ar" ? "يعني إيه؟" : "What it means"}>{copy.what}</Row>
          <Row label={lang === "ar" ? "بيتحسب إزاي؟" : "How it is calculated"}>{copy.how}</Row>
          <Row label={lang === "ar" ? "جاي منين؟" : "Where it comes from"}>{copy.source}</Row>
          <Row label={lang === "ar" ? "تاريخ القياس" : "Date basis"}>{copy.dateBasis}</Row>
          <Row label={lang === "ar" ? "امتى يظهر فاضي؟" : "When it is empty"}>{copy.whenEmpty}</Row>
          {note && <Row label={lang === "ar" ? "في الشاشة دي" : "On this view"}>{note}</Row>}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
        {label}
      </dt>
      <dd className="text-text-muted mt-0.5">{children}</dd>
    </div>
  );
}
