import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { NexusCampaign } from "../lib/nexus-message-schema";
import { CampaignCard } from "./CampaignCard";

/**
 * Four to eight campaigns, scrolled sideways instead of stacked.
 *
 * Native scroll with snap points: it swipes on a phone, scrolls with a
 * trackpad, and the arrows exist for a mouse and for keyboard users. No
 * carousel library — the behaviour is two `scrollBy` calls and a CSS property.
 */
export function CampaignCarousel({
  campaigns,
  lang,
  onSend,
  disabled,
}: {
  campaigns: NexusCampaign[];
  lang: "ar" | "en";
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const scroll = (direction: 1 | -1) => {
    const node = track.current;
    if (!node) return;
    node.scrollBy({ left: direction * node.clientWidth * 0.85, behavior: "smooth" });
  };
  const labels =
    lang === "ar"
      ? { prev: "الحملات السابقة", next: "الحملات التالية" }
      : { prev: "Previous campaigns", next: "Next campaigns" };

  return (
    <div className="relative" data-testid="nexus-campaign-carousel">
      <div
        ref={track}
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {campaigns.map((campaign) => (
          <div key={campaign.key} className="w-[85%] shrink-0 snap-start sm:w-[48%] lg:w-[32%]">
            <CampaignCard campaign={campaign} lang={lang} onSend={onSend} disabled={disabled} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-end gap-1">
        <button
          type="button"
          onClick={() => scroll(-1)}
          aria-label={labels.prev}
          className="rounded border border-border p-1 text-text-muted hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => scroll(1)}
          aria-label={labels.next}
          className="rounded border border-border p-1 text-text-muted hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
