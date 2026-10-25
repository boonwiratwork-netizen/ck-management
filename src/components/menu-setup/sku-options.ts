import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import { activeUnitCost } from "@/lib/menu-health";

/** Dropdown options for picking an ingredient: grouped SM → RM → SP, active only, flags missing prices */
export function skuOptions(skus: SKU[], prices: Price[], keepId?: string | null) {
  const groups: { type: SKU["type"]; label: string }[] = [
    { type: "SM", label: "ของจากครัวกลาง (SM)" },
    { type: "RM", label: "วัตถุดิบ (RM)" },
    { type: "SP", label: "เตรียมที่ร้าน (SP)" },
  ];
  return groups.flatMap((g) => {
    const items = skus
      .filter((s) => s.type === g.type && (s.status === "Active" || s.id === keepId))
      .map((s) => ({ value: s.id, label: s.name, sublabel: s.skuId, badge: activeUnitCost(prices, s.id) > 0 ? undefined : "ไม่มีราคา" }));
    return items.length ? [{ value: `g-${g.type}`, label: g.label, isGroupHeader: true }, ...items] : [];
  });
}
