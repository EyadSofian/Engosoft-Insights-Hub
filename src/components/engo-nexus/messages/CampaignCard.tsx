import type { NexusCampaign } from "../lib/nexus-message-schema";
import { formatMoney, formatCount, formatRatio, NOT_MEASURABLE } from "../lib/nexus-format";
import { LtrText } from "./LtrText";

const L = {
  ar: {
    spend: "الإنفاق",
    revenue: "الإيراد",
    roas: "ROAS",
    won: "المبيعات",
    analyse: "حلل",
    sold: "باعت إيه؟",
  },
  en: {
    spend: "Spend",
    revenue: "Revenue",
    roas: "ROAS",
    won: "Won",
    analyse: "Analyse",
    sold: "What sold?",
  },
} as const;

const VERDICT_DOT = {
  good: "bg-emerald-500",
  watch: "bg-amber-500",
  weak: "bg-rose-500",
} as const;

/**
 * One campaign, at a glance.
 *
 * Four figures and two actions — deliberately short, because three of these
 * stack vertically and a tall card turns the panel back into a scroll.
 *
 * The name is `<bdi dir="ltr">`: "PMP-1/7/26-sayed" inside Arabic copy is
 * reordered by the paragraph's direction otherwise, and a reader cannot match a
 * scrambled name against the dashboard.
 */
export function CampaignCard({
  campaign,
  lang,
  onSend,
  disabled,
}: {
  campaign: NexusCampaign;
  lang: "ar" | "en";
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const t = L[lang];
  const figures: Array<[string, string]> = [
    [t.spend, formatMoney(campaign.spend, "USD")],
    [t.revenue, formatMoney(campaign.revenue, "USD")],
    [t.roas, formatRatio(campaign.roas)],
    [t.won, formatCount(campaign.won)],
  ];

  return (
    <article
      className="min-w-0 rounded-lg border border-border bg-surface p-3"
      data-testid="nexus-campaign-card"
    >
      <header className="flex items-start gap-2">
        {campaign.verdict ? (
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${VERDICT_DOT[campaign.verdict]}`}
            aria-hidden="true"
          />
        ) : null}
        <h4 className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
          <LtrText>{campaign.name}</LtrText>
        </h4>
        {campaign.platform ? (
          <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
            <LtrText>{campaign.platform}</LtrText>
          </span>
        ) : null}
      </header>

      <dl className="mt-2 grid grid-cols-4 gap-2">
        {figures.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="truncate text-[10px] text-text-muted">{label}</dt>
            <dd
              className={`num text-sm font-semibold ${
                value === NOT_MEASURABLE ? "text-text-muted" : "text-text"
              }`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onSend(
              lang === "ar" ? `حلل حملة ${campaign.name}` : `Analyse campaign ${campaign.name}`,
            )
          }
          className="rounded border border-border px-2 py-1 text-[11px] font-medium text-text hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        >
          {t.analyse}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onSend(
              lang === "ar" ? `حملة ${campaign.name} باعت إيه؟` : `What did ${campaign.name} sell?`,
            )
          }
          className="rounded border border-border px-2 py-1 text-[11px] font-medium text-text hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        >
          {t.sold}
        </button>
      </div>
    </article>
  );
}
