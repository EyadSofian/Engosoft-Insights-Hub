/**
 * The typed message contract between ENGO Nexus and this panel.
 *
 * WHY A SCHEMA AND NOT MARKDOWN
 *
 * A markdown-only chat forces the model to make presentation decisions —
 * which number is a headline, whether a delta is good, what colour a trend is.
 * Those are frontend decisions with business meaning, and a model asked to make
 * them will occasionally decide that a rising CPL deserves green.
 *
 * So the bot sends STRUCTURE and this file decides what it means. Every
 * renderer is selected by `type` alone. No renderer reads a colour, a CSS class
 * or a font size from the payload, because none of those fields exists here.
 *
 * TRANSPORT
 *
 * Botpress delivers these as `custom` blocks: `{ type: 'custom', name, data }`
 * where `name` is the message type below. Native Botpress blocks (text, choice,
 * card, image…) still render through their own path — this schema is additive,
 * not a replacement.
 *
 * VALIDATION
 *
 * Hand-written parsers rather than a schema library. Two reasons: this bundle
 * ships to every dashboard page and a validator is weight the launcher does not
 * need, and a parse failure here must DEGRADE (fall back to text) rather than
 * throw inside a message list. Every parser returns `null` on a shape it does
 * not recognise, and the renderer treats `null` as "render this as text".
 *
 * Pure: no React, no DOM.
 */

import type { MetricDirection, MetricUnit } from "./nexus-format";

export type NexusMessageType =
  | "text"
  | "quick_replies"
  | "kpi_card"
  | "kpi_group"
  | "comparison_card"
  | "price_card"
  | "course_selector"
  | "decision_card"
  | "chart"
  | "table"
  | "alert"
  | "progress"
  | "error"
  | "course_analysis";

/**
 * One campaign, as the analysis carries it.
 *
 * Numbers arrive as numbers and are formatted at the edge, so the card can
 * align, sort and colour them. `verdict` is the backend's judgement — the
 * frontend never decides what a good campaign is.
 */
export interface NexusCampaign {
  /** Internal. Sent back with a follow-up; never rendered. */
  key: string;
  name: string;
  platform: string | null;
  spend: number | null;
  leads: number | null;
  won: number | null;
  lost: number | null;
  revenue: number | null;
  invoices: number | null;
  orders: number | null;
  roas: number | null;
  verdict: "good" | "watch" | "weak" | null;
}

/** One sold product variant. Never carries a ROAS — see the tool that builds it. */
export interface NexusProductVariant {
  /** Internal canonical id when the catalog crosswalk resolved one. */
  productId: string | null;
  displayName: string;
  productCode: string | null;
  invoices: number | null;
  orders: number | null;
  quantity: number | null;
  revenue: number | null;
  revenueShare: number | null;
}

export interface NexusRecommendation {
  summary: string;
  reasons: string[];
  risk: string | null;
  confidence: "high" | "medium" | "low" | null;
}

export interface CourseAnalysisMessage {
  type: "course_analysis";
  course: string;
  period: { from: string; to: string; label: string } | null;
  summary: NexusMetric[];
  campaigns: NexusCampaign[];
  products: NexusProductVariant[];
  recommendation: NexusRecommendation | null;
  actions: Array<{ label: string; value: string }>;
  sources: NexusSource[];
}

/** Where a figure came from. Rendered as a badge — never invented client-side. */
export type NexusSource = "insights_hub" | "price_engo" | "engosoft_knowledge";

export interface NexusMetric {
  key: string;
  label: string;
  value: number | string | null;
  unit: MetricUnit;
  currency?: string | null;
  delta?: number | null;
  deltaUnit?: MetricUnit;
  /** Declared by the payload when known; otherwise inferred from `key`. */
  direction?: MetricDirection;
  /** Explicit note when the metric could not be measured. */
  unavailable?: string | null;
}

export interface TextMessage {
  type: "text";
  text: string;
  sources?: NexusSource[];
}

export interface QuickRepliesMessage {
  type: "quick_replies";
  text?: string;
  options: Array<{ label: string; value: string }>;
}

export interface KpiCardMessage {
  type: "kpi_card";
  metric: NexusMetric;
  period?: string | null;
  sources?: NexusSource[];
}

export interface KpiGroupMessage {
  type: "kpi_group";
  title?: string;
  metrics: NexusMetric[];
  period?: string | null;
  sources?: NexusSource[];
}

export interface ComparisonCardMessage {
  type: "comparison_card";
  title?: string;
  left: { label: string; metrics: NexusMetric[] };
  right: { label: string; metrics: NexusMetric[] };
  sources?: NexusSource[];
}

export interface PriceCardMessage {
  type: "price_card";
  productName: string;
  deliveryMode?: string | null;
  externalCode?: string | null;
  effectivePrice: number | null;
  currency: string | null;
  market?: string | null;
  paymentMethod?: string | null;
  promotion?: { campaign?: string | null; validUntil?: string | null } | null;
  validUntil?: string | null;
  available?: boolean;
  warnings?: string[];
  sources?: NexusSource[];
}

export interface CourseSelectorMessage {
  type: "course_selector";
  question: string;
  candidates: Array<{
    productId: string;
    name: string;
    deliveryMode?: string | null;
    externalCode?: string | null;
    productType?: string | null;
  }>;
}

export interface DecisionCardMessage {
  type: "decision_card";
  decision: string;
  priority?: "HIGH" | "MEDIUM" | "LOW" | null;
  summary: string;
  why?: string[];
  evidence?: string[];
  expectedImpact?: string | null;
  confidence?: "HIGH" | "MEDIUM" | "LOW" | null;
  confidenceLimitedBy?: string[];
  risk?: string[];
  owner?: string | null;
  reviewWindowDays?: number | null;
  nextKpi?: string | null;
  missingEvidence?: string[];
  /** Present only when ENGO Nexus produced a calibrated band. */
  actionBand?: { display: string; provenance: string } | null;
  recommendationId?: string | null;
  sources?: NexusSource[];
}

export interface ChartMessage {
  type: "chart";
  chartType: "line" | "bar" | "area";
  title?: string;
  xKey: string;
  series: Array<{ key: string; label: string; unit?: MetricUnit; currency?: string | null }>;
  rows: Array<Record<string, string | number | null>>;
  sources?: NexusSource[];
}

export interface TableMessage {
  type: "table";
  title?: string;
  columns: Array<{ key: string; label: string; unit?: MetricUnit; currency?: string | null }>;
  rows: Array<Record<string, string | number | null>>;
  truncated?: boolean;
  sources?: NexusSource[];
}

export interface AlertMessage {
  type: "alert";
  level: "info" | "warning" | "critical";
  title: string;
  body?: string;
  sources?: NexusSource[];
}

export interface ProgressMessage {
  type: "progress";
  label: string;
  step?: number;
  totalSteps?: number;
}

export interface ErrorMessage {
  type: "error";
  title: string;
  body?: string;
  retryable?: boolean;
}

export type NexusMessage =
  | TextMessage
  | QuickRepliesMessage
  | KpiCardMessage
  | KpiGroupMessage
  | ComparisonCardMessage
  | PriceCardMessage
  | CourseSelectorMessage
  | DecisionCardMessage
  | ChartMessage
  | TableMessage
  | AlertMessage
  | ProgressMessage
  | ErrorMessage
  | CourseAnalysisMessage;

// --- Parsing ----------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const VALID_SOURCES = new Set<NexusSource>(["insights_hub", "price_engo", "engosoft_knowledge"]);

/** Only sources the payload actually declared. Never inferred, never padded. */
export function parseSources(value: unknown): NexusSource[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is NexusSource =>
      typeof entry === "string" && VALID_SOURCES.has(entry as NexusSource),
  );
}

const VALID_UNITS = new Set<MetricUnit>(["money", "percent", "ratio", "count", "days", "text"]);

function parseUnit(value: unknown): MetricUnit {
  return typeof value === "string" && VALID_UNITS.has(value as MetricUnit)
    ? (value as MetricUnit)
    : "count";
}

const VALID_DIRECTIONS = new Set<MetricDirection>([
  "higher_is_better",
  "lower_is_better",
  "neutral",
]);

export function parseMetric(value: unknown): NexusMetric | null {
  if (!isObject(value)) return null;
  const key = str(value.key);
  const label = str(value.label) ?? key;
  if (!key || !label) return null;
  const rawValue = value.value;
  return {
    key,
    label,
    value:
      typeof rawValue === "number" && Number.isFinite(rawValue)
        ? rawValue
        : typeof rawValue === "string"
          ? rawValue
          : null,
    unit: parseUnit(value.unit),
    currency: str(value.currency),
    delta: num(value.delta),
    deltaUnit: value.deltaUnit === undefined ? "percent" : parseUnit(value.deltaUnit),
    direction:
      typeof value.direction === "string" &&
      VALID_DIRECTIONS.has(value.direction as MetricDirection)
        ? (value.direction as MetricDirection)
        : undefined,
    unavailable: str(value.unavailable),
  };
}

function parseMetrics(value: unknown): NexusMetric[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseMetric).filter((metric): metric is NexusMetric => metric !== null);
}

const LEVELS = new Set(["HIGH", "MEDIUM", "LOW"]);
const level = (value: unknown): "HIGH" | "MEDIUM" | "LOW" | null =>
  typeof value === "string" && LEVELS.has(value) ? (value as "HIGH" | "MEDIUM" | "LOW") : null;

/**
 * Parse one ENGO Nexus payload.
 *
 * Returns `null` for anything it does not recognise, which the renderer treats
 * as "fall back to plain text". A bot that starts sending a new message type
 * degrades to readable text rather than to a blank bubble or a thrown error.
 */
const VERDICTS = new Set(["good", "watch", "weak"]);
const CONFIDENCES = new Set(["high", "medium", "low"]);

const confidenceOf = (value: unknown): "high" | "medium" | "low" | null =>
  typeof value === "string" && CONFIDENCES.has(value.toLowerCase())
    ? (value.toLowerCase() as "high" | "medium" | "low")
    : null;

function parseCampaign(value: unknown): NexusCampaign | null {
  if (!isObject(value)) return null;
  const name = str(value.name);
  if (!name) return null;
  return {
    key: str(value.key) ?? str(value.campaignKey) ?? name,
    name,
    platform: str(value.platform),
    spend: num(value.spend),
    leads: num(value.leads) ?? num(value.crmLeads),
    won: num(value.won),
    lost: num(value.lost),
    revenue: num(value.revenue),
    invoices: num(value.invoices),
    orders: num(value.orders) ?? num(value.salesOrders),
    roas: num(value.roas),
    verdict:
      typeof value.verdict === "string" && VERDICTS.has(value.verdict)
        ? (value.verdict as "good" | "watch" | "weak")
        : null,
  };
}

function parseVariant(value: unknown): NexusProductVariant | null {
  if (!isObject(value)) return null;
  const displayName = str(value.displayName) ?? str(value.name);
  if (!displayName) return null;
  return {
    productId: str(value.productId) ?? str(value.canonicalProductId),
    displayName,
    productCode: str(value.productCode),
    invoices: num(value.invoices),
    orders: num(value.orders) ?? num(value.salesOrders),
    quantity: num(value.quantity),
    revenue: num(value.revenue),
    revenueShare: num(value.revenueShare),
  };
}

const KNOWN_TYPES = new Set<string>([
  "text",
  "quick_replies",
  "kpi_card",
  "kpi_group",
  "comparison_card",
  "price_card",
  "course_selector",
  "decision_card",
  "chart",
  "table",
  "alert",
  "progress",
  "error",
  "course_analysis",
]);

export function parseNexusMessage(name: unknown, data: unknown): NexusMessage | null {
  /**
   * The block's `name` when it is a type we know, otherwise the payload's own
   * `type`.
   *
   * Botpress names a custom-component block after the registered component
   * ("CourseAnalysisComponent"), not after the payload type. Trusting `name`
   * blindly meant a perfectly valid `course_analysis` payload fell through to
   * plain text — the cards never rendered.
   */
  const named = typeof name === "string" ? name : null;
  const declared = isObject(data) ? str(data.type) : null;
  const type = named && KNOWN_TYPES.has(named) ? named : (declared ?? named);
  if (!type) return null;
  const d = isObject(data) ? data : {};
  const sources = parseSources(d.sources);

  switch (type) {
    case "text": {
      const text = str(d.text);
      return text ? { type: "text", text, sources } : null;
    }

    case "quick_replies": {
      const options = Array.isArray(d.options)
        ? d.options
            .map((option) => {
              if (!isObject(option)) return null;
              const label = str(option.label);
              const value = str(option.value) ?? label;
              return label && value ? { label, value } : null;
            })
            .filter((o): o is { label: string; value: string } => o !== null)
        : [];
      return options.length > 0
        ? { type: "quick_replies", text: str(d.text) ?? undefined, options }
        : null;
    }

    case "course_analysis": {
      const course = str(d.course);
      if (!course) return null;
      const period = isObject(d.period)
        ? {
            from: str(d.period.from) ?? "",
            to: str(d.period.to) ?? "",
            label: str(d.period.label) ?? "",
          }
        : null;
      const campaigns = Array.isArray(d.campaigns)
        ? d.campaigns.map(parseCampaign).filter((c): c is NexusCampaign => c !== null)
        : [];
      const products = Array.isArray(d.products)
        ? d.products.map(parseVariant).filter((p): p is NexusProductVariant => p !== null)
        : [];
      const recommendation = isObject(d.recommendation)
        ? (() => {
            const summary = str(d.recommendation.summary);
            if (!summary) return null;
            return {
              summary,
              reasons: Array.isArray(d.recommendation.reasons)
                ? d.recommendation.reasons.map((r) => str(r)).filter((r): r is string => Boolean(r))
                : [],
              risk: str(d.recommendation.risk),
              confidence: confidenceOf(d.recommendation.confidence),
            };
          })()
        : null;
      const actions = Array.isArray(d.actions)
        ? d.actions
            .map((action) => {
              if (!isObject(action)) return null;
              const label = str(action.label);
              const value = str(action.value) ?? label;
              return label && value ? { label, value } : null;
            })
            .filter((a): a is { label: string; value: string } => a !== null)
            .slice(0, 4)
        : [];
      // A payload with no campaigns, no products and no recommendation carries
      // nothing a card could show; fall through to text rather than render an
      // empty shell.
      if (campaigns.length === 0 && products.length === 0 && !recommendation) {
        return null;
      }
      return {
        type: "course_analysis",
        course,
        period,
        summary: parseMetrics(d.summary),
        campaigns,
        products,
        recommendation,
        actions,
        sources,
      };
    }

    case "kpi_card": {
      const metric = parseMetric(d.metric);
      return metric ? { type: "kpi_card", metric, period: str(d.period), sources } : null;
    }

    case "kpi_group": {
      const metrics = parseMetrics(d.metrics);
      return metrics.length > 0
        ? {
            type: "kpi_group",
            title: str(d.title) ?? undefined,
            metrics,
            period: str(d.period),
            sources,
          }
        : null;
    }

    case "comparison_card": {
      const left = isObject(d.left) ? d.left : null;
      const right = isObject(d.right) ? d.right : null;
      if (!left || !right) return null;
      const leftLabel = str(left.label);
      const rightLabel = str(right.label);
      if (!leftLabel || !rightLabel) return null;
      return {
        type: "comparison_card",
        title: str(d.title) ?? undefined,
        left: { label: leftLabel, metrics: parseMetrics(left.metrics) },
        right: { label: rightLabel, metrics: parseMetrics(right.metrics) },
        sources,
      };
    }

    case "price_card": {
      const productName = str(d.productName);
      if (!productName) return null;
      const promotion = isObject(d.promotion)
        ? {
            campaign: str(d.promotion.campaign),
            validUntil: str(d.promotion.validUntil),
          }
        : null;
      return {
        type: "price_card",
        productName,
        deliveryMode: str(d.deliveryMode),
        externalCode: str(d.externalCode),
        // Never defaulted to 0: an absent price is absent, not free.
        effectivePrice: num(d.effectivePrice),
        currency: str(d.currency),
        market: str(d.market),
        paymentMethod: str(d.paymentMethod),
        promotion,
        validUntil: str(d.validUntil),
        available: d.available !== false,
        warnings: strArray(d.warnings),
        sources: sources.length > 0 ? sources : ["price_engo"],
      };
    }

    case "course_selector": {
      const candidates = Array.isArray(d.candidates)
        ? d.candidates
            .map((candidate) => {
              if (!isObject(candidate)) return null;
              const productId = str(candidate.productId);
              const name = str(candidate.name);
              return productId && name
                ? {
                    productId,
                    name,
                    deliveryMode: str(candidate.deliveryMode),
                    externalCode: str(candidate.externalCode),
                    productType: str(candidate.productType),
                  }
                : null;
            })
            .filter((c): c is NonNullable<typeof c> => c !== null)
        : [];
      return candidates.length > 0
        ? {
            type: "course_selector",
            question: str(d.question) ?? "",
            candidates,
          }
        : null;
    }

    case "decision_card": {
      const decision = str(d.decision);
      const summary = str(d.summary);
      if (!decision || !summary) return null;
      const band = isObject(d.actionBand) ? d.actionBand : null;
      return {
        type: "decision_card",
        decision,
        priority: level(d.priority),
        summary,
        why: strArray(d.why),
        evidence: strArray(d.evidence),
        expectedImpact: str(d.expectedImpact),
        confidence: level(d.confidence),
        confidenceLimitedBy: strArray(d.confidenceLimitedBy),
        risk: strArray(d.risk),
        owner: str(d.owner),
        reviewWindowDays: num(d.reviewWindowDays),
        nextKpi: str(d.nextKpi),
        missingEvidence: strArray(d.missingEvidence),
        actionBand:
          band && str(band.display)
            ? { display: str(band.display)!, provenance: str(band.provenance) ?? "" }
            : null,
        recommendationId: str(d.recommendationId),
        sources,
      };
    }

    case "chart": {
      const rows = Array.isArray(d.rows)
        ? d.rows.filter(isObject).map((row) => row as Record<string, string | number | null>)
        : [];
      const series = Array.isArray(d.series)
        ? d.series
            .map((entry) => {
              if (!isObject(entry)) return null;
              const key = str(entry.key);
              if (!key) return null;
              return {
                key,
                label: str(entry.label) ?? key,
                unit: parseUnit(entry.unit),
                currency: str(entry.currency),
              };
            })
            .filter((s): s is NonNullable<typeof s> => s !== null)
        : [];
      const xKey = str(d.xKey);
      const chartType = d.chartType === "bar" || d.chartType === "area" ? d.chartType : "line";
      return xKey && series.length > 0 && rows.length > 0
        ? {
            type: "chart",
            chartType,
            title: str(d.title) ?? undefined,
            xKey,
            series,
            rows,
            sources,
          }
        : null;
    }

    case "table": {
      const columns = Array.isArray(d.columns)
        ? d.columns
            .map((column) => {
              if (!isObject(column)) return null;
              const key = str(column.key);
              if (!key) return null;
              return {
                key,
                label: str(column.label) ?? key,
                unit: parseUnit(column.unit),
                currency: str(column.currency),
              };
            })
            .filter((c): c is NonNullable<typeof c> => c !== null)
        : [];
      const rows = Array.isArray(d.rows)
        ? d.rows.filter(isObject).map((row) => row as Record<string, string | number | null>)
        : [];
      return columns.length > 0
        ? {
            type: "table",
            title: str(d.title) ?? undefined,
            columns,
            rows,
            truncated: d.truncated === true,
            sources,
          }
        : null;
    }

    case "alert": {
      const title = str(d.title);
      if (!title) return null;
      const lvl = d.level === "critical" || d.level === "warning" ? d.level : "info";
      return { type: "alert", level: lvl, title, body: str(d.body) ?? undefined, sources };
    }

    case "progress": {
      const label = str(d.label);
      return label
        ? {
            type: "progress",
            label,
            step: num(d.step) ?? undefined,
            totalSteps: num(d.totalSteps) ?? undefined,
          }
        : null;
    }

    case "error": {
      const title = str(d.title);
      return title
        ? {
            type: "error",
            title,
            body: str(d.body) ?? undefined,
            retryable: d.retryable !== false,
          }
        : null;
    }

    default:
      return null;
  }
}
