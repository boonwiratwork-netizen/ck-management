import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { BranchReceipt } from "@/hooks/use-branch-receipt-data";

/**
 * The rows the Receive page writes to branch_receipts, one builder per way of
 * receiving. Branch stock, Daily Stock Count, Stock Card and Food Cost all read
 * these rows, so every builder keeps the old pages' formulas EXACTLY (see the
 * parity tests): qty is stored in usage units (packs × pack size in pack mode),
 * external suppliers store the purchase unit in `uom`, the central kitchen the
 * usage unit, and kitchen/branch transfers carry no price variance.
 */

export type ReceiptRow = Omit<BranchReceipt, "id" | "createdAt">;

export const CK_SUPPLIER_NAME = "Central Kitchen";

/** Pack mode = the SKU is counted in packs of `packSize` usage units */
export function isPacksMode(sku: Pick<SKU, "packSize" | "packUnit"> | null | undefined): boolean {
  return !!sku && (sku.packSize ?? 0) > 1 && (sku.packUnit ?? "").length > 0;
}

/** Packs typed by staff → the qty stored on the receipt */
export function qtyFromPacks(sku: Pick<SKU, "packSize" | "packUnit"> | null | undefined, packs: number): number {
  return isPacksMode(sku) ? Math.round(packs) * (sku!.packSize || 1) : packs;
}

/** Stored qty → packs to show (rounded like the old pages) */
export function packsFromQty(sku: Pick<SKU, "packSize" | "packUnit"> | null | undefined, qty: number): number {
  return isPacksMode(sku) ? Math.round(qty / (sku!.packSize || 1)) : qty;
}

/** Standard price per usage unit: this supplier's active price first, else any active price */
export function stdUnitPriceFor(prices: Price[], skuId: string, supplierId?: string | null): number {
  if (supplierId) {
    const own = prices.find((p) => p.skuId === skuId && p.supplierId === supplierId && p.isActive);
    if (own) return own.pricePerUsageUom || 0;
  }
  return prices.find((p) => p.skuId === skuId && p.isActive)?.pricePerUsageUom || 0;
}

interface Base {
  branchId: string;
  receiptDate: string;
}

/**
 * External supplier (also used for purchase-request receiving). Price can come
 * three ways, matching the old pages: an invoice price per pack (phone page), a
 * typed line total (computer page), or nothing → priced at standard, no variance.
 */
export function supplierRow(
  base: Base & {
    supplierName: string;
    sku: Pick<SKU, "id" | "purchaseUom" | "packSize">;
    qty: number;
    stdUnitPrice: number;
    /** Invoice price per pack, ex-VAT; 0 = not given */
    invoicePrice?: number;
    /** Line total typed by staff; undefined = not given */
    lineTotal?: number;
    note?: string;
  },
): ReceiptRow {
  const { qty, stdUnitPrice } = base;
  const stdTotal = qty * stdUnitPrice;
  let actualUnitPrice: number;
  let actualTotal: number;
  if ((base.invoicePrice ?? 0) > 0) {
    actualUnitPrice = base.invoicePrice! / Math.max(1, base.sku.packSize || 1);
    actualTotal = qty * actualUnitPrice;
  } else if (base.lineTotal !== undefined) {
    actualTotal = base.lineTotal;
    actualUnitPrice = qty > 0 ? actualTotal / qty : 0;
  } else {
    actualUnitPrice = stdUnitPrice;
    actualTotal = stdTotal;
  }
  return {
    branchId: base.branchId,
    receiptDate: base.receiptDate,
    skuId: base.sku.id,
    supplierName: base.supplierName,
    qtyReceived: qty,
    uom: base.sku.purchaseUom || "",
    actualUnitPrice,
    actualTotal,
    stdUnitPrice,
    stdTotal,
    priceVariance: actualTotal - stdTotal,
    notes: base.note ?? "",
    transferOrderId: null,
  };
}

/** A line of a central-kitchen transfer order, priced at the order's unit cost */
export function transferOrderRow(
  base: Base & { sku: Pick<SKU, "id" | "usageUom"> | undefined; skuId: string; lineUom: string; qty: number; unitCost: number; note: string; transferOrderId: string },
): ReceiptRow {
  const stdTotal = base.qty * base.unitCost;
  return {
    branchId: base.branchId,
    receiptDate: base.receiptDate,
    skuId: base.skuId,
    supplierName: CK_SUPPLIER_NAME,
    qtyReceived: base.qty,
    uom: base.sku?.usageUom || base.lineUom || "น.",
    actualUnitPrice: base.unitCost,
    actualTotal: stdTotal,
    stdUnitPrice: base.unitCost,
    stdTotal,
    priceVariance: 0,
    notes: base.note,
    transferOrderId: base.transferOrderId,
  };
}

/** Kitchen goods that came without a transfer order */
export function kitchenAdHocRow(base: Base & { sku: Pick<SKU, "id" | "usageUom">; qty: number; stdUnitPrice: number; note: string }): ReceiptRow {
  const stdTotal = base.qty * base.stdUnitPrice;
  return {
    branchId: base.branchId,
    receiptDate: base.receiptDate,
    skuId: base.sku.id,
    supplierName: CK_SUPPLIER_NAME,
    qtyReceived: base.qty,
    uom: base.sku.usageUom || "น.",
    actualUnitPrice: base.stdUnitPrice,
    actualTotal: stdTotal,
    stdUnitPrice: base.stdUnitPrice,
    stdTotal,
    priceVariance: 0,
    notes: base.note || "",
    transferOrderId: null,
  };
}

/** Goods moved in from another branch, priced at standard */
export function branchTransferRow(
  base: Base & { fromBranchName: string; sku: Pick<SKU, "id" | "usageUom">; qty: number; stdUnitPrice: number; note: string },
): ReceiptRow {
  const stdTotal = base.qty * base.stdUnitPrice;
  return {
    branchId: base.branchId,
    receiptDate: base.receiptDate,
    skuId: base.sku.id,
    supplierName: `รับจากสาขา · ${base.fromBranchName}`,
    qtyReceived: base.qty,
    uom: base.sku.usageUom || "",
    actualUnitPrice: base.stdUnitPrice,
    actualTotal: stdTotal,
    stdUnitPrice: base.stdUnitPrice,
    stdTotal,
    priceVariance: 0,
    notes: base.note,
    transferOrderId: null,
  };
}

/**
 * Transfer order status after receiving, compared with each line's PLANNED qty:
 * every line at or above → Received; anything received but not all → Partially
 * Received; nothing received → stays Sent. (The old page only counted a SHORT line
 * with something received as partial, so "line A in full, line B none" stayed
 * Sent — still waiting — and could be received a second time, doubling stock.)
 */
export function transferOrderStatusAfter(lines: { id: string; plannedQty: number }[], receivedByLine: Map<string, number>): "Received" | "Partially Received" | "Sent" {
  let allReceived = true;
  let anyReceived = false;
  for (const line of lines) {
    const received = receivedByLine.get(line.id) || 0;
    if (received > 0) anyReceived = true;
    if (received < line.plannedQty) allReceived = false;
  }
  return allReceived ? "Received" : anyReceived ? "Partially Received" : "Sent";
}
