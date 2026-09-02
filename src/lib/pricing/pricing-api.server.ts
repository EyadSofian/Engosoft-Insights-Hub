// Server-only helpers shared by every /api/pricing route.
//
// Reads are open, as every other page in this dashboard is. Writes go through
// `authorizeWrite` — a workspace SSO session, or the shared admin code — and
// nothing here ever echoes a secret back into a response or a log line.
import { z } from "zod";
import {
  authorizeWrite,
  adminCodeConfigured,
  ssoConfigured,
  writesEnabled,
} from "../admin-auth.server.ts";
import { readLimitedJson, RequestBodyTooLargeError } from "../limited-json.server.ts";

/** A price-book edit is a few fields; an import preview is a whole workbook. */
export const JSON_BODY_LIMIT = 512 * 1024;
export const UPLOAD_BODY_LIMIT = 10 * 1024 * 1024;

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export function fail(error: string, status = 400): Response {
  return json({ ok: false, error }, status);
}

export interface Actor {
  id: string;
  name: string;
  email: string;
  via: string;
}

export type Guarded = { ok: true; actor: Actor; label: string } | { ok: false; response: Response };

/**
 * Refuse a write unless the caller proved themselves.
 *
 * The failure response repeats whatever `authorizeWrite` decided and nothing
 * more: it never says which credential was missing, and never how close a
 * supplied one was.
 */
export function guard(request: Request): Guarded {
  const result = authorizeWrite(request);
  if (!result.ok)
    return { ok: false, response: json({ ok: false, error: result.error }, result.status) };
  const actor: Actor = {
    id: result.actor.id,
    name: result.actor.name,
    email: result.actor.email,
    via: result.actor.via,
  };
  return { ok: true, actor, label: actor.email || actor.name || actor.id };
}

/** Auth state a page needs to decide whether to show an edit button. */
export function authState(request: Request) {
  const result = authorizeWrite(request);
  return {
    signedIn: result.ok,
    via: result.ok ? result.actor.via : null,
    name: result.ok ? result.actor.name : "",
    editable: writesEnabled(),
    sso: ssoConfigured(),
    adminCode: adminCodeConfigured(),
  };
}

/**
 * Read and validate a JSON body against a schema, with a size ceiling.
 *
 * Generic over the schema rather than over a value type, so `z.infer` gives the
 * *output* shape: a field with `.default()` is required once parsing succeeds,
 * which is what callers actually receive.
 */
export async function body<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
  limit = JSON_BODY_LIMIT,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await readLimitedJson(request, limit);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return { ok: false, response: fail(`Request body exceeds ${limit} bytes.`, 413) };
    }
    return { ok: false, response: fail("Invalid JSON body.", 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      response: fail(
        `${issue?.path.join(".") || "body"}: ${issue?.message || "is not valid"}`,
        400,
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

/** Filters shared by the compliance, exceptions and alerts endpoints. */
export function auditQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const clean = (key: string): string | undefined => {
    const value = params.get(key)?.trim();
    return value && value !== "all" ? value.slice(0, 120) : undefined;
  };
  const basis = params.get("dateBasis");
  return {
    from: clean("from"),
    to: clean("to"),
    dateBasis: (basis === "sale" || basis === "invoice" ? basis : "payment") as
      "payment" | "sale" | "invoice",
    company: clean("company"),
    currency: clean("currency"),
    paymentMethod: clean("paymentMethod"),
    specialization: clean("specialization"),
    productCode: clean("productCode"),
    salesperson: clean("salesperson"),
    salesTeam: clean("salesTeam"),
    status: clean("status"),
    severity: clean("severity"),
    search: clean("q"),
    sort: clean("sort"),
    sortDir: params.get("dir") === "asc" ? ("asc" as const) : ("desc" as const),
    limit: Math.min(Math.max(Number(params.get("limit")) || 50, 1), 500),
    offset: Math.max(Number(params.get("offset")) || 0, 0),
  };
}

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD date")
  .or(z.literal(""));

export const priceSchema = z.number().finite().min(0).max(10_000_000).nullable();
