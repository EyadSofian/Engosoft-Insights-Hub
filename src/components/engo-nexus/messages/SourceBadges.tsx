import { Database, Tag, BookOpen } from "lucide-react";
import type { NexusSource } from "../lib/nexus-message-schema";

/**
 * Provenance badges.
 *
 * Rendered ONLY from sources the payload actually declared. There is no
 * inference here and no default — a figure with no declared source shows no
 * badge, because a badge nobody earned is worse than no badge at all: it makes
 * an unattributed number look verified.
 */
const META: Record<NexusSource, { label: { ar: string; en: string }; Icon: typeof Database }> = {
  insights_hub: { label: { ar: "Insights Hub", en: "Insights Hub" }, Icon: Database },
  price_engo: { label: { ar: "PriceEngo", en: "PriceEngo" }, Icon: Tag },
  engosoft_knowledge: {
    label: { ar: "معرفة ENGOSOFT", en: "ENGOSOFT Knowledge" },
    Icon: BookOpen,
  },
};

export function SourceBadges({ sources, lang }: { sources?: NexusSource[]; lang: "ar" | "en" }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="nexus-sources">
      {sources.map((source) => {
        const meta = META[source];
        if (!meta) return null;
        const { Icon } = meta;
        return (
          <span
            key={source}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-text-muted"
          >
            <Icon className="size-3" aria-hidden />
            {meta.label[lang]}
          </span>
        );
      })}
    </div>
  );
}
