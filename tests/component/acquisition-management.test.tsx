// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ClosedLoopResponse } from "@/components/acquisition/ClosedLoop";
import { DataCoverageCard, kpiDisplay } from "@/components/acquisition/ManagementOverview";
import { emptyMetrics, finalizeMetrics } from "@/lib/closed-loop";
import { closedLoopKpis } from "@/lib/closed-loop-kpis";
import { redactMetaSecrets } from "@/lib/meta-catalog-reconcile";
import { I18nProvider } from "@/lib/i18n";

afterEach(cleanup);

const kpis = (spendSynced: boolean) =>
  closedLoopKpis({
    all: finalizeMetrics({ ...emptyMetrics(), leads: 120, won: 0, revenue: 0 }),
    tracked: finalizeMetrics({ ...emptyMetrics(), leads: 100, crmMatched: 90, won: 0, revenue: 0 }),
    totalSpend: spendSynced ? 500 : 0,
    trackedSpend: spendSynced ? 450 : 0,
    spendSynced,
    crmSynced: true,
  });

describe("an unavailable figure never looks like a real zero", () => {
  it("shows Pending sync instead of $0 when Meta spend is not synced", () => {
    const k = kpis(false);
    expect(kpiDisplay(k.adSpend, "en")).toBe("Pending sync");
    expect(kpiDisplay(k.roasAllSpend, "en")).toBe("Pending sync");
    expect(kpiDisplay(k.adSpend, "ar")).toBe("بانتظار المزامنة");
  });

  it("shows a queried zero as zero", () => {
    const k = kpis(true);
    expect(kpiDisplay(k.won, "en")).toBe("0");
    expect(kpiDisplay(k.roasAllSpend, "en")).toBe("0.00×");
  });

  it("says why a ratio has no value", () => {
    const k = closedLoopKpis({
      all: finalizeMetrics(emptyMetrics()),
      tracked: finalizeMetrics(emptyMetrics()),
      totalSpend: 0,
      trackedSpend: 0,
      spendSynced: true,
      crmSynced: true,
    });
    expect(kpiDisplay(k.cplAll, "en")).toBe("Nothing to divide by");
  });

  it("renders channel status in words and keeps technical rows out of the simple card", () => {
    const data: ClosedLoopResponse = {
      configured: true,
      coverageSummary: [
        {
          key: "messaging_whatsapp",
          label: { en: "WhatsApp attribution", ar: "إسناد واتساب" },
          numerator: 0,
          denominator: 726,
          status: "not_connected",
          channelStatus: "infrastructure_ready_credential_pending",
          note: {
            en: "Software verified; completes automatically once the credential is in Railway.",
            ar: "",
          },
        },
        {
          key: "messaging_instagram",
          label: { en: "Instagram attribution", ar: "إسناد إنستغرام" },
          numerator: 0,
          denominator: 0,
          status: "not_connected",
          channelStatus: "inbox_setup_required",
          note: { en: "Instagram inbox needed.", ar: "" },
        },
        {
          key: "creative_attribution",
          label: { en: "Creative attribution", ar: "إسناد المادة" },
          numerator: 15_159,
          denominator: 15_162,
          status: "ok",
          note: { en: "Leads whose creative is known.", ar: "" },
        },
        {
          key: "historical_chatwoot",
          label: { en: "Historical conversations", ar: "" },
          numerator: 0,
          denominator: 1140,
          status: "historical_evidence_missing",
          technical: true,
          note: { en: "Evidence never stored.", ar: "" },
        },
      ],
      sources: {
        leadAdsDirect: "not_connected",
        messaging: "not_connected",
        metaAdsSyncedThrough: "2026-09-14",
        catalogReconciledAt: null,
      },
    };
    render(
      <I18nProvider>
        <DataCoverageCard data={data} loading={false} />
      </I18nProvider>,
    );
    expect(screen.getByText("Infrastructure ready / credential pending")).toBeTruthy();
    expect(screen.getByText("Inbox setup required")).toBeTruthy();
    expect(screen.queryByText("0.0%")).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.getByText("99.98%", { exact: false })).toBeTruthy();
    // Historical evidence is a technical detail, not a headline row.
    expect(screen.queryByText("Historical conversations")).toBeNull();
  });
});

describe("the manager screens speak business language", () => {
  const read = (file: string) =>
    readFileSync(
      join(import.meta.dirname, "..", "..", "src", "components", "acquisition", file),
      "utf8",
    );
  const JARGON = [
    "acquisition_event_id",
    "attribution_method",
    "provider_lead_id",
    "campaign_key",
    "match_method",
    "crm_carried",
  ];

  it.each(["ManagementOverview.tsx", "CreativeGallery.tsx", "SalesPerformance.tsx"])(
    "%s shows no engineering field names",
    (file) => {
      const source = read(file);
      for (const word of JARGON) expect(source, `${file} → ${word}`).not.toContain(word);
    },
  );

  it("keeps technical columns hidden by default in outcome tables", () => {
    const source = read("ClosedLoop.tsx");
    const crmColumn = source.slice(
      source.indexOf('key: "crm",'),
      source.indexOf('key: "crm",') + 200,
    );
    expect(crmColumn).toContain("hideByDefault: true");
    const confidenceColumn = source.slice(
      source.indexOf('key: "confidence",'),
      source.indexOf('key: "confidence",') + 200,
    );
    expect(confidenceColumn).toContain("hideByDefault: true");
  });
});

describe("no secret leaves the reconciliation", () => {
  it("redacts the token and access_token query values from stored errors", () => {
    const token = "EAAB-secret-token-value";
    const message = `GET https://graph.facebook.com/v25.0/?ids=1&access_token=${token}&appsecret_proof=abc123 failed: ${token}`;
    const redacted = redactMetaSecrets(message, token);
    expect(redacted).not.toContain(token);
    expect(redacted).not.toContain("abc123");
    expect(redacted).toContain("access_token=<redacted>");
  });
});
