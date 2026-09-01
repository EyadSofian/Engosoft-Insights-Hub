import { useMemo, useState } from "react";
import {
  BadgePercent,
  Banknote,
  BookOpenCheck,
  OctagonMinus,
  Search,
  WalletCards,
} from "lucide-react";
import { Card, EmptyState, ErrorState, Notice, Pill, Skeleton } from "@/components/ui-bits";
import { useI18n } from "@/lib/i18n";
import {
  bandText,
  deliveryLabel,
  methodLabel,
  type CatalogEntry,
  type CatalogPrice,
} from "./pricing-ui";
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
  Boolean(SPECIALIZATION_AR[value]) || !/(عرض|حافز|offer|incentive)/i.test(value);

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

function MobileCourseCard({ entry }: { entry: CatalogEntry }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const instalment = activeIndividual(entry, ["tabby", "tamara"], "SAR");
  const cash = activeIndividual(entry, ["cash", "cashier"], "SAR");
  const egypt = activeIndividual(entry, ["any", "cash", "cashier"], "EGP");
  const offer = activeOffer(entry);
  const packages = packagePrices(entry);

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border bg-surface-2/70 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[14px] font-bold leading-snug text-text">{entry.courseName}</h3>
            <p className="mt-1 text-[11px] text-text-muted">
              {entry.rawCode || "—"} · {deliveryLabel(entry.deliveryType, lang)}
            </p>
          </div>
          {entry.onHold && <Pill tone="danger">{ar ? "موقوف" : "On hold"}</Pill>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border">
        {[
          [ar ? "تابي / تمارا" : "Tabby / Tamara", instalment],
          [ar ? "كاش / كاشير" : "Cash / cashier", cash],
          [ar ? "السعر بالمصري" : "Egypt price", egypt],
          [ar ? "العرض الحالي" : "Current offer", offer],
        ].map(([label, price]) => (
          <div key={String(label)} className="min-h-20 bg-surface p-3">
            <div className="mb-1 text-[10px] font-semibold text-text-muted">{String(label)}</div>
            <PriceCell
              price={price as CatalogPrice | undefined}
              empty={ar ? "غير محدد" : "Not set"}
            />
          </div>
        ))}
      </div>
      {!!packages.length && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-[11px]">
          <Pill tone="brand">{ar ? "باقات متاحة" : "Packages available"}</Pill>
          <span className="text-text-muted">
            {packages
              .slice(0, 2)
              .map((price) => bandText(price, lang))
              .join(" · ")}
          </span>
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

  const grouped = useMemo(() => {
    const buckets = new Map<string, CatalogEntry[]>();
    for (const entry of data?.entries ?? []) {
      const key = entry.specialization || "Others";
      buckets.set(key, [...(buckets.get(key) ?? []), entry]);
    }
    return [...buckets.entries()];
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
            onChange={(event) =>
              onFilters({ ...filters, specialization: event.target.value, subcategory: "all" })
            }
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

      {!!data?.error && <Notice tone="warning">{data.error}</Notice>}

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

            <div className="space-y-2 lg:hidden">
              {entries.map((entry) => (
                <MobileCourseCard
                  key={`${entry.code}${entry.deliveryType}${entry.subcategory}${entry.level}`}
                  entry={entry}
                />
              ))}
            </div>

            <Card className="hidden overflow-x-auto p-0 lg:block">
              <table className="w-full min-w-[980px] border-collapse text-start">
                <thead className="bg-surface-2/90 text-[11px] text-text-muted">
                  <tr>
                    <th className="px-4 py-3 text-start font-semibold">
                      {ar ? "الدورة" : "Course"}
                    </th>
                    <th className="px-3 py-3 text-start font-semibold">
                      {ar ? "النوع" : "Delivery"}
                    </th>
                    <th className="px-3 py-3 text-start font-semibold">
                      {ar ? "تابي / تمارا" : "Tabby / Tamara"}
                    </th>
                    <th className="px-3 py-3 text-start font-semibold">
                      {ar ? "كاش / كاشير" : "Cash / cashier"}
                    </th>
                    <th className="px-3 py-3 text-start font-semibold">
                      {ar ? "السعر بالمصري" : "Egypt price"}
                    </th>
                    <th className="px-3 py-3 text-start font-semibold">
                      {ar ? "العرض أو الباقة" : "Offer / package"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const instalment = activeIndividual(entry, ["tabby", "tamara"], "SAR");
                    const cash = activeIndividual(entry, ["cash", "cashier"], "SAR");
                    const egypt = activeIndividual(entry, ["any", "cash", "cashier"], "EGP");
                    const offer = activeOffer(entry);
                    const packages = packagePrices(entry);
                    return (
                      <tr
                        key={`${entry.code}${entry.deliveryType}${entry.subcategory}${entry.level}`}
                        className="border-t border-border align-top transition-colors hover:bg-brand-soft/25"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-start gap-2">
                            {entry.onHold && (
                              <OctagonMinus size={15} className="mt-0.5 shrink-0 text-danger" />
                            )}
                            <div>
                              <div className="max-w-[330px] text-[13px] font-bold leading-snug text-text">
                                {entry.courseName}
                              </div>
                              <div className="mt-0.5 text-[10px] text-text-subtle">
                                {entry.rawCode || "—"} ·{" "}
                                {entry.subcategory || specializationLabel(entry.specialization, ar)}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-[12px] text-text-muted">
                          {deliveryLabel(entry.deliveryType, lang)}
                          {!!entry.level && <div className="mt-0.5 text-[10px]">{entry.level}</div>}
                        </td>
                        <td className="px-3 py-3">
                          <PriceCell price={instalment} empty={ar ? "غير محدد" : "Not set"} />
                        </td>
                        <td className="px-3 py-3">
                          <PriceCell price={cash} empty={ar ? "غير محدد" : "Not set"} />
                        </td>
                        <td className="px-3 py-3">
                          <PriceCell price={egypt} empty={ar ? "غير محدد" : "Not set"} />
                        </td>
                        <td className="px-3 py-3">
                          {offer ? (
                            <div>
                              <PriceCell price={offer} empty="—" accent />
                              <div className="mt-1 text-[10px] text-text-subtle">
                                {methodLabel(offer.paymentMethod, lang)}
                                {offer.validTo ? ` · ${ar ? "حتى" : "until"} ${offer.validTo}` : ""}
                              </div>
                            </div>
                          ) : packages.length ? (
                            <div className="space-y-1">
                              <Pill tone="brand">{ar ? "باقة" : "Package"}</Pill>
                              <div className="text-[11px] font-semibold text-text">
                                {packages
                                  .slice(0, 2)
                                  .map((price) => bandText(price, lang))
                                  .join(" · ")}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[12px] text-text-subtle">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
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
