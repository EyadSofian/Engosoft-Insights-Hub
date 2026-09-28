#!/usr/bin/env node
/** Read-only annual CRM source audit; prints aggregate counts, never lead details. */
import { loadHistoricalCrmYear } from "../src/lib/crm-odoo.server.ts";
import { searchCount } from "../src/lib/odoo.server.ts";

for (const year of [2024, 2025]) {
  const rows = await loadHistoricalCrmYear(year);
  const leads = rows.reduce((total, row) => total + row.leads, 0);
  const inventory = rows.reduce((total, row) => total + row.inventoryLeads, 0);
  const won = rows.reduce((total, row) => total + row.won, 0);
  const lost = rows.reduce((total, row) => total + row.lost, 0);
  const rawCount = await searchCount(
    "crm.lead",
    [
      ["create_date", ">=", `${year}-01-01 00:00:00`],
      ["create_date", "<", `${year + 1}-01-01 00:00:00`],
    ],
    { active_test: false },
  );
  process.stdout.write(
    `${JSON.stringify({ year, leads, inventory, won, lost, dailyCourseRows: rows.length, rawUtcCount: rawCount })}\n`,
  );
}
