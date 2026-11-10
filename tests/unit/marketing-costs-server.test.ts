import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  filtered: vi.fn(),
  totals: vi.fn(),
  coverage: vi.fn(),
  read: vi.fn(),
  call: vi.fn(),
}));
vi.mock("@/lib/metrics.server", () => ({
  getFiltered: mocks.filtered,
  computeTotals: mocks.totals,
}));
vi.mock("@/lib/ad-delivery-coverage.server", () => ({ getAdSpendCoverage: mocks.coverage }));
vi.mock("@/lib/odoo.server", () => ({
  odooConfig: () => ({ pnlCompanyIds: [3] }),
  searchRead: mocks.read,
  odooCall: mocks.call,
  m2oId: (m: any) => m?.[0] || 0,
  m2oName: (m: any) => m?.[1] || "",
}));
import {
  marketingCostsReport,
  resetMarketingCostsCacheForTests,
} from "@/lib/marketing-costs.server";

const from = "2026-10-01",
  to = "2026-10-31";
beforeEach(() => {
  resetMarketingCostsCacheForTests();
  vi.stubEnv("CHATWOOT_BASE_URL", "https://chat.example");
  vi.stubEnv("CHATWOOT_ACCOUNT_ID", "2");
  vi.stubEnv("CHATWOOT_API_TOKEN", "chat-secret");
  mocks.filtered.mockResolvedValue({
    snapshot: { adsDateMin: from, adsDateMax: to },
    ads: [{ platform: "meta", spend: 100 }],
    accounting: [
      {
        company: "KSA",
        movement: "INV",
        invoiceDate: "2026-10-05",
        paymentDate: "2026-10-05",
        source: "WhatsApp Broadcast",
        usdPaid: 90,
        isCreditNote: false,
      },
    ],
  });
  mocks.totals.mockReturnValue({ spend: 100 });
  mocks.coverage.mockResolvedValue({ complete: true });
  mocks.read.mockResolvedValue([
    { id: 1, name: "INV", partner_id: [7, "private"], company_id: [3, "KSA"] },
  ]);
  mocks.call.mockResolvedValue([{ id: 7, phone: "+966500000000" }]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
const fetchMock = (failedMeta = false) =>
  vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/inboxes"))
      return Response.json({
        payload: [15, 24].map((id) => ({
          id,
          provider: "whatsapp_cloud",
          provider_config: { business_account_id: "12345", api_key: "wa-secret" },
          message_templates: [{ name: "t", category: "MARKETING" }],
        })),
      });
    if (u.includes("graph.facebook"))
      return failedMeta
        ? new Response("failure", { status: 403 })
        : Response.json({
            id: "12345",
            name: "WABA",
            currency: "USD",
            pricing_analytics: {
              data: [
                {
                  data_points: [
                    {
                      start: 1790802000,
                      end: 1790888400,
                      phone_number: "966500000000",
                      pricing_category: "MARKETING",
                      pricing_type: "REGULAR",
                      cost: 10,
                      volume: 100,
                    },
                  ],
                },
              ],
            },
          });
    if (u.includes("/api/reporting/broadcast"))
      return Response.json({
        total: 1,
        scanned: 2300,
        unreadable: 0,
        jobs: [
          {
            id: "j",
            campaign: "broadcast",
            template: "t",
            category: "UTILITY",
            inboxId: "15",
            operator: "Operator",
            createdAt: "2026-10-01T09:00:00Z",
            status: "completed",
            total: 1,
            accepted: 1,
            errors: 0,
            skipped: 0,
            events: [
              {
                jobId: "j",
                messageId: "8",
                phone: "+966500000000",
                date: "2026-10-01",
                acceptedAt: "2026-10-01T10:00:00Z",
                timeBasis: "send_log",
              },
            ],
          },
        ],
      });
    throw Error("Unexpected source");
  });
describe("live marketing cost report", () => {
  it("deduplicates shared WABA inboxes, uses current provider category, and never exposes credentials or recipient phones", async () => {
    const fetch = fetchMock();
    vi.stubGlobal("fetch", fetch);
    const r = await marketingCostsReport({ from, to });
    expect(fetch.mock.calls.filter(([u]) => String(u).includes("graph.facebook"))).toHaveLength(1);
    expect(r.whatsapp.reportedCostUsd).toBe(10);
    expect(r.combinedUsageUsd).toBe(110);
    expect(r.whatsapp.campaigns[0].estimatedUsd).toBe(0.1);
    expect(r.whatsapp.broadcastRevenue).toBe(90);
    expect(r.billing.chargedUsd).toBeNull();
    expect(r.billing.taxUsd).toBeNull();
    expect(JSON.stringify(r)).not.toContain("wa-secret");
    expect(JSON.stringify(r)).not.toContain("chat-secret");
    expect(JSON.stringify(r)).not.toContain("+966500000000");
    expect(r.whatsapp.records[0].match).toBe("before_invoice_day");
  });
  it("does not turn a failed WhatsApp read into zero or a combined total", async () => {
    vi.stubGlobal("fetch", fetchMock(true));
    const r = await marketingCostsReport({ from, to });
    expect(r.whatsapp.complete).toBe(false);
    expect(r.whatsapp.reportedCostUsd).toBeNull();
    expect(r.combinedUsageUsd).toBeNull();
    expect(r.ads.spendUsd).toBe(100);
  });
  it.each([{ course: "CFM" }, { channel: "organic" as const }])(
    "does not blend account-wide WhatsApp cost with a narrowed advertising subtotal: %j",
    async (scope) => {
      vi.stubGlobal("fetch", fetchMock());
      const r = await marketingCostsReport({ from, to, ...scope });
      expect(r.scopeNarrowed).toBe(true);
      expect(r.combinedUsageUsd).toBeNull();
    },
  );
});
