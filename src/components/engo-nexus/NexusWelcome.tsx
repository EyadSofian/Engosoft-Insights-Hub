import { Mascot } from "./Mascot";
import type { NexusPageType } from "./lib/nexus-context";
import { quickActionsFor } from "./lib/nexus-context";

/**
 * The empty state.
 *
 * Its job is to answer "what can I actually ask this thing?" in one screen. The
 * suggestions are page-aware, so someone on the sales page is offered sales
 * questions rather than a generic menu they will scroll past.
 */
export function NexusWelcome({
  lang,
  pageType,
  onPick,
}: {
  lang: "ar" | "en";
  pageType: NexusPageType;
  onPick: (prompt: string) => void;
}) {
  const ar = lang === "ar";
  const pageActions = quickActionsFor(pageType, lang);
  const always = ar
    ? [
        {
          id: "top3",
          label: "أهم 3 قرارات",
          prompt: "حلل أداء الشركة وقولي أهم 3 قرارات للإدارة.",
        },
        { id: "prices", label: "أسعار الكورسات", prompt: "أسعار الكورسات الحالية إيه؟" },
      ]
    : [
        {
          id: "top3",
          label: "Top 3 decisions",
          prompt: "Analyse company performance and give me the top 3 decisions.",
        },
        { id: "prices", label: "Course prices", prompt: "What are the current course prices?" },
      ];

  const seen = new Set<string>();
  const actions = [...pageActions, ...always].filter((action) => {
    if (seen.has(action.id)) return false;
    seen.add(action.id);
    return true;
  });

  return (
    <div className="flex flex-col items-center px-5 py-8 text-center" data-testid="nexus-welcome">
      <Mascot variant="full" className="h-32 w-auto" />
      <h3 className="mt-3 text-base font-semibold text-text">{ar ? "مرحبًا 👋" : "Hello 👋"}</h3>
      <p className="mt-1.5 max-w-[19rem] text-xs leading-relaxed text-text-muted">
        {ar
          ? "أنا ENGO Nexus. بحلل بيانات Insights Hub وأساعدك تفهم الأداء وتاخد قرارات أفضل — وكل رقم بقوله بيجي من مصدر حي، مش من الذاكرة."
          : "I'm ENGO Nexus. I analyse Insights Hub data and help you understand performance and decide — and every figure I give comes from a live source, never from memory."}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => onPick(action.prompt)}
            data-testid="nexus-welcome-action"
            className="rounded-full border border-border bg-bg-subtle px-3 py-1.5 text-xs font-medium text-text transition hover:border-brand hover:bg-brand-soft/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
