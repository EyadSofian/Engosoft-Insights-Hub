// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  DashboardPageHeader,
  DataHealthSummary,
  InsightCard,
  SyncStatus,
  type DataHealthIssue,
} from "@/components/dashboard-bits";
import { KpiCard, Sparkline } from "@/components/ui-bits";
import { I18nProvider } from "@/lib/i18n";

/**
 * The presentation contract for the analytical pages.
 *
 * Two rules are load-bearing and everything here exists to hold them:
 *
 *   1. Nothing is drawn from data that is not there. A sparkline needs a real
 *      series; a delta needs a real delta; a freshness line needs a real time.
 *      A dash where a figure should be reads as "broken", and a placeholder
 *      curve reads as "flat" — both are claims the data has not made.
 *
 *   2. A problem that changes what the numbers mean is always stated in words
 *      the reader can act on. Only the machinery behind it is folded away.
 */

afterEach(cleanup);

const wrap = (ui: React.ReactNode) => render(<I18nProvider>{ui}</I18nProvider>);

describe("a sparkline only ever draws a series it was given", () => {
  it("renders nothing without points", () => {
    const { container } = render(<Sparkline />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders nothing for a single point — one value is not a trend", () => {
    const { container } = render(<Sparkline points={[42]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("ignores non-finite values rather than plotting them as zero", () => {
    const { container } = render(<Sparkline points={[Number.NaN, Infinity]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("draws once there are two real points", () => {
    const { container } = render(<Sparkline points={[1, 4]} />);
    const path = container.querySelector("path");
    expect(path).not.toBeNull();
    expect(path!.getAttribute("d")).toMatch(/^M0/);
  });

  it("is hidden from assistive tech — the figure beside it already says this", () => {
    const { container } = render(<Sparkline points={[1, 2, 3]} />);
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("a KPI card shows only what it was handed", () => {
  it("omits the sparkline when the response carried no series", () => {
    const { container } = wrap(<KpiCard label="Revenue" value="$37.4K" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("$37.4K")).toBeInTheDocument();
  });

  it("omits the delta when no comparison is available", () => {
    wrap(<KpiCard label="Revenue" value="$37.4K" />);
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("shows a delta when one is genuinely present", () => {
    wrap(<KpiCard label="Revenue" value="$37.4K" delta={12} />);
    expect(screen.getByText("+12%")).toBeInTheDocument();
  });
});

describe("the page header states the window, and stays quiet when it cannot", () => {
  it("names the reporting period it was given", () => {
    wrap(<DashboardPageHeader title="Business analytics" period="2026-08-01 → 2026-08-11" />);
    expect(screen.getByText("2026-08-01 → 2026-08-11")).toBeInTheDocument();
  });

  it("renders no period chip at all when the report is not date-scoped", () => {
    const { container } = wrap(<DashboardPageHeader title="Guide" />);
    expect(container.textContent).toBe("Guide");
  });

  it("renders no freshness line rather than a dash where a time should be", () => {
    const { container } = wrap(<SyncStatus />);
    expect(container.firstChild).toBeNull();
  });
});

describe("data health says what changed about the numbers, and hides only the machinery", () => {
  const failure: DataHealthIssue = {
    tone: "danger",
    message: "1 source did not load.",
    impact: "The figures shown exclude it.",
    technical: "Archived Lost: direct Odoo is not configured or could not be reached",
  };

  it("states the problem and its effect on the figures in the open", () => {
    wrap(<DataHealthSummary issues={[failure]} />);
    expect(screen.getByText("1 source did not load.")).toBeInTheDocument();
    expect(screen.getByText("The figures shown exclude it.")).toBeInTheDocument();
  });

  it("keeps the connector's own error text out of the summary line", () => {
    wrap(<DataHealthSummary issues={[failure]} />);
    const summary = screen.getByText(/do not include every source/i);
    expect(summary.textContent).not.toContain("Odoo");
  });

  it("still carries the technical text, behind a disclosure", () => {
    const { container } = wrap(<DataHealthSummary issues={[failure]} />);
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(details!.textContent).toContain("Archived Lost");
  });

  it("does not claim data needs review when every note is informational", () => {
    wrap(
      <DataHealthSummary
        issues={[{ tone: "info", message: "Revenue is invoices actually paid." }]}
      />,
    );
    expect(screen.getByText(/All sources connected/i)).toBeInTheDocument();
  });

  it("reports a clean bill when there is nothing to report", () => {
    wrap(<DataHealthSummary issues={[]} />);
    expect(screen.getByText(/All sources are connected and healthy/i)).toBeInTheDocument();
  });
});

describe("an insight names its verdict in words, not only in colour", () => {
  it("labels a best result", () => {
    wrap(<InsightCard kind="best" title="CFM produced the most revenue" value="$14.3K" />);
    expect(screen.getByText("Best result")).toBeInTheDocument();
  });

  it("labels something needing attention", () => {
    wrap(<InsightCard kind="attention" title="Data needs review" />);
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
  });

  it("lets a caller override the eyebrow without losing it", () => {
    wrap(<InsightCard kind="opportunity" eyebrow="Recommended decision" title="Hold budget" />);
    expect(screen.getByText("Recommended decision")).toBeInTheDocument();
  });

  it("omits the value line when the insight has no figure behind it", () => {
    const { container } = wrap(<InsightCard kind="note" title="Nothing to report" />);
    expect(container.querySelector(".num")).toBeNull();
  });
});
