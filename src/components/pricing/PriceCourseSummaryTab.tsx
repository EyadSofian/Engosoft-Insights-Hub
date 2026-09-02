import { useMemo, useState } from "react";
import { Filter, X } from "lucide-react";
import { EmptyState, ErrorState, Notice, Skeleton } from "@/components/ui-bits";
import { useIsMobile } from "@/hooks/use-mobile";
import { fmtNum, useI18n } from "@/lib/i18n";
import { CourseCompactRow, CourseListRow } from "./CourseListRow";
import { CourseDetailPanel } from "./CourseDetailPanel";
import {
  activeOffers,
  entryKey,
  hasIndividual,
  hasPackage,
  inForceSince,
  type CourseBreachSummary,
  type PriceMode,
} from "./course-pricing";
import {
  deliveryLabel,
  type AuditRow,
  type CatalogEntry,
  type PriceBookSummary,
} from "./pricing-ui";
import type { CatalogResponse, SearchFilters } from "./PriceSearchTab";

interface FacetResponse {
  configured: boolean;
  facets: {
    specializations: string[];
    deliveryTypes?: string[];
  } | null;
}

const SPECIALIZATION_AR: Record<string, string> = {
  Management: "الإدارة",
  "Mech & Elec": "الميكانيكا والكهرباء",
  "BIM all": "نمذجة معلومات البناء BIM",
  "Architecture & Decor": "العمارة والديكور",
  "Civil Courses": "الهندسة المدنية",
  Others: "دورات أخرى",
};

const specializationLabel = (value: string, ar: boolean) =>
  ar ? SPECIALIZATION_AR[value] || value || "دورات أخرى" : value || "Other courses";

/** Offer and incentive sheets are price rules, not specializations to browse. */
const isCourseSpecialization = (value: string) =>
  Boolean(SPECIALIZATION_AR[value]) || !/(عرض|عروض|حافز|offer|incentive)/i.test(value);

const packageLabel = (value: string, ar: boolean) => {
  if (!ar) return value;
  return value
    .replace(/Management/gi, "الإدارة")
    .replace(/Mech\s*&\s*Elec/gi, "الميكانيكا والكهرباء")
    .replace(/Architecture\s*&\s*Decor/gi, "العمارة والديكور")
    .replace(/Civil Courses/gi, "الهندسة المدنية")
    .replace(/Record(?:ed)?/gi, "مسجل")
    .replace(/Online/gi, "أونلاين")
    .replace(/Offline/gi, "حضوري");
};

type ContentKind = "all" | "course" | "package" | "offer" | "breached";

const matchesKind = (
  entry: CatalogEntry,
  kind: ContentKind,
  breaches: Map<string, CourseBreachSummary>,
) => {
  if (kind === "all") return true;
  if (kind === "package") return hasPackage(entry);
  if (kind === "offer") return activeOffers(entry).length > 0;
  if (kind === "breached") return (breaches.get(entry.rawCode)?.breaches ?? 0) > 0;
  return hasIndividual(entry);
};

/**
 * The price list.
 *
 * Rows, not cards: the question the page answers is "how is this course priced
 * next to the others", and cards make that a memory test. Grouped by
 * specialization because that is how the workbook — and the people who
 * maintain it — think about the catalogue.
 */
export function PriceCourseSummaryTab({
  filters,
  onFilters,
  data,
  facets,
  loading,
  error,
  onRetry,
  breaches,
  breachRows,
  canWrite,
  onOpenInvoicesFor,
}: {
  filters: SearchFilters;
  onFilters: (next: SearchFilters) => void;
  data?: CatalogResponse;
  facets?: FacetResponse;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  /** Breach counts for the same period the KPI strip is reporting. */
  breaches: Map<string, CourseBreachSummary>;
  breachRows: AuditRow[];
  canWrite: boolean;
  onOpenInvoicesFor: (productCode: string) => void;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const isMobile = useIsMobile();
  const [kind, setKind] = useState<ContentKind>("all");
  const [openKey, setOpenKey] = useState("");

  const visible = useMemo(
    () => (data?.entries ?? []).filter((entry) => matchesKind(entry, kind, breaches)),
    [data?.entries, kind, breaches],
  );

  const grouped = useMemo(() => {
    const groups = new Map<string, CatalogEntry[]>();
    for (const entry of visible) {
      const key = entry.specialization || "Others";
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    return [...groups.entries()];
  }, [visible]);

  const openEntry = useMemo(
    () => visible.find((entry) => entryKey(entry) === openKey) ?? null,
    [visible, openKey],
  );

  if (error) return <ErrorState message={error} onRetry={onRetry} />;

  const specializations = (facets?.facets?.specializations ?? []).filter(isCourseSpecialization);
  const deliveryTypes = facets?.facets?.deliveryTypes ?? [];
  const book: PriceBookSummary | null = data?.book ?? null;
  const bookEffectiveFrom = book?.effectiveFrom ?? "";

  const kindTabs: { value: ContentKind; label: string }[] = [
    { value: "all", label: ar ? "الكل" : "All" },
    { value: "course", label: ar ? "الدورات" : "Courses" },
    { value: "package", label: ar ? "الباقات" : "Packages" },
    { value: "offer", label: ar ? "عروض سارية" : "Live offers" },
    { value: "breached", label: ar ? "عليها مخالفات" : "With breaches" },
  ];

  const activeFilters = [
    filters.q && {
      key: "q",
      label: `"${filters.q}"`,
      clear: () => onFilters({ ...filters, q: "" }),
    },
    filters.specialization !== "all" && {
      key: "spec",
      label: specializationLabel(filters.specialization, ar),
      clear: () => onFilters({ ...filters, specialization: "all", subcategory: "all" }),
    },
    filters.deliveryType !== "all" && {
      key: "delivery",
      label: deliveryLabel(filters.deliveryType, lang),
      clear: () => onFilters({ ...filters, deliveryType: "all" }),
    },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  return (
    <div className="space-y-3">
      {/* --- controls ------------------------------------------------------ */}
      <section className="rounded-xl border border-border bg-surface">
        <div className="hscroll scroll-hint-x border-b border-border px-2.5 py-2">
          <div
            className="flex min-w-max items-center gap-1.5"
            role="group"
            aria-label={ar ? "التخصص" : "Specialization"}
          >
            <span className="pe-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-subtle">
              {ar ? "التخصص" : "Specialization"}
            </span>
            {["all", ...specializations].map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={filters.specialization === value}
                onClick={() =>
                  onFilters({ ...filters, q: "", specialization: value, subcategory: "all" })
                }
                className={`min-h-8 cursor-pointer rounded-lg border px-3 text-[11.5px] font-semibold transition-colors ${
                  filters.specialization === value
                    ? "border-brand bg-brand text-white"
                    : "border-border bg-surface text-text-muted hover:bg-surface-2 hover:text-text"
                }`}
              >
                {value === "all" ? (ar ? "كل التخصصات" : "All") : specializationLabel(value, ar)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2">
          <div
            className="hscroll -mx-0.5 min-w-0 flex-1"
            role="group"
            aria-label={ar ? "نوع المحتوى" : "Content type"}
          >
            <div className="flex min-w-max items-center gap-1.5 px-0.5">
              {kindTabs.map((item) => (
                <button
                  type="button"
                  key={item.value}
                  aria-pressed={kind === item.value}
                  onClick={() => setKind(item.value)}
                  className={`min-h-8 cursor-pointer rounded-lg px-2.5 text-[11px] font-semibold transition-colors ${
                    kind === item.value
                      ? "bg-brand-soft text-brand ring-1 ring-brand/25"
                      : "bg-surface-2 text-text-muted hover:text-text"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {!!deliveryTypes.length && (
            <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-muted">
              <Filter size={13} aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">{ar ? "طريقة الحضور" : "Delivery"}</span>
              <select
                value={filters.deliveryType}
                onChange={(event) => onFilters({ ...filters, deliveryType: event.target.value })}
                className="min-h-8 cursor-pointer rounded-lg border border-border bg-surface px-2 text-[11.5px] text-text"
              >
                <option value="all">{ar ? "كل الأنواع" : "All types"}</option>
                {deliveryTypes.map((value) => (
                  <option key={value} value={value}>
                    {deliveryLabel(value, lang)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {!!activeFilters.length && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-2.5 py-2">
            <span className="text-[10.5px] font-semibold text-text-subtle">
              {ar ? "الفلاتر الفعّالة" : "Active filters"}
            </span>
            {activeFilters.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.clear}
                className="inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-full border border-brand/30 bg-brand-soft px-2.5 text-[11px] font-semibold text-brand"
              >
                <bdi className="max-w-[160px] truncate">{chip.label}</bdi>
                <X size={12} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </section>

      {!!data?.error && (
        <Notice tone="warning">
          {ar ? "تعذر تحميل بيانات قائمة الأسعار من قاعدة البيانات." : data.error}
        </Notice>
      )}

      {/* --- list ---------------------------------------------------------- */}
      {loading && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="border-b border-border px-4 py-3.5 last:border-b-0">
              <Skeleton className="h-4 w-1/3 rounded" />
              <Skeleton className="mt-2 h-3 w-1/5 rounded" />
              <div className="mt-3 grid grid-cols-2 gap-4">
                <Skeleton className="h-8 rounded" />
                <Skeleton className="h-8 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !visible.length && !data?.error && (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            label={ar ? "لا توجد دورات مطابقة" : "No matching courses"}
            hint={
              activeFilters.length
                ? ar
                  ? "امسح أحد الفلاتر بالأعلى أو ابحث بكود الدورة."
                  : "Clear one of the filters above, or search by course code."
                : ar
                  ? "اختر تخصصًا من الشريط بالأعلى للبدء."
                  : "Pick a specialization from the strip above to start."
            }
          />
        </div>
      )}

      {!loading &&
        grouped.map(([specialization, entries]) => (
          <section
            key={specialization}
            className="overflow-hidden rounded-xl border border-border bg-surface"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2/60 px-3 py-2 sm:px-4">
              <h2 className="text-[12.5px] font-bold text-text">
                {specializationLabel(specialization, ar)}
              </h2>
              <span className="num text-[10.5px] text-text-subtle">
                {fmtNum(entries.length)} {ar ? (kind === "package" ? "باقة" : "دورة") : "results"}
              </span>
            </div>

            {/* The headings the rows are read against. Dropped below xl, where
                each compact list row carries its own labels. */}
            <div className="hidden xl:grid xl:grid-cols-[minmax(220px,1.5fr)_minmax(150px,1fr)_minmax(150px,1fr)_minmax(96px,0.55fr)_minmax(150px,auto)] xl:gap-x-4 xl:border-b xl:border-border xl:px-4 xl:py-1.5">
              {[
                ar ? "الدورة" : "Course",
                ar ? "النطاق نقدًا" : "Cash range",
                ar ? "النطاق بالتقسيط" : "Instalment range",
                ar ? "مصر" : "Egypt",
                ar ? "الحالة" : "Status",
              ].map((heading) => (
                <span
                  key={heading}
                  className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle"
                >
                  {heading}
                </span>
              ))}
            </div>

            {entries.map((entry) => {
              const mode: PriceMode =
                kind === "package" || !hasIndividual(entry) ? "package" : "course";
              const rowProps = {
                entry,
                mode,
                breaches: breaches.get(entry.rawCode),
                inForceSince: inForceSince(entry, bookEffectiveFrom),
                onOpen: () => setOpenKey(entryKey(entry)),
                specializationLabel: specializationLabel(entry.specialization, ar),
                packageLabel: (value: string) => packageLabel(value, ar),
              };
              return isMobile ? (
                <CourseCompactRow key={entryKey(entry)} {...rowProps} />
              ) : (
                <CourseListRow key={entryKey(entry)} {...rowProps} />
              );
            })}
          </section>
        ))}

      {!!data?.truncated && (
        <Notice tone="info">
          {ar
            ? "استخدم البحث أو التخصص للوصول إلى بقية الدورات."
            : "Use search or specialization to reach the remaining courses."}
        </Notice>
      )}

      {openEntry && (
        <CourseDetailPanel
          entry={openEntry}
          mode={kind === "package" || !hasIndividual(openEntry) ? "package" : "course"}
          book={book}
          breachRows={breachRows.filter((row) => row.productCode === openEntry.rawCode)}
          canWrite={canWrite}
          onOpenInvoices={(code) => {
            setOpenKey("");
            onOpenInvoicesFor(code);
          }}
          onClose={() => setOpenKey("")}
          specializationLabel={(value) => specializationLabel(value, ar)}
          packageLabel={(value) => packageLabel(value, ar)}
        />
      )}
    </div>
  );
}
