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

// ---------- Summary sheet ----------

type Cell = string | number | null;
const BOLD = { font: { bold: true } } as const;

function menuSummaryRows(
  lines: MenuBomLine[],
  menus: Menu[],
  prices: Price[],
): Cell[][] {
  const mMap = new Map(menus.map((m) => [m.id, m]));
  const groups = new Map<string, MenuBomLine[]>();
  lines.forEach((l) => {
    const arr = groups.get(l.menuId) ?? [];
    arr.push(l);
    groups.set(l.menuId, arr);
  });

  const data: Cell[][] = [];
  const items: { code: string; name: string; brand: string; cat: string; n: number; total: number }[] = [];
  groups.forEach((gLines, menuId) => {
    const m = mMap.get(menuId);
    if (!m || gLines.length === 0) return;
    const total = gLines.reduce((s, l) => {
      const yp = l.yieldPct ?? 100;
      const eff = yp > 0 ? l.qtyPerServing / (yp / 100) : l.qtyPerServing;
      return s + eff * activeCost(prices, l.skuId);
    }, 0);
    items.push({
      code: m.menuCode ?? "",
      name: m.menuName ?? "",
      brand: m.brandName ?? "",
      cat: m.category ?? "",
      n: gLines.length,
      total,
    });
  });
  items.sort((a, b) => a.code.localeCompare(b.code));
  items.forEach((it) =>
    data.push([it.code, it.name, it.brand, it.cat, it.n, round(it.total, 2)]),
  );
  return data;
}

function spSummaryRows(lines: SpBomLine[], skus: SKU[], prices: Price[]): Cell[][] {
  const sMap = skuMap(skus);
  const groups = new Map<string, SpBomLine[]>();
  lines.forEach((l) => {
    const arr = groups.get(l.spSkuId) ?? [];
    arr.push(l);
    groups.set(l.spSkuId, arr);
  });

  const items: {
    code: string;
    name: string;
    n: number;
    yQty: number;
    yUom: string;
    total: number;
    perUnit: number;
  }[] = [];
  groups.forEach((gLines, spId) => {
    if (gLines.length === 0) return;
    const sp = sMap.get(spId);
    const first = gLines[0];
    const total = gLines.reduce((s, l) => s + l.qtyPerBatch * activeCost(prices, l.ingredientSkuId), 0);
    const yQty = first.batchYieldQty || 0;
    items.push({
      code: sp?.skuId ?? "",
      name: sp?.name ?? "",
      n: gLines.length,
      yQty,
      yUom: first.batchYieldUom ?? "",
      total,
      perUnit: yQty > 0 ? total / yQty : 0,
    });
  });
  items.sort((a, b) => a.code.localeCompare(b.code));
  return items.map((it) => [
    it.code,
    it.name,
    it.n,
    round(it.yQty),
    it.yUom,
    round(it.total, 2),
    round(it.perUnit, 4),
  ]);
}

function smSummaryRows(
  headers: BOMHeader[],
  lines: BOMLine[],
  steps: BOMStep[],
  skus: SKU[],
  prices: Price[],
): Cell[][] {
  const sMap = skuMap(skus);
  const items: {
    code: string;
    name: string;
    pType: string;
    mode: string;
    output: number;
    total: number;
    costPerG: number;
  }[] = [];

  headers.forEach((h) => {
    const sm = sMap.get(h.smSkuId);
    const hLines = lines.filter((l) => l.bomHeaderId === h.id);

    let output = 0;
    if (h.bomMode === "simple") {
      output = h.batchSize * h.yieldPercent;
    } else {
      const hSteps = [...steps.filter((s) => s.bomHeaderId === h.id)].sort(
        (a, b) => a.stepNumber - b.stepNumber,
      );
      let prev = 0;
      hSteps.forEach((step, idx) => {
        const sLines = hLines.filter((l) => l.stepId === step.id);
        const inputQty =
          idx === 0
            ? sLines.reduce((s, l) => s + (l.qtyType === "percent" ? 0 : l.qtyPerBatch), 0)
            : prev;
        const ingredientQty = sLines.reduce((s, l) => {
          if (l.qtyType === "percent" && l.percentOfInput) return s + l.percentOfInput * inputQty;
          return s + l.qtyPerBatch;
        }, 0);
        const effInput = idx === 0 ? ingredientQty : inputQty + ingredientQty;
        prev = effInput * step.yieldPercent;
      });
      output = prev;
    }

    const total = hLines.reduce((s, l) => {
      const ypRound = Math.round((l.yieldPercent ?? 1.0) * 100) / 100;
      const eff = ypRound > 0 ? l.qtyPerBatch / ypRound : l.qtyPerBatch;
      return s + eff * activeCost(prices, l.rmSkuId);
    }, 0);

    items.push({
      code: sm?.skuId ?? "",
      name: sm?.name ?? "",
      pType: h.productionType,
      mode: h.bomMode,
      output,
      total,
      costPerG: output > 0 ? total / output : 0,
    });
  });
  items.sort((a, b) => a.code.localeCompare(b.code));
  return items.map((it) => [
    it.code,
    it.name,
    it.pType,
    it.mode,
    round(it.output),
    round(it.total, 2),
    round(it.costPerG, 4),
  ]);
}

interface SummaryParts {
  menu?: { lines: MenuBomLine[]; menus: Menu[] };
  sp?: { lines: SpBomLine[] };
  sm?: { headers: BOMHeader[]; lines: BOMLine[]; steps: BOMStep[] };
  skus: SKU[];
  prices: Price[];
}

function buildSummarySheet(parts: SummaryParts): XLSX.WorkSheet {
  const aoa: Cell[][] = [];
  const boldRows: number[] = [];

  const pushSection = (title: string, headers: string[], rows: Cell[][]) => {
    if (aoa.length > 0) aoa.push([]);
    boldRows.push(aoa.length);
    aoa.push([title]);
    boldRows.push(aoa.length);
    aoa.push(headers);
    rows.forEach((r) => aoa.push(r));
  };

  if (parts.menu) {
    pushSection(
      "MENU BOM SUMMARY",
      ["Menu Code", "Menu Name", "Brand", "Category", "# Ingredients", "Total Cost/Serving (฿)"],
      menuSummaryRows(parts.menu.lines, parts.menu.menus, parts.prices),
    );
  }
  if (parts.sp) {
    pushSection(
      "SP BOM SUMMARY",
      [
        "SP Code",
        "SP Name",
        "# Ingredients",
        "Batch Yield Qty",
        "Batch Yield UOM",
        "Total Cost/Batch (฿)",
        "Cost/Unit (฿)",
      ],
      spSummaryRows(parts.sp.lines, parts.skus, parts.prices),
    );
  }
  if (parts.sm) {
    pushSection(
      "SM BOM SUMMARY",
      ["SM Code", "SM Name", "Production Type", "BOM Mode", "Output (g)", "Total Cost/Batch (฿)", "Cost/g (฿)"],
      smSummaryRows(parts.sm.headers, parts.sm.lines, parts.sm.steps, parts.skus, parts.prices),
    );
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  boldRows.forEach((r) => {
    const rowCells = aoa[r] ?? [];
    for (let c = 0; c < rowCells.length; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = ws[ref];
      if (cell) cell.s = BOLD;
    }
  });
  return ws;
}

export function exportMenuBom(
  lines: MenuBomLine[],
  menus: Menu[],
  skus: SKU[],
  prices: Price[],
  branches: Branch[],
) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    buildSummarySheet({ menu: { lines, menus }, skus, prices }),
    "Summary",
  );
  XLSX.utils.book_append_sheet(wb, buildMenuBomSheet(lines, menus, skus, prices, branches), "Menu BOM");
  downloadWorkbook(wb, `MenuBOM_${toLocalDateStr(new Date())}.xlsx`);
}

export function exportSpBom(lines: SpBomLine[], skus: SKU[], prices: Price[]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSummarySheet({ sp: { lines }, skus, prices }), "Summary");
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
  XLSX.utils.book_append_sheet(
    wb,
    buildSummarySheet({ sm: { headers, lines, steps }, skus, prices }),
    "Summary",
  );
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
    buildSummarySheet({
      menu: { lines: params.menuBomLines, menus: params.menus },
      sp: { lines: params.spBomLines },
      sm: { headers: params.bomHeaders, lines: params.bomLines, steps: params.bomSteps },
      skus: params.skus,
      prices: params.prices,
    }),
    "Summary",
  );
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
