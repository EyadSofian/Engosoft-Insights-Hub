// Global test setup.
//
// Two jobs: give every test a deterministic environment, and make it impossible
// for a test to reach production by accident.

// A random-looking but fixed 32-byte key. Test-only; never used anywhere else.
process.env.SECRET_STORE_ROOT_KEY =
  process.env.SECRET_STORE_ROOT_KEY ?? "Zq4vN8xKp2mR7tYw3sJhBc5dFgLnQaEuIoPzXvCbTyU=";
process.env.SECRET_STORE_ADAPTER = "local-aes-gcm";

// The mock Odoo host. Explicitly allowlisted so the SSRF guard permits it
// without a DNS lookup, since `.test` never resolves.
//
// Deliberately NOT including 127.0.0.1: the loopback rejection is one of the
// behaviours under test, and an allowlist entry would quietly disable it.
process.env.ODOO_DEV_HOST_ALLOWLIST = "odoo.example.test";

process.env.FEATURE_WORKSPACES = "1";
process.env.FEATURE_ODOO_DISCOVERY = "1";
process.env.NODE_ENV = "test";

// Production database URLs must never be reachable from a test run. If
// DATABASE_URL is set to anything that is not obviously local, drop it: an
// integration test skipping is infinitely better than a test writing to
// production.
const url = process.env.DATABASE_URL ?? "";
if (url && !/localhost|127\.0\.0\.1|::1/.test(url)) {
  delete process.env.DATABASE_URL;
}

// The ENGO Nexus component suite runs in jsdom (opted into per file with a
// `@vitest-environment` docblock) and needs Testing Library's DOM matchers.
// Guarded on `document` so the node-environment suites — which deliberately
// have no DOM — are untouched by this import.
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
}

// jsdom ships no `matchMedia`, and several presentation components ask it
// whether they are on a phone. Without a stub the first `useEffect` throws and
// the failure reads as a component bug rather than a missing browser API.
//
// Deliberately driven by `window.innerWidth`, so a test that wants the mobile
// shape sets the width and gets a consistent answer from both `matchMedia` and
// the width checks the same hooks make.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = max
      ? window.innerWidth <= Number(max[1])
      : min
        ? window.innerWidth >= Number(min[1])
        : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as typeof window.matchMedia;
}

// Recharts measures its own container. jsdom has no layout and no
// `ResizeObserver`, so the stub reports one observation of nothing: the chart
// mounts, renders no geometry, and the test can go on asserting the text around
// it. A chart's SHAPE is verified in the browser, not here.
if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
  globalThis.ResizeObserver = window.ResizeObserver;
}
