// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NexusVoiceInput } from "@/components/engo-nexus/voice/NexusVoiceInput";
import { getSpeechRecognition, speechLocale } from "@/components/engo-nexus/lib/nexus-speech";

/**
 * A stand-in for the browser's SpeechRecognition. It records whether `start()`
 * was ever called, which is how the "no permission prompt before a gesture"
 * guarantee is actually verified: browsers prompt on `start()`, so a test that
 * asserts `start` was not called is asserting no prompt appeared.
 */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  static startCalls = 0;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  started = false;

  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    FakeRecognition.startCalls += 1;
    this.started = true;
    this.onstart?.();
  }
  stop() {
    this.started = false;
    this.onend?.();
  }
  abort() {
    this.started = false;
  }
}

function installSpeech() {
  (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
}
function removeSpeech() {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
}

beforeEach(() => {
  FakeRecognition.instances = [];
  FakeRecognition.startCalls = 0;
  installSpeech();
});
afterEach(() => {
  cleanup();
  removeSpeech();
});

describe("voice — capability detection", () => {
  it("finds the standard and the webkit-prefixed constructor", () => {
    expect(getSpeechRecognition()).toBe(FakeRecognition);
    removeSpeech();
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    expect(getSpeechRecognition()).toBe(FakeRecognition);
  });

  it("returns null when the browser has no speech engine", () => {
    removeSpeech();
    expect(getSpeechRecognition()).toBeNull();
  });

  it("renders nothing at all when unsupported, rather than a dead button", () => {
    removeSpeech();
    const { container } = render(<NexusVoiceInput lang="en" onTranscript={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("maps each language to a BCP-47 tag", () => {
    expect(speechLocale("ar")).toBe("ar-EG");
    expect(speechLocale("en")).toBe("en-US");
  });
});

describe("voice — permission is never requested before a gesture", () => {
  it("does not construct or start recognition on render", () => {
    render(<NexusVoiceInput lang="en" onTranscript={vi.fn()} />);
    expect(FakeRecognition.instances).toHaveLength(0);
    expect(FakeRecognition.startCalls).toBe(0);
  });

  it("starts only after the user clicks", () => {
    render(<NexusVoiceInput lang="en" onTranscript={vi.fn()} />);
    fireEvent.click(screen.getByTestId("nexus-voice"));
    expect(FakeRecognition.startCalls).toBe(1);
  });
});

describe("voice — the five states", () => {
  it("moves idle → listening → idle", () => {
    render(<NexusVoiceInput lang="en" onTranscript={vi.fn()} />);
    const button = screen.getByTestId("nexus-voice");
    expect(button).toHaveAttribute("data-state", "idle");
    fireEvent.click(button);
    expect(button).toHaveAttribute("data-state", "listening");
    fireEvent.click(button);
    expect(button).toHaveAttribute("data-state", "idle");
  });

  it("reaches processing on a final transcript", () => {
    const onTranscript = vi.fn();
    render(<NexusVoiceInput lang="ar" onTranscript={onTranscript} />);
    fireEvent.click(screen.getByTestId("nexus-voice"));
    const recognition = FakeRecognition.instances[0]!;
    expect(recognition.lang).toBe("ar-EG");

    act(() => {
      recognition.onresult?.({
        results: [Object.assign([{ transcript: "كام الإيرادات" }], { isFinal: false })],
      });
    });
    expect(onTranscript).toHaveBeenLastCalledWith("كام الإيرادات", false);
    expect(screen.getByTestId("nexus-voice")).toHaveAttribute("data-state", "listening");

    act(() => {
      recognition.onresult?.({
        results: [Object.assign([{ transcript: "كام الإيرادات الشهر ده؟" }], { isFinal: true })],
      });
    });
    expect(onTranscript).toHaveBeenLastCalledWith("كام الإيرادات الشهر ده؟", true);
    expect(screen.getByTestId("nexus-voice")).toHaveAttribute("data-state", "processing");
  });

  it("reports a denied permission as an error and stops", () => {
    render(<NexusVoiceInput lang="en" onTranscript={vi.fn()} />);
    fireEvent.click(screen.getByTestId("nexus-voice"));
    const recognition = FakeRecognition.instances[0]!;
    act(() => {
      recognition.onerror?.({ error: "not-allowed" });
      recognition.onend?.();
    });
    const button = screen.getByTestId("nexus-voice");
    expect(button).toHaveAttribute("data-state", "error");
    expect(button.getAttribute("aria-label")).toMatch(/unavailable/i);
    // It does not silently retry, which is what turns a prompt into a nag.
    expect(FakeRecognition.startCalls).toBe(1);
  });

  it("treats silence and an abort as ordinary, not as failures", () => {
    render(<NexusVoiceInput lang="en" onTranscript={vi.fn()} />);
    for (const error of ["no-speech", "aborted"]) {
      fireEvent.click(screen.getByTestId("nexus-voice"));
      act(() => {
        FakeRecognition.instances.at(-1)!.onerror?.({ error });
      });
      expect(screen.getByTestId("nexus-voice")).toHaveAttribute("data-state", "idle");
    }
  });

  it("reports a start failure rather than appearing to listen", () => {
    class Failing extends FakeRecognition {
      start() {
        throw new Error("nope");
      }
    }
    (window as unknown as Record<string, unknown>).SpeechRecognition = Failing;
    render(<NexusVoiceInput lang="en" onTranscript={vi.fn()} />);
    fireEvent.click(screen.getByTestId("nexus-voice"));
    expect(screen.getByTestId("nexus-voice")).toHaveAttribute("data-state", "error");
  });

  it("reports state changes to its parent", () => {
    const onStateChange = vi.fn();
    render(<NexusVoiceInput lang="en" onTranscript={vi.fn()} onStateChange={onStateChange} />);
    fireEvent.click(screen.getByTestId("nexus-voice"));
    expect(onStateChange).toHaveBeenCalledWith("requesting");
    expect(onStateChange).toHaveBeenCalledWith("listening");
  });

  it("is inert while the panel is disconnected", () => {
    render(<NexusVoiceInput lang="en" disabled onTranscript={vi.fn()} />);
    const button = screen.getByTestId("nexus-voice");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(FakeRecognition.startCalls).toBe(0);
  });
});
