import { AlertTriangle } from "lucide-react";
import type { NexusRecommendation } from "../lib/nexus-message-schema";
import { IsolatedText } from "./IsolatedText";

const L = {
  ar: { title: "رأيي", why: "ليه؟", risk: "الخطر", confidence: "الثقة" },
  en: { title: "My read", why: "Why", risk: "Risk", confidence: "Confidence" },
} as const;

const CONFIDENCE_LABEL = {
  ar: { high: "عالية", medium: "متوسطة", low: "منخفضة" },
  en: { high: "High", medium: "Medium", low: "Low" },
} as const;

/**
 * The judgement, as a card rather than a paragraph.
 *
 * The reasons arrive as a list because they were computed as one — the ranking
 * is arithmetic done server-side, and rendering it as prose is what made the
 * recommendation read like generic advice ("focus on the campaign with the
 * highest revenue") instead of naming one.
 *
 * Latin names inside the Arabic reasons are isolated: a campaign name broken
 * across a bidi boundary cannot be matched against the dashboard.
 */
export function RecommendationCard({
  recommendation,
  lang,
  onSend,
  disabled,
}: {
  recommendation: NexusRecommendation;
  lang: "ar" | "en";
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const t = L[lang];
  return (
    <section
      className="rounded-lg border border-accent/30 bg-accent/5 p-3"
      data-testid="nexus-recommendation-card"
    >
      <h4 className="text-xs font-semibold uppercase tracking-wide text-accent">{t.title}</h4>
      <p className="mt-1 text-sm font-medium text-text">
        <IsolatedText text={recommendation.summary} />
      </p>

      {recommendation.reasons.length > 0 ? (
        <>
          <h5 className="mt-2 text-[11px] font-medium text-text-muted">{t.why}</h5>
          <ul className="mt-1 space-y-1">
            {recommendation.reasons.slice(0, 5).map((reason, index) => (
              <li key={index} className="flex gap-1.5 text-xs text-text">
                <span aria-hidden="true" className="text-accent">
                  •
                </span>
                <span className="min-w-0">
                  <IsolatedText text={reason} />
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {recommendation.risk ? (
        <p className="mt-2 flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="font-medium">{t.risk}: </span>
            <IsolatedText text={recommendation.risk} />
          </span>
        </p>
      ) : null}

      {recommendation.confidence ? (
        <p className="mt-2 text-[11px] text-text-muted">
          {t.confidence}: {CONFIDENCE_LABEL[lang][recommendation.confidence]}
        </p>
      ) : null}

      <div className="mt-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSend(lang === "ar" ? "ليه أكتر؟" : "Why, in more detail?")}
          className="rounded border border-border bg-surface px-2 py-1 text-[11px] font-medium text-text hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        >
          {lang === "ar" ? "ليه أكتر؟" : "Why, in more detail?"}
        </button>
      </div>
    </section>
  );
}
