// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * The router is mocked rather than mounted. These are presentation tests: what
 * matters is that "open the full report" points at the route the metric
 * declared, not that TanStack can resolve it — and a real router would drag a
 * route tree into a test about a panel.
 */
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    onClick,
    className,
    "data-testid": testId,
  }: {
    to?: string;
    children: ReactNode;
    onClick?: () => void;
    className?: string;
    "data-testid"?: string;
  }) => (
    <a href={to} onClick={onClick} className={className} data-testid={testId}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: "/" }),
}));

const { MetricDetailSheet, MetricDetailTrigger } = await import("@/components/metric-detail");
const { overviewEfficiencyMetrics, overviewMetrics } = await import(
  "@/components/overview-metrics"
);
const { hasDetailBody } = await import("@/lib/metric-detail");
const { I18nProvider } = await import("@/lib/i18n");
const { filterStore } = await import("@/lib/filter-store");
const { nexusStore } = await import("@/components/engo-nexus/state/nexus-store");
const { clearNexusView, getNexusView } = await import(
  "@/components/engo-nexus/state/nexus-view-context"
);
const fixtures = await import("./fixtures/overview-response");

/* -------------------------------------------------------------------------
   WHAT THIS SUITE HOLDS

   1. A headline figure is a control. Every one of them opens, says so before it
      is touched, and comes back to the keyboard when it closes.
   2. A drill-down explains the number. A panel that only repeats the figure
      already on the card is the failure this system was built to remove, so
      "has a body" is asserted for every metric the Overview builds.
   3. Nothing is invented. No Odoo link without a real record id, no trend
      without a real series, no ratio without its own denominator.
------------------------------------------------------------------------- */

const wrap = (ui: ReactNode) => render(<I18nProvider>{ui}</I18nProvider>);

const data = fixtures.overviewResponse();
const workforce = fixtures.workforce();
const metrics = overviewMetrics({ data, workforce, lang: "en" });
const efficiency = overviewEfficiencyMetrics({ data, workforce, lang: "en" });

beforeEach(() => {
  window.innerWidth = 1440;
  filterStore.reset();
  filterStore.setDates("2026-08-01", "2026-08-11");
  clearNexusView();
  nexusStore.reset();
});

afterEach(cleanup);

const openTrigger = (detail: (typeof metrics)["revenue"]) => {
  const view = wrap(<MetricDetailTrigger detail={detail} card={{ index: 0 }} />);
  const card = screen.getByTestId(`kpi-${detail.id}`);
  fireEvent.click(card);
  return { ...view, card };
};

describe("a headline figure is a control, and says so before it is touched", () => {
  it("renders the card as a button, not a div", () => {
    wrap(<MetricDetailTrigger detail={metrics.revenue} card={{ index: 0 }} />);
    const card = screen.getByTestId("kpi-overview.revenue");
    expect(card.tagName).toBe("BUTTON");
  });

  it("advertises that it opens a panel, for assistive tech as well as the eye", () => {
    wrap(<MetricDetailTrigger detail={metrics.revenue} card={{ index: 0 }} />);
    const card = screen.getByTestId("kpi-overview.revenue");
    expect(card.getAttribute("aria-haspopup")).toBe("dialog");
    expect(card.textContent).toMatch(/View detail/i);
  });

  it("names the figure it opens, so the button is not just 'Collected revenue'", () => {
    wrap(<MetricDetailTrigger detail={metrics.revenue} card={{ index: 0 }} />);
    expect(
      screen.getByRole("button", { name: /Collected revenue — open the detail/i }),
    ).toBeInTheDocument();
  });

  it("leaves no headline or efficiency figure un-openable", () => {
    for (const detail of [...Object.values(metrics), ...Object.values(efficiency)]) {
      const view = render(
        <I18nProvider>
          <MetricDetailTrigger detail={detail} card={{ index: 0 }} />
        </I18nProvider>,
      );
      expect(screen.getByTestId(`kpi-${detail.id}`).tagName).toBe("BUTTON");
      view.unmount();
    }
  });
});

describe("pressing a figure opens its own detail", () => {
  it("opens the panel for the figure that was pressed", async () => {
    openTrigger(metrics.revenue);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("Collected revenue").length).toBeGreaterThan(0);
  });

  it("restates the value, so a reader can see they opened the right card", async () => {
    openTrigger(metrics.spend);
    const header = await screen.findByTestId("metric-detail-header");
    expect(header.textContent).toContain("$4,395");
  });

  it("states the window the figure was measured over", async () => {
    openTrigger(metrics.revenue);
    const header = await screen.findByTestId("metric-detail-header");
    expect(header.textContent).toContain("1 – 11 August 2026");
  });

  it("states the filters currently narrowing it, read from the filter store", async () => {
    filterStore.set({ platform: "meta" });
    openTrigger(metrics.revenue);
    const scope = await screen.findByTestId("metric-scope");
    expect(scope.textContent).toContain("Meta");
    expect(scope.textContent).toContain("1 – 11 August 2026");
  });

  it("explains the number in words before it shows any arithmetic", async () => {
    openTrigger(metrics.revenue);
    const definition = await screen.findByTestId("metric-definition");
    expect(definition.textContent).toMatch(/Money actually collected/i);
    // The formula is a control, not the opening sentence.
    expect(definition.textContent).not.toMatch(/Sum of paid invoice value/i);
    fireEvent.click(within(definition).getByRole("button"));
    expect(definition.textContent).toMatch(/Sum of paid invoice value/i);
  });

  it("draws the trend from the response's own series", async () => {
    openTrigger(metrics.revenue);
    expect(await screen.findByTestId("metric-trend")).toBeInTheDocument();
  });

  it("breaks the figure down into the parts that produced it", async () => {
    openTrigger(metrics.spend);
    const platforms = await screen.findByTestId("metric-breakdown-platforms");
    expect(platforms.textContent).toContain("Meta");
    expect(platforms.textContent).toContain("Snapchat");
  });

  it("carries supporting numbers that are not a repeat of the headline", async () => {
    openTrigger(metrics.revenue);
    const supporting = await screen.findByTestId("metric-supporting");
    expect(supporting.textContent).toContain("Invoices");
    expect(supporting.textContent).toContain("Average invoice");
  });
});

describe("a ratio never appears without its own numerator and denominator", () => {
  it("states both sides of the conversion rate", () => {
    const detail = efficiency.conversion;
    const values = (detail.supporting ?? []).map((fact) => `${fact.label} ${fact.value}`).join(" ");
    expect(values).toMatch(/Numerator · won 51/);
    expect(values).toMatch(/Denominator · all leads 1,307/);
  });

  it("states both sides of the cost per lead", () => {
    const values = (efficiency.cpl.supporting ?? [])
      .map((fact) => `${fact.label} ${fact.value}`)
      .join(" ");
    expect(values).toMatch(/Spend/);
    expect(values).toMatch(/Platform leads 707/);
  });
});

describe("closing", () => {
  it("closes on the close button", async () => {
    openTrigger(metrics.revenue);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes on Escape", async () => {
    openTrigger(metrics.revenue);
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("hands focus back to the card that opened it", async () => {
    const { card } = openTrigger(metrics.revenue);
    await screen.findByRole("dialog");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(card));
  });
});

describe("on a phone the same detail arrives as a drawer", () => {
  beforeEach(() => {
    window.innerWidth = 390;
  });

  it("opens, and carries a close button a thumb can find", async () => {
    openTrigger(metrics.revenue);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("still states the figure and its window", async () => {
    openTrigger(metrics.revenue);
    const header = await screen.findByTestId("metric-detail-header");
    expect(header.textContent).toContain("1 – 11 August 2026");
  });
});

describe("the panel is a route into the report, not a dead end", () => {
  it("points 'open the full report' at the route the metric declared", async () => {
    openTrigger(metrics.revenue);
    const link = await screen.findByTestId("metric-open-report");
    expect(link.getAttribute("href")).toBe("/accounting");
  });

  it("sends spend to the campaigns report and leads to the leads report", async () => {
    openTrigger(metrics.spend);
    expect((await screen.findByTestId("metric-open-report")).getAttribute("href")).toBe(
      "/campaigns",
    );
    cleanup();
    openTrigger(metrics.leads);
    expect((await screen.findByTestId("metric-open-report")).getAttribute("href")).toBe("/leads");
  });

  it("links a breakdown's 'view all' at a real route", async () => {
    openTrigger(metrics.revenue);
    const courses = await screen.findByTestId("metric-breakdown-courses");
    expect(within(courses).getByRole("link").getAttribute("href")).toBe("/courses");
  });
});

describe("asking Nexus hands over the element the reader is looking at", () => {
  it("opens the existing panel with the pressed metric attached", async () => {
    openTrigger(metrics.roas);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByTestId("metric-ask-nexus-overview.roas"));
    expect(getNexusView().focusedElementId).toBe("overview.roas");
    expect(nexusStore.get().open).toBe(true);
  });

  it("passes a ready-made question through as the pending prompt", async () => {
    openTrigger(metrics.leads);
    const nexus = await screen.findByTestId("metric-nexus");
    const question = within(nexus).getAllByRole("button")[1];
    fireEvent.click(question);
    expect(nexusStore.get().pendingPrompt).toBe(question.textContent);
    expect(getNexusView().focusedElementId).toBe("overview.leads");
  });

  it("records the element on hover, so 'this number' has a referent", () => {
    wrap(<MetricDetailTrigger detail={metrics.spend} card={{ index: 0 }} />);
    fireEvent.mouseEnter(screen.getByTestId("kpi-overview.spend").parentElement!);
    expect(getNexusView().focusedElementId).toBe("overview.spend");
  });
});

describe("nothing is shown that the data did not carry", () => {
  it("gives every Overview metric a body beyond the figure itself", () => {
    for (const detail of [...Object.values(metrics), ...Object.values(efficiency)]) {
      expect(hasDetailBody(detail), `${detail.id} has nothing behind it`).toBe(true);
      expect(detail.definition.length, `${detail.id} has no definition`).toBeGreaterThan(30);
    }
  });

  it("carries a real explanation, not a restatement of the value", () => {
    for (const detail of [...Object.values(metrics), ...Object.values(efficiency)]) {
      const sections =
        (detail.trend ? 1 : 0) +
        (detail.breakdowns?.filter((group) => group.rows.length).length ?? 0) +
        (detail.supporting?.length ? 1 : 0) +
        (detail.records?.rows.length ? 1 : 0);
      expect(sections, `${detail.id} carries only its own value`).toBeGreaterThan(0);
    }
  });

  it("never links a record without a trusted Odoo id", () => {
    for (const detail of [...Object.values(metrics), ...Object.values(efficiency)]) {
      for (const row of detail.records?.rows ?? []) {
        if (!row.href) continue;
        // A text search is not a link to a record: it lands the reader on a
        // list that may not contain the row they clicked.
        expect(row.href, `${detail.id} builds an Odoo link by search`).not.toMatch(/search|filter/i);
        expect(row.href).toMatch(/id=\d+/);
      }
    }
  });

  it("plots no trend from a response that carried no series", async () => {
    const empty = overviewMetrics({
      data: { ...data, trend: [] },
      workforce,
      lang: "en",
    });
    wrap(<MetricDetailSheet detail={empty.revenue} open onClose={() => {}} />);
    const trend = await screen.findByTestId("metric-trend");
    expect(trend.textContent).toMatch(/no line is drawn/i);
  });

  it("says a breakdown is empty rather than drawing a zero bar", async () => {
    const bare = overviewMetrics({
      data: { ...data, courseSales: [] },
      workforce: undefined,
      lang: "en",
    });
    wrap(<MetricDetailSheet detail={bare.revenue} open onClose={() => {}} />);
    const courses = await screen.findByTestId("metric-breakdown-courses");
    expect(courses.textContent).toMatch(/No classified course sales/i);
  });
});
