// Server-only: who receives the daily report.
//
// Anyone who sends /start to the bot is subscribed; /stop removes them. There is
// no database in this app, so the list lives in a JSON file. On Railway the
// container filesystem is wiped on every redeploy, so point
// TELEGRAM_SUBSCRIBERS_FILE at a mounted volume to make the list survive —
// otherwise it resets and people have to /start again.
//
// TELEGRAM_CHAT_ID stays supported and is always included, so the manager keeps
// receiving the report even if the file is lost.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_FILE = "./.data/telegram-subscribers.json";

interface Stored {
  chats: Record<string, { since: string; name?: string }>;
  /** Cairo date (YYYY-MM-DD) the daily report was last delivered for. */
  lastSentDay?: string;
}

let loaded: Stored | null = null;
let writing: Promise<void> = Promise.resolve();

function filePath(): string {
  return process.env.TELEGRAM_SUBSCRIBERS_FILE || DEFAULT_FILE;
}

async function load(): Promise<Stored> {
  if (loaded) return loaded;
  try {
    const raw = await readFile(filePath(), "utf8");
    const parsed = JSON.parse(raw) as Stored;
    loaded = parsed && typeof parsed === "object" && parsed.chats ? parsed : { chats: {} };
  } catch {
    // Missing or corrupt file is the normal first-run state, not an error.
    loaded = { chats: {} };
  }
  return loaded;
}

async function persist(): Promise<void> {
  const snapshot = JSON.stringify(loaded ?? { chats: {} }, null, 2);
  // Serialize writes so two /start messages arriving together cannot interleave
  // and truncate each other.
  writing = writing.then(async () => {
    const path = filePath();
    try {
      await mkdir(dirname(path), { recursive: true });
      // Write-then-rename, so a crash mid-write cannot leave a half file that
      // would silently wipe every subscriber on next boot.
      const tmp = `${path}.tmp`;
      await writeFile(tmp, snapshot, "utf8");
      await rename(tmp, path);
    } catch (e) {
      console.error("[telegram] could not persist subscribers:", e instanceof Error ? e.message : e);
    }
  });
  return writing;
}

export async function subscribe(chatId: string, name?: string): Promise<boolean> {
  const store = await load();
  if (store.chats[chatId]) {
    if (name && store.chats[chatId].name !== name) {
      store.chats[chatId].name = name;
      await persist();
    }
    return false; // already subscribed
  }
  store.chats[chatId] = { since: new Date().toISOString(), name };
  await persist();
  return true;
}

export async function unsubscribe(chatId: string): Promise<boolean> {
  const store = await load();
  if (!store.chats[chatId]) return false;
  delete store.chats[chatId];
  await persist();
  return true;
}

export async function isSubscribed(chatId: string): Promise<boolean> {
  const store = await load();
  return !!store.chats[chatId];
}

/** Every chat the report should go to: the file plus the configured fallback. */
export async function recipients(): Promise<string[]> {
  const store = await load();
  const ids = new Set(Object.keys(store.chats));
  const fallback = process.env.TELEGRAM_CHAT_ID?.trim();
  if (fallback) ids.add(fallback);
  return [...ids];
}

export async function subscriberCount(): Promise<number> {
  const store = await load();
  return Object.keys(store.chats).length;
}

/* --- once-per-day guard ---------------------------------------------------- */

/**
 * Today's date in Cairo, which is the calendar the schedule runs on.
 */
export function reportDay(now = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return p; // en-CA formats as YYYY-MM-DD
}

/**
 * Records that the report went out for `day`, returning false if it already had.
 *
 * The in-process timer cannot fire while Railway has the container asleep, so
 * the durable fallback is an external scheduler hitting the send endpoint. This
 * guard makes running both safe: whichever trigger arrives first sends, and the
 * other is a no-op instead of a duplicate report.
 */
export async function claimReportDay(day: string): Promise<boolean> {
  const store = await load();
  if (store.lastSentDay === day) return false;
  store.lastSentDay = day;
  await persist();
  return true;
}

export async function lastSentDay(): Promise<string | undefined> {
  const store = await load();
  return store.lastSentDay;
}

/** Test seam — drops the in-memory copy so the next read hits disk. */
export function resetSubscriberCache() {
  loaded = null;
}
