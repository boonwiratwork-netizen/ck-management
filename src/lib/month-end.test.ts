import { describe, expect, it } from "vitest";
import { kitchenMonthEnd } from "./month-end";

describe("kitchenMonthEnd", () => {
  it("asks from the last 2 days of the month", () => {
    expect(kitchenMonthEnd("2026-10-29")).toBeNull();
    expect(kitchenMonthEnd("2026-10-30")).toBe("2026-10-31");
    expect(kitchenMonthEnd("2026-10-31")).toBe("2026-10-31");
  });
  it("keeps asking about last month up to the 3rd", () => {
    expect(kitchenMonthEnd("2026-11-01")).toBe("2026-10-31");
    expect(kitchenMonthEnd("2026-11-03")).toBe("2026-10-31");
    expect(kitchenMonthEnd("2026-11-04")).toBeNull();
  });
  it("follows short months", () => {
    expect(kitchenMonthEnd("2027-02-27")).toBe("2027-02-28");
    expect(kitchenMonthEnd("2026-12-01")).toBe("2026-11-30");
  });
});
