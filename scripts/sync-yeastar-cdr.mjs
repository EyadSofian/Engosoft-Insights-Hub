import { syncYeastarCdrDay, yeastarCdrCoverage } from "../src/lib/yeastar-cdr.server.ts";

const from = process.argv[2];
const to = process.argv[3];
if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? "")) {
  console.error("Usage: node --experimental-strip-types scripts/sync-yeastar-cdr.mjs FROM TO");
  process.exit(2);
}
const now = new Date();
const start = new Date(`${from}T12:00:00Z`);
const end = new Date(`${to}T12:00:00Z`);
if (start > end || end.getTime() > now.getTime() + 86_400_000) {
  console.error("Invalid CDR date range");
  process.exit(2);
}
for (let current = start; current <= end; current = new Date(current.getTime() + 86_400_000)) {
  const day = current.toISOString().slice(0, 10);
  const covered = await yeastarCdrCoverage(day, day);
  if (covered.coveredDays && day < new Date().toISOString().slice(0, 10)) continue;
  try {
    const calls = await syncYeastarCdrDay(day);
    console.log(JSON.stringify({ day, calls, status: "ok" }));
  } catch (error) {
    console.error(JSON.stringify({ day, status: "failed", error: String(error).slice(0, 120) }));
    process.exitCode = 1;
  }
}
