import { useMemo, useState } from "react";
import {
  Banknote,
  Check,
  CircleAlert,
  Copy,
  Search,
  ShieldCheck,
  TriangleAlert,
  WalletCards,
} from "lucide-react";
import { EmptyState, Skeleton } from "@/components/ui-bits";
import { useI18n } from "@/lib/i18n";
import { PriceRangeTrack } from "./PriceRangeTrack";
import { activeOffers, bandFor, entryKey as keyOf, today, type PriceBand } from "./course-pricing";
import { deliveryLabel, fmtMoney, type CatalogEntry } from "./pricing-ui";

type PaymentChoice = "instalment" | "cash";
type Market = "sa" | "eg";
type CustomerState = "standard" | "discount" | "approved_floor";

const CASH = ["cash", "cashier"];
const INSTALMENT = ["tabby", "tamara"];
const EGYPT = ["any", "cash", "cashier"];

const round25 = (value: number) => Math.round(value / 25) * 25;

const bandOf = (entry: CatalogEntry, market: Market, payment: PaymentChoice) =>
  market === "eg"
    ? bandFor(entry, EGYPT, "EGP")
    : bandFor(entry, payment === "cash" ? CASH : INSTALMENT, "SAR");

/**
 * Where inside the published band this sale should start.
 *
 * Unchanged from the original advisor: open at the ceiling, step down once by a
 * third of the band when the customer pushes back, and stop at the floor. The
 * numbers themselves are the price book's; nothing here invents a price.
 */
function suggest(band: PriceBand, state: CustomerState): number {
  const floor = band.floor ?? band.ceiling ?? 0;
  const ceiling = band.ceiling ?? band.floor ?? 0;
  if (state === "standard") return ceiling;
  if (state === "approved_floor") return floor;
  const step = Math.max(25, round25((ceiling - floor) / 3));
  return Math.max(floor, round25(ceiling - step));
}

type Verdict = "safe" | "needs_approval" | "not_allowed" | "above_list";

const VERDICTS: Record<Verdict, { ar: string; en: string; color: string; soft: string }> = {
  safe: {
    ar: "يمكن البيع من دون موافقة",
    en: "Can be sold without approval",
    color: "--success",
    soft: "--success-soft",
  },
  needs_approval: {
    ar: "يحتاج موافقة مدير المبيعات",
    en: "Needs the sales manager's approval",
    color: "--warning",
    soft: "--warning-soft",
  },
  not_allowed: {
    ar: "غير مسموح — تحت الحد الأدنى",
    en: "Not allowed — under the floor",
    color: "--danger",
    soft: "--danger-soft",
  },
  above_list: {
    ar: "أعلى من السعر الرسمي — يُسجَّل للمراجعة",
    en: "Above list — recorded for review",
    color: "--calm",
    soft: "--calm-soft",
  },
};

/**
 * The price advisor: a decision surface, not a form.
 *
 * The left column asks the four things that change the answer; the right column
 * is the answer, in the order a seller needs it — the number first, then the
 * room around it, then the line they must not cross, then why.
 */
export function PriceAdvisorTab({
  entries,
  loading,
}: {
  entries?: CatalogEntry[];
  loading?: boolean;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [courseKey, setCourseKey] = useState("");
  const [courseQuery, setCourseQuery] = useState("");
  const [market, setMarket] = useState<Market>("sa");
  const [payment, setPayment] = useState<PaymentChoice>("instalment");
  const [customerState, setCustomerState] = useState<CustomerState>("standard");
  const [asked, setAsked] = useState("");
  const [copied, setCopied] = useState(false);

  const options = useMemo(
    () =>
      (entries ?? [])
        .filter((entry) => !entry.onHold)
        .sort((a, b) => a.courseName.localeCompare(b.courseName)),
    [entries],
  );

  const shortlist = useMemo(() => {
    const term = courseQuery.trim().toLowerCase();
    if (!term) return options.slice(0, 300);
    return options
      .filter(
        (entry) =>
          entry.courseName.toLowerCase().includes(term) ||
          (entry.rawCode || "").toLowerCase().includes(term),
      )
      .slice(0, 300);
  }, [options, courseQuery]);

  const selected = options.find((entry) => keyOf(entry) === courseKey) ?? null;
  const band = selected ? bandOf(selected, market, payment) : undefined;
  const currency = market === "eg" ? "EGP" : "SAR";

  // The route not chosen, so the effect of the payment method is visible rather
  // than asserted. Egypt publishes one price for every method, so it has none.
  const otherBand =
    selected && market === "sa"
      ? bandOf(selected, "sa", payment === "cash" ? "instalment" : "cash")
      : undefined;

  const offers = useMemo(
    () =>
      selected
        ? activeOffers(selected).filter(
            (price) =>
              price.currency === currency &&
              (market === "eg"
                ? true
                : price.paymentMethod === "any" ||
                  (payment === "cash" ? CASH : INSTALMENT).includes(price.paymentMethod)),
          )
        : [],
    [selected, currency, market, payment],
  );

  const suggested = band ? suggest(band, customerState) : null;
  const floor = band?.floor ?? null;
  const ceiling = band?.ceiling ?? null;

  const askedValue = asked.trim() ? Number(asked.replace(/[^\d.]/g, "")) : null;
  const priceInQuestion =
    askedValue !== null && Number.isFinite(askedValue) ? askedValue : suggested;

  const verdict: Verdict | null = useMemo(() => {
    if (priceInQuestion === null || !band) return null;
    if (floor !== null && priceInQuestion < floor) return "not_allowed";
    if (ceiling !== null && priceInQuestion > ceiling) return "above_list";
    if (band.requiresReview) return "needs_approval";
    if (customerState === "approved_floor") return "needs_approval";
    return "safe";
  }, [priceInQuestion, band, floor, ceiling, customerState]);

  const copyPrice = async () => {
    if (priceInQuestion === null) return;
    try {
      await navigator.clipboard.writeText(String(priceInQuestion));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the figure is on screen either way.
    }
  };

  const reasons: string[] = [];
  if (band && ceiling !== null && floor !== null) {
    reasons.push(
      ar
        ? `السعر الرسمي المنشور لهذه الطريقة ${fmtMoney(ceiling, currency, lang)}.`
        : `The published list price for this route is ${fmtMoney(ceiling, currency, lang)}.`,
    );
    if (band.fixed) {
      reasons.push(
        ar
          ? "هذه الدورة منشورة بسعر ثابت، ولا تقبل التفاوض."
          : "This course is published at a fixed price and is not negotiable.",
      );
    } else if (customerState === "discount") {
      reasons.push(
        ar
          ? `طلب العميل خصمًا، فنزلنا خطوة واحدة داخل النطاق المسموح إلى ${fmtMoney(suggested ?? 0, currency, lang)}.`
          : `The customer asked for a discount, so the price steps down once inside the allowed band to ${fmtMoney(suggested ?? 0, currency, lang)}.`,
      );
    } else if (customerState === "approved_floor") {
      reasons.push(
        ar
          ? "الحالة مسجَّلة كاستثناء معتمد، فالاقتراح هو الحد الأدنى نفسه."
          : "This is recorded as an approved exception, so the suggestion is the floor itself.",
      );
    } else {
      reasons.push(
        ar
          ? "لا يوجد اعتراض على السعر، فالبيع يبدأ من السعر الرسمي."
          : "There is no price objection, so the sale opens at the list price.",
      );
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="grid lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.6fr)]">
        {/* --- what changes the answer ------------------------------------- */}
        <aside className="space-y-3.5 border-b border-border p-4 lg:border-b-0 lg:border-e">
          <div>
            <h2 className="text-[13px] font-bold text-text">
              {ar ? "الحالة التي تبيع فيها" : "The sale in front of you"}
            </h2>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {ar
                ? "اختر الدورة والطريقة، وسيظهر السعر المناسب لهذه الحالة."
                : "Pick the course and the route; the right price for the case appears beside it."}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-[11px] font-semibold text-text-muted"
              htmlFor="advisor-course-search"
            >
              {ar ? "الدورة" : "Course"}
            </label>
            <div className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 focus-within:border-brand">
              <Search size={14} className="shrink-0 text-text-subtle" aria-hidden="true" />
              <input
                id="advisor-course-search"
                value={courseQuery}
                onChange={(event) => setCourseQuery(event.target.value)}
                placeholder={ar ? "ابحث بالاسم أو الكود" : "Search by name or code"}
                className="min-w-0 flex-1 bg-transparent py-1.5 text-[12.5px] outline-none"
              />
            </div>
            <select
              value={courseKey}
              onChange={(event) => setCourseKey(event.target.value)}
              aria-label={ar ? "اختيار الدورة" : "Select course"}
              className="min-h-11 cursor-pointer rounded-lg border border-border bg-surface px-2.5 text-[12.5px] text-text"
            >
              <option value="">
                {ar
                  ? `اختر من ${shortlist.length} دورة…`
                  : `Choose from ${shortlist.length} courses…`}
              </option>
              {shortlist.map((entry) => (
                <option key={keyOf(entry)} value={keyOf(entry)}>
                  {entry.courseName} · {entry.rawCode || "—"} ·{" "}
                  {deliveryLabel(entry.deliveryType, lang)}
                </option>
              ))}
            </select>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-[11px] font-semibold text-text-muted">
              {ar ? "الدولة والعملة" : "Country and currency"}
            </legend>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  ["sa", ar ? "السعودية · ر.س" : "Saudi · SAR"],
                  ["eg", ar ? "مصر · ج.م" : "Egypt · EGP"],
                ] as const
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={market === value}
                  onClick={() => setMarket(value)}
                  className={`min-h-10 cursor-pointer rounded-lg border px-2 text-[12px] font-semibold transition-colors ${
                    market === value
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-border text-text-muted hover:bg-surface-2 hover:text-text"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset disabled={market === "eg"} className={market === "eg" ? "opacity-55" : ""}>
            <legend className="mb-1.5 text-[11px] font-semibold text-text-muted">
              {ar ? "طريقة الدفع" : "Payment method"}
            </legend>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  ["instalment", ar ? "تابي / تمارا" : "Tabby / Tamara", WalletCards],
                  ["cash", ar ? "كاش / كاشير" : "Cash / cashier", Banknote],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={payment === value}
                  onClick={() => setPayment(value)}
                  className={`flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed ${
                    payment === value
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-border text-text-muted hover:bg-surface-2 hover:text-text"
                  }`}
                >
                  <Icon size={14} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
            {market === "eg" && (
              <p className="mt-1.5 text-[10.5px] text-text-subtle">
                {ar
                  ? "أسعار مصر منشورة بسعر واحد لكل طرق الدفع."
                  : "Egypt is published at one price for every payment method."}
              </p>
            )}
          </fieldset>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-text-muted">
              {ar ? "حالة العميل" : "Customer situation"}
            </span>
            <select
              value={customerState}
              onChange={(event) => setCustomerState(event.target.value as CustomerState)}
              className="min-h-11 cursor-pointer rounded-lg border border-border bg-surface px-2.5 text-[12.5px] text-text"
            >
              <option value="standard">
                {ar ? "عميل جديد — لا اعتراض على السعر" : "New client — no price objection"}
              </option>
              <option value="discount">
                {ar ? "طلب خصمًا — التفاوض مسموح" : "Asked for a discount — negotiation allowed"}
              </option>
              <option value="approved_floor">
                {ar ? "استثناء معتمد من المدير" : "Manager-approved exception"}
              </option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-text-muted">
              {ar ? "السعر الذي يطلبه العميل (اختياري)" : "Price the customer is asking (optional)"}
            </span>
            <input
              value={asked}
              onChange={(event) => setAsked(event.target.value)}
              inputMode="decimal"
              placeholder={ar ? "مثال: 2400" : "e.g. 2400"}
              className="num min-h-11 rounded-lg border border-border bg-surface px-2.5 text-[13px] text-text"
            />
          </label>
        </aside>

        {/* --- the answer --------------------------------------------------- */}
        <div className="p-4 sm:p-6">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-52 rounded-lg" />
              <Skeleton className="h-20 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          ) : !selected ? (
            <EmptyState
              label={ar ? "اختر دورة ليظهر السعر المناسب" : "Pick a course to get a price"}
              hint={
                ar
                  ? "ابحث بالاسم أو الكود من العمود المجاور."
                  : "Search by name or code in the column beside this one."
              }
            />
          ) : !band || priceInQuestion === null ? (
            <EmptyState
              label={ar ? "لا يوجد سعر منشور لهذه الطريقة" : "No published price for this route"}
              hint={
                ar
                  ? "جرّب طريقة دفع أخرى، أو راجع قائمة الأسعار المنشورة لهذه الدورة."
                  : "Try the other payment route, or check the published price list for this course."
              }
            />
          ) : (
            <div className="space-y-4">
              {/* 1 — the number */}
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-text-muted">
                    {askedValue !== null
                      ? ar
                        ? "السعر الذي يطلبه العميل"
                        : "The price being asked"
                      : ar
                        ? "السعر المناسب لهذه الحالة"
                        : "The right price for this case"}
                  </p>
                  <div className="num mt-0.5 text-[34px] font-bold leading-none tracking-tight text-text sm:text-[40px]">
                    {fmtMoney(priceInQuestion, currency, lang)}
                  </div>
                  <p className="mt-1.5 truncate text-[11.5px] text-text-muted">
                    <bdi className="font-medium text-text">{selected.courseName}</bdi> ·{" "}
                    <bdi className="num">{selected.rawCode || "—"}</bdi> ·{" "}
                    {deliveryLabel(selected.deliveryType, lang)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void copyPrice()}
                  className="inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3.5 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: "var(--brand)" }}
                >
                  {copied ? (
                    <>
                      <Check size={15} aria-hidden="true" />
                      {ar ? "تم النسخ" : "Copied"}
                    </>
                  ) : (
                    <>
                      <Copy size={15} aria-hidden="true" />
                      {ar ? "نسخ السعر" : "Copy price"}
                    </>
                  )}
                </button>
              </div>

              {/* 2 — the room around it, 3 — the line not to cross */}
              <div className="rounded-lg border border-border bg-surface-2/50 p-3.5">
                <PriceRangeTrack
                  label={ar ? "النطاق المسموح" : "Allowed range"}
                  floor={floor}
                  ceiling={ceiling}
                  currency={currency}
                  marker={{
                    value: priceInQuestion,
                    tone: floor !== null && priceInQuestion < floor ? "breach" : "offer",
                    label:
                      askedValue !== null
                        ? ar
                          ? "سعر العميل"
                          : "asked price"
                        : ar
                          ? "السعر المقترح"
                          : "suggested price",
                  }}
                  note={
                    band.fixed
                      ? ar
                        ? "سعر ثابت لا يقبل التفاوض"
                        : "Fixed price, not negotiable"
                      : undefined
                  }
                />

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-2.5 text-[12px]">
                  <span className="flex items-center gap-1.5">
                    <span className="text-text-muted">{ar ? "لا تنزل عن" : "Never below"}</span>
                    <strong className="num" style={{ color: "var(--danger)" }}>
                      {floor === null ? "—" : fmtMoney(floor, currency, lang)}
                    </strong>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-text-muted">{ar ? "السعر الرسمي" : "List price"}</span>
                    <strong className="num text-text">
                      {ceiling === null ? "—" : fmtMoney(ceiling, currency, lang)}
                    </strong>
                  </span>
                </div>
              </div>

              {/* 4 — the verdict */}
              {verdict && (
                <div
                  className="flex items-start gap-2.5 rounded-lg px-3.5 py-3"
                  style={{
                    background: `var(${VERDICTS[verdict].soft})`,
                    boxShadow: `inset 0 0 0 1px color-mix(in oklab, var(${VERDICTS[verdict].color}) 25%, transparent)`,
                  }}
                >
                  {verdict === "safe" ? (
                    <ShieldCheck
                      size={18}
                      className="mt-px shrink-0"
                      style={{ color: `var(${VERDICTS[verdict].color})` }}
                      aria-hidden="true"
                    />
                  ) : verdict === "not_allowed" ? (
                    <CircleAlert
                      size={18}
                      className="mt-px shrink-0"
                      style={{ color: `var(${VERDICTS[verdict].color})` }}
                      aria-hidden="true"
                    />
                  ) : (
                    <TriangleAlert
                      size={18}
                      className="mt-px shrink-0"
                      style={{ color: `var(${VERDICTS[verdict].color})` }}
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0">
                    <p
                      className="text-[13px] font-bold"
                      style={{ color: `var(${VERDICTS[verdict].color})` }}
                    >
                      {VERDICTS[verdict][lang]}
                    </p>
                    {verdict === "not_allowed" && floor !== null && (
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-text">
                        {ar
                          ? `هذا السعر أقل من الحد الأدنى بـ ${fmtMoney(floor - priceInQuestion, currency, lang)}، وسيظهر في تقرير الالتزام كمخالفة.`
                          : `That is ${fmtMoney(floor - priceInQuestion, currency, lang)} under the floor and will appear in compliance reporting as a breach.`}
                      </p>
                    )}
                    {verdict === "above_list" && (
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-text">
                        {ar
                          ? "البيع أعلى من السعر الرسمي مسموح، لكنه يُسجَّل للمراجعة."
                          : "Selling above list is allowed, but it is recorded for review."}
                      </p>
                    )}
                    {verdict === "needs_approval" && (
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-text">
                        {ar
                          ? "وثّق الموافقة قبل إصدار الفاتورة."
                          : "Record the approval before the invoice is raised."}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* 5 — why */}
              {!!reasons.length && (
                <section>
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                    {ar ? "سبب الاقتراح" : "Why this price"}
                  </h3>
                  <ul className="mt-1.5 space-y-1">
                    {reasons.map((reason) => (
                      <li key={reason} className="flex gap-2 text-[12px] leading-relaxed text-text">
                        <span
                          aria-hidden="true"
                          className="mt-2 size-1 shrink-0 rounded-full bg-text-subtle"
                        />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* 6 — what the payment route did, 7 — what the offer does */}
              <div className="grid gap-3 sm:grid-cols-2">
                {otherBand && (
                  <section className="rounded-lg border border-border p-3">
                    <PriceRangeTrack
                      label={
                        payment === "cash"
                          ? ar
                            ? "لو دفع بالتقسيط"
                            : "If paid in instalments"
                          : ar
                            ? "لو دفع كاش"
                            : "If paid in cash"
                      }
                      floor={otherBand.floor}
                      ceiling={otherBand.ceiling}
                      currency="SAR"
                    />
                    {floor !== null && otherBand.floor !== null && otherBand.floor !== floor && (
                      <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">
                        {otherBand.floor > floor
                          ? ar
                            ? `الطريقة الأخرى ترفع الحد الأدنى بمقدار ${fmtMoney(otherBand.floor - floor, currency, lang)}.`
                            : `That route raises the floor by ${fmtMoney(otherBand.floor - floor, currency, lang)}.`
                          : ar
                            ? `طريقة الدفع الحالية رفعت الحد الأدنى بمقدار ${fmtMoney(floor - otherBand.floor, currency, lang)}.`
                            : `The current route raises the floor by ${fmtMoney(floor - otherBand.floor, currency, lang)}.`}
                      </p>
                    )}
                  </section>
                )}

                <section className="rounded-lg border border-border p-3">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
                    {ar ? "العرض الساري" : "Live offer"}
                  </h3>
                  {offers.length ? (
                    <ul className="mt-1.5 space-y-1.5">
                      {offers.map((offer) => (
                        <li key={offer.id} className="text-[12px] leading-relaxed">
                          <strong className="num" style={{ color: "var(--offer)" }}>
                            {fmtMoney(
                              offer.exact ?? offer.minimum ?? offer.maximum,
                              offer.currency,
                              lang,
                            )}
                          </strong>{" "}
                          <span className="text-text-muted">
                            {offer.validTo
                              ? ar
                                ? `حتى ${offer.validTo}`
                                : `until ${offer.validTo}`
                              : ar
                                ? "بدون تاريخ انتهاء"
                                : "no end date"}
                          </span>
                          {offer.note && (
                            <span className="block text-[11px] text-text-subtle">{offer.note}</span>
                          )}
                        </li>
                      ))}
                      <li className="text-[11px] leading-relaxed text-text-muted">
                        {ar
                          ? "البيع بسعر العرض معتمد ولا يُحتسب مخالفة."
                          : "Selling at the offer price is approved and is not counted as a breach."}
                      </li>
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-[11.5px] text-text-subtle">
                      {ar
                        ? `لا يوجد عرض ساري على هذه الدورة اليوم (${today()}).`
                        : `No offer is in force on this course today (${today()}).`}
                    </p>
                  )}
                </section>
              </div>

              {/* 8 — the one warning worth interrupting for */}
              {band.requiresReview && (
                <p
                  className="rounded-lg px-3 py-2 text-[11.5px] leading-relaxed"
                  style={{ background: "var(--warning-soft)", color: "var(--text)" }}
                >
                  {ar
                    ? "قائمة الأسعار تطلب مراجعة هذه الدورة قبل إعطاء أي خصم."
                    : "The price book asks for this course to be reviewed before any discount."}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
