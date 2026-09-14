import assert from "node:assert/strict";
import {
  CRM_CONTRACT_VERSION,
  crmBusinessStatus,
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

console.log("CRM 1.26 contract tests passed");
