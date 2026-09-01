import { useMemo, useState } from "react";
import { BadgePercent, Boxes, CircleAlert, Gift, OctagonMinus, Search, Tag } from "lucide-react";
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
            {lang === "ar" ? `ينتهي ${price.validTo}` : `ends ${price.validTo}`}
          </span>
        )}
      </div>
      {!!price.bundleName && (
        <p className="w-full text-[11px] text-text-muted">{price.bundleName}</p>
      )}
      {!!price.note && price.scope !== "individual" && (
        <p className="w-full text-[11px] leading-snug text-text-subtle">{price.note}</p>
      )}
    </div>
  );
}

function CourseCard({ entry }: { entry: CatalogEntry }) {
  const { lang } = useI18n();
  const groups = useMemo(() => {
    const order = ["individual", "level", "bundle", "offer", "incentive"];
    return order
      .map((scope) => ({
        scope,
        prices: entry.prices.filter((price) => price.scope === scope),
      }))
      .filter((group) => group.prices.length);
  }, [entry.prices]);

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold leading-snug text-text">{entry.courseName}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
            <span className="inline-flex items-center gap-1">
              <Tag size={12} aria-hidden="true" />
              {entry.rawCode || "—"}
            </span>
            <span aria-hidden="true">·</span>
            <span>{entry.subcategory || entry.specialization}</span>
            <span aria-hidden="true">·</span>
            <span>{deliveryLabel(entry.deliveryType, lang)}</span>
            {!!entry.level && (
              <>
                <span aria-hidden="true">·</span>
                <span>{entry.level}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {entry.onHold && (
            <Pill tone="danger">
              <OctagonMinus size={11} className="me-1" aria-hidden="true" />
              {lang === "ar" ? "موقوف — ممنوع البيع" : "On hold — do not sell"}
            </Pill>
          )}
          {entry.prices.some((price) => price.scope === "offer" && price.active) && (
            <Pill tone="warning">
              <BadgePercent size={11} className="me-1" aria-hidden="true" />
              {lang === "ar" ? "عرض" : "Offer"}
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
          {!entry.odooProductId && (
            <Pill tone="neutral">{lang === "ar" ? "غير مربوط بأودو" : "Not linked to Odoo"}</Pill>
          )}
        </div>
      </div>

      {groups.map((group) => (
        <div key={group.scope}>
          {group.scope !== "individual" && (
            <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
              {scopeLabel(group.scope, lang)}
            </p>
          )}
          {group.prices.map((price) => (
            <PriceRow key={price.id} price={price} />
          ))}
        </div>
      ))}
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
      <Card className="space-y-3">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            set("q", draft);
          }}
          className="flex items-center gap-2"
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
            className="min-h-12 shrink-0 cursor-pointer rounded-xl px-4 text-[13px] font-semibold text-white"
            style={{ background: "var(--brand)" }}
          >
            {lang === "ar" ? "بحث" : "Search"}
          </button>
        </form>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Select
            label={t("pb_specialization")}
            value={filters.specialization}
            onChange={(value) =>
              onFilters({ ...filters, specialization: value, subcategory: "all" })
            }
            options={(facets?.facets?.specializations ?? []).map((value) => ({
              value,
              label: value,
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

        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[13px] text-text">
          <input
            type="checkbox"
            checked={filters.liveOffers}
            onChange={(event) => set("liveOffers", event.target.checked)}
            className="size-4 accent-[var(--brand)]"
          />
          {t("pb_live_offers")}
        </label>
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
            <h2 className="text-[13px] font-semibold text-text-muted">
              {specialization}
              <span className="ms-2 text-[11px] font-normal text-text-subtle">
                {entries.length}
              </span>
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
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
