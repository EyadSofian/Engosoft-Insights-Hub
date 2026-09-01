import { useMemo, useState } from "react";
import { Banknote, CircleAlert, ShieldCheck, Sparkles, WalletCards } from "lucide-react";
import { Card, EmptyState, Pill } from "@/components/ui-bits";
import { useI18n } from "@/lib/i18n";
import { deliveryLabel, fmtMoney, type CatalogEntry, type CatalogPrice } from "./pricing-ui";

type PaymentChoice = "instalment" | "cash";
type CustomerState = "standard" | "discount" | "approved_floor";

const valueOf = (price: CatalogPrice, side: "floor" | "ceiling") =>
  side === "floor"
    ? (price.minimum ?? price.exact ?? price.maximum)
    : (price.maximum ?? price.exact ?? price.minimum);

const round25 = (value: number) => Math.round(value / 25) * 25;

function PriceTrack({
  floor,
  ceiling,
  suggested,
}: {
  floor: number;
  ceiling: number;
  suggested: number;
}) {
  const width = Math.max(ceiling - floor, 1);
  const marker = Math.max(0, Math.min(100, ((suggested - floor) / width) * 100));
  return (
    <div className="pt-7">
      <div className="relative h-2 rounded-full bg-brand/20">
        <div className="absolute inset-0 rounded-full bg-gradient-to-l from-brand/65 to-brand/20" />
        <span className="absolute -top-6 start-0 text-[11px] font-bold tabular-nums text-danger">
          {floor.toLocaleString("en-US")}
        </span>
        <span className="absolute -top-6 end-0 text-[11px] font-bold tabular-nums text-text">
          {ceiling.toLocaleString("en-US")}
        </span>
        <span
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-success shadow"
          style={{ left: `${marker}%` }}
        />
      </div>
    </div>
  );
}

export function PriceAdvisorTab({ entries }: { entries?: CatalogEntry[] }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [entryKey, setEntryKey] = useState("");
  const [payment, setPayment] = useState<PaymentChoice>("instalment");
  const [customerState, setCustomerState] = useState<CustomerState>("standard");

  const options = useMemo(
    () =>
      (entries ?? [])
        .filter((entry) => !entry.onHold)
        .map((entry) => ({
          key: `${entry.code}::${entry.deliveryType}::${entry.subcategory}::${entry.level}`,
          entry,
        }))
        .sort((a, b) => a.entry.courseName.localeCompare(b.entry.courseName)),
    [entries],
  );
  const selected = options.find((option) => option.key === entryKey)?.entry ?? null;

  const recommendation = useMemo(() => {
    if (!selected) return null;
    const methods = payment === "cash" ? ["cash", "cashier"] : ["tabby", "tamara"];
    const candidates = selected.prices.filter(
      (price) =>
        price.active &&
        price.scope === "individual" &&
        price.currency === "SAR" &&
        methods.includes(price.paymentMethod),
    );
    const floors = candidates
      .map((price) => valueOf(price, "floor"))
      .filter((value): value is number => value !== null);
    const ceilings = candidates
      .map((price) => valueOf(price, "ceiling"))
      .filter((value): value is number => value !== null);
    if (!floors.length || !ceilings.length) return null;
    const floor = Math.min(...floors);
    const ceiling = Math.max(...ceilings);
    const step = Math.max(25, round25((ceiling - floor) / 3));
    const suggested =
      customerState === "standard"
        ? ceiling
        : customerState === "approved_floor"
          ? floor
          : Math.max(floor, round25(ceiling - step));
    return { floor, ceiling, suggested, currency: "SAR" };
  }, [customerState, payment, selected]);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <Sparkles size={18} className="text-warning" aria-hidden="true" />
        <div>
          <h2 className="text-[16px] font-bold text-text">
            {ar ? "اقتراح سعر البيع" : "Sales price recommendation"}
          </h2>
          <p className="mt-1 text-[11px] text-text-muted">
            {ar
              ? "الاقتراح يبدأ من أعلى سعر منشور وينزل بخطوة واحدة عند الحاجة، ولا يتجاوز الحد الأدنى."
              : "The recommendation starts at the published ceiling, steps down once when needed, and never crosses the floor."}
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(300px,0.75fr)_minmax(0,1.5fr)]">
        <div className="space-y-4 border-b border-border p-5 lg:border-b-0 lg:border-e">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-text-muted">
              {ar ? "الدورة" : "Course"}
            </span>
            <select
              value={entryKey}
              onChange={(event) => setEntryKey(event.target.value)}
              className="min-h-12 rounded-xl border border-border bg-surface px-3 text-[13px] text-text"
            >
              <option value="">{ar ? "اختر دورة…" : "Choose a course…"}</option>
              {options.map(({ key, entry }) => (
                <option key={key} value={key}>
                  {entry.courseName} · {entry.rawCode || "—"} ·{" "}
                  {deliveryLabel(entry.deliveryType, lang)}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend className="mb-2 text-[11px] font-semibold text-text-muted">
              {ar ? "طريقة الدفع" : "Payment method"}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["instalment", ar ? "تابي / تمارا" : "Tabby / Tamara", WalletCards],
                  ["cash", ar ? "كاش / كاشير" : "Cash / cashier", Banknote],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setPayment(value)}
                  className={`min-h-20 rounded-xl border p-3 text-start transition ${
                    payment === value
                      ? "border-brand bg-brand-soft/55 text-brand ring-1 ring-brand/20"
                      : "border-border text-text hover:bg-surface-2"
                  }`}
                >
                  <Icon size={17} aria-hidden="true" />
                  <span className="mt-2 block text-[12px] font-bold">{label}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-text-muted">
              {ar ? "حالة العميل" : "Customer situation"}
            </span>
            <select
              value={customerState}
              onChange={(event) => setCustomerState(event.target.value as CustomerState)}
              className="min-h-12 rounded-xl border border-border bg-surface px-3 text-[13px] text-text"
            >
              <option value="standard">
                {ar ? "عميل جديد — لا اعتراض على السعر" : "New client — no price objection"}
              </option>
              <option value="discount">
                {ar ? "طلب خصم — تفاوض مسموح" : "Asked for a discount — negotiation allowed"}
              </option>
              <option value="approved_floor">
                {ar ? "استثناء معتمد من المدير" : "Manager-approved exception"}
              </option>
            </select>
          </label>
        </div>

        <div className="p-5 sm:p-7">
          {!selected ? (
            <EmptyState
              label={
                ar ? "اختر دورة لعرض السعر المقترح" : "Choose a course to see a recommendation"
              }
            />
          ) : !recommendation ? (
            <EmptyState
              label={
                ar
                  ? "لا يوجد سعر ريال منشور لهذه الطريقة"
                  : "No published SAR price for this method"
              }
            />
          ) : (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <Pill tone="brand">#{selected.rawCode || "—"}</Pill>
                  <h3 className="mt-2 text-[17px] font-bold text-text">{selected.courseName}</h3>
                  <p className="mt-1 text-[11px] text-text-muted">
                    {deliveryLabel(selected.deliveryType, lang)} ·{" "}
                    {payment === "cash"
                      ? ar
                        ? "كاش / كاشير"
                        : "Cash / cashier"
                      : ar
                        ? "تابي / تمارا"
                        : "Tabby / Tamara"}
                  </p>
                </div>
                <div className="text-end">
                  <div className="text-[11px] font-semibold text-text-muted">
                    {ar ? "السعر المقترح" : "Recommended price"}
                  </div>
                  <div className="mt-1 text-[36px] font-black tabular-nums text-text">
                    {fmtMoney(recommendation.suggested, recommendation.currency, lang)}
                  </div>
                </div>
              </div>

              <div className="mt-7 rounded-2xl border border-border bg-surface-2/55 px-5 py-4">
                <PriceTrack
                  floor={recommendation.floor}
                  ceiling={recommendation.ceiling}
                  suggested={recommendation.suggested}
                />
                <div className="mt-5 grid gap-2 text-[12px] sm:grid-cols-2">
                  <div className="rounded-xl bg-surface px-3 py-2">
                    <span className="text-text-muted">{ar ? "الحد الأدنى" : "Floor"}</span>
                    <strong className="ms-2 tabular-nums text-danger">
                      {fmtMoney(recommendation.floor, recommendation.currency, lang)}
                    </strong>
                  </div>
                  <div className="rounded-xl bg-surface px-3 py-2">
                    <span className="text-text-muted">
                      {ar ? "السقف المنشور" : "Published ceiling"}
                    </span>
                    <strong className="ms-2 tabular-nums text-text">
                      {fmtMoney(recommendation.ceiling, recommendation.currency, lang)}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-xl border border-danger/20 bg-danger-soft/45 p-3 text-[12px] leading-relaxed text-text">
                {customerState === "approved_floor" ? (
                  <ShieldCheck
                    size={17}
                    className="mt-0.5 shrink-0 text-success"
                    aria-hidden="true"
                  />
                ) : (
                  <CircleAlert
                    size={17}
                    className="mt-0.5 shrink-0 text-danger"
                    aria-hidden="true"
                  />
                )}
                <p>
                  {ar
                    ? `لا تُغلق الصفقة تحت ${fmtMoney(recommendation.floor, recommendation.currency, lang)}. أي سعر أقل يحتاج موافقة موثقة وسيظهر تلقائيًا في تقرير الالتزام.`
                    : `Do not close below ${fmtMoney(recommendation.floor, recommendation.currency, lang)}. Anything lower needs documented approval and will appear in compliance reporting.`}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
