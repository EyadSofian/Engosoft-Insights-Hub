// Read-only: print aggregates for the four verified employees, never tokens,
// customer numbers, call notes, recordings or transcripts.
import { readVerifiedEmployeeCalls } from "../src/lib/yeastar-employee-calls.server.ts";
import { YEASTAR_EMPLOYEE_IDENTITIES } from "../src/lib/yeastar-employee-identity.ts";

const [from, to] = process.argv.slice(2);
if (!from || !to) throw Error("Usage: vite-node scripts/audit-yeastar-nesting.mjs FROM TO");
const result = await readVerifiedEmployeeCalls(from, to);
console.log(
  JSON.stringify({
    from,
    to,
    fetchedAt: result.fetchedAt,
    employees: result.employees.map((row) => ({
      email: YEASTAR_EMPLOYEE_IDENTITIES.find((person) => person.extension === row.extension)
        ?.email,
      extension: row.extension,
      name: row.name,
      totalCalls: row.totalCalls,
      answeredCalls: row.answeredCalls,
      talkSeconds: row.periodTalkSeconds,
      callSeconds: row.periodCallSeconds,
    })),
  }),
);
