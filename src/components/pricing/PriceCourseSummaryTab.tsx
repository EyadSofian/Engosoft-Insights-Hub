import { useMemo, useState } from "react";
import {
  BadgePercent,
  Banknote,
  BookOpenCheck,
  ChevronDown,
  ChevronUp,
  GraduationCap,
  Layers3,
  Search,
  WalletCards,
} from "lucide-react";
import { Card, EmptyState, ErrorState, Notice, Pill, Skeleton } from "@/components/ui-bits";
import { useI18n } from "@/lib/i18n";
import { bandText, deliveryLabel, type CatalogEntry, type CatalogPrice } from "./pricing-ui";
import type { CatalogResponse, SearchFilters } from "./PriceSearchTab";

interface FacetResponse {
  configured: boolean;
  facets: { specializations: string[] } | null;
}

const SPECIALIZATION_AR: Record<string, string> = {
  Management: "الإدارة",
  "Mech & Elec": "الميكانيكا والكهرباء",
  "BIM all": "نمذجة معلومات البناء BIM",
  "Architecture & Decor": "العمارة والديكور",
  "Civil Courses": "الهندسة المدنية",
  Others: "دورات أخرى",
};

const specializationLabel = (value: string, arabic: boolean): string =>
  arabic ? SPECIALIZATION_AR[value] || value || "دورات أخرى" : value || "Other courses";

const isCourseSpecialization = (value: string): boolean =>
  Boolean(SPECIALIZATION_AR[value]) || !/(عرض|عروض|حافز|offer|incentive)/i.test(value);

const activeIndividual = (entry: CatalogEntry, methods: string[], currency: string) =>
  entry.prices.find(
    (price) =>
      price.active &&
      price.scope === "individual" &&
      price.currency === currency &&
      methods.includes(price.paymentMethod),
  );

const activeOffer = (entry: CatalogEntry) =>
  entry.prices.find(
    (price) =>
      price.active &&
      price.scope === "offer" &&
      (price.exact !== null || price.minimum !== null || price.maximum !== null),
  );

const packagePrices = (entry: CatalogEntry) =>
  entry.prices.filter(
    (price) =>
      price.active &&
      (price.scope === "bundle" || price.scope === "level") &&
      (price.exact !== null || price.minimum !== null || price.maximum !== null),
  );

function PriceCell({
  price,
  empty,
  accent = false,
}: {
  price?: CatalogPrice;
  empty: string;
  accent?: boolean;
}) {
  const { lang } = useI18n();
  if (!price) return <span className="text-[12px] text-text-subtle">{empty}</span>;
  return (
    <div className="space-y-0.5">
      <div
        className={`text-[13px] font-bold tabular-nums ${accent ? "text-warning" : "text-text"}`}
      >
        {bandText(price, lang)}
      </div>
      {price.minimum !== null && price.maximum !== null && price.minimum !== price.maximum && (
        <div className="text-[10px] text-text-subtle">
          {lang === "ar" ? "أول رقم هو أقل سعر مسموح" : "The first value is the floor"}
        </div>
      )}
    </div>
  );
}

const CATEGORY_ACCENTS = [
  { border: "border-brand/35", surface: "bg-brand-soft/55", icon: "bg-brand text-white" },
  { border: "border-warning/35", surface: "bg-warning-soft/55", icon: "bg-warning text-white" },
  { border: "border-success/35", surface: "bg-success-soft/55", icon: "bg-success text-white" },
  { border: "border-danger/25", surface: "bg-danger-soft/45", icon: "bg-danger text-white" },
] as const;

function CourseSummaryCard({ entry, accentIndex }: { entry: CatalogEntry; accentIndex: number }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [open, setOpen] = useState(false);
  const instalment = activeIndividual(entry, ["tabby", "tamara"], "SAR");
  const cash = activeIndividual(entry, ["cash", "cashier"], "SAR");
  const egypt = activeIndividual(entry, ["any", "cash", "cashier"], "EGP");
  const offer = activeOffer(entry);
  const packages = packagePrices(entry);
  const accent = CATEGORY_ACCENTS[accentIndex % CATEGORY_ACCENTS.length];

  return (
    <Card
      className={`group overflow-hidden border ${accent.border} p-0 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg`}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full cursor-pointer p-4 text-start"
        aria-expanded={open}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={`grid size-10 shrink-0 place-items-center rounded-xl ${accent.icon} shadow-sm`}
            >
              <GraduationCap size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <Pill tone="brand">#{entry.rawCode || "—"}</Pill>
                <Pill tone="neutral">{deliveryLabel(entry.deliveryType, lang)}</Pill>
                {entry.onHold && <Pill tone="danger">{ar ? "موقوف" : "On hold"}</Pill>}
              </div>
              <h3 className="line-clamp-2 text-[14px] font-bold leading-snug text-text">
                {entry.courseName}
              </h3>
            </div>
          </div>
          <span className="mt-1 text-text-subtle">
            {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className={`rounded-xl ${accent.surface} p-3`}>
            <div className="text-[10px] font-semibold text-text-muted">
              {ar ? "تابي / تمارا" : "Tabby / Tamara"}
            </div>
            <div className="mt-1">
              <PriceCell price={instalment} empty={ar ? "غير محدد" : "Not set"} />
            </div>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <div className="text-[10px] font-semibold text-text-muted">
              {ar ? "كاش / كاشير" : "Cash / cashier"}
            </div>
            <div className="mt-1">
              <PriceCell price={cash} empty={ar ? "غير محدد" : "Not set"} />
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] font-semibold text-brand">
          <span>
            {open
              ? ar
                ? "إخفاء التفاصيل"
                : "Hide details"
              : ar
                ? "فتح تفاصيل السعر"
                : "Open price details"}
          </span>
          <span className="text-text-subtle">
            {entry.prices.length} {ar ? "سعر" : "prices"}
          </span>
        </div>
      </button>

      {open && (
        <div className="animate-in fade-in slide-in-from-top-1 border-t border-border bg-surface-2/55 p-4 duration-200">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border bg-surface p-3">
              <div className="mb-1 text-[10px] font-semibold text-text-muted">
                {ar ? "السعر بالمصري" : "Egypt price"}
              </div>
              <PriceCell price={egypt} empty={ar ? "غير محدد" : "Not set"} />
            </div>
            <div className="rounded-xl border border-border bg-surface p-3">
              <div className="mb-1 text-[10px] font-semibold text-text-muted">
                {ar ? "العرض الحالي" : "Current offer"}
              </div>
              <PriceCell price={offer} empty={ar ? "لا يوجد عرض" : "No offer"} accent />
            </div>
          </div>
          {!!packages.length && (
            <div className="mt-3 rounded-xl border border-brand/20 bg-brand-soft/40 p-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <Pill tone="brand">{ar ? "باقات متاحة" : "Packages available"}</Pill>
                <span className="font-semibold text-text">
                  {packages
                    .slice(0, 3)
                    .map((price) => bandText(price, lang))
                    .join(" · ")}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * A one-line-per-course price sheet for the sales floor.
 *
 * The full search tab preserves every rule and note. This view deliberately
 * reduces the same published data to the four answers a seller asks for most:
 * instalment, cash, Egyptian price and the live offer. No second copy of the
 * prices is created, so editing or publishing a book updates both views.
 */
export function PriceCourseSummaryTab({
  filters,
  onFilters,
  data,
  facets,
  loading,
  error,
  onRetry,
}: {
  filters: SearchFilters;
  onFilters: (next: SearchFilters) => void;
  data?: CatalogResponse;
  facets?: FacetResponse;
  loading: boolean;
  error?: string;
  onRetry: () => void;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [draft, setDraft] = useState(filters.q);
  const [showCourses, setShowCourses] = useState(Boolean(filters.q));

  const grouped = useMemo(() => {
    const buckets = new Map<string, CatalogEntry[]>();
    for (const entry of data?.entries ?? []) {
      const key = entry.specialization || "Others";
      buckets.set(key, [...(buckets.get(key) ?? []), entry]);
    }
    return [...buckets.entries()];
  }, [data?.entries]);

  const overview = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of data?.entries ?? []) {
      const key = entry.specialization || "Others";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([key]) => isCourseSpecialization(key));
  }, [data?.entries]);

  if (error) return <ErrorState message={error} onRetry={onRetry} />;

  return (
    <div className="space-y-4">
      <Card className="relative overflow-hidden border-brand/20 p-0">
        <div className="absolute inset-y-0 start-0 w-1 bg-warning" aria-hidden="true" />
        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="flex items-center gap-2 text-brand">
              <BookOpenCheck size={18} aria-hidden="true" />
              <h2 className="text-[16px] font-bold">
                {ar ? "ملخص أسعار كل دورة" : "Course price summary"}
              </h2>
            </div>
            <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-text-muted">
              {ar
                ? "اختار الدورة واقرأ سعر التقسيط أو الكاش مباشرة. الأرقام من قائمة الأسعار المنشورة نفسها، وأول رقم في النطاق هو أقل سعر مسموح."
                : "Find a course and read instalment or cash pricing immediately. The first value in a range is the allowed floor."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 font-semibold text-brand">
              <WalletCards size={13} /> {ar ? "تقسيط" : "Instalment"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1.5 font-semibold text-success">
              <Banknote size={13} /> {ar ? "كاش" : "Cash"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-3 py-1.5 font-semibold text-warning">
              <BadgePercent size={13} /> {ar ? "العرض" : "Offer"}
            </span>
          </div>
        </div>
      </Card>

      <Card className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_240px]">
        <form
          role="search"
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onFilters({ ...filters, q: draft });
            setShowCourses(true);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute inset-y-0 start-3 my-auto text-text-subtle"
            />
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              type="search"
              aria-label={ar ? "ابحث باسم الدورة أو الكود" : "Search by course or code"}
              placeholder={ar ? "اكتب اسم الدورة أو الكود…" : "Course name or code…"}
              className="min-h-11 w-full rounded-xl border border-border bg-surface ps-9 pe-3 text-[13px] text-text"
            />
          </div>
          <button
            type="submit"
            className="min-h-11 rounded-xl bg-brand px-4 text-[13px] font-bold text-white"
          >
            {ar ? "بحث" : "Search"}
          </button>
        </form>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] font-semibold text-text-muted">
            {ar ? "التخصص" : "Specialization"}
          </span>
          <select
            value={filters.specialization}
            onChange={(event) => {
              onFilters({ ...filters, specialization: event.target.value, subcategory: "all" });
              setShowCourses(true);
            }}
            className="min-h-11 rounded-xl border border-border bg-surface px-3 text-[13px] text-text"
          >
            <option value="all">{ar ? "كل التخصصات" : "All specializations"}</option>
            {(facets?.facets?.specializations ?? []).filter(isCourseSpecialization).map((value) => (
              <option key={value} value={value}>
                {specializationLabel(value, ar)}
              </option>
            ))}
          </select>
        </label>
      </Card>

      {!loading && !filters.q && !showCourses && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3 px-1">
            <div>
              <div className="flex items-center gap-2 text-brand">
                <Layers3 size={16} aria-hidden="true" />
                <h2 className="text-[15px] font-bold text-text">
                  {ar ? "ابدأ من التخصص" : "Start with a specialization"}
                </h2>
              </div>
              <p className="mt-1 text-[11px] text-text-muted">
                {ar
                  ? "اضغط على أي كرت لعرض الدورات والأسعار داخله."
                  : "Open a card to browse its courses and prices."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onFilters({ ...filters, specialization: "all" });
                setShowCourses(true);
              }}
              className="min-h-10 rounded-xl border border-border px-3 text-[12px] font-semibold text-brand hover:bg-brand-soft/40"
            >
              {ar ? "عرض كل الدورات" : "Show all courses"}
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {overview.map(([specialization, count], index) => {
              const accent = CATEGORY_ACCENTS[index % CATEGORY_ACCENTS.length];
              return (
                <button
                  type="button"
                  key={specialization}
                  onClick={() => {
                    onFilters({ ...filters, specialization, subcategory: "all" });
                    setShowCourses(true);
                  }}
                  className={`group relative min-h-32 overflow-hidden rounded-2xl border ${accent.border} ${accent.surface} p-4 text-start transition duration-200 hover:-translate-y-1 hover:shadow-lg`}
                >
                  <span className="absolute -end-4 -top-5 text-[72px] font-black leading-none text-current opacity-[0.045]">
                    {String(count).padStart(2, "0")}
                  </span>
                  <span className={`grid size-10 place-items-center rounded-xl ${accent.icon}`}>
                    <GraduationCap size={18} aria-hidden="true" />
                  </span>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <h3 className="text-[15px] font-bold text-text">
                        {specializationLabel(specialization, ar)}
                      </h3>
                      <p className="mt-0.5 text-[11px] text-text-muted">
                        {count} {ar ? "دورة متاحة" : "available courses"}
                      </p>
                    </div>
                    <span className="text-[11px] font-bold text-brand">
                      {ar ? "فتح ←" : "Open →"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {!!data?.error && <Notice tone="warning">{data.error}</Notice>}

      {!loading && showCourses && !filters.q && (
        <button
          type="button"
          onClick={() => {
            onFilters({ ...filters, specialization: "all", subcategory: "all" });
            setShowCourses(false);
          }}
          className="inline-flex min-h-10 items-center rounded-xl border border-border px-3 text-[12px] font-bold text-brand hover:bg-brand-soft/35"
        >
          {ar ? "← الرجوع لنظرة التخصصات" : "← Back to specialization overview"}
        </button>
      )}

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {!loading && !data?.entries.length && !data?.error && (
        <EmptyState label={ar ? "لا توجد دورات مطابقة" : "No matching courses"} />
      )}

      {!loading &&
        (showCourses || Boolean(filters.q)) &&
        grouped.map(([specialization, entries]) => (
          <section key={specialization} className="space-y-2">
            <div className="flex items-center justify-between gap-2 px-1">
              <h2 className="text-[14px] font-bold text-text">
                {specializationLabel(specialization, ar)}
              </h2>
              <span className="text-[11px] text-text-subtle">
                {entries.length} {ar ? "دورة" : "courses"}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {entries.map((entry, index) => (
                <CourseSummaryCard
                  key={`${entry.code}${entry.deliveryType}${entry.subcategory}${entry.level}`}
                  entry={entry}
                  accentIndex={index}
                />
              ))}
            </div>
          </section>
        ))}

      {!!data?.truncated && (
        <Notice tone="info">
          {ar
            ? "المعروض أول صفحة فقط. استخدم البحث أو التخصص للوصول لباقي الدورات."
            : "Only the first page is shown. Use search or specialization to reach the rest."}
        </Notice>
      )}
    </div>
  );
}
