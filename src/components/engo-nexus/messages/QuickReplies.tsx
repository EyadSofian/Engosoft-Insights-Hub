import { selectionMessage } from "../lib/nexus-context";

/**
 * Quick replies as real buttons.
 *
 * Botpress delivers these as a `choice` block, and the alternative — letting
 * them arrive as markdown list items — turns a one-tap answer into a typing
 * exercise on a phone.
 *
 * WHAT A CLICK SENDS. It used to send `option.value` verbatim. For a product
 * choice that value is a productId, so tapping "PMP + CAPM Recorded + Exam —
 * ONLINE" put "8b2a6699-8558-43b9-b846-72d68db6f162" in the user's own bubble
 * in production. It now sends the label the user read, with the value carried
 * in a frame the transcript strips — the same mechanism the dashboard context
 * has always used. The reader sees what they tapped; the agent still gets the
 * exact id, so nothing has to be re-resolved by fuzzy name match.
 */
export function QuickReplies({
  options,
  onSelect,
  disabled,
  label,
}: {
  options: Array<{ label: string; value: string }>;
  onSelect: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  if (options.length === 0) return null;
  return (
    <div className="mt-2" data-testid="nexus-quick-replies">
      {label && <p className="mb-1.5 text-sm text-text">{label}</p>}
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={`${option.value}:${option.label}`}
            type="button"
            disabled={disabled}
            onClick={() =>
              onSelect(
                selectionMessage({
                  displayLabel: option.label,
                  internalValue: option.value,
                }),
              )
            }
            data-testid="nexus-quick-reply"
            className="rounded-full border border-border bg-bg px-3 py-1.5 text-xs font-medium text-text transition hover:border-brand hover:bg-brand-soft/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
