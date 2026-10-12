import type { AccountInfo } from "./sheet-cache.server";
import type { AdRow } from "./types";

/** Account detail must use the same filtered daily facts as the spend headline. */
export function aggregateAdAccounts(ads: AdRow[]): AccountInfo[] {
  const accounts = new Map<string, AccountInfo>();
  for (const ad of ads) {
    const key = `${ad.platform}:${ad.accountId || ad.account}`;
    let account = accounts.get(key);
    if (!account) {
      account = {
        name: ad.account,
        id: ad.accountId,
        platform: ad.platform,
        objective: ad.objective,
        spend: 0,
        platformLeads: null,
      };
      accounts.set(key, account);
    }
    account.spend += ad.spend;
    if (ad.platformLeads !== null) {
      account.platformLeads = (account.platformLeads ?? 0) + ad.platformLeads;
    }
  }
  return [...accounts.values()].sort((left, right) => right.spend - left.spend);
}
