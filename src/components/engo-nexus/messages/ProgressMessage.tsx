import { Mascot } from "../Mascot";

/**
 * What ENGO Nexus is doing right now.
 *
 * This is NOT fake streaming. A DEEP executive turn genuinely runs for tens of
 * seconds while it calls tools, and a bare spinner for that long reads as
 * broken. These labels are driven by real state — `isAwaitingResponse` from the
 * SDK, and, when the agent emits them, real `progress` payloads naming the step
 * it is actually on.
 *
 * The rotating fallback labels are honest about being estimates: they describe
 * the pipeline the agent genuinely runs (read data → compare → build the
 * recommendation), in order, and they never claim a step has completed.
 */
export function ProgressMessage({
  label,
  step,
  totalSteps,
}: {
  label: string;
  step?: number;
  totalSteps?: number;
}) {
  return (
    <div className="flex items-center gap-2.5" data-testid="nexus-progress" role="status">
      <span className="relative grid size-8 shrink-0 place-items-center">
        <Mascot variant="avatar" className="size-8 rounded-full" />
        <span
          className="absolute inset-0 animate-ping rounded-full border border-brand/40 motion-reduce:animate-none"
          aria-hidden
        />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs text-text-muted">{label}</span>
        {typeof step === "number" && typeof totalSteps === "number" && totalSteps > 0 && (
          <span className="mt-1 block h-1 w-24 overflow-hidden rounded-full bg-bg-subtle">
            <span
              className="block h-full rounded-full bg-brand transition-[width] duration-500"
              style={{ width: `${Math.min(100, Math.round((step / totalSteps) * 100))}%` }}
            />
          </span>
        )}
      </span>
    </div>
  );
}
