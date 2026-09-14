import {
  LANDING_EVENT_TYPES,
  makeLandingTouch,
  type LandingEventType,
  type LandingTouch,
} from "./landing-attribution";

export interface LandingAttributionConfig {
  /** A stable, human-owned ID; do not derive it from a display title. */
  landingPageId: string;
  landingPageName?: string;
  landingPageSlug?: string;
  /** Defaults to the Insights Hub endpoint. Use a full HTTPS URL cross-origin. */
  endpoint?: string;
}

export interface LandingAttributionCapture {
  visitorId: string;
  sessionId: string;
  firstTouch: LandingTouch;
  latestTouch: LandingTouch;
}

export interface LandingEventOptions {
  formId?: string;
  /** Required by the server for a durable conversion dedupe key. */
  submissionId?: string;
}

const PREFIX = "engosoft.landing-attribution.v1";
const DEFAULT_ENDPOINT = "/api/landing-attribution/events";
let currentConfig: LandingAttributionConfig | null = null;

function canUseBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function id(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function safeGet(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage: Storage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Private browsing, consent tools, and strict browsers may deny storage.
    // Attribution must degrade silently and never affect the business action.
  }
}

function stableId(storage: Storage | null, key: string): string {
  const existing = safeGet(storage, key);
  if (existing) return existing;
  const next = id();
  safeSet(storage, key, next);
  return next;
}

function pageUrl(): string {
  // Fragments never reach a server and can include app state; exclude them.
  const url = new URL(window.location.href);
  url.hash = "";
  return url.toString();
}

function storageTouch(key: string): LandingTouch | null {
  const raw = safeGet(window.localStorage, key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as LandingTouch;
    return value?.landingPageId && value?.landingPageUrl ? value : null;
  } catch {
    return null;
  }
}

/** Capture, preserve first touch, and refresh latest touch for the current browser session. */
export function captureLandingAttribution(
  config: LandingAttributionConfig = currentConfig as LandingAttributionConfig,
): LandingAttributionCapture | null {
  try {
    if (!canUseBrowser() || !config?.landingPageId?.trim()) return null;
    currentConfig = config;
    const visitorId = stableId(window.localStorage, `${PREFIX}.visitor-id`);
    const sessionId = stableId(window.sessionStorage, `${PREFIX}.session-id`);
    const latestTouch = makeLandingTouch({
      landingPageId: config.landingPageId.trim(),
      landingPageName: config.landingPageName,
      landingPageSlug: config.landingPageSlug,
      landingPageUrl: pageUrl(),
      landingPagePath: window.location.pathname,
      referrer: document.referrer || null,
    });
    const firstKey = `${PREFIX}.first-touch`;
    const firstTouch = storageTouch(firstKey) ?? latestTouch;
    if (!storageTouch(firstKey)) safeSet(window.localStorage, firstKey, JSON.stringify(firstTouch));
    safeSet(window.sessionStorage, `${PREFIX}.latest-touch`, JSON.stringify(latestTouch));
    return { visitorId, sessionId, firstTouch, latestTouch };
  } catch {
    return null;
  }
}

function sentKey(
  type: LandingEventType,
  capture: LandingAttributionCapture,
  options: LandingEventOptions,
) {
  if (type === "form_submitted") return `${PREFIX}.submitted.${options.submissionId ?? ""}`;
  if (type === "form_started")
    return `${PREFIX}.started.${capture.sessionId}.${options.formId ?? "default"}`;
  return `${PREFIX}.viewed.${capture.sessionId}.${capture.latestTouch.landingPageId}.${capture.latestTouch.landingPagePath}`;
}

function transmit(endpoint: string, payload: unknown): void {
  try {
    const body = JSON.stringify(payload);
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon?.(endpoint, blob)) return;
    void fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
    }).catch(() => undefined);
  } catch {
    // Telemetry is explicitly best effort.
  }
}

/**
 * Queue a safe analytics event. This never awaits a request and never throws,
 * so call it beside—not instead of—the landing page's existing form request.
 */
export function trackLandingEvent(
  eventType: LandingEventType,
  options: LandingEventOptions = {},
  config: LandingAttributionConfig = currentConfig as LandingAttributionConfig,
): void {
  try {
    if (!LANDING_EVENT_TYPES.includes(eventType) || !config?.landingPageId?.trim()) return;
    if (eventType === "form_submitted" && !options.submissionId?.trim()) return;
    const capture = captureLandingAttribution(config);
    if (!capture) return;
    const key = sentKey(eventType, capture, options);
    if (safeGet(eventType === "form_submitted" ? window.localStorage : window.sessionStorage, key))
      return;
    const payload = {
      event_id: id(),
      event_type: eventType,
      visitor_id: capture.visitorId,
      session_id: capture.sessionId,
      form_id: options.formId?.trim() || null,
      submission_id: options.submissionId?.trim() || null,
      first_touch: capture.firstTouch,
      latest_touch: capture.latestTouch,
    };
    // Persist the client-side guard before transport. Server idempotency still
    // handles retries and multi-tab races; this avoids UI-level double fires.
    safeSet(eventType === "form_submitted" ? window.localStorage : window.sessionStorage, key, "1");
    transmit(config.endpoint || DEFAULT_ENDPOINT, payload);
  } catch {
    // Never propagate telemetry errors into a form handler.
  }
}

export function trackFormStarted(formId?: string): void {
  trackLandingEvent("form_started", { formId });
}

export function trackLandingPageView(config?: LandingAttributionConfig): void {
  trackLandingEvent("landing_page_view", {}, config);
}

export function trackFormSubmitted(submissionId: string, formId?: string): void {
  trackLandingEvent("form_submitted", { submissionId, formId });
}
