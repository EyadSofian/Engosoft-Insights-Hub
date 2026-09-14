/**
 * Odoo adapter for the Insights landing collector.
 *
 * Every live Engosoft Odoo landing widget submits its lead form as a native
 * POST to `/<slug>/submit_form`. The Odoo controller then redirects back to the
 * same page with `?success=true` (or `?error=<reason>`), which the widget reads
 * to show its success message. This adapter therefore never counts a click: a
 * submit that survived the widget's own validation only records a pending
 * submission, and `form_submitted` is emitted when the page returns with
 * `success=true` for that pending submission.
 *
 * It never reads form field values and never delays, blocks, or alters the
 * native POST. Lead creation stays entirely inside Odoo.
 */
import { trackLandingEvent, type LandingAttributionConfig } from "./landing-attribution.client";

export interface OdooLandingPage {
  /** Stable analytics identity; never derived from the URL query or page title. */
  id: string;
  name: string;
  slug: string;
  /** The lead form only. Odoo layouts also render a site-wide `#epc-form`. */
  formSelector: string;
}

/** Only pages verified live on engosoft.com with a native POST + `?success=true` return. */
export const ODOO_LANDING_PAGES: readonly OdooLandingPage[] = [
  {
    id: "cmrp",
    name: "CMRP",
    slug: "cmrp",
    formSelector: 'form.contact-form[action$="/cmrp/submit_form"]',
  },
  {
    id: "cfm",
    name: "CFM",
    slug: "cfm",
    formSelector: 'form.contact-form[action$="/cfm/submit_form"]',
  },
  {
    id: "interior",
    name: "Interior Design",
    slug: "interior",
    formSelector: 'form.contact-form[action$="/interior/submit_form"]',
  },
  {
    id: "automotive",
    name: "Automotive",
    slug: "automotive",
    formSelector: 'form.contact-form[action$="/automotive/submit_form"]',
  },
  {
    id: "bim-track",
    name: "BIM Track",
    slug: "bim-track",
    formSelector: 'form.bim-lead-form[action$="/bim-track/submit_form"]',
  },
  {
    id: "pmp",
    name: "PMP",
    slug: "pmp",
    formSelector: 'form.contact-form[action$="/pmp/submit_form"]',
  },
  {
    id: "mechanical-track",
    name: "Mechanical Track",
    slug: "mechanical-track",
    formSelector: 'form.lead-form[action$="/mechanical-track/submit_form"]',
  },
];

export type OdooReturnState = "success" | "error" | "none";

export const PENDING_SUBMISSION_KEY = "engosoft.landing-attribution.v1.odoo-pending-submission";
/** A native POST round trip takes seconds; anything older is not this submit. */
export const PENDING_SUBMISSION_TTL_MS = 30 * 60 * 1000;

export interface PendingSubmission {
  submissionId: string;
  formId: string;
  landingPageId: string;
  createdAt: number;
}

// Odoo prefixes non-default languages (`/en/cfm`); the default Arabic site has none.
const LANGUAGE_SEGMENT = /^[a-z]{2}(?:_[a-z0-9]{2,3})?$/;

function segmentsOf(pathname: string): string[] {
  return String(pathname || "")
    .split(/[?#]/)[0]
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment).toLocaleLowerCase("en-US");
      } catch {
        return segment.toLocaleLowerCase("en-US");
      }
    });
}

export function resolveOdooLandingPage(
  pathname: string,
  pages: readonly OdooLandingPage[] = ODOO_LANDING_PAGES,
): OdooLandingPage | null {
  const segments = segmentsOf(pathname);
  if (segments.length === 2 && LANGUAGE_SEGMENT.test(segments[0])) segments.shift();
  if (segments.length !== 1) return null;
  return pages.find((page) => page.slug === segments[0]) ?? null;
}

export function readOdooReturnState(search: string): OdooReturnState {
  try {
    const params = new URLSearchParams(search);
    if (params.get("success") === "true") return "success";
    if (params.has("error")) return "error";
  } catch {
    // An unreadable query is not evidence of a submission.
  }
  return "none";
}

function sessionStore(win: Window): Storage | null {
  try {
    return win.sessionStorage;
  } catch {
    return null;
  }
}

export function readPendingSubmission(
  storage: Storage | null,
  now: number,
): PendingSubmission | null {
  try {
    const raw = storage?.getItem(PENDING_SUBMISSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingSubmission> | null;
    if (
      !value ||
      typeof value.submissionId !== "string" ||
      typeof value.landingPageId !== "string" ||
      typeof value.createdAt !== "number"
    ) {
      return null;
    }
    const age = now - value.createdAt;
    if (age > PENDING_SUBMISSION_TTL_MS || age < -60_000) return null;
    return {
      submissionId: value.submissionId,
      formId: typeof value.formId === "string" ? value.formId : `${value.landingPageId}-lead-form`,
      landingPageId: value.landingPageId,
      createdAt: value.createdAt,
    };
  } catch {
    return null;
  }
}

function writePendingSubmission(storage: Storage | null, pending: PendingSubmission): void {
  try {
    storage?.setItem(PENDING_SUBMISSION_KEY, JSON.stringify(pending));
  } catch {
    // Storage can be denied; the lead still submits, only attribution is lost.
  }
}

function clearPendingSubmission(storage: Storage | null): void {
  try {
    storage?.removeItem(PENDING_SUBMISSION_KEY);
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}

function newSubmissionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function asElement(target: EventTarget | null): Element | null {
  const candidate = target as Element | null;
  return candidate && typeof candidate.closest === "function" ? candidate : null;
}

export interface OdooTrackerEnvironment {
  window: Window;
  document: Document;
  /** Snapshot taken by the inline Odoo bootstrap, before widgets rewrite the URL. */
  initialPathname: string;
  initialSearch: string;
  endpoint: string;
  now?: () => number;
  newId?: () => string;
}

export interface OdooTrackerHandle {
  page: OdooLandingPage;
  returnState: OdooReturnState;
  stop: () => void;
}

export function startOdooLandingTracker(env: OdooTrackerEnvironment): OdooTrackerHandle | null {
  try {
    const page = resolveOdooLandingPage(env.initialPathname);
    if (!page) return null;
    const now = env.now ?? Date.now;
    const newId = env.newId ?? newSubmissionId;
    const storage = sessionStore(env.window);
    const formId = `${page.id}-lead-form`;
    const config: LandingAttributionConfig = {
      landingPageId: page.id,
      landingPageName: page.name,
      landingPageSlug: page.slug,
      endpoint: env.endpoint,
    };

    const returnState = readOdooReturnState(env.initialSearch);
    if (returnState === "success") {
      const pending = readPendingSubmission(storage, now());
      // A shared `?success=true` link without this tab's own submit proves nothing.
      if (pending && pending.landingPageId === page.id) {
        trackLandingEvent(
          "form_submitted",
          { submissionId: pending.submissionId, formId: pending.formId, preserveLatestTouch: true },
          config,
        );
      }
      clearPendingSubmission(storage);
    } else if (returnState === "error") {
      clearPendingSubmission(storage);
    } else {
      trackLandingEvent("landing_page_view", {}, config);
    }

    const onInteraction = (event: Event) => {
      try {
        if (asElement(event.target)?.closest(page.formSelector))
          trackLandingEvent("form_started", { formId, preserveLatestTouch: true }, config);
      } catch {
        // Telemetry must never surface inside the page's own handlers.
      }
    };
    // Registered on `document` in the bubble phase, so it runs after the widget's
    // delegated validation handler. An invalid form is prevented and its
    // propagation stopped, so it never records a pending submission here.
    const onSubmit = (event: Event) => {
      try {
        const form = asElement(event.target);
        if (!form || event.defaultPrevented || !form.matches(page.formSelector)) return;
        trackLandingEvent("form_started", { formId, preserveLatestTouch: true }, config);
        writePendingSubmission(storage, {
          submissionId: newId(),
          formId,
          landingPageId: page.id,
          createdAt: now(),
        });
      } catch {
        // Never interfere with the native POST.
      }
    };

    const interactionTypes = ["focusin", "input", "change"] as const;
    for (const type of interactionTypes)
      env.document.addEventListener(type, onInteraction, { capture: true, passive: true });
    env.document.addEventListener("submit", onSubmit);

    return {
      page,
      returnState,
      stop: () => {
        for (const type of interactionTypes)
          env.document.removeEventListener(type, onInteraction, { capture: true });
        env.document.removeEventListener("submit", onSubmit);
      },
    };
  } catch {
    return null;
  }
}
