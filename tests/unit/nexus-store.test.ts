// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canShowProactive,
  clearProactiveMemory,
  isProactiveOptedOut,
  nexusStore,
  rememberPanelOpened,
  rememberProactiveDismissed,
  rememberProactiveShown,
  resetProactiveSession as clearSession,
  setProactiveOptOut,
} from "@/components/engo-nexus/state/nexus-store";
import {
  NEXUS_POPUP_KEY,
  NEXUS_STORAGE_PREFIX,
  PROACTIVE_AFTER_OPEN_MS,
  PROACTIVE_SNOOZE_MS,
  PROACTIVE_SURFACE_SNOOZE_MS,
  nexusStorageKey,
} from "@/components/engo-nexus/lib/nexus-config";

beforeEach(() => {
  window.localStorage.clear();
  nexusStore.reset();
  // The per-session cap is module state, not storage — it has to be reset too.
  clearSession();
});
afterEach(() => {
  window.localStorage.clear();
  clearSession();
});

describe("nexus-store — panel state", () => {
  it("opens, closes and carries a pending prompt exactly once", () => {
    expect(nexusStore.get().open).toBe(false);
    nexusStore.open("كام الإيرادات الشهر ده؟");
    expect(nexusStore.get()).toMatchObject({
      open: true,
      pendingPrompt: "كام الإيرادات الشهر ده؟",
    });
    expect(nexusStore.consumePendingPrompt()).toBe("كام الإيرادات الشهر ده؟");
    // Consumed — a reconnect must not re-send it.
    expect(nexusStore.consumePendingPrompt()).toBeNull();
    expect(nexusStore.get().pendingPrompt).toBeNull();
  });

  it("opens with no prompt", () => {
    nexusStore.open();
    expect(nexusStore.get().pendingPrompt).toBeNull();
    expect(nexusStore.consumePendingPrompt()).toBeNull();
  });

  it("closing clears expansion and any unsent prompt", () => {
    nexusStore.open("x");
    nexusStore.toggleExpanded();
    expect(nexusStore.get().expanded).toBe(true);
    nexusStore.close();
    expect(nexusStore.get()).toEqual({ open: false, expanded: false, pendingPrompt: null });
  });

  it("toggles expansion both ways", () => {
    nexusStore.toggleExpanded();
    expect(nexusStore.get().expanded).toBe(true);
    nexusStore.toggleExpanded();
    expect(nexusStore.get().expanded).toBe(false);
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    let calls = 0;
    const unsubscribe = nexusStore.subscribe(() => (calls += 1));
    nexusStore.open();
    nexusStore.close();
    expect(calls).toBe(2);
    unsubscribe();
    nexusStore.open();
    expect(calls).toBe(2);
  });
});

describe("nexus-store — the proactive popup does not nag", () => {
  it("may show on a clean slate", () => {
    expect(canShowProactive()).toBe(true);
  });

  it("stays quiet for a week after a dismissal, then may show again", () => {
    const now = Date.UTC(2026, 8, 4);
    rememberProactiveDismissed(now);
    expect(canShowProactive({ now })).toBe(false);
    expect(canShowProactive({ now: now + PROACTIVE_SNOOZE_MS - 1 })).toBe(false);
    expect(canShowProactive({ now: now + PROACTIVE_SNOOZE_MS + 1 })).toBe(true);
  });

  it("quiets for a DAY after the panel is opened, not forever", () => {
    /**
     * The old rule was "never again to anyone who has ever opened the panel",
     * which permanently disabled every future page-specific offer because
     * someone once clicked the launcher. Knowing the assistant exists is a
     * reason not to nag today, not a reason never to help again.
     */
    const now = Date.UTC(2026, 8, 4);
    rememberPanelOpened(now);
    expect(canShowProactive({ now })).toBe(false);
    expect(canShowProactive({ now: now + PROACTIVE_AFTER_OPEN_MS - 1 })).toBe(false);
    expect(canShowProactive({ now: now + PROACTIVE_AFTER_OPEN_MS + 1 })).toBe(true);
  });

  it("remembers surfaces separately, so one page does not use up another's chance", () => {
    const now = Date.UTC(2026, 8, 4);
    rememberProactiveShown("courses", now);
    clearSession();
    expect(canShowProactive({ surface: "courses", now: now + 1000 })).toBe(false);
    expect(canShowProactive({ surface: "media_plan", now: now + 1000 })).toBe(true);
    expect(
      canShowProactive({ surface: "courses", now: now + PROACTIVE_SURFACE_SNOOZE_MS + 1 }),
    ).toBe(true);
  });

  it("shows at most once per session, however long the session runs", () => {
    const now = Date.UTC(2026, 8, 4);
    expect(canShowProactive({ surface: "courses", now })).toBe(true);
    rememberProactiveShown("courses", now);
    // A different surface, a day later — still capped, because it is one session.
    expect(canShowProactive({ surface: "leads", now: now + 86_400_000 })).toBe(false);
  });

  it("caps how often it may appear across a rolling week", () => {
    const now = Date.UTC(2026, 8, 4);
    for (const [index, surface] of ["a", "b", "c"].entries()) {
      clearSession();
      expect(canShowProactive({ surface, now: now + index }), surface).toBe(true);
      rememberProactiveShown(surface, now + index);
    }
    clearSession();
    expect(canShowProactive({ surface: "d", now: now + 10 })).toBe(false);
    // Once the week rolls over, it may offer again.
    expect(canShowProactive({ surface: "d", now: now + 8 * 24 * 60 * 60 * 1000 })).toBe(true);
  });

  it("honours a global opt-out, absolutely", () => {
    expect(canShowProactive({ surface: "courses" })).toBe(true);
    setProactiveOptOut(true);
    expect(isProactiveOptedOut()).toBe(true);
    expect(canShowProactive({ surface: "courses" })).toBe(false);
    expect(canShowProactive({ surface: "leads", now: Date.UTC(2030, 0, 1) })).toBe(false);
    setProactiveOptOut(false);
    expect(canShowProactive({ surface: "courses" })).toBe(true);
  });

  it("survives a corrupt or unparsable stored value", () => {
    window.localStorage.setItem(NEXUS_POPUP_KEY, "{not json");
    expect(canShowProactive()).toBe(true);
    expect(() => rememberProactiveDismissed()).not.toThrow();
  });

  it("clears its memory on request", () => {
    rememberPanelOpened();
    expect(canShowProactive()).toBe(false);
    clearProactiveMemory();
    expect(canShowProactive()).toBe(true);
  });
});

describe("nexus-config — session keys never collide", () => {
  it("uses a new key, not the legacy FloatingChat one", () => {
    const key = nexusStorageKey("insights.example.com");
    expect(key.startsWith(NEXUS_STORAGE_PREFIX)).toBe(true);
    expect(key).not.toContain("engo_chat_v2");
    expect(NEXUS_STORAGE_PREFIX).toBe("engo_nexus_v1");
  });

  it("separates environments by hostname", () => {
    expect(nexusStorageKey("localhost")).not.toBe(nexusStorageKey("insights.example.com"));
  });

  it("includes a client-id prefix so a different bot starts a clean thread", () => {
    expect(nexusStorageKey("h").split(":")).toHaveLength(3);
  });

  it("leaves the legacy transcript untouched, so rollback keeps its history", () => {
    window.localStorage.setItem("engo_chat_v2", JSON.stringify([{ role: "user", content: "old" }]));
    rememberPanelOpened();
    rememberProactiveDismissed();
    expect(window.localStorage.getItem("engo_chat_v2")).toContain("old");
  });
});
