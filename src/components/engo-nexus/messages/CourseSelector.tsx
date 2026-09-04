import { ChevronRight } from "lucide-react";
import type { CourseSelectorMessage } from "../lib/nexus-message-schema";

/**
 * "Which one did you mean?" — rendered as choices, never resolved for the user.
 *
 * This is the frontend half of the guarantee that gives ENGO Nexus its pricing
 * safety. "PMP" matches five catalog products; "PMP + Exam" exists both ONLINE
 * (code 109) and RECORDED (code 108) at materially different Saudi prices. A
 * frontend that auto-selected the first candidate — or the "most likely" one —
 * would reintroduce exactly the wrong-variant price the backend refuses to give.
 *
 * So there is no default, no pre-selection, and no "probably this one" hint.
 * The user picks, and the pick is sent back as their own message.
 */
export function CourseSelector({
  message,
  lang,
  onSelect,
  disabled,
}: {
  message: CourseSelectorMessage;
  lang: "ar" | "en";
  onSelect: (text: string) => void;
  disabled?: boolean;
}) {
  const ar = lang === "ar";
  return (
    <div className="space-y-2" data-testid="nexus-course-selector">
      <p className="text-sm text-text">
        {message.question || (ar ? "تقصد أنهي نسخة؟" : "Which one do you mean?")}
      </p>
      <div className="space-y-1.5">
        {message.candidates.map((candidate) => {
          const descriptor = [
            candidate.deliveryMode,
            candidate.externalCode ? `#${candidate.externalCode}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          // The reply names the product the way a person would, and includes the
          // code so the agent can resolve it without a second round trip.
          const reply = candidate.externalCode
            ? `${candidate.name} (${candidate.deliveryMode ?? ""}) — ${ar ? "كود" : "code"} ${candidate.externalCode}`.replace(
                /\(\)\s*/,
                "",
              )
            : `${candidate.name}${candidate.deliveryMode ? ` (${candidate.deliveryMode})` : ""}`;
          return (
            <button
              key={candidate.productId}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(reply)}
              data-testid="nexus-course-option"
              className="flex w-full items-center gap-2 rounded-xl border border-border bg-bg px-3 py-2 text-start transition hover:border-brand hover:bg-brand-soft/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text">
                  {candidate.name}
                </span>
                {descriptor && (
                  <span className="block truncate text-[11px] text-text-muted num">
                    {descriptor}
                  </span>
                )}
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-text-subtle rtl:rotate-180"
                aria-hidden
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
