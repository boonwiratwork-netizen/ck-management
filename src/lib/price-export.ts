import * as XLSX from "xlsx";
import { Price } from "@/types/price";
import { SKU } from "@/types/sku";
import { Supplier } from "@/types/supplier";
import { toLocalDateStr } from "@/lib/utils";
import { isBomPrice, BOM_SUPPLIER_NAME } from "@/lib/bom-price-sync";

export interface ActivePriceRow {
  skuCode: string;
  skuName: string;
  type: string;
  category: string;
  supplier: string;
  packSize: number;
  packUnit: string;
  purchaseUom: string;
  pricePerPack: number | null;
  usageUom: string;
  pricePerUsageUom: number;
  vat: string;
  effectiveDate: string;
  note: string;
}

export const PRICE_EXPORT_HEADERS = [
  "SKU Code",
  "SKU Name",
  "Type",
  "Category",
  "Supplier",
  "Pack Size",
  "Pack Unit",
  "Purchase UOM",
  "Price / Pack",
  "Usage UOM",
  "Price / Usage UOM",
  "VAT",
  "Effective Date",
  "Note",
];

export function buildActivePriceRows(
  prices: Price[],
  skus: SKU[],
  suppliers: Supplier[],
): ActivePriceRow[] {
  const sMap = new Map(skus.map((s) => [s.id, s]));
  const supMap = new Map(suppliers.map((s) => [s.id, s]));

  return prices
    .filter((p) => p.isActive)
    .map((p) => {
      const sku = sMap.get(p.skuId);
      const bom = isBomPrice(p.supplierId);
      return {
        skuCode: sku?.skuId || "",
        skuName: sku?.name || "",
        type: sku?.type || "",
        category: sku?.category || "",
        supplier: bom ? BOM_SUPPLIER_NAME : supMap.get(p.supplierId)?.name || "",
        packSize: sku?.packSize ?? 0,
        packUnit: sku?.packUnit || "",
        purchaseUom: sku?.purchaseUom || "",
        pricePerPack: bom ? null : p.pricePerPurchaseUom,
        usageUom: sku?.usageUom || "",
        pricePerUsageUom: p.pricePerUsageUom,
        vat: p.vat ? "Yes" : "No",
        effectiveDate: p.effectiveDate || "",
        note: p.note || "",
      };
    })
    .sort((a, b) => a.skuCode.localeCompare(b.skuCode));
}

const toArray = (r: ActivePriceRow) => [
  r.skuCode,
  r.skuName,
  r.type,
  r.category,
  r.supplier,
  r.packSize,
  r.packUnit,
  r.purchaseUom,
  r.pricePerPack,
  r.usageUom,
  r.pricePerUsageUom,
  r.vat,
  r.effectiveDate,
  r.note,
];

export function activePricesToTsv(rows: ActivePriceRow[]): string {
  const clean = (v: unknown) =>
    v === null || v === undefined ? "" : String(v).replace(/[\t\r\n]+/g, " ");
  return [
    PRICE_EXPORT_HEADERS.join("\t"),
    ...rows.map((r) => toArray(r).map(clean).join("\t")),
  ].join("\n");
}

export function exportActivePricesXlsx(rows: ActivePriceRow[]) {
  const aoa: unknown[][] = [PRICE_EXPORT_HEADERS, ...rows.map(toArray)];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  const lastCol = PRICE_EXPORT_HEADERS.length - 1;
  const lastRow = rows.length; // header is row 0

  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } }),
  };
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  ws["!cols"] = [
    { wch: 12 }, { wch: 34 }, { wch: 6 }, { wch: 10 }, { wch: 24 },
    { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
    { wch: 16 }, { wch: 6 }, { wch: 12 }, { wch: 30 },
  ];

  for (let c = 0; c <= lastCol; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (cell) cell.s = { font: { bold: true } };
  }

  for (let r = 1; r <= lastRow; r++) {
    const packCell = ws[XLSX.utils.encode_cell({ r, c: 8 })];
    if (packCell && typeof packCell.v === "number") packCell.z = "#,##0.00";
    const usageCell = ws[XLSX.utils.encode_cell({ r, c: 10 })];
    if (usageCell && typeof usageCell.v === "number") usageCell.z = "0.0000";
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Active Prices");
  XLSX.writeFile(wb, `Active_Prices_${toLocalDateStr(new Date())}.xlsx`);
}
