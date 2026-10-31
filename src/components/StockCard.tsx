import { fetchAllRows } from "@/lib/fetch-all";
import { useEffect, useState } from "react";
import { addSaleUsage, buildUsageContext } from "@/lib/sale-usage";

import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, AlertTriangle, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { TO_DELIVERED_STATUSES, computeToLineQty } from "@/lib/to-line-qty";
import type { SKU } from "@/types/sku";
import { afterCount, producedAfterCount, type CountAnchor } from "@/lib/count-anchor";

type LedgerCount = CountAnchor & { completed_at: string };

/**
 * Where a count row sits among the movements of its own day, matching the stock
 * pages (count-anchor.ts): "before" = ahead of all of them, otherwise after them.
 */
const countSortKey = (c: LedgerCount) => (c.timing === "before" ? `${c.count_date}|0|` : `${c.count_date}|2|${c.completed_at}`);

interface StockCardProps {
  skuId: string;
  skuType: "RM" | "SM" | "PK";
  sku: SKU;
  skus: SKU[];
  currentStock: number;
  stockValue: number;
  onClose: () => void;
  disableMismatchCheck?: boolean;
  context?: "ck" | "branch";
  branchId?: string;
}

interface Movement {
  date: string;
  sortKey: string;
  type: "Opening" | "Receipt" | "Production" | "Delivery" | "Adjustment" | "StockCount";
  reference: string;
  qtyIn: number | null;
  qtyOut: number | null;
  runningBalance?: number;
  isProductionUse?: boolean;
  lotText?: string;
  timestamp?: string;
  isReset?: boolean;
  /** Shown tag: what kind of movement this is, in words the kitchen uses */
  tag?: Tag;
}

type Tag = "ยกมา" | "รับเข้า" | "ผลิต" | "ผลพลอยได้" | "ใช้ผลิต" | "ส่งสาขา" | "ปรับยอด" | "นับ";
const TAG_STYLE: Record<Tag, string> = {
  ยกมา: "bg-secondary text-muted-foreground",
  รับเข้า: "bg-success-soft text-success",
  ผลิต: "bg-success-soft text-success",
  ผลพลอยได้: "bg-brand-soft text-brand-soft-foreground",
  ใช้ผลิต: "bg-warning-soft text-warning",
  ส่งสาขา: "bg-secondary text-foreground",
  ปรับยอด: "bg-secondary text-foreground",
  นับ: "bg-foreground text-background",
};
const tagOf = (m: Movement): Tag =>
  m.tag ?? (m.type === "Opening" ? "ยกมา" : m.type === "Receipt" ? "รับเข้า" : m.type === "Production" ? "ผลิต" : m.type === "Delivery" ? "ส่งสาขา" : m.type === "StockCount" ? "นับ" : "ปรับยอด");
const STORAGE_TH: Record<string, string> = { Frozen: "แช่แข็ง", Chilled: "แช่เย็น", Ambient: "ของแห้ง" };
const thaiDate = (iso: string) => {
  if (!iso || iso === "—") return "";
  const d = new Date(iso);
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
};
const thaiTime = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "");

interface BranchCountRow {
  count_date: string;
  opening_balance: number;
  received_from_ck: number;
  received_external: number;
  expected_usage: number;
  waste: number;
  calculated_balance: number;
  physical_count: number | null;
  variance: number;
}

const fmt0 = (v: number) => Math.round(v).toLocaleString();

function classifyAdjustment(quantity: number, reason: string, skus: SKU[]): Movement {
  const base = { date: "", sortKey: "", qtyIn: null as number | null, qtyOut: null as number | null };

  if (reason.startsWith("Production:")) {
    // "Production: 0.73 batches of <sku id> [rec <record id>]" (share of a batch, tagged since Oct 2026)
    const match = reason.match(/Production:\s*([\d.]+)\s*batches?\s*of\s+([^\s[]+)/i);
    let ref = "ใช้ในการผลิต";
    if (match) {
      const batches = match[1];
      const uuidOrCode = match[2].trim();
      const found = skus.find((s) => s.id === uuidOrCode || s.skuId === uuidOrCode);
      ref = `ผลิต ${found ? found.name : uuidOrCode} ${Number(batches).toLocaleString("th-TH", { maximumFractionDigits: 2 })} รอบ`;
    }
    return {
      ...base,
      type: "Adjustment",
      reference: ref,
      qtyIn: null,
      qtyOut: Math.abs(quantity),
      isProductionUse: true,
      tag: "ใช้ผลิต",
    };
  }

  // Made in the same pot as another item (น้ำมันไก่ from น้ำสต๊อก), or a production record changed
  if (reason.startsWith("Production by-product") || reason.startsWith("Production correction")) {
    const bp = reason.startsWith("Production by-product");
    const code = reason.match(/of\s+([^\s[]+)/i)?.[1];
    const parent = code ? skus.find((s) => s.id === code || s.skuId === code) : undefined;
    return {
      ...base,
      type: "Adjustment",
      tag: bp ? "ผลพลอยได้" : "ปรับยอด",
      reference: bp ? (reason.includes("correction") ? "แก้บันทึกผลิต (ผลพลอยได้)" : `ได้จากการผลิต${parent ? ` ${parent.name}` : ""}`) : "แก้บันทึกผลิต",
      qtyIn: quantity > 0 ? quantity : null,
      qtyOut: quantity < 0 ? Math.abs(quantity) : null,
    };
  }

  if (reason.toLowerCase().includes("stock count")) {
    return {
      ...base,
      type: "StockCount",
      reference: "นับสต๊อก",
      qtyIn: quantity > 0 ? quantity : null,
      qtyOut: quantity < 0 ? Math.abs(quantity) : null,
    };
  }

  return {
    ...base,
    type: "Adjustment",
    reference: reason || "ปรับยอดเอง",
    qtyIn: quantity > 0 ? quantity : null,
    qtyOut: quantity < 0 ? Math.abs(quantity) : null,
  };
}

export function StockCard({
  skuId,
  skuType,
  sku,
  skus,
  currentStock,
  stockValue,
  onClose,
  disableMismatchCheck,
  context = "ck",
  branchId,
}: StockCardProps) {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [branchRows, setBranchRows] = useState<BranchCountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [smAnchorDate, setSmAnchorDate] = useState<string | null>(null);
  const [daysBack, setDaysBack] = useState(14);
  const [adjByDate, setAdjByDate] = useState<Map<string, { quantity: number; reason: string; createdAt: string }[]>>(
    new Map(),
  );

  useEffect(() => {
    let cancelled = false;

    // Calculate fromDate for CK context date filtering
    const fromD = new Date();
    fromD.setDate(fromD.getDate() - daysBack);
    const fromDate = fromD.toISOString().slice(0, 10);

    async function fetch() {
      setLoading(true);

      setAdjByDate(new Map());
      try {
        if (context === "branch") {
          // Branch context: reconstruct day-by-day ledger from raw transactions

          // Step 1 — Find the display window, then look up the most recent physical
          // count anchor before it (mirrors the CK-side preWindowCount pattern). Without
          // this, the ledger always started prevBalance at 0 regardless of real prior
          // stock, silently corrupting the calculated_balance/variance columns for any
          // branch/SKU with history before the selected window.
          const resolvedStartDate = fromDate;
          const { data: anchorRows } = await supabase
            .from("daily_stock_counts")
            .select("count_date, physical_count")
            .eq("branch_id", branchId!)
            .eq("sku_id", skuId)
            .not("physical_count", "is", null)
            .lt("count_date", resolvedStartDate)
            .order("count_date", { ascending: false })
            .limit(1);
          if (cancelled) return;
          const anchor = anchorRows && anchorRows.length > 0 ? anchorRows[0] : null;
          // Fetch from the anchor date forward (not just the display window) so the
          // day-by-day loop below can walk through the anchor day itself — which
          // correctly snaps prevBalance to the anchor's physical_count — plus any gap
          // days between the anchor and the display window, before reaching the rows
          // that actually get shown.
          const effectiveStartDate = anchor ? anchor.count_date : resolvedStartDate;

          // Step 2 — Fetch all data in parallel
          const [dscRes, brRes, salesRes, mbRes, menusRes, spRes, mrRes, ruleMenusRes, skusRes, adjStockRes] =
            await Promise.all([
              supabase
                .from("daily_stock_counts")
                .select(
                  "count_date, opening_balance, received_from_ck, received_external, expected_usage, waste, calculated_balance, physical_count, variance, is_submitted",
                )
                .eq("branch_id", branchId!)
                .eq("sku_id", skuId)
                .gte("count_date", effectiveStartDate)
                .order("count_date", { ascending: true }),
              supabase
                .from("branch_receipts")
                .select("receipt_date, qty_received, transfer_order_id, sku_id")
                .eq("branch_id", branchId!)
                .eq("sku_id", skuId)
                .gte("receipt_date", effectiveStartDate)
                .order("receipt_date", { ascending: true }),
              fetchAllRows((a, b) =>
                supabase
                  .from("sales_entries")
                  .select("sale_date, menu_code, menu_name, qty")
                  .eq("branch_id", branchId!)
                  .gte("sale_date", effectiveStartDate)
                  .order("sale_date", { ascending: true })
                  .order("id")
                  .range(a, b),
              ),
              fetchAllRows((a, b) =>
                supabase
                  .from("menu_bom")
                  .select("menu_id, sku_id, effective_qty")
                  .or(`branch_id.is.null,branch_id.eq.${branchId}`)
                  .order("id")
                  .range(a, b),
              ),
              supabase.from("menus").select("id, menu_code"),
              supabase.from("sp_bom").select("sp_sku_id, ingredient_sku_id, qty_per_batch, batch_yield_qty"),
              supabase.from("menu_modifier_rules").select("*").eq("is_active", true),
              supabase.from("modifier_rule_menus").select("rule_id, menu_id"),
              supabase.from("skus").select("id, type"),
              supabase
                .from("stock_adjustments")
                .select("adjustment_date, quantity, reason, created_at")
                .eq("branch_id", branchId!)
                .eq("sku_id", skuId)
                .gte("adjustment_date", effectiveStartDate)
                .order("adjustment_date", { ascending: true })
                .order("created_at", { ascending: true }),
            ]);
          if (cancelled) return;

          const receipts = brRes.data ?? [];
          const sales = salesRes.data ?? [];
          const menuBomLines = mbRes.data ?? [];
          const menus = menusRes.data ?? [];
          const spBomLines = spRes.data ?? [];
          const modRules = mrRes.data ?? [];
          const ruleMenus = ruleMenusRes.data ?? [];
          const allSkus = skusRes.data ?? [];
          const dscRows = dscRes.data ?? [];
          const adjMap = new Map<string, { quantity: number; reason: string; createdAt: string }[]>();
          for (const a of adjStockRes.data ?? []) {
            const arr = adjMap.get(a.adjustment_date) ?? [];
            arr.push({ quantity: Number(a.quantity), reason: a.reason ?? "", createdAt: a.created_at });
            adjMap.set(a.adjustment_date, arr);
          }
          setAdjByDate(adjMap);

          // Step 3 — Daily usage of this SKU from sales, through the one usage engine
          // (sale-usage.ts, same as the count sheet and Food Cost). Recipe lines were
          // already narrowed to this branch by the query.
          const menusByRule = new Map<string, string[]>();
          for (const rm of ruleMenus as { rule_id: string; menu_id: string }[]) menusByRule.set(rm.rule_id, [...(menusByRule.get(rm.rule_id) ?? []), rm.menu_id]);
          const ctx = buildUsageContext({
            menus: (menus as { id: string; menu_code: string }[]).map((m) => ({ id: m.id, menuCode: m.menu_code })),
            bomLines: (menuBomLines as { menu_id: string; sku_id: string; effective_qty: number }[]).map((l) => ({ menuId: l.menu_id, skuId: l.sku_id, effectiveQty: Number(l.effective_qty) || 0, branchId: null })),
            rules: (modRules as { id: string; rule_type: string; keyword: string; sku_id: string | null; swap_sku_id: string | null; submenu_id: string | null; qty_per_match: number; is_active: boolean; branch_ids: string[] | null }[]).map((r) => ({
              id: r.id,
              ruleType: r.rule_type,
              keyword: r.keyword,
              skuId: r.sku_id || null,
              swapSkuId: r.swap_sku_id,
              submenuId: r.submenu_id,
              qtyPerMatch: Number(r.qty_per_match) || 0,
              isActive: r.is_active,
              branchIds: r.branch_ids ?? [],
              menuIds: menusByRule.get(r.id) ?? [],
            })),
            spLines: (spBomLines as { sp_sku_id: string; ingredient_sku_id: string; qty_per_batch: number; batch_yield_qty: number }[]).map((l) => ({ spSkuId: l.sp_sku_id, ingredientSkuId: l.ingredient_sku_id, qtyPerBatch: Number(l.qty_per_batch) || 0, batchYieldQty: Number(l.batch_yield_qty) || 1 })),
            skus: allSkus as { id: string; type: string }[],
          });
          const usageByDate = new Map<string, number>();
          for (const sale of sales as { sale_date: string; menu_code: string; menu_name: string | null; qty: number }[]) {
            addSaleUsage(ctx, { ...sale, branch_id: branchId ?? null }, (id, q) => {
              if (id === skuId) usageByDate.set(sale.sale_date, (usageByDate.get(sale.sale_date) ?? 0) + q);
            });
          }
          for (const [date, q] of usageByDate) if (!(q > 0)) usageByDate.delete(date);

          // Step 4 — Calculate daily receipts per day
          const converter = sku.converter ?? 1;
          const receiptsByDate = new Map<string, { ck: number; ext: number }>();
          for (const r of receipts) {
            const date = r.receipt_date;
            const entry = receiptsByDate.get(date) ?? { ck: 0, ext: 0 };
            if (r.transfer_order_id) {
              entry.ck += Number(r.qty_received);
            } else {
              entry.ext += Number(r.qty_received) * converter;
            }
            receiptsByDate.set(date, entry);
          }

          // DSC rows by date for physical counts and waste: every count typed in, finished
          // or not, as the count sheet and the branch stock page read it
          const dscByDate = new Map<string, any>();
          for (const row of dscRows) {
            if (row.physical_count !== null) {
              dscByDate.set(row.count_date, row);
            }
          }

          // Step 5 — Build day-by-day ledger. Walk from effectiveStartDate (the anchor
          // date, if one exists) so prevBalance correctly snaps on the anchor day and
          // evolves through any gap days — but only display rows from resolvedStartDate
          // (the user's selected window) onward, below.
          const today = new Date().toISOString().slice(0, 10);
          const allDates: string[] = [];
          const d = new Date(effectiveStartDate);
          const end = new Date(today);
          while (d <= end) {
            allDates.push(d.toISOString().slice(0, 10));
            d.setDate(d.getDate() + 1);
          }

          const ledger: BranchCountRow[] = [];
          let prevBalance = 0;

          for (const date of allDates) {
            const rec = receiptsByDate.get(date) ?? { ck: 0, ext: 0 };
            const totalReceived = rec.ck + rec.ext;
            const usage = usageByDate.get(date) ?? 0;
            const dsc = dscByDate.get(date);
            const waste = dsc ? Number(dsc.waste) : 0;
            const hasPhysical = !!dsc;
            const physicalCount = hasPhysical ? Number(dsc.physical_count) : null;

            // adj_net: sum all adjustments for this date
            const adjEntries = adjMap.get(date) ?? [];
            const adjNet = adjEntries.reduce((sum, a) => sum + a.quantity, 0);

            const opening = prevBalance;
            const calcBal = opening + totalReceived - usage - waste + adjNet;

            // Snap balance to physical if available — must happen for every walked date
            // (including pre-window gap/anchor days) regardless of whether the row is
            // displayed, so prevBalance is correct by the time display rows are reached.
            const variance = physicalCount !== null ? physicalCount - calcBal : 0;
            const nextBalance = physicalCount !== null ? physicalCount : calcBal;

            // Only display rows within the user's selected window — gap/anchor days
            // before resolvedStartDate still ran through the calc above (to seed
            // prevBalance correctly) but aren't shown.
            if (date < resolvedStartDate) {
              prevBalance = nextBalance;
              continue;
            }

            // Only include days with activity
            const hasAdj = adjEntries.length > 0;
            if (totalReceived === 0 && usage === 0 && !hasPhysical && waste === 0 && !hasAdj) {
              prevBalance = nextBalance;
              continue;
            }

            ledger.push({
              count_date: date,
              opening_balance: opening,
              received_from_ck: rec.ck,
              received_external: rec.ext,
              expected_usage: usage,
              waste,
              calculated_balance: calcBal,
              physical_count: physicalCount,
              variance,
            });

            prevBalance = nextBalance;
          }

          setBranchRows(ledger);
        } else if (skuType === "RM" || skuType === "PK") {
          // PK runs the same ledger as RM (receipts + adjustments), on its own stock type
          const [obRes, receiptsRes, adjRes, suppRes, allSessionsRes] = await Promise.all([
            supabase.from("stock_opening_balances").select("quantity").eq("sku_id", skuId).maybeSingle(),
            supabase
              .from("goods_receipts")
              .select("receipt_date, quantity_received, supplier_id, created_at")
              .eq("sku_id", skuId)
              .gte("receipt_date", fromDate)
              .order("receipt_date", { ascending: true })
              .order("created_at", { ascending: true }),
            supabase
              .from("stock_adjustments")
              .select("adjustment_date, quantity, reason, created_at")
              .eq("sku_id", skuId)
              .eq("stock_type", skuType)
              .is("branch_id", null)
              .gte("adjustment_date", fromDate)
              .order("adjustment_date", { ascending: true })
              .order("created_at", { ascending: true }),
            supabase.from("suppliers").select("id, name"),
            supabase
              .from("stock_count_sessions")
              .select("id, count_date, completed_at, count_timing")
              .eq("status", "Completed")
              .is("deleted_at", null),
          ]);
          if (cancelled) return;

          const supplierMap = new Map<string, string>();
          (suppRes.data ?? []).forEach((s) => supplierMap.set(s.id, s.name));

          const converter = sku.converter ?? 1;

          // Step 2: Resolve stock count lines for this RM SKU
          const sessions = allSessionsRes.data ?? [];
          const sessionIds = sessions.map((s: any) => s.id);
          const sessionMeta: Record<string, LedgerCount> = {};
          for (const s of sessions as any[]) {
            sessionMeta[s.id] = {
              count_date: s.count_date,
              completed_at: s.completed_at ?? s.count_date,
              timing: s.count_timing,
            };
          }

          let countLines: { physical_qty: number; session_id: string }[] = [];
          if (sessionIds.length > 0) {
            const { data: lineData } = await supabase
              .from("stock_count_lines")
              .select("physical_qty, session_id")
              .eq("sku_id", skuId)
              .eq("type", skuType)
              .in("session_id", sessionIds)
              .not("physical_qty", "is", null);
            if (cancelled) return;
            countLines = (lineData ?? []) as any;
          }

          // Step 3: Classify counts into pre-window and in-window
          let preWindowCount: ({ physical_qty: number } & LedgerCount) | null = null;
          const inWindowCounts: ({ physical_qty: number } & LedgerCount)[] = [];

          for (const line of countLines) {
            const meta = sessionMeta[line.session_id];
            if (!meta) continue;
            if (meta.count_date < fromDate) {
              if (!preWindowCount || meta.count_date > preWindowCount.count_date) {
                preWindowCount = { physical_qty: line.physical_qty, ...meta };
              }
            } else {
              inWindowCounts.push({ physical_qty: line.physical_qty, ...meta });
            }
          }

          const mvts: Movement[] = [];

          // Step 4: Opening row — prefer pre-window count as anchor
          if (preWindowCount) {
            // Same gap-fold as the SM ledger below: the count is exact as of its own
            // date, but the visible window starts at fromDate — anything that happened
            // strictly between the count and fromDate would otherwise be silently
            // dropped from the replay, causing a false "Balance mismatch" banner.
            const [gapGrRes, gapAdjRes] = await Promise.all([
              supabase
                .from("goods_receipts")
                .select("quantity_received, receipt_date, created_at")
                .eq("sku_id", skuId)
                .gte("receipt_date", preWindowCount.count_date)
                .lt("receipt_date", fromDate),
              supabase
                .from("stock_adjustments")
                .select("quantity, reason, adjustment_date, created_at")
                .eq("sku_id", skuId)
                .eq("stock_type", skuType)
                .is("branch_id", null)
                .gte("adjustment_date", preWindowCount.count_date)
                .lt("adjustment_date", fromDate),
            ]);
            if (cancelled) return;
            const anchor = preWindowCount;
            const gapGr = (gapGrRes.data ?? [])
              .filter((r: any) => afterCount(anchor, r.receipt_date))
              .reduce(
              (s, r) => s + Number(r.quantity_received) * converter,
              0,
            );
            const gapAdj = (gapAdjRes.data ?? [])
              .filter((a: any) => !(a.reason || "").includes("Stock Count") && afterCount(anchor, a.adjustment_date))
              .reduce((s, a: any) => s + Number(a.quantity), 0);
            mvts.push({
              date: preWindowCount.count_date,
              sortKey: `0000-00-00`,
              type: "Opening",
              reference: `ยอดจากการนับ ${thaiDate(preWindowCount.count_date)} รวมของเข้า-ออกถึงก่อนช่วงนี้`,
              qtyIn: preWindowCount.physical_qty + gapGr + gapAdj,
              qtyOut: null,
              isReset: true,
            });
          } else {
            // Fallback: opening balance + pre-window GR + pre-window adj
            const obQty = obRes.data?.quantity ?? 0;
            const [preGrRes, preAdjRes] = await Promise.all([
              supabase
                .from("goods_receipts")
                .select("quantity_received")
                .eq("sku_id", skuId)
                .lt("receipt_date", fromDate),
              supabase
                .from("stock_adjustments")
                .select("quantity")
                .eq("sku_id", skuId)
                .eq("stock_type", skuType)
                .is("branch_id", null)
                .lt("adjustment_date", fromDate),
            ]);
            if (cancelled) return;
            const preGrTotal = (preGrRes.data ?? []).reduce(
              (sum, r) => sum + Number(r.quantity_received) * converter,
              0,
            );
            const preAdjTotal = (preAdjRes.data ?? []).reduce((sum, a) => sum + Number(a.quantity), 0);
            const openingQty = obQty + preGrTotal + preAdjTotal;
            mvts.push({
              date: "—",
              sortKey: "0000-00-00",
              type: "Opening",
              reference: "ยอดยกมาก่อนช่วงนี้",
              qtyIn: openingQty > 0 ? openingQty : null,
              qtyOut: null,
              isReset: true,
            });
          }

          // Step 5: Goods receipts
          (receiptsRes.data ?? []).forEach((r) => {
            mvts.push({
              date: r.receipt_date,
              sortKey: `${r.receipt_date}|1|${r.created_at}`,
              type: "Receipt",
              reference: supplierMap.get(r.supplier_id) ?? "—",
              qtyIn: r.quantity_received * converter,
              qtyOut: null,
              timestamp: r.created_at,
            });
          });

          // Step 6: Stock adjustments — skip Stock Count adjustments (rendered as reset rows)
          (adjRes.data ?? []).forEach((a) => {
            if ((a.reason || "").includes("Stock Count")) return;
            const classified = classifyAdjustment(a.quantity, a.reason, skus);
            mvts.push({
              ...classified,
              date: a.adjustment_date,
              sortKey: `${a.adjustment_date}|1|${a.created_at}`,
              timestamp: a.created_at,
            });
          });

          // Step 7: In-window stock counts as reset rows
          inWindowCounts.forEach((c) => {
            mvts.push({
              date: c.count_date,
              sortKey: countSortKey(c),
              type: "StockCount",
              reference: "นับสต๊อก",
              qtyIn: c.physical_qty,
              qtyOut: null,
              timestamp: c.completed_at,
              isReset: true,
            });
          });

          // Step 8: Sort — keep Opening first
          const opening = mvts[0];
          const rest = mvts.slice(1).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
          const sorted = [opening, ...rest];

          // Step 9: Running balance — reset rows hard-set bal
          let bal = 0;
          sorted.forEach((m) => {
            if (m.isReset) {
              bal = m.qtyIn ?? 0;
            } else {
              bal += (m.qtyIn ?? 0) - (m.qtyOut ?? 0);
            }
            m.runningBalance = bal;
          });

          setMovements(sorted);
        } else {
          // SM — full window with stock counts as inline reset rows

          // Step 1: Fetch transactions in window + all completed stock count sessions (need to find pre-window count too)
          const [obRes, prodRes, toRes, adjRes, allSessionsRes] = await Promise.all([
            supabase.from("stock_opening_balances").select("quantity").eq("sku_id", skuId).maybeSingle(),
            supabase
              .from("production_records")
              .select("production_date, actual_output_g, batches_produced, created_at")
              .eq("sm_sku_id", skuId)
              .gte("production_date", fromDate)
              .order("production_date", { ascending: true })
              .order("created_at", { ascending: true }),
            supabase
              .from("transfer_order_lines")
              .select(
                "id, actual_qty, planned_qty, transfer_orders!inner(to_number, delivery_date, status, updated_at, sent_at, branches(branch_name))",
              )
              .eq("sku_id", skuId)
              .in("transfer_orders.status", TO_DELIVERED_STATUSES)
              .gte("transfer_orders.delivery_date", fromDate),
            supabase
              .from("stock_adjustments")
              .select("adjustment_date, quantity, reason, created_at")
              .eq("sku_id", skuId)
              .eq("stock_type", "SM")
              .is("branch_id", null)
              .gte("adjustment_date", fromDate)
              .order("adjustment_date", { ascending: true })
              .order("created_at", { ascending: true }),
            supabase
              .from("stock_count_sessions")
              .select("id, count_date, completed_at, count_timing")
              .eq("status", "Completed")
              .is("deleted_at", null),
          ]);
          if (cancelled) return;

          // Step 2: Resolve in-window stock counts and the most recent pre-window count
          const sessions = allSessionsRes.data ?? [];
          const sessionIds = sessions.map((s: any) => s.id);
          const sessionMeta: Record<string, LedgerCount> = {};
          for (const s of sessions as any[]) {
            sessionMeta[s.id] = {
              count_date: s.count_date,
              completed_at: s.completed_at ?? s.count_date,
              timing: s.count_timing,
            };
          }

          let countLines: { physical_qty: number; session_id: string }[] = [];
          if (sessionIds.length > 0) {
            const { data: lineData } = await supabase
              .from("stock_count_lines")
              .select("physical_qty, session_id")
              .eq("sku_id", skuId)
              .eq("type", "SM")
              .in("session_id", sessionIds)
              .not("physical_qty", "is", null);
            if (cancelled) return;
            countLines = (lineData ?? []) as any;
          }

          // Find pre-window count (most recent count with count_date < fromDate)
          let preWindowCount: ({ physical_qty: number } & LedgerCount) | null = null;
          // In-window counts (count_date >= fromDate)
          const inWindowCounts: ({ physical_qty: number } & LedgerCount)[] = [];

          for (const line of countLines) {
            const meta = sessionMeta[line.session_id];
            if (!meta) continue;
            if (meta.count_date < fromDate) {
              if (!preWindowCount || meta.count_date > preWindowCount.count_date) {
                preWindowCount = { physical_qty: line.physical_qty, ...meta };
              }
            } else {
              inWindowCounts.push({ physical_qty: line.physical_qty, ...meta });
            }
          }

          const mvts: Movement[] = [];

          // Step 3: Opening row
          if (preWindowCount) {
            // The count itself is exact as of its own date, but the visible window
            // starts at fromDate (14/30 days back) — anything that happened strictly
            // between the count and fromDate would otherwise be silently dropped from
            // the replay, causing a false "Balance mismatch" banner. Fold that gap into
            // the opening figure the same way the no-anchor fallback below already does.
            const [gapProdRes, gapToRes, gapAdjRes] = await Promise.all([
              supabase
                .from("production_records")
                .select("actual_output_g, production_date, created_at")
                .eq("sm_sku_id", skuId)
                .gte("production_date", preWindowCount.count_date)
                .lt("production_date", fromDate),
              supabase
                .from("transfer_order_lines")
                .select("actual_qty, planned_qty, transfer_orders!inner(delivery_date, status, sent_at)")
                .eq("sku_id", skuId)
                .in("transfer_orders.status", TO_DELIVERED_STATUSES)
                .gte("transfer_orders.delivery_date", preWindowCount.count_date)
                .lt("transfer_orders.delivery_date", fromDate),
              supabase
                .from("stock_adjustments")
                .select("quantity, reason, adjustment_date, created_at")
                .eq("sku_id", skuId)
                .eq("stock_type", "SM")
                .is("branch_id", null)
                .gte("adjustment_date", preWindowCount.count_date)
                .lt("adjustment_date", fromDate),
            ]);
            if (cancelled) return;
            const anchor = preWindowCount;
            const gapProd = (gapProdRes.data ?? [])
              .filter((r: any) => producedAfterCount(anchor, r.production_date, r.created_at))
              .reduce((s, r) => s + Number(r.actual_output_g), 0);
            const gapDel = (gapToRes.data ?? [])
              .filter((l: any) => afterCount(anchor, l.transfer_orders?.delivery_date))
              .reduce(
              (s, l: any) =>
                s + computeToLineQty(Number(l.actual_qty), Number(l.planned_qty), l.transfer_orders?.status),
              0,
            );
            const gapAdj = (gapAdjRes.data ?? [])
              .filter((a: any) => !(a.reason || "").includes("Stock Count") && afterCount(anchor, a.adjustment_date))
              .reduce((s, a: any) => s + Number(a.quantity), 0);
            mvts.push({
              date: preWindowCount.count_date,
              sortKey: `0000-00-00`,
              type: "Opening",
              reference: `ยอดจากการนับ ${thaiDate(preWindowCount.count_date)} รวมของเข้า-ออกถึงก่อนช่วงนี้`,
              qtyIn: preWindowCount.physical_qty + gapProd - gapDel + gapAdj,
              qtyOut: null,
              isReset: true,
            });
          } else {
            // Fallback: stock_opening_balances + pre-window transactions
            const obQty = obRes.data?.quantity ?? 0;
            const [preProdRes, preToRes, preAdjRes] = await Promise.all([
              supabase
                .from("production_records")
                .select("actual_output_g")
                .eq("sm_sku_id", skuId)
                .lt("production_date", fromDate),
              supabase
                .from("transfer_order_lines")
                .select("actual_qty, planned_qty, transfer_orders!inner(delivery_date, status)")
                .eq("sku_id", skuId)
                .in("transfer_orders.status", TO_DELIVERED_STATUSES)
                .lt("transfer_orders.delivery_date", fromDate),
              supabase
                .from("stock_adjustments")
                .select("quantity")
                .eq("sku_id", skuId)
                .eq("stock_type", "SM")
                .is("branch_id", null)
                .lt("adjustment_date", fromDate),
            ]);
            if (cancelled) return;
            const preProd = (preProdRes.data ?? []).reduce((s, r) => s + Number(r.actual_output_g), 0);
            const preDel = (preToRes.data ?? []).reduce(
              (s, l: any) =>
                s + computeToLineQty(Number(l.actual_qty), Number(l.planned_qty), l.transfer_orders?.status),
              0,
            );
            const preAdj = (preAdjRes.data ?? []).reduce((s, a) => s + Number(a.quantity), 0);
            const openingQty = obQty + preProd - preDel + preAdj;
            mvts.push({
              date: "—",
              sortKey: "0000-00-00",
              type: "Opening",
              reference: "ยอดยกมาก่อนช่วงนี้",
              qtyIn: openingQty > 0 ? openingQty : null,
              qtyOut: null,
              isReset: true,
            });
          }

          // Step 4: All in-window movements (no anchor filter)
          (prodRes.data ?? []).forEach((p) => {
            mvts.push({
              date: p.production_date,
              sortKey: `${p.production_date}|1|${p.created_at}`,
              type: "Production",
              reference: `ผลิต ${Number(p.batches_produced).toLocaleString("th-TH", { maximumFractionDigits: 2 })} รอบ`,
              qtyIn: p.actual_output_g,
              qtyOut: null,
              timestamp: p.created_at,
            });
          });

          // Lot lookup
          const toLines = toRes.data ?? [];
          const toLineIds = toLines.map((l: any) => l.id).filter(Boolean);
          let lotLookup: Record<string, { production_date: string; packs: number }[]> = {};
          if (toLineIds.length > 0) {
            const { data: lotData } = await supabase
              .from("transfer_order_lot_lines")
              .select("to_line_id, production_date, packs")
              .in("to_line_id", toLineIds);
            if (cancelled) return;
            for (const lot of lotData ?? []) {
              const arr = lotLookup[lot.to_line_id] ?? [];
              arr.push({ production_date: lot.production_date, packs: lot.packs });
              lotLookup[lot.to_line_id] = arr;
            }
          }

          toLines.forEach((line: any) => {
            const to = line.transfer_orders;
            if (!to) return;
            const qty = computeToLineQty(line.actual_qty, line.planned_qty, to.status);
            const branchName = to.branches?.branch_name ?? "";
            const lots = lotLookup[line.id] ?? [];
            let lotText = "";
            if (lots.length > 0) {
              lotText = lots
                .sort((a, b) => a.production_date.localeCompare(b.production_date))
                .map((l) => {
                  const d = new Date(l.production_date);
                  return `${d.getDate()}/${d.getMonth() + 1} ×${l.packs}`;
                })
                .join(", ");
            }
            mvts.push({
              date: to.delivery_date,
              // sent_at = when the kitchen sent it (updated_at moves when the branch receives)
              sortKey: `${to.delivery_date}|1|${to.sent_at ?? to.updated_at ?? to.delivery_date}`,
              type: "Delivery",
              reference: `${branchName} · ${to.to_number}`,
              qtyIn: null,
              qtyOut: qty,
              lotText: lotText || undefined,
              timestamp: to.sent_at ?? to.updated_at ?? undefined,
            });
          });

          (adjRes.data ?? []).forEach((a) => {
            // Skip Stock Count adjustments — the count itself is rendered as a reset row
            if ((a.reason || "").includes("Stock Count")) return;
            const classified = classifyAdjustment(a.quantity, a.reason, skus);
            mvts.push({
              ...classified,
              date: a.adjustment_date,
              sortKey: `${a.adjustment_date}|1|${a.created_at}`,
              timestamp: a.created_at,
            });
          });

          // Step 5: In-window stock counts as reset rows (sorted by completed_at)
          inWindowCounts.forEach((c) => {
            mvts.push({
              date: c.count_date,
              sortKey: countSortKey(c),
              type: "StockCount",
              reference: "นับสต๊อก",
              qtyIn: c.physical_qty,
              qtyOut: null,
              timestamp: c.completed_at,
              isReset: true,
            });
          });

          // Sort: keep Opening (sortKey 0000-00-00) first, rest by sortKey
          const opening = mvts[0];
          const rest = mvts.slice(1).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
          const sorted = [opening, ...rest];

          // Running balance: reset rows hard-set bal; others accumulate
          let bal = 0;
          sorted.forEach((m) => {
            if (m.isReset) {
              bal = m.qtyIn ?? 0;
            } else {
              bal += (m.qtyIn ?? 0) - (m.qtyOut ?? 0);
            }
            m.runningBalance = bal;
          });

          setMovements(sorted);
          setSmAnchorDate(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetch();
    return () => {
      cancelled = true;
    };
  }, [skuId, skuType, sku.converter, skus, context, branchId, daysBack]);

  const finalBalance = movements.length > 0 ? (movements[movements.length - 1].runningBalance ?? 0) : 0;
  const hasMismatch = Math.abs(finalBalance - currentStock) > 1;
  const hasMovements = movements.length > 1;

  // Branch context: use currentStock prop directly (already the live calculated balance from caller)
  const branchCurrentStock = currentStock;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Newest first (the kitchen looks at what just happened); balances were worked out oldest first
  const shown = [...movements].reverse();
  const ranges: { days: number; label: string }[] = [
    { days: 14, label: "14 วัน" },
    { days: 30, label: "30 วัน" },
    { days: 3650, label: "ทั้งหมด" },
  ];
  const stockNow = context === "branch" ? Number(branchCurrentStock) : currentStock;
  const uom = sku.usageUom;

  return (
    <>
      <div className="fixed inset-0 z-[999] bg-black/30" onClick={onClose} />
      <div role="dialog" aria-label={`ประวัติเข้า-ออก ${sku.name}`} className="fixed inset-y-0 right-0 z-[1000] flex w-full max-w-[560px] flex-col bg-background shadow-raised">
        {/* Header: what it is and how much there is now */}
        <div className="flex flex-col gap-3 border-b border-border px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-muted-foreground">ประวัติเข้า-ออก</span>
            <button type="button" onClick={onClose} aria-label="ปิด" className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary hover:bg-secondary/70">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-xs text-muted-foreground">
                {sku.skuId} · {STORAGE_TH[sku.storageCondition] ?? sku.storageCondition}
              </div>
              <div className="break-words text-lg font-bold leading-snug">{sku.name}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className={cn("font-mono text-lg font-bold tabular-nums", stockNow < 0 && "text-destructive")}>
                {fmt0(stockNow)} <span className="font-sans text-sm font-normal text-muted-foreground">{uom}</span>
              </div>
              {context === "ck" && <div className="font-mono text-sm text-muted-foreground">฿{fmt0(stockValue)}</div>}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">{context === "branch" ? "รายวัน (ล่าสุดก่อน)" : "รายการ (ล่าสุดก่อน)"}</span>
            <div className="flex rounded-xl bg-secondary p-1">
              {ranges.map((r) => (
                <button
                  key={r.days}
                  type="button"
                  onClick={() => setDaysBack(r.days)}
                  className={cn("min-h-[32px] rounded-lg px-3 text-sm", daysBack === r.days ? "bg-card font-semibold shadow-card" : "text-muted-foreground")}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {context === "ck" && hasMismatch && hasMovements && !disableMismatchCheck && (
            <div className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>ยอดจากรายการด้านล่าง ({fmt0(finalBalance)}) ไม่ตรงกับคงเหลือ ({fmt0(currentStock)}) · อาจมีรายการที่ไม่ได้แสดงในช่วงนี้</span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col gap-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          ) : context === "branch" ? (
            branchRows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-muted-foreground">
                <ClipboardList className="h-8 w-8 text-muted-foreground/50" />
                ยังไม่มีของเข้า-ออกของตัวนี้ในช่วงนี้
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {[...branchRows].reverse().map((r) => {
                  const received = Math.round(Number(r.received_from_ck) + Number(r.received_external));
                  const used = Number(r.expected_usage);
                  const waste = Number(r.waste);
                  const hasPhysical = r.physical_count !== null;
                  const variance = Number(r.variance);
                  const adjs = adjByDate.get(r.count_date) ?? [];
                  const cell = "min-w-0 rounded-lg bg-secondary px-2 py-1";
                  const label = "block text-[12px] leading-tight text-muted-foreground";
                  const value = "block font-mono text-[15px] font-semibold tabular-nums";
                  return (
                    <li key={r.count_date} className="flex flex-col gap-2 px-4 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold">{thaiDate(r.count_date)}</span>
                        {hasPhysical ? (
                          <span className="text-sm">
                            นับได้ <b className="font-mono text-[15px]">{fmt0(Number(r.physical_count))}</b>{" "}
                            <span className={cn("font-semibold", Math.round(variance) === 0 ? "text-success" : "text-warning")}>
                              {Math.round(variance) === 0 ? "ตรง" : variance > 0 ? `เกิน ${fmt0(variance)}` : `ขาด ${fmt0(-variance)}`}
                            </span>
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">ไม่ได้นับ</span>
                        )}
                      </div>
                      {/* Same boxes as the count page: same place every day */}
                      <div className="grid grid-cols-4 gap-1.5">
                        <span className={cell}>
                          <span className={label}>ยกมา</span>
                          <span className={value}>{fmt0(Number(r.opening_balance))}</span>
                        </span>
                        <span className={cn(cell, received > 0 && "bg-success-soft")}>
                          <span className={cn(label, received > 0 && "text-success")}>รับ</span>
                          <span className={cn(value, received > 0 ? "text-success" : "text-muted-foreground")}>{received > 0 ? `+${fmt0(received)}` : "—"}</span>
                        </span>
                        <span className={cell}>
                          <span className={label}>ใช้</span>
                          <span className={value}>{used > 0 ? `−${fmt0(used)}` : "0"}</span>
                        </span>
                        <span className="min-w-0 rounded-lg border-[1.5px] border-foreground bg-card px-2 py-1">
                          <span className={label}>เหลือ</span>
                          <span className={cn(value, Number(r.calculated_balance) < 0 && "text-destructive")}>{fmt0(Number(r.calculated_balance))}</span>
                        </span>
                      </div>
                      {(waste > 0 || adjs.length > 0) && (
                        <div className="flex flex-col gap-0.5 text-sm text-muted-foreground">
                          {waste > 0 && <span>ของเสีย −{fmt0(waste)}</span>}
                          {adjs.map((a, ai) => (
                            <span key={ai} className="break-words">
                              ปรับยอด <b className={cn("font-mono", a.quantity < 0 ? "text-destructive" : "text-success")}>{a.quantity < 0 ? `−${fmt0(-a.quantity)}` : `+${fmt0(a.quantity)}`}</b> · {a.reason || "ไม่ระบุเหตุผล"}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )
          ) : !hasMovements ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-muted-foreground">
              <ClipboardList className="h-8 w-8 text-muted-foreground/50" />
              ยังไม่มีของเข้า-ออกของตัวนี้ในช่วงนี้
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((m, i) => {
                const tag = tagOf(m);
                const isIn = m.qtyIn != null && m.qtyIn > 0;
                const isOut = m.qtyOut != null && m.qtyOut > 0;
                const when = m.date === "—" ? "" : `${thaiDate(m.date)}${m.timestamp && tag !== "ยกมา" ? ` ${thaiTime(m.timestamp)}` : ""}`;
                return (
                  <li key={i} className="flex items-start gap-3 px-4 py-3">
                    <span className={cn("mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-xs font-bold", TAG_STYLE[tag])}>{tag}</span>
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-[15px] leading-snug">{tag === "นับ" ? `นับได้ ${fmt0(m.qtyIn ?? 0)} ${uom}` : m.reference}</div>
                      {(when || m.lotText) && (
                        <div className="text-[13px] text-muted-foreground">
                          {when}
                          {m.lotText && ` · ล็อต ${m.lotText}`}
                        </div>
                      )}
                    </div>
                    <span className={cn("w-[84px] shrink-0 text-right font-mono text-[15px] font-semibold tabular-nums", isIn && !m.isReset ? "text-success" : "")}>
                      {m.isReset ? "" : isIn ? `+${fmt0(m.qtyIn!)}` : isOut ? `−${fmt0(m.qtyOut!)}` : ""}
                    </span>
                    <span className={cn("w-[72px] shrink-0 text-right font-mono text-[15px] tabular-nums", (m.runningBalance ?? 0) < 0 ? "text-destructive" : "text-muted-foreground", m.isReset && "font-semibold text-foreground")}>
                      {fmt0(m.runningBalance ?? 0)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {!loading && (
            <p className="px-4 py-3 text-center text-xs text-muted-foreground">
              {context === "branch"
                ? "เหลือ = ยกมา + รับ − ใช้ − ของเสีย ± ปรับยอด · วันที่นับ ยอดที่นับได้คือยอดยกมาของวันถัดไป"
                : 'ตัวเลขขวาสุด = คงเหลือหลังรายการนั้น · แถว "นับ" คือยอดที่นับได้จริง ระบบเริ่มคิดต่อจากตรงนั้น'}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
