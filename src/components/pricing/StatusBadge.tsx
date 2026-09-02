import {
  ArrowUpRight,
  BadgePercent,
  CalendarX,
  CheckCircle2,
  CircleHelp,
  Layers3,
  Link2Off,
  MinusCircle,
  TrendingDown,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n";
import type { AuditRow } from "./pricing-ui";

/**
 * The verdict on one invoice line, as colour *and* glyph *and* words.
 *
 * Colour alone fails for the ~8% of men with a red/green deficiency, and this
 * table's whole job is separating red from green. Every badge therefore carries
 * an icon whose silhouette differs from its neighbours' and a label that says
 * the verdict in full.
 */

export type Verdict =
  | "full_price"
  | "allowed_discount"
  | "at_floor"
  | "offer_price"
  | "package_price"
  | "package_unresolved"
  | "below_floor"
  | "above_list"
  | "needs_review"
  | "unmatched"
  | "excluded";

interface VerdictSpec {
  ar: string;
  en: string;
  icon: LucideIcon;
  /** CSS custom-property names, so the badge follows the theme. */
  color: string;
  soft: string;
}

const VERDICTS: Record<Verdict, VerdictSpec> = {
  full_price: {
    ar: "بالسعر الكامل",
    en: "Full price",
    icon: CheckCircle2,
    color: "--success",
    soft: "--success-soft",
  },
  allowed_discount: {
    ar: "خصم ضمن الصلاحية",
    en: "Within allowance",
    icon: CheckCircle2,
    color: "--calm",
    soft: "--calm-soft",
  },
  at_floor: {
    ar: "عند الحد الأدنى",
    en: "At the floor",
    icon: TriangleAlert,
    color: "--warning",
    soft: "--warning-soft",
  },
  offer_price: {
    ar: "بسعر عرض معتمد",
    en: "Approved offer price",
    icon: BadgePercent,
    color: "--offer",
    soft: "--offer-soft",
  },
  package_price: {
    ar: "سعر باقة معتمد",
    en: "Approved package price",
    icon: Layers3,
    color: "--success",
    soft: "--success-soft",
  },
  package_unresolved: {
    ar: "بند داخل باقة",
    en: "Package item",
    icon: Layers3,
    color: "--text-muted",
    soft: "--surface-2",
  },
  below_floor: {
    ar: "أقل من الحد",
    en: "Below the floor",
    icon: TrendingDown,
    color: "--danger",
    soft: "--danger-soft",
  },
  above_list: {
    ar: "أعلى من السعر الرسمي",
    en: "Above list",
    icon: ArrowUpRight,
    color: "--calm",
    soft: "--calm-soft",
  },
  needs_review: {
    ar: "تحتاج مراجعة",
    en: "Needs review",
    icon: CircleHelp,
    color: "--warning",
    soft: "--warning-soft",
  },
  unmatched: {
    ar: "بيانات ناقصة",
    en: "Incomplete data",
    icon: Link2Off,
    color: "--text-subtle",
    soft: "--surface-2",
  },
  excluded: {
    ar: "مستثنى من الحكم",
    en: "Excluded",
    icon: MinusCircle,
    color: "--text-subtle",
    soft: "--surface-2",
  },
};

/**
 * Splits the API's `compliant` verdict into the three cases a sales manager
 * actually distinguishes, using only numbers the API already returns.
 *
 * This is presentation, not policy: `complianceStatus` remains the single
 * authority on whether a line passed. All this does is stop "compliant" from
 * meaning both "sold at the full published price" and "discounted to the last
 * riyal of the seller's allowance", which are the same verdict to the audit and
 * very different things to the person reading the table.
 */
export function verdictOf(row: {
  complianceStatus: string;
  actualUnitPrice: number;
  allowedMinimum: number | null;
  allowedMaximum: number | null;
}): Verdict {
  switch (row.complianceStatus) {
    case "below_minimum":
      return "below_floor";
    case "compliant_offer":
      return "offer_price";
    case "compliant_package":
      return "package_price";
    case "package_price_unresolved":
      return "package_unresolved";
    case "above_list":
      return "above_list";
    case "excluded":
      return "excluded";
    case "unmatched_product":
      return "unmatched";
    case "unknown_payment_method":
    case "mixed_payment_review":
    case "expired_offer":
      return "needs_review";
    case "compliant": {
      const { actualUnitPrice: sold, allowedMinimum: floor, allowedMaximum: ceiling } = row;
      if (ceiling !== null && sold >= ceiling) return "full_price";
      if (floor !== null && sold <= floor) return "at_floor";
      if (ceiling === null && floor === null) return "full_price";
      return "allowed_discount";
    }
    default:
      return "needs_review";
  }
}

export const verdictLabel = (verdict: Verdict, lang: Lang): string => VERDICTS[verdict][lang];

export function StatusBadge({ verdict, size = "sm" }: { verdict: Verdict; size?: "sm" | "md" }) {
  const { lang } = useI18n();
  const spec = VERDICTS[verdict];
  const Icon = spec.icon;

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-md font-semibold ${
        size === "md" ? "px-2.5 py-1 text-[12px]" : "px-2 py-0.5 text-[11px]"
      }`}
      style={{
        background: `var(${spec.soft})`,
        color: `var(${spec.color})`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, var(${spec.color}) 22%, transparent)`,
      }}
    >
      <Icon size={size === "md" ? 14 : 12} strokeWidth={2.2} aria-hidden="true" />
      <span className="truncate">{spec[lang]}</span>
    </span>
  );
}

/** The same badge, taken straight from an audit row. */
export function RowStatusBadge({ row, size }: { row: AuditRow; size?: "sm" | "md" }) {
  return <StatusBadge verdict={verdictOf(row)} size={size} />;
}
