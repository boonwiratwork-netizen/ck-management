import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CkTrend } from "./CkTrend";
import { monthGap } from "@/lib/ck-trend";
import type { ProductionCost } from "@/lib/ck-production-cost";

// The browser's ResizeObserver isn't in jsdom
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });

const cost = (stdCost: number, actCost: number, priceVar: number, usageVar: number): ProductionCost => ({ rows: [], stdCost, actCost, priceVar, usageVar, rmUsed: [] }) as unknown as ProductionCost;
const months = [
  { from: "2026-10-01", to: "2026-10-31" },
  { from: "2026-09-01", to: "2026-09-30" },
  { from: "2026-08-01", to: "2026-08-31" },
];

describe("CkTrend", () => {
  // Real kitchen figures, Aug–Oct 2026
  const sep = cost(142809, 144283, 5313, -3839);
  const points = [
    { from: "2026-10-01", to: "2026-10-31", cost: cost(102444, 102672, -14, 241), estimated: true, blocked: null, produced: true },
    { from: "2026-09-01", to: "2026-09-30", cost: sep, estimated: false, blocked: null, produced: true },
    "failed" as const,
  ];
  it("says each month in words: more or less than the recipes, and why", () => {
    const onPick = vi.fn();
    render(<CkTrend months={months} points={points} selected="2026-09-01" onPick={onPick} open={{ cost: sep, estimated: false, label: "ก.ย. 69" }} />);
    expect(screen.getByText(/แพงกว่าสูตร ฿1,474 \(1\.0%\)/)).toBeTruthy();
    expect(screen.getByText("เพราะซื้อของแพงขึ้น ฿5,313 · ใช้ของน้อยกว่าสูตร ฿3,839")).toBeTruthy();
    // A month without a closing count doesn't claim a usage figure, in the total either
    expect(screen.getByText("เพราะซื้อของถูกลง ฿14 · ส่วนการใช้รอนับปลายเดือน")).toBeTruthy();
    expect(screen.getByText(/ถูกกว่าสูตร ฿14/)).toBeTruthy();
    expect(screen.getByText("โหลดไม่ได้ · เปิดหน้านี้ใหม่อีกครั้ง")).toBeTruthy();
    expect(screen.getByText("ก.ย. 69: เงินไปไหน")).toBeTruthy();
    fireEvent.click(screen.getByText(/แพงกว่าสูตร ฿1,474/));
    expect(onPick).toHaveBeenCalledWith("2026-09-01");
  });
  it("the parts add up to the total in whole baht", () => {
    const g = monthGap(cost(1000, 1100.4, 50.5, 49.9), false);
    expect(g.price + (g.use ?? 0)).toBe(g.total);
    expect(monthGap(cost(0, 50, 50, 0), false).pct).toBeNull();
  });
});
