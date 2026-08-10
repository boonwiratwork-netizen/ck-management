// Edge function: daily-sales-report
// Cron-triggered at 21:00 Bangkok time. Reports on TODAY's sales so far:
//   - total sales by branch, split Dine-in / Delivery, gross of VAT + service charge
//   - top 5 best-selling menu items per branch, ranked by (gross) revenue
//   - sales-driven theoretical usage of every "เส้น" (noodle) RM item
// Pushes the result to a LINE group via the LINE Messaging API.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, toBangkokDateStr, formatThaiDate, formatBaht, pushLineMessage } from "../_shared/report-utils.ts";
import { computeAllNoodleUsage } from "../_shared/rm-usage.ts";

const TOP_N_MENUS = 5;
const VAT_RATE = 1.07;
const SERVICE_CHARGE_RATE = 1.05; // dine-in only — delivery has no service charge

function isDelivery(orderType: string): boolean {
  return String(orderType || "").toLowerCase().includes("delivery");
}

// sales_entries.net_amount is net of discounts but before VAT/service charge.
function grossAmount(netAmount: number, orderType: string): number {
  return isDelivery(orderType) ? netAmount * VAT_RATE : netAmount * VAT_RATE * SERVICE_CHARGE_RATE;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const dateOverride = url.searchParams.get("date");
    const dryRun = url.searchParams.get("dryRun") === "1";
    const targetDate = dateOverride || toBangkokDateStr(new Date());

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: branches } = await supabase
      .from("branches")
      .select("id, branch_name, brand_name")
      .eq("status", "Active");
    const branchList = (branches || []) as Array<{ id: string; branch_name: string; brand_name: string }>;

    const { data: salesRows } = await supabase
      .from("sales_entries")
      .select("branch_id, menu_code, menu_name, order_type, qty, net_amount")
      .eq("sale_date", targetDate);
    const sales = (salesRows || []) as Array<{
      branch_id: string; menu_code: string; menu_name: string; order_type: string; qty: number; net_amount: number;
    }>;

    // sales_entries.menu_name carries the customer's full modifier selection
    // (needed elsewhere for modifier-rule matching — do not "clean" it at the
    // source). For display here only, look up the master menus table's plain
    // name by menu_code instead.
    const menuCodes = [...new Set(sales.map((s) => s.menu_code).filter(Boolean))];
    const cleanNameByCode: Record<string, string> = {};
    if (menuCodes.length > 0) {
      const { data: menuRows } = await supabase.from("menus").select("menu_code, menu_name").in("menu_code", menuCodes);
      for (const m of (menuRows || []) as Array<{ menu_code: string; menu_name: string }>) {
        cleanNameByCode[m.menu_code] = m.menu_name;
      }
    }

    // Total sales by branch, split Dine-in / Delivery, gross of VAT + service charge
    const deliveryByBranch: Record<string, number> = {};
    const dineInByBranch: Record<string, number> = {};
    for (const row of sales) {
      const amt = grossAmount(Number(row.net_amount), row.order_type);
      if (isDelivery(row.order_type)) {
        deliveryByBranch[row.branch_id] = (deliveryByBranch[row.branch_id] || 0) + amt;
      } else {
        dineInByBranch[row.branch_id] = (dineInByBranch[row.branch_id] || 0) + amt;
      }
    }
    const salesLines = branchList
      .flatMap((b) => [
        `${b.branch_name} (Dine-in): ${formatBaht(dineInByBranch[b.id] || 0)} บาท`,
        `${b.branch_name} (Delivery): ${formatBaht(deliveryByBranch[b.id] || 0)} บาท`,
      ])
      .join("\n");
    const totalSales =
      Object.values(deliveryByBranch).reduce((a, b) => a + b, 0) +
      Object.values(dineInByBranch).reduce((a, b) => a + b, 0);

    // Top 5 menus per branch, ranked by gross revenue, keyed by menu_code
    const menuBlocks: string[] = [];
    for (const b of branchList) {
      const byMenu: Record<string, { name: string; qty: number; amount: number }> = {};
      for (const row of sales) {
        if (row.branch_id !== b.id) continue;
        const key = row.menu_code || row.menu_name;
        const displayName = cleanNameByCode[row.menu_code] || row.menu_name;
        if (!byMenu[key]) byMenu[key] = { name: displayName, qty: 0, amount: 0 };
        byMenu[key].qty += Number(row.qty);
        byMenu[key].amount += grossAmount(Number(row.net_amount), row.order_type);
      }
      const top = Object.values(byMenu)
        .sort((a, b2) => b2.amount - a.amount)
        .slice(0, TOP_N_MENUS);
      if (top.length === 0) continue;
      const lines = top
        .map((m, i) => `${i + 1}. ${m.name} — ${m.qty} เสิร์ฟ, ${formatBaht(m.amount)} บาท`)
        .join("\n");
      menuBlocks.push(`Top ${TOP_N_MENUS} เมนูขายดี — ${b.branch_name}\n${lines}`);
    }

    // เส้น usage (all matching RM items), theoretical from today's sales × BOM
    const noodleUsage = await computeAllNoodleUsage(supabase, branchList, targetDate);
    const noodleLines = noodleUsage.length > 0
      ? noodleUsage.map((n) => `${n.name}: ${n.total.toFixed(0)} ${n.usageUom}`).join("\n")
      : "ไม่พบ RM ที่ชื่อขึ้นต้นด้วย \"เส้น\" (เช็คชื่อสินค้าใน master SKU)";

    const message =
      `รายงานยอดขายประจำวัน ${formatThaiDate(targetDate)}\n\n` +
      `ยอดขายรายสาขา (รวม VAT 7% ทุกออเดอร์ + Service Charge 5% เพิ่มเฉพาะ Dine-in)\n${salesLines || "(ไม่มีข้อมูล)"}\n` +
      `รวมทั้งหมด: ${formatBaht(totalSales)} บาท\n\n` +
      `${menuBlocks.join("\n\n") || "(ไม่มีข้อมูลยอดขายเมนู)"}\n\n` +
      `ยอดใช้เส้น (ตามสูตร)\n${noodleLines}`;

    if (dryRun) return jsonResponse({ targetDate, message });

    const result = await pushLineMessage(message);
    if (!result.ok) return jsonResponse({ error: result.error, targetDate, message }, 500);

    return jsonResponse({ ok: true, targetDate, message });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
});
