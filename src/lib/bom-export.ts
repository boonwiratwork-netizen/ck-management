import * as XLSX from "xlsx";
import { SKU } from "@/types/sku";
import { Price } from "@/types/price";
import { Menu } from "@/types/menu";
import { Branch } from "@/types/branch";
import { MenuBomLine } from "@/types/menu-bom";
import { SpBomLine } from "@/types/sp-bom";
import { BOMHeader, BOMLine, BOMStep } from "@/types/bom";
import { toLocalDateStr } from "@/lib/utils";

const round = (n: number, dp = 4) => {
  if (!isFinite(n)) return 0;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
};

const activeCost = (prices: Price[], skuId: string): number => {
  const p = prices.find((x) => x.skuId === skuId && x.isActive);
  return p?.pricePerUsageUom ?? 0;
};

const skuMap = (skus: SKU[]) => {
  const byId = new Map<string, SKU>();
  skus.forEach((s) => byId.set(s.id, s));
  return byId;
};

function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}

function buildMenuBomSheet(
  lines: MenuBomLine[],
  menus: Menu[],
  skus: SKU[],
  prices: Price[],
  branches: Branch[],
): XLSX.WorkSheet {
  const sMap = skuMap(skus);
  const mMap = new Map(menus.map((m) => [m.id, m]));
  const bMap = new Map(branches.map((b) => [b.id, b]));

  const rows = lines
    .map((l) => {
      const menu = mMap.get(l.menuId);
      const sku = sMap.get(l.skuId);
      const yieldPct = l.yieldPct ?? 100;
      const effQty = yieldPct > 0 ? l.qtyPerServing / (yieldPct / 100) : l.qtyPerServing;
      const cost = activeCost(prices, l.skuId);
      const lineCost = effQty * cost;
      const branchName = l.branchId ? bMap.get(l.branchId)?.branchName ?? "All" : "All";
      return {
        "Menu Code": menu?.menuCode ?? "",
        "Menu Name": menu?.menuName ?? "",
        Brand: menu?.brandName ?? "",
        Category: menu?.category ?? "",
        "SKU Code": sku?.skuId ?? "",
        "SKU Name": sku?.name ?? "",
        "SKU Type": sku?.type ?? "",
        "Qty/Serving": round(l.qtyPerServing),
        UOM: l.uom ?? sku?.usageUom ?? "",
        "Yield %": round(yieldPct, 2),
        "Eff. Qty": round(effQty),
        "Cost/Unit (฿)": round(cost),
        "Line Cost (฿)": round(lineCost, 2),
        Branch: branchName,
      };
    })
    .sort((a, b) => {
      const c = (a["Menu Code"] as string).localeCompare(b["Menu Code"] as string);
      if (c !== 0) return c;
      return (a["SKU Code"] as string).localeCompare(b["SKU Code"] as string);
    });
  return XLSX.utils.json_to_sheet(rows);
}

function buildSpBomSheet(lines: SpBomLine[], skus: SKU[], prices: Price[]): XLSX.WorkSheet {
  const sMap = skuMap(skus);

  // group by spSkuId for batch yield
  const rows = lines
    .map((l) => {
      const sp = sMap.get(l.spSkuId);
      const rm = sMap.get(l.ingredientSkuId);
      const cost = activeCost(prices, l.ingredientSkuId);
      const effQty = l.qtyPerBatch;
      const lineCost = l.qtyPerBatch * cost;
      const batchYieldQty = l.batchYieldQty || 0;
      const costPerUnitOutput = batchYieldQty > 0 ? lineCost / batchYieldQty : 0;
      return {
        "SP Code": sp?.skuId ?? "",
        "SP Name": sp?.name ?? "",
        "RM Code": rm?.skuId ?? "",
        "RM Name": rm?.name ?? "",
        "Qty/Batch": round(l.qtyPerBatch),
        UOM: l.uom ?? rm?.usageUom ?? "",
        "Eff. Qty": round(effQty),
        "Cost/Unit (฿)": round(cost),
        "Line Cost (฿)": round(lineCost, 2),
        "Batch Yield Qty": round(batchYieldQty),
        "Batch Yield UOM": l.batchYieldUom ?? "",
        "Cost/Unit Output (฿)": round(costPerUnitOutput),
      };
    })
    .sort((a, b) => (a["SP Code"] as string).localeCompare(b["SP Code"] as string));
  return XLSX.utils.json_to_sheet(rows);
}

function computeSmBomCost(
  header: BOMHeader,
  lines: BOMLine[],
  steps: BOMStep[],
  prices: Price[],
): { totalCost: number; output: number; costPerG: number } {
  const calcEff = (q: number, yp: number) => (yp > 0 ? q / (yp / 100) : q);
  if (header.bomMode === "simple") {
    const output = header.batchSize * header.yieldPercent;
    const cost = lines.reduce((s, l) => {
      const yp = Math.round((l.yieldPercent ?? 1.0) * 100);
      return s + calcEff(l.qtyPerBatch, yp) * activeCost(prices, l.rmSkuId);
    }, 0);
    return { totalCost: cost, output, costPerG: output > 0 ? cost / output : 0 };
  } else {
    let totalCost = 0;
    let prevOutput = 0;
    const sortedSteps = [...steps].sort((a, b) => a.stepNumber - b.stepNumber);
    sortedSteps.forEach((step, idx) => {
      const sLines = lines.filter((l) => l.stepId === step.id);
      const inputQty =
        idx === 0
          ? sLines.reduce((s, l) => s + (l.qtyType === "percent" ? 0 : l.qtyPerBatch), 0)
          : prevOutput;
      const ingredientQty = sLines.reduce((s, l) => {
        if (l.qtyType === "percent" && l.percentOfInput) return s + l.percentOfInput * inputQty;
        return s + l.qtyPerBatch;
      }, 0);
      const effInput = idx === 0 ? ingredientQty : inputQty + ingredientQty;
      prevOutput = effInput * step.yieldPercent;
      totalCost += sLines.reduce((s, l) => {
        let q = l.qtyPerBatch;
        if (l.qtyType === "percent" && l.percentOfInput) q = l.percentOfInput * inputQty;
        return s + q * activeCost(prices, l.rmSkuId);
      }, 0);
    });
    return { totalCost, output: prevOutput, costPerG: prevOutput > 0 ? totalCost / prevOutput : 0 };
  }
}

function buildSmBomSheet(
  headers: BOMHeader[],
  lines: BOMLine[],
  steps: BOMStep[],
  skus: SKU[],
  prices: Price[],
): XLSX.WorkSheet {
  const sMap = skuMap(skus);
  const stepMap = new Map(steps.map((s) => [s.id, s]));

  type Row = Record<string, string | number>;
  const rows: Row[] = [];

  headers.forEach((h) => {
    const sm = sMap.get(h.smSkuId);
    const hLines = lines.filter((l) => l.bomHeaderId === h.id);
    const hSteps = steps.filter((s) => s.bomHeaderId === h.id);
    const { totalCost, output, costPerG } = computeSmBomCost(h, hLines, hSteps, prices);

    hLines.forEach((l) => {
      const ing = sMap.get(l.rmSkuId);
      const yieldPct = Math.round((l.yieldPercent ?? 1.0) * 100);
      const effQty = yieldPct > 0 ? l.qtyPerBatch / (yieldPct / 100) : l.qtyPerBatch;
      const cost = activeCost(prices, l.rmSkuId);
      const lineCost = effQty * cost;
      const step = l.stepId ? stepMap.get(l.stepId) : undefined;
      rows.push({
        "SM Code": sm?.skuId ?? "",
        "SM Name": sm?.name ?? "",
        "Production Type": h.productionType,
        "BOM Mode": h.bomMode,
        "Batch Size": round(h.batchSize),
        "Output (g)": round(output),
        "Cost/Batch (฿)": round(totalCost, 2),
        "Cost/g (฿)": round(costPerG),
        "Step #": h.bomMode === "simple" ? "–" : step?.stepNumber ?? "–",
        "Step Name": h.bomMode === "simple" ? "–" : step?.stepName ?? "–",
        "Ingredient Code": ing?.skuId ?? "",
        "Ingredient Name": ing?.name ?? "",
        "Ingredient Type": ing?.type ?? "",
        Qty: round(l.qtyPerBatch),
        UOM: ing?.usageUom ?? "",
        "Yield %": yieldPct,
        "Eff. Qty": round(effQty),
        "Cost/Unit (฿)": round(cost),
        "Line Cost (฿)": round(lineCost, 2),
      });
    });
  });

  rows.sort((a, b) => {
    const c = (a["SM Code"] as string).localeCompare(b["SM Code"] as string);
    if (c !== 0) return c;
    const sa = a["Step #"] === "–" ? 0 : Number(a["Step #"]);
    const sb = b["Step #"] === "–" ? 0 : Number(b["Step #"]);
    return sa - sb;
  });
  return XLSX.utils.json_to_sheet(rows);
}

export function exportMenuBom(
  lines: MenuBomLine[],
  menus: Menu[],
  skus: SKU[],
  prices: Price[],
  branches: Branch[],
) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildMenuBomSheet(lines, menus, skus, prices, branches), "Menu BOM");
  downloadWorkbook(wb, `MenuBOM_${toLocalDateStr(new Date())}.xlsx`);
}

export function exportSpBom(lines: SpBomLine[], skus: SKU[], prices: Price[]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSpBomSheet(lines, skus, prices), "SP BOM");
  downloadWorkbook(wb, `SpBOM_${toLocalDateStr(new Date())}.xlsx`);
}

export function exportSmBom(
  headers: BOMHeader[],
  lines: BOMLine[],
  steps: BOMStep[],
  skus: SKU[],
  prices: Price[],
) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSmBomSheet(headers, lines, steps, skus, prices), "SM BOM");
  downloadWorkbook(wb, `SmBOM_${toLocalDateStr(new Date())}.xlsx`);
}

export function exportAllBoms(params: {
  bomHeaders: BOMHeader[];
  bomLines: BOMLine[];
  bomSteps: BOMStep[];
  menuBomLines: MenuBomLine[];
  spBomLines: SpBomLine[];
  skus: SKU[];
  prices: Price[];
  menus: Menu[];
  branches: Branch[];
}) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    buildMenuBomSheet(params.menuBomLines, params.menus, params.skus, params.prices, params.branches),
    "Menu BOM",
  );
  XLSX.utils.book_append_sheet(wb, buildSpBomSheet(params.spBomLines, params.skus, params.prices), "SP BOM");
  XLSX.utils.book_append_sheet(
    wb,
    buildSmBomSheet(params.bomHeaders, params.bomLines, params.bomSteps, params.skus, params.prices),
    "SM BOM",
  );
  downloadWorkbook(wb, `BOM_Export_${toLocalDateStr(new Date())}.xlsx`);
}
