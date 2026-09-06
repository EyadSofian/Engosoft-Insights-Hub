import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocation } from "@tanstack/react-router";
import { BellOff, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useFilters } from "@/lib/filter-store";
import { Mascot } from "./Mascot";
import { nexusStore } from "./state/nexus-store";
import {
  canShowProactive,
  rememberPanelOpened,
  rememberProactiveDismissed,
  rememberProactiveShown,
  setProactiveOptOut,
} from "./state/nexus-store";
import { getNexusView, subscribeNexusView } from "./state/nexus-view-context";
import { PROACTIVE_DELAY_MS } from "./lib/nexus-config";
import { entityFor, pageTypeFor, quickActionsFor } from "./lib/nexus-context";

/**
 * A small card that offers help — about THIS page, rarely, and never first.
 *
 * WHY THE RULES ARE THIS STRICT. Proactive assistants are usually resented, and
 * the two failure modes are opposite: nagging, and being silently switched off
 * forever by a rule nobody remembers writing. The previous version had both —
 * it never appeared again to anyone who had ever opened the panel, so for
 * returning users it was permanently dead.
 *
 * WHAT IT DOES NOW. It waits out a real dwell on ONE page, and the timer
 * RESTARTS on navigation, so passing through a route never triggers it. Its
 * suggestions come from the surface registry and name the entity actually
 * selected. It records that it appeared on that surface, so the next offer
 * comes from a different page. A dismissal buys a week; opening the panel buys
 * a day; and there is an explicit "don't offer again" that means it.
 */
export function NexusProactivePopup({ suppressed }: { suppressed?: boolean }) {
  const { lang } = useI18n();
  const location = useLocation();
  const filters = useFilters();
  const [visible, setVisible] = useState(false);
  const ar = lang === "ar";

  const view = useSyncExternalStore(subscribeNexusView, getNexusView, getNexusView);
  const surface = pageTypeFor(location.pathname);

  /**
   * The dwell timer is keyed on the pathname, so navigating restarts it.
   *
   * Without that, walking through four pages in twenty seconds pops the card on
   * whichever one happened to be open when a single global timer fired — an
   * offer about a page the user had already left.
   */
  useEffect(() => {
    setVisible(false);
    if (suppressed) return;
    if (!canShowProactive({ surface })) return;
    const timer = window.setTimeout(() => {
      // Re-checked on fire: the user may have opened the panel while we waited.
      if (!canShowProactive({ surface })) return;
      rememberProactiveShown(surface);
      setVisible(true);
    }, PROACTIVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [suppressed, surface, location.pathname]);

  if (!visible || suppressed) return null;

  /**
   * The offer is about what is selected, not about the page in the abstract.
   *
   * A page-level entity (a course card opened on Courses) beats a global
   * filter, because it is the more specific thing the user is looking at.
   */
  const entityLabel = view.selectedEntity?.name ?? entityFor(filters).entityName ?? null;
  const actions = quickActionsFor(surface, ar ? "ar" : "en", {
    entityLabel,
    elementId: view.focusedElementId,
  }).slice(0, 3);

  const dismiss = () => {
    rememberProactiveDismissed();
    setVisible(false);
  };

  const optOut = () => {
    setProactiveOptOut(true);
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
      aria-label="ENGO Nexus"
      data-testid="nexus-proactive"
      className={[
        "fixed z-50 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-border bg-bg p-3 shadow-xl",
        "bottom-[calc(env(safe-area-inset-bottom,0px)+10rem)] end-4",
        "sm:bottom-[calc(env(safe-area-inset-bottom,0px)+6.25rem)] sm:end-6",
        "motion-safe:animate-[nexus-rise_220ms_ease-out]",
      ].join(" ")}
    >
      <div className="absolute end-2 top-2 flex items-center gap-1">
        <button
          type="button"
          onClick={optOut}
          aria-label={ar ? "بطّل الاقتراحات دي خالص" : "Turn these suggestions off"}
          title={ar ? "بطّل الاقتراحات دي خالص" : "Turn these suggestions off"}
          data-testid="nexus-proactive-optout"
          className="rounded-lg p-1 text-text-subtle transition hover:bg-bg-subtle hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <BellOff className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label={ar ? "إغلاق" : "Dismiss"}
          data-testid="nexus-proactive-dismiss"
          className="rounded-lg p-1 text-text-subtle transition hover:bg-bg-subtle hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="flex items-start gap-2.5 pe-12">
        <Mascot variant="avatar" className="size-9 shrink-0 rounded-full" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">
            {ar ? "محتاج مساعدة سريعة؟" : "Need a quick hand?"}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-text-muted">
            {entityLabel
              ? ar
                ? `أقدر أحلل ${entityLabel} من الأرقام اللي قدامك.`
                : `I can analyse ${entityLabel} from the figures on screen.`
              : ar
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
            title={action.prompt}
            data-testid="nexus-proactive-action"
            className="max-w-full truncate rounded-full border border-border bg-bg-subtle px-2.5 py-1 text-[11px] font-medium text-text transition hover:border-brand hover:bg-brand-soft/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
