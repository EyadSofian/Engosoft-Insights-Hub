import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { NexusProductVariant } from "../lib/nexus-message-schema";
import { formatMoney, formatCount, formatPercent } from "../lib/nexus-format";
import { TABLE_INITIAL_ROWS, TABLE_PAGE_SIZE, moreControl } from "../lib/nexus-layout";
import { LtrText } from "./LtrText";

const L = {
  ar: {
    code: "الكود",
    invoices: "الفواتير",
    revenue: "المحصل",
    share: "الحصة",
    price: "السعر الحالي",
    campaigns: "الحملات اللي باعته",
    product: "المنتج",
  },
  en: {
    code: "Code",
    invoices: "Invoices",
    revenue: "Collected",
    share: "Share",
    price: "Current price",
    campaigns: "Campaigns selling it",
    product: "Product",
  },
} as const;

/**
 * One sold variant.
 *
 * No ROAS anywhere on this card, by design: ad spend attaches to a campaign and
 * a campaign sells several variants, so a per-variant return would be invented.
 * The two actions are the ones that follow naturally — its current price, and
 * which campaigns sold it.
 */
export function ProductVariantCard({
  product,
  lang,
  onSend,
  disabled,
}: {
  product: NexusProductVariant;
  lang: "ar" | "en";
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const t = L[lang];
  const figures: Array<[string, string]> = [
    [t.invoices, formatCount(product.invoices)],
    [t.revenue, formatMoney(product.revenue, "USD")],
    [t.share, product.revenueShare === null ? "—" : formatPercent(product.revenueShare * 100)],
  ];

  return (
    <article
      className="min-w-0 rounded-lg border border-border bg-surface p-3"
      data-testid="nexus-product-card"
    >
      <h4 className="truncate text-sm font-semibold text-text">
        <LtrText>{product.displayName}</LtrText>
      </h4>
      {product.productCode ? (
        <p className="mt-0.5 text-[11px] text-text-muted">
          {t.code} <LtrText className="num">{product.productCode}</LtrText>
        </p>
      ) : null}

      <dl className="mt-2 grid grid-cols-3 gap-2">
        {figures.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="truncate text-[10px] text-text-muted">{label}</dt>
            <dd className="num text-sm font-semibold text-text">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onSend(
              lang === "ar"
                ? `سعر ${product.displayName} دلوقتي في السعودية كاش؟`
                : `Current Saudi cash price for ${product.displayName}?`,
            )
          }
          className="rounded border border-border px-2 py-1 text-[11px] font-medium text-text hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        >
          {t.price}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onSend(
              lang === "ar"
                ? `أنهي حملات باعت ${product.displayName}؟`
                : `Which campaigns sold ${product.displayName}?`,
            )
          }
          className="rounded border border-border px-2 py-1 text-[11px] font-medium text-text hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        >
          {t.campaigns}
        </button>
      </div>
    </article>
  );
}

/** Four to eight variants, swiped rather than stacked. */
export function ProductCarousel({
  products,
  lang,
  onSend,
  disabled,
}: {
  products: NexusProductVariant[];
  lang: "ar" | "en";
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const scroll = (direction: 1 | -1) => {
    const node = track.current;
    if (!node) return;
    node.scrollBy({ left: direction * node.clientWidth * 0.85, behavior: "smooth" });
  };
  const labels =
    lang === "ar"
      ? { prev: "المنتجات السابقة", next: "المنتجات التالية" }
      : { prev: "Previous products", next: "Next products" };

  return (
    <div className="relative" data-testid="nexus-product-carousel">
      <div
        ref={track}
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {products.map((product) => (
          <div
            key={product.productId ?? product.displayName}
            className="w-[85%] shrink-0 snap-start sm:w-[48%] lg:w-[32%]"
          >
            <ProductVariantCard product={product} lang={lang} onSend={onSend} disabled={disabled} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-end gap-1">
        <button
          type="button"
          onClick={() => scroll(-1)}
          aria-label={labels.prev}
          className="rounded border border-border p-1 text-text-muted hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => scroll(1)}
          aria-label={labels.next}
          className="rounded border border-border p-1 text-text-muted hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** Nine or more variants: a compact list, revealed a page at a time. */
export function ProductTable({
  products,
  lang,
  onSend,
  disabled,
}: {
  products: NexusProductVariant[];
  lang: "ar" | "en";
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const t = L[lang];
  const [visible, setVisible] = useState(TABLE_INITIAL_ROWS);
  const rows = products.slice(0, visible);
  const more = moreControl(products.length, visible, lang);

  return (
    <div data-testid="nexus-product-table">
      <ul>
        {rows.map((product) => (
          <li
            key={product.productId ?? product.displayName}
            className="border-t border-border py-2"
          >
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onSend(
                  lang === "ar"
                    ? `سعر ${product.displayName} دلوقتي في السعودية كاش؟`
                    : `Current Saudi cash price for ${product.displayName}?`,
                )
              }
              className="w-full text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="block truncate text-xs font-medium text-text">
                <LtrText>{product.displayName}</LtrText>
              </span>
              <span className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-text-muted">
                <span className="num">
                  {t.revenue} {formatMoney(product.revenue, "USD")}
                </span>
                <span className="num">
                  {t.invoices} {formatCount(product.invoices)}
                </span>
                {product.revenueShare === null ? null : (
                  <span className="num">
                    {t.share} {formatPercent(product.revenueShare * 100)}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {more.show ? (
        <button
          type="button"
          onClick={() => setVisible((value) => value + TABLE_PAGE_SIZE)}
          className="mt-1.5 rounded text-xs font-medium text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          data-testid="nexus-product-more"
        >
          {more.label}
        </button>
      ) : null}
    </div>
  );
}
