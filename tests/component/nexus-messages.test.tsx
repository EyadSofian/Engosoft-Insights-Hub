// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { BlockMessage } from "@botpress/webchat";
import { NexusMessageRenderer } from "@/components/engo-nexus/NexusMessageRenderer";
import { selectionValueOf, stripContext } from "@/components/engo-nexus/lib/nexus-context";

afterEach(cleanup);

/** A Botpress `custom` block carrying an ENGO Nexus typed payload. */
function customMessage(name: string, data: unknown): BlockMessage {
  return {
    id: `m-${name}`,
    timestamp: new Date("2026-09-04T00:00:00Z"),
    block: { type: "custom", name, url: "", data },
  } as BlockMessage;
}

function nativeMessage(block: unknown): BlockMessage {
  return {
    id: "m-native",
    timestamp: new Date("2026-09-04T00:00:00Z"),
    block,
  } as BlockMessage;
}

const baseOptions = { lang: "en" as const, onSend: vi.fn() };

describe("renderer — text", () => {
  it("renders markdown prose", () => {
    render(
      <NexusMessageRenderer
        message={nativeMessage({ type: "text", text: "**Revenue** is up" })}
        options={baseOptions}
      />,
    );
    expect(screen.getByTestId("nexus-text")).toHaveTextContent("Revenue is up");
    expect(screen.getByText("Revenue").tagName).toBe("STRONG");
  });

  it("drops images from markdown rather than loading remote content", () => {
    const { container } = render(
      <NexusMessageRenderer
        message={nativeMessage({ type: "text", text: "![x](https://evil.test/a.png)" })}
        options={baseOptions}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("opens links safely", () => {
    render(
      <NexusMessageRenderer
        message={nativeMessage({ type: "text", text: "[docs](https://example.test)" })}
        options={baseOptions}
      />,
    );
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });
});

describe("renderer — KPI cards decide colour, not the model", () => {
  it("shows a falling CPL as positive and a falling revenue as negative", () => {
    render(
      <NexusMessageRenderer
        message={customMessage("kpi_group", {
          metrics: [
            { key: "cpl", label: "CPL", value: 6.99, unit: "money", currency: "USD", delta: -12 },
            {
              key: "revenue",
              label: "Revenue",
              value: 7009.36,
              unit: "money",
              currency: "USD",
              delta: -8,
            },
          ],
        })}
        options={baseOptions}
      />,
    );
    expect(screen.getByTestId("nexus-metric-delta-cpl")).toHaveAttribute("data-tone", "positive");
    expect(screen.getByTestId("nexus-metric-delta-revenue")).toHaveAttribute(
      "data-tone",
      "negative",
    );
  });

  it("is neutral when the metric direction is unknown", () => {
    render(
      <NexusMessageRenderer
        message={customMessage("kpi_card", {
          metric: { key: "mystery", label: "Mystery", value: 1, delta: 5 },
        })}
        options={baseOptions}
      />,
    );
    expect(screen.getByTestId("nexus-metric-delta-mystery")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
  });

  it("never renders float noise", () => {
    render(
      <NexusMessageRenderer
        message={customMessage("kpi_card", {
          metric: {
            key: "revenue",
            label: "Revenue",
            value: 138187.35635592628,
            unit: "money",
            currency: "USD",
          },
        })}
        options={baseOptions}
      />,
    );
    expect(screen.getByTestId("nexus-metric-value-revenue")).toHaveTextContent("$138,187.36");
    expect(screen.queryByText(/138187\.35635592628/)).toBeNull();
  });

  it("shows an unmeasurable metric as a dash with its reason, never as zero", () => {
    render(
      <NexusMessageRenderer
        message={customMessage("kpi_card", {
          metric: {
            key: "conversionRate",
            label: "Conversion",
            value: null,
            unit: "percent",
            unavailable: "No CRM leads in this window, so there is no denominator.",
          },
        })}
        options={baseOptions}
      />,
    );
    expect(screen.getByTestId("nexus-metric-value-conversionRate")).toHaveTextContent("—");
    expect(screen.getByText(/no denominator/i)).toBeInTheDocument();
  });
});

describe("renderer — price card renders only what PriceEngo returned", () => {
  it("renders the authoritative price, promotion and validity", () => {
    render(
      <NexusMessageRenderer
        message={customMessage("price_card", {
          productName: "PMP + Exam",
          deliveryMode: "ONLINE",
          externalCode: "109",
          effectivePrice: 600,
          currency: "SAR",
          market: "SAUDI_ARABIA",
          paymentMethod: "CASH",
          promotion: { campaign: "National Day Offers", validUntil: "2026-10-09" },
        })}
        options={baseOptions}
      />,
    );
    expect(screen.getByTestId("nexus-price-value")).toHaveTextContent("600.00 SAR");
    expect(screen.getByText("PMP + Exam")).toBeInTheDocument();
    expect(screen.getByText("National Day Offers")).toBeInTheDocument();
    expect(screen.getByText(/09 Oct 2026/)).toBeInTheDocument();
    expect(within(screen.getByTestId("nexus-sources")).getByText("PriceEngo")).toBeInTheDocument();
  });

  it("renders a missing price as a dash — never as free", () => {
    render(
      <NexusMessageRenderer
        message={customMessage("price_card", { productName: "Some course" })}
        options={baseOptions}
      />,
    );
    expect(screen.getByTestId("nexus-price-value")).toHaveTextContent("—");
    expect(screen.queryByText(/^0/)).toBeNull();
  });

  it("says so when the product is unavailable on the market", () => {
    render(
      <NexusMessageRenderer
        message={customMessage("price_card", {
          productName: "X",
          effectivePrice: 600,
          currency: "SAR",
          available: false,
        })}
        options={baseOptions}
      />,
    );
    expect(screen.getByText(/not available on this market/i)).toBeInTheDocument();
  });

  it("renders warnings from the pricing engine", () => {
    render(
      <NexusMessageRenderer
        message={customMessage("price_card", {
          productName: "X",
          effectivePrice: 600,
          currency: "SAR",
          warnings: ["Price book expires soon"],
        })}
        options={baseOptions}
      />,
    );
    expect(screen.getByText("Price book expires soon")).toBeInTheDocument();
  });

  it("shows no source badge when none was declared", () => {
    render(
      <NexusMessageRenderer
        message={customMessage("kpi_card", { metric: { key: "revenue", value: 1 } })}
        options={baseOptions}
      />,
    );
    expect(screen.queryByTestId("nexus-sources")).toBeNull();
  });
});

describe("renderer — course ambiguity is never resolved for the user", () => {
  const message = customMessage("course_selector", {
    question: "تقصد أنهي نسخة؟",
    candidates: [
      { productId: "p1", name: "PMP + Exam", deliveryMode: "ONLINE", externalCode: "109" },
      { productId: "p2", name: "PMP + Exam", deliveryMode: "RECORDED", externalCode: "108" },
    ],
  });

  it("renders every variant as a distinct choice", () => {
    render(<NexusMessageRenderer message={message} options={baseOptions} />);
    const options = screen.getAllByTestId("nexus-course-option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("ONLINE");
    expect(options[1]).toHaveTextContent("RECORDED");
  });

  it("pre-selects nothing", () => {
    render(<NexusMessageRenderer message={message} options={baseOptions} />);
    for (const option of screen.getAllByTestId("nexus-course-option")) {
      expect(option).not.toHaveAttribute("aria-pressed", "true");
      expect(option.className).not.toMatch(/\bselected\b/);
    }
  });

  it("sends the chosen variant with its code so the agent can resolve it", () => {
    const onSend = vi.fn();
    render(<NexusMessageRenderer message={message} options={{ ...baseOptions, onSend }} />);
    fireEvent.click(screen.getAllByTestId("nexus-course-option")[0]!);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]![0]).toContain("109");
    expect(onSend.mock.calls[0]![0]).toContain("ONLINE");
  });

  it("is disabled while the agent is busy", () => {
    const onSend = vi.fn();
    render(
      <NexusMessageRenderer
        message={message}
        options={{ ...baseOptions, onSend, disabled: true }}
      />,
    );
    fireEvent.click(screen.getAllByTestId("nexus-course-option")[0]!);
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("renderer — quick replies are buttons, not markdown", () => {
  it("renders a native choice block as buttons and sends the value", () => {
    const onSend = vi.fn();
    render(
      <NexusMessageRenderer
        message={nativeMessage({
          type: "choice",
          text: "Which period?",
          groupId: "g1",
          options: [
            { label: "This month", value: "this_month" },
            { label: "Last month", value: "last_month" },
          ],
        })}
        options={{ ...baseOptions, onSend }}
      />,
    );
    const replies = screen.getAllByTestId("nexus-quick-reply");
    expect(replies).toHaveLength(2);
    fireEvent.click(replies[1]!);
    /**
     * The label reaches the transcript; the value rides a stripped frame.
     *
     * This used to assert `onSend` was called with "last_month" — the value
     * verbatim. That is the behaviour that put a productId in a user's own
     * bubble in production, so the assertion moved with the contract. See
     * tests/component/nexus-selection.test.tsx for the full contract.
     */
    const sent = onSend.mock.calls[0]![0] as string;
    expect(stripContext(sent)).toBe("Last month");
    expect(selectionValueOf(sent)).toBe("last_month");
  });

  it("renders a typed quick_replies payload too", () => {
    render(
      <NexusMessageRenderer
        message={customMessage("quick_replies", {
          text: "Pick a market",
          options: [
            { label: "السعودية", value: "sa" },
            { label: "مصر", value: "eg" },
          ],
        })}
        options={baseOptions}
      />,
    );
    expect(screen.getAllByTestId("nexus-quick-reply")).toHaveLength(2);
  });
});

describe("renderer — decision card", () => {
  const full = {
    decision: "REDUCE",
    priority: "HIGH",
    summary: "Reduce exposure on this campaign.",
    why: ["INFERENCE: both signals degraded together"],
    evidence: ["campaign.cpl = 40 vs calibrated median 26.79"],
    confidence: "HIGH",
    confidenceLimitedBy: [],
    risk: ["Attribution gap between platform and CRM"],
    owner: "MEDIA_BUYER",
    reviewWindowDays: 7,
    nextKpi: "campaign.cpl",
    actionBand: { display: "$5.39 – $55.04", provenance: "585 days of ENGOSOFT history" },
    sources: ["insights_hub"],
  };

  it("renders the decision, owner, review window and next KPI", () => {
    render(
      <NexusMessageRenderer message={customMessage("decision_card", full)} options={baseOptions} />,
    );
    expect(screen.getByTestId("nexus-decision-badge")).toHaveTextContent("REDUCE");
    expect(screen.getByTestId("nexus-decision-confidence")).toHaveTextContent("HIGH");
    expect(screen.getByText("MEDIA_BUYER")).toBeInTheDocument();
    expect(screen.getByText("7 days")).toBeInTheDocument();
    expect(screen.getByText("campaign.cpl")).toBeInTheDocument();
  });

  it("shows a calibrated band together with its provenance", () => {
    render(
      <NexusMessageRenderer message={customMessage("decision_card", full)} options={baseOptions} />,
    );
    expect(screen.getByTestId("nexus-action-band")).toHaveTextContent("$5.39 – $55.04");
    expect(screen.getByText(/585 days of ENGOSOFT history/)).toBeInTheDocument();
  });

  it("shows NO magnitude when the agent supplied no band", () => {
    render(
      <NexusMessageRenderer
        message={customMessage("decision_card", { ...full, actionBand: null })}
        options={baseOptions}
      />,
    );
    expect(screen.queryByTestId("nexus-action-band")).toBeNull();
    // Nothing in the card invents a percentage.
    expect(screen.queryByText(/\d+\s*%/)).toBeNull();
  });

  it("surfaces missing evidence prominently", () => {
    render(
      <NexusMessageRenderer
        message={customMessage("decision_card", {
          decision: "INSUFFICIENT_EVIDENCE",
          summary: "Not enough evidence to decide.",
          missingEvidence: ["sales.followUpCoverage"],
        })}
        options={baseOptions}
      />,
    );
    expect(
      within(screen.getByTestId("nexus-missing-evidence")).getByText("sales.followUpCoverage"),
    ).toBeInTheDocument();
  });

  it("expands to show the reasoning chain", () => {
    render(
      <NexusMessageRenderer message={customMessage("decision_card", full)} options={baseOptions} />,
    );
    expect(screen.queryByTestId("nexus-decision-details")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    const details = screen.getByTestId("nexus-decision-details");
    expect(within(details).getByText(/both signals degraded/)).toBeInTheDocument();
    expect(within(details).getByText(/calibrated median/)).toBeInTheDocument();
  });

  it("asks the agent to send rather than dispatching anything itself", () => {
    const onSend = vi.fn();
    render(
      <NexusMessageRenderer
        message={customMessage("decision_card", full)}
        options={{ ...baseOptions, onSend }}
      />,
    );
    fireEvent.click(screen.getByTestId("nexus-decision-send"));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]![0]).toMatch(/send this recommendation/i);
  });
});

describe("renderer — alert, error and table", () => {
  it("renders each alert level", () => {
    for (const level of ["info", "warning", "critical"] as const) {
      const { unmount } = render(
        <NexusMessageRenderer
          message={customMessage("alert", { level, title: `A ${level}` })}
          options={baseOptions}
        />,
      );
      expect(screen.getByTestId("nexus-alert")).toHaveTextContent(`A ${level}`);
      unmount();
    }
  });

  it("renders an error with a working retry", () => {
    const onRetry = vi.fn();
    render(
      <NexusMessageRenderer
        message={customMessage("error", { title: "Connection lost", body: "Try again." })}
        options={{ ...baseOptions, onRetry }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost");
    fireEvent.click(screen.getByTestId("nexus-retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("formats table cells and flags truncation", () => {
    render(
      <NexusMessageRenderer
        message={customMessage("table", {
          columns: [
            { key: "course", label: "Course", unit: "text" },
            { key: "revenue", label: "Revenue", unit: "money", currency: "USD" },
          ],
          rows: [{ course: "PMP", revenue: 138187.35635592628 }],
          truncated: true,
        })}
        options={baseOptions}
      />,
    );
    expect(screen.getByText("$138,187.36")).toBeInTheDocument();
    expect(screen.getByText(/truncated/i)).toBeInTheDocument();
  });
});

describe("renderer — malformed payloads degrade safely", () => {
  it("falls back to text when a custom payload is unrecognised", () => {
    render(
      <NexusMessageRenderer
        message={customMessage("something_new", { text: "A future message type" })}
        options={baseOptions}
      />,
    );
    expect(screen.getByTestId("nexus-text")).toHaveTextContent("A future message type");
  });

  it("renders nothing rather than crashing on an unusable payload", () => {
    const { container } = render(
      <NexusMessageRenderer
        message={customMessage("kpi_card", { metric: null })}
        options={baseOptions}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("never throws on any malformed shape", () => {
    const shapes: unknown[] = [null, undefined, 5, "string", [], { type: "nope" }, { metric: {} }];
    for (const data of shapes) {
      for (const name of [
        "kpi_card",
        "price_card",
        "decision_card",
        "chart",
        "table",
        "course_selector",
      ]) {
        expect(() =>
          render(
            <NexusMessageRenderer message={customMessage(name, data)} options={baseOptions} />,
          ),
        ).not.toThrow();
        cleanup();
      }
    }
  });

  it("skips a block type it has no renderer for", () => {
    const { container } = render(
      <NexusMessageRenderer
        message={nativeMessage({ type: "location", latitude: 1, longitude: 2 })}
        options={baseOptions}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("renderer — Arabic", () => {
  it("renders Arabic source labels and decision copy", () => {
    render(
      <NexusMessageRenderer
        message={customMessage("decision_card", {
          decision: "HOLD",
          summary: "استنى — الأدلة مش كافية.",
          owner: "MANAGEMENT",
          reviewWindowDays: 14,
          sources: ["engosoft_knowledge"],
        })}
        options={{ ...baseOptions, lang: "ar" }}
      />,
    );
    expect(screen.getByText("استنى — الأدلة مش كافية.")).toBeInTheDocument();
    expect(screen.getByText("14 يوم")).toBeInTheDocument();
    expect(screen.getByText("معرفة ENGOSOFT")).toBeInTheDocument();
  });
});

describe("renderer — float noise never reaches the reader", () => {
  it("rounds a raw float the agent wrote into its own prose", () => {
    render(
      <NexusMessageRenderer
        message={nativeMessage({
          type: "text",
          text: "الإيرادات هذا الشهر حتى الآن هي **7009.358714766733**",
        })}
        options={baseOptions}
      />,
    );
    expect(screen.getByTestId("nexus-text")).toHaveTextContent("7,009.36");
    expect(screen.getByTestId("nexus-text").textContent).not.toContain("7009.358714766733");
  });

  it("leaves an authoritative price in prose untouched", () => {
    render(
      <NexusMessageRenderer
        message={nativeMessage({ type: "text", text: "السعر 600 ريال، كود 109" })}
        options={baseOptions}
      />,
    );
    expect(screen.getByTestId("nexus-text")).toHaveTextContent("600");
    expect(screen.getByTestId("nexus-text")).toHaveTextContent("109");
  });
});
