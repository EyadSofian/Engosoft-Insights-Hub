import assert from "node:assert/strict";
import {
  MIN_COMPRESS_BYTES,
  negotiateCompression,
  parseContentLength,
} from "../src/lib/response-compression.ts";

const base = {
  acceptEncoding: "gzip, deflate, br",
  status: 200,
  method: "GET",
  contentType: "application/json",
  contentEncoding: null,
  contentLength: 634_414,
  hasBody: true,
};
const ask = (over = {}) => negotiateCompression({ ...base, ...over });

/* --- what this was written for --------------------------------------------- */
{
  // Production serves /api/filters as 634 KB of JSON with no content-encoding,
  // and the SSR document as 31 KB where gzip gives 5.8 KB. Both compress.
  assert.equal(ask(), "gzip");
  assert.equal(ask({ contentType: "text/html; charset=utf-8", contentLength: 31_819 }), "gzip");
  // Streamed responses declare no length. Those are the SSR documents and the
  // big payloads — the ones worth compressing — so unknown means yes.
  assert.equal(ask({ contentLength: null }), "gzip");
}

/* --- never produce a body the client cannot read --------------------------- */
{
  // Double-encoding is unreadable. A handler that already compressed knows
  // better than this rule does.
  assert.equal(ask({ contentEncoding: "gzip" }), null);
  assert.equal(ask({ contentEncoding: "br" }), null);
  // Bodies that do not exist, and statuses defined not to have one.
  assert.equal(ask({ hasBody: false }), null);
  assert.equal(ask({ status: 204 }), null);
  assert.equal(ask({ status: 304 }), null);
  assert.equal(ask({ method: "HEAD" }), null);
}

/* --- only when asked, and only when it pays -------------------------------- */
{
  assert.equal(ask({ acceptEncoding: null }), null);
  assert.equal(ask({ acceptEncoding: "identity" }), null);
  assert.equal(ask({ acceptEncoding: "br" }), null, "br alone is not gzip");
  // Parsed as a list with q-values, not searched as a string: "notgzip" must
  // not pass and "gzip;q=0.8" must.
  assert.equal(ask({ acceptEncoding: "deflate, gzip;q=0.8" }), "gzip");
  assert.equal(ask({ acceptEncoding: "xgzipx" }), null);

  // Already-compressed formats gain nothing and cost CPU.
  assert.equal(ask({ contentType: "image/png" }), null);
  assert.equal(ask({ contentType: "font/woff2" }), null);
  assert.equal(ask({ contentType: "application/octet-stream" }), null);
  assert.equal(ask({ contentType: null }), null);
  // The ones that do gain.
  assert.equal(ask({ contentType: "text/css" }), "gzip");
  assert.equal(ask({ contentType: "image/svg+xml" }), "gzip");
  assert.equal(ask({ contentType: "application/javascript" }), "gzip");

  // Under one packet there is nothing to win.
  assert.equal(ask({ contentLength: MIN_COMPRESS_BYTES - 1 }), null);
  assert.equal(ask({ contentLength: MIN_COMPRESS_BYTES }), "gzip");
  // /api/health is 1,488 bytes in production — just over the line.
  assert.equal(ask({ contentLength: 1_488 }), "gzip");
}

/* --- the header that reads as zero ----------------------------------------- */
{
  // A streamed response sets no Content-Length, so `headers.get` returns null —
  // and `Number(null)` is 0, not NaN. Read naively, every SSR document and
  // every large JSON payload therefore measured as zero bytes and skipped
  // compression entirely. That is exactly what shipped and had to be caught by
  // hand on a running server; this is the guard.
  assert.equal(parseContentLength(null), null);
  assert.equal(parseContentLength(""), null);
  assert.equal(parseContentLength("   "), null);
  assert.notEqual(parseContentLength(null), 0, "absent length must not read as zero");
  assert.equal(parseContentLength("634414"), 634_414);
  assert.equal(parseContentLength(" 1488 "), 1_488);
  assert.equal(parseContentLength("not-a-number"), null);
  assert.equal(parseContentLength("-1"), null);
  assert.equal(parseContentLength("0"), 0);

  // End to end: the absent header must reach the decision as "unknown", which
  // compresses.
  assert.equal(ask({ contentLength: parseContentLength(null) }), "gzip");
  // And a genuinely tiny declared body still opts out.
  assert.equal(ask({ contentLength: parseContentLength("120") }), null);
}

console.log("response compression tests passed.");
