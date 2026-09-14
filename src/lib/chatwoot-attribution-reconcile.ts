/**
 * Pure rules for reconciling Chatwoot conversations with attribution rows.
 *
 * Every conversation in the window ends in exactly one state, so a missing row
 * is never silent:
 *
 *   has_row             the attribution row exists
 *   no_inbound_message  only outgoing/template/activity messages: nothing to
 *                       attribute (a campaign send nobody answered, for example)
 *   replayable          an inbound message exists but no row does: the webhook
 *                       was never delivered or never processed
 *   replayed            the row was rebuilt from the Chatwoot API
 *   failed              the rebuild was attempted and failed
 */

export type ReconcileState =
  "has_row" | "no_inbound_message" | "replayable" | "replayed" | "failed";

/** Recorded on rebuilt rows: the webhook that would have carried any referral never arrived. */
export const WEBHOOK_DELIVERY_MISSED = "webhook_delivery_missed";

type Json = Record<string, unknown>;

const text = (value: unknown) => (value == null ? "" : String(value).trim().toLowerCase());

/** Chatwoot message_type 0 is incoming; 1 outgoing, 2 activity, 3 template. */
export function isInboundMessage(message: Json): boolean {
  if (message.private === true) return false;
  const type = text(message.message_type);
  if (type === "0" || type === "incoming") return true;
  if (["1", "2", "3", "outgoing", "activity", "template"].includes(type)) return false;
  return text(message.sender_type) === "contact";
}

/** The earliest inbound message, or null. */
export function firstInboundMessage(messages: readonly Json[]): Json | null {
  const inbound = messages.filter(isInboundMessage);
  if (!inbound.length) return null;
  return [...inbound].sort(
    (a, b) =>
      Number(a.created_at ?? 0) - Number(b.created_at ?? 0) ||
      Number(a.id ?? 0) - Number(b.id ?? 0),
  )[0]!;
}

export function classifyConversation(input: {
  hasRow: boolean;
  firstInbound: Json | null;
}): ReconcileState {
  if (input.hasRow) return "has_row";
  return input.firstInbound ? "replayable" : "no_inbound_message";
}

/**
 * The webhook-shaped payload the attribution pipeline expects, rebuilt from
 * API data. Chatwoot's API does not keep the provider referral, so a rebuilt
 * conversation can only ever be unknown — which is exactly what it records.
 */
export function replayPayload(conversation: Json, message: Json): Json {
  const meta = (conversation.meta as Json | undefined) ?? {};
  return {
    event: "message_created",
    id: message.id,
    content: message.content ?? "",
    message_type: "incoming",
    created_at: message.created_at,
    source_id: message.source_id ?? "",
    content_attributes: message.content_attributes ?? {},
    sender: meta.sender ?? message.sender ?? {},
    inbox: { id: conversation.inbox_id, channel_type: (meta.channel as string) ?? "" },
    conversation: {
      id: conversation.id,
      inbox_id: conversation.inbox_id,
      created_at: conversation.created_at,
      meta,
      contact_inbox: conversation.contact_inbox ?? {},
      custom_attributes: conversation.custom_attributes ?? {},
      additional_attributes: conversation.additional_attributes ?? {},
    },
  };
}
