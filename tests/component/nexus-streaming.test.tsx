// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { BlockMessage } from "@botpress/webchat";

/**
 * Streaming behaviour.
 *
 * WHAT THE SDK DOES: `@botpress/webchat@5.5.1` receives `message_stream_delta`
 * signals and folds them into the existing entry in `messages` via its internal
 * `upsertMessageStream`. A consumer never sees a delta — it sees the same
 * message id whose text has grown, plus a `status` of `processing` until
 * `message_stream_complete` arrives.
 *
 * WHAT THIS SUITE PROVES: given that behaviour, this panel renders ONE bubble
 * that grows, not one bubble per chunk. That is the property that would break
 * if someone keyed the list by index, appended on update, or memoised the
 * rendered text — so it is worth a test even though the folding itself is the
 * SDK's job.
 *
 * WHAT IT DOES NOT PROVE: that the deployed ENGO Nexus agent emits stream
 * deltas at all. That is a bot-side capability and is verified separately
 * against production; see the report.
 */
const state = {
  messages: [] as BlockMessage[],
  isAwaitingResponse: false,
  isTyping: false,
};

vi.mock("@botpress/webchat", () => ({
  useActiveConversation: () => ({
    conversationId: "conv-1",
    messages: state.messages,
    participants: [],
    sendMessage: vi.fn(async () => {}),
    saveMessageFeedback: vi.fn(async () => {}),
    sendEvent: vi.fn(),
    uploadFile: vi.fn(),
    status: "connected",
    on: vi.fn(),
    error: undefined,
    isTyping: state.isTyping,
    isAwaitingResponse: state.isAwaitingResponse,
    upsertMessageStream: vi.fn(),
    completeMessageStream: vi.fn(),
    abortMessageStream: vi.fn(),
  }),
  useConversations: () => ({ openConversation: vi.fn(), listConversations: vi.fn() }),
  useUser: () => ({ userCredentials: { userId: "user-1", userToken: "t" } }),
  WebchatProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ lang: "en", t: (k: string) => k, dir: "ltr" }) }));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => ({ pathname: "/" }) }));
vi.mock("@/lib/filter-store", () => ({ useFilters: () => ({}) }));

const { NexusPanel } = await import("@/components/engo-nexus/NexusPanel");
const { nexusStore } = await import("@/components/engo-nexus/state/nexus-store");

/** One assistant message as the SDK exposes it mid-stream. */
function streaming(id: string, text: string, done = false): BlockMessage {
  return {
    id,
    timestamp: new Date(),
    authorId: "bot",
    status: done ? "processed" : "processing",
    block: { type: "text", text },
  } as BlockMessage;
}

beforeEach(() => {
  window.localStorage.clear();
  nexusStore.reset();
  nexusStore.open();
  state.messages = [];
  state.isAwaitingResponse = false;
  state.isTyping = false;
  Element.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

describe("streaming — one bubble that grows", () => {
  it("never creates a second bubble as the text grows", () => {
    state.messages = [streaming("m1", "الإيرادات")];
    const { rerender } = render(<NexusPanel />);
    expect(screen.getAllByTestId("nexus-message-bot")).toHaveLength(1);

    state.messages = [streaming("m1", "الإيرادات المحصّلة الشهر ده")];
    rerender(<NexusPanel />);
    expect(screen.getAllByTestId("nexus-message-bot")).toHaveLength(1);

    state.messages = [streaming("m1", "الإيرادات المحصّلة الشهر ده 7,009$", true)];
    rerender(<NexusPanel />);
    const bubbles = screen.getAllByTestId("nexus-message-bot");
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]).toHaveTextContent("7,009$");
  });

  it("marks an in-flight message as streaming and clears it on completion", () => {
    state.messages = [streaming("m1", "partial")];
    const { container, rerender } = render(<NexusPanel />);
    // The caret is the visible streaming affordance.
    expect(container.querySelector(".animate-pulse")).not.toBeNull();

    state.messages = [streaming("m1", "partial and complete", true)];
    rerender(<NexusPanel />);
    expect(
      screen.getByTestId("nexus-message-bot").querySelector("[aria-hidden].animate-pulse"),
    ).toBeNull();
  });

  it("keeps distinct messages distinct", () => {
    state.messages = [streaming("m1", "first", true), streaming("m2", "second", true)];
    render(<NexusPanel />);
    expect(screen.getAllByTestId("nexus-message-bot")).toHaveLength(2);
  });

  it("shows progress before the first chunk, and stops once text arrives", () => {
    state.isAwaitingResponse = true;
    const { rerender } = render(<NexusPanel />);
    expect(screen.getByTestId("nexus-progress")).toBeInTheDocument();

    state.isAwaitingResponse = false;
    state.messages = [streaming("m1", "the answer", true)];
    rerender(<NexusPanel />);
    expect(screen.queryByTestId("nexus-progress")).toBeNull();
  });
});
