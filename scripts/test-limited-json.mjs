import assert from "node:assert/strict";
import { readLimitedJson, RequestBodyTooLargeError } from "../src/lib/limited-json.server.ts";

const encoded = new TextEncoder().encode('{"rows":[{"name":"حملة"}]}');
const chunked = new ReadableStream({
  start(controller) {
    controller.enqueue(encoded.slice(0, 7));
    controller.enqueue(encoded.slice(7));
    controller.close();
  },
});
const parsed = await readLimitedJson(
  new Request("https://example.test/ingest", {
    method: "POST",
    body: chunked,
    duplex: "half",
  }),
  encoded.byteLength,
);
assert.deepEqual(parsed, { rows: [{ name: "حملة" }] });

await assert.rejects(
  readLimitedJson(
    new Request("https://example.test/ingest", {
      method: "POST",
      body: new Blob([encoded]).stream(),
      duplex: "half",
    }),
    encoded.byteLength - 1,
  ),
  RequestBodyTooLargeError,
  "chunked bodies are stopped using received bytes, not Content-Length",
);

await assert.rejects(
  readLimitedJson(
    new Request("https://example.test/ingest", { method: "POST", body: "not json" }),
    1_000,
  ),
  SyntaxError,
);

process.stdout.write("limited JSON body tests passed\n");
