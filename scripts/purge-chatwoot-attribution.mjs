/** Run from a Railway-private process after reviewing CHATWOOT_ATTRIBUTION_RETENTION_DAYS. */
import { purgeExpiredAttributionData } from "../src/lib/chatwoot-attribution.server.ts";

const index = process.argv.indexOf("--retention-days");
const requested = index >= 0 ? Number(process.argv[index + 1]) : undefined;
if (
  requested !== undefined &&
  (!Number.isInteger(requested) || requested < 30 || requested > 3_650)
) {
  throw new Error("--retention-days must be an integer from 30 to 3650.");
}

console.log(
  JSON.stringify(await purgeExpiredAttributionData({ retentionDays: requested }), null, 2),
);
