import { describe, expect, it } from "vitest";
import {
  parseMetric,
  parseNexusMessage,
  parseSources,
} from "@/components/engo-nexus/lib/nexus-message-schema";

describe("nexus schema — unknown shapes degrade, never throw", () => {
  it("returns null for anything unrecognised", () => {
    expect(parseNexusMessage("not_a_type", {})).toBeNull();
    expect(parseNexusMessage(null, null)).toBeNull();
    expect(parseNexusMessage(undefined, undefined)).toBeNull();
    expect(parseNexusMessage(123, {})).toBeNull();
    expect(parseNexusMessage("kpi_card", "a string")).toBeNull();
  });

  it("falls back to a type declared inside the payload", () => {
    expect(parseNexusMessage(null, { type: "text", text: "hi" })).toEqual({
      type: "text",
      text: "hi",
      sources: [],
    });
  });
});

describe("nexus schema — sources are never inferred", () => {
  it("accepts only the three known sources", () => {
    expect(parseSources(["insights_hub", "price_engo", "engosoft_knowledge"])).toHaveLength(3);
    expect(parseSources(["insights_hub", "made_up", 5, null])).toEqual(["insights_hub"]);
    expect(parseSources("insights_hub")).toEqual([]);
    expect(parseSources(undefined)).toEqual([]);
  });

  it("gives a text message no source when it declared none", () => {
    expect(parseNexusMessage("text", { text: "x" })).toMatchObject({ sources: [] });
  });
});

describe("nexus schema — metrics", () => {
  it("parses a full metric", () => {
    expect(
      parseMetric({
        key: "revenue",
        label: "Revenue",
        value: 7009.36,
        unit: "money",
        currency: "USD",
        delta: 12.4,
        direction: "higher_is_better",
      }),
    ).toEqual({
      key: "revenue",
      label: "Revenue",
      value: 7009.36,
      unit: "money",
      currency: "USD",
      delta: 12.4,
      deltaUnit: "percent",
      direction: "higher_is_better",
      unavailable: null,
    });
  });

  it("requires a key", () => {
    expect(parseMetric({ label: "x", value: 1 })).toBeNull();
    expect(parseMetric(null)).toBeNull();
    expect(parseMetric("x")).toBeNull();
  });

  it("falls back to the key as the label", () => {
    expect(parseMetric({ key: "cpl", value: 6.99 })?.label).toBe("cpl");
  });

  it("nulls a non-finite value rather than passing it through", () => {
    expect(parseMetric({ key: "a", value: Number.NaN })?.value).toBeNull();
    expect(parseMetric({ key: "a", value: Infinity })?.value).toBeNull();
    expect(parseMetric({ key: "a" })?.value).toBeNull();
    expect(parseMetric({ key: "a", value: 0 })?.value).toBe(0);
    expect(parseMetric({ key: "a", value: "n/a" })?.value).toBe("n/a");
  });

  it("defaults an unknown unit and rejects an unknown direction", () => {
    expect(parseMetric({ key: "a", unit: "furlongs" })?.unit).toBe("count");
    expect(parseMetric({ key: "a", direction: "sideways" })?.direction).toBeUndefined();
  });
});

describe("nexus schema — price_card never invents a price", () => {
  it("parses an authoritative quote", () => {
    const parsed = parseNexusMessage("price_card", {
      productName: "PMP + Exam",
      deliveryMode: "ONLINE",
      externalCode: "109",
      effectivePrice: 600,
      currency: "SAR",
      market: "SAUDI_ARABIA",
      paymentMethod: "CASH",
      promotion: { campaign: "National Day Offers", validUntil: "2026-10-09" },
    });
    expect(parsed).toMatchObject({
      type: "price_card",
      effectivePrice: 600,
      currency: "SAR",
      promotion: { campaign: "National Day Offers" },
      sources: ["price_engo"],
    });
  });

  it("leaves a missing price null — never 0", () => {
    const parsed = parseNexusMessage("price_card", { productName: "X" });
    expect(parsed).toMatchObject({ effectivePrice: null, currency: null });
  });

  it("requires a product name", () => {
    expect(parseNexusMessage("price_card", { effectivePrice: 600 })).toBeNull();
  });

  it("treats explicit unavailability as unavailable, and silence as available", () => {
    expect(parseNexusMessage("price_card", { productName: "X", available: false })).toMatchObject({
      available: false,
    });
    expect(parseNexusMessage("price_card", { productName: "X" })).toMatchObject({
      available: true,
    });
  });
});

describe("nexus schema — course_selector", () => {
  it("keeps every candidate and drops malformed ones", () => {
    const parsed = parseNexusMessage("course_selector", {
      question: "تقصد أنهي نسخة؟",
      candidates: [
        { productId: "p1", name: "PMP + Exam", deliveryMode: "ONLINE", externalCode: "109" },
        { productId: "p2", name: "PMP + Exam", deliveryMode: "RECORDED", externalCode: "108" },
        { name: "no id" },
        null,
      ],
    });
    expect(parsed).toMatchObject({ type: "course_selector" });
    expect((parsed as { candidates: unknown[] }).candidates).toHaveLength(2);
  });

  it("returns null with no usable candidate — never an empty chooser", () => {
    expect(parseNexusMessage("course_selector", { candidates: [] })).toBeNull();
    expect(parseNexusMessage("course_selector", {})).toBeNull();
  });
});

describe("nexus schema — decision_card", () => {
  it("parses a full recommendation", () => {
    const parsed = parseNexusMessage("decision_card", {
      decision: "REDUCE",
      priority: "HIGH",
      summary: "Reduce exposure on this campaign.",
      why: ["INFERENCE: both signals degraded"],
      confidence: "HIGH",
      owner: "MEDIA_BUYER",
      reviewWindowDays: 7,
      nextKpi: "campaign.cpl",
      actionBand: { display: "$8.00 – $12.00", provenance: "180 days of history" },
      sources: ["insights_hub"],
    });
    expect(parsed).toMatchObject({
      type: "decision_card",
      decision: "REDUCE",
      priority: "HIGH",
      confidence: "HIGH",
      actionBand: { display: "$8.00 – $12.00" },
    });
  });

  it("nulls an action band with no display value — no band, no magnitude", () => {
    expect(
      parseNexusMessage("decision_card", {
        decision: "REDUCE",
        summary: "s",
        actionBand: { provenance: "x" },
      }),
    ).toMatchObject({ actionBand: null });
    expect(parseNexusMessage("decision_card", { decision: "REDUCE", summary: "s" })).toMatchObject({
      actionBand: null,
    });
  });

  it("rejects an unknown priority or confidence rather than guessing", () => {
    expect(
      parseNexusMessage("decision_card", {
        decision: "HOLD",
        summary: "s",
        priority: "URGENT",
        confidence: "PRETTY_SURE",
      }),
    ).toMatchObject({ priority: null, confidence: null });
  });

  it("requires a decision and a summary", () => {
    expect(parseNexusMessage("decision_card", { decision: "REDUCE" })).toBeNull();
    expect(parseNexusMessage("decision_card", { summary: "s" })).toBeNull();
  });
});

describe("nexus schema — the remaining types", () => {
  it("parses kpi_card and kpi_group", () => {
    expect(
      parseNexusMessage("kpi_card", { metric: { key: "revenue", value: 1, unit: "money" } }),
    ).toMatchObject({ type: "kpi_card" });
    expect(parseNexusMessage("kpi_card", {})).toBeNull();
    expect(
      parseNexusMessage("kpi_group", { metrics: [{ key: "a" }, { key: "b" }, null] }),
    ).toMatchObject({ type: "kpi_group" });
    expect(parseNexusMessage("kpi_group", { metrics: [] })).toBeNull();
  });

  it("parses comparison_card and requires both sides", () => {
    expect(
      parseNexusMessage("comparison_card", {
        left: { label: "Aug", metrics: [{ key: "revenue" }] },
        right: { label: "Sep", metrics: [{ key: "revenue" }] },
      }),
    ).toMatchObject({ type: "comparison_card" });
    expect(parseNexusMessage("comparison_card", { left: { label: "Aug" } })).toBeNull();
    expect(parseNexusMessage("comparison_card", { left: {}, right: { label: "Sep" } })).toBeNull();
  });

  it("parses quick_replies and drops empty option sets", () => {
    expect(
      parseNexusMessage("quick_replies", {
        text: "Which period?",
        options: [{ label: "This month" }, { label: "Last month", value: "last" }, null],
      }),
    ).toMatchObject({
      type: "quick_replies",
      options: [
        { label: "This month", value: "This month" },
        { label: "Last month", value: "last" },
      ],
    });
    expect(parseNexusMessage("quick_replies", { options: [] })).toBeNull();
  });

  it("parses chart and requires x, series and rows", () => {
    const good = {
      chartType: "bar",
      xKey: "date",
      series: [{ key: "revenue", label: "Revenue", unit: "money", currency: "USD" }],
      rows: [{ date: "2026-09-01", revenue: 100 }],
    };
    expect(parseNexusMessage("chart", good)).toMatchObject({ type: "chart", chartType: "bar" });
    expect(parseNexusMessage("chart", { ...good, rows: [] })).toBeNull();
    expect(parseNexusMessage("chart", { ...good, series: [] })).toBeNull();
    expect(parseNexusMessage("chart", { ...good, xKey: undefined })).toBeNull();
    expect(parseNexusMessage("chart", { ...good, chartType: "pie" })).toMatchObject({
      chartType: "line",
    });
  });

  it("parses table and surfaces truncation", () => {
    expect(
      parseNexusMessage("table", {
        columns: [{ key: "name", label: "Name", unit: "text" }],
        rows: [{ name: "PMP" }],
        truncated: true,
      }),
    ).toMatchObject({ type: "table", truncated: true });
    expect(parseNexusMessage("table", { columns: [], rows: [] })).toBeNull();
  });

  it("parses alert, progress and error", () => {
    expect(parseNexusMessage("alert", { title: "Stale data", level: "warning" })).toMatchObject({
      level: "warning",
    });
    expect(parseNexusMessage("alert", { title: "x", level: "nope" })).toMatchObject({
      level: "info",
    });
    expect(parseNexusMessage("alert", {})).toBeNull();
    expect(
      parseNexusMessage("progress", { label: "Reading…", step: 1, totalSteps: 4 }),
    ).toMatchObject({ type: "progress", step: 1 });
    expect(parseNexusMessage("progress", {})).toBeNull();
    expect(parseNexusMessage("error", { title: "Failed" })).toMatchObject({ retryable: true });
    expect(parseNexusMessage("error", { title: "Failed", retryable: false })).toMatchObject({
      retryable: false,
    });
    expect(parseNexusMessage("error", {})).toBeNull();
  });
});
