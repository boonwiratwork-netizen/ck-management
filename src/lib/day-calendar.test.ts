import { describe, expect, it } from "vitest";
import { monthDays } from "./day-calendar";

describe("monthDays", () => {
  const counts = [
    { count_date: "2026-10-01", is_submitted: true, physical_count: 5 },
    { count_date: "2026-10-01", is_submitted: true, physical_count: null },
    { count_date: "2026-10-02", is_submitted: true, physical_count: 3 },
    { count_date: "2026-10-02", is_submitted: false, physical_count: 2 },
    // Opened, nothing typed in: not a count
    { count_date: "2026-10-03", is_submitted: false, physical_count: null },
  ];
  const { days, summary } = monthDays("2026-10", "2026-10-04", counts, new Set(["2026-10-01", "2026-10-02"]));
  it("one day per date of the month", () => {
    expect(days).toHaveLength(31);
    expect(days[30].date).toBe("2026-10-31");
  });
  it("finished only when every line was submitted", () => {
    expect(days.slice(0, 3).map((d) => d.count)).toEqual(["done", "open", "none"]);
  });
  it("today and later aren't missing yet", () => {
    expect(days[3].pending).toBe(true);
    expect(summary).toEqual({ done: 1, open: 1, none: 1, noSales: 1 });
  });
  it("a count started today isn't counted as unfinished yet", () => {
    const t = monthDays("2026-10", "2026-10-02", counts, new Set());
    expect(t.summary).toEqual({ done: 1, open: 0, none: 0, noSales: 1 });
  });
});
