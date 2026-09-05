/**
 * At most four next steps, and only ones that follow from this answer.
 *
 * The cap is the point: a strip of ten buttons is a menu, and a menu is what
 * the reader was trying to avoid by asking a question.
 */
export function QuickActions({
  actions,
  onSend,
  disabled,
}: {
  actions: Array<{ label: string; value: string }>;
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="nexus-quick-actions">
      {actions.slice(0, 4).map((action) => (
        <button
          key={action.value}
          type="button"
          disabled={disabled}
          onClick={() => onSend(action.value)}
          className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-text hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
