import { getSharedDatabasePool } from "./database-pool.server";
import type { Platform } from "./types";

interface AccountRow {
  dataset: string;
  account_id: string;
  account_name: string;
  from_date: string | null;
  to_date: string | null;
}

export interface SpendCoverageGap {
  platform: "meta" | "snapchat" | "tiktok" | "google";
  account: string;
  from: string;
  to: string;
}

export interface SpendCoverage {
  complete: boolean;
  provisionalToday: boolean;
  checkedFrom: string;
  checkedTo: string;
  gaps: SpendCoverageGap[];
}

const MILLIS_PER_DAY = 86_400_000;
const day = (value: string) => Math.floor(Date.parse(`${value}T00:00:00Z`) / MILLIS_PER_DAY);
const iso = (value: number) => new Date(value * MILLIS_PER_DAY).toISOString().slice(0, 10);

function cairoToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const find = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${find("year")}-${find("month")}-${find("day")}`;
}

/**
 * Coverage is about source collection, not whether an account spent money.
 * An account with zero spend still needs a successfully fetched date window.
 */
export async function getAdSpendCoverage(input: {
  from?: string;
  to?: string;
  platform?: Platform;
  account?: string;
}): Promise<SpendCoverage> {
  const checkedFrom = input.from || "2026-01-01";
  const today = cairoToday();
  const checkedTo = [input.to || today, today].sort()[0];
  const provisionalToday = checkedTo === today && checkedFrom <= today;
  if (checkedFrom > checkedTo) {
    return { complete: true, provisionalToday: false, checkedFrom, checkedTo, gaps: [] };
  }

  const gaps: SpendCoverageGap[] = [];
  const selected = (platform: Platform) => !input.platform || input.platform === platform;
  const accountFilter = input.account?.trim().toLowerCase();
  const addPrefixGap = (platform: "tiktok" | "google", configuredStart: string) => {
    if (!selected(platform) || (accountFilter && !input.platform) || checkedFrom >= configuredStart)
      return;
    const to = iso(Math.min(day(checkedTo), day(configuredStart) - 1));
    gaps.push({ platform, account: "all", from: checkedFrom, to });
  };
  addPrefixGap("tiktok", process.env.TIKTOK_START_DATE || `${cairoToday().slice(0, 4)}-01-01`);
  addPrefixGap("google", process.env.GOOGLE_ADS_START_DATE || `${cairoToday().slice(0, 4)}-01-01`);

  if (selected("meta") || selected("snapchat")) {
    try {
      const result = await getSharedDatabasePool().query<AccountRow>(
        `
        SELECT a.dataset, a.account_id, a.account_name,
          c.from_date::text, c.to_date::text
        FROM ad_delivery_accounts a
        LEFT JOIN ad_delivery_coverage c
          ON c.dataset = a.dataset AND c.account_id = a.account_id
          AND c.to_date >= $1::date AND c.from_date <= $2::date
        WHERE a.dataset IN ('meta_ads', 'snap_ads')
        ORDER BY a.dataset, a.account_id, c.from_date`,
        [checkedFrom, checkedTo],
      );
      const byAccount = new Map<
        string,
        { platform: "meta" | "snapchat"; name: string; windows: [number, number][] }
      >();
      for (const row of result.rows) {
        const platform = row.dataset === "meta_ads" ? "meta" : "snapchat";
        if (!selected(platform)) continue;
        if (
          accountFilter &&
          ![row.account_id, row.account_name.toLowerCase()].includes(accountFilter)
        )
          continue;
        const key = `${row.dataset}:${row.account_id}`;
        if (!byAccount.has(key))
          byAccount.set(key, { platform, name: row.account_name, windows: [] });
        if (row.from_date && row.to_date) {
          byAccount.get(key)!.windows.push([day(row.from_date), day(row.to_date)]);
        }
      }

      for (const platform of ["meta", "snapchat"] as const) {
        if (!selected(platform)) continue;
        const accounts = [...byAccount.values()].filter((row) => row.platform === platform);
        if (!accounts.length && (!accountFilter || input.platform === platform)) {
          gaps.push({ platform, account: "unverified accounts", from: checkedFrom, to: checkedTo });
        }
        for (const account of accounts) {
          let cursor = day(checkedFrom);
          // Today's platform totals are a live snapshot, not a full-day result.
          // Never call the sync heartbeat proof that all ad rows were fetched.
          const end = day(checkedTo) - (provisionalToday ? 1 : 0);
          for (const [start, stop] of account.windows.sort(([a], [b]) => a - b)) {
            if (start > cursor && cursor <= end) {
              gaps.push({
                platform,
                account: account.name,
                from: iso(cursor),
                to: iso(Math.min(end, start - 1)),
              });
            }
            cursor = Math.max(cursor, stop + 1);
            if (cursor > end) break;
          }
          if (cursor <= end)
            gaps.push({ platform, account: account.name, from: iso(cursor), to: iso(end) });
        }
      }
    } catch (error) {
      for (const platform of ["meta", "snapchat"] as const) {
        if (selected(platform)) {
          gaps.push({
            platform,
            account: "coverage check unavailable",
            from: checkedFrom,
            to: checkedTo,
          });
        }
      }
      console.error("Ad spend coverage check failed", error);
    }
  }
  return { complete: gaps.length === 0, provisionalToday, checkedFrom, checkedTo, gaps };
}
