import { useEffect, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Mascot } from "./Mascot";
import { nexusStore } from "./state/nexus-store";
import {
  canShowProactive,
  rememberPanelOpened,
  rememberProactiveDismissed,
} from "./state/nexus-store";
import { PROACTIVE_DELAY_MS } from "./lib/nexus-config";
import { pageTypeFor, quickActionsFor } from "./lib/nexus-context";

/**
 * A small card that offers help — once, and then not again for a week.
 *
 * The rules exist because proactive assistants are usually resented. It does
 * not appear on load; it waits out an idle period, so it interrupts nobody
 * mid-task. It never appears to someone who has already opened the panel. And a
 * dismissal is remembered across sessions, not just this page view.
 *
 * Its quick actions come from the page the user is actually on, so the offer is
 * about the screen in front of them rather than a generic menu.
 */
export function NexusProactivePopup({ suppressed }: { suppressed?: boolean }) {
  const { lang } = useI18n();
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const ar = lang === "ar";

  useEffect(() => {
    if (suppressed) return;
    if (!canShowProactive()) return;
    const timer = window.setTimeout(() => {
      // Re-check on fire: the user may have opened the panel while we waited.
      if (canShowProactive()) setVisible(true);
    }, PROACTIVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [suppressed]);

  if (!visible || suppressed) return null;

  const actions = quickActionsFor(pageTypeFor(location.pathname), ar ? "ar" : "en").slice(0, 3);

  const dismiss = () => {
    rememberProactiveDismissed();
    setVisible(false);
  };

  const start = (prompt: string) => {
    rememberPanelOpened();
    setVisible(false);
    nexusStore.open(prompt);
  };

  return (
    <div
      role="dialog"
      aria-label={ar ? "ENGO Nexus" : "ENGO Nexus"}
      data-testid="nexus-proactive"
      className={[
        "fixed z-50 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-border bg-bg p-3 shadow-xl",
        "bottom-[calc(env(safe-area-inset-bottom,0px)+10rem)] end-4",
        "sm:bottom-[calc(env(safe-area-inset-bottom,0px)+6.25rem)] sm:end-6",
        "motion-safe:animate-[nexus-rise_220ms_ease-out]",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label={ar ? "إغلاق" : "Dismiss"}
        data-testid="nexus-proactive-dismiss"
        className="absolute end-2 top-2 rounded-lg p-1 text-text-subtle transition hover:bg-bg-subtle hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        <X className="size-3.5" />
      </button>

      <div className="flex items-start gap-2.5 pe-5">
        <Mascot variant="avatar" className="size-9 shrink-0 rounded-full" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">
            {ar ? "محتاج مساعدة سريعة؟" : "Need a quick hand?"}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-text-muted">
            {ar
              ? "أنا ENGO Nexus، أقدر أحلل البيانات اللي قدامك وأساعدك في اتخاذ القرار."
              : "I'm ENGO Nexus — I can analyse what's on screen and help you decide."}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => start(action.prompt)}
            data-testid="nexus-proactive-action"
            className="rounded-full border border-border bg-bg-subtle px-2.5 py-1 text-[11px] font-medium text-text transition hover:border-brand hover:bg-brand-soft/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
