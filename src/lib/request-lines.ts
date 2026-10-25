/**
 * Pure logic behind the request page (ขอเบิก / สั่งซื้อ): what each product's
 * situation is in words staff understand, how many packs to suggest, and the
 * LINE message. Kept apart from React and Supabase so it is tested.
 */

export interface StockFigures {
  stockOnHand: number;
  avgDailyUsage: number;
  rop: number;
  parstock: number;
  packSize: number;
}

/** Requested but not yet received, from requests still due (see freshPending) */
export interface Pending {
  qty: number;
  /** Earliest delivery date among those requests */
  due: string;
}

export type LineKind = "nodata" | "out" | "coming" | "low" | "ok";

export interface LineState {
  kind: LineKind;
  /** Days the stock (plus what is coming) lasts at the usual daily use; null without usage data */
  coverDays: number | null;
}

/**
 * Same thresholds as the old table: below the reorder point = ต้องสั่ง; a request
 * already on its way that lifts it back above = กำลังสั่ง.
 */
export function lineState(f: StockFigures, pendingQty = 0): LineState {
  if (f.avgDailyUsage <= 0) return { kind: "nodata", coverDays: null };
  const ropDays = f.rop / f.avgDailyUsage;
  const without = f.stockOnHand / f.avgDailyUsage;
  const withPending = (f.stockOnHand + pendingQty) / f.avgDailyUsage;
  if (f.stockOnHand <= 0 && pendingQty <= 0) return { kind: "out", coverDays: 0 };
  if (pendingQty > 0 && without < ropDays && withPending >= ropDays) return { kind: "coming", coverDays: withPending };
  if (withPending < ropDays) return { kind: f.stockOnHand <= 0 ? "out" : "low", coverDays: withPending };
  return { kind: "ok", coverDays: withPending };
}

/**
 * Packs to bring stock up to parstock. Unlike the old suggestion this takes off
 * what was already requested and is still coming, so a second request the next
 * evening doesn't order the same things again.
 */
export function suggestedPacks(f: StockFigures, pendingQty = 0): number {
  if (f.avgDailyUsage <= 0) return 0;
  const need = f.parstock - f.stockOnHand - pendingQty;
  return need > 0 ? Math.ceil(need / Math.max(1, f.packSize)) : 0;
}

/**
 * Pending lines count only while their request is still due (delivery date from
 * yesterday on). A request left "Submitted" for days would otherwise hide real
 * needs forever (TR-2026-10-013 at Shiro, 19 Oct 2026).
 */
export function freshPending(rows: { skuId: string; qty: number; requiredDate: string }[], today: string): Map<string, Pending> {
  const y = new Date(`${today}T00:00:00`);
  y.setDate(y.getDate() - 1);
  const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  const out = new Map<string, Pending>();
  for (const r of rows) {
    if (r.requiredDate < yesterday) continue;
    const p = out.get(r.skuId);
    out.set(r.skuId, { qty: (p?.qty ?? 0) + r.qty, due: p && p.due < r.requiredDate ? p.due : r.requiredDate });
  }
  return out;
}

// ── LINE message (same wording as before) ──

export interface MessageItem {
  name: string;
  packSize: number;
  uom: string;
  packs: number;
  /** "แพ็ค" for kitchen requests, the product's pack unit for supplier orders */
  packUnit: string;
}

const n0 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function lineMessage(opts: { branch: string; date: string; notes?: string; items: MessageItem[]; alwaysPacks?: boolean }): string {
  return [
    `📦 [${opts.branch}] - สั่งวัตถุดิบ`,
    `วันส่งสินค้า: ${opts.date}`,
    ...(opts.notes ? [`หมายเหตุ: ${opts.notes}`] : []),
    ``,
    `🧾 รายการ:`,
    ...opts.items.map((i) =>
      opts.alwaysPacks || i.packSize > 1 ? `- ${i.name} — ${n0(i.packSize)} ${i.uom} x ${n0(i.packs)} ${i.packUnit}` : `- ${i.name} — ${n0(i.packs * i.packSize)} ${i.uom}`,
    ),
    ``,
    `🙏 ถ้าคอนเฟิร์ม ฝากยืนยันออเดอร์ด้วยนะคะ`,
  ].join("\n");
}

/** Status of a request in words for the branch */
export const statusLabel: Record<string, { text: string; tone: "wait" | "work" | "done" | "off" }> = {
  Submitted: { text: "รอครัวกลาง", tone: "wait" },
  Acknowledged: { text: "ครัวกลางรับเรื่องแล้ว", tone: "work" },
  Fulfilled: { text: "ได้ของแล้ว", tone: "done" },
  Cancelled: { text: "ยกเลิก", tone: "off" },
  Draft: { text: "ร่าง", tone: "off" },
};
export const prStatusLabel: Record<string, { text: string; tone: "wait" | "work" | "done" | "off" }> = {
  ...statusLabel,
  Submitted: { text: "ส่งแล้ว", tone: "wait" },
  Acknowledged: { text: "ร้านรับเรื่องแล้ว", tone: "work" },
};

/** A request can be cancelled until its goods arrive */
export const canCancel = (status: string) => status === "Submitted" || status === "Acknowledged";
