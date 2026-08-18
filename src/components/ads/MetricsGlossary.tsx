import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useModalGuard } from "@/lib/ui-store";
import { GLOSSARY_ORDER, METRIC_GROUP_LABEL, METRICS } from "@/lib/metric-catalog";

/**
 * "How are these numbers calculated?" — one screen that answers it for every
 * metric on the page at once, in the order a reader meets them: what was spent,
 * what came back as leads, what closed, what was collected, and only then the
 * ratios built on top.
 *
 * The date column is the one the code genuinely filters on. Where that differs
 * from what someone might assume — Won is counted on leads *created* in the
 * window, not deals closed in it — the table says so rather than papering over it.
 */
export function MetricsGlossaryButton({ className = "" }: { className?: string }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-border bg-surface text-[13px] font-medium hover:bg-surface-2 transition-colors cursor-pointer ${className}`}
      >
        <BookOpen size={15} />
        {lang === "ar" ? "الأرقام دي بتتحسب إزاي؟" : "How are these calculated?"}
      </button>
      <MetricsGlossary open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function MetricsGlossary({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  useModalGuard(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const groups = GLOSSARY_ORDER.reduce<Record<string, typeof GLOSSARY_ORDER>>((acc, key) => {
    const g = METRICS[key].group;
    (acc[g] ??= []).push(key);
    return acc;
  }, {});

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center animate-fade-in"
      style={{ background: "rgba(4, 12, 24, 0.5)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={lang === "ar" ? "شرح المؤشرات" : "Metric reference"}
    >
      <div
        className="w-full sm:max-w-4xl glass rounded-t-3xl sm:rounded-3xl max-h-[90dvh] overflow-y-auto overscroll-contain animate-slide-up sm:animate-scale-in pb-[env(safe-area-inset-bottom)] sm:pb-0"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-5 py-4 border-b border-border bg-surface/95 backdrop-blur">
          <div className="min-w-0">
            <h2 className="font-semibold text-text text-lg">
              {lang === "ar" ? "الأرقام دي بتتحسب إزاي؟" : "How these numbers are calculated"}
            </h2>
            <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
              {lang === "ar"
                ? "كل مؤشر ومعادلته ومصدره وتاريخ القياس اللي الفلترة شغّالة عليه. القيم اللي مش متاحة بتظهر شرطة، مش صفر."
                : "Every metric with its formula, its source and the date column the filter runs on. Values that are not measurable render as a dash, never a zero."}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("close")}
            className="w-9 h-9 grid place-items-center rounded-full hover:bg-surface-2 transition-colors cursor-pointer shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-3 sm:px-5 py-4 space-y-5">
          {Object.entries(groups).map(([group, keys]) => (
            <section key={group}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle mb-2 px-1">
                {METRIC_GROUP_LABEL[group as keyof typeof METRIC_GROUP_LABEL][lang]}
              </h3>
              <div className="table-wrap rounded-xl border border-border">
                <table className="w-full text-[12.5px] border-separate border-spacing-0">
                  <thead>
                    <tr>
                      {[
                        lang === "ar" ? "المؤشر" : "Metric",
                        lang === "ar" ? "المعادلة" : "Formula",
                        lang === "ar" ? "المصدر" : "Source",
                        lang === "ar" ? "تاريخ القياس" : "Date basis",
                      ].map((h) => (
                        <th
                          key={h}
                          scope="col"
                          className="px-3 py-2 text-start text-[10px] font-semibold uppercase tracking-wide text-text-muted bg-surface-2 border-b border-border whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((key, i) => {
                      const copy = METRICS[key][lang];
                      return (
                        <tr key={key}>
                          <td
                            className={`px-3 py-2.5 border-b border-border font-medium text-text align-top ${
                              i % 2 === 1 ? "bg-surface-2/40" : "bg-surface"
                            }`}
                          >
                            {copy.label}
                          </td>
                          <td
                            className={`px-3 py-2.5 border-b border-border align-top num text-brand ${
                              i % 2 === 1 ? "bg-surface-2/40" : "bg-surface"
                            }`}
                            dir="auto"
                          >
                            {copy.formula}
                          </td>
                          <td
                            className={`px-3 py-2.5 border-b border-border align-top text-text-muted ${
                              i % 2 === 1 ? "bg-surface-2/40" : "bg-surface"
                            }`}
                          >
                            {copy.source}
                          </td>
                          <td
                            className={`px-3 py-2.5 border-b border-border align-top text-text-muted ${
                              i % 2 === 1 ? "bg-surface-2/40" : "bg-surface"
                            }`}
                          >
                            {copy.dateBasis}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          <p className="text-[11.5px] text-text-muted leading-relaxed px-1">
            {lang === "ar"
              ? "ملاحظة مهمة: الإيراد مصدره الوحيد هو الفواتير المدفوعة في تبويب Accounting بتاريخ الدفع. أوامر البيع و Full Invoiced Orders مؤشرات استرشادية ومش مصدر إيراد. والخسائر مصدرها Lost Analysis وحده، مش مرحلة Lost جوه CRM Leads."
              : "Note: revenue has exactly one source — paid invoices on the Accounting tab, dated by Payment Date. Sales orders and Full Invoiced Orders are advisory and never a revenue source. Losses come from Lost Analysis alone, never from CRM stage text."}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
