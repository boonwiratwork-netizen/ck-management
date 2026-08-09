// Edge function: daily-sales-report
// Cron-triggered at 20:30 Bangkok time. Reports on TODAY's sales so far:
//   - total sales by branch
//   - top 5 best-selling menu items per branch, ranked by revenue
//   - sales-driven theoretical usage of every "เส้น" (noodle) RM item
// Pushes the result to a LINE group via the LINE Messaging API.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, toBangkokDateStr, formatThaiDate, formatBaht, pushLineMessage } from "../_shared/report-utils.ts";
import { computeAllNoodleUsage } from "../_shared/rm-usage.ts";

const TOP_N_MENUS = 5;

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
      .select("branch_id, menu_code, menu_name, qty, net_amount")
      .eq("sale_date", targetDate);
    const sales = (salesRows || []) as Array<{
      branch_id: string; menu_code: string; menu_name: string; qty: number; net_amount: number;
    }>;

    // Total sales by branch
    const salesByBranch: Record<string, number> = {};
    for (const row of sales) {
      salesByBranch[row.branch_id] = (salesByBranch[row.branch_id] || 0) + Number(row.net_amount);
    }
    const totalSales = Object.values(salesByBranch).reduce((a, b) => a + b, 0);
    const salesLines = branchList
      .map((b) => `${b.branch_name}: ${formatBaht(salesByBranch[b.id] || 0)} บาท`)
      .join("\n");

    // Top 5 menus per branch, ranked by revenue
    const menuBlocks: string[] = [];
    for (const b of branchList) {
      const byMenu: Record<string, { name: string; qty: number; amount: number }> = {};
      for (const row of sales) {
        if (row.branch_id !== b.id) continue;
        const key = row.menu_code || row.menu_name;
        if (!byMenu[key]) byMenu[key] = { name: row.menu_name, qty: 0, amount: 0 };
        byMenu[key].qty += Number(row.qty);
        byMenu[key].amount += Number(row.net_amount);
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
      : "ไม่พบ RM ที่ชื่อมีคำว่า \"เส้น\" (เช็คชื่อสินค้าใน master SKU)";

    const message =
      `รายงานยอดขายประจำวัน ${formatThaiDate(targetDate)}\n\n` +
      `ยอดขายรายสาขา\n${salesLines || "(ไม่มีข้อมูล)"}\n` +
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
