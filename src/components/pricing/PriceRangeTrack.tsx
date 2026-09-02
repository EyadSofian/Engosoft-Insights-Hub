import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fmtMoney } from "./pricing-ui";

/**
 * The published price band for one payment route, drawn as a bullet chart.
 *
 * Read-only on purpose, and it has to *look* read-only. A slider with a
 * draggable handle would be the obvious thing to reach for here and it would be
 * wrong: nobody can change a published price from this screen, and a control
 * that invites a drag it will not honour is worse than a picture.
 *
 * What it encodes, following the bullet-graph convention (qualitative range
 * behind, featured measure on top, comparative measure as a tick):
 *
 *   range    the floor-to-ceiling band the seller may quote inside
 *   marker   one comparative price — the live offer, or the lowest price
 *            actually invoiced in the period when that fell under the floor
 *
 * Both ends carry their number in text, so the chart is never the only way to
 * read a value and the whole thing degrades to a legible line of figures.
 */

export interface TrackMarker {
  value: number;
  /** Drives colour and glyph; never colour alone. */
  tone: "offer" | "breach";
  label: string;
}

export function PriceRangeTrack({
  label,
  Icon,
  floor,
  ceiling,
  currency,
  marker,
  note,
}: {
  label: string;
  Icon?: LucideIcon;
  floor: number | null;
  ceiling: number | null;
  currency: string;
  marker?: TrackMarker;
  /** A short qualifier under the band: "سعر ثابت", "لا يوجد سعر معتمد". */
  note?: string;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";

  if (floor === null && ceiling === null) {
    return (
      <div className="min-w-0">
        <TrackLabel label={label} Icon={Icon} />
        <p className="mt-2 text-[11px] text-text-subtle">
          {note ?? (ar ? "لا يوجد سعر معتمد" : "No approved price")}
        </p>
      </div>
    );
  }

  const low = floor ?? ceiling!;
  const high = ceiling ?? floor!;
  const fixed = low === high;

  // The scale has to contain the marker as well as the band, otherwise a sale
  // below the floor — the single most important thing on this row — would be
  // drawn clamped to the edge and look like a sale *at* the floor.
  const values = [low, high, ...(marker ? [marker.value] : [])];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.14, Math.max(max * 0.04, 1));
  const from = min - pad;
  const span = max + pad - from || 1;
  const pct = (value: number) => ((value - from) / span) * 100;

  const markerTone =
    marker?.tone === "breach"
      ? { color: "var(--danger)", glyph: "▲" }
      : { color: "var(--offer)", glyph: "▲" };

  const reading = fixed
    ? ar
      ? `${label}: سعر ثابت ${fmtMoney(low, currency, lang)}`
      : `${label}: fixed at ${fmtMoney(low, currency, lang)}`
    : ar
      ? `${label}: من ${fmtMoney(low, currency, lang)} إلى ${fmtMoney(high, currency, lang)}`
      : `${label}: ${fmtMoney(low, currency, lang)} to ${fmtMoney(high, currency, lang)}`;

  return (
    <div className="min-w-0">
      <TrackLabel label={label} Icon={Icon} />

      <div
        role="img"
        aria-label={marker ? `${reading} — ${marker.label} ${marker.value}` : reading}
        className="mt-1.5"
      >
        {/* End values sit above their own ends of the band and stay in Latin
            digits in both languages, so two rows of figures line up. */}
        <div className="flex items-baseline justify-between gap-2 text-[11px] font-semibold">
          <span className="num text-text-muted">{fmtCompactMoney(low)}</span>
          {!fixed && <span className="num text-text">{fmtCompactMoney(high)}</span>}
        </div>

        <div className="relative mt-1 h-6">
          {/* the scale */}
          <div
            className="absolute inset-x-0 top-[7px] h-px"
            style={{ background: "var(--border)" }}
            aria-hidden="true"
          />
          {/* the allowed band */}
          <div
            className="absolute top-[3px] h-[9px] rounded-[3px]"
            style={{
              insetInlineStart: `${pct(low)}%`,
              width: fixed ? "3px" : `${pct(high) - pct(low)}%`,
              background: fixed
                ? "var(--text)"
                : "color-mix(in oklab, var(--brand) 34%, var(--surface))",
              borderInlineStart: fixed ? undefined : "2px solid var(--brand)",
              borderInlineEnd: fixed ? undefined : "2px solid var(--brand)",
            }}
            aria-hidden="true"
          />
          {marker && (
            /*
             * The marker positions itself with `inset-inline-start`, so it must
             * not carry `.num`: that class sets `direction: ltr` on its own box,
             * which turns "inline start" back into "left" and mirrored every
             * marker onto the wrong end of its own band in Arabic. The digits
             * get their Latin run from an inner span instead, and the centring
             * shift follows the page direction rather than assuming left.
             */
            <span
              className="absolute top-[13px] whitespace-nowrap text-[10px] font-bold leading-none"
              style={{
                insetInlineStart: `${pct(marker.value)}%`,
                transform: ar ? "translateX(50%)" : "translateX(-50%)",
                color: markerTone.color,
              }}
              aria-hidden="true"
            >
              <span className="block text-center text-[8px] leading-none">{markerTone.glyph}</span>
              <span className="num">{fmtCompactMoney(marker.value)}</span>
            </span>
          )}
        </div>
      </div>

      {(note || marker) && (
        <p className="mt-0.5 truncate text-[10px] leading-snug text-text-subtle">
          {note ?? marker?.label}
        </p>
      )}
    </div>
  );
}

function TrackLabel({ label, Icon }: { label: string; Icon?: LucideIcon }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
      {Icon && <Icon size={12} aria-hidden="true" />}
      <span className="truncate">{label}</span>
    </div>
  );
}

/**
 * The chart labels carry the figure without the currency: the currency is on
 * the row once, and repeating "ر.س" four times per row is what turns a
 * comparison into a wall.
 */
const fmtCompactMoney = (value: number): string =>
  value.toLocaleString("en-US", { maximumFractionDigits: Number.isInteger(value) ? 0 : 2 });
