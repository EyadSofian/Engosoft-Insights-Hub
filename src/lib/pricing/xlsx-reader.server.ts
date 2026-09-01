// Server-only minimal .xlsx reader.
//
// An .xlsx is a ZIP of XML parts. Reading the handful this feature needs —
// the workbook index, the shared string table and each worksheet — is about
// two hundred lines against Node's own `zlib`, so no spreadsheet dependency is
// added for it. That matches how the rest of this repo handles a narrow need
// (see the hand-rolled HS256 verifier in `admin-auth.server.ts`): one algorithm,
// one file format, no supply chain.
//
// It deliberately reads only what a price list contains: cell values, shared
// strings, inline strings and date-formatted numbers. Formulas are read at
// their cached value, which is what Excel last calculated and what a person
// sees on screen.
import { inflateRawSync } from "node:zlib";

export interface XlsxSheet {
  name: string;
  /** Row-major cells, 1-based row and column addressed as `rows[r][c]`. */
  rows: (string | number | null)[][];
}

export interface XlsxWorkbook {
  sheets: XlsxSheet[];
  sheetNames: string[];
}

/** Hard ceiling on a decompressed part, so a crafted archive cannot exhaust RAM. */
const MAX_PART_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

interface ZipEntry {
  name: string;
  data: Buffer;
}

/* --- ZIP ------------------------------------------------------------------- */

function findEndOfCentralDirectory(buffer: Buffer): number {
  // The EOCD record is at most 22 bytes plus a 65,535-byte comment.
  const start = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= start; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

/**
 * Read every entry from a ZIP archive.
 *
 * The central directory is the authority on where each entry starts, rather
 * than walking local headers: entries written with a streaming data descriptor
 * carry zeroed sizes in their local header, which is exactly how many tools
 * (including Google Sheets' export) write .xlsx files.
 */
function readZip(buffer: Buffer): Map<string, Buffer> {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) throw new Error("Not a valid .xlsx file: no ZIP end-of-directory record.");

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  let totalBytes = 0;

  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (uncompressedSize > MAX_PART_BYTES) {
      throw new Error(`Refusing to expand ${name}: ${uncompressedSize} bytes.`);
    }
    totalBytes += uncompressedSize;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Workbook expands to more than 256 MB.");

    // The local header repeats the name and carries its own extra field, whose
    // length usually differs from the central one.
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    const entry: ZipEntry = {
      name,
      data: method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : Buffer.alloc(0),
    };
    if (method !== 0 && method !== 8) continue;
    entries.set(entry.name, entry.data);
  }
  return entries;
}

/* --- XML ------------------------------------------------------------------- */

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return XML_ENTITIES[body] ?? whole;
  });
}

function attribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`));
  return match ? decodeXml(match[1]) : "";
}

/** Concatenate every `<t>` run in a shared-string or inline-string element. */
function textRuns(xml: string): string {
  let out = "";
  for (const match of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) {
    out += decodeXml(match[1] ?? "");
  }
  return out;
}

function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const match of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si(?:\s[^>]*)?\/>/g)) {
    out.push(textRuns(match[1] ?? ""));
  }
  return out;
}

/** `BC7` -> column index 55 (0-based). */
function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0] ?? "";
  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function rowIndex(reference: string): number {
  return Number(reference.match(/\d+$/)?.[0] ?? 0);
}

/* --- worksheet ------------------------------------------------------------- */

function readSheet(name: string, xml: string, sharedStrings: string[]): XlsxSheet {
  const rows: (string | number | null)[][] = [];

  // Lazy attributes plus an explicit self-closing branch. A greedy `[^>]*`
  // consumes the `/` of `<c r="A2" s="6"/>`, then matches the `>` branch and
  // scans on to the *next* `</c>` — silently giving the empty cell its
  // neighbour's value and dropping every cell in between.
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowAttributes = rowMatch[1] ?? "";
    const declared = Number(attribute(`<row${rowAttributes}>`, "r"));
    const body = rowMatch[2] ?? "";
    const cells: (string | number | null)[] = [];
    let nextColumn = 0;

    for (const cellMatch of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const openTag = `<c${cellMatch[1] ?? ""}>`;
      const inner = cellMatch[2] ?? "";
      const reference = attribute(openTag, "r");
      const column = reference ? columnIndex(reference) : nextColumn;
      nextColumn = column + 1;

      const type = attribute(openTag, "t");
      let value: string | number | null = null;

      if (type === "inlineStr") {
        value = textRuns(inner) || null;
      } else {
        const raw = decodeXml(inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] ?? "");
        if (raw === "") {
          value = type === "s" ? null : null;
        } else if (type === "s") {
          value = sharedStrings[Number(raw)] ?? null;
        } else if (type === "str" || type === "e") {
          value = raw;
        } else if (type === "b") {
          value = raw === "1" ? "TRUE" : "FALSE";
        } else {
          const parsed = Number(raw);
          value = Number.isFinite(parsed) ? parsed : raw;
        }
      }

      while (cells.length < column) cells.push(null);
      cells[column] = value;
    }

    const target = declared > 0 ? declared : rows.length + 1;
    while (rows.length < target) rows.push([]);
    rows[target - 1] = cells;
  }

  return { name, rows };
}

/**
 * Read a workbook from its bytes.
 *
 * Sheet order follows `xl/workbook.xml`, which is the order a person sees in
 * Excel — the part filenames inside the archive are not ordered.
 */
export function readXlsx(buffer: Buffer): XlsxWorkbook {
  const parts = readZip(buffer);
  const utf8 = (name: string): string | undefined => parts.get(name)?.toString("utf8");

  const workbookXml = utf8("xl/workbook.xml");
  if (!workbookXml) throw new Error("Not a valid .xlsx file: xl/workbook.xml is missing.");
  const relsXml = utf8("xl/_rels/workbook.xml.rels") ?? "";

  const targetsById = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const tag = match[0];
    const id = attribute(tag, "Id");
    const target = attribute(tag, "Target");
    if (id && target) targetsById.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }

  const sharedStrings = readSharedStrings(utf8("xl/sharedStrings.xml"));
  const sheets: XlsxSheet[] = [];

  for (const match of workbookXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const tag = match[0];
    const name = attribute(tag, "name");
    const relationId = attribute(tag, "r:id") || attribute(tag, "relationshipId");
    const target = targetsById.get(relationId) ?? "";
    const xml =
      (target ? utf8(`xl/${target}`) : "") ??
      utf8(`xl/worksheets/sheet${sheets.length + 1}.xml`) ??
      "";
    if (!xml) continue;
    sheets.push(readSheet(name, xml, sharedStrings));
  }

  return { sheets, sheetNames: sheets.map((sheet) => sheet.name) };
}

/** Convenience for the CSV path: a Google Sheets tab arrives as rows already. */
export function sheetFromRows(name: string, rows: (string | number | null)[][]): XlsxSheet {
  return { name, rows };
}
