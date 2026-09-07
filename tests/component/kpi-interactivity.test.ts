import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/* ---------------------------------------------------------------------------
   NO FIGURE ON A PAGE IS A DEAD END

   The drill-down system only pays off if it is used everywhere. One report that
   still renders a bare `KpiCard` teaches the reader that some numbers open and
   some do not, and from then on they stop trying — which costs more than the
   card was worth.

   So this walks the source rather than the DOM: every card element on a page
   must either be handed a drill-down (through one of the triggers) or carry its
   own `onClick`/`to`. A DOM test could only ever cover the pages it mounted.
--------------------------------------------------------------------------- */

const CARD_TAGS = ["KpiCard", "MetricCard", "InsightCard"];

/**
 * Cards that are deliberately not page figures.
 *
 * `NexusMessageRenderer` draws a card INSIDE an assistant reply. Opening a
 * drill-down from there would put a panel over the panel the reader is already
 * reading, and the assistant can already be asked a follow-up in words.
 */
const NOT_A_PAGE_FIGURE = new Set(["src/components/engo-nexus/NexusMessageRenderer.tsx"]);

/** The trigger components — they own the click, so their card takes no handler. */
const TRIGGERS = ["MetricDetailTrigger", "MetricCardDetailTrigger", "InsightDetailTrigger"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/** Every opening tag for `tag`, with brace-aware scanning so props survive. */
function openingTags(source: string, tag: string): { tag: string; line: number }[] {
  const found: { tag: string; line: number }[] = [];
  let index = 0;
  while ((index = source.indexOf(`<${tag}`, index)) !== -1) {
    // `<MetricCard` must not match `<MetricCardDetailTrigger`.
    if (/[A-Za-z0-9_]/.test(source[index + tag.length + 1] ?? "")) {
      index += 1;
      continue;
    }
    let cursor = index + tag.length + 1;
    let depth = 0;
    while (cursor < source.length) {
      const char = source[cursor];
      if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (depth === 0 && char === ">") break;
      cursor++;
    }
    found.push({
      tag: source.slice(index, cursor + 1),
      line: source.slice(0, index).split("\n").length,
    });
    index = cursor + 1;
  }
  return found;
}

const files = sourceFiles("src").filter((file) => !NOT_A_PAGE_FIGURE.has(file));

describe("every headline figure on every page is a control", () => {
  it("renders no card that cannot be opened", () => {
    const inert: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // The trigger components render the bare card themselves and supply the
      // handler, so they are the one place a handler-less card is correct.
      if (TRIGGERS.some((name) => source.includes(`export function ${name}(`))) continue;
      for (const tag of CARD_TAGS) {
        for (const found of openingTags(source, tag)) {
          const interactive = /\bonClick=/.test(found.tag) || /\bto=/.test(found.tag);
          if (!interactive) inert.push(`${file}:${found.line} <${tag}>`);
        }
      }
    }
    expect(inert, `these figures do nothing when pressed:\n${inert.join("\n")}`).toEqual([]);
  });

  it("routes every page card through the shared drill-down", () => {
    // A page may still own its click (a card that filters the table beside it),
    // but the ones that describe a figure go through a trigger, so escape,
    // focus return and the Nexus hand-off behave the same everywhere.
    const routes = sourceFiles("src/routes");
    const withCards = routes.filter((file) =>
      CARD_TAGS.some((tag) => openingTags(readFileSync(file, "utf8"), tag).length > 0),
    );
    for (const file of withCards) {
      const source = readFileSync(file, "utf8");
      expect(
        TRIGGERS.some((name) => source.includes(name)),
        `${file} renders cards without the drill-down system`,
      ).toBe(true);
    }
  });
});

describe("no Odoo link is built from anything but a record id", () => {
  it("never constructs a deep link out of a text search", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("src")) {
      const source = readFileSync(file, "utf8");
      for (const line of source.split("\n")) {
        if (!/odoo/i.test(line)) continue;
        // A link built by dropping a name or a number into a search query lands
        // the reader on a list that may not hold the row they pressed.
        if (/\/web#.*(search|filter)=|action=.*search_default/i.test(line)) {
          offenders.push(`${file}: ${line.trim().slice(0, 120)}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
