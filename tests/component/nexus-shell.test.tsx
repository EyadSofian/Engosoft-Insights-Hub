// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NexusLauncher } from "@/components/engo-nexus/NexusLauncher";
import { NexusProactivePopup } from "@/components/engo-nexus/NexusProactivePopup";
import { NexusComposer } from "@/components/engo-nexus/NexusComposer";
import { NexusWelcome } from "@/components/engo-nexus/NexusWelcome";
import { NexusHeader } from "@/components/engo-nexus/NexusHeader";
import {
  canShowProactive,
  clearProactiveMemory,
  nexusStore,
} from "@/components/engo-nexus/state/nexus-store";
import { PROACTIVE_DELAY_MS } from "@/components/engo-nexus/lib/nexus-config";

// The dashboard's providers, stubbed to the two values these components read.
// Stubbing rather than wrapping keeps each test about the component under test.
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ lang: "en", t: (k: string) => k, dir: "ltr" }) }));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => ({ pathname: "/campaigns" }) }));

beforeEach(() => {
  window.localStorage.clear();
  nexusStore.reset();
  clearProactiveMemory();
});
afterEach(cleanup);

describe("launcher", () => {
  it("renders the official mascot, not a generic icon", () => {
    render(<NexusLauncher />);
    const launcher = screen.getByTestId("nexus-launcher");
    const image = launcher.querySelector("img");
    expect(image).not.toBeNull();
    expect(image!.getAttribute("src")).toContain("/engo-nexus/mascot-avatar");
    // No Lucide fallback glyph stands in for the character.
    expect(launcher.querySelector("svg")).toBeNull();
  });

  it("carries an accessible label and opens the panel", () => {
    render(<NexusLauncher />);
    const launcher = screen.getByRole("button", { name: /open engo nexus/i });
    expect(nexusStore.get().open).toBe(false);
    fireEvent.click(launcher);
    expect(nexusStore.get().open).toBe(true);
  });

  it("is keyboard-activatable as a real button", () => {
    render(<NexusLauncher />);
    const launcher = screen.getByTestId("nexus-launcher");
    expect(launcher.tagName).toBe("BUTTON");
    expect(launcher).toHaveAttribute("type", "button");
    launcher.focus();
    expect(document.activeElement).toBe(launcher);
  });

  it("opts out of its float animation under reduced motion", () => {
    render(<NexusLauncher />);
    const launcher = screen.getByTestId("nexus-launcher");
    expect(launcher.className).toContain("nexus-float");
    expect(launcher.className).toContain("motion-reduce:animate-none");
  });

  it("shows an online indicator", () => {
    render(<NexusLauncher />);
    expect(screen.getByTestId("nexus-launcher").querySelector(".bg-emerald-500")).not.toBeNull();
  });

  it("hides while the panel or a modal is open, so there is only ever one entry point", () => {
    const { container } = render(<NexusLauncher hidden />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("proactive popup", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not appear immediately", () => {
    render(<NexusProactivePopup />);
    expect(screen.queryByTestId("nexus-proactive")).toBeNull();
  });

  it("appears after the idle delay", () => {
    render(<NexusProactivePopup />);
    act(() => void vi.advanceTimersByTime(PROACTIVE_DELAY_MS + 10));
    expect(screen.getByTestId("nexus-proactive")).toBeInTheDocument();
  });

  it("offers actions for the page the user is on", () => {
    render(<NexusProactivePopup />);
    act(() => void vi.advanceTimersByTime(PROACTIVE_DELAY_MS + 10));
    const actions = screen.getAllByTestId("nexus-proactive-action");
    expect(actions.map((a) => a.textContent)).toEqual([
      "Analyse campaigns",
      "Best ROAS",
      "Where is the problem?",
    ]);
  });

  it("dismisses, and remembers the dismissal across mounts", () => {
    render(<NexusProactivePopup />);
    act(() => void vi.advanceTimersByTime(PROACTIVE_DELAY_MS + 10));
    fireEvent.click(screen.getByTestId("nexus-proactive-dismiss"));
    expect(screen.queryByTestId("nexus-proactive")).toBeNull();
    expect(canShowProactive()).toBe(false);

    cleanup();
    render(<NexusProactivePopup />);
    act(() => void vi.advanceTimersByTime(PROACTIVE_DELAY_MS * 4));
    expect(screen.queryByTestId("nexus-proactive")).toBeNull();
  });

  it("opens the panel with the chosen prompt, and never sends it twice", () => {
    render(<NexusProactivePopup />);
    act(() => void vi.advanceTimersByTime(PROACTIVE_DELAY_MS + 10));
    fireEvent.click(screen.getAllByTestId("nexus-proactive-action")[0]!);
    expect(nexusStore.get().open).toBe(true);
    expect(nexusStore.consumePendingPrompt()).toContain("Analyse campaign performance");
    expect(nexusStore.consumePendingPrompt()).toBeNull();
    // Opening the panel also stops the popup returning later.
    expect(canShowProactive()).toBe(false);
  });

  it("stays hidden while the panel is open", () => {
    render(<NexusProactivePopup suppressed />);
    act(() => void vi.advanceTimersByTime(PROACTIVE_DELAY_MS * 4));
    expect(screen.queryByTestId("nexus-proactive")).toBeNull();
  });
});

describe("composer", () => {
  const props = { lang: "en" as const, placeholder: "Ask…", onSend: vi.fn() };

  it("disables send while empty and enables it once typed", () => {
    render(<NexusComposer {...props} />);
    expect(screen.getByTestId("nexus-send")).toBeDisabled();
    fireEvent.change(screen.getByTestId("nexus-input"), { target: { value: "hello" } });
    expect(screen.getByTestId("nexus-send")).toBeEnabled();
  });

  it("sends on Enter and clears the field", () => {
    const onSend = vi.fn();
    render(<NexusComposer {...props} onSend={onSend} />);
    const input = screen.getByTestId("nexus-input");
    fireEvent.change(input, { target: { value: "كام الإيرادات الشهر ده؟" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("كام الإيرادات الشهر ده؟");
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  it("inserts a newline on Shift+Enter instead of sending", () => {
    const onSend = vi.fn();
    render(<NexusComposer {...props} onSend={onSend} />);
    const input = screen.getByTestId("nexus-input");
    fireEvent.change(input, { target: { value: "line one" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send whitespace", () => {
    const onSend = vi.fn();
    render(<NexusComposer {...props} onSend={onSend} />);
    fireEvent.change(screen.getByTestId("nexus-input"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("nexus-send"));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("offers Stop instead of Send while a reply is generating", () => {
    const onStop = vi.fn();
    render(<NexusComposer {...props} busy onStop={onStop} />);
    expect(screen.queryByTestId("nexus-send")).toBeNull();
    fireEvent.click(screen.getByTestId("nexus-stop"));
    expect(onStop).toHaveBeenCalled();
  });

  it("blocks input entirely while disconnected", () => {
    const onSend = vi.fn();
    render(<NexusComposer {...props} onSend={onSend} disabled />);
    const input = screen.getByTestId("nexus-input");
    expect(input).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows the attachment control only when a handler is supplied", () => {
    const { rerender } = render(<NexusComposer {...props} />);
    expect(screen.queryByTestId("nexus-attach")).toBeNull();
    rerender(<NexusComposer {...props} onAttach={vi.fn()} />);
    expect(screen.getByTestId("nexus-attach")).toBeInTheDocument();
  });
});

describe("welcome state", () => {
  it("shows the mascot and page-aware suggestions", () => {
    const onPick = vi.fn();
    render(<NexusWelcome lang="en" pageType="sales" onPick={onPick} />);
    expect(screen.getByTestId("nexus-welcome").querySelector("img")!.getAttribute("src")).toContain(
      "/engo-nexus/mascot.png",
    );
    const actions = screen.getAllByTestId("nexus-welcome-action");
    expect(actions.map((a) => a.textContent)).toContain("Team performance");
    // Always-available actions are appended, never duplicated.
    expect(actions.map((a) => a.textContent)).toContain("Top 3 decisions");
    fireEvent.click(actions[0]!);
    expect(onPick).toHaveBeenCalled();
  });

  it("renders Arabic copy in Arabic", () => {
    render(<NexusWelcome lang="ar" pageType="overview" onPick={vi.fn()} />);
    expect(screen.getByText(/أنا ENGO Nexus/)).toBeInTheDocument();
  });
});

describe("header", () => {
  const base = {
    lang: "en" as const,
    expanded: false,
    onNewConversation: vi.fn(),
    onToggleExpand: vi.fn(),
    onClose: vi.fn(),
  };

  it("reports each connection state in plain language, never a model name", () => {
    const cases = [
      ["connecting", "Connecting…"],
      ["connected", "Online"],
      ["working", "Analysing…"],
      ["error", "Connection lost"],
      ["disconnected", "Offline"],
    ] as const;
    for (const [status, label] of cases) {
      const { unmount } = render(<NexusHeader {...base} status={status} />);
      expect(screen.getByTestId("nexus-status")).toHaveTextContent(label);
      expect(screen.getByTestId("nexus-status").textContent).not.toMatch(/sonnet|gpt|claude|opus/i);
      unmount();
    }
  });

  it("exposes new conversation, expand and close", () => {
    const onNewConversation = vi.fn();
    const onClose = vi.fn();
    const onToggleExpand = vi.fn();
    render(
      <NexusHeader
        {...base}
        status="connected"
        onNewConversation={onNewConversation}
        onClose={onClose}
        onToggleExpand={onToggleExpand}
      />,
    );
    fireEvent.click(screen.getByTestId("nexus-new-conversation"));
    fireEvent.click(screen.getByTestId("nexus-expand"));
    fireEvent.click(screen.getByTestId("nexus-close"));
    expect(onNewConversation).toHaveBeenCalled();
    expect(onToggleExpand).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the mascot as the header avatar", () => {
    render(<NexusHeader {...base} status="connected" />);
    expect(screen.getByText("ENGO Nexus").closest("header")!.querySelector("img")!.src).toContain(
      "mascot-avatar",
    );
  });
});
