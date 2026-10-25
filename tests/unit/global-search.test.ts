import { describe, expect, it } from "vitest";
import {
  matchScore,
  normalizeArabic,
  normalizeTerm,
  searchDestinations,
  searchNamed,
} from "@/lib/global-search";
import { SEARCH_DESTINATIONS } from "@/lib/global-search-registry";

const top = (query: string) => searchDestinations(query, SEARCH_DESTINATIONS, 5)[0]?.item.id;
const ids = (query: string) =>
  searchDestinations(query, SEARCH_DESTINATIONS, 5).map((hit) => hit.item.id);

describe("Arabic normalisation", () => {
  it("folds the differences a searcher does not think about", () => {
    expect(normalizeArabic("إعلانات")).toBe(normalizeArabic("اعلانات"));
    expect(normalizeArabic("مبيعـات")).toBe("مبيعات");
    expect(normalizeArabic("حملةٌ")).toBe("حمله");
    expect(normalizeArabic("مصطفى")).toBe("مصطفي");
  });

  it("drops punctuation and case without touching the display text", () => {
    expect(normalizeTerm("CFM - Saudi / September")).toBe("cfm saudi september");
  });
});

describe("the queries management actually types", () => {
  it("finds the report in Arabic", () => {
    expect(top("حملات")).toBe("campaigns");
    expect(top("مبيعات")).toBe("sales-crm");
    expect(top("تحصيل")).toBe("revenue");
    expect(top("كرياتيف")).toBe("creatives");
    expect(ids("صرف")).toContain("marketing");
    expect(ids("واتساب")).toContain("lead-sources");
  });

  it("finds the report in English", () => {
    expect(top("campaign")).toBe("campaigns");
    expect(top("creative")).toBe("creatives");
    expect(ids("revenue")).toContain("revenue");
    expect(ids("roas")).toContain("marketing");
    expect(ids("landing")).toContain("landing-pages");
    expect(ids("media buyer")).toContain("media-buyers");
  });

  it("survives a typo", () => {
    expect(top("campain")).toBe("campaigns");
    expect(top("campagn")).toBe("campaigns");
    expect(ids("creativ")).toContain("creatives");
    expect(ids("revenu")).toContain("revenue");
    expect(ids("whatsap")).toContain("lead-sources");
    expect(ids("landing pag")).toContain("landing-pages");
  });

  it("understands Arabizi", () => {
    expect(ids("hamlat")).toContain("campaigns");
    expect(ids("mabe3at")).toContain("sales-crm");
    expect(ids("ta7seel")).toContain("revenue");
    expect(ids("e3lanat")).toContain("campaigns");
  });

  it("understands business intent, not only page names", () => {
    expect(ids("best ads")).toContain("creatives");
    expect(ids("money")).toContain("revenue");
    expect(ids("team")).toContain("team");
    expect(ids("data health")).toContain("data-coverage");
  });

  it("returns nothing rather than a wrong destination", () => {
    expect(searchDestinations("zzzzzzzz", SEARCH_DESTINATIONS)).toEqual([]);
    expect(searchDestinations("", SEARCH_DESTINATIONS)).toEqual([]);
  });
});

describe("entity search", () => {
  const campaigns = [
    { name: "CFM - Saudi - September", extra: ["meta", "CFM"] },
    { name: "PMP-1/7/26-sayed", extra: ["meta", "PMP"] },
    { name: "cmrp-17/8/26-sayed", extra: ["meta", "CMRP"] },
  ];

  it("finds a campaign from part of its name", () => {
    expect(searchNamed("CFM", campaigns).map((hit) => hit.item.name)).toEqual([
      "CFM - Saudi - September",
    ]);
    expect(searchNamed("sayed", campaigns)).toHaveLength(2);
  });

  it("finds a creative by words from its Arabic name", () => {
    const creatives = [
      { name: "راتبك 30000 جنيه — PMP", extra: ["PMP campaign"] },
      { name: "CFM Video 03", extra: ["CFM - Saudi - September"] },
    ];
    expect(searchNamed("راتبك", creatives).map((hit) => hit.item.name)).toEqual([
      "راتبك 30000 جنيه — PMP",
    ]);
    expect(searchNamed("cfm video", creatives).map((hit) => hit.item.name)).toEqual([
      "CFM Video 03",
    ]);
  });

  it("requires every word of the query to match something", () => {
    expect(matchScore("cfm video", ["CFM Saudi September"])).toBe(0);
    expect(matchScore("cfm saudi", ["CFM Saudi September"])).toBeGreaterThan(0.8);
  });
});
