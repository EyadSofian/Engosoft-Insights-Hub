import { describe, expect, it } from "vitest";
import { dateTime } from "../../src/lib/crm-odoo.server";

describe("Odoo CRM date normalization", () => {
  it("treats Odoo's boolean false date as missing so fallbacks can run", () => {
    expect(dateTime(false)).toBe("");
    expect(dateTime("false")).toBe("");
    expect(dateTime(null)).toBe("");
  });

  it("keeps ISO days and converts UTC datetimes to Cairo", () => {
    expect(dateTime("2026-09-15")).toBe("2026-09-15");
    expect(dateTime("2026-09-15 22:30:00")).toBe("2026-09-16 01:30:00");
  });
});
