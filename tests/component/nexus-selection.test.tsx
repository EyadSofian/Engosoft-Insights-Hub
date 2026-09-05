// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuickReplies } from "@/components/engo-nexus/messages/QuickReplies";
import { CourseSelector } from "@/components/engo-nexus/messages/CourseSelector";
import {
  selectionMessage,
  selectionValueOf,
  stripContext,
} from "@/components/engo-nexus/lib/nexus-context";

/**
 * The selection contract: readable transcript, exact internal identity.
 *
 * Production put "8b2a6699-8558-43b9-b846-72d68db6f162" in a user's own bubble
 * after they tapped a product name. Every assertion here exists because of that
 * screenshot.
 */

afterEach(cleanup);

const UUID = "8b2a6699-8558-43b9-b846-72d68db6f162";
const LABEL = "PMP + CAPM Recorded + Exam — ONLINE";
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("a native choice never puts an id in the transcript", () => {
  it("sends the label the user read, not the productId behind it", () => {
    const onSelect = vi.fn();
    render(
      <QuickReplies
        label="اختار نسخة PMP"
        options={[{ label: LABEL, value: UUID }]}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: LABEL }));

    const sent = onSelect.mock.calls[0]![0] as string;
    // What the reader sees.
    expect(stripContext(sent)).toBe(LABEL);
    expect(UUID_RE.test(stripContext(sent))).toBe(false);
    // What the agent gets.
    expect(selectionValueOf(sent)).toBe(UUID);
  });

  it("keeps a plain quick reply plain", () => {
    const onSelect = vi.fn();
    render(<QuickReplies options={[{ label: "أيوه", value: "أيوه" }]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "أيوه" }));
    // No frame where there is no separate identity to carry.
    expect(onSelect.mock.calls[0]![0]).toBe("أيوه");
  });

  it("shows the label on the button, never the value", () => {
    render(<QuickReplies options={[{ label: LABEL, value: UUID }]} onSelect={vi.fn()} />);
    expect(screen.getByTestId("nexus-quick-reply").textContent).toBe(LABEL);
    expect(document.body.textContent).not.toMatch(UUID_RE);
  });
});

describe("the course selector uses the same contract", () => {
  const message = {
    type: "course_selector" as const,
    question: "تقصد أنهي نسخة؟",
    candidates: [
      {
        productId: UUID,
        name: "PMP + Exam",
        externalCode: "109",
        deliveryMode: "ONLINE",
        productType: null,
      },
    ],
  };

  it("shows a human-readable reply and carries the exact productId", () => {
    const onSelect = vi.fn();
    render(<CourseSelector message={message} lang="ar" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("nexus-course-option"));

    const sent = onSelect.mock.calls[0]![0] as string;
    const visible = stripContext(sent);
    expect(visible).toContain("PMP + Exam");
    expect(visible).toContain("109");
    expect(UUID_RE.test(visible)).toBe(false);
    expect(selectionValueOf(sent)).toBe(UUID);
  });

  it("is not a second, divergent selection system", () => {
    // Both surfaces produce a frame the same parser reads.
    const fromQuickReply = selectionMessage({
      displayLabel: LABEL,
      internalValue: UUID,
    });
    expect(selectionValueOf(fromQuickReply)).toBe(UUID);
    expect(stripContext(fromQuickReply)).toBe(LABEL);
  });
});

describe("the frame is stripped wherever a bubble is rendered", () => {
  it("strips a selection frame", () => {
    expect(stripContext(`[selection: id=${UUID}]\n${LABEL}`)).toBe(LABEL);
  });

  it("still strips a dashboard context frame", () => {
    expect(stripContext("[dashboard context: page=courses]\nحلل PMP")).toBe("حلل PMP");
  });

  it("leaves ordinary text alone", () => {
    expect(stripContext("سعر PMP كام؟")).toBe("سعر PMP كام؟");
  });
});
