/**
 * Applies the manual lead QA migration explicitly.
 *
 *   DATABASE_URL=... npm run migrate:lead-qa
 *
 * Idempotent: re-running reports "already applied" and changes nothing. The
 * same migration also runs at server start (src/server.ts).
 */
import { LEAD_QA_MIGRATION_ID, runLeadQaMigration } from "../src/lib/lead-qa.server.ts";

if (!process.env.DATABASE_URL?.trim()) {
  console.error("DATABASE_URL is required to apply the lead QA migration.");
  process.exit(1);
}

try {
  const { applied } = await runLeadQaMigration();
  console.log(
    `lead QA migration ${LEAD_QA_MIGRATION_ID}: ${applied ? "applied" : "already applied"}`,
  );
  process.exit(0);
} catch (error) {
  console.error(
    `lead QA migration ${LEAD_QA_MIGRATION_ID} failed:`,
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}
