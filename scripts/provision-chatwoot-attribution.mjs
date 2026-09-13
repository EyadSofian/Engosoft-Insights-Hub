/**
 * Creates only missing *conversation* custom-attribute definitions. It never
 * changes an existing definition and is dry-run by default. This is kept out
 * of webhook handling so an unexpected payload can never mutate account setup.
 */
const apply = process.argv.includes("--apply");
const baseUrl = (process.env.CHATWOOT_BASE_URL || "").replace(/\/+$/, "");
const accountId = (process.env.CHATWOOT_ACCOUNT_ID || "").trim();
const token = (process.env.CHATWOOT_API_TOKEN || "").trim();
if (!baseUrl || !accountId || !token) {
  throw new Error("CHATWOOT_BASE_URL, CHATWOOT_ACCOUNT_ID, and CHATWOOT_API_TOKEN are required.");
}

const definitions = [
  ["attribution_source", "Attribution source"],
  ["attribution_medium", "Attribution medium"],
  ["attribution_campaign", "Attribution campaign"],
  ["meta_campaign_id", "Meta campaign ID"],
  ["meta_adset_id", "Meta ad set ID"],
  ["meta_ad_id", "Meta ad ID"],
  ["ctwa_clid", "CTWA click ID"],
  ["engosoft_branch", "Engosoft branch"],
  ["attribution_method", "Attribution method"],
  ["attribution_confidence", "Attribution confidence"],
  ["utm_source", "UTM source"],
  ["utm_medium", "UTM medium"],
  ["utm_campaign", "UTM campaign"],
  ["utm_content", "UTM content"],
  ["utm_term", "UTM term"],
];
const endpoint = `${baseUrl}/api/v1/accounts/${encodeURIComponent(accountId)}/custom_attribute_definitions`;
const request = async (init = {}) => {
  const response = await fetch(endpoint, {
    ...init,
    headers: {
      Accept: "application/json",
      api_access_token: token,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Chatwoot returned HTTP ${response.status}`);
  return response.json();
};
const existingPayload = await request();
const existing = Array.isArray(existingPayload)
  ? existingPayload
  : Array.isArray(existingPayload?.payload)
    ? existingPayload.payload
    : [];
const existingConversationKeys = new Set(
  existing
    .filter(
      (row) => row?.attribute_model === 0 || row?.attribute_model === "conversation_attribute",
    )
    .map((row) => String(row?.attribute_key || "")),
);
const missing = definitions.filter(([key]) => !existingConversationKeys.has(key));

if (!apply) {
  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        existingConversationDefinitions: existingConversationKeys.size,
        missing: missing.map(([key]) => key),
      },
      null,
      2,
    ),
  );
} else {
  for (const [key, displayName] of missing) {
    await request({
      method: "POST",
      body: JSON.stringify({
        attribute_display_name: displayName,
        attribute_display_type: 0,
        attribute_description:
          "Managed by Engosoft Insights Hub attribution; value is evidence, not an authorization input.",
        attribute_key: key,
        attribute_values: [],
        attribute_model: 0,
      }),
    });
  }
  console.log(
    JSON.stringify(
      {
        mode: "apply",
        created: missing.map(([key]) => key),
        preservedExisting: existingConversationKeys.size,
      },
      null,
      2,
    ),
  );
}
