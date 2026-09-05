import { describe, expect, it } from "vitest";
import { hasRenderableContent } from "@/components/engo-nexus/NexusMessageRenderer";

const msg = (block: unknown) => ({ id: "m", timestamp: new Date(), block }) as never;

describe("the blank avatar bug — renderability is decided before the row", () => {
  it("omits a custom block with no known type and no text", () => {
    // This is the blank assistant row: mascot beside a null renderer result.
    expect(hasRenderableContent(msg({ type: "custom", name: "Whatever", data: {} }))).toBe(false);
  });

  it("renders an unknown custom block that carries text", () => {
    expect(hasRenderableContent(msg({ type: "custom", name: "X", data: { text: "مرحبا" } }))).toBe(
      true,
    );
  });

  it("renders a known custom payload", () => {
    expect(
      hasRenderableContent(
        msg({
          type: "custom",
          name: "course_analysis",
          data: {
            type: "course_analysis",
            course: "PMP",
            campaigns: [{ name: "A" }],
            products: [],
          },
        }),
      ),
    ).toBe(true);
  });

  it("omits an empty text block but keeps a real one", () => {
    expect(hasRenderableContent(msg({ type: "text", text: "   " }))).toBe(false);
    expect(hasRenderableContent(msg({ type: "text", text: "hello" }))).toBe(true);
  });

  it("renders every media block that has a url", () => {
    for (const type of ["image", "audio", "video", "file"]) {
      expect(hasRenderableContent(msg({ type, url: "https://x/y" })), type).toBe(true);
      expect(hasRenderableContent(msg({ type, url: "" })), type).toBe(false);
    }
  });

  it("renders choice and dropdown with options", () => {
    expect(
      hasRenderableContent(msg({ type: "choice", options: [{ label: "a", value: "a" }] })),
    ).toBe(true);
    expect(hasRenderableContent(msg({ type: "choice", options: [] }))).toBe(false);
  });

  it("renders card, carousel, location and a non-empty bloc", () => {
    expect(hasRenderableContent(msg({ type: "card" }))).toBe(true);
    expect(hasRenderableContent(msg({ type: "carousel" }))).toBe(true);
    expect(hasRenderableContent(msg({ type: "location" }))).toBe(true);
    expect(hasRenderableContent(msg({ type: "bloc", items: [{ type: "text", text: "x" }] }))).toBe(
      true,
    );
    expect(hasRenderableContent(msg({ type: "bloc", items: [] }))).toBe(false);
  });

  it("never throws on a malformed message", () => {
    for (const block of [null, undefined, {}, { type: "" }, { type: "custom" }]) {
      expect(() => hasRenderableContent(msg(block))).not.toThrow();
    }
  });
});
