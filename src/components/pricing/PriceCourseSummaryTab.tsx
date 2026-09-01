import { useMemo, useState } from "react";
import {
  BadgePercent,
  Banknote,
  BookOpenCheck,
  ChevronLeft,
  GraduationCap,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { Card, EmptyState, ErrorState, Notice, Pill, Skeleton } from "@/components/ui-bits";
import { useI18n } from "@/lib/i18n";
import {
  bandText,
  deliveryLabel,
  methodLabel,
  scopeLabel,
  type CatalogEntry,
  type CatalogPrice,
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

const ACCENTS: Record<string, { border: string; icon: string; glow: string }> = {
  Management: {
    border: "border-danger/20",
    icon: "bg-danger-soft text-danger",
    glow: "from-danger/10",
  },
  "Mech & Elec": {
    border: "border-brand/25",
    icon: "bg-brand-soft text-brand",
    glow: "from-brand/10",
  },
  "BIM all": {
    border: "border-warning/25",
    icon: "bg-warning-soft text-warning",
    glow: "from-warning/10",
  },
  "Architecture & Decor": {
    border: "border-brand/25",
    icon: "bg-brand-soft text-brand",
    glow: "from-brand/10",
  },
  "Civil Courses": {
    border: "border-success/25",
    icon: "bg-success-soft text-success",
    glow: "from-success/10",
  },
  Others: {
    border: "border-warning/20",
    icon: "bg-warning-soft text-warning",
    glow: "from-warning/10",
  },
};

const specializationLabel = (value: string, ar: boolean) =>
  ar ? SPECIALIZATION_AR[value] || value || "دورات أخرى" : value || "Other courses";

const isCourseSpecialization = (value: string) =>
  Boolean(SPECIALIZATION_AR[value]) || !/(عرض|عروض|حافز|offer|incentive)/i.test(value);

const today = () => new Date().toISOString().slice(0, 10);

const activeOffers = (entry: CatalogEntry) =>
  entry.prices.filter(
    (price) =>
      price.active &&
      price.scope === "offer" &&
      (!price.validFrom || price.validFrom <= today()) &&
      (!price.validTo || price.validTo >= today()),
  );

type ContentKind = "all" | "course" | "package" | "offer";

const isPackage = (entry: CatalogEntry) =>
  entry.prices.some(
    (price) =>
      price.scope === "bundle" || price.scope === "level" || Boolean(price.bundleName?.trim()),
  );

const matchesKind = (entry: CatalogEntry, kind: ContentKind) => {
  if (kind === "all") return true;
  if (kind === "package") return isPackage(entry);
  if (kind === "offer") return activeOffers(entry).length > 0;
  return !isPackage(entry);
};

const activeSellPrice = (
  entry: CatalogEntry,
  methods: string[],
  currency: string,
): CatalogPrice | undefined => {
  const preferredScopes = isPackage(entry) ? ["bundle", "level"] : ["individual"];
  const available = entry.prices.filter(
    (price) =>
      price.active &&
      price.currency === currency &&
      (methods.includes(price.paymentMethod) || price.paymentMethod === "any") &&
      !["offer", "incentive"].includes(price.scope),
  );
  const preferred = available.filter((price) => preferredScopes.includes(price.scope));
  const candidates = preferred.length ? preferred : available;
  if (!candidates.length) return undefined;
  const floors = candidates
    .map((price) => price.minimum ?? price.exact ?? price.maximum)
    .filter((value): value is number => value !== null);
  const ceilings = candidates
    .map((price) => price.maximum ?? price.exact ?? price.minimum)
    .filter((value): value is number => value !== null);
  if (!floors.length || !ceilings.length) return candidates[0];
  const minimum = Math.min(...floors);
  const maximum = Math.max(...ceilings);
  return {
    ...candidates[0],
    exact: minimum === maximum ? minimum : null,
    minimum,
    maximum,
    requiresReview: candidates.some((price) => price.requiresReview),
  };
};

function PriceBlock({
  label,
  price,
  Icon,
}: {
  label: string;
  price?: CatalogPrice;
  Icon: LucideIcon;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  return (
    <div className="min-w-0 rounded-xl border border-border/75 bg-surface/80 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-text-muted">
        <Icon size={12} className="text-brand" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-1 truncate text-[13px] font-black tabular-nums text-text">
        {price ? bandText(price, lang) : ar ? "غير محدد" : "Not set"}
      </div>
    </div>
  );
}

function CoursePriceDialog({ entry, onClose }: { entry: CatalogEntry; onClose: () => void }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/45 sm:place-items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={entry.courseName}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-t-[24px] border border-border bg-surface p-5 shadow-2xl sm:rounded-[24px] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-1.5">
              <Pill tone="brand">#{entry.rawCode || "—"}</Pill>
              <Pill tone="neutral">{deliveryLabel(entry.deliveryType, lang)}</Pill>
              {entry.onHold && <Pill tone="danger">{ar ? "موقوف" : "On hold"}</Pill>}
              {entry.requiresReview && (
                <Pill tone="warning">{ar ? "يحتاج مراجعة" : "Needs review"}</Pill>
              )}
            </div>
            <h2 className="mt-3 text-[19px] font-black leading-snug text-text">
              {entry.courseName}
            </h2>
            <p className="mt-1 text-[11px] text-text-muted">
              {specializationLabel(entry.specialization, ar)} · {entry.subcategory || "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-10 shrink-0 place-items-center rounded-xl border border-border text-text-muted hover:bg-surface-2"
            aria-label={ar ? "إغلاق" : "Close"}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {entry.prices.map((price) => (
            <div
              key={price.id}
              className={`rounded-2xl border p-3.5 ${
                price.scope === "offer"
                  ? "border-warning/30 bg-warning-soft/25"
                  : "border-border bg-surface-2/45"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  <Pill tone={price.scope === "offer" ? "warning" : "neutral"}>
                    {scopeLabel(price.scope, lang)}
                  </Pill>
                  <Pill tone="neutral">{methodLabel(price.paymentMethod, lang)}</Pill>
                </div>
                <strong className="text-[14px] tabular-nums text-text">
                  {bandText(price, lang)}
                </strong>
              </div>
              <div className="mt-2 text-[10px] leading-relaxed text-text-subtle">
                {ar ? "مرجع قائمة الأسعار" : "Price-list reference"} · {ar ? "الصف" : "row"}{" "}
                {price.sourceRow}
                {price.validTo
                  ? ` · ${ar ? "ساري حتى" : "valid until"} ${new Intl.DateTimeFormat(
                      ar ? "ar-EG" : "en-GB",
                    ).format(new Date(`${price.validTo}T00:00:00`))}`
                  : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CourseCompactCard({ entry }: { entry: CatalogEntry }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [open, setOpen] = useState(false);
  const instalment = activeSellPrice(entry, ["tabby", "tamara"], "SAR");
  const cash = activeSellPrice(entry, ["cash", "cashier"], "SAR");
  const egypt = activeSellPrice(entry, ["any", "cash", "cashier"], "EGP");
  const offers = activeOffers(entry);
  const accent = ACCENTS[entry.specialization] ?? ACCENTS.Others;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group relative min-h-[188px] overflow-hidden rounded-2xl border ${accent.border} bg-surface p-3.5 text-start shadow-sm transition hover:-translate-y-0.5 hover:shadow-md`}
      >
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b ${accent.glow} to-transparent`}
          aria-hidden="true"
        />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill tone="brand">#{entry.rawCode || "—"}</Pill>
              <Pill tone="neutral">{deliveryLabel(entry.deliveryType, lang)}</Pill>
              {entry.onHold && <Pill tone="danger">{ar ? "موقوف" : "On hold"}</Pill>}
            </div>
            <h3 className="mt-2 line-clamp-2 min-h-9 text-[12px] font-black leading-snug text-text">
              {entry.courseName}
            </h3>
          </div>
          <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${accent.icon}`}>
            <GraduationCap size={16} aria-hidden="true" />
          </span>
        </div>

        <div className="relative mt-2.5 grid grid-cols-2 gap-2">
          <PriceBlock
            label={ar ? "تابي / تمارا" : "Tabby / Tamara"}
            price={instalment}
            Icon={WalletCards}
          />
          <PriceBlock label={ar ? "كاش" : "Cash"} price={cash} Icon={Banknote} />
        </div>

        <div className="relative mt-2.5 flex min-h-7 items-center justify-between gap-2 border-t border-border/70 pt-2">
          <div className="min-w-0 text-[10px] text-text-muted">
            <span>{ar ? "السعر المصري" : "Egypt price"}</span>
            <strong className="ms-1.5 tabular-nums text-text">
              {egypt ? bandText(egypt, lang) : "—"}
            </strong>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!!offers.length && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-1 text-[10px] font-bold text-warning">
                <BadgePercent size={11} aria-hidden="true" />
                {offers.length} {ar ? "عرض" : "offers"}
              </span>
            )}
            <ChevronLeft
              size={15}
              className="text-text-subtle transition group-hover:-translate-x-0.5"
              aria-hidden="true"
            />
          </div>
        </div>
      </button>
      {open && <CoursePriceDialog entry={entry} onClose={() => setOpen(false)} />}
    </>
  );
}

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
  const [kind, setKind] = useState<ContentKind>("all");

  const grouped = useMemo(() => {
    const groups = new Map<string, CatalogEntry[]>();
    for (const entry of (data?.entries ?? []).filter((course) => matchesKind(course, kind))) {
      const key = entry.specialization || "Others";
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    return [...groups.entries()];
  }, [data?.entries, kind]);

  const specializations = (facets?.facets?.specializations ?? []).filter(isCourseSpecialization);
  const deliveryTypes = facets?.facets?.deliveryTypes ?? [];

  if (error) return <ErrorState message={error} onRetry={onRetry} />;

  const visibleCount = grouped.reduce((sum, [, entries]) => sum + entries.length, 0);
  const kindTabs: { value: ContentKind; label: string }[] = [
    { value: "all", label: ar ? "الكل" : "All" },
    { value: "course", label: ar ? "الدورات" : "Courses" },
    { value: "package", label: ar ? "الباقات" : "Packages" },
    { value: "offer", label: ar ? "العروض السارية" : "Live offers" },
  ];

  return (
    <div className="space-y-4">
      <Card className="space-y-3.5 border-brand/20 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-brand">
            <BookOpenCheck size={17} aria-hidden="true" />
            <div>
              <h2 className="text-[14px] font-black text-text">
                {ar ? "اختر التخصص" : "Choose a specialization"}
              </h2>
              <p className="mt-0.5 text-[10px] text-text-muted">
                {ar
                  ? "ستظهر الكورسات والباقات التابعة للتخصص فقط."
                  : "Only courses and packages in the selected specialization appear."}
              </p>
            </div>
          </div>
          <Pill tone="brand">
            {visibleCount} {ar ? "نتيجة" : "results"}
          </Pill>
        </div>

        <div className="hscroll">
          <div className="flex min-w-max gap-1.5 border-b border-border pb-3">
            {["all", ...specializations].map((value) => (
              <button
                type="button"
                key={value}
                onClick={() => onFilters({ ...filters, specialization: value, subcategory: "all" })}
                className={`min-h-9 rounded-xl border px-3.5 text-[11px] font-bold transition ${
                  filters.specialization === value
                    ? "border-brand bg-brand text-white"
                    : "border-border bg-surface text-text-muted hover:bg-surface-2"
                }`}
              >
                {value === "all"
                  ? ar
                    ? "كل التخصصات"
                    : "All specializations"
                  : specializationLabel(value, ar)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="hscroll">
            <div className="flex min-w-max gap-1.5">
              {kindTabs.map((item) => (
                <button
                  type="button"
                  key={item.value}
                  onClick={() => setKind(item.value)}
                  className={`min-h-8 rounded-lg px-3 text-[10px] font-bold transition ${
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
            <div className="hscroll">
              <div className="flex min-w-max gap-1.5">
                {["all", ...deliveryTypes].map((value) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => onFilters({ ...filters, deliveryType: value })}
                    className={`min-h-8 rounded-lg border px-2.5 text-[10px] font-semibold transition ${
                      filters.deliveryType === value
                        ? "border-[#10262d] bg-[#10262d] text-white"
                        : "border-border bg-surface text-text-muted hover:bg-surface-2 hover:text-text"
                    }`}
                  >
                    {value === "all"
                      ? ar
                        ? "كل الأنواع"
                        : "All types"
                      : deliveryLabel(value, lang)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {!!data?.error && (
        <Notice tone="warning">
          {ar ? "تعذر تحميل بيانات قائمة الأسعار من قاعدة البيانات." : data.error}
        </Notice>
      )}

      {loading && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-[188px] w-full rounded-2xl" />
          ))}
        </div>
      )}

      {!loading && !visibleCount && !data?.error && (
        <EmptyState label={ar ? "لا توجد دورات مطابقة" : "No matching courses"} />
      )}

      {!loading &&
        grouped.map(([specialization, entries]) => (
          <section key={specialization} className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-[13px] font-black text-text">
                {specializationLabel(specialization, ar)}
              </h2>
              <span className="text-[10px] text-text-subtle">
                {entries.length} {ar ? "دورة" : "courses"}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {entries.map((entry) => (
                <CourseCompactCard
                  key={`${entry.code}:${entry.deliveryType}:${entry.subcategory}:${entry.level}`}
                  entry={entry}
                />
              ))}
            </div>
          </section>
        ))}

      {!!data?.truncated && (
        <Notice tone="info">
          {ar
            ? "استخدم البحث أو التخصص للوصول إلى بقية الدورات."
            : "Use search or specialization to reach the remaining courses."}
        </Notice>
      )}
    </div>
  );
}
