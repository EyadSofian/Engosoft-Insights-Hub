import { CircleAlert, CircleCheck, CircleMinus } from "lucide-react";
import type { Maybe } from "@/lib/types";

export type Verdict = "good" | "watch" | "weak";

export const VERDICT_STYLE: Record<
  Verdict,
  { color: string; soft: string; icon: typeof CircleCheck }
> = {
  good: { color: "var(--success)", soft: "var(--success-soft)", icon: CircleCheck },
  watch: { color: "var(--warning)", soft: "var(--warning-soft)", icon: CircleAlert },
  weak: { color: "var(--danger)", soft: "var(--danger-soft)", icon: CircleMinus },
};

/**
 * Verdict thresholds for the only two ratios that have an agreed reading here.
 * Everything else (CPL, CPA, conversion) has no company-wide target, so it gets
 * no colour rather than an invented one.
 */
export function roasVerdict(roas: Maybe, spend: number): Verdict | null {
  if (spend <= 0 || roas === null || !isFinite(roas)) return null;
  return roas >= 2 ? "good" : roas >= 1 ? "watch" : "weak";
}

export function acosVerdict(acos: Maybe): Verdict | null {
  if (acos === null || !isFinite(acos)) return null;
  return acos <= 50 ? "good" : acos <= 100 ? "watch" : "weak";
}

/** The word that travels with the colour, so the chip never relies on hue alone. */
export function verdictWord(verdict: Verdict | null, lang: "ar" | "en"): string | undefined {
  if (!verdict) return undefined;
  if (verdict === "good") return lang === "ar" ? "كويس" : "Healthy";
  if (verdict === "watch") return lang === "ar" ? "محتاج متابعة" : "Watch";
  return lang === "ar" ? "ضعيف" : "Weak";
}
