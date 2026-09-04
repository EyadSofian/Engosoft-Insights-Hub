import { Tag, AlertTriangle } from "lucide-react";
import type { PriceCardMessage } from "../lib/nexus-message-schema";
import { formatDate, formatMoney, NOT_MEASURABLE } from "../lib/nexus-format";
import { SourceBadges } from "./SourceBadges";

/**
 * An authoritative price, exactly as PriceEngo returned it.
 *
 * THIS COMPONENT DOES NO ARITHMETIC. It does not add, discount, convert,
 * round beyond the currency's own minor unit, or derive a "before" price from a
 * promotion. Every one of those would be this dashboard inventing a commercial
 * figure, which is the single thing ENGO Nexus exists to prevent.
 *
 * A missing price renders the dash, never `0` and never a blank — a course that
 * has no published price is a real state, and "free" is not what it means.
 */
export function PriceCard({ message, lang }: { message: PriceCardMessage; lang: "ar" | "en" }) {
  const ar = lang === "ar";
  const price = formatMoney(message.effectivePrice, message.currency);
  const unavailable = message.available === false;

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-bg"
      data-testid="nexus-price-card"
    >
      <div className="flex items-start gap-3 border-b border-border bg-bg-subtle px-3 py-2.5">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
          <Tag className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text">{message.productName}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-muted">
            {message.deliveryMode && <span>{message.deliveryMode}</span>}
            {message.externalCode && <span className="num">#{message.externalCode}</span>}
            {message.market && <span>{message.market}</span>}
            {message.paymentMethod && <span>{message.paymentMethod}</span>}
          </p>
        </div>
      </div>

      <div className="px-3 py-3">
        <p
          className={`num text-2xl font-bold ${unavailable || price === NOT_MEASURABLE ? "text-text-muted" : "text-text"}`}
          data-testid="nexus-price-value"
        >
          {price}
        </p>

        {unavailable && (
          <p className="mt-1 text-xs text-text-muted">
            {ar ? "غير متاح على السوق ده حاليًا." : "Not available on this market right now."}
          </p>
        )}

        {message.promotion?.campaign && (
          <p className="mt-2 inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
            {message.promotion.campaign}
          </p>
        )}

        {(message.validUntil || message.promotion?.validUntil) && (
          <p className="mt-2 text-[11px] text-text-subtle">
            {ar ? "سارٍ حتى" : "Valid until"}{" "}
            <span className="num">
              {formatDate(message.validUntil ?? message.promotion?.validUntil, lang)}
            </span>
          </p>
        )}

        {message.warnings && message.warnings.length > 0 && (
          <ul className="mt-2 space-y-1">
            {message.warnings.map((warning) => (
              <li
                key={warning}
                className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400"
              >
                <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        )}

        <SourceBadges sources={message.sources} lang={lang} />
      </div>
    </div>
  );
}
