import assert from "node:assert/strict";
import { dashboardRowsContentHash, prepareDashboardRows } from "../src/lib/dashboard-db.server.ts";

/* Order-grain ids must never erase line-grain facts. */
{
  const input = [
    { "Order ID": "SO-42", Product: "PMP", Amount: "100" },
    { "Order ID": "SO-42", Product: "FM", Amount: "200" },
  ];
  const result = prepareDashboardRows("invoiced", input);
  assert.equal(result.rows.length, 2);
  assert.equal(new Set(result.rows.map((row) => row.key)).size, 2);
  assert.equal(result.duplicates, 0);
}

/* A bad source may put the parent order in __odoo_id. Keep both lines anyway. */
{
  const input = [
    { __odoo_id: "77", Product: "PMP", Amount: "100" },
    { __odoo_id: "77", Product: "FM", Amount: "200" },
  ];
  const result = prepareDashboardRows("invoiced", input);
  assert.equal(result.rows.length, 2);
  assert.equal(new Set(result.rows.map((row) => row.key)).size, 2);
  assert.equal(result.duplicates, 1);
}

/* Even identical lines are payload rows; replace semantics preserves both. */
{
  const input = [
    { __odoo_id: "77", Product: "PMP", Amount: "100" },
    { __odoo_id: "77", Product: "PMP", Amount: "100" },
  ];
  const result = prepareDashboardRows("invoiced", input);
  assert.equal(result.rows.length, 2);
  assert.equal(new Set(result.rows.map((row) => row.key)).size, 2);
}

/* Transport timestamps do not force a multi-megabyte rewrite. */
{
  const before = prepareDashboardRows("meta_ads", [
    { __meta_key: "day|1", Spend: "12", __synced_at: "2026-08-20T01:00:00Z" },
  ]).rows;
  const after = prepareDashboardRows("meta_ads", [
    { __meta_key: "day|1", Spend: "12", __synced_at: "2026-08-20T01:30:00Z" },
  ]).rows;
  assert.equal(dashboardRowsContentHash(before), dashboardRowsContentHash(after));
}

console.log("dashboard database guards passed");
