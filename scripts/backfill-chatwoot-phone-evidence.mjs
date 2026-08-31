import { readFile } from "node:fs/promises";
import {
  chatwootPhoneKey,
  getChatwootPhoneConversationEvidence,
} from "../src/lib/chatwoot.server.ts";

const path = process.argv[2];
if (!path) {
  throw new Error("Usage: node scripts/backfill-chatwoot-phone-evidence.mjs phones.json|-");
}
const rawInput =
  path === "-"
    ? await new Promise((resolve, reject) => {
        let value = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => {
          value += chunk;
        });
        process.stdin.on("end", () => resolve(value));
        process.stdin.on("error", reject);
      })
    : await readFile(path, "utf8");
const input = JSON.parse(rawInput);
if (!Array.isArray(input)) throw new Error("Phone input must be a JSON array");
const phones = [...new Set(input.map((value) => chatwootPhoneKey(String(value))).filter(Boolean))];
const chunkSize = Math.max(1, Math.min(40, Number(process.env.CHATWOOT_BACKFILL_CHUNK) || 20));
let completed = 0;
let conversations = 0;

for (let index = 0; index < phones.length; index += chunkSize) {
  const chunk = phones.slice(index, index + chunkSize);
  const batch = await getChatwootPhoneConversationEvidence(chunk, {
    maxRemote: chunk.length,
    remoteConcurrency: 1,
  });
  completed += chunk.length - batch.missing;
  conversations += [...batch.evidence.values()].reduce((sum, rows) => sum + rows.length, 0);
  console.log(
    JSON.stringify({
      batch: index / chunkSize + 1,
      phones: phones.length,
      completed,
      missing: batch.missing,
      conversations,
      error: batch.error,
    }),
  );
}

console.log(JSON.stringify({ ok: completed === phones.length, phones: phones.length, completed, conversations }));
