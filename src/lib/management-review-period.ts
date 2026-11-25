export function managementReviewWindow(
  filters: { from?: string; to?: string; range?: string },
  today: string,
  requestedMonth = "",
) {
  const monthOnly =
    !filters.from && !filters.to && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)
      ? requestedMonth
      : "";
  const from =
    filters.from ||
    (monthOnly
      ? monthOnly + "-01"
      : filters.range === "all"
        ? "2025-01-01"
        : today.slice(0, 7) + "-01");
  const requestedTo =
    filters.to ||
    (monthOnly
      ? new Date(Date.UTC(Number(monthOnly.slice(0, 4)), Number(monthOnly.slice(5, 7)), 0))
          .toISOString()
          .slice(0, 10)
      : today);
  const to = requestedTo > today ? today : requestedTo;
  const valid = (day: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day;
  if (!valid(from) || !valid(requestedTo) || from > to || from < "2025-01-01")
    throw Error("INVALID_REVIEW_PERIOD");
  const months: string[] = [];
  for (
    let date = new Date(from.slice(0, 7) + "-01T12:00:00Z");
    date.toISOString().slice(0, 7) <= to.slice(0, 7);
    date.setUTCMonth(date.getUTCMonth() + 1)
  )
    months.push(date.toISOString().slice(0, 7));
  return { from, to, months, selectedMonth: months.length === 1 ? months[0] : "" };
}
