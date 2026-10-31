import { useCallback, useMemo } from "react";
import type { SKU } from "@/types/sku";
import type { Supplier } from "@/types/supplier";
import type { Price } from "@/types/price";
import type { Menu } from "@/types/menu";
import type { MenuBomLine } from "@/types/menu-bom";
import type { SpBomLine } from "@/types/sp-bom";
import { yieldOf, type DatasetKey } from "@/lib/import-datasets";
import type { FileRow } from "@/lib/import-file";
import { useMenuCategories } from "@/hooks/use-menu-categories";
import { toLocalDateStr } from "@/lib/utils";

export interface SaveResult {
  saved: number;
  failed: number;
  /** Anything else worth saying (categories made on the way) */
  note?: string;
}
export type ImportSaves = Record<DatasetKey, (rows: FileRow[]) => Promise<SaveResult>>;

interface Deps {
  skus: SKU[];
  prices: Price[];
  suppliers: Supplier[];
  menus: Menu[];
  menuBomLines: MenuBomLine[];
  spLines: SpBomLine[];
  bulkAddSkus: (rows: Omit<SKU, "id" | "skuId">[]) => Promise<number>;
  bulkEnsureCategories: (codes: string[]) => Promise<string[]>;
  addSupplier: (d: Omit<Supplier, "id">) => Promise<Supplier | null>;
  addPrice: (d: Omit<Price, "id" | "pricePerUsageUom">, sku: SKU | undefined, opts?: { batch?: boolean }) => Promise<boolean>;
  recostPrices: (...skuIds: string[]) => Promise<unknown>;
  bulkAddMenus: (rows: Omit<Menu, "id">[]) => Promise<number>;
  replaceMenuRecipe: (menuId: string, next: Omit<MenuBomLine, "id" | "menuId" | "branchId">[]) => Promise<boolean>;
  replaceSpRecipe: (spSkuId: string, next: Omit<SpBomLine, "id">[]) => Promise<boolean>;
}

const low = (s: string | undefined) => (s ?? "").trim().toLowerCase();
const num = (s: string | undefined) => Number(String(s ?? "").replace(/[,%]/g, "").trim()) || 0;
const yes = (s: string | undefined) => low(s) === "true" || (s ?? "").trim() === "1";

/**
 * Writing what an import file brought (rows already checked by import-datasets).
 * Same rules as the import pages these replace. A recipe file replaces each
 * listed recipe: all its new lines go in one write and the old ones come out only
 * after that worked, so a failure never leaves a menu or SP with no recipe or
 * with both (the old menu-recipe import deleted first).
 */
export function useImportSaves(d: Deps): ImportSaves {
  const menuCats = useMenuCategories();
  const skuByCode = useCallback((code: string) => d.skus.find((s) => low(s.skuId) === low(code)), [d.skus]);
  const activeCost = useCallback((skuId: string) => d.prices.find((p) => p.skuId === skuId && p.isActive)?.pricePerUsageUom ?? 0, [d.prices]);

  return useMemo<ImportSaves>(
    () => ({
      skus: async (rows) => {
        const codes = [...new Set(rows.map((r) => r["Category"]?.trim().toUpperCase() || "MT"))];
        const made = await d.bulkEnsureCategories(codes);
        const saved = await d.bulkAddSkus(
          rows.map((r) => ({
            name: r["Name"].trim(),
            type: r["Type"].trim().toUpperCase() as SKU["type"],
            category: r["Category"]?.trim().toUpperCase() || "MT",
            status: r["Status"]?.trim() === "Inactive" ? "Inactive" : "Active",
            specNote: r["Spec Note"]?.trim() || "",
            packSize: num(r["Pack Size"]) || 1,
            packUnit: r["Pack Unit"]?.trim() || "",
            purchaseUom: r["Purchase UOM"]?.trim() || "",
            usageUom: r["Usage UOM"]?.trim() || "",
            converter: num(r["Converter"]) || 1,
            storageCondition: (["Frozen", "Chilled", "Ambient"].includes(r["Storage Condition"]?.trim()) ? r["Storage Condition"].trim() : "Ambient") as SKU["storageCondition"],
            shelfLife: num(r["Shelf Life"]),
            vat: yes(r["VAT"]),
            supplier1: "",
            supplier2: "",
            leadTime: num(r["Lead Time"]),
            isDistributable: false,
          })),
        );
        return { saved, failed: rows.length - saved, note: made.length ? `สร้างหมวดใหม่ ${made.join(", ")} · ตั้งชื่อได้ที่ ตั้งค่า › หมวดสินค้า` : undefined };
      },

      suppliers: async (rows) => {
        let saved = 0;
        for (const r of rows) {
          const ok = await d.addSupplier({
            name: r["Name"].trim(),
            leadTime: num(r["Lead Time"]),
            moq: num(r["MOQ"]),
            moqUnit: r["MOQ Unit"]?.trim() || "",
            contactPerson: r["Contact Person"]?.trim() || "",
            phone: r["Phone"]?.trim() || "",
            creditTerms: r["Credit Terms"]?.trim() || "",
            status: r["Status"]?.trim() === "Inactive" ? "Inactive" : "Active",
          });
          if (ok) saved++;
        }
        return { saved, failed: rows.length - saved };
      },

      prices: async (rows) => {
        // One by one (each switches off the item's other prices), then costs once
        const done: string[] = [];
        for (const r of rows) {
          const sku = d.skus.find((s) => low(s.name) === low(r["SKU Name"]));
          const sup = d.suppliers.find((s) => low(s.name) === low(r["Supplier Name"]));
          if (!sku || !sup) continue;
          const ok = await d.addPrice(
            {
              skuId: sku.id,
              supplierId: sup.id,
              pricePerPurchaseUom: num(r["Price Per Purchase UOM"]),
              vat: yes(r["VAT"]),
              isActive: low(r["Active"]) !== "false" && r["Active"]?.trim() !== "0",
              effectiveDate: r["Effective Date"]?.trim() || toLocalDateStr(new Date()),
              note: r["Note"]?.trim() || "",
            },
            sku,
            { batch: true },
          );
          if (ok) done.push(sku.id);
        }
        if (done.length) await d.recostPrices(...done);
        return { saved: done.length, failed: rows.length - done.length };
      },

      menus: async (rows) => {
        const have = new Set(menuCats.categories.map((c) => low(c.name)));
        const made: string[] = [];
        for (const r of rows) {
          const cat = r["category"]?.trim();
          if (cat && !have.has(low(cat))) {
            await menuCats.addCategory(cat);
            have.add(low(cat));
            made.push(cat);
          }
        }
        const saved = await d.bulkAddMenus(
          rows.map((r) => ({
            menuCode: r["menu_code"].trim(),
            menuName: r["menu_name"].trim(),
            category: r["category"]?.trim() || "",
            sellingPrice: num(r["selling_price"]),
            status: low(r["status"]) === "inactive" ? "Inactive" : "Active",
            brandName: r["brand_name"].trim(),
            isMaindish: false,
          })),
        );
        return { saved, failed: rows.length - saved, note: made.length ? `สร้างหมวดเมนูใหม่ ${made.join(", ")}` : undefined };
      },

      "menu-bom": async (rows) => {
        let saved = 0;
        let failed = 0;
        for (const group of groupBy(rows, "menu_code")) {
          const menu = d.menus.find((m) => low(m.menuCode) === low(group[0]["menu_code"]));
          if (!menu) {
            failed += group.length;
            continue;
          }
          const next = group.map((r) => {
            const sku = skuByCode(r["sku_code"])!;
            const qty = num(r["qty"]);
            const yieldPct = yieldOf(r);
            const effectiveQty = yieldPct > 0 ? qty / (yieldPct / 100) : qty;
            return { skuId: sku.id, qtyPerServing: qty, uom: sku.usageUom, yieldPct, effectiveQty, costPerServing: effectiveQty * activeCost(sku.id) };
          });
          if (await d.replaceMenuRecipe(menu.id, next)) saved += group.length;
          else failed += group.length;
        }
        return { saved, failed };
      },

      "sp-bom": async (rows) => {
        let saved = 0;
        let failed = 0;
        const done: string[] = [];
        for (const group of groupBy(rows, "sp_code")) {
          const sp = skuByCode(group[0]["sp_code"]);
          if (!sp) {
            failed += group.length;
            continue;
          }
          const batchYieldQty = num(group[0]["batch_yield_qty"]) || 1;
          const next = group.map((r) => {
            const ing = skuByCode(r["sku_code"])!;
            const qty = num(r["qty"]);
            return { spSkuId: sp.id, ingredientSkuId: ing.id, qtyPerBatch: qty, uom: ing.usageUom, batchYieldQty, batchYieldUom: sp.usageUom, costPerUnit: batchYieldQty > 0 ? (qty * activeCost(ing.id)) / batchYieldQty : 0 };
          });
          if (await d.replaceSpRecipe(sp.id, next)) {
            saved += group.length;
            done.push(sp.id);
          } else failed += group.length;
        }
        // Costs worked out once for everything imported (same engine as everywhere)
        if (done.length) await d.recostPrices(...done);
        return { saved, failed };
      },
    }),
    [d, menuCats, skuByCode, activeCost],
  );
}

function groupBy(rows: FileRow[], col: string): FileRow[][] {
  const m = new Map<string, FileRow[]>();
  for (const r of rows) {
    const k = low(r[col]);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return [...m.values()];
}
