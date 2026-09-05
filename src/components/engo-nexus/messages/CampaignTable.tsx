import { useState } from "react";
import type { NexusCampaign } from "../lib/nexus-message-schema";
import { formatMoney, formatCount, formatRatio } from "../lib/nexus-format";
import {
  TABLE_INITIAL_ROWS,
  TABLE_PAGE_SIZE,
  moreControl,
  sortRows,
  type SortKey,
} from "../lib/nexus-layout";
import { LtrText } from "./LtrText";

const L = {
  ar: {
    campaign: "الحملة",
    platform: "المنصة",
    spend: "الإنفاق",
    revenue: "الإيراد",
    roas: "ROAS",
    won: "المبيعات",
    sortBy: "ترتيب حسب",
    reset: "الترتيب الأصلي",
  },
  en: {
    campaign: "Campaign",
    platform: "Platform",
    spend: "Spend",
    revenue: "Revenue",
    roas: "ROAS",
    won: "Won",
    sortBy: "Sort by",
    reset: "Original order",
  },
} as const;

/**
 * The long tail, compact.
 *
 * Only the first five rows are in the DOM; "show more" is local state and never
 * calls the model. Sorting is local too — re-ordering rows the page already
 * holds is not a business judgement, and the incoming order IS the backend's
 * ranking, which `reset` restores.
 *
 * On a narrow screen the table becomes a stacked list rather than scrolling
 * sideways: a five-column table inside a 390px panel is unreadable either way,
 * and horizontal overflow hides the numbers that matter.
 */
export function CampaignTable({
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
  const t = L[lang];
  const [visible, setVisible] = useState(TABLE_INITIAL_ROWS);
  const [sort, setSort] = useState<SortKey>(null);
  const ordered = sortRows(
    campaigns as unknown as Array<Record<string, unknown>>,
    sort,
  ) as unknown as NexusCampaign[];
  const rows = ordered.slice(0, visible);
  const more = moreControl(campaigns.length, visible, lang);

  const sorts: Array<[SortKey, string]> = [
    ["revenue", t.revenue],
    ["roas", t.roas],
    ["spend", t.spend],
    ["won", t.won],
  ];

  return (
    <div data-testid="nexus-campaign-table">
      <div className="mb-1.5 flex flex-wrap items-center gap-1">
        <span className="text-[11px] text-text-muted">{t.sortBy}</span>
        {sorts.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSort(sort === key ? null : key)}
            aria-pressed={sort === key}
            className={`rounded border px-1.5 py-0.5 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              sort === key
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-text-muted hover:bg-surface-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Wide: a real table. */}
      <div className="hidden sm:block">
        <table className="w-full table-fixed text-xs">
          <thead>
            <tr className="text-text-muted">
              <th className="w-[38%] py-1 text-start font-medium">{t.campaign}</th>
              <th className="w-[14%] py-1 text-start font-medium">{t.platform}</th>
              <th className="py-1 text-end font-medium">{t.spend}</th>
              <th className="py-1 text-end font-medium">{t.revenue}</th>
              <th className="py-1 text-end font-medium">{t.roas}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((campaign) => (
              <tr
                key={campaign.key}
                className="cursor-pointer border-t border-border hover:bg-surface-muted"
                onClick={() =>
                  !disabled &&
                  onSend(
                    lang === "ar"
                      ? `حلل حملة ${campaign.name}`
                      : `Analyse campaign ${campaign.name}`,
                  )
                }
                tabIndex={0}
                role="button"
                aria-label={campaign.name}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (!disabled) {
                      onSend(
                        lang === "ar"
                          ? `حلل حملة ${campaign.name}`
                          : `Analyse campaign ${campaign.name}`,
                      );
                    }
                  }
                }}
              >
                <td className="truncate py-1.5 pe-2">
                  <LtrText>{campaign.name}</LtrText>
                </td>
                <td className="truncate py-1.5 text-text-muted">
                  <LtrText>{campaign.platform ?? "—"}</LtrText>
                </td>
                <td className="num py-1.5 text-end">{formatMoney(campaign.spend, "USD")}</td>
                <td className="num py-1.5 text-end">{formatMoney(campaign.revenue, "USD")}</td>
                <td className="num py-1.5 text-end">{formatRatio(campaign.roas)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Narrow: stacked rows, no horizontal scroll. */}
      <ul className="sm:hidden" data-testid="nexus-campaign-list">
        {rows.map((campaign) => (
          <li key={campaign.key} className="border-t border-border py-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onSend(
                  lang === "ar" ? `حلل حملة ${campaign.name}` : `Analyse campaign ${campaign.name}`,
                )
              }
              className="w-full text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="block truncate text-xs font-medium text-text">
                <LtrText>{campaign.name}</LtrText>
              </span>
              <span className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-text-muted">
                <span className="num">
                  {t.revenue} {formatMoney(campaign.revenue, "USD")}
                </span>
                <span className="num">
                  {t.roas} {formatRatio(campaign.roas)}
                </span>
                <span className="num">
                  {t.won} {formatCount(campaign.won)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {more.show ? (
        <button
          type="button"
          onClick={() => setVisible((value) => value + TABLE_PAGE_SIZE)}
          className="mt-1.5 rounded text-xs font-medium text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          data-testid="nexus-campaign-more"
        >
          {more.label}
        </button>
      ) : null}
    </div>
  );
}
