/**
 * Standalone browser entry loaded by the guarded Odoo website view. Built by
 * `scripts/build-landing-tracker.mjs` into `public/landing-attribution/odoo-tracker.js`.
 * The only thing Odoo needs to know is this script's public URL: the collector
 * endpoint is derived from the script's own origin, and no secret exists here.
 */
import { startOdooLandingTracker } from "./landing-attribution.odoo";

interface EngosoftLandingBoot {
  pathname?: string;
  search?: string;
}

declare global {
  interface Window {
    EngosoftLandingBoot?: EngosoftLandingBoot;
    __engosoftLandingTrackerStarted?: boolean;
  }
}

const FALLBACK_ORIGIN = "https://engosoft-insights-hub-production.up.railway.app";

(() => {
  try {
    if (window.__engosoftLandingTrackerStarted) return;
    window.__engosoftLandingTrackerStarted = true;
    const script = document.currentScript as HTMLScriptElement | null;
    const origin = script?.src ? new URL(script.src).origin : FALLBACK_ORIGIN;
    const boot = window.EngosoftLandingBoot;
    startOdooLandingTracker({
      window,
      document,
      initialPathname: boot?.pathname ?? window.location.pathname,
      initialSearch: boot?.search ?? window.location.search,
      endpoint: `${origin}/api/landing-attribution/events`,
    });
  } catch {
    // Analytics is secondary; the landing page must behave exactly as before.
  }
})();
