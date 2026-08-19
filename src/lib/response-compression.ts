/**
 * Whether a response should be compressed on the way out, and with what.
 *
 * Railway's proxy does not compress: asked for `gzip, br`, production returns
 * `/api/filters` as 634 KB with no `content-encoding` at all, and the HTML
 * document as 31 KB that gzip takes to 5.8 KB. Nothing else in the stack does
 * it either — the Nitro node-server preset serves what the handler returns.
 *
 * So the app has to do it, and the decision is worth keeping separate from the
 * stream plumbing: "why is this response empty/garbled" is an expensive bug,
 * and every one of the rules below exists to avoid producing one.
 */

/** Types where compression pays. Everything else is already compressed. */
const COMPRESSIBLE = [
  "application/json",
  "application/javascript",
  "application/manifest+json",
  "image/svg+xml",
  "text/",
];

/**
 * Below this, compressing costs more than it saves: the result travels in the
 * same packet either way, and gzip's own header is ~20 bytes of it.
 */
export const MIN_COMPRESS_BYTES = 1400;

/**
 * Read a `Content-Length` header into a number, or `null` when it says nothing.
 *
 * Exported because getting this wrong silently disables compression on exactly
 * the responses worth compressing, and the mistake looks harmless: a streamed
 * response sets no `Content-Length`, `headers.get` returns `null`, and
 * `Number(null)` is **0** rather than `NaN` — a perfectly finite number, below
 * any minimum size, so every SSR document and every large JSON payload opted
 * itself out. Tested here rather than left inline at the call site.
 */
export function parseContentLength(value: string | null): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const length = Number(trimmed);
  return Number.isFinite(length) && length >= 0 ? length : null;
}

export interface CompressionInputs {
  /** The request's `Accept-Encoding`. */
  acceptEncoding: string | null;
  status: number;
  /** Request method: HEAD carries no body to compress. */
  method: string;
  contentType: string | null;
  /** The response's existing `Content-Encoding`, if it set one. */
  contentEncoding: string | null;
  /** `Content-Length` when the response declares one; `null` while streaming. */
  contentLength: number | null;
  /** Whether the response carries a body at all. */
  hasBody: boolean;
}

export function negotiateCompression(input: CompressionInputs): "gzip" | null {
  if (!input.hasBody) return null;
  // 204/304 have no body by definition, and 1xx never reaches a client this way.
  if (input.status < 200 || input.status === 204 || input.status === 304) return null;
  if (input.method === "HEAD") return null;

  // Never double-encode. A handler that already compressed knows better than
  // this does, and wrapping it again produces a body no client can read.
  if (input.contentEncoding) return null;

  const accepted = (input.acceptEncoding ?? "")
    .toLocaleLowerCase("en")
    .split(",")
    .map((part) => part.split(";")[0].trim());
  if (!accepted.includes("gzip")) return null;

  const type = (input.contentType ?? "").toLocaleLowerCase("en");
  if (!COMPRESSIBLE.some((prefix) => type.startsWith(prefix))) return null;

  // A streamed response declares no length. Those are the SSR documents and the
  // large JSON payloads — exactly what is worth compressing — so an unknown
  // length compresses rather than opting out.
  if (input.contentLength !== null && input.contentLength < MIN_COMPRESS_BYTES) return null;

  return "gzip";
}
