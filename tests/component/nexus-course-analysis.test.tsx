// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BlockMessage } from "@botpress/webchat";
import { NexusMessageRenderer } from "@/components/engo-nexus/NexusMessageRenderer";

afterEach(cleanup);

const campaign = (i: number) => ({
  key: `c${i}`,
  name: `PMP-${i}/7/26-sayed`,
  platform: i % 2 ? "meta" : "tiktok",
  spend: 1000 + i,
  crmLeads: 100 + i,
  won: 10 + i,
  revenue: 5000 - i * 100,
  invoices: 20 + i,
  salesOrders: 18 + i,
  roas: 5 - i * 0.1,
  verdict: i === 0 ? "good" : "watch",
});

const product = (i: number) => ({
  displayName: `[10${i}] Management - PMP - Event ${i}`,
  productCode: `10${i}`,
  invoices: 30 + i,
  salesOrders: 25 + i,
  revenue: 3000 - i * 100,
  revenueShare: 0.5 - i * 0.05,
});

const payload = (campaigns: number, products = 2) => ({
  type: "course_analysis",
  course: "PMP",
  period: { from: "2026-08-01", to: "2026-08-31", label: "أغسطس 2026" },
  summary: [
    { key: "spend", label: "الإنفاق", value: 3404.66, unit: "currency", currency: "USD" },
    { key: "revenue", label: "الإيراد", value: 24189.27, unit: "currency", currency: "USD" },
    { key: "roas", label: "ROAS", value: 7.1, unit: "ratio" },
    { key: "won", label: "المبيعات", value: 68, unit: "count" },
    { key: "cpl", label: "CPL", value: 5.23, unit: "currency", currency: "USD" },
  ],
  campaigns: Array.from({ length: campaigns }, (_, i) => campaign(i)),
  products: Array.from({ length: products }, (_, i) => product(i)),
  recommendation: {
    summary: "ركز على PMP-0/7/26-sayed",
    reasons: ["أعلى إيراد فعلي", "ROAS جيد", "مبيعات مؤكدة"],
    risk: "54% من الإيراد مش منسوب لأي حملة",
    confidence: "medium",
  },
  actions: [
    { label: "حلل أفضل حملة", value: "حلل أفضل حملة" },
    { label: "قارن المنتجات", value: "قارن المنتجات" },
  ],
  sources: ["insights_hub"],
});

const block = (data: unknown): BlockMessage =>
  ({
    id: "m-1",
    timestamp: new Date("2026-09-04T00:00:00Z"),
    block: { type: "custom", name: "course_analysis", url: "", data },
  }) as unknown as BlockMessage;

const renderAnalysis = (campaigns: number, products = 2, onSend = vi.fn()) => {
  render(
    <NexusMessageRenderer
      message={block(payload(campaigns, products))}
      options={{ lang: "ar", onSend }}
    />,
  );
  return onSend;
};

describe("course analysis — layout follows the count, not the model", () => {
  it("renders individual cards for three campaigns", () => {
    renderAnalysis(3);
    expect(screen.getAllByTestId("nexus-campaign-card")).toHaveLength(3);
    expect(screen.queryByTestId("nexus-campaign-carousel")).toBeNull();
    expect(screen.queryByTestId("nexus-show-all-campaigns")).toBeNull();
  });

  it("renders a carousel at four", () => {
    renderAnalysis(4);
    expect(screen.getByTestId("nexus-campaign-carousel")).toBeTruthy();
  });

  it("still uses a carousel at eight", () => {
    renderAnalysis(8);
    expect(screen.getByTestId("nexus-campaign-carousel")).toBeTruthy();
  });

  it("switches to top-three plus a hidden table at nine", () => {
    renderAnalysis(9);
    expect(screen.getAllByTestId("nexus-campaign-card")).toHaveLength(3);
    expect(screen.getByTestId("nexus-show-all-campaigns")).toBeTruthy();
    // The table is not in the DOM until asked for.
    expect(screen.queryByTestId("nexus-campaign-table")).toBeNull();
  });

  it("keeps twenty-five campaigns compact", () => {
    renderAnalysis(25);
    // Three cards, not twenty-five. This is the whole point.
    expect(screen.getAllByTestId("nexus-campaign-card")).toHaveLength(3);
    expect(screen.getByTestId("nexus-show-all-campaigns").textContent).toContain("25");
  });

  it("renders no campaign section at all when there are none", () => {
    renderAnalysis(0, 2);
    expect(screen.queryByTestId("nexus-campaign-card")).toBeNull();
    expect(screen.queryByTestId("nexus-campaign-carousel")).toBeNull();
  });
});

describe("expanding is frontend state — it never asks the model", () => {
  it("reveals the table without sending anything", () => {
    const onSend = renderAnalysis(17);
    fireEvent.click(screen.getByTestId("nexus-show-all-campaigns"));
    expect(screen.getByTestId("nexus-campaign-table")).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows only the first rows, then pages", () => {
    const onSend = renderAnalysis(17);
    fireEvent.click(screen.getByTestId("nexus-show-all-campaigns"));
    // Five rows initially, in both the table and the stacked list.
    expect(screen.getAllByRole("button", { name: /PMP-/ }).length).toBeLessThanOrEqual(12);
    fireEvent.click(screen.getByTestId("nexus-campaign-more"));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("sorts locally without a model call", () => {
    const onSend = renderAnalysis(17);
    fireEvent.click(screen.getByTestId("nexus-show-all-campaigns"));
    fireEvent.click(screen.getAllByRole("button", { name: "ROAS" })[0]!);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("filters locally without a model call", () => {
    const onSend = renderAnalysis(9);
    fireEvent.click(screen.getByRole("button", { name: "الأضعف" }));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("nexus-campaign-card")).toHaveLength(3);
  });

  it("expands extra summary metrics locally", () => {
    const onSend = renderAnalysis(3);
    fireEvent.click(screen.getByTestId("nexus-summary-details-toggle"));
    expect(screen.getByTestId("nexus-summary-details-content")).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("clicking a card sends a real follow-up", () => {
  it("sends an analysis request naming the campaign", () => {
    const onSend = renderAnalysis(3);
    fireEvent.click(screen.getAllByRole("button", { name: "حلل" })[0]!);
    expect(onSend).toHaveBeenCalledWith("حلل حملة PMP-0/7/26-sayed");
  });

  it("sends a what-sold request", () => {
    const onSend = renderAnalysis(3);
    fireEvent.click(screen.getAllByRole("button", { name: "باعت إيه؟" })[0]!);
    expect(onSend).toHaveBeenCalledWith("حملة PMP-0/7/26-sayed باعت إيه؟");
  });

  it("sends a price request from a product card", () => {
    const onSend = renderAnalysis(3);
    fireEvent.click(screen.getAllByRole("button", { name: "السعر الحالي" })[0]!);
    expect(onSend).toHaveBeenCalledWith(
      "سعر [100] Management - PMP - Event 0 دلوقتي في السعودية كاش؟",
    );
  });

  it("sends a quick action", () => {
    const onSend = renderAnalysis(3);
    fireEvent.click(screen.getByRole("button", { name: "قارن المنتجات" }));
    expect(onSend).toHaveBeenCalledWith("قارن المنتجات");
  });

  it("shows at most four quick actions", () => {
    renderAnalysis(3);
    const actions = screen.getByTestId("nexus-quick-actions");
    expect(actions.querySelectorAll("button").length).toBeLessThanOrEqual(4);
  });
});

describe("Arabic layout and LTR isolation", () => {
  it("isolates every Latin campaign name, including inside prose", () => {
    // The recommendation summary is an Arabic sentence with a Latin campaign
    // name in it — the exact case the bidi algorithm scrambles.
    renderAnalysis(3);
    const names = screen.getAllByText(/PMP-\d\/7\/26-sayed/);
    expect(names.length).toBeGreaterThan(1);
    for (const node of names) {
      const bdi = node.closest("bdi");
      expect(bdi, node.textContent ?? "").not.toBeNull();
      expect(bdi!.getAttribute("dir")).toBe("ltr");
      expect(bdi!.className).toContain("nexus-ltr");
    }
  });

  it("isolates the product code", () => {
    renderAnalysis(3);
    const code = screen.getAllByText("100")[0]!;
    expect(code.closest("bdi")?.getAttribute("dir")).toBe("ltr");
  });

  it("uses Arabic labels, not English field names", () => {
    renderAnalysis(3);
    const text = screen.getByTestId("nexus-course-analysis").textContent ?? "";
    expect(text).toContain("الإنفاق");
    expect(text).toContain("الإيراد");
    // The source is a badge, not the word "المصدر".
    expect(screen.getByTestId("nexus-sources").textContent).toContain("Insights Hub");
    // Accepted acronyms stay.
    expect(text).toContain("ROAS");
    // Raw English field names must not appear as labels.
    expect(text).not.toMatch(/\bspend\b/);
    expect(text).not.toMatch(/\brevenue\b/);
  });
});

describe("the recommendation is a card, not a paragraph", () => {
  it("renders the summary, reasons and risk separately", () => {
    renderAnalysis(3);
    const card = screen.getByTestId("nexus-recommendation-card");
    expect(card.textContent).toContain("رأيي");
    expect(card.querySelectorAll("li")).toHaveLength(3);
    expect(card.textContent).toContain("54%");
  });
});

describe("no internal identifiers, ever", () => {
  it("shows no UUID and no internal key", () => {
    render(
      <NexusMessageRenderer
        message={block({
          ...payload(3),
          campaigns: [
            {
              ...campaign(0),
              key: "36faea0f-9bcc-4d58-8694-bc332753df52",
            },
          ],
          products: [{ ...product(0), productId: "8b2a6699-8558-43b9-b846-72d68db6f162" }],
        })}
        options={{ lang: "ar", onSend: vi.fn() }}
      />,
    );
    const text = screen.getByTestId("nexus-course-analysis").textContent ?? "";
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});

describe("no serialization garbage, on any payload", () => {
  const assertClean = () => {
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("[object Object]");
    expect(text).not.toContain("[object Array]");
    expect(text).not.toMatch(/(?<![\w-])undefined(?![\w-])/);
    expect(text).not.toMatch(/(?<![\w-])NaN(?![\w-])/);
    expect(text).not.toMatch(/(?<![\w-])Infinity(?![\w-])/);
  };

  it("is clean across every layout mode", () => {
    for (const n of [1, 3, 4, 8, 9, 25]) {
      cleanup();
      renderAnalysis(n);
      assertClean();
    }
  });

  it("is clean when every optional field is missing", () => {
    render(
      <NexusMessageRenderer
        message={block({
          type: "course_analysis",
          course: "PMP",
          campaigns: [{ name: "Bare campaign" }],
          products: [{ displayName: "Bare product" }],
        })}
        options={{ lang: "ar", onSend: vi.fn() }}
      />,
    );
    assertClean();
  });

  it("is clean when values are non-finite", () => {
    render(
      <NexusMessageRenderer
        message={block({
          type: "course_analysis",
          course: "PMP",
          campaigns: [
            { name: "Odd", spend: Number.NaN, revenue: Number.POSITIVE_INFINITY, roas: null },
          ],
          products: [],
          recommendation: { summary: "x", reasons: [], confidence: "high" },
        })}
        options={{ lang: "ar", onSend: vi.fn() }}
      />,
    );
    assertClean();
  });

  it("falls back to text for a malformed payload rather than an empty shell", () => {
    render(
      <NexusMessageRenderer
        message={block({ type: "course_analysis", course: "PMP" })}
        options={{ lang: "ar", onSend: vi.fn() }}
      />,
    );
    expect(screen.queryByTestId("nexus-course-analysis")).toBeNull();
    assertClean();
  });
});

describe("the block name Botpress actually sends", () => {
  it("renders when the block is named after the component, not the type", () => {
    // Botpress names a custom-component block after the registered component.
    // Trusting `name` blindly meant a valid payload fell through to plain text.
    render(
      <NexusMessageRenderer
        message={
          {
            id: "m-2",
            timestamp: new Date("2026-09-04T00:00:00Z"),
            block: {
              type: "custom",
              name: "CourseAnalysisComponent",
              url: "",
              data: payload(3),
            },
          } as unknown as BlockMessage
        }
        options={{ lang: "ar", onSend: vi.fn() }}
      />,
    );
    expect(screen.getByTestId("nexus-course-analysis")).toBeTruthy();
  });

  it("still honours a known type name over the payload", () => {
    render(
      <NexusMessageRenderer
        message={block(payload(3))}
        options={{ lang: "ar", onSend: vi.fn() }}
      />,
    );
    expect(screen.getByTestId("nexus-course-analysis")).toBeTruthy();
  });
});
