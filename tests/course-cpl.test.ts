import { describe, expect, it } from "vitest";
import { courseCrmCpl } from "../src/lib/course-cpl";

describe("course CRM cost per lead", () => {
  it("divides attributed course spend by counted CRM leads", () => {
    expect(courseCrmCpl(120, 30)).toBe(4);
  });

  it("does not present missing spend or leads as a free acquisition", () => {
    expect(courseCrmCpl(0, 30)).toBeNull();
    expect(courseCrmCpl(120, 0)).toBeNull();
    expect(courseCrmCpl(Number.NaN, 30)).toBeNull();
  });
});
