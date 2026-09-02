import { Banknote, BadgePercent, ChevronLeft, OctagonMinus, WalletCards } from "lucide-react";
import { Pill } from "@/components/ui-bits";
import { fmtDate, fmtNum, useI18n } from "@/lib/i18n";
import { PriceRangeTrack, type TrackMarker } from "./PriceRangeTrack";
import { deliveryLabel, fmtMoney, type CatalogEntry } from "./pricing-ui";
import {
  activeOffers,
  bundleNameOf,
  cashBand,
  egyptBand,
  instalmentBand,
  type CourseBreachSummary,
  type PriceMode,
} from "./course-pricing";

/**
 * One course, as a row rather than a card.
 *
 * A card per course gave four courses a screen and made the one question this
 * page exists to answer — is this course priced like its neighbours? — a
 * memory test. A row puts the two payment routes side by side on a shared
 * scale, so the comparison is vertical and free.
 *
 * Three regions, always in the same order: who the course is, what it may sell
 * for, and whether anything is wrong with it. Everything else is one press away
 * in the detail panel.
 */

export interface CourseRowProps {
  entry: CatalogEntry;
  mode: PriceMode;
  breaches?: CourseBreachSummary;
  inForceSince: string;
  onOpen: () => void;
  specializationLabel: string;
  packageLabel: (value: string) => string;
}

export function CourseListRow(props: CourseRowProps) {
  const { entry, mode, breaches, inForceSince, onOpen, specializationLabel, packageLabel } = props;
  const { lang } = useI18n();
  const ar = lang === "ar";

  const cash = cashBand(entry, mode);
  const instalment = instalmentBand(entry, mode);
  const egypt = egyptBand(entry, mode);
  const offers = activeOffers(entry);
  const title =
    mode === "package"
      ? `${ar ? "باقة" : "Package"} ${packageLabel(bundleNameOf(entry) || entry.courseName)}`
      : entry.courseName;

  const cashMarker = markerFor(cash?.floor ?? null, offers[0]?.exact ?? null, breaches, ar);
  const instalmentMarker = markerFor(instalment?.floor ?? null, null, breaches, ar);

  return (
    <div className="group grid gap-x-4 gap-y-3 border-b border-border px-3 py-3 transition-colors last:border-b-0 hover:bg-surface-2/60 sm:px-4 xl:grid-cols-[minmax(220px,1.5fr)_minmax(150px,1fr)_minmax(150px,1fr)_minmax(96px,0.55fr)_minmax(150px,auto)] xl:items-center">
      {/* 1 — identity */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="num rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-bold text-text-muted">
            <bdi>{entry.rawCode || "—"}</bdi>
          </span>
          <span className="text-[10.5px] font-medium text-text-subtle">
            {deliveryLabel(entry.deliveryType, lang)}
          </span>
          {mode === "package" && <Pill tone="warning">{ar ? "باقة" : "Package"}</Pill>}
          {entry.onHold && (
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-bold"
              style={{ background: "var(--danger-soft)", color: "var(--danger)" }}
            >
              <OctagonMinus size={11} aria-hidden="true" />
              {ar ? "موقوف" : "On hold"}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onOpen}
          className="mt-1 block w-full cursor-pointer text-start text-[13px] font-bold leading-snug text-text hover:text-brand"
        >
          <bdi className="line-clamp-2">{title}</bdi>
        </button>

        <p className="mt-0.5 truncate text-[10.5px] text-text-subtle">
          {specializationLabel}
          {entry.subcategory ? ` · ${entry.subcategory}` : ""}
          {inForceSince
            ? ` · ${ar ? "ساري من" : "in force since"} ${fmtDate(inForceSince, lang)}`
            : ""}
        </p>
      </div>

      {/* 2 — the two payment routes, on the same visual scale */}
      <PriceRangeTrack
        label={ar ? "كاش / كاشير" : "Cash"}
        Icon={Banknote}
        floor={cash?.floor ?? null}
        ceiling={cash?.ceiling ?? null}
        currency={cash?.currency ?? "SAR"}
        marker={cashMarker}
        note={cash?.fixed ? (ar ? "سعر ثابت" : "Fixed price") : undefined}
      />
      <PriceRangeTrack
        label={ar ? "تابي / تمارا" : "Tabby / Tamara"}
        Icon={WalletCards}
        floor={instalment?.floor ?? null}
        ceiling={instalment?.ceiling ?? null}
        currency={instalment?.currency ?? "SAR"}
        marker={instalmentMarker}
        note={instalment?.fixed ? (ar ? "سعر ثابت" : "Fixed price") : undefined}
      />

      {/* 3 — the second currency, quoted as published rather than converted */}
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
          {ar ? "مصر" : "Egypt"}
        </div>
        <div className="num mt-1 truncate text-[12.5px] font-bold text-text">
          {egypt ? fmtMoney(egypt.floor, egypt.currency, lang) : "—"}
        </div>
        {!egypt && (
          <p className="text-[10px] text-text-subtle">{ar ? "لا سعر مصري" : "No EGP price"}</p>
        )}
      </div>

      {/* 4 — status and the way in */}
      <div className="flex items-center justify-between gap-2 xl:justify-end">
        <div className="flex flex-wrap items-center gap-1.5">
          {!!offers.length && (
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-bold"
              style={{ background: "var(--offer-soft)", color: "var(--offer)" }}
            >
              <BadgePercent size={11} aria-hidden="true" />
              {ar ? "عرض ساري" : "Live offer"}
            </span>
          )}
          {!!breaches?.breaches && (
            <span
              className="num inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-bold"
              style={{ background: "var(--danger-soft)", color: "var(--danger)" }}
            >
              {fmtNum(breaches.breaches)} {ar ? "مخالفة" : "breaches"}
            </span>
          )}
          {!offers.length && !breaches?.breaches && !entry.onHold && (
            <span className="text-[10.5px] text-text-subtle">{ar ? "لا ملاحظات" : "Clean"}</span>
          )}
        </div>

        <button
          type="button"
          onClick={onOpen}
          className="inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-semibold text-text-muted transition-colors hover:border-brand hover:bg-brand-soft hover:text-brand"
        >
          {ar ? "التفاصيل" : "Details"}
          <ChevronLeft size={13} aria-hidden="true" className="ltr:rotate-180" />
        </button>
      </div>
    </div>
  );
}

/**
 * The comparative measure on the band.
 *
 * A sale under the floor outranks a live offer: the offer is information, the
 * breach is the thing somebody has to act on, and only one marker fits.
 */
function markerFor(
  floor: number | null,
  offerPrice: number | null,
  breaches: CourseBreachSummary | undefined,
  ar: boolean,
): TrackMarker | undefined {
  if (breaches && floor !== null && breaches.worstSold < floor) {
    return {
      value: breaches.worstSold,
      tone: "breach",
      label: ar ? "أقل سعر مُباع" : "Lowest price sold",
    };
  }
  if (offerPrice !== null) {
    return { value: offerPrice, tone: "offer", label: ar ? "سعر العرض" : "Offer price" };
  }
  return undefined;
}

/* --- phone ---------------------------------------------------------------- */

/**
 * The same row on a phone.
 *
 * A five-region grid cannot survive 390px, and a table with a sideways scroll
 * would hide the very columns being compared. So it becomes a compact list row
 * carrying the four values somebody checks — code, the two floors, the state —
 * and everything else moves into the sheet.
 */
export function CourseCompactRow(props: CourseRowProps) {
  const { entry, mode, breaches, onOpen, specializationLabel, packageLabel } = props;
  const { lang } = useI18n();
  const ar = lang === "ar";

  const cash = cashBand(entry, mode);
  const instalment = instalmentBand(entry, mode);
  const offers = activeOffers(entry);
  const title =
    mode === "package"
      ? `${ar ? "باقة" : "Package"} ${packageLabel(bundleNameOf(entry) || entry.courseName)}`
      : entry.courseName;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full cursor-pointer border-b border-border px-3 py-3 text-start last:border-b-0 active:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="num rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-text-muted">
              <bdi>{entry.rawCode || "—"}</bdi>
            </span>
            <span className="text-[10px] font-medium text-text-subtle">
              {deliveryLabel(entry.deliveryType, lang)}
            </span>
            {entry.onHold && (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                style={{ background: "var(--danger-soft)", color: "var(--danger)" }}
              >
                {ar ? "موقوف" : "On hold"}
              </span>
            )}
          </div>
          <h3 className="mt-1 line-clamp-2 text-[12.5px] font-bold leading-snug text-text">
            <bdi>{title}</bdi>
          </h3>
          <p className="mt-0.5 truncate text-[10px] text-text-subtle">{specializationLabel}</p>
        </div>
        <ChevronLeft
          size={16}
          className="mt-1 shrink-0 text-text-subtle ltr:rotate-180"
          aria-hidden="true"
        />
      </div>

      <dl className="mt-2.5 grid grid-cols-2 gap-2">
        <MiniBand
          label={ar ? "كاش" : "Cash"}
          band={cash ? `${fmtMoney(cash.floor, cash.currency, lang)}` : "—"}
          hint={
            cash && !cash.fixed
              ? `${ar ? "حتى" : "up to"} ${fmtMoney(cash.ceiling, cash.currency, lang)}`
              : undefined
          }
        />
        <MiniBand
          label={ar ? "تابي / تمارا" : "Tabby / Tamara"}
          band={instalment ? `${fmtMoney(instalment.floor, instalment.currency, lang)}` : "—"}
          hint={
            instalment && !instalment.fixed
              ? `${ar ? "حتى" : "up to"} ${fmtMoney(instalment.ceiling, instalment.currency, lang)}`
              : undefined
          }
        />
      </dl>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {!!offers.length && (
          <span
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold"
            style={{ background: "var(--offer-soft)", color: "var(--offer)" }}
          >
            <BadgePercent size={10} aria-hidden="true" />
            {ar ? "عرض ساري" : "Live offer"}
          </span>
        )}
        {!!breaches?.breaches && (
          <span
            className="num rounded px-1.5 py-0.5 text-[10px] font-bold"
            style={{ background: "var(--danger-soft)", color: "var(--danger)" }}
          >
            {fmtNum(breaches.breaches)} {ar ? "مخالفة" : "breaches"}
          </span>
        )}
      </div>
    </button>
  );
}

function MiniBand({ label, band, hint }: { label: string; band: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2/70 px-2.5 py-1.5">
      <dt className="truncate text-[9.5px] font-semibold uppercase tracking-wide text-text-subtle">
        {label}
      </dt>
      <dd className="num mt-0.5 truncate text-[12px] font-bold text-text">{band}</dd>
      {hint && <dd className="num truncate text-[9.5px] text-text-subtle">{hint}</dd>}
    </div>
  );
}
