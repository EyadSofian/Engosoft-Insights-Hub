// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BlockMessage } from "@botpress/webchat";

/**
 * The Botpress SDK, replaced by a controllable double.
 *
 * The panel's contract with the SDK is small and well-defined —
 * `useActiveConversation` for messages and sending, `useConversations` for
 * starting a new one, `useUser` for deciding which side a bubble sits on. Faking
 * exactly that surface tests the panel's own behaviour (context injection,
 * bubble sidedness, error recovery, busy states) without a network, which is
 * what makes these tests deterministic and free to run.
 */
const state = {
  messages: [] as BlockMessage[],
  status: "connected" as "connecting" | "connected" | "error" | "disconnected",
  isTyping: false,
  isAwaitingResponse: false,
  error: undefined as { message: string } | undefined,
  sendMessage: vi.fn(async () => {}),
  saveMessageFeedback: vi.fn(async () => {}),
  openConversation: vi.fn(),
  userId: "user-1" as string | undefined,
};

vi.mock("@botpress/webchat", () => ({
  useActiveConversation: () => ({
    conversationId: "conv-1",
    messages: state.messages,
    participants: [],
    sendMessage: state.sendMessage,
    saveMessageFeedback: state.saveMessageFeedback,
    sendEvent: vi.fn(),
    uploadFile: vi.fn(),
    status: state.status,
    on: vi.fn(),
    error: state.error,
    isTyping: state.isTyping,
    isAwaitingResponse: state.isAwaitingResponse,
    upsertMessageStream: vi.fn(),
    completeMessageStream: vi.fn(),
    abortMessageStream: vi.fn(),
  }),
  useConversations: () => ({
    openConversation: state.openConversation,
    listConversations: vi.fn(),
  }),
  useUser: () => ({
    userCredentials: state.userId ? { userId: state.userId, userToken: "t" } : undefined,
  }),
  WebchatProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ lang: "ar", t: (k: string) => k, dir: "rtl" }) }));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => ({ pathname: "/campaigns" }) }));
vi.mock("@/lib/filter-store", () => ({
  useFilters: () => ({ campaign: "PMP-SA", from: "2026-08-01", to: "2026-08-31" }),
}));

const { NexusPanel } = await import("@/components/engo-nexus/NexusPanel");
const { nexusStore } = await import("@/components/engo-nexus/state/nexus-store");

function botText(id: string, text: string): BlockMessage {
  return {
    id,
    timestamp: new Date(),
    authorId: "bot",
    block: { type: "text", text },
  } as BlockMessage;
}
function userText(id: string, text: string): BlockMessage {
  return {
    id,
    timestamp: new Date(),
    authorId: "user-1",
    block: { type: "text", text },
  } as BlockMessage;
}

beforeEach(() => {
  window.localStorage.clear();
  nexusStore.reset();
  state.messages = [];
  state.status = "connected";
  state.isTyping = false;
  state.isAwaitingResponse = false;
  state.error = undefined;
  state.userId = "user-1";
  state.sendMessage.mockClear();
  state.saveMessageFeedback.mockClear();
  state.openConversation.mockClear();
  // jsdom has no layout engine, so scrollTo must be stubbed for the
  // scroll-to-latest effect to run.
  Element.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

describe("panel — visibility", () => {
  it("renders nothing while closed", () => {
    const { container } = render(<NexusPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders exactly one panel when open", () => {
    nexusStore.open();
    render(<NexusPanel />);
    expect(screen.getAllByTestId("nexus-panel")).toHaveLength(1);
  });

  it("is a labelled modal dialog and follows the app's direction", () => {
    nexusStore.open();
    render(<NexusPanel />);
    const panel = screen.getByTestId("nexus-panel");
    expect(panel).toHaveAttribute("role", "dialog");
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(panel).toHaveAttribute("aria-label", "ENGO Nexus");
    expect(panel).toHaveAttribute("dir", "rtl");
  });
});

describe("panel — welcome and messages", () => {
  it("shows the welcome state when the conversation is empty", () => {
    nexusStore.open();
    render(<NexusPanel />);
    expect(screen.getByTestId("nexus-welcome")).toBeInTheDocument();
  });

  it("hides the welcome once there are messages", () => {
    nexusStore.open();
    state.messages = [botText("m1", "Hello")];
    render(<NexusPanel />);
    expect(screen.queryByTestId("nexus-welcome")).toBeNull();
    expect(screen.getByTestId("nexus-message-bot")).toHaveTextContent("Hello");
  });

  it("puts the user's own message on the user side, by author id", () => {
    nexusStore.open();
    state.messages = [userText("m1", "hi"), botText("m2", "hello")];
    render(<NexusPanel />);
    expect(screen.getByTestId("nexus-message-user")).toHaveTextContent("hi");
    expect(screen.getByTestId("nexus-message-bot")).toHaveTextContent("hello");
  });

  it("treats a message as the assistant's while credentials are still loading", () => {
    nexusStore.open();
    state.userId = undefined;
    state.messages = [userText("m1", "hi")];
    render(<NexusPanel />);
    expect(screen.queryByTestId("nexus-message-user")).toBeNull();
    expect(screen.getByTestId("nexus-message-bot")).toBeInTheDocument();
  });
});

describe("panel — dashboard context travels with every message", () => {
  it("prepends the page, entity and period", async () => {
    nexusStore.open();
    render(<NexusPanel />);
    fireEvent.change(screen.getByTestId("nexus-input"), { target: { value: "حلل الصفحة دي" } });
    fireEvent.click(screen.getByTestId("nexus-send"));

    await waitFor(() => expect(state.sendMessage).toHaveBeenCalled());
    const sent = state.sendMessage.mock.calls[0]![0] as { type: string; text: string };
    expect(sent.type).toBe("text");
    expect(sent.text).toContain("[dashboard context:");
    expect(sent.text).toContain("page=campaigns");
    expect(sent.text).toContain('campaign="PMP-SA"');
    expect(sent.text).toContain("period=2026-08-01..2026-08-31");
    expect(sent.text).toContain("حلل الصفحة دي");
  });

  it("shows the user only their own words, not the context frame", () => {
    nexusStore.open();
    state.messages = [userText("m1", "[dashboard context: page=campaigns]\nحلل الصفحة دي")];
    render(<NexusPanel />);
    const bubble = screen.getByTestId("nexus-message-user");
    expect(bubble).toHaveTextContent("حلل الصفحة دي");
    expect(bubble.textContent).not.toContain("dashboard context");
  });

  it("sends a pending prompt once the socket is up, and only once", async () => {
    nexusStore.open("كام الإيرادات الشهر ده؟");
    render(<NexusPanel />);
    await waitFor(() => expect(state.sendMessage).toHaveBeenCalledTimes(1));
    expect((state.sendMessage.mock.calls[0]![0] as { text: string }).text).toContain(
      "كام الإيرادات الشهر ده؟",
    );
  });

  it("holds a pending prompt while disconnected rather than dropping it", () => {
    state.status = "connecting";
    nexusStore.open("كام الإيرادات؟");
    render(<NexusPanel />);
    expect(state.sendMessage).not.toHaveBeenCalled();
    expect(nexusStore.get().pendingPrompt).toBe("كام الإيرادات؟");
  });

  it("never sends while disconnected", () => {
    state.status = "disconnected";
    nexusStore.open();
    render(<NexusPanel />);
    expect(screen.getByTestId("nexus-input")).toBeDisabled();
  });
});

describe("panel — busy and progress", () => {
  it("shows a real progress state while awaiting a reply", () => {
    nexusStore.open();
    state.isAwaitingResponse = true;
    render(<NexusPanel />);
    const progress = screen.getByTestId("nexus-progress");
    expect(progress).toHaveAttribute("role", "status");
    expect(progress).toHaveTextContent("جاري قراءة البيانات الحية…");
    expect(screen.getByTestId("nexus-status")).toHaveTextContent("جاري التحليل…");
  });

  it("offers Stop instead of Send while generating", () => {
    nexusStore.open();
    state.isTyping = true;
    render(<NexusPanel />);
    expect(screen.queryByTestId("nexus-send")).toBeNull();
    expect(screen.getByTestId("nexus-stop")).toBeInTheDocument();
  });

  it("Stop clears the wait locally and says so, without claiming to cancel the agent", () => {
    nexusStore.open();
    state.isAwaitingResponse = true;
    render(<NexusPanel />);
    expect(screen.getByTestId("nexus-progress")).toBeInTheDocument();

    const stop = screen.getByTestId("nexus-stop");
    // The control never overclaims: it stops waiting, it does not cancel.
    expect(stop.getAttribute("title")).toMatch(/may still arrive|ممكن يوصل/);
    fireEvent.click(stop);

    expect(screen.queryByTestId("nexus-progress")).toBeNull();
    expect(screen.getByTestId("nexus-send")).toBeInTheDocument();
    expect(screen.getByTestId("nexus-input")).toBeEnabled();
  });

  it("resumes normal progress on the next turn after a Stop", () => {
    nexusStore.open();
    state.isAwaitingResponse = true;
    const { rerender } = render(<NexusPanel />);
    fireEvent.click(screen.getByTestId("nexus-stop"));
    expect(screen.queryByTestId("nexus-progress")).toBeNull();

    // The answer lands; the suppressed wait is released.
    state.messages = [botText("m1", "late answer")];
    rerender(<NexusPanel />);
    expect(screen.getByTestId("nexus-message-bot")).toHaveTextContent("late answer");
    expect(screen.getByTestId("nexus-progress")).toBeInTheDocument();
  });

  it("reports the connection state in the header", () => {
    nexusStore.open();
    state.status = "connecting";
    const { rerender } = render(<NexusPanel />);
    expect(screen.getByTestId("nexus-status")).toHaveTextContent("جاري الاتصال…");
    state.status = "connected";
    rerender(<NexusPanel />);
    expect(screen.getByTestId("nexus-status")).toHaveTextContent("متصل");
  });
});

describe("panel — failure and recovery", () => {
  it("surfaces a transport error with a retry that reopens the conversation", () => {
    nexusStore.open();
    state.error = { message: "SSE disconnected" };
    render(<NexusPanel />);
    expect(screen.getByTestId("nexus-error")).toHaveTextContent("SSE disconnected");
    fireEvent.click(screen.getByTestId("nexus-retry"));
    expect(state.openConversation).toHaveBeenCalledWith("conv-1");
  });

  it("surfaces a send failure instead of silently losing the message", async () => {
    nexusStore.open();
    state.sendMessage.mockRejectedValueOnce(new Error("network down"));
    render(<NexusPanel />);
    fireEvent.change(screen.getByTestId("nexus-input"), { target: { value: "test" } });
    fireEvent.click(screen.getByTestId("nexus-send"));
    await waitFor(() =>
      expect(screen.getByTestId("nexus-error")).toHaveTextContent("network down"),
    );
  });
});

describe("panel — conversation controls", () => {
  it("starts a new conversation", () => {
    nexusStore.open();
    state.messages = [botText("m1", "old")];
    render(<NexusPanel />);
    fireEvent.click(screen.getByTestId("nexus-new-conversation"));
    expect(state.openConversation).toHaveBeenCalledWith(undefined);
  });

  it("closes on the close button and on Escape", () => {
    nexusStore.open();
    const { rerender } = render(<NexusPanel />);
    fireEvent.click(screen.getByTestId("nexus-close"));
    expect(nexusStore.get().open).toBe(false);

    nexusStore.open();
    rerender(<NexusPanel />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(nexusStore.get().open).toBe(false);
  });

  it("expands and collapses the desktop panel", () => {
    nexusStore.open();
    const { rerender } = render(<NexusPanel />);
    fireEvent.click(screen.getByTestId("nexus-expand"));
    expect(nexusStore.get().expanded).toBe(true);
    rerender(<NexusPanel />);
    expect(screen.getByTestId("nexus-panel").querySelector("section")!.className).toContain(
      "46rem",
    );
  });

  it("uses a desktop side panel and a full-screen mobile sheet", () => {
    nexusStore.open();
    render(<NexusPanel />);
    const section = screen.getByTestId("nexus-panel").querySelector("section")!;
    // Full width and height by default (mobile), a fixed side panel from `sm`.
    expect(section.className).toContain("w-full");
    expect(section.className).toContain("h-dvh");
    expect(section.className).toContain("sm:w-[30rem]");
  });
});

describe("panel — feedback", () => {
  it("records a vote against the message", async () => {
    nexusStore.open();
    state.messages = [botText("m1", "answer")];
    render(<NexusPanel />);
    fireEvent.click(screen.getByRole("button", { name: "إجابة مفيدة" }));
    await waitFor(() =>
      expect(state.saveMessageFeedback).toHaveBeenCalledWith("m1", { value: "positive" }),
    );
  });

  it("survives a feedback endpoint failure without breaking the chat", async () => {
    nexusStore.open();
    state.messages = [botText("m1", "answer")];
    state.saveMessageFeedback.mockRejectedValueOnce(new Error("no endpoint"));
    render(<NexusPanel />);
    fireEvent.click(screen.getByRole("button", { name: "إجابة غير مفيدة" }));
    await waitFor(() => expect(state.saveMessageFeedback).toHaveBeenCalled());
    expect(screen.getByTestId("nexus-messages")).toBeInTheDocument();
  });
});
