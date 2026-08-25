import assert from "node:assert/strict";
import {
  calculateEmployeePerformanceScore,
  EMPLOYEE_SCORE_WEIGHTS,
} from "../src/lib/employee-performance-score.ts";

const complete = (overrides = {}) => ({
  averageQualityScore: 100,
  analyzedCalls: 10,
  answeredCalls: 10,
  distributedLeads: 100,
  ownerCalledDistributedLeads: 100,
  leadOwnerCallCoverageRate: 100,
  cleanLeads: 20,
  conversionRate: 20,
  chatConversations: 10,
  chatAwaitingReply: 0,
  chatUnreadConversations: 0,
  targetAchievementOrders: 100,
  targetAchievementPaid: 100,
  targetComplete: true,
  ...overrides,
});

{
  const score = calculateEmployeePerformanceScore(complete());
  assert.equal(score.overall, 100);
  assert.equal(score.dataCoverage, 100);
  assert.deepEqual(score.weights, EMPLOYEE_SCORE_WEIGHTS);
  assert.deepEqual(score.missing, []);
}

{
  // The production failure this policy replaces: one perfect audit and only
  // ten of one hundred assigned leads called must never display 99/100.
  const score = calculateEmployeePerformanceScore(
    complete({
      analyzedCalls: 1,
      answeredCalls: 10,
      ownerCalledDistributedLeads: 10,
      leadOwnerCallCoverageRate: 10,
    }),
  );
  assert.equal(score.evidence.callAnalysisCoverageRate, 10);
  assert.equal(score.earnedPoints.callQuality, 2.5);
  assert.equal(score.earnedPoints.salesExecution, 11.1);
  assert.equal(score.overall, 58.6);
  assert.ok(score.overall < 60, "tiny audits and poor lead coverage cannot look excellent");
}

{
  // Missing integrations contribute no points and never make the metrics that
  // remain available carry a larger share of the denominator.
  const score = calculateEmployeePerformanceScore(
    complete({
      averageQualityScore: null,
      analyzedCalls: null,
      answeredCalls: null,
      distributedLeads: 0,
      ownerCalledDistributedLeads: null,
      leadOwnerCallCoverageRate: null,
      cleanLeads: 0,
      conversionRate: null,
      chatConversations: null,
      chatAwaitingReply: null,
      chatUnreadConversations: null,
    }),
  );
  assert.equal(score.overall, 25, "a met target earns its own 25 points, not 100");
  assert.equal(score.dataCoverage, 25);
  assert.deepEqual(score.missing, ["callQuality", "salesExecution", "chatFollowUp"]);
}

{
  const score = calculateEmployeePerformanceScore(
    complete({
      targetAchievementOrders: 180,
      targetAchievementPaid: 180,
      targetComplete: false,
    }),
  );
  assert.equal(score.targetAttainment, null, "a partial target window is not scoreable");
  assert.equal(score.earnedPoints.targetAttainment, 0);
  assert.ok(score.missing.includes("targetAttainment"));
}

{
  const score = calculateEmployeePerformanceScore(
    complete({
      targetAchievementOrders: 40,
      targetAchievementPaid: 100,
      chatAwaitingReply: 4,
      chatUnreadConversations: 2,
    }),
  );
  assert.equal(score.targetAttainment, 40, "confirmed orders are the primary sales basis");
  assert.equal(score.evidence.targetBasis, "orders");
  assert.equal(score.chatFollowUp, 64);
  assert.equal(score.evidence.chatRepliedConversations, 6);
}

console.log("employee performance score tests passed.");
