import { describe, expect, it } from "vitest";
import {
  capabilityRows,
  missingScopes,
  REQUIRED_SCOPES,
  type CapabilitySnapshot,
} from "@/lib/meta-credential-health";

const notAdded: CapabilitySnapshot = {
  configured: false,
  valid: false,
  scopes: [],
  capabilities: {},
};
const marketingApi: CapabilitySnapshot = {
  configured: true,
  valid: true,
  scopes: ["ads_management", "ads_read", "business_management", "pages_read_engagement"],
  capabilities: {
    adsRead: { state: "connected", detail: "" },
    leadFormsRead: { state: "not_connected", detail: "(#200) Requires pages_manage_ads" },
    pageMetadata: { state: "not_connected", detail: "" },
    whatsappBusinessManagement: { state: "not_connected", detail: "" },
    messengerMessaging: { state: "not_connected", detail: "" },
    instagramMessaging: { state: "not_connected", detail: "" },
  },
};

describe("credential health in business language", () => {
  it("today: ads connected, everything else names the missing permission", () => {
    const rows = Object.fromEntries(
      capabilityRows([notAdded, marketingApi]).map((row) => [row.label, row.text]),
    );
    expect(rows).toEqual({
      Ads: "Connected",
      "Lead forms": "Missing leads_retrieval",
      "Page subscriptions": "Missing pages_manage_metadata",
      WhatsApp: "Missing whatsapp_business_management",
      Messenger: "Permission pending (pages_messaging)",
      Instagram: "Permission pending (instagram_manage_messages)",
    });
  });

  it("after the Attribution credential: every granted capability reads Connected", () => {
    const attribution: CapabilitySnapshot = {
      configured: true,
      valid: true,
      scopes: REQUIRED_SCOPES.map((entry) => entry.scope),
      capabilities: Object.fromEntries(
        [
          "adsRead",
          "leadFormsRead",
          "pageMetadata",
          "whatsappBusinessManagement",
          "messengerMessaging",
          "instagramMessaging",
        ].map((key) => [key, { state: "connected" as const, detail: "" }]),
      ),
    };
    expect(
      capabilityRows([attribution, marketingApi]).every((row) => row.text === "Connected"),
    ).toBe(true);
  });

  it("never renders a missing permission as a number", () => {
    for (const row of capabilityRows([notAdded, marketingApi])) {
      expect(row.text).not.toMatch(/^\d/);
    }
  });

  it("lists exactly the scopes still missing", () => {
    expect(missingScopes(marketingApi.scopes)).toContain("leads_retrieval");
    expect(missingScopes(marketingApi.scopes)).not.toContain("ads_read");
    expect(missingScopes(REQUIRED_SCOPES.map((entry) => entry.scope))).toEqual([]);
  });
});
