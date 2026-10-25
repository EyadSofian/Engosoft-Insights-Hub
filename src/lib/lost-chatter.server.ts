import { companyContext, m2oName, odooCallWithPolicy, searchRead, type M2O } from "./odoo.server";

interface OdooLeadDates {
  id: number;
  create_date?: string | false;
  lost_verification_date?: string | false;
  date_closed?: string | false;
  date_last_stage_update?: string | false;
  write_date?: string | false;
  type?: string | false;
}

interface OdooMessage {
  id: number;
  date: string;
  body?: string | false;
  subject?: string | false;
  message_type?: string;
  subtype_id?: M2O;
  author_id?: M2O;
}

const value = (input: string | false | undefined) => (typeof input === "string" ? input : "");

export function plainChatterBody(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 1000);
}

function utcMillis(value: string): number {
  if (!value) return NaN;
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`).getTime();
}

/** A bounded, read-only Odoo lookup for one already-authorised Lost CRM ID. */
export async function readLostChatter(id: number) {
  const policy = { attempts: 1, timeoutMs: 25_000, signal: AbortSignal.timeout(40_000) };
  const context = companyContext({ active_test: false, lang: "en_US" });
  const metadata = await odooCallWithPolicy<Record<string, unknown>>(
    "crm.lead",
    "fields_get",
    [],
    { attributes: ["type"], context },
    policy,
  );
  const fields = [
    "id",
    "create_date",
    "type",
    "lost_verification_date",
    "date_closed",
    "date_last_stage_update",
    "write_date",
  ].filter((field) => Boolean(metadata[field]));
  const [lead] = await searchRead<OdooLeadDates>("crm.lead", [["id", "=", id]], fields, {
    limit: 1,
    context,
    policy,
  });
  if (!lead) return null;

  const opportunity = lead.type === "opportunity";
  const dated = opportunity
    ? [
        ["lost_verification_date", value(lead.lost_verification_date)],
        ["date_last_stage_update_fallback", value(lead.date_last_stage_update)],
        ["date_closed_fallback", value(lead.date_closed)],
      ]
    : [
        ["date_closed", value(lead.date_closed)],
        ["write_date_fallback", value(lead.write_date)],
      ];
  const [lostDateBasis, lostAt] = dated.find(([, date]) => date) ?? ["missing", ""];
  const createdAt = value(lead.create_date);
  const elapsedHours =
    Number.isFinite(utcMillis(createdAt)) && Number.isFinite(utcMillis(lostAt))
      ? Math.max(0, (utcMillis(lostAt) - utcMillis(createdAt)) / 3_600_000)
      : null;

  const messages = await searchRead<OdooMessage>(
    "mail.message",
    [
      ["model", "=", "crm.lead"],
      ["res_id", "=", id],
    ],
    ["id", "date", "body", "subject", "message_type", "subtype_id", "author_id"],
    { limit: 150, order: "date desc, id desc", context, policy },
  );
  const timeline = messages
    .map((message) => ({
      id: message.id,
      date: message.date,
      kind: message.message_type || "",
      subtype: m2oName(message.subtype_id),
      author: m2oName(message.author_id),
      subject: value(message.subject),
      text: plainChatterBody(value(message.body)),
      beforeLoss: !lostAt || utcMillis(message.date) <= utcMillis(lostAt) + 60_000,
    }))
    .filter((message) => message.text || message.subject || message.subtype);
  const lastBeforeLoss = timeline.find(
    (message) => message.beforeLoss && (message.text || message.subject),
  );

  return {
    id,
    createdAt,
    lostAt,
    lostDateBasis,
    elapsedHours,
    lastBeforeLoss: lastBeforeLoss ?? null,
    messages: timeline,
    truncated: messages.length === 150,
    fetchedAt: new Date().toISOString(),
  };
}
