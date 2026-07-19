import type { ReactNode } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { fmtNum, fmtPct, fmtRoas, useI18n } from "@/lib/i18n";
import type { AdSetOrigin, Maybe, Platform } from "@/lib/types";
import { PLATFORM_LABEL } from "@/lib/constants";
import { Pill } from "./ui-bits";

const EM = "—";

/** ACOS is a cost ratio: lower is better, so the colour scale is inverted vs ROAS. */
export function AcosPill({ acos }: { acos: Maybe }) {
  if (acos === null || !isFinite(acos)) return <span className="text-text-subtle">{EM}</span>;
  let tone: "success" | "warning" | "danger" = "danger";
  if (acos <= 50) tone = "success";
  else if (acos <= 100) tone = "warning";
  return <Pill tone={tone}>{fmtPct(acos, 1)}</Pill>;
}

export function RoasCell({
  roas,
  spend,
  partialSpend,
  spendDateMin,
  spendDateMax,
}: {
  roas: Maybe;
  spend: number;
  partialSpend?: boolean;
  spendDateMin?: string;
  spendDateMax?: string;
}) {
  const { lang } = useI18n();
  // No spend means ROAS is undefined, not infinite.
  if (spend <= 0 || roas === null || !isFinite(roas))
    return <span className="text-text-subtle">{EM}</span>;
  let tone: "success" | "warning" | "danger" = "danger";
  if (roas >= 2) tone = "success";
  else if (roas >= 1) tone = "warning";

  if (partialSpend) {
    // The ratio is arithmetically right but not comparable: most of this row's
    // revenue predates the days its spend data covers.
    const window = spendDateMin && spendDateMax ? ` (${spendDateMin} → ${spendDateMax})` : "";
    return (
      <span
        className="inline-flex items-center gap-1"
        title={
          lang === "ar"
            ? `بيانات الإنفاق تغطي جزءاً من الفترة فقط${window}، بينما الإيراد يمتد خارجها — هذه النسبة غير قابلة للمقارنة.`
            : `Spend data covers only part of the period${window} while revenue extends beyond it — this ratio is not comparable.`
        }
      >
        <Pill tone="neutral">{fmtRoas(roas)}</Pill>
        <AlertTriangle size={11} style={{ color: "var(--warning)" }} />
      </span>
    );
  }
  return <Pill tone={tone}>{fmtRoas(roas)}</Pill>;
}

/**
 * Counts and percentages always travel together — a rate alone hides the volume.
 * The percentage is bracketed because two bare numbers side by side in a dense
 * table read as one ("33" + "4.3%" scans as 334.3%).
 */
export function CountPct({ count, pct }: { count: number; pct: Maybe }) {
  return (
    <span className="whitespace-nowrap">
      <span className="num font-medium">{fmtNum(count)}</span>
      <span className="num text-text-muted text-[11px] ms-1.5">({fmtPct(pct, 1)})</span>
    </span>
  );
}

/** Close time is meaningless without its sample size, so they render as one unit. */
export function CloseTime({ days, sample, inline = false }: { days: Maybe; sample: number; inline?: boolean }) {
  const { t } = useI18n();
  if (days === null || !isFinite(days) || sample === 0)
    return <span className="text-text-subtle">{EM}</span>;
  return (
    <span className={inline ? "whitespace-nowrap" : ""}>
      <span className="num font-medium">
        {days.toFixed(1)} {t("days")}
      </span>
      <span className="text-[11px] text-text-muted ms-1.5">
        · {t("based_on")} <span className="num">{fmtNum(sample)}</span> {t("closed_leads")}
      </span>
    </span>
  );
}

export function PlatformBadges({ platforms }: { platforms: Platform[] }) {
  const { lang } = useI18n();
  if (!platforms.length) return <span className="text-text-subtle">{EM}</span>;
  return (
    <span className="inline-flex gap-1 flex-wrap">
      {platforms.map((p) => (
        <Pill key={p} tone={p === "meta" ? "brand" : "warning"}>
          {PLATFORM_LABEL[p][lang]}
        </Pill>
      ))}
    </span>
  );
}

/**
 * Ad-set values are backfilled because the Odoo export leaves the column empty.
 * `exact` came from an ad id and needs no badge; anything softer is labelled so
 * the reader knows how much weight the value carries.
 */
export function AdSetOriginBadge({ origin }: { origin?: AdSetOrigin }) {
  const { t } = useI18n();
  if (!origin || origin === "exact" || origin === "none") return null;
  if (origin === "ambiguous")
    return (
      <span title={t("adset_ambiguous_note")}>
        <Pill tone="warning">
          <AlertTriangle size={10} className="me-1" />
          {t("ambiguous")}
        </Pill>
      </span>
    );
  if (origin === "derived")
    return (
      <span title={t("adset_derived_note")}>
        <Pill tone="neutral">{t("derived")}</Pill>
      </span>
    );
  return null;
}

export function InferredCourse({ course, inferred }: { course: string; inferred: boolean }) {
  const { t } = useI18n();
  if (!course) return <span className="text-text-subtle">{EM}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {course}
      {inferred && (
        <span title={t("inferred_course")}>
          <Sparkles size={11} className="text-text-subtle" />
        </span>
      )}
    </span>
  );
}

/** A metric the platform genuinely does not report. Never render 0 for these. */
export function NotReported() {
  const { t } = useI18n();
  return (
    <span className="text-text-subtle" title={t("not_reported")}>
      {EM}
    </span>
  );
}

export function Metric({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="num text-lg font-semibold text-text mt-0.5">{children}</div>
      {hint && <div className="text-[11px] text-text-muted mt-0.5">{hint}</div>}
    </div>
  );
}
