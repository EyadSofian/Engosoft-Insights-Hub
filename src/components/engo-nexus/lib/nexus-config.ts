/**
 * ENGO Nexus — client configuration.
 *
 * WHAT IS PUBLIC HERE, AND WHY THAT IS SAFE
 *
 * `NEXUS_CLIENT_ID` is the Botpress Webchat client identifier. Botpress defines
 * it as public client configuration: it is embedded in every webchat page by
 * design, it grants no privileges on its own, and the bot rate-limits per
 * client server-side.
 *
 * Nothing else about ENGO Nexus reaches the browser. The PriceEngo API key, the
 * Insights Hub service secret and the Botpress management token all live in the
 * bot's server-side secret store; none of them has any path into this bundle.
 * The security test asserts that.
 */

/** Production ENGO Nexus webchat client id (bot 7d1a8999-…). */
export const NEXUS_CLIENT_ID: string =
  import.meta.env.VITE_ENGO_NEXUS_CLIENT_ID ?? "35b6e8d1-bef9-40d3-8bd6-d46e32ca8e4b";

/**
 * Storage key for the Botpress conversation.
 *
 * Deliberately NOT `engo_chat_v2`: that key belongs to the legacy FloatingChat
 * and its `/api/chat` transcript. Leaving it untouched means the old chat can
 * be restored by reverting one file, with its history intact — the rollback
 * path stays real rather than theoretical.
 *
 * The hostname is part of the key so a local dev session, a staging deployment
 * and production never resume each other's conversation. The client id prefix
 * is included so pointing at a different bot starts a clean thread instead of
 * replaying an old one into it.
 */
export const NEXUS_STORAGE_PREFIX = "engo_nexus_v1";

export function nexusStorageKey(hostname?: string): string {
  const host = hostname ?? (typeof window === "undefined" ? "ssr" : window.location.hostname);
  return `${NEXUS_STORAGE_PREFIX}:${NEXUS_CLIENT_ID.slice(0, 8)}:${host}`;
}

/** Proactive popup state lives under its own key so dismissal survives reloads. */
export const NEXUS_POPUP_KEY = `${NEXUS_STORAGE_PREFIX}:popup`;

/**
 * Dwell on ONE page before the popup may appear.
 *
 * Measured from arriving on a route, and reset by navigating away. Appearing on
 * load interrupts someone mid-task, which is how a proactive assistant earns a
 * permanent dismissal on its first showing.
 */
export const PROACTIVE_DELAY_MS = 25_000;

/** Once dismissed, stay quiet for a week. */
export const PROACTIVE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * After the panel is opened, stay quiet for a day — NOT forever.
 *
 * The previous rule was "never show again to anyone who has ever opened the
 * panel", which permanently disabled every future page-specific offer because
 * someone once clicked the launcher. Knowing the assistant exists is a reason
 * not to nag today, not a reason never to help again.
 */
export const PROACTIVE_AFTER_OPEN_MS = 24 * 60 * 60 * 1000;

/**
 * A surface that has already offered its help waits this long before offering
 * again. Tracked per surface, so seeing it on Courses does not use up the one
 * chance Media Plan had to be useful.
 */
export const PROACTIVE_SURFACE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/** Hard ceiling across all surfaces, per rolling week. */
export const PROACTIVE_MAX_PER_WEEK = 3;

/** And at most this many in one browser session, however long it runs. */
export const PROACTIVE_MAX_PER_SESSION = 1;

/** The user can switch proactive help off entirely, and it stays off. */
export const NEXUS_OPTOUT_KEY = `${NEXUS_STORAGE_PREFIX}:proactive-off`;
