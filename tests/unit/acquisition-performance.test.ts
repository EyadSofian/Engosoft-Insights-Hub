import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { confidenceBucket, costPer, landingPageForUrl } from "@/lib/acquisition-performance";
import { TRACKED_LANDING_PAGES } from "@/lib/landing-pages";

describe("confidenceBucket", () => {
  it("calls an event exact only with the campaign ID the provider proved", () => {
    expect(confidenceBucket("exact", true)).toBe("exact");
    expect(confidenceBucket("exact", false)).toBe("unknown");
  });

  it("keeps declared, inferred and unknown evidence apart", () => {
    expect(confidenceBucket("declared", false)).toBe("declared");
    expect(confidenceBucket("strong", true)).toBe("declared");
    expect(confidenceBucket("inferred", false)).toBe("inferred");
    expect(confidenceBucket("unknown", true)).toBe("unknown");
    expect(confidenceBucket("", false)).toBe("unknown");
  });
});

describe("costPer", () => {
  it("shows a cost only when there is spend and at least one event", () => {
    expect(costPer(100, 4)).toBe(25);
    expect(costPer(10, 3)).toBe(3.33);
    expect(costPer(100, 0)).toBeNull();
    expect(costPer(0, 5)).toBeNull();
  });
});

describe("landingPageForUrl", () => {
  const pages = [
    { id: "cfm", slug: "cfm" },
    { id: "bim-track", slug: "bim-track" },
  ];

  it("resolves a creative URL to a tracked page by exact path on engosoft.com", () => {
    expect(landingPageForUrl("https://engosoft.com/cfm", pages)).toBe("cfm");
    expect(landingPageForUrl("https://www.engosoft.com/en/cfm/?utm_source=fb", pages)).toBe("cfm");
    expect(landingPageForUrl("https://engosoft.com/bim-track", pages)).toBe("bim-track");
  });

  it("never guesses from shop pages, short links, look-alike paths or other hosts", () => {
    for (const url of [
      "https://engosoft.com/shop/cfm-preparation-course-1109",
      "https://engosoft.com/r/gnW",
      "https://engosoft.com/cfm-webinar",
      "https://fakeengosoft.com/cfm",
      "http://fb.me/",
      "not a url",
    ])
      expect(landingPageForUrl(url, pages), url).toBeNull();
  });
});

describe("TRACKED_LANDING_PAGES", () => {
  it("matches the pages the Odoo tracker instruments", () => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "..", "src", "lib", "landing-attribution.odoo.ts"),
      "utf8",
    );
    const tracker = [
      ...source.matchAll(/id: "([^"]+)",\s*name: "([^"]+)",\s*slug: "([^"]+)"/g),
    ].map(([, id, name, slug]) => ({ id, name, slug }));
    expect(TRACKED_LANDING_PAGES).toEqual(tracker);
  });
});
