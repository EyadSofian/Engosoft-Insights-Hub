import { useCallback } from "react";
import { Sparkles } from "lucide-react";
import { elementManifest } from "@/lib/nexus-surface-registry";
import { updateNexusView } from "./state/nexus-view-context";
import { nexusStore } from "./state/nexus-store";

/**
 * Wraps an analytical element so Nexus knows what it is.
 *
 * Two jobs. It records which element the user last interacted with, so "الرقم
 * ده" has a referent. And it offers an unobtrusive "اسأل Nexus" action that
 * opens the panel with that element, entity, period and filters already
 * attached — so the user never retypes the KPI they are pointing at.
 *
 * Focus and hover both count as interest: a keyboard user tabbing to a card and
 * a mouse user resting on it are both looking at the same number.
 */
export function NexusAware({
  elementId,
  entity,
  children,
  className = "",
}: {
  elementId: string;
  entity?: { type: string; id?: string; name?: string } | null;
  children: React.ReactNode;
  className?: string;
}) {
  const manifest = elementManifest(elementId);

  const focus = useCallback(() => {
    updateNexusView({
      focusedElementId: elementId,
      ...(entity ? { selectedEntity: entity } : {}),
    });
  }, [elementId, entity]);

  const ask = useCallback(() => {
    focus();
    // The panel reads the view context; nothing is retyped and no model call
    // happens until the user actually picks a question.
    nexusStore.open();
  }, [focus]);

  return (
    <div
      className={`group/nexus relative ${className}`}
      onMouseEnter={focus}
      onFocusCapture={focus}
      data-nexus-element={elementId}
    >
      {children}
      {manifest ? (
        <button
          type="button"
          onClick={ask}
          aria-label={`اسأل Nexus عن ${manifest.title.ar}`}
          title="اسأل Nexus"
          className="absolute end-1 top-1 hidden rounded-md border border-border bg-surface p-1 text-text-muted opacity-0 transition-opacity group-hover/nexus:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none sm:block"
          data-testid={`nexus-ask-${elementId}`}
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
