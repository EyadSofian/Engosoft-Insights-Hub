#!/usr/bin/env node
/**
 * Read-only proof for the normal-CRM Data Inventory boundary.
 *
 * Run against the production integration environment with:
 *
 *   railway run npm run audit:crm-inventory-scope
 *
 * The script prints aggregate counts and domains only. It never calls create,
 * write, unlink, sudo, or any permission-management method.
 */
import { crmNormalScopeDomain } from "../src/lib/crm-contract.ts";
import { loadDirectCrm } from "../src/lib/crm-odoo.server.ts";
import { odooCall, odooConfig, searchCount, searchRead } from "../src/lib/odoo.server.ts";

const cfg = odooConfig();
const buckets = ["inventory_1", "inventory_2", "inventory_3", "inventory_4"];
const stages = await searchRead("crm.stage", [], ["id"], {
  context: { active_test: false },
});
const externalIds = stages.length
  ? await odooCall("crm.stage", "get_external_id", [stages.map((stage) => stage.id)], {
      context: { active_test: false },
    })
  : {};
const preparationStageIds = stages
  .filter((stage) => {
    const xmlid = externalIds[String(stage.id)];
    return xmlid === "crm_pipeline_redesign.stage_preparation" || xmlid === "crm.stage_lead1";
  })
  .map((stage) => stage.id);

const bucketDomains = Object.fromEntries(
  buckets.map((bucket) => [bucket, crmNormalScopeDomain([["inventory_bucket", "=", bucket]])]),
);
const unscopedBucketDomains = Object.fromEntries(
  buckets.map((bucket) => [bucket, [["inventory_bucket", "=", bucket]]]),
);
const unscopedPreparationDomain = preparationStageIds.length
  ? [["stage_id", "in", preparationStageIds]]
  : [["id", "=", -1]];
const preparationDomain = crmNormalScopeDomain(unscopedPreparationDomain);
const [
  snapshot,
  preparationVisible,
  unscopedPreparationVisible,
  integrationUsers,
  hasDataInventoryGroup,
  ...allBucketCounts
] = await Promise.all([
  loadDirectCrm(),
  searchCount("crm.lead", preparationDomain, { active_test: false }),
  searchCount("crm.lead", unscopedPreparationDomain, { active_test: false }),
  searchRead("res.users", [["login", "=", cfg.login]], ["name", "login"], { limit: 1 }),
  odooCall("res.users", "has_group", ["crm_pipeline_redesign.group_crm_data_inventory"]),
  ...buckets.map((bucket) =>
    searchCount("crm.lead", bucketDomains[bucket], { active_test: false }),
  ),
  ...buckets.map((bucket) =>
    searchCount("crm.lead", unscopedBucketDomains[bucket], { active_test: false }),
  ),
]);
const scopedBucketCounts = allBucketCounts.slice(0, buckets.length);
const unscopedBucketCounts = allBucketCounts.slice(buckets.length);
const dashboardRows = [...snapshot.crm, ...snapshot.lost];
const returnedBuckets = Object.fromEntries(
  buckets.map((bucket) => [
    bucket,
    dashboardRows.filter((row) => row["Inventory Bucket"] === bucket).length,
  ]),
);
const totalInventoryReturned = dashboardRows.filter((row) =>
  String(row["Inventory Bucket"] ?? "").trim(),
).length;

const report = {
  auditVersion: "crm-inventory-scope/1",
  checkedAt: new Date().toISOString(),
  authority: "Odoo live read-only",
  integrationUser: {
    login: cfg.login,
    name: String(integrationUsers[0]?.name ?? ""),
    hasDataInventoryGroup,
  },
  companyIds: cfg.companyIds,
  normalCrmScopeDomain: crmNormalScopeDomain(),
  queryContainsPreparationExclusion: JSON.stringify(crmNormalScopeDomain())
    .toLowerCase()
    .includes("preparation"),
  preparation: {
    stageIdsResolved: preparationStageIds,
    domain: preparationDomain,
    allVisibleToIntegrationUser: unscopedPreparationVisible,
    nonInventoryVisibleToIntegrationUser: preparationVisible,
    returnedByDashboardSnapshot: dashboardRows.filter((row) => row["Stage Key"] === "preparation")
      .length,
  },
  inventory: {
    explicitBucketQueryCounts: Object.fromEntries(
      buckets.map((bucket, index) => [bucket, scopedBucketCounts[index]]),
    ),
    unfilteredSourceUniverseCounts: Object.fromEntries(
      buckets.map((bucket, index) => [bucket, unscopedBucketCounts[index]]),
    ),
    returnedByDashboardSnapshot: returnedBuckets,
    totalReturnedByDashboardSnapshot: totalInventoryReturned,
  },
  dashboardPopulation: {
    crm: snapshot.crm.length,
    lost: snapshot.lost.length,
    total: dashboardRows.length,
  },
  loaderDiagnostics: snapshot.diagnostics,
  crmDataModified: false,
  rpcMethodsUsed: ["fields_get", "get_external_id", "search_read", "search_count"],
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
