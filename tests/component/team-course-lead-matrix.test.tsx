// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TeamCourseLeadMatrix } from "@/components/TeamCourseLeadMatrix";
import {
  buildTeamCourseMatrix,
  teamCourseLeadRecords,
  teamCourseLeadPage,
  teamCourseOwnerKey,
} from "@/lib/team-course-leads";
import { filterStore } from "@/lib/filter-store";
const query = vi.hoisted(() => vi.fn());
const exportDownload = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/team-course-export", () => ({ downloadTeamCourseExport: exportDownload }));
vi.mock("@tanstack/react-query", () => ({ useQuery: query }));
vi.mock("@/components/DetailPanel", () => ({
  DetailPanel: ({ title, children, footer, onClose }: any) => (
    <div role="dialog" aria-label={title}>
      <button onClick={onClose}>Close</button>
      {children}
      {footer}
    </div>
  ),
}));
vi.mock("@/lib/i18n", async (load) => ({
  ...(await load<typeof import("@/lib/i18n")>()),
  useI18n: () => ({ lang: "en" }),
}));
const records = teamCourseLeadRecords(
  Array.from({ length: 57 }, (_, n) => ({
    id: String(n + 1),
    salesperson: "Sales A",
    course: "PMP",
    contact: `Example ${n + 1}`,
    createdAt: "2026-11-26",
    recordType: "lead",
    businessStatus: "lead",
    salesTeam: "Team A",
  })) as any,
  [],
);
const matrix = buildTeamCourseMatrix(records, (name) => name, [{ name: "Sales Zero" }]);
beforeEach(() => {
  filterStore.setDates("2026-11-01", "2026-11-26");
  query.mockImplementation(({ queryKey }: any) => {
    const params = new URLSearchParams(queryKey[1]);
    return {
      data: teamCourseLeadPage(
        records,
        params.get("ownerKey")!,
        params.get("matrixCourse")!,
        Number(params.get("offset")),
        50,
        "https://odoo.test",
      ),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
  });
});
afterEach(() => {
  cleanup();
  filterStore.reset();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("shows counts, keeps zero-lead salespeople, and fetches no details while closed", () => {
  render(<TeamCourseLeadMatrix matrix={matrix} available />);
  expect(screen.getByRole("columnheader", { name: "PMP" })).toBeTruthy();
  expect(screen.getByText("Sales Zero")).toBeTruthy();
  expect(screen.getByRole("button", { name: "View 57 leads · Sales A · PMP" })).toBeTruthy();
  expect(query).not.toHaveBeenCalled();
});
it("opens the exact count with all records paginated and an Odoo link for each lead", async () => {
  render(<TeamCourseLeadMatrix matrix={matrix} available />);
  fireEvent.click(screen.getByRole("button", { name: "View 57 leads · Sales A · PMP" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getAllByRole("link", { name: "Open in Odoo" })).toHaveLength(50);
  const href = screen.getAllByRole("link", { name: "Open in Odoo" })[0].getAttribute("href");
  expect(href).toBe("https://odoo.test/web#id=1&model=crm.lead&view_type=form");
  const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
  vi.stubGlobal("fetch", fetchMock);
  await query.mock.calls[0][0].queryFn();
  const url = new URL(fetchMock.mock.calls[0][0], "https://test");
  expect(url.searchParams.get("ownerKey")).toBe(teamCourseOwnerKey("Sales A"));
  expect(url.searchParams.get("matrixCourse")).toBe("PMP");
  expect(url.searchParams.get("from")).toBe("2026-11-01");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getAllByRole("link", { name: "Open in Odoo" })).toHaveLength(7);
  expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
});
it("closes old details when top-bar filters change", () => {
  render(<TeamCourseLeadMatrix matrix={matrix} available />);
  fireEvent.click(screen.getByRole("button", { name: "View 57 leads · Sales A · PMP" }));
  act(() => filterStore.setDates("2026-10-01", "2026-10-31"));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("searches people and adjusts visible totals without changing cell populations", () => {
  render(<TeamCourseLeadMatrix matrix={matrix} available />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Sales Zero" } });
  expect(screen.getByText("Sales Zero")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "View 57 leads · Sales A · PMP" })).toBeNull();
});
it("does not show incomplete data as a zero or open a drill-down on failure", () => {
  render(<TeamCourseLeadMatrix matrix={null} available={false} />);
  expect(screen.getByRole("status").textContent).toContain("coverage is unavailable");
  expect(screen.queryByRole("table")).toBeNull();
  expect(query).not.toHaveBeenCalled();
});

it("defaults to the top-bar dates and reflects later changes automatically", () => {
  render(<TeamCourseLeadMatrix matrix={matrix} available />);
  expect((screen.getByLabelText("From date") as HTMLInputElement).value).toBe("2026-11-01");
  expect((screen.getByLabelText("To date") as HTMLInputElement).value).toBe("2026-11-26");
  act(() => filterStore.setDates("2026-10-01", "2026-10-31"));
  expect((screen.getByLabelText("From date") as HTMLInputElement).value).toBe("2026-10-01");
  expect((screen.getByLabelText("To date") as HTMLInputElement).value).toBe("2026-10-31");
});
it("applies valid custom dates to the shared filter and closes old drilldowns", () => {
  render(<TeamCourseLeadMatrix matrix={matrix} available />);
  fireEvent.click(screen.getByRole("button", { name: "View 57 leads · Sales A · PMP" }));
  fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-11-10" } });
  fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-11-20" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply dates" }));
  expect(filterStore.get()).toMatchObject({ from: "2026-11-10", to: "2026-11-20" });
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("rejects reversed/empty dates without changing the active scope", () => {
  render(<TeamCourseLeadMatrix matrix={matrix} available />);
  fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-12-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply dates" }));
  expect(screen.getByRole("alert").textContent).toContain("end cannot precede");
  expect(filterStore.get().from).toBe("2026-11-01");
  fireEvent.change(screen.getByLabelText("From date"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply dates" }));
  expect(filterStore.get().from).toBe("2026-11-01");
});
it("exports CSV and Excel for exactly the visible rows and active period", async () => {
  render(<TeamCourseLeadMatrix matrix={matrix} available />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Sales Zero" } });
  fireEvent.click(screen.getByRole("button", { name: "Export CSV", exact: true }));
  await waitFor(() => expect(exportDownload).toHaveBeenCalledTimes(1));
  expect(exportDownload.mock.calls[0][1]).toBe("csv");
  expect(exportDownload.mock.calls[0][0]).toMatchObject({
    rows: [expect.objectContaining({ salesperson: "Sales Zero" })],
    filters: { from: "2026-11-01", to: "2026-11-26" },
    search: "Sales Zero",
  });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Export Excel", exact: true }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Export Excel", exact: true }));
  await waitFor(() => expect(exportDownload).toHaveBeenCalledTimes(2));
  expect(exportDownload.mock.calls[1][1]).toBe("xlsx");
});
