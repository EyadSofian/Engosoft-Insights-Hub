/**
 * The landing pages the Odoo tracker instruments, for server-side reporting.
 *
 * The browser tracker keeps its own list with form selectors
 * (`ODOO_LANDING_PAGES` in landing-attribution.odoo.ts); the server must not
 * import browser tracker code. tests/unit/acquisition-performance.test.ts fails
 * if the two lists ever disagree.
 */
export interface TrackedLandingPage {
  id: string;
  name: string;
  slug: string;
}

export const TRACKED_LANDING_PAGES: readonly TrackedLandingPage[] = [
  { id: "cmrp", name: "CMRP", slug: "cmrp" },
  { id: "cfm", name: "CFM", slug: "cfm" },
  { id: "interior", name: "Interior Design", slug: "interior" },
  { id: "automotive", name: "Automotive", slug: "automotive" },
  { id: "bim-track", name: "BIM Track", slug: "bim-track" },
  { id: "pmp", name: "PMP", slug: "pmp" },
  { id: "mechanical-track", name: "Mechanical Track", slug: "mechanical-track" },
];
