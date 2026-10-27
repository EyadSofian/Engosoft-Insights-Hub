// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { I18nProvider } = await import("@/lib/i18n");
const { LostQualityAudit } = await import("@/components/leads/LostQualityAudit");

const group = (name: string, total: number, review: number) => ({
  name,
  total,
  review,
  approved: total - review,
  reviewPct: total ? (review / total) * 100 : 0,
});

const summary = {
  total: 100,
  approved: 70,
  review: 30,
  reviewPct: 30,
  missingClosedDate: 4,
  missingCreatedDate: 2,
  missingCampaign: 7,
  reasons: [group("No answer", 40, 12), group("Duplicate", 20, 0)],
  otherReasons: [{ name: "Custom reason", count: 2 }],
  courses: Array.from({ length: 10 }, (_, i) => group(`Course ${i + 1}`, 10, 10 - i)),
  salespeople: [group("Sales A", 20, 5)],
  campaigns: [group("Campaign A", 5, 1)],
};

const response = (status: "success" | "failed" = "success") => ({
  source: "Lost Archive Google Sheet",
  sourceUrl: "https://docs.google.com/spreadsheets/d/example/edit",
  status,
  syncedAt: "2026-10-25T10:00:00.000Z",
  rowCount: status === "success" ? 100 : 0,
  selectedMonth: "2026-10",
  selectedCourse: "",
  selectedSalesperson: "",
  months: [
    { key: "2026-08", label: "أغسطس ٢٠٢٦", total: 80, review: 20 },
    { key: "2026-09", label: "سبتمبر ٢٠٢٦", total: 90, review: 25 },
    { key: "2026-10", label: "أكتوبر ٢٠٢٦", total: 100, review: 30 },
  ],
  courseOptions: ["PMP", "CFM"],
  salespersonOptions: ["Sales A"],
  all: summary,
  selected: summary,
  caveat: "Sheet decisions are not today's CRM status.",
});

let requests: string[] = [];
function mount(payload = response()) {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      requests.push(String(input));
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <LostQualityAudit />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Lost quality audit", () => {
  it("explains the decision split without claiming current CRM status", async () => {
    mount();
    const outcome = (await screen.findByText("Audit decision outcome")).closest("section")!;
    expect(within(outcome).getByText("100")).toBeTruthy();
    expect(within(outcome).getByText("30")).toBeTruthy();
    expect(within(outcome).getByText("70")).toBeTruthy();
    expect(within(outcome).getByText(/not current Odoo record states/i)).toBeTruthy();
    expect(within(outcome).getByText(/no pending stage/i)).toBeTruthy();
    expect(screen.getByText(/cannot be added to Odoo's Lost totals/i)).toBeTruthy();
  });

  it("shows every breakdown group on demand and preserves each group's denominator", async () => {
    mount();
    const breakdown = (await screen.findByText("Where did returns concentrate?")).closest(
      "section",
    )!;
    expect(within(breakdown).queryByText("Course 10")).toBeNull();
    fireEvent.click(within(breakdown).getByRole("button", { name: "Show all 10 groups" }));
    expect(within(breakdown).getByText("Course 10")).toBeTruthy();
    const first = within(breakdown).getByText("Course 1").closest(".quality-group-row")!;
    expect(first.textContent).toContain("10 returned");
    expect(first.textContent).toContain("10 audited decisions");
    expect(first.textContent).toContain("100.0%");
    fireEvent.click(within(breakdown).getByRole("button", { name: "Sales team" }));
    expect(within(breakdown).getByText("Sales A")).toBeTruthy();
    expect(within(breakdown).queryByText("Course 1")).toBeNull();

    const reasons = screen.getByText("Recorded Lost reasons").closest("section")!;
    const zero = within(reasons).getByText("Duplicate").closest(".quality-group-row")!;
    expect(within(zero).getByRole("meter").getAttribute("aria-valuenow")).toBe("0");
  });

  it("applies month and course filters to the audit API", async () => {
    mount();
    await screen.findByText("Set the audit scope");
    fireEvent.click(screen.getByRole("button", { name: /2026-09/ }));
    await waitFor(() => expect(requests.at(-1)).toContain("month=2026-09"));
    fireEvent.change(await screen.findByLabelText("Course"), { target: { value: "PMP" } });
    await waitFor(() => expect(requests.at(-1)).toContain("course=PMP"));
  });

  it("withholds business totals when the direct sheet read is unavailable", async () => {
    mount(response("failed"));
    expect(await screen.findByText("Direct sheet read is unavailable")).toBeTruthy();
    expect(screen.queryByText("Audit decision outcome")).toBeNull();
    expect(screen.queryByText("100")).toBeNull();
  });
});
