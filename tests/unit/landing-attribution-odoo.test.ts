// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PENDING_SUBMISSION_KEY,
  PENDING_SUBMISSION_TTL_MS,
  readOdooReturnState,
  readPendingSubmission,
  resolveOdooLandingPage,
  startOdooLandingTracker,
  type OdooTrackerHandle,
} from "@/lib/landing-attribution.odoo";

const ENDPOINT = "https://insights.example.com/api/landing-attribution/events";

interface SentPayload {
  event_type: string;
  form_id: string | null;
  submission_id: string | null;
  latest_touch: {
    landingPageId: string;
    landingPageName: string | null;
    normalizedUtm: Record<string, string | null>;
  };
}

interface Sent {
  endpoint: string;
  type: string;
  payload: SentPayload;
}

let sent: Sent[] = [];
let handles: OdooTrackerHandle[] = [];

class RecordingBlob {
  readonly parts: string[];
  readonly type: string;
  constructor(parts: string[], options?: { type?: string }) {
    this.parts = parts;
    this.type = options?.type ?? "";
  }
}

function start(pathname: string, search: string, now = Date.now()) {
  window.history.replaceState({}, "", `${pathname}${search}`);
  const handle = startOdooLandingTracker({
    window,
    document,
    initialPathname: pathname,
    initialSearch: search,
    endpoint: ENDPOINT,
    now: () => now,
  });
  if (handle) handles.push(handle);
  return handle;
}

function events(type?: string) {
  return sent.filter((item) => !type || item.payload.event_type === type);
}

function renderCfmPage() {
  document.body.innerHTML = `
    <form id="epc-form" class="epc-form"><input id="epc-name" name="name"></form>
    <section class="s_new_cfm_lead_page">
      <form class="contact-form" action="/cfm/submit_form" method="POST">
        <input id="full-name" name="name">
        <input id="mobile" name="mobile">
        <button type="submit">Send</button>
      </form>
    </section>`;
  return document.querySelector<HTMLFormElement>("form.contact-form")!;
}

function submit(form: HTMLFormElement) {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  sent = [];
  vi.stubGlobal("Blob", RecordingBlob);
  Object.defineProperty(window.navigator, "sendBeacon", {
    configurable: true,
    value: (endpoint: string, blob: RecordingBlob) => {
      sent.push({ endpoint, type: blob.type, payload: JSON.parse(blob.parts.join("")) });
      return true;
    },
  });
});

afterEach(() => {
  handles.forEach((handle) => handle.stop());
  handles = [];
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("resolveOdooLandingPage", () => {
  it("matches verified slugs with an optional Odoo language prefix", () => {
    expect(resolveOdooLandingPage("/cfm")?.id).toBe("cfm");
    expect(resolveOdooLandingPage("/cfm/")?.id).toBe("cfm");
    expect(resolveOdooLandingPage("/en/cfm")?.id).toBe("cfm");
    expect(resolveOdooLandingPage("/ar_001/cmrp")?.id).toBe("cmrp");
    expect(resolveOdooLandingPage("/bim-track")?.id).toBe("bim-track");
  });

  it("does not claim unrelated or nested Odoo paths", () => {
    expect(resolveOdooLandingPage("/cfm/submit_form")).toBeNull();
    expect(resolveOdooLandingPage("/shop/cfm-preparation-course-1109")).toBeNull();
    expect(resolveOdooLandingPage("/interior-webinar")).toBeNull();
    expect(resolveOdooLandingPage("/")).toBeNull();
  });
});

describe("readOdooReturnState", () => {
  it("reads only the Odoo controller's redirect contract", () => {
    expect(readOdooReturnState("?success=true")).toBe("success");
    expect(readOdooReturnState("?success=false")).toBe("none");
    expect(readOdooReturnState("?error=missing_fields")).toBe("error");
    expect(readOdooReturnState("?utm_source=facebook")).toBe("none");
  });
});

describe("startOdooLandingTracker", () => {
  const utm =
    "?utm_source=facebook&utm_medium=paid_social&utm_campaign=lp_tracking_test&utm_content=test_creative";

  it("sends one page view with the page identity and UTM touch, cross-origin safe", () => {
    renderCfmPage();
    start("/cfm", utm);
    start("/cfm", utm);

    const views = events("landing_page_view");
    expect(views).toHaveLength(1);
    expect(views[0].endpoint).toBe(ENDPOINT);
    expect(views[0].type).toBe("text/plain;charset=UTF-8");
    const touch = views[0].payload.latest_touch;
    expect(touch.landingPageId).toBe("cfm");
    expect(touch.landingPageName).toBe("CFM");
    expect(touch.normalizedUtm).toMatchObject({
      source: "facebook",
      medium: "paid_social",
      campaign: "lp_tracking_test",
      content: "test_creative",
    });
  });

  it("emits form_started once, only for the lead form", () => {
    renderCfmPage();
    start("/cfm", utm);
    document.getElementById("epc-name")!.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(events("form_started")).toHaveLength(0);

    const input = document.getElementById("full-name")!;
    input.dispatchEvent(new Event("focusin", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(events("form_started")).toHaveLength(1);
    expect(events("form_started")[0].payload.form_id).toBe("cfm-lead-form");
  });

  it("never records a submission the widget's validation rejected", () => {
    const form = renderCfmPage();
    form.closest("section")!.addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    start("/cfm", utm);
    submit(form);
    expect(window.sessionStorage.getItem(PENDING_SUBMISSION_KEY)).toBeNull();
  });

  it("counts form_submitted only after Odoo redirects back with success=true", () => {
    const form = renderCfmPage();
    const now = Date.now();
    start("/cfm", utm, now);
    (document.getElementById("full-name") as HTMLInputElement).value = "Test Person";
    (document.getElementById("mobile") as HTMLInputElement).value = "0500000000";
    submit(form);
    expect(events("form_submitted")).toHaveLength(0);
    const pending = readPendingSubmission(window.sessionStorage, now);
    expect(pending?.landingPageId).toBe("cfm");

    handles.forEach((handle) => handle.stop());
    handles = [];
    start("/cfm", "?success=true", now + 3_000);

    const submitted = events("form_submitted");
    expect(submitted).toHaveLength(1);
    expect(submitted[0].payload.submission_id).toBe(pending?.submissionId);
    // The redirect drops the UTMs; the session's paid touch must survive it.
    expect(submitted[0].payload.latest_touch.normalizedUtm.campaign).toBe("lp_tracking_test");
    expect(events("landing_page_view")).toHaveLength(1);
    expect(window.sessionStorage.getItem(PENDING_SUBMISSION_KEY)).toBeNull();

    const serialized = JSON.stringify(sent.map((item) => item.payload));
    expect(serialized).not.toContain("Test Person");
    expect(serialized).not.toContain("0500000000");
  });

  it("ignores success=true without this tab's own pending submission", () => {
    renderCfmPage();
    start("/cfm", "?success=true");
    expect(events("form_submitted")).toHaveLength(0);
  });

  it("drops a pending submission when Odoo returns an error or it expires", () => {
    const form = renderCfmPage();
    const now = Date.now();
    start("/cfm", utm, now);
    submit(form);
    handles.forEach((handle) => handle.stop());
    handles = [];
    start("/cfm", "?error=missing_fields", now + 1_000);
    expect(window.sessionStorage.getItem(PENDING_SUBMISSION_KEY)).toBeNull();
    expect(events("form_submitted")).toHaveLength(0);

    expect(
      readPendingSubmission(
        {
          getItem: () =>
            JSON.stringify({
              submissionId: "old",
              formId: "cfm-lead-form",
              landingPageId: "cfm",
              createdAt: now - PENDING_SUBMISSION_TTL_MS - 1,
            }),
        } as unknown as Storage,
        now,
      ),
    ).toBeNull();
  });

  it("does nothing on pages that are not verified landing pages", () => {
    expect(start("/shop/cfm-preparation-course-1109", utm)).toBeNull();
    expect(sent).toHaveLength(0);
  });
});
