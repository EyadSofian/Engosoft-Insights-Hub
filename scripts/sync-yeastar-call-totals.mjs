// Backfill the aggregate store through the same reader used by /api/teams.
// No caller numbers, raw CDR or secrets are written or printed.
import { readYeastarCallSummary } from "../src/lib/yeastar-call-summary.server.ts";
import { releaseCliAccessToken } from "../src/lib/yeastar-cdr.server.ts";
import { getSharedDatabasePool } from "../src/lib/database-pool.server.ts";

const [from, to] = process.argv.slice(2);
const valid = (day) =>
  /^\d{4}-\d{2}-\d{2}$/.test(day || "") &&
  Number.isFinite(Date.parse(day)) &&
  new Date(day).toISOString().slice(0, 10) === day;
if (!valid(from) || !valid(to) || from > to)
  throw Error("Usage: sync-yeastar-call-totals.mjs FROM TO");
const date = (at) => new Date(at).toISOString().slice(0, 10);
const week = 7 * 86_400_000;
try {
  for (let start = Date.parse(from); start <= Date.parse(to); start += week) {
    const result = await readYeastarCallSummary(
      date(start),
      date(Math.min(start + week - 86_400_000, Date.parse(to))),
    );
    console.log(
      JSON.stringify({
        ...result.range,
        extensions: result.employees.length,
        through: result.fetchedAt,
      }),
    );
  }
} finally {
  await releaseCliAccessToken();
  await getSharedDatabasePool().end();
}
