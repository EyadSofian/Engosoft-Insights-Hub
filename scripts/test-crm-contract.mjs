import assert from "node:assert/strict";
import {
  CRM_CONTRACT_VERSION,
  CRM_SNAPSHOT_SCHEMA_REVISION,
  CRM_SNAPSHOT_REVISION,
  CRM_STAGE_EXTERNAL_IDS,
  crmBusinessStatus,
  crmSnapshotRevision,
  crmStageKeyForExternalId,
  isCanonicalLost,
  isCanonicalWon,
} from "../src/lib/crm-contract.ts";

const record = (overrides = {}) => ({
  type: "lead",
  active: true,
  stageIsLost: false,
  stageIsWon: false,
  hasLostReason: false,
  ...overrides,
});

assert.equal(CRM_CONTRACT_VERSION, "17.0.1.26.0");
assert.equal(CRM_SNAPSHOT_SCHEMA_REVISION, "normal-crm-inventory-scope-v3");

assert.equal(crmBusinessStatus(record()), "lead", "active Lead stays workable");
assert.equal(
  crmBusinessStatus(record({ active: false, hasLostReason: true })),
  "lost",
  "archived Lead with a reason is Lost even though its stage is preserved",
);
assert.equal(
  crmBusinessStatus(record({ active: false })),
  null,
  "archived Lead without a reason is not a business loss",
);

assert.equal(
  isCanonicalLost(
    record({ type: "opportunity", active: true, stageIsLost: true, hasLostReason: false }),
  ),
  true,
  "current Lost Opportunity needs the Lost stage, not a reason",
);
assert.equal(
  isCanonicalLost(
    record({ type: "opportunity", active: false, stageIsLost: false, hasLostReason: true }),
  ),
  true,
  "historical archived Opportunity with a reason remains Lost",
);
assert.equal(
  isCanonicalLost(
    record({ type: "opportunity", active: true, stageIsLost: false, hasLostReason: true }),
  ),
  false,
  "re-opened active Opportunity is not Lost merely because its reason remains",
);

assert.equal(
  isCanonicalWon(record({ type: "opportunity", stageIsWon: true })),
  true,
  "Won follows the stage even when probability is anomalous",
);
assert.equal(
  isCanonicalWon(record({ type: "lead", stageIsWon: true })),
  false,
  "a Lead is never a canonical Won Opportunity",
);

assert.equal(crmStageKeyForExternalId("crm_pipeline_redesign.stage_quotation_sent"), "quotation");
assert.equal(
  crmStageKeyForExternalId("crm.stage_lead4"),
  "quotation",
  "Quotation Sent is also published under its documented core XMLID",
);
assert.equal(
  crmStageKeyForExternalId("crm.stage_lead1"),
  "preparation",
  "Preparation is also published under its documented core XMLID",
);
assert.equal(
  crmStageKeyForExternalId("crm.stage_lead2"),
  "other",
  "a retired stage is not a lifecycle lane",
);
assert.equal(crmStageKeyForExternalId(false), "other", "a stage without an XMLID is never guessed");

assert.ok(CRM_SNAPSHOT_REVISION.startsWith(`${CRM_CONTRACT_VERSION}|`));
assert.ok(CRM_SNAPSHOT_REVISION.includes(`schema=${CRM_SNAPSHOT_SCHEMA_REVISION}`));
assert.notEqual(
  crmSnapshotRevision(
    new Map([...CRM_STAGE_EXTERNAL_IDS].filter(([xmlid]) => xmlid !== "crm.stage_lead4")),
  ),
  CRM_SNAPSHOT_REVISION,
  "a snapshot classified by an earlier stage table is not current",
);
assert.equal(
  crmSnapshotRevision(new Map([...CRM_STAGE_EXTERNAL_IDS].reverse())),
  CRM_SNAPSHOT_REVISION,
  "the revision does not depend on table order",
);

console.log("CRM 1.26 contract tests passed");
