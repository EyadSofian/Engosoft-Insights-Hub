import { describe, expect, it } from "vitest";
import { parseLostArchiveTab } from "../../src/lib/lost-archive-google.server";

const headings = ["Salesperson", "Course Categories", "Lost Reason", "Validate", "Closed Date"];

describe("direct Lost Archive Google Sheets parsing", () => {
  it("reads only primary rows with an explicit audit verdict", () => {
    expect(
      parseLostArchiveTab("Oct", [
        headings,
        ["Mona", "CFM", "No Answer", "Yes", "2026-10-02"],
        ["Ali", "PMP", "Not Interested", "", ""],
        ["Sara", "BIM", "Duplicate", "No", ""],
      ]),
    ).toEqual([
      {
        __sheet_month: "Oct",
        __stable_key: "2026-Oct:2",
        Salesperson: "Mona",
        "Course Categories": "CFM",
        "Lost Reason": "No Answer",
        Validate: "Yes",
        "Closed Date": "2026-10-02",
      },
      {
        __sheet_month: "Oct",
        __stable_key: "2026-Oct:4",
        Salesperson: "Sara",
        "Course Categories": "BIM",
        "Lost Reason": "Duplicate",
        Validate: "No",
        "Closed Date": "",
      },
    ]);
  });

  it("rejects missing headers and validation tabs", () => {
    expect(() => parseLostArchiveTab("Oct", [["Validate"]])).toThrow(/headers changed/);
    expect(() => parseLostArchiveTab("Oct Validation", [headings])).toThrow(/Unknown/);
  });
});
