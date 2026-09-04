import { describe, expect, it } from "vitest";
import {
  buildPageContext,
  contextPreamble,
  entityFor,
  pageTypeFor,
  quickActionsFor,
  stripContext,
} from "@/components/engo-nexus/lib/nexus-context";
import type { GlobalFilters } from "@/lib/types";

describe("nexus-context — page type from the real routes", () => {
  it("maps every dashboard route", () => {
    expect(pageTypeFor("/")).toBe("overview");
    expect(pageTypeFor("")).toBe("overview");
    expect(pageTypeFor("/campaigns")).toBe("campaigns");
    expect(pageTypeFor("/ads")).toBe("ads");
    expect(pageTypeFor("/courses")).toBe("courses");
    expect(pageTypeFor("/sales")).toBe("sales");
    expect(pageTypeFor("/teams")).toBe("teams");
    expect(pageTypeFor("/leads")).toBe("leads");
    expect(pageTypeFor("/lost")).toBe("lost");
    expect(pageTypeFor("/accounting")).toBe("accounting");
    expect(pageTypeFor("/full-invoiced")).toBe("accounting");
    expect(pageTypeFor("/products")).toBe("products");
    expect(pageTypeFor("/media-buyers")).toBe("media_buyers");
    expect(pageTypeFor("/website")).toBe("website");
    expect(pageTypeFor("/yoy")).toBe("yoy");
    expect(pageTypeFor("/guide")).toBe("guide");
  });

  it("normalises case, trailing slashes and nested paths", () => {
    expect(pageTypeFor("/Campaigns/")).toBe("campaigns");
    expect(pageTypeFor("/sales/detail/123")).toBe("sales");
    expect(pageTypeFor("/onboarding")).toBe("other");
  });
});

describe("nexus-context — the most specific entity wins", () => {
  const base: GlobalFilters = {};

  it("prefers ad over ad set over campaign", () => {
    expect(entityFor({ ...base, campaign: "C", adset: "S", ad: "A", adKey: "ak" })).toEqual({
      entityType: "ad",
      entityId: "ak",
      entityName: "A",
    });
    expect(entityFor({ ...base, campaign: "C", adset: "S", adsetKey: "sk" })).toEqual({
      entityType: "adset",
      entityId: "sk",
      entityName: "S",
    });
    expect(entityFor({ ...base, campaign: "C", campaignKey: "ck" })).toEqual({
      entityType: "campaign",
      entityId: "ck",
      entityName: "C",
    });
  });

  it("falls back to the display value when no stable key exists", () => {
    expect(entityFor({ ...base, campaign: "C" })).toEqual({
      entityType: "campaign",
      entityId: "C",
      entityName: "C",
    });
  });

  it("covers course, salesperson, team and source", () => {
    expect(entityFor({ ...base, course: "PMP" }).entityType).toBe("course");
    expect(entityFor({ ...base, salesperson: "Ahmed" }).entityType).toBe("salesperson");
    expect(entityFor({ ...base, salesTeam: "Team A" }).entityType).toBe("team");
    expect(entityFor({ ...base, source: "Meta" }).entityType).toBe("source");
  });

  it("returns nothing when no dimension is set", () => {
    expect(entityFor(base)).toEqual({});
  });
});

describe("nexus-context — what is sent, and what is not", () => {
  it("sends only set, allowlisted filters", () => {
    const context = buildPageContext({
      path: "/campaigns",
      language: "ar",
      filters: {
        company: "Egypt - Engoaad",
        campaign: "PMP-SA",
        course: "",
        platform: "meta",
        // Never sent: business settings and internal view toggles.
        fxEgp: "48.5",
        fxSar: "3.75",
        lostDateBasis: "creation",
      },
    });
    expect(context.filters).toEqual({
      company: "Egypt - Engoaad",
      campaign: "PMP-SA",
      platform: "meta",
    });
    expect(context.filters).not.toHaveProperty("fxEgp");
    expect(context.filters).not.toHaveProperty("fxSar");
    expect(context.filters).not.toHaveProperty("lostDateBasis");
    expect(context.filters).not.toHaveProperty("course");
  });

  it("carries page type, language, entity and period", () => {
    const context = buildPageContext({
      path: "/courses",
      language: "en",
      filters: { course: "PMP", from: "2026-08-01", to: "2026-08-31", company: "Engosoft - KSA" },
    });
    expect(context).toMatchObject({
      path: "/courses",
      pageType: "courses",
      language: "en",
      entityType: "course",
      entityName: "PMP",
      market: "Engosoft - KSA",
      period: { from: "2026-08-01", to: "2026-08-31" },
    });
  });

  it("omits the period entirely when no date filter is set", () => {
    expect(buildPageContext({ path: "/", language: "en", filters: {} }).period).toBeUndefined();
  });

  it("carries a range-only period", () => {
    expect(
      buildPageContext({ path: "/", language: "en", filters: { range: "all" } }).period,
    ).toEqual({ from: undefined, to: undefined, range: "all" });
  });

  it("never carries a user identity, token or secret field", () => {
    const context = buildPageContext({
      path: "/sales",
      language: "en",
      filters: { salesperson: "Ahmed", company: "Engosoft - KSA" },
    });
    const serialized = JSON.stringify(context).toLowerCase();
    for (const forbidden of [
      "token",
      "secret",
      "apikey",
      "api_key",
      "password",
      "email",
      "authorization",
      "cookie",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("nexus-context — the preamble", () => {
  it("is compact, labelled, and includes the entity and period", () => {
    const preamble = contextPreamble(
      buildPageContext({
        path: "/campaigns",
        language: "ar",
        filters: { campaign: "PMP-SA", from: "2026-08-01", to: "2026-08-31", platform: "meta" },
      }),
    );
    expect(preamble).toMatch(/^\[dashboard context: /);
    expect(preamble).toContain("page=campaigns");
    expect(preamble).toContain('campaign="PMP-SA"');
    expect(preamble).toContain("period=2026-08-01..2026-08-31");
    expect(preamble).toContain("platform=meta");
    // The entity appears once, as the quoted entity — not a second time as a
    // bare filter, which would double the campaign name in every preamble.
    expect(preamble.match(/campaign="/g) ?? []).toHaveLength(1);
    expect(preamble).not.toContain("campaign=PMP-SA");
  });

  it("renders a range period and a bare page", () => {
    expect(
      contextPreamble(buildPageContext({ path: "/", language: "en", filters: { range: "all" } })),
    ).toContain("period=all");
    expect(contextPreamble(buildPageContext({ path: "/", language: "en", filters: {} }))).toBe(
      "[dashboard context: page=overview]",
    );
  });

  it("round-trips: what is prepended is exactly what stripContext removes", () => {
    const preamble = contextPreamble(
      buildPageContext({ path: "/sales", language: "ar", filters: { salesTeam: "Team A" } }),
    );
    const sent = `${preamble}\nليه المبيعات قلت؟`;
    expect(stripContext(sent)).toBe("ليه المبيعات قلت؟");
  });

  it("leaves an ordinary message untouched", () => {
    expect(stripContext("كام الإيرادات الشهر ده؟")).toBe("كام الإيرادات الشهر ده؟");
    expect(stripContext("[not a context] hello")).toBe("[not a context] hello");
  });
});

describe("nexus-context — quick actions follow the page", () => {
  it("offers page-specific actions in both languages", () => {
    const campaignsAr = quickActionsFor("campaigns", "ar");
    expect(campaignsAr.map((a) => a.id)).toEqual(["analyse", "roas", "problem"]);
    expect(campaignsAr[0]!.label).toBe("حلل الحملات");

    const campaignsEn = quickActionsFor("campaigns", "en");
    expect(campaignsEn[0]!.label).toBe("Analyse campaigns");
    expect(campaignsEn[0]!.prompt).not.toMatch(/[؀-ۿ]/);
  });

  it("falls back to general actions for a page with none", () => {
    const actions = quickActionsFor("guide", "en");
    expect(actions.map((a) => a.id)).toEqual(["performance", "sales", "prices"]);
  });

  it("gives every action a non-empty label and prompt", () => {
    const pages = [
      "overview",
      "campaigns",
      "ads",
      "sales",
      "teams",
      "lost",
      "courses",
      "products",
      "accounting",
      "other",
    ] as const;
    for (const page of pages) {
      for (const lang of ["ar", "en"] as const) {
        for (const action of quickActionsFor(page, lang)) {
          expect(action.id).toBeTruthy();
          expect(action.label.trim().length).toBeGreaterThan(0);
          expect(action.prompt.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("uses Arabic prompts in Arabic and English prompts in English", () => {
    expect(quickActionsFor("sales", "ar")[0]!.prompt).toMatch(/[؀-ۿ]/);
    expect(quickActionsFor("sales", "en")[0]!.prompt).not.toMatch(/[؀-ۿ]/);
  });
});
