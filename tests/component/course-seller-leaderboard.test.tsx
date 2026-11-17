// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CourseSellerLeaderboard } from "@/components/CourseSellerLeaderboard";
import { I18nProvider } from "@/lib/i18n";
import { buildCourseSellerRanking } from "@/lib/course-seller-ranking";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("shows order value alongside collected amount, cohort and conversion; expands the full list", () => {
  const sellers = Array.from({ length: 6 }, (_, i) => `Seller ${i + 1}`);
  const report = buildCourseSellerRanking({
    course: "BIM",
    crm: [{ id: "lead", course: "BIM", salesperson: sellers[0], isWon: true }],
    lost: [{ id: "loss", course: "BIM", salesperson: sellers[0] }],
    orders: sellers.map((salesperson, i) => ({
      course: "BIM",
      salesperson,
      orderRef: `S${i}`,
      usdSales: 600 - i * 100,
    })),
    collections: [{ course: "BIM", salesperson: sellers[0], usdPaid: 450 }],
    availability: { crm: true, orders: true, collections: true },
  });
  render(
    <I18nProvider>
      <CourseSellerLeaderboard course="BIM" report={report} />
    </I18nProvider>,
  );
  const table = screen.getByRole("table", { name: /Salesperson ranking.*BIM/i });
  const first = within(table).getByRole("rowheader", { name: "Seller 1" }).closest("tr")!;
  expect(
    within(first)
      .getAllByRole("cell")
      .map((cell) => cell.textContent),
  ).toEqual(["#1", "$600", "1", "$450", "2", "1", "50.0%"]);
  expect(within(table).queryByRole("rowheader", { name: "Seller 6" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show all salespeople (6)" }));
  expect(within(table).getByRole("rowheader", { name: "Seller 6" })).toBeTruthy();
});
