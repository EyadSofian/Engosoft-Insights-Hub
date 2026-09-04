import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

/**
 * Structural guarantees that a component test cannot make.
 *
 * These read the source rather than rendering it, because the properties they
 * protect are about what is WIRED, not what one component does: that exactly
 * one assistant is mounted, that the deprecated SDK entry points stay out, and
 * that no secret can reach the browser bundle. All three are the kind of thing
 * a later refactor breaks silently.
 */
describe("exactly one assistant is mounted", () => {
  const root_tsx = read("src/routes/__root.tsx");

  it("mounts NexusRoot", () => {
    expect(root_tsx).toContain("<NexusRoot />");
    expect(root_tsx).toContain('from "@/components/engo-nexus/NexusRoot"');
  });

  it("does not mount the legacy FloatingChat", () => {
    expect(root_tsx).not.toContain("<FloatingChat");
    expect(root_tsx).not.toMatch(/^import \{ FloatingChat \}/m);
  });

  it("keeps FloatingChat on disk for rollback", () => {
    expect(() => read("src/components/FloatingChat.tsx")).not.toThrow();
    expect(read("src/components/FloatingChat.tsx")).toContain("engo_chat_v2");
  });

  it("leaves the legacy /api/chat route in place, so rollback is real", () => {
    expect(() => read("src/routes/api/chat.ts")).not.toThrow();
  });
});

describe("the current SDK API is used, not the deprecated one", () => {
  const files = [
    "src/components/engo-nexus/NexusSession.tsx",
    "src/components/engo-nexus/NexusPanel.tsx",
    "src/components/engo-nexus/NexusRoot.tsx",
  ].map(read);

  it("uses WebchatProvider and the current hooks", () => {
    const session = files[0]!;
    const panel = files[1]!;
    expect(session).toContain("WebchatProvider");
    expect(panel).toContain("useActiveConversation");
    expect(panel).toContain("useConversations");
  });

  it("never calls the deprecated useWebchat() or renders <Webchat>", () => {
    for (const source of files) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(/\buseWebchat\s*\(/);
      expect(code).not.toMatch(/<Webchat[\s/>]/);
    }
  });

  it("mounts exactly one WebchatProvider in the tree", () => {
    const all = [
      "NexusRoot.tsx",
      "NexusSession.tsx",
      "NexusPanel.tsx",
      "NexusLauncher.tsx",
      "NexusProactivePopup.tsx",
    ]
      .map((name) => read(`src/components/engo-nexus/${name}`))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(all.match(/<WebchatProvider/g) ?? []).toHaveLength(1);
  });
});

describe("no secret can reach the browser", () => {
  const sources = [
    "src/components/engo-nexus/lib/nexus-config.ts",
    "src/components/engo-nexus/NexusSession.tsx",
    "src/components/engo-nexus/NexusPanel.tsx",
    "src/components/engo-nexus/lib/nexus-context.ts",
  ].map(read);

  it("references no server-side secret name", () => {
    const forbidden = [
      "PRICING_ENGO_API_KEY",
      "INSIGHTS_HUB_SERVICE_SECRET",
      "INTERNAL_API_SECRET",
      "SECRET_STORE_ROOT_KEY",
      "DATABASE_URL",
      "adminSecret",
    ];
    for (const source of sources) {
      for (const name of forbidden) {
        expect(source).not.toContain(name);
      }
    }
  });

  it("carries no key-shaped literal", () => {
    for (const source of sources) {
      expect(source).not.toMatch(/eng_[a-f0-9]{8,}/);
      expect(source).not.toMatch(/\bsk-[A-Za-z0-9_-]{16,}/);
      expect(source).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{16,}/);
      expect(source).not.toMatch(/postgres(ql)?:\/\/[^\s"']*:[^\s"']*@/);
    }
  });

  it("exposes only the public Botpress client id, and documents why that is safe", () => {
    const config = sources[0]!;
    expect(config).toMatch(/NEXUS_CLIENT_ID/);
    expect(config).toMatch(/public client configuration/i);
    // A UUID-shaped client id is the only identifier here.
    expect(config).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });
});
