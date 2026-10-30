import { addSaleUsage, type UsageContext } from "@/lib/sale-usage";
import { ruleMatchesSale } from "@/lib/modifier-rules";

/**
 * Runs real bills through the same usage maths that deducts stock, so a menu's
 * setup is judged by what actually gets deducted — whether it comes from the
 * menu's own recipe, a recipe pulled in by a rule, or rules matched on the bill
 * text — instead of guessing from how the rules are configured.
 */

export interface CheckBill {
  menu_code: string;
  menu_name: string;
  qty: number;
  branch_id: string;
}

export interface BillGroup {
  /** The bill name as the POS wrote it */
  name: string;
  branchId: string;
  plates: number;
  /** Ingredient → qty for ONE plate (usage is linear in qty) */
  perPlate: [string, number][];
  /** Nothing at all is deducted for this bill */
  empty: boolean;
  /**
   * The bill picks an option that should replace an item ("เลือกเส้น : เส้นหนาหนึบ"),
   * yet the item it replaces is still deducted: the swap rule's menu list leaves this
   * menu out, so both get counted.
   */
  leftover: { keyword: string; skuId: string }[];
}

export interface MenuBillCheck {
  plates: number;
  emptyPlates: number;
  platesByBranch: Record<string, number>;
  emptyByBranch: Record<string, number>;
  /** Distinct bill names, most sold first */
  groups: BillGroup[];
}

const TINY = 1e-9;

/** Bill check for every menu code that sold, keyed by menu code */
export function checkBills(ctx: UsageContext, bills: CheckBill[]): Map<string, MenuBillCheck> {
  // Same name at the same branch behaves the same: work it out once
  const grouped = new Map<string, { code: string; name: string; branchId: string; plates: number }>();
  for (const b of bills) {
    const q = Number(b.qty) || 0;
    if (q <= 0) continue;
    const key = `${b.menu_code}\u0000${b.branch_id}\u0000${b.menu_name}`;
    const g = grouped.get(key);
    if (g) g.plates += q;
    else grouped.set(key, { code: b.menu_code, name: b.menu_name, branchId: b.branch_id, plates: q });
  }

  const out = new Map<string, MenuBillCheck>();
  for (const g of grouped.values()) {
    const usage = new Map<string, number>();
    const known = addSaleUsage(ctx, { menu_code: g.code, menu_name: g.name, qty: 1, branch_id: g.branchId }, (sku, q) =>
      usage.set(sku, (usage.get(sku) ?? 0) + q),
    );
    if (!known) continue; // codes missing from the menu list are reported by the branch check
    const perPlate = [...usage.entries()].filter(([, q]) => Math.abs(q) > TINY).sort((a, b) => b[1] - a[1]);
    const empty = !perPlate.some(([, q]) => q > TINY);
    const leftover: BillGroup["leftover"] = [];
    for (const r of ctx.rules) {
      if (r.ruleType !== "swap" || !r.swapSkuId) continue;
      if (r.branchIds.length > 0 && !r.branchIds.includes(g.branchId)) continue;
      if (!ruleMatchesSale(r, { menu_code: g.code, menu_name: g.name })) continue;
      // Chosen on the bill, yet the item it replaces is still deducted: the rule's menu
      // list leaves this menu (and the dishes in it) out, so both get counted
      if ((usage.get(r.swapSkuId) ?? 0) > TINY && !leftover.some((x) => x.skuId === r.swapSkuId)) leftover.push({ keyword: r.keyword, skuId: r.swapSkuId });
    }
    let c = out.get(g.code);
    if (!c) {
      c = { plates: 0, emptyPlates: 0, platesByBranch: {}, emptyByBranch: {}, groups: [] };
      out.set(g.code, c);
    }
    c.plates += g.plates;
    c.platesByBranch[g.branchId] = (c.platesByBranch[g.branchId] ?? 0) + g.plates;
    if (empty) {
      c.emptyPlates += g.plates;
      c.emptyByBranch[g.branchId] = (c.emptyByBranch[g.branchId] ?? 0) + g.plates;
    }
    c.groups.push({ name: g.name, branchId: g.branchId, plates: g.plates, perPlate, empty, leftover });
  }
  for (const c of out.values()) c.groups.sort((a, b) => Number(b.empty) - Number(a.empty) || b.plates - a.plates);
  return out;
}
