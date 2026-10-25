import { describe, expect, it } from "vitest";
import { countSheetHtml } from "./count-sheet";
import { isBigDiff } from "@/components/kitchen-count/CountViews";
import type { StockCountLine } from "@/types/stock-count";

describe("A4 count sheet", () => {
  const html = countSheetHtml({
    title: "นับสต๊อกครัวกลาง",
    dateText: "ศ 31 ต.ค.",
    groups: [
      { type: "SM", items: [{ code: "SM-2", name: "ซุป <ทงคตสึ>", unit: "ก.", storage: "Chilled" }, { code: "SM-1", name: "อกเป็ด", unit: "ก.", storage: "Frozen" }] },
      { type: "RM", items: [] },
      { type: "PK", items: [{ code: "PK-1", name: "ชาม", unit: "ชิ้น", storage: "Ambient" }] },
    ],
  });
  it("one section per type with items, A4, title repeated in the table header", () => {
    expect(html.match(/<section>/g)?.length).toBe(2);
    expect(html).toContain("size: A4 portrait");
    expect(html).toContain('<tr class="title">');
    expect(html).not.toContain("RM · วัตถุดิบ");
  });
  it("frozen before chilled, escaped names, no system figure on the sheet", () => {
    expect(html.indexOf("SM-1")).toBeLessThan(html.indexOf("SM-2"));
    expect(html).toContain("ซุป &lt;ทงคตสึ&gt;");
    expect(html).not.toContain("ระบบมี");
  });
});

describe("big difference", () => {
  const l = (system: number, physical: number | null): StockCountLine => ({ id: "x", sessionId: "s", skuId: "k", type: "RM", systemQty: system, physicalQty: physical, variance: physical === null ? 0 : physical - system, note: "" });
  it("more than 20% off, or found where the system had none", () => {
    expect(isBigDiff(l(7100, 5200))).toBe(true);
    expect(isBigDiff(l(1000, 900))).toBe(false);
    expect(isBigDiff(l(0, 500))).toBe(true);
    expect(isBigDiff(l(500, null))).toBe(false);
  });
});
