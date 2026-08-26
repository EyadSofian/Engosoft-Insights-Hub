// Server-only durable layer for plans edited from the dashboard.
//
// Published plans in `media-plan.ts` remain a safe seed. PostgreSQL stores one
// full, validated override per month, so adding October never replaces August
// or depends on the lifetime of one Railway container.
import {
  MEDIA_PLANS,
  mediaPlanMonths,
  normalizeMonthlyMediaPlan,
  type MonthlyMediaPlan,
} from "./media-plan";
import {
  databaseConfigured,
  readDashboardDataset,
  writeDashboardDataset,
} from "./dashboard-db.server";

const DATASET = "media_plans" as const;
const TTL_MS = 15_000;

export interface MediaPlanSourceSnapshot {
  plans: Record<string, MonthlyMediaPlan>;
  editedMonths: string[];
  editable: boolean;
  error: string;
}

let cache: { at: number; value: MediaPlanSourceSnapshot } | null = null;

const clonePlan = (plan: MonthlyMediaPlan): MonthlyMediaPlan => ({
  ...plan,
  courses: plan.courses.map((row) => ({
    ...row,
    owners: [...row.owners],
    matchTerms: row.matchTerms ? [...row.matchTerms] : [],
  })),
  additionalActivities: plan.additionalActivities.map((row) => ({
    ...row,
    matchTerms: row.matchTerms ? [...row.matchTerms] : [],
  })),
});

function seedPlans(): Record<string, MonthlyMediaPlan> {
  return Object.fromEntries(
    mediaPlanMonths().map((month) => [month, clonePlan(MEDIA_PLANS[month])]),
  );
}

function rowPlan(row: Record<string, string>): MonthlyMediaPlan {
  return normalizeMonthlyMediaPlan({
    month: row.month,
    status: row.status,
    basisMonth: row.basisMonth,
    paidLeadTarget: row.paidLeadTarget,
    organicWebinarLeadTarget: row.organicWebinarLeadTarget,
    leadGenerationBudgetUsd: row.leadGenerationBudgetUsd,
    salesTargetUsd: row.salesTargetUsd,
    courses: JSON.parse(row.courses || "[]"),
    additionalActivities: JSON.parse(row.additionalActivities || "[]"),
  });
}

export function invalidateMediaPlanCache(): void {
  cache = null;
}

export async function loadMediaPlanSource(force = false): Promise<MediaPlanSourceSnapshot> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const plans = seedPlans();
  if (!databaseConfigured()) {
    const value = { plans, editedMonths: [], editable: false, error: "" };
    cache = { at: Date.now(), value };
    return value;
  }

  const editedMonths: string[] = [];
  let error = "";
  try {
    const snapshot = await readDashboardDataset(DATASET);
    for (const row of snapshot.rows) {
      try {
        const plan = rowPlan(row);
        plans[plan.month] = plan;
        editedMonths.push(plan.month);
      } catch {
        error = "One saved media plan was invalid and the published baseline was kept instead.";
      }
    }
  } catch {
    error = "Saved media plans could not be read; showing the published baselines.";
  }

  const value = { plans, editedMonths: [...new Set(editedMonths)], editable: true, error };
  cache = { at: Date.now(), value };
  return value;
}

export async function saveMediaPlan(input: unknown, updatedBy: string): Promise<MonthlyMediaPlan> {
  if (!databaseConfigured()) throw new Error("DATABASE_URL is not configured");
  const plan = normalizeMonthlyMediaPlan(input);
  const updatedAt = new Date().toISOString();
  await writeDashboardDataset(
    DATASET,
    [
      {
        __meta_key: plan.month,
        month: plan.month,
        status: plan.status,
        basisMonth: plan.basisMonth ?? "",
        paidLeadTarget: plan.paidLeadTarget,
        organicWebinarLeadTarget: plan.organicWebinarLeadTarget,
        leadGenerationBudgetUsd: plan.leadGenerationBudgetUsd,
        salesTargetUsd: plan.salesTargetUsd,
        courses: plan.courses,
        additionalActivities: plan.additionalActivities,
        updatedAt,
        updatedBy,
      },
    ],
    {
      mode: "upsert",
      syncedAt: updatedAt,
      metadata: { source: "dashboard-media-plan-editor", month: plan.month, updatedBy },
    },
  );
  invalidateMediaPlanCache();
  return plan;
}
