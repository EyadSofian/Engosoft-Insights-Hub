import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHATWOOT_ATTRIBUTION_KEYS } from "@/lib/chatwoot-attribution-attributes";
import { updateChatwootConversationAttributes } from "@/lib/chatwoot.server";

/**
 * A fake Chatwoot that behaves like the real custom_attributes endpoint: a POST
 * replaces the conversation's whole attribute hash. Responses resolve after a
 * delay so concurrent callers can genuinely interleave.
 */
function fakeChatwoot(initial: Record<string, unknown>) {
  let attributes = { ...initial };
  const log: string[] = [];
  let afterPost: ((body: Record<string, unknown>) => void) | null = null;
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = new URL(url).pathname;
    if (method === "GET" && /\/conversations\/\d+$/.test(path)) {
      log.push("GET");
      const snapshot = { ...attributes };
      await delay(5);
      return new Response(JSON.stringify({ id: 42, custom_attributes: snapshot }), { status: 200 });
    }
    if (method === "POST" && path.endsWith("/custom_attributes")) {
      log.push("POST");
      await delay(1);
      const body = JSON.parse(String(init?.body)).custom_attributes as Record<string, unknown>;
      attributes = { ...body };
      afterPost?.(body);
      return new Response(JSON.stringify({ custom_attributes: attributes }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  return {
    fetchMock,
    log,
    state: () => attributes,
    externalWrite: (next: Record<string, unknown>) => {
      attributes = { ...next };
    },
    onPost: (hook: (body: Record<string, unknown>) => void) => {
      afterPost = hook;
    },
  };
}

const owned = { ownedKeys: CHATWOOT_ATTRIBUTION_KEYS };
const BOT_KEYS = {
  majed_welcome_sent: "true",
  bp_conv_id: "conv_1",
  api_campaign_label: "cfm-sept",
  api_campaign_reply_pending: true,
};

describe("updateChatwootConversationAttributes", () => {
  let server: ReturnType<typeof fakeChatwoot>;

  beforeEach(() => {
    vi.stubEnv("CHATWOOT_BASE_URL", "https://chat.example.test");
    vi.stubEnv("CHATWOOT_ACCOUNT_ID", "2");
    vi.stubEnv("CHATWOOT_API_TOKEN", "test-token");
    vi.stubEnv("CHATWOOT_REQUEST_MIN_INTERVAL_MS", "0");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reproduces the lost-update race when writes are not serialized", async () => {
    server = fakeChatwoot({ ...BOT_KEYS });
    vi.stubGlobal("fetch", server.fetchMock);
    const base = "https://chat.example.test/api/v1/accounts/2/conversations/42";
    const naive = async (key: string, value: string) => {
      const current = (await (await fetch(base)).json()).custom_attributes;
      await fetch(`${base}/custom_attributes`, {
        method: "POST",
        body: JSON.stringify({ custom_attributes: { ...current, [key]: value } }),
      });
    };
    await Promise.all([
      naive("attribution_channel", "whatsapp"),
      naive("attribution_unknown_reason", "historical_evidence_missing"),
    ]);
    const state = server.state();
    expect(Boolean(state.attribution_channel) && Boolean(state.attribution_unknown_reason)).toBe(
      false,
    );
  });

  it("serializes concurrent writes for one conversation so neither is lost", async () => {
    server = fakeChatwoot({ ...BOT_KEYS });
    vi.stubGlobal("fetch", server.fetchMock);
    await Promise.all([
      updateChatwootConversationAttributes(42, () => ({ attribution_channel: "whatsapp" }), owned),
      updateChatwootConversationAttributes(
        42,
        () => ({ attribution_unknown_reason: "historical_evidence_missing" }),
        owned,
      ),
    ]);
    expect(server.state()).toEqual({
      ...BOT_KEYS,
      attribution_channel: "whatsapp",
      attribution_unknown_reason: "historical_evidence_missing",
    });
    // read → write → verify, then the second write starts from the first one's result
    expect(server.log).toEqual(["GET", "POST", "GET", "GET", "POST", "GET"]);
  });

  it("never removes or changes keys it does not own", async () => {
    server = fakeChatwoot({ ...BOT_KEYS });
    vi.stubGlobal("fetch", server.fetchMock);
    const result = await updateChatwootConversationAttributes(
      42,
      () => ({
        attribution_channel: "whatsapp",
        majed_welcome_sent: "false",
        api_campaign_label: "",
        bp_conv_id: "other",
      }),
      owned,
    );
    expect(result.written).toEqual({ attribution_channel: "whatsapp" });
    expect(server.state()).toEqual({ ...BOT_KEYS, attribution_channel: "whatsapp" });
  });

  it("plans against the latest attributes, including another integration's write while queued", async () => {
    server = fakeChatwoot({ ...BOT_KEYS });
    vi.stubGlobal("fetch", server.fetchMock);
    let injected = false;
    server.onPost((body) => {
      if (injected) return;
      injected = true;
      // Another integration reads after our first write and adds its own key.
      server.externalWrite({ ...body, api_campaign_status: "sent" });
    });
    await Promise.all([
      updateChatwootConversationAttributes(42, () => ({ attribution_channel: "whatsapp" }), owned),
      updateChatwootConversationAttributes(
        42,
        (latest) => ({
          attribution_method: latest.api_campaign_status === "sent" ? "unknown" : "",
        }),
        owned,
      ),
    ]);
    expect(server.state()).toMatchObject({
      ...BOT_KEYS,
      api_campaign_status: "sent",
      attribution_channel: "whatsapp",
      attribution_method: "unknown",
    });
  });

  it("re-applies its change when another integration overwrites it after the write", async () => {
    server = fakeChatwoot({ ...BOT_KEYS });
    vi.stubGlobal("fetch", server.fetchMock);
    let overwritten = false;
    server.onPost(() => {
      if (overwritten) return;
      overwritten = true;
      // A stale writer that read before our POST replaces the hash with its own view.
      server.externalWrite({ ...BOT_KEYS, api_campaign_status: "sent" });
    });
    const result = await updateChatwootConversationAttributes(
      42,
      () => ({ attribution_channel: "whatsapp" }),
      owned,
    );
    expect(result.attempts).toBe(2);
    expect(server.state()).toEqual({
      ...BOT_KEYS,
      api_campaign_status: "sent",
      attribution_channel: "whatsapp",
    });
  });

  it("keeps both a bot key and an attribution key when they are written at the same time", async () => {
    server = fakeChatwoot({ bp_conv_id: "conv_1", api_campaign_status: "sent" });
    vi.stubGlobal("fetch", server.fetchMock);
    let botWrote = false;
    server.onPost(() => {
      if (botWrote) return;
      botWrote = true;
      // The Majed bridge read the hash before our write and posts its own flag afterwards.
      server.externalWrite({
        bp_conv_id: "conv_1",
        api_campaign_status: "sent",
        majed_welcome_sent: "true",
      });
    });
    await updateChatwootConversationAttributes(
      42,
      () => ({ attribution_channel: "website_chat", customer_source: "website_chat" }),
      owned,
    );
    expect(server.state()).toEqual({
      bp_conv_id: "conv_1",
      api_campaign_status: "sent",
      majed_welcome_sent: "true",
      attribution_channel: "website_chat",
      customer_source: "website_chat",
    });
  });

  it("never erases a proven value with a blank", async () => {
    server = fakeChatwoot({ meta_campaign_id: "120250553509150718", majed_welcome_sent: "true" });
    vi.stubGlobal("fetch", server.fetchMock);
    const result = await updateChatwootConversationAttributes(
      42,
      () => ({ meta_campaign_id: "", attribution_channel: "whatsapp" }),
      owned,
    );
    expect(result.written).toEqual({ attribution_channel: "whatsapp" });
    expect(server.state()).toEqual({
      meta_campaign_id: "120250553509150718",
      majed_welcome_sent: "true",
      attribution_channel: "whatsapp",
    });
  });

  it("does not write when nothing changes", async () => {
    server = fakeChatwoot({ ...BOT_KEYS, attribution_channel: "whatsapp" });
    vi.stubGlobal("fetch", server.fetchMock);
    const result = await updateChatwootConversationAttributes(
      42,
      () => ({ attribution_channel: "whatsapp" }),
      owned,
    );
    expect(result.written).toEqual({});
    expect(server.log).toEqual(["GET"]);
  });
});
