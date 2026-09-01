import { useMemo, useState } from "react";
import {
  BadgePercent,
  Boxes,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleDollarSign,
  Gift,
  OctagonMinus,
  Search,
  SlidersHorizontal,
  Tag,
} from "lucide-react";
import { Card, EmptyState, ErrorState, Notice, Pill, Skeleton } from "@/components/ui-bits";
import { useI18n } from "@/lib/i18n";
import {
  bandText,
  deliveryLabel,
  fmtMoney,
  methodLabel,
  scopeLabel,
  type AuthState,
  type CatalogEntry,
  type CatalogPrice,
  type PriceBookSummary,
} from "./pricing-ui";

export interface CatalogResponse {
  configured: boolean;
  book: PriceBookSummary | null;
  entries: CatalogEntry[];
  total: number;
  truncated?: boolean;
  auth: AuthState;
  error: string;
}

interface FacetResponse {
  configured: boolean;
  facets: {
    specializations: string[];
    subcategories: { specialization: string; subcategory: string }[];
    deliveryTypes: string[];
    currencies: string[];
    countries: string[];
    levels: string[];
  } | null;
}

export interface SearchFilters {
  q: string;
  specialization: string;
  subcategory: string;
  deliveryType: string;
  paymentMethod: string;
  currency: string;
  country: string;
  liveOffers: boolean;
}

export const emptySearchFilters: SearchFilters = {
  q: "",
  specialization: "all",
  subcategory: "all",
  deliveryType: "all",
  paymentMethod: "all",
  currency: "all",
  country: "all",
  liveOffers: false,
};

const SPECIALIZATION_AR: Record<string, string> = {
  Management: "الإدارة",
  "Mech & Elec": "الميكانيكا والكهرباء",
  "BIM all": "نمذجة معلومات البناء BIM",
  "Architecture & Decor": "العمارة والديكور",
  "Civil Courses": "الهندسة المدنية",
  Others: "دورات أخرى",
};

const specializationLabel = (value: string, lang: string) =>
  lang === "ar" ? SPECIALIZATION_AR[value] || value : value;

const sourceLabel = (value: string, lang: string) =>
  lang === "ar" ? SPECIALIZATION_AR[value] || value : value;

const dateLabel = (value: string, lang: string): string => {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

const liveOffer = (entry: CatalogEntry) => {
  const today = new Date().toISOString().slice(0, 10);
  return entry.prices.find(
    (price) =>
      price.scope === "offer" &&
      price.active &&
      (!price.validFrom || price.validFrom <= today) &&
      (!price.validTo || price.validTo >= today),
  );
};

const individualPrice = (entry: CatalogEntry, methods: string[]) =>
  entry.prices.find(
    (price) =>
      price.active &&
      price.scope === "individual" &&
      price.currency === "SAR" &&
      methods.includes(price.paymentMethod),
  );

function Select({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium text-text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-lg border border-border bg-surface px-2.5 text-[13px] text-text"
      >
        <option value="all">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * One price row on a course card.
 *
 * The band is written out rather than reduced to a single figure: a seller who
 * only sees "700" cannot tell whether 650 is a discount they may give or one
 * they may not.
 */
function PriceRow({ price }: { price: CatalogPrice }) {
  const { lang } = useI18n();
  const scopeTone =
    price.scope === "offer"
      ? "warning"
      : price.scope === "bundle" || price.scope === "level"
        ? "brand"
        : price.scope === "incentive"
          ? "neutral"
          : "neutral";

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-border py-2 first:border-t-0">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="text-[13px] font-medium text-text">
          {methodLabel(price.paymentMethod, lang)}
        </span>
        {price.scope !== "individual" && (
          <Pill tone={scopeTone}>{scopeLabel(price.scope, lang)}</Pill>
        )}
        {!!price.country && <Pill tone="neutral">{price.country}</Pill>}
        {!price.active && (
          <Pill tone="warning">{lang === "ar" ? "غير منشور" : "Not published"}</Pill>
        )}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-end">
        <span className="text-[15px] font-semibold tabular-nums text-text">
          {bandText(price, lang)}
        </span>
        {price.minimum !== null && price.maximum !== null && price.minimum !== price.maximum && (
          <span className="text-[11px] text-text-muted">
            {lang === "ar"
              ? `أقل سعر ${fmtMoney(price.minimum, price.currency, lang)}`
              : `floor ${fmtMoney(price.minimum, price.currency, lang)}`}
          </span>
        )}
        {!!price.validTo && (
          <span className="text-[11px] text-warning">
            {lang === "ar"
              ? `ساري حتى ${dateLabel(price.validTo, lang)}`
              : `valid until ${dateLabel(price.validTo, lang)}`}
          </span>
        )}
      </div>
      {!!price.bundleName && (
        <p className="w-full text-[11px] text-text-muted">{price.bundleName}</p>
      )}
      {price.scope === "offer" && (
        <p className="w-full text-[10px] leading-relaxed text-text-subtle">
          {lang === "ar" ? "المصدر: قائمة الأسعار" : "Source: price list"} ·{" "}
          {sourceLabel(price.sourceSheet, lang)} · {lang === "ar" ? "صف" : "row"} {price.sourceRow}
        </p>
      )}
      {!!price.note && price.scope !== "individual" && (
        <p className="w-full text-[11px] leading-snug text-text-subtle">{price.note}</p>
      )}
    </div>
  );
}

function CourseCard({ entry }: { entry: CatalogEntry }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const order = ["individual", "level", "bundle", "offer", "incentive"];
    return order
      .map((scope) => ({
        scope,
        prices: entry.prices.filter((price) => price.scope === scope),
      }))
      .filter((group) => group.prices.length);
  }, [entry.prices]);
  const cash = individualPrice(entry, ["cash", "cashier"]);
  const instalment = individualPrice(entry, ["tabby", "tamara"]);
  const offer = liveOffer(entry);

  return (
    <Card className="group flex flex-col overflow-hidden border-border p-0 transition-shadow hover:border-brand/30 hover:shadow-md">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full cursor-pointer px-5 py-4 text-start"
        aria-expanded={open}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
              <CircleDollarSign size={19} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <Pill tone="brand">
                  <Tag size={11} className="me-1" aria-hidden="true" />
                  {entry.rawCode || "—"}
                </Pill>
                <Pill tone="neutral">{deliveryLabel(entry.deliveryType, lang)}</Pill>
              </div>
              <h3 className="line-clamp-2 text-[14px] font-bold leading-snug text-text">
                {entry.courseName}
              </h3>
              <p className="mt-1 text-[11px] text-text-muted">
                {specializationLabel(entry.specialization || entry.subcategory, lang)}
                {!!entry.level && ` · ${entry.level}`}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-surface-2 px-3 py-2.5">
            <div className="text-[10px] font-semibold text-text-muted">
              {lang === "ar" ? "كاش" : "Cash"}
            </div>
            <div className="mt-1 text-[14px] font-bold tabular-nums text-text">
              {cash ? bandText(cash, lang) : "—"}
            </div>
          </div>
          <div className="rounded-xl bg-brand-soft/45 px-3 py-2.5">
            <div className="text-[10px] font-semibold text-text-muted">
              {lang === "ar" ? "تابي / تمارا" : "Tabby / Tamara"}
            </div>
            <div className="mt-1 text-[14px] font-bold tabular-nums text-brand">
              {instalment ? bandText(instalment, lang) : "—"}
            </div>
          </div>
        </div>

        <div className="mt-3 flex min-h-7 flex-wrap gap-1.5">
          {entry.onHold && (
            <Pill tone="danger">
              <OctagonMinus size={11} className="me-1" aria-hidden="true" />
              {lang === "ar" ? "موقوف — ممنوع البيع" : "On hold — do not sell"}
            </Pill>
          )}
          {offer && (
            <Pill tone="warning">
              <BadgePercent size={11} className="me-1" aria-hidden="true" />
              {lang === "ar" ? "عرض منشور" : "Published offer"}
              {offer.validTo
                ? ` · ${lang === "ar" ? "حتى" : "until"} ${dateLabel(offer.validTo, lang)}`
                : ""}
            </Pill>
          )}
          {entry.prices.some((price) => price.scope === "incentive") && (
            <Pill tone="brand">
              <Gift size={11} className="me-1" aria-hidden="true" />
              {lang === "ar" ? "حافز" : "Incentive"}
            </Pill>
          )}
          {entry.prices.some((price) => price.scope === "bundle" || price.scope === "level") && (
            <Pill tone="brand">
              <Boxes size={11} className="me-1" aria-hidden="true" />
              {lang === "ar" ? "باقة" : "Package"}
            </Pill>
          )}
          {entry.requiresReview && (
            <Pill tone="warning">
              <CircleAlert size={11} className="me-1" aria-hidden="true" />
              {lang === "ar" ? "يحتاج مراجعة" : "Needs review"}
            </Pill>
          )}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-[12px] font-bold text-brand">
          <span>
            {open
              ? lang === "ar"
                ? "إخفاء التفاصيل"
                : "Hide details"
              : lang === "ar"
                ? "عرض تفاصيل الأسعار"
                : "View price details"}
          </span>
          {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </div>
      </button>

      {open && (
        <div className="animate-in fade-in border-t border-border bg-surface-2/50 p-4 duration-200">
          {groups.map((group) => (
            <div key={group.scope} className="rounded-xl bg-surface px-3 first:mt-0 [&+&]:mt-2">
              {group.scope !== "individual" && (
                <p className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                  {scopeLabel(group.scope, lang)}
                </p>
              )}
              {group.prices.map((price) => (
                <PriceRow key={price.id} price={price} />
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * The salesperson's page.
 *
 * Optimised for one job: type a course name or a code, pick how the customer is
 * paying, read the price. Filters narrow, they never have to be set — an empty
 * search shows the whole published catalogue grouped by specialization.
 */
export function PriceSearchTab({
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
  const { lang, t } = useI18n();
  const [draft, setDraft] = useState(filters.q);
  const [showFilters, setShowFilters] = useState(false);

  const set = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) =>
    onFilters({ ...filters, [key]: value });

  const subcategories = useMemo(() => {
    const all = facets?.facets?.subcategories ?? [];
    const scoped =
      filters.specialization === "all"
        ? all
        : all.filter((entry) => entry.specialization === filters.specialization);
    return [...new Set(scoped.map((entry) => entry.subcategory))];
  }, [facets, filters.specialization]);

  const grouped = useMemo(() => {
    const buckets = new Map<string, CatalogEntry[]>();
    for (const entry of data?.entries ?? []) {
      const key = entry.specialization || "—";
      buckets.set(key, [...(buckets.get(key) ?? []), entry]);
    }
    return [...buckets.entries()];
  }, [data?.entries]);

  if (error) return <ErrorState message={error} onRetry={onRetry} />;

  return (
    <div className="space-y-4">
      <Card className="space-y-4 px-4 py-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            set("q", draft);
          }}
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
          role="search"
        >
          <div className="relative min-w-0 flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute inset-y-0 start-3 my-auto text-text-subtle"
              aria-hidden="true"
            />
            <input
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t("pb_search_placeholder")}
              aria-label={t("pb_search_placeholder")}
              className="min-h-12 w-full rounded-xl border border-border bg-surface ps-9 pe-3 text-[14px] text-text"
            />
          </div>
          <button
            type="submit"
            className="inline-flex min-h-12 shrink-0 cursor-pointer items-center justify-center rounded-xl px-5 text-[13px] font-semibold text-white transition hover:brightness-110"
            style={{ background: "var(--brand)" }}
          >
            {lang === "ar" ? "بحث" : "Search"}
          </button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setShowFilters((value) => !value)}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border px-3 text-[12px] font-semibold text-text hover:bg-surface-2"
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            {lang === "ar" ? "فلترة متقدمة" : "Advanced filters"}
            {showFilters ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          <span className="text-[11px] text-text-muted">
            {lang === "ar" ? "ابحث بالكود أو اسم الدورة أولًا" : "Start with a code or course name"}
          </span>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-3">
            <Select
              label={t("pb_specialization")}
              value={filters.specialization}
              onChange={(value) =>
                onFilters({ ...filters, specialization: value, subcategory: "all" })
              }
              options={(facets?.facets?.specializations ?? []).map((value) => ({
                value,
                label: specializationLabel(value, lang),
              }))}
              allLabel={t("all")}
            />
            <Select
              label={t("pb_subcategory")}
              value={filters.subcategory}
              onChange={(value) => set("subcategory", value)}
              options={subcategories.map((value) => ({ value, label: value }))}
              allLabel={t("all")}
            />
            <Select
              label={t("pb_delivery")}
              value={filters.deliveryType}
              onChange={(value) => set("deliveryType", value)}
              options={(facets?.facets?.deliveryTypes ?? []).map((value) => ({
                value,
                label: deliveryLabel(value, lang),
              }))}
              allLabel={t("all")}
            />
            <Select
              label={t("pb_payment_method")}
              value={filters.paymentMethod}
              onChange={(value) => set("paymentMethod", value)}
              options={["tabby", "tamara", "cash", "cashier", "bank_transfer"].map((value) => ({
                value,
                label: methodLabel(value, lang),
              }))}
              allLabel={t("all")}
            />
            <Select
              label={t("pb_currency")}
              value={filters.currency}
              onChange={(value) => set("currency", value)}
              options={(facets?.facets?.currencies ?? []).map((value) => ({ value, label: value }))}
              allLabel={t("all")}
            />
            <Select
              label={t("pb_country")}
              value={filters.country}
              onChange={(value) => set("country", value)}
              options={(facets?.facets?.countries ?? []).map((value) => ({ value, label: value }))}
              allLabel={t("all")}
            />
          </div>
        )}

        {showFilters && (
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-[13px] text-text">
            <input
              type="checkbox"
              checked={filters.liveOffers}
              onChange={(event) => set("liveOffers", event.target.checked)}
              className="size-4 accent-[var(--brand)]"
            />
            {t("pb_live_offers")}
          </label>
        )}
      </Card>

      {!!data?.error && <Notice tone="warning">{data.error}</Notice>}

      {loading && (
        <div className="grid gap-3 lg:grid-cols-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-40 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {!loading && !data?.entries.length && !data?.error && <EmptyState label={t("no_results")} />}

      {!loading &&
        grouped.map(([specialization, entries]) => (
          <section key={specialization} className="space-y-2">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold text-text-muted">
              {specializationLabel(specialization, lang)}
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold tabular-nums text-text-subtle">
                {entries.length}
              </span>
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {entries.map((entry) => (
                <CourseCard
                  key={`${entry.code}${entry.deliveryType}${entry.subcategory}${entry.level}`}
                  entry={entry}
                />
              ))}
            </div>
          </section>
        ))}

      {!!data?.truncated && (
        <Notice tone="info">
          {lang === "ar"
            ? "النتائج مقتصرة على أول صفحة. ضيّق البحث بالفلاتر للوصول لباقي الدورات."
            : "Showing the first page of matches. Narrow the filters to reach the rest."}
        </Notice>
      )}
    </div>
  );
}
