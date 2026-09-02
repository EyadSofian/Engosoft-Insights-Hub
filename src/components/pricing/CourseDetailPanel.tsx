import { Banknote, BadgePercent, Gift, Lock, OctagonMinus, WalletCards } from "lucide-react";
import { DetailPanel, DetailSection, DetailStat } from "@/components/DetailPanel";
import { EmptyState, Notice, Pill } from "@/components/ui-bits";
import { fmtDate, fmtNum, useI18n } from "@/lib/i18n";
import { PriceRangeTrack } from "./PriceRangeTrack";
import { RowStatusBadge } from "./StatusBadge";
import {
  auditReasonLabel,
  bandText,
  deliveryLabel,
  fmtMoney,
  methodLabel,
  scopeLabel,
  type AuditRow,
  type CatalogEntry,
  type PriceBookSummary,
} from "./pricing-ui";
import {
  activeOffers,
  bundleNameOf,
  cashBand,
  egyptBand,
  incentiveRules,
  instalmentBand,
  type PriceMode,
} from "./course-pricing";

/**
 * Everything about one course that does not earn a place in the row.
 *
 * Ordered by the question it answers: what may it sell for, where does that
 * number come from, what is running on it right now, and what went wrong.
 */
export function CourseDetailPanel({
  entry,
  mode,
  book,
  breachRows,
  canWrite,
  onOpenInvoices,
  onClose,
  specializationLabel,
  packageLabel,
}: {
  entry: CatalogEntry | null;
  mode: PriceMode;
  book: PriceBookSummary | null;
  /** The period's audit rows for this course, breaches first. */
  breachRows: AuditRow[];
  canWrite: boolean;
  onOpenInvoices: (productCode: string) => void;
  onClose: () => void;
  specializationLabel: (value: string) => string;
  packageLabel: (value: string) => string;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  if (!entry) return null;

  const cash = cashBand(entry, mode);
  const instalment = instalmentBand(entry, mode);
  const egypt = egyptBand(entry, mode);
  const offers = activeOffers(entry);
  const incentives = incentiveRules(entry);
  const rules = entry.prices.filter((price) => price.active);
  const title =
    mode === "package"
      ? `${ar ? "باقة" : "Package"} ${packageLabel(bundleNameOf(entry) || entry.courseName)}`
      : entry.courseName;

  return (
    <DetailPanel
      open
      onClose={onClose}
      eyebrow={
        <>
          <span className="num rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-bold text-text-muted">
            <bdi>{entry.rawCode || "—"}</bdi>
          </span>
          <Pill tone="neutral">{deliveryLabel(entry.deliveryType, lang)}</Pill>
          {entry.onHold && (
            <Pill tone="danger">{ar ? "موقوف — ممنوع البيع" : "On hold — do not sell"}</Pill>
          )}
          {entry.requiresReview && (
            <Pill tone="warning">{ar ? "يحتاج مراجعة" : "Needs review"}</Pill>
          )}
        </>
      }
      title={<bdi>{title}</bdi>}
      subtitle={`${specializationLabel(entry.specialization)}${entry.subcategory ? ` · ${entry.subcategory}` : ""}`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onOpenInvoices(entry.rawCode || entry.code)}
            className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold text-white"
            style={{ background: "var(--brand)" }}
          >
            {ar ? "عرض فواتير هذه الدورة" : "Show this course's invoices"}
          </button>
          {!canWrite && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-text-subtle">
              <Lock size={13} aria-hidden="true" />
              {ar ? "تعديل الأسعار يحتاج صلاحية" : "Editing prices needs permission"}
            </span>
          )}
        </div>
      }
    >
      {entry.onHold && (
        <Notice tone="danger" icon={<OctagonMinus size={16} aria-hidden="true" />}>
          {ar
            ? "هذه الدورة موقوفة في قائمة الأسعار المنشورة ولا يجوز بيعها حتى تُعاد."
            : "This course is suspended in the published price book and must not be sold."}
        </Notice>
      )}

      <DetailSection title={ar ? "النطاق المسموح" : "Allowed range"}>
        <div className="space-y-3.5 rounded-xl border border-border bg-surface-2/45 px-3.5 py-3">
          <PriceRangeTrack
            label={ar ? "كاش / كاشير" : "Cash"}
            Icon={Banknote}
            floor={cash?.floor ?? null}
            ceiling={cash?.ceiling ?? null}
            currency={cash?.currency ?? "SAR"}
            note={cash?.fixed ? (ar ? "سعر ثابت" : "Fixed price") : undefined}
          />
          <PriceRangeTrack
            label={ar ? "تابي / تمارا" : "Tabby / Tamara"}
            Icon={WalletCards}
            floor={instalment?.floor ?? null}
            ceiling={instalment?.ceiling ?? null}
            currency={instalment?.currency ?? "SAR"}
            note={instalment?.fixed ? (ar ? "سعر ثابت" : "Fixed price") : undefined}
          />
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <DetailStat
            label={ar ? "لا تنزل عن" : "Never below"}
            value={cash ? fmtMoney(cash.floor, cash.currency, lang) : "—"}
            tone="danger"
          />
          <DetailStat
            label={ar ? "السعر المقترح" : "Suggested price"}
            value={cash ? fmtMoney(cash.ceiling, cash.currency, lang) : "—"}
          />
          <DetailStat
            label={ar ? "السعر المصري" : "Egypt price"}
            value={egypt ? fmtMoney(egypt.floor, egypt.currency, lang) : "—"}
            tone="muted"
          />
          <DetailStat
            label={ar ? "مخالفات الفترة" : "Breaches this period"}
            value={fmtNum(breachRows.filter((r) => r.complianceStatus === "below_minimum").length)}
            tone={breachRows.length ? "danger" : "muted"}
          />
        </div>
      </DetailSection>

      {!!offers.length && (
        <DetailSection title={ar ? "العروض السارية" : "Live offers"}>
          <ul className="space-y-1.5">
            {offers.map((offer) => (
              <li
                key={offer.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-[12px]"
                style={{ background: "var(--offer-soft)", color: "var(--offer)" }}
              >
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <BadgePercent size={13} aria-hidden="true" />
                  {offer.note || (ar ? "عرض معتمد" : "Approved offer")}
                </span>
                <span className="num font-bold">{bandText(offer, lang)}</span>
                {offer.validTo && (
                  <span className="num w-full text-[10.5px] opacity-80">
                    {ar ? "ينتهي في" : "Ends"} {fmtDate(offer.validTo, lang)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </DetailSection>
      )}

      {!!incentives.length && (
        <DetailSection title={ar ? "حافز البيع" : "Sales incentive"}>
          <ul className="space-y-1.5">
            {incentives.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-[12px]"
              >
                <span className="inline-flex items-center gap-1.5 text-text-muted">
                  <Gift size={13} aria-hidden="true" style={{ color: "var(--success)" }} />
                  {rule.note || (ar ? "حافز عند البيع بالسعر الكامل" : "Incentive at full price")}
                </span>
                <strong className="num" style={{ color: "var(--success)" }}>
                  {bandText(rule, lang)}
                </strong>
              </li>
            ))}
          </ul>
        </DetailSection>
      )}

      <DetailSection title={ar ? "المخالفات في هذه الفترة" : "Breaches in this period"}>
        {breachRows.length ? (
          <ul className="space-y-2">
            {breachRows.slice(0, 8).map((row) => (
              <li key={row.invoiceLineId} className="rounded-lg border border-border px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="num text-[12px] font-bold text-text">
                    <bdi>{row.invoiceNumber}</bdi>
                  </span>
                  <RowStatusBadge row={row} />
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                  {auditReasonLabel(row, lang)}
                </p>
                <p className="num mt-1 text-[10.5px] text-text-subtle">
                  {row.salesperson || (ar ? "بدون موظف" : "No salesperson")} ·{" "}
                  {methodLabel(row.paymentMethod, lang)} ·{" "}
                  {row.paymentDate || row.invoiceDate || row.saleDate || "—"}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            compact
            label={ar ? "لا توجد مخالفات على هذه الدورة" : "No breaches on this course"}
            hint={
              ar
                ? "كل ما بيع من هذه الدورة في الفترة المحددة كان داخل النطاق المعتمد."
                : "Everything sold in the selected period stayed inside the approved range."
            }
          />
        )}
      </DetailSection>

      <DetailSection title={ar ? "مصدر السعر" : "Where the price comes from"}>
        <div className="rounded-lg border border-border bg-surface-2/45 px-3 py-2.5 text-[11.5px] leading-relaxed text-text-muted">
          {book ? (
            <>
              <div>
                <span className="text-text-subtle">{ar ? "القائمة" : "Price book"}: </span>
                <bdi className="font-semibold text-text">{book.sourceName || book.name}</bdi>{" "}
                <span className="num">v{book.version}</span>
              </div>
              <div className="num mt-0.5">
                <span className="text-text-subtle">{ar ? "سارية من" : "Effective from"}: </span>
                {fmtDate(book.effectiveFrom, lang)}
              </div>
              <p className="mt-1.5 text-[10.5px] text-text-subtle">
                {ar
                  ? "القائمة المنشورة لا تُعدّل؛ أي تغيير ينشئ نسخة جديدة، فتبقى فاتورة قديمة محكومة بسعر وقتها."
                  : "A published book is never edited; a change makes a new version, so an old invoice keeps being judged against the price of its own day."}
              </p>
            </>
          ) : (
            <span>{ar ? "لا توجد قائمة أسعار منشورة." : "No published price book."}</span>
          )}
        </div>

        <ul className="mt-2 space-y-1.5">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2 text-[11.5px]"
            >
              <span className="flex flex-wrap items-center gap-1.5">
                <Pill tone={rule.scope === "offer" ? "warning" : "neutral"}>
                  {scopeLabel(rule.scope, lang)}
                </Pill>
                <span className="text-text-muted">{methodLabel(rule.paymentMethod, lang)}</span>
                <span className="num text-text-subtle">{rule.currency}</span>
              </span>
              <strong className="num text-text">{bandText(rule, lang)}</strong>
              <span className="num w-full text-[10px] text-text-subtle">
                {ar ? "الصف" : "row"} {rule.sourceRow}
                {rule.sourceSheet ? ` · ${rule.sourceSheet}` : ""}
                {rule.validFrom ? ` · ${ar ? "من" : "from"} ${fmtDate(rule.validFrom, lang)}` : ""}
                {rule.validTo ? ` · ${ar ? "حتى" : "to"} ${fmtDate(rule.validTo, lang)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </DetailSection>
    </DetailPanel>
  );
}
