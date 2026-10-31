import type { ProductionCost } from "./ck-production-cost";

const baht = (n: number) => `฿${Math.abs(Math.round(n)).toLocaleString("th-TH")}`;

/**
 * What a month's line says, in whole baht so the parts add up to the total. A month
 * with no closing count can't say anything about use yet (today's balances already
 * follow the recipes), so only the price part counts for it.
 */
export function monthGap(cost: ProductionCost, estimated: boolean) {
  const price = Math.round(cost.priceVar);
  const use = estimated ? null : Math.round(cost.usageVar);
  const total = price + (use ?? 0);
  const pct = cost.stdCost > 0 ? (total / cost.stdCost) * 100 : null;
  const parts: string[] = [];
  if (price) parts.push(`ซื้อของ${price > 0 ? "แพงขึ้น" : "ถูกลง"} ${baht(price)}`);
  if (use === null) parts.push("ส่วนการใช้รอนับปลายเดือน");
  else if (use) parts.push(`ใช้ของ${use > 0 ? "เกินสูตร" : "น้อยกว่าสูตร"} ${baht(use)}`);
  return { price, use, total, pct, why: parts.length ? `เพราะ${parts.join(" · ")}` : "ราคาและการใช้ตรงสูตร" };
}
