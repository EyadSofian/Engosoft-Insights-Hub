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
  const recentCutoff = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  if (covered.coveredDays && day < recentCutoff) continue;
  for (let attempt = 0; attempt <= 35; attempt += 1) {
    try {
      const calls = await syncYeastarCdrDay(day);
      console.log(JSON.stringify({ day, calls, status: "ok" }));
      break;
    } catch (error) {
      const message = String(error);
      if (message.includes("Yeastar authentication failed") && attempt < 35) {
        // The PBX allows only eight live 30-minute API tokens. Previous probe
        // processes may occupy those slots; wait instead of marking every day
        // as missing or hammering authentication.
        console.log(JSON.stringify({ day, status: "waiting_for_api_token", attempt: attempt + 1 }));
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        continue;
      }
      console.error(JSON.stringify({ day, status: "failed", error: message.slice(0, 120) }));
      process.exitCode = 1;
      break;
    }
  }
}
