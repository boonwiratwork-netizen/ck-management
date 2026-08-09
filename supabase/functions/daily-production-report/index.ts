// Edge function: daily-production-report
// Cron-triggered at 17:00 Bangkok time. Reports on TODAY so far:
//   - what the central kitchen produced today, per SM item, in grams
//   - CK-level remaining stock value, split by RM / SM / PK
// Pushes the result to a LINE group via the LINE Messaging API.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, toBangkokDateStr, formatThaiDate, formatBaht, pushLineMessage } from "../_shared/report-utils.ts";
import { computeCkStockValueByType } from "../_shared/stock-value.ts";

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

    // ── Today's production, per SM item ─────────────────────────
    const { data: production } = await supabase
      .from("production_records")
      .select("sm_sku_id, actual_output_g")
      .eq("production_date", targetDate);
    const prodRows = (production || []) as Array<{ sm_sku_id: string; actual_output_g: number }>;

    const outputBySkuId: Record<string, number> = {};
    for (const p of prodRows) {
      outputBySkuId[p.sm_sku_id] = (outputBySkuId[p.sm_sku_id] || 0) + Number(p.actual_output_g);
    }
    const skuIds = Object.keys(outputBySkuId);

    let productionLines = "(ไม่มีการผลิตวันนี้)";
    if (skuIds.length > 0) {
      const { data: skuRows } = await supabase.from("skus").select("id, name, usage_uom").in("id", skuIds);
      const nameById: Record<string, string> = {};
      const uomById: Record<string, string> = {};
      for (const s of (skuRows || []) as Array<{ id: string; name: string; usage_uom: string }>) {
        nameById[s.id] = s.name;
        uomById[s.id] = s.usage_uom;
      }
      productionLines = Object.entries(outputBySkuId)
        .sort((a, b) => b[1] - a[1])
        .map(([id, qty]) => `${nameById[id] || id}: ${qty.toFixed(0)} ${uomById[id] || ""}`.trim())
        .join("\n");
    }

    // ── CK stock value by type ───────────────────────────────────
    const [rmValue, smValue, pkValue] = await Promise.all([
      computeCkStockValueByType(supabase, "RM"),
      computeCkStockValueByType(supabase, "SM"),
      computeCkStockValueByType(supabase, "PK"),
    ]);
    const totalValue = rmValue + smValue + pkValue;

    const message =
      `รายงานผลผลิตประจำวัน ${formatThaiDate(targetDate)}\n\n` +
      `ผลผลิตวันนี้ (ครัวกลาง)\n${productionLines}\n\n` +
      `มูลค่าวัตถุดิบคงเหลือที่ครัวกลาง\n` +
      `RM: ${formatBaht(rmValue)} บาท\n` +
      `SM: ${formatBaht(smValue)} บาท\n` +
      `PK: ${formatBaht(pkValue)} บาท\n` +
      `รวมทั้งหมด: ${formatBaht(totalValue)} บาท`;

    if (dryRun) return jsonResponse({ targetDate, message });

    const result = await pushLineMessage(message);
    if (!result.ok) return jsonResponse({ error: result.error, targetDate, message }, 500);

    return jsonResponse({ ok: true, targetDate, message });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
});
