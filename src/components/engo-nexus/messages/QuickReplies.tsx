/**
 * Quick replies as real buttons.
 *
 * Botpress delivers these as a `choice` block, and the alternative — letting
 * them arrive as markdown list items — turns a one-tap answer into a typing
 * exercise on a phone. Clicking sends the option's `value` as the user's own
 * message, so the transcript reads the way the conversation actually went.
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
            onClick={() => onSelect(option.value)}
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
