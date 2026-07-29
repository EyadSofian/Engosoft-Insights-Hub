import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Layers3, ReceiptText, X } from "lucide-react";
import { BarList, Card, Pill, SectionTitle } from "@/components/ui-bits";
import { fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { familyLabel, sourceLabel, variantLabel } from "@/lib/product-taxonomy";

export interface CourseBreakdown {
  key: string;
  label: string;
  quantity: number;
  invoices: number;
  revenueUsd: number;
}

export interface CourseProduct {
  key: string;
  name: string;
  code: string;
  category: string;
  variantKey: string;
  quantity: number;
  invoices: number;
  lines: number;
  revenueUsd: number;
  averageUnitUsd: number | null;
  sources: CourseBreakdown[];
  events: CourseBreakdown[];
  eventStages: CourseBreakdown[];
}

export interface CourseFamily {
  familyKey: string;
  family: string;
  category: string;
  quantity: number;
  invoices: number;
  lines: number;
  revenueUsd: number;
  averageUnitUsd: number | null;
  variants: CourseBreakdown[];
  sources: CourseBreakdown[];
  events: CourseBreakdown[];
  eventStages: CourseBreakdown[];
  products: CourseProduct[];
}

export interface AccountingCourses {
  families: CourseFamily[];
  variants: CourseBreakdown[];
  sources: CourseBreakdown[];
  summary: {
    families: number;
    products: number;
    quantity: number;
    quantityAvailable: boolean;
    invoices: number;
    revenueUsd: number;
    withoutSourceRevenue: number;
  };
}

function VariantChips({
  rows,
  quantityAvailable,
}: {
  rows: CourseBreakdown[];
  quantityAvailable: boolean;
}) {
  const { lang } = useI18n();
  return (
    <div className="flex flex-wrap gap-1.5">
      {rows.slice(0, 4).map((row) => (
        <span
          key={row.key}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-[11px] text-text-muted"
        >
          <span className="truncate">{variantLabel(row.key, lang)}</span>
          <span className="num shrink-0 font-semibold text-text">
            {fmtNum(quantityAvailable ? row.quantity : row.invoices)}
          </span>
        </span>
      ))}
      {rows.length > 4 && (
        <span className="self-center text-[11px] text-text-subtle">+{rows.length - 4}</span>
      )}
    </div>
  );
}

export function CourseRevenueExplorer({ data }: { data: AccountingCourses }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState<CourseFamily | null>(null);
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? data.families : data.families.slice(0, 12);
  const peak = Math.max(...data.families.map((row) => Math.abs(row.revenueUsd)), 1);

  return (
    <>
      <Card>
        <SectionTitle
          hint={
            lang === "ar"
              ? "اضغط على أي كورس لرؤية Event وRecorded وكل منتج وفاتورته. التصنيف من المنتج نفسه وليس من مصدر التسويق."
              : "Select a course to inspect Event, Recorded and every invoiced product. Classification comes from the product, not marketing source."
          }
          action={
            <div className="hidden items-center gap-2 text-[11px] text-text-muted sm:flex">
              <BookOpen size={15} />
              <span className="num">{fmtNum(data.summary.families)}</span>
              <span>{lang === "ar" ? "كورس" : "courses"}</span>
              <span aria-hidden="true">·</span>
              <Layers3 size={15} />
              <span className="num">{fmtNum(data.summary.products)}</span>
              <span>{lang === "ar" ? "منتج" : "products"}</span>
            </div>
          }
        >
          {lang === "ar" ? "تفاصيل مبيعات الكورسات" : "Course sales detail"}
        </SectionTitle>

        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {rows.map((row, index) => (
            <button
              key={row.familyKey}
              type="button"
              onClick={() => setOpen(row)}
              className="group min-h-28 rounded-xl border border-border p-3 text-start transition-colors hover:border-brand/40 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              aria-label={`${familyLabel(row.familyKey, row.family, lang)} — ${fmtUSDFull(row.revenueUsd)}`}
            >
              <div className="flex items-start gap-3">
                <span className="num mt-0.5 w-6 shrink-0 text-[12px] font-semibold text-text-subtle">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-text">
                        {familyLabel(row.familyKey, row.family, lang)}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-text-subtle">
                        {row.category ||
                          (lang === "ar" ? "بدون فئة مسجّلة" : "No category recorded")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="num text-[14px] font-semibold text-text">
                        {fmtUSD(row.revenueUsd)}
                      </span>
                      <ChevronRight
                        size={16}
                        className="text-text-subtle transition-transform group-hover:translate-x-0.5 rtl:rotate-180"
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-[var(--chart-2)]"
                        style={{
                          width: `${Math.max(1.5, (Math.abs(row.revenueUsd) / peak) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="num shrink-0 text-[11px] text-text-muted">
                      {data.summary.quantityAvailable && (
                        <>
                          {fmtNum(row.quantity)} {lang === "ar" ? "وحدة" : "units"} ·{" "}
                        </>
                      )}
                      {fmtNum(row.invoices)} {lang === "ar" ? "فاتورة" : "invoices"}
                    </span>
                  </div>
                  <div className="mt-2.5">
                    <VariantChips
                      rows={row.variants}
                      quantityAvailable={data.summary.quantityAvailable}
                    />
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {data.families.length > 12 && (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            aria-expanded={showAll}
          >
            <ChevronDown
              size={16}
              className="transition-transform"
              style={{ transform: showAll ? "rotate(180deg)" : undefined }}
            />
            {showAll
              ? lang === "ar"
                ? "عرض أقل"
                : "Show less"
              : lang === "ar"
                ? `عرض كل الكورسات (${fmtNum(data.families.length)})`
                : `Show all courses (${fmtNum(data.families.length)})`}
          </button>
        )}
      </Card>

      {open && (
        <CourseDrawer
          course={open}
          quantityAvailable={data.summary.quantityAvailable}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function CourseDrawer({
  course,
  quantityAvailable,
  onClose,
}: {
  course: CourseFamily;
  quantityAvailable: boolean;
  onClose: () => void;
}) {
  const { lang } = useI18n();
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const sourceMissing = useMemo(
    () => course.sources.find((row) => row.key === "__none__"),
    [course.sources],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[rgba(4,12,24,0.5)] animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="accounting-course-title"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-3xl overflow-y-auto border-s border-border bg-surface shadow-xl animate-slide-up sm:animate-fade-in"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-surface/95 px-4 py-4 backdrop-blur sm:px-6">
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <Pill tone="brand">{lang === "ar" ? "فواتير مدفوعة" : "Paid invoices"}</Pill>
              <span className="text-[11px] text-text-muted">
                {course.category || (lang === "ar" ? "بدون فئة مسجّلة" : "No category recorded")}
              </span>
            </div>
            <h2 id="accounting-course-title" className="text-lg font-semibold text-text">
              {familyLabel(course.familyKey, course.family, lang)}
            </h2>
            <p className="mt-1 text-xs text-text-muted">
              <span className="num">{fmtUSDFull(course.revenueUsd)}</span> ·{" "}
              {quantityAvailable && (
                <>
                  {fmtNum(course.quantity)} {lang === "ar" ? "وحدة" : "units"} ·{" "}
                </>
              )}
              {fmtNum(course.invoices)} {lang === "ar" ? "فاتورة مميزة" : "distinct invoices"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-full text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            aria-label={lang === "ar" ? "إغلاق" : "Close"}
          >
            <X size={20} />
          </button>
        </header>

        <div className="space-y-6 p-4 pb-10 sm:p-6">
          {sourceMissing && (
            <div className="rounded-xl border border-border bg-surface-2 p-3 text-xs leading-relaxed text-text-muted">
              {lang === "ar"
                ? `${fmtUSD(sourceMissing.revenueUsd)} بدون مصدر تسويقي مسجّل. ده لا يغيّر تصنيف الكورس أو نوعه؛ Recorded وEvent مأخوذان من اسم المنتج/الفعالية.`
                : `${fmtUSD(sourceMissing.revenueUsd)} has no recorded marketing source. That does not change course or modality classification; Recorded and Event come from the product/event fields.`}
            </div>
          )}

          <section>
            <SectionTitle
              hint={
                lang === "ar"
                  ? "كل صف اسم منتج حقيقي داخل الفاتورة المدفوعة"
                  : "Every row is an actual product on a paid invoice"
              }
            >
              {lang === "ar"
                ? "المنتجات والأنواع داخل الكورس"
                : "Products and types in this course"}
            </SectionTitle>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[660px] text-sm">
                <thead className="bg-surface-2 text-[11px] text-text-muted">
                  <tr>
                    <th className="px-3 py-2.5 text-start font-medium">
                      {lang === "ar" ? "المنتج" : "Product"}
                    </th>
                    <th className="px-3 py-2.5 text-start font-medium">
                      {lang === "ar" ? "النوع" : "Type"}
                    </th>
                    {quantityAvailable && (
                      <th className="px-3 py-2.5 text-end font-medium">
                        {lang === "ar" ? "الكمية" : "Quantity"}
                      </th>
                    )}
                    <th className="px-3 py-2.5 text-end font-medium">
                      {lang === "ar" ? "الفواتير" : "Invoices"}
                    </th>
                    <th className="px-3 py-2.5 text-end font-medium">
                      {lang === "ar" ? "الإيراد" : "Revenue"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {course.products.map((product) => (
                    <tr key={product.key} className="border-t border-border align-top">
                      <td className="max-w-[300px] px-3 py-3">
                        <p className="font-medium text-text">{product.name}</p>
                        <p className="mt-0.5 text-[11px] text-text-subtle">
                          {[product.code, product.category].filter(Boolean).join(" · ") || "—"}
                        </p>
                        <p className="mt-1 text-[11px] text-text-muted">
                          {sourceLabel(
                            product.sources[0]?.key ?? "__none__",
                            product.sources[0]?.label ?? "",
                            lang,
                          )}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <Pill tone={product.variantKey === "standard" ? "neutral" : "brand"}>
                          {variantLabel(product.variantKey, lang)}
                        </Pill>
                      </td>
                      {quantityAvailable && (
                        <td className="num px-3 py-3 text-end">{fmtNum(product.quantity)}</td>
                      )}
                      <td className="num px-3 py-3 text-end">{fmtNum(product.invoices)}</td>
                      <td className="num px-3 py-3 text-end font-semibold text-text">
                        {fmtUSDFull(product.revenueUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-5 md:grid-cols-2">
            <section>
              <SectionTitle>{lang === "ar" ? "الإيراد حسب النوع" : "Revenue by type"}</SectionTitle>
              <BarList
                items={course.variants.map((row) => ({
                  label: variantLabel(row.key, lang),
                  value: row.revenueUsd,
                  meta: `${fmtUSD(row.revenueUsd)} · ${fmtNum(
                    quantityAvailable ? row.quantity : row.invoices,
                  )} ${quantityAvailable ? (lang === "ar" ? "وحدة" : "units") : lang === "ar" ? "فاتورة" : "invoices"}`,
                }))}
                format={fmtUSD}
                color="var(--chart-3)"
              />
            </section>
            <section>
              <SectionTitle>
                {lang === "ar" ? "الإيراد حسب المصدر" : "Revenue by source"}
              </SectionTitle>
              <BarList
                items={course.sources.map((row) => ({
                  label: sourceLabel(row.key, row.label, lang),
                  value: row.revenueUsd,
                  meta: `${fmtUSD(row.revenueUsd)} · ${fmtPct(
                    course.revenueUsd ? (row.revenueUsd / course.revenueUsd) * 100 : null,
                    1,
                  )}`,
                }))}
                format={fmtUSD}
              />
            </section>
          </div>

          {(course.events.length > 0 || course.eventStages.length > 0) && (
            <section className="grid gap-5 md:grid-cols-2">
              {course.events.length > 0 && (
                <div>
                  <SectionTitle>{lang === "ar" ? "الفعاليات" : "Events"}</SectionTitle>
                  <BarList
                    items={course.events.map((row) => ({
                      label: row.label,
                      value: row.revenueUsd,
                      meta: `${fmtUSD(row.revenueUsd)} · ${fmtNum(row.invoices)}`,
                    }))}
                    format={fmtUSD}
                    color="var(--chart-4)"
                  />
                </div>
              )}
              {course.eventStages.length > 0 && (
                <div>
                  <SectionTitle>{lang === "ar" ? "مراحل الفعالية" : "Event stages"}</SectionTitle>
                  <BarList
                    items={course.eventStages.map((row) => ({
                      label: row.label,
                      value: row.revenueUsd,
                      meta: `${fmtUSD(row.revenueUsd)} · ${fmtNum(row.invoices)}`,
                    }))}
                    format={fmtUSD}
                    color="var(--chart-5)"
                  />
                </div>
              )}
            </section>
          )}

          <div className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-xs text-text-muted">
            <ReceiptText className="mt-0.5 shrink-0" size={15} />
            <p>
              {lang === "ar"
                ? "الإيراد هنا هو USD Paid من Total in Currency، والتاريخ هو Payment Date. نفس صفوف الحسابات؛ لا توجد أوامر بيع داخل هذا التحليل."
                : "Revenue is USD Paid from Total in Currency and dated by Payment Date. These are the same Accounting rows; no sales orders are included."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
