import assert from "node:assert/strict";
import {
  getChatwootAgentConversationEvidence,
  getChatwootAgentSnapshot,
} from "../src/lib/chatwoot.server.ts";

process.env.CHATWOOT_BASE_URL = "https://chat.example.test";
process.env.CHATWOOT_ACCOUNT_ID = "2";
process.env.CHATWOOT_API_TOKEN = "test-token";

const json = (value) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

{
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/summary_reports/agent")) {
      return json([
        {
          id: 7,
          conversations_count: 40,
          resolved_conversations_count: 12,
          avg_first_response_time: 17,
          avg_resolution_time: 600,
          avg_reply_time: 31,
        },
      ]);
    }
    if (url.endsWith("/agents")) return json([{ id: 7, available_name: "Sara" }]);
    if (url.includes("type=agent")) {
      return json([{ id: 7, name: "Sara", metric: { open: 9, unattended: 3 } }]);
    }
    if (url.includes("type=account")) {
      return json({ open: 100, unattended: 18, unassigned: 4, pending: 2 });
    }
    throw new Error(`Unexpected Chatwoot URL: ${url}`);
  };

  const snapshot = await getChatwootAgentSnapshot("2030-01-01", "2030-01-31");
  assert.equal(calls.length, 4, "the aggregate path must use a constant four requests");
  assert.ok(
    calls.every((url) => !url.includes("/api/v1/accounts/2/conversations?")),
    "the dashboard must never enumerate the conversation list",
  );
  assert.equal(snapshot.openConversations, 100);
  assert.equal(snapshot.awaitingReply, 18);
  assert.equal(snapshot.unassignedConversations, 4);
  assert.deepEqual(snapshot.agents[0], {
    id: 7,
    name: "Sara",
    conversations: 40,
    resolved: 12,
    openConversations: 9,
    unreadConversations: null,
    unreadMessages: null,
    awaitingReply: 3,
    averageFirstResponseSeconds: 17,
    averageResolutionSeconds: 600,
    averageReplySeconds: 31,
  });
}

{
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    assert.match(url, /\/conversations\/filter\?page=[12]$/);
    assert.equal(init?.method, "POST");
    const page = Number(new URL(url).searchParams.get("page"));
    const offset = (page - 1) * 25;
    return json({
      meta: { all_count: 50 },
      payload: Array.from({ length: 25 }, (_, index) => ({
        id: offset + index + 1,
        status: "open",
        unread_count: index === 0 ? 2 : 0,
        last_activity_at: 1_893_456_000 + offset + index,
        meta: { sender: { name: `Contact ${offset + index + 1}` } },
        last_non_activity_message: { message_type: 0, sender_type: "Contact", private: false },
      })),
    });
  };

  const evidence = await getChatwootAgentConversationEvidence({
    agentId: 7,
    from: "2030-02-01",
    to: "2030-02-28",
    limit: 30,
  });
  assert.equal(calls.length, 2, "evidence reads only enough pages for its visible limit");
  assert.equal(evidence.total, 50);
  assert.equal(evidence.conversations.length, 30);
  assert.equal(evidence.conversations[0].id, 30);
  const filters = JSON.parse(String(calls[0].init?.body)).payload;
  assert.deepEqual(
    filters.map((item) => item.attribute_key),
    ["assignee_id", "last_activity_at", "last_activity_at"],
  );
  assert.equal(filters[0].values[0], 7);
  assert.equal(filters[1].values[0], "2030-02-01T00:00:00.000Z");
  assert.equal(filters[2].values[0], "2030-03-01T00:00:00.000Z");
}

console.log("Chatwoot bounded-path tests passed.");
