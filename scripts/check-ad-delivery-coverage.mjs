/** Check the same spend-completeness decision used by /api/overview. */
import { getAdSpendCoverage } from "../src/lib/ad-delivery-coverage.server";

if (process.env.DATABASE_PUBLIC_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}
const [from, to, platform] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "")) {
  throw new Error("Use FROM TO [platform].");
}
const coverage = await getAdSpendCoverage({ from, to, platform });
console.log(JSON.stringify(coverage, null, 2));
