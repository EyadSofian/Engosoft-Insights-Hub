import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Layers3, ReceiptText, X } from "lucide-react";
import { BarList, Card, Pill, SectionTitle } from "@/components/ui-bits";
import { fmtNum, fmtPct, fmtUSDFull, useI18n } from "@/lib/i18n";
import { sourceLabel, variantLabel } from "@/lib/product-taxonomy";
import { useModalGuard } from "@/lib/ui-store";

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
              ? "كل كارت يجمع كل منتجات Odoo تحت كاتجوري مالية واحدة. اضغط لعرض المنتجات والفواتير والأنواع داخلها."
              : "Each card groups all Odoo products under one finance category. Select it to inspect products, invoices, and types."
          }
          action={
            <div className="hidden items-center gap-2 text-[11px] text-text-muted sm:flex">
              <BookOpen size={15} />
              <span className="num">{fmtNum(data.summary.families)}</span>
              <span>{lang === "ar" ? "كاتجوري" : "categories"}</span>
              <span aria-hidden="true">·</span>
              <Layers3 size={15} />
              <span className="num">{fmtNum(data.summary.products)}</span>
              <span>{lang === "ar" ? "منتج" : "products"}</span>
            </div>
          }
        >
          {lang === "ar" ? "المبيعات حسب الكاتجوري" : "Sales by product category"}
        </SectionTitle>

        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {rows.map((row, index) => (
            <button
              key={row.familyKey}
              type="button"
              onClick={() => setOpen(row)}
              className="group relative min-h-32 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface to-surface-2/45 p-4 text-start shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/35 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              aria-label={`${row.family} — ${fmtUSDFull(row.revenueUsd)}`}
            >
              <div className="flex items-start gap-3">
                <span className="num mt-0.5 w-6 shrink-0 text-[12px] font-semibold text-text-subtle">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand/75">
                        {lang === "ar" ? "Product Category" : "Product category"}
                      </p>
                      <p className="truncate text-[15px] font-bold text-text">{row.family}</p>
                      <p className="mt-1 truncate text-[11px] text-text-subtle">
                        {fmtNum(row.products.length)} {lang === "ar" ? "منتج" : "products"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="num text-[14px] font-semibold text-text">
                        {fmtUSDFull(row.revenueUsd)}
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
                ? `عرض كل الكاتجوريز (${fmtNum(data.families.length)})`
                : `Show all categories (${fmtNum(data.families.length)})`}
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
  const [selectedEvent, setSelectedEvent] = useState<CourseBreakdown | null>(null);
  useModalGuard(true);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selectedEvent) setSelectedEvent(null);
      else onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, selectedEvent]);

  const sourceMissing = useMemo(
    () => course.sources.find((row) => row.key === "__none__"),
    [course.sources],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(4,12,24,0.58)] backdrop-blur-[2px] animate-fade-in sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="accounting-course-title"
      onClick={onClose}
    >
      <div
        className="max-h-[92dvh] w-full max-w-5xl overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-surface shadow-2xl animate-slide-up pb-[env(safe-area-inset-bottom)] sm:rounded-2xl sm:pb-0 sm:animate-fade-in"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-surface/95 px-4 py-4 backdrop-blur sm:px-6">
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <Pill tone="brand">{lang === "ar" ? "Product Category" : "Product category"}</Pill>
              <span className="text-[11px] text-text-muted">
                {fmtNum(course.products.length)} {lang === "ar" ? "منتج من Odoo" : "Odoo products"}
              </span>
            </div>
            <h2 id="accounting-course-title" className="text-lg font-semibold text-text">
              {course.family}
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
                ? `${fmtUSDFull(sourceMissing.revenueUsd)} بدون مصدر تسويقي مسجّل. ده لا يغيّر Product Category أو نوع المنتج؛ Recorded وEvent مأخوذان من اسم المنتج/الفعالية.`
                : `${fmtUSDFull(sourceMissing.revenueUsd)} has no recorded marketing source. That does not change Product Category or modality; Recorded and Event come from product/event fields.`}
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
                ? "المنتجات والأنواع داخل الكاتجوري"
                : "Products and types in this category"}
            </SectionTitle>
            <div className="table-wrap scroll-hint-x rounded-xl border border-border">
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
                  meta: `${fmtUSDFull(row.revenueUsd)} · ${fmtNum(
                    quantityAvailable ? row.quantity : row.invoices,
                  )} ${quantityAvailable ? (lang === "ar" ? "وحدة" : "units") : lang === "ar" ? "فاتورة" : "invoices"}`,
                }))}
                format={fmtUSDFull}
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
                  meta: `${fmtUSDFull(row.revenueUsd)} · ${fmtPct(
                    course.revenueUsd ? (row.revenueUsd / course.revenueUsd) * 100 : null,
                    1,
                  )}`,
                }))}
                format={fmtUSDFull}
              />
            </section>
          </div>

          {(course.events.length > 0 || course.eventStages.length > 0) && (
            <section className="grid gap-5 md:grid-cols-2">
              {course.events.length > 0 && (
                <div>
                  <SectionTitle
                    hint={
                      lang === "ar"
                        ? "اضغط على أي فعالية لعرض رقمها وحسابها في نافذة مستقلة"
                        : "Select an event to inspect its exact figures"
                    }
                  >
                    {lang === "ar" ? "الفعاليات" : "Events"}
                  </SectionTitle>
                  <EventRows
                    rows={course.events}
                    courseRevenue={course.revenueUsd}
                    onSelect={setSelectedEvent}
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
                      meta: `${fmtUSDFull(row.revenueUsd)} · ${fmtNum(row.invoices)}`,
                    }))}
                    format={fmtUSDFull}
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

        {selectedEvent && (
          <EventDetailDialog
            event={selectedEvent}
            course={course}
            quantityAvailable={quantityAvailable}
            onClose={() => setSelectedEvent(null)}
          />
        )}
      </div>
    </div>
  );
}

function EventRows({
  rows,
  courseRevenue,
  onSelect,
}: {
  rows: CourseBreakdown[];
  courseRevenue: number;
  onSelect: (event: CourseBreakdown) => void;
}) {
  const { lang } = useI18n();
  const peak = Math.max(...rows.map((row) => Math.abs(row.revenueUsd)), 1);
  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <button
          key={row.key}
          type="button"
          onClick={() => onSelect(row)}
          className="group block w-full rounded-xl border border-transparent p-2 text-start transition-colors hover:border-brand/25 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          aria-label={`${row.label} — ${fmtUSDFull(row.revenueUsd)}`}
        >
          <span className="mb-1 flex items-start justify-between gap-3">
            <span className="min-w-0 truncate text-[13px] font-medium text-text" title={row.label}>
              {row.label}
            </span>
            <span className="num shrink-0 text-[12px] font-semibold text-text">
              {fmtUSDFull(row.revenueUsd)} · {fmtNum(row.invoices)}
            </span>
          </span>
          <span className="block h-1.5 overflow-hidden rounded-full bg-surface-2">
            <span
              className="block h-full rounded-full bg-[var(--chart-4)] transition-[width] duration-500"
              style={{ width: `${Math.max(1.5, (Math.abs(row.revenueUsd) / peak) * 100)}%` }}
            />
          </span>
          <span className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-text-muted">
            <span>{lang === "ar" ? "عرض التفاصيل" : "View details"}</span>
            <span className="num">
              {fmtPct(courseRevenue ? (row.revenueUsd / courseRevenue) * 100 : null, 2)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function EventDetailDialog({
  event,
  course,
  quantityAvailable,
  onClose,
}: {
  event: CourseBreakdown;
  course: CourseFamily;
  quantityAvailable: boolean;
  onClose: () => void;
}) {
  const { lang } = useI18n();
  const share = course.revenueUsd ? (event.revenueUsd / course.revenueUsd) * 100 : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(4,12,24,0.62)] p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="accounting-event-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-2xl sm:p-6"
        onClick={(click) => click.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Pill tone="brand">
              {lang === "ar" ? "فعالية من فاتورة مدفوعة" : "Paid-invoice event"}
            </Pill>
            <h3 id="accounting-event-title" className="mt-3 text-lg font-semibold text-text">
              {event.label}
            </h3>
            <p className="mt-1 text-xs text-text-muted">{course.family}</p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-full text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            aria-label={lang === "ar" ? "إغلاق" : "Close"}
          >
            <X size={20} />
          </button>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-surface-2 p-3">
            <dt className="text-[11px] text-text-muted">{lang === "ar" ? "الإيراد" : "Revenue"}</dt>
            <dd className="num mt-1 break-all text-base font-semibold text-text">
              {fmtUSDFull(event.revenueUsd)}
            </dd>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <dt className="text-[11px] text-text-muted">
              {lang === "ar" ? "الفواتير" : "Invoices"}
            </dt>
            <dd className="num mt-1 text-base font-semibold text-text">{fmtNum(event.invoices)}</dd>
          </div>
          {quantityAvailable && (
            <div className="rounded-xl bg-surface-2 p-3">
              <dt className="text-[11px] text-text-muted">
                {lang === "ar" ? "الكمية" : "Quantity"}
              </dt>
              <dd className="num mt-1 text-base font-semibold text-text">
                {fmtNum(event.quantity)}
              </dd>
            </div>
          )}
          <div className="rounded-xl bg-surface-2 p-3">
            <dt className="text-[11px] text-text-muted">
              {lang === "ar" ? "نسبتها من إيراد الكاتجوري" : "Share of category revenue"}
            </dt>
            <dd className="num mt-1 text-base font-semibold text-text">{fmtPct(share, 2)}</dd>
          </div>
        </dl>

        <div className="mt-4 flex items-start gap-2 rounded-xl border border-brand/20 bg-brand-soft p-3 text-xs leading-relaxed text-text-muted">
          <ReceiptText className="mt-0.5 shrink-0 text-brand" size={15} />
          <p>
            {lang === "ar"
              ? "الرقم هو مجموع USD Paid لبنود الفواتير المدفوعة المرتبطة بهذه الفعالية، حسب Payment Date. لا توجد أوامر بيع في الحساب."
              : "This is the sum of USD Paid on paid-invoice lines for this event, by Payment Date. No sales orders are included."}
          </p>
        </div>
      </div>
    </div>
  );
}
