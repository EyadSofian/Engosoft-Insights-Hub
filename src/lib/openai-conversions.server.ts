// Server-only OpenAI Ads conversion event contract.
//
// Nothing imports or invokes the sender automatically. Odoo/Accounting remains
// the source of truth; a future approved worker can call this module after its
// event semantics, consent, and idempotency policy are signed off.
import { createHash } from "node:crypto";

const EVENTS_API = "https://bzr.openai.com/v1/events";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BATCH = 1_000;

export type OpenAIConversionActionSource =
  "web" | "mobile_app" | "offline" | "physical_store" | "phone_call" | "email" | "other";

export type EngosoftOutcome = "lead" | "qualified_lead" | "won" | "paid_invoice";

export interface OpenAIConversionUser {
  phone_numbers_sha256?: string[];
  emails_sha256?: string[];
  external_ids_sha256?: string[];
  first_names_sha256?: string[];
  last_names_sha256?: string[];
  countries?: string[];
  cities?: string[];
  regions?: string[];
  postal_codes?: string[];
  obref?: string;
  ip_address?: string;
  user_agent?: string;
}

export interface EngosoftOutcomeInput {
  /** Stable Odoo lead or invoice id. Reused on retries for OpenAI deduplication. */
  id: string;
  outcome: EngosoftOutcome;
  occurredAt: Date | string | number;
  actionSource: OpenAIConversionActionSource;
  /** Required by OpenAI when actionSource is web. */
  sourceUrl?: string;
  /** Opaque OpenAI click reference captured from the landing URL. */
  oppref?: string;
  user?: OpenAIConversionUser;
  /** Required for paid_invoice; expressed in major currency units. */
  amount?: number;
  /** ISO 4217 code; required whenever amount is provided. */
  currency?: string;
  courseId?: string;
  courseName?: string;
}

export interface OpenAIConversionEvent {
  id: string;
  type: "lead_created" | "order_created" | "custom";
  custom_event_name?: "qualified_lead" | "won_deal";
  timestamp_ms: number;
  oppref?: string;
  source_url?: string;
  action_source: OpenAIConversionActionSource;
  user?: OpenAIConversionUser;
  data:
    | { type: "customer_action" }
    | { type: "custom" }
    | {
        type: "contents";
        amount: number;
        currency: string;
        contents?: Array<{ id?: string; name?: string; content_type: string }>;
      };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashOpenAIEmail(value: string): string {
  return sha256(value.trim().toLowerCase());
}

export function hashOpenAIPhone(value: string): string {
  const normalized = value
    .replace(/[\s().-]/g, "")
    .replace(/^\+/, "")
    .replace(/^0+/, "");
  if (!/^\d{8,15}$/.test(normalized)) throw new Error("Phone must normalize to 8-15 digits.");
  return sha256(normalized);
}

export function hashOpenAIExternalId(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("External id cannot be empty.");
  return sha256(normalized);
}

function timestamp(value: Date | string | number): number {
  const parsed =
    value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Conversion timestamp is invalid.");
  const millis = Math.trunc(parsed);
  const now = Date.now();
  if (millis < now - 7 * 86_400_000 || millis > now + 10 * 60_000) {
    throw new Error(
      "OpenAI conversion events must be within the last 7 days and at most 10 minutes ahead.",
    );
  }
  return millis;
}

function validWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function buildOpenAIConversionEvent(input: EngosoftOutcomeInput): OpenAIConversionEvent {
  const id = input.id.trim();
  if (!id) throw new Error("A stable Odoo event id is required.");
  if (input.actionSource === "web" && !validWebUrl(input.sourceUrl ?? "")) {
    throw new Error("A valid sourceUrl is required for web conversion events.");
  }
  const common = {
    id: `engosoft_${input.outcome}_${id}`,
    timestamp_ms: timestamp(input.occurredAt),
    action_source: input.actionSource,
    ...(input.sourceUrl ? { source_url: input.sourceUrl } : {}),
    ...(input.oppref?.trim() ? { oppref: input.oppref.trim() } : {}),
    ...(input.user ? { user: input.user } : {}),
  };

  if (input.outcome === "lead") {
    return { ...common, type: "lead_created", data: { type: "customer_action" } };
  }
  if (input.outcome === "qualified_lead" || input.outcome === "won") {
    return {
      ...common,
      type: "custom",
      custom_event_name: input.outcome === "won" ? "won_deal" : "qualified_lead",
      data: { type: "custom" },
    };
  }

  if (!Number.isFinite(input.amount) || Number(input.amount) < 0) {
    throw new Error("A non-negative paid invoice amount is required.");
  }
  const currency = input.currency?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("A three-letter ISO currency is required.");
  let minorDigits: number;
  try {
    const digits = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits;
    minorDigits = typeof digits === "number" && Number.isInteger(digits) ? digits : 2;
  } catch {
    throw new Error("Currency must be a valid ISO 4217 code.");
  }
  const amount = Math.round(Number(input.amount) * 10 ** minorDigits);
  return {
    ...common,
    type: "order_created",
    data: {
      type: "contents",
      amount,
      currency,
      ...(input.courseId || input.courseName
        ? {
            contents: [
              {
                ...(input.courseId ? { id: input.courseId } : {}),
                ...(input.courseName ? { name: input.courseName } : {}),
                content_type: "course",
              },
            ],
          }
        : {}),
    },
  };
}

export function openAIConversionsConfigured(): boolean {
  return Boolean(
    process.env.OPENAI_ADS_PIXEL_ID?.trim() && process.env.OPENAI_ADS_CONVERSIONS_API_KEY?.trim(),
  );
}

/**
 * Explicit sender for a future approved Odoo worker. It defaults to validation
 * only, so merely wiring the worker cannot create attributed conversions.
 */
export async function sendOpenAIConversionBatch(
  events: OpenAIConversionEvent[],
  options: { validateOnly?: boolean } = {},
): Promise<unknown> {
  const pixelId = process.env.OPENAI_ADS_PIXEL_ID?.trim() ?? "";
  const apiKey = process.env.OPENAI_ADS_CONVERSIONS_API_KEY?.trim() ?? "";
  if (!pixelId || !apiKey) throw new Error("OpenAI Ads conversion tracking is not configured.");
  if (!events.length || events.length > MAX_BATCH) {
    throw new Error(`OpenAI accepts 1-${MAX_BATCH} conversion events per batch.`);
  }
  const url = new URL(EVENTS_API);
  url.searchParams.set("pid", pixelId);
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      validate_only: options.validateOnly ?? true,
      integration_source: "engosoft_insights",
      events,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string } | string;
  };
  if (!response.ok) {
    const detail = typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error(`OpenAI Conversions API: ${detail || `HTTP ${response.status}`}`);
  }
  return body;
}
