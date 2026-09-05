import { useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Detail the reader can ask for without asking the model.
 *
 * Everything inside is already in the payload. Opening it is local state, so
 * "عرض التفاصيل" costs nothing and cannot fail — the alternative was a follow-up
 * turn that re-ran an analysis to reveal a number already on the page.
 */
export function ExpandableSection({
  label,
  openLabel,
  children,
  testId = "nexus-expandable",
}: {
  label: string;
  openLabel?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-1 rounded text-xs font-medium text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        data-testid={`${testId}-toggle`}
      >
        {open ? (openLabel ?? label) : label}
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="mt-2" data-testid={`${testId}-content`}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
