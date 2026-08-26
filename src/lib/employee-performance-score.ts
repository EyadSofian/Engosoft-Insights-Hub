/**
 * A conservative employee score built only from facts already visible in the
 * profile.  It deliberately keeps a fixed 100-point denominator: an absent
 * integration or a tiny sample never makes the other metrics look better.
 */

export const EMPLOYEE_SCORE_WEIGHTS = {
  callQuality: 25,
  salesExecution: 30,
  chatFollowUp: 20,
  targetAttainment: 25,
} as const;

export const EMPLOYEE_SCORE_RULES = {
  minimumCallAudits: 5,
  minimumLeadSample: 10,
  minimumChatSample: 10,
  conversionBenchmarkPercent: 20,
  leadCoverageShare: 70,
  leadConversionShare: 30,
  chatReplyShare: 80,
  chatReadShare: 20,
} as const;

export type EmployeeScoreComponent =
  | "callQuality"
  | "salesExecution"
  | "chatFollowUp"
  | "targetAttainment";

export interface EmployeePerformanceScoreInput {
  averageQualityScore: number | null;
  analyzedCalls: number | null;
  answeredCalls: number | null;
  distributedLeads: number;
  ownerCalledDistributedLeads: number | null;
  leadOwnerCallCoverageRate: number | null;
  cleanLeads: number;
  conversionRate: number | null;
  chatConversations: number | null;
  chatAwaitingReply: number | null;
  chatUnreadConversations: number | null;
  targetAchievementOrders: number | null;
  targetAchievementPaid: number | null;
  targetComplete: boolean;
}

export interface AgentPerformanceScore {
  /** Points earned out of a fixed 100; unavailable evidence is never reweighted. */
  overall: number | null;
  callQuality: number | null;
  salesExecution: number | null;
  chatFollowUp: number | null;
  targetAttainment: number | null;
  weights: typeof EMPLOYEE_SCORE_WEIGHTS;
  /** How much of the 100-point score is supported by enough source evidence. */
  dataCoverage: number;
  missing: EmployeeScoreComponent[];
  earnedPoints: Record<EmployeeScoreComponent, number>;
  evidence: {
    analyzedCalls: number;
    answeredCalls: number | null;
    callAnalysisCoverageRate: number | null;
    callEvidenceFactor: number;
    distributedLeads: number;
    ownerCalledDistributedLeads: number | null;
    leadCoverageRate: number | null;
    leadConversionRate: number | null;
    normalizedConversionScore: number | null;
    conversionBenchmarkPercent: number;
    chatConversations: number;
    chatRepliedConversations: number;
    chatAwaitingReply: number;
    chatUnreadConversations: number;
    targetAchievement: number | null;
    targetBasis: "orders" | "collections" | null;
    targetComplete: boolean;
  };
}

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));
const finitePercent = (value: number | null): number | null =>
  value !== null && Number.isFinite(value) ? clampPercent(value) : null;
const safeCount = (value: number | null): number =>
  value !== null && Number.isFinite(value) ? Math.max(0, value) : 0;
const rounded = (value: number) => Math.round(value * 10) / 10;

export function calculateEmployeePerformanceScore(
  input: EmployeePerformanceScoreInput,
): AgentPerformanceScore {
  const callQuality =
    safeCount(input.analyzedCalls) > 0 ? finitePercent(input.averageQualityScore) : null;
  const analyzedCalls = safeCount(input.analyzedCalls);
  const answeredCalls =
    input.answeredCalls !== null && Number.isFinite(input.answeredCalls)
      ? Math.max(0, input.answeredCalls)
      : null;
  const callAnalysisCoverageRate =
    answeredCalls !== null && answeredCalls > 0
      ? clampPercent((analyzedCalls / answeredCalls) * 100)
      : null;
  const callEvidenceFactor =
    callQuality === null
      ? 0
      : Math.min(
          1,
          analyzedCalls / EMPLOYEE_SCORE_RULES.minimumCallAudits,
          (callAnalysisCoverageRate ?? 0) / 100,
        );
  const callEffectiveWeight = EMPLOYEE_SCORE_WEIGHTS.callQuality * callEvidenceFactor;
  const callPoints = (callQuality ?? 0) * callEffectiveWeight / 100;

  const distributedLeads = Math.max(0, input.distributedLeads);
  const ownerCalledDistributedLeads =
    input.ownerCalledDistributedLeads !== null &&
    Number.isFinite(input.ownerCalledDistributedLeads)
      ? Math.max(0, input.ownerCalledDistributedLeads)
      : null;
  const leadCoverageRate =
    distributedLeads > 0 ? finitePercent(input.leadOwnerCallCoverageRate) : null;
  const leadConversionRate =
    input.cleanLeads > 0 ? finitePercent(input.conversionRate) : null;
  const normalizedConversionScore =
    leadConversionRate === null
      ? null
      : clampPercent(
          (leadConversionRate / EMPLOYEE_SCORE_RULES.conversionBenchmarkPercent) * 100,
        );
  const leadSampleFactor = Math.min(
    1,
    Math.max(0, input.cleanLeads) / EMPLOYEE_SCORE_RULES.minimumLeadSample,
  );
  const coverageWeight =
    leadCoverageRate === null
      ? 0
      : EMPLOYEE_SCORE_WEIGHTS.salesExecution *
        (EMPLOYEE_SCORE_RULES.leadCoverageShare / 100);
  const conversionWeight =
    normalizedConversionScore === null
      ? 0
      : EMPLOYEE_SCORE_WEIGHTS.salesExecution *
        (EMPLOYEE_SCORE_RULES.leadConversionShare / 100) *
        leadSampleFactor;
  const salesPoints =
    (leadCoverageRate ?? 0) * coverageWeight / 100 +
    (normalizedConversionScore ?? 0) * conversionWeight / 100;
  // This is the conservative contribution expressed on a 0..100 component
  // scale. A missing sub-metric or tiny conversion sample remains visible as
  // unearned evidence instead of being redistributed to the other sub-metric.
  const salesExecution =
    coverageWeight + conversionWeight > 0
      ? clampPercent((salesPoints / EMPLOYEE_SCORE_WEIGHTS.salesExecution) * 100)
      : null;

  const conversations = safeCount(input.chatConversations);
  const awaiting = safeCount(input.chatAwaitingReply);
  const unread = safeCount(input.chatUnreadConversations);
  const repliedConversations = Math.max(0, conversations - Math.min(conversations, awaiting));
  const chatFollowUp =
    input.chatConversations === null || conversations === 0
      ? null
      : clampPercent(
          EMPLOYEE_SCORE_RULES.chatReplyShare * (repliedConversations / conversations) +
            EMPLOYEE_SCORE_RULES.chatReadShare *
              (1 - Math.min(1, unread / conversations)),
        );
  const chatSampleFactor = Math.min(
    1,
    conversations / EMPLOYEE_SCORE_RULES.minimumChatSample,
  );
  const chatEffectiveWeight =
    chatFollowUp === null ? 0 : EMPLOYEE_SCORE_WEIGHTS.chatFollowUp * chatSampleFactor;
  const chatPoints = (chatFollowUp ?? 0) * chatEffectiveWeight / 100;

  // Confirmed sale orders measure what the employee sold inside the selected
  // window. Collections are a documented fallback because payment can arrive
  // after the salesperson did the work. An incomplete target window is never
  // scored: whole-window sales divided by a partial quota can exceed 100% by
  // construction and was the source of misleading target cards.
  const orderAchievement = finitePercent(input.targetAchievementOrders);
  const paidAchievement = finitePercent(input.targetAchievementPaid);
  const targetBasis = !input.targetComplete
    ? null
    : orderAchievement !== null
      ? "orders" as const
      : paidAchievement !== null
        ? "collections" as const
        : null;
  const targetAttainment =
    targetBasis === "orders"
      ? orderAchievement
      : targetBasis === "collections"
        ? paidAchievement
        : null;
  const targetEffectiveWeight =
    targetAttainment === null ? 0 : EMPLOYEE_SCORE_WEIGHTS.targetAttainment;
  const targetPoints = (targetAttainment ?? 0) * targetEffectiveWeight / 100;

  const earnedPoints = {
    callQuality: rounded(callPoints),
    salesExecution: rounded(salesPoints),
    chatFollowUp: rounded(chatPoints),
    targetAttainment: rounded(targetPoints),
  };
  const dataCoverage = rounded(
    callEffectiveWeight +
      coverageWeight +
      conversionWeight +
      chatEffectiveWeight +
      targetEffectiveWeight,
  );
  const missing: EmployeeScoreComponent[] = [];
  if (callEvidenceFactor === 0) missing.push("callQuality");
  if (coverageWeight + conversionWeight === 0) missing.push("salesExecution");
  if (chatEffectiveWeight === 0) missing.push("chatFollowUp");
  if (targetEffectiveWeight === 0) missing.push("targetAttainment");
  const hasEvidence = dataCoverage > 0;

  return {
    overall: hasEvidence
      ? rounded(
          earnedPoints.callQuality +
            earnedPoints.salesExecution +
            earnedPoints.chatFollowUp +
            earnedPoints.targetAttainment,
        )
      : null,
    callQuality,
    salesExecution: salesExecution === null ? null : rounded(salesExecution),
    chatFollowUp: chatFollowUp === null ? null : rounded(chatFollowUp),
    targetAttainment,
    weights: EMPLOYEE_SCORE_WEIGHTS,
    dataCoverage,
    missing,
    earnedPoints,
    evidence: {
      analyzedCalls,
      answeredCalls,
      callAnalysisCoverageRate,
      callEvidenceFactor: rounded(callEvidenceFactor),
      distributedLeads,
      ownerCalledDistributedLeads,
      leadCoverageRate,
      leadConversionRate,
      normalizedConversionScore,
      conversionBenchmarkPercent: EMPLOYEE_SCORE_RULES.conversionBenchmarkPercent,
      chatConversations: conversations,
      chatRepliedConversations: repliedConversations,
      chatAwaitingReply: awaiting,
      chatUnreadConversations: unread,
      targetAchievement: targetAttainment,
      targetBasis,
      targetComplete: input.targetComplete,
    },
  };
}
