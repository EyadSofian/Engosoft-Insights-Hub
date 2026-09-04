import { useState } from "react";
import { AlertTriangle, ChevronDown, Send, ShieldCheck, Target, User } from "lucide-react";
import type { DecisionCardMessage } from "../lib/nexus-message-schema";
import { SourceBadges } from "./SourceBadges";

/**
 * A management recommendation, rendered with its whole evidence chain.
 *
 * Every field here comes from ENGO Nexus's typed Recommendation. This component
 * computes nothing: it does not rank, does not score, and above all does not
 * produce a magnitude. `actionBand` is rendered only when the agent supplied
 * one, together with the provenance sentence that says which ENGO Nexus history
 * produced it — so a number can never be quoted without the evidence behind it.
 *
 * When `actionBand` is absent the card shows the direction alone. That is not a
 * missing feature: it is the agent reporting that no calibrated magnitude
 * exists, and inventing one in the UI would defeat the guardrail entirely.
 *
 * `missingEvidence` is shown prominently rather than tucked away. A decision
 * taken without a measurement is the thing a reviewer most needs to see.
 */
const DECISION_TONE: Record<string, string> = {
  ESCALATE: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  PAUSE: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  REDUCE: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  SCALE: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  PRIORITIZE: "bg-brand-soft text-brand",
  FOLLOW_UP: "bg-brand-soft text-brand",
  TEST: "bg-brand-soft text-brand",
  INVESTIGATE: "bg-bg-subtle text-text-muted",
  HOLD: "bg-bg-subtle text-text-muted",
  INSUFFICIENT_EVIDENCE: "bg-bg-subtle text-text-muted",
};

const CONFIDENCE_TONE: Record<string, string> = {
  HIGH: "text-emerald-600 dark:text-emerald-400",
  MEDIUM: "text-amber-600 dark:text-amber-400",
  LOW: "text-rose-600 dark:text-rose-400",
};

export function DecisionCard({
  message,
  lang,
  onSend,
  disabled,
}: {
  message: DecisionCardMessage;
  lang: "ar" | "en";
  onSend?: (text: string) => void;
  disabled?: boolean;
}) {
  const ar = lang === "ar";
  const [expanded, setExpanded] = useState(false);
  const tone = DECISION_TONE[message.decision] ?? DECISION_TONE.INVESTIGATE!;

  const t = ar
    ? {
        why: "ليه",
        evidence: "الأدلة",
        impact: "الأثر المتوقع",
        confidence: "الثقة",
        risk: "المخاطر",
        owner: "المسؤول",
        review: "المراجعة خلال",
        nextKpi: "المؤشر القادم",
        missing: "أدلة ناقصة",
        details: "التفاصيل",
        send: "إرسال",
        days: "يوم",
        band: "النطاق المستهدف",
      }
    : {
        why: "Why",
        evidence: "Evidence",
        impact: "Expected impact",
        confidence: "Confidence",
        risk: "Risk",
        owner: "Owner",
        review: "Review within",
        nextKpi: "Next KPI",
        missing: "Missing evidence",
        details: "Details",
        send: "Send",
        days: "days",
        band: "Target band",
      };

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-bg"
      data-testid="nexus-decision-card"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span
          className={`rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ${tone}`}
          data-testid="nexus-decision-badge"
        >
          {message.decision}
        </span>
        {message.priority && (
          <span className="text-[10px] font-semibold uppercase text-text-subtle">
            {message.priority}
          </span>
        )}
        {message.confidence && (
          <span
            className={`ms-auto text-[11px] font-medium ${CONFIDENCE_TONE[message.confidence] ?? ""}`}
            data-testid="nexus-decision-confidence"
          >
            {t.confidence}: {message.confidence}
          </span>
        )}
      </div>

      <div className="space-y-2 px-3 py-3">
        <p className="text-sm leading-relaxed text-text">{message.summary}</p>

        {message.actionBand && (
          <div className="rounded-lg border border-brand/30 bg-brand-soft/40 px-2.5 py-2">
            <p className="text-[11px] font-semibold text-brand">{t.band}</p>
            <p
              className="num mt-0.5 text-sm font-semibold text-text"
              data-testid="nexus-action-band"
            >
              {message.actionBand.display}
            </p>
            {message.actionBand.provenance && (
              <p className="mt-1 text-[11px] leading-snug text-text-muted">
                {message.actionBand.provenance}
              </p>
            )}
          </div>
        )}

        {message.missingEvidence && message.missingEvidence.length > 0 && (
          <div
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2"
            data-testid="nexus-missing-evidence"
          >
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-3" aria-hidden />
              {t.missing}
            </p>
            <ul className="mt-1 space-y-0.5">
              {message.missingEvidence.map((item) => (
                <li key={item} className="text-[11px] leading-snug text-text-muted">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
          {message.owner && <Field icon={User} label={t.owner} value={message.owner} />}
          {message.reviewWindowDays !== null && message.reviewWindowDays !== undefined && (
            <Field
              icon={ShieldCheck}
              label={t.review}
              value={`${message.reviewWindowDays} ${t.days}`}
            />
          )}
          {message.nextKpi && <Field icon={Target} label={t.nextKpi} value={message.nextKpi} />}
        </dl>

        {expanded && (
          <div
            className="space-y-2 border-t border-border pt-2"
            data-testid="nexus-decision-details"
          >
            <Section title={t.why} items={message.why} />
            <Section title={t.evidence} items={message.evidence} />
            {message.expectedImpact && (
              <Section title={t.impact} items={[message.expectedImpact]} />
            )}
            <Section title={t.confidence} items={message.confidenceLimitedBy} />
            <Section title={t.risk} items={message.risk} />
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-text transition hover:bg-bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {t.details}
            <ChevronDown
              className={`size-3 transition ${expanded ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          {onSend && (
            <button
              type="button"
              disabled={disabled}
              // Sending is a REQUEST to the agent, which then applies its own
              // approval gate. This button never dispatches anything itself.
              onClick={() =>
                onSend(
                  ar
                    ? `ابعت التوصية دي (${message.decision}) للمسؤول${message.owner ? ` ${message.owner}` : ""}`
                    : `Send this recommendation (${message.decision}) to the owner${message.owner ? ` ${message.owner}` : ""}`,
                )
              }
              data-testid="nexus-decision-send"
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-text transition hover:bg-bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="size-3" aria-hidden />
              {t.send}
            </button>
          )}
        </div>

        <SourceBadges sources={message.sources} lang={lang} />
      </div>
    </div>
  );
}

function Field({ icon: Icon, label, value }: { icon: typeof User; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-text-subtle">
        <Icon className="size-3" aria-hidden />
        {label}
      </dt>
      <dd className="truncate font-medium text-text">{value}</dd>
    </div>
  );
}

function Section({ title, items }: { title: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold text-text">{title}</p>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((item) => (
          <li key={item} className="text-[11px] leading-snug text-text-muted">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
