import { supabase } from '@/integrations/supabase/client';
import { toLocalDateStr } from '@/lib/utils';

// Well-known supplier ID for BOM-calculated prices
export const BOM_SUPPLIER_ID = '45cd33bb-82b7-4865-be1e-3c88f085cc72';
export const BOM_SUPPLIER_NAME = 'BOM Calculation';
export const BOM_PRICE_NOTE = 'Auto-calculated from BOM — do not edit manually';

/**
 * Compute costPerGram for a BOM header by fetching fresh data from DB.
 * Now accounts for by-product cost allocation.
 */
export async function computeBomCostFromDb(headerId: string): Promise<{ costPerGram: number; smSkuId: string }> {
  const { data: header } = await supabase
    .from('bom_headers')
    .select('*')
    .eq('id', headerId)
    .single();
  if (!header) return { costPerGram: 0, smSkuId: '' };

  // Fetch active prices for cost lookup
  const { data: activePrices } = await supabase
    .from('prices')
    .select('sku_id, price_per_usage_uom')
    .eq('is_active', true);
  const priceMap = new Map<string, number>();
  activePrices?.forEach(p => priceMap.set(p.sku_id, p.price_per_usage_uom));
  const getCost = (skuId: string) => priceMap.get(skuId) ?? 0;

  // Fetch by-products
  const { data: byproductsRaw } = await supabase
    .from('bom_byproducts' as any)
    .select('*')
    .eq('bom_header_id', headerId);
  const byproducts = (byproductsRaw || []) as any[];

  let totalCost = 0;
  let mainOutput = 0;

  if (header.bom_mode === 'simple') {
    const { data: dbLines } = await supabase
      .from('bom_lines')
      .select('*')
      .eq('bom_header_id', headerId);
    mainOutput = header.batch_size * header.yield_percent;
    totalCost = (dbLines || []).reduce((s, l) => s + l.qty_per_batch * getCost(l.rm_sku_id), 0);
  } else {
    // Multi-step
    const { data: dbSteps } = await supabase
      .from('bom_steps')
      .select('*')
      .eq('bom_header_id', headerId)
      .order('step_number', { ascending: true });
    const { data: dbLines } = await supabase
      .from('bom_lines')
      .select('*')
      .eq('bom_header_id', headerId);
    const steps = dbSteps || [];
    const lines = dbLines || [];

    let prevOutput = 0;
    steps.forEach((step, idx) => {
      const sLines = lines.filter(l => l.step_id === step.id);
      let inputQty = idx === 0 ? sLines.reduce((s, l) => s + l.qty_per_batch, 0) : prevOutput;
      const ingredientQty = sLines.reduce((s, l) => {
        if (l.qty_type === 'percent' && l.percent_of_input) return s + l.percent_of_input * inputQty;
        return s + l.qty_per_batch;
      }, 0);
      const effectiveInput = idx === 0 ? ingredientQty : inputQty + sLines.reduce((s, l) => {
        if (l.qty_type === 'percent' && l.percent_of_input) return s + l.percent_of_input * inputQty;
        return s + l.qty_per_batch;
      }, 0);
      prevOutput = effectiveInput * step.yield_percent;
      totalCost += sLines.reduce((s, l) => {
        let qty = l.qty_per_batch;
        if (l.qty_type === 'percent' && l.percent_of_input) qty = l.percent_of_input * inputQty;
        return s + qty * getCost(l.rm_sku_id);
      }, 0);
    });
    mainOutput = prevOutput;
  }

  // Apply by-product allocation
  const totalByproductPct = byproducts.reduce((s, bp) => s + (bp.cost_allocation_pct || 0), 0);
  const mainPct = Math.max(0, 100 - totalByproductPct);
  const allocatedMainCost = totalCost * (mainPct / 100);
  const mainCostPerGram = mainOutput > 0 ? allocatedMainCost / mainOutput : 0;

  return { costPerGram: mainCostPerGram, smSkuId: header.sm_sku_id };
}

/**
 * Sync by-product prices to the prices table for inventory-tracked by-products.
 */
export async function syncByproductPrices(headerId: string, totalBatchCost: number): Promise<void> {
  const { data: byproductsRaw } = await supabase
    .from('bom_byproducts' as any)
    .select('*')
    .eq('bom_header_id', headerId);
  const byproducts = (byproductsRaw || []) as any[];

  for (const bp of byproducts) {
    if (bp.tracks_inventory && bp.sku_id && bp.output_qty > 0) {
      const allocatedCost = totalBatchCost * (bp.cost_allocation_pct / 100);
      const costPerGram = allocatedCost / bp.output_qty;
      await syncBomPrice(bp.sku_id, costPerGram);
    }
  }
}

/**
 * Upsert the active price record for an SM or SP SKU
 * based on BOM cost calculation.
 */
export async function syncBomPrice(skuId: string, costPerGram: number): Promise<number> {
  const { data: existing } = await supabase
    .from('prices')
    .select('id')
    .eq('sku_id', skuId)
    .eq('supplier_id', BOM_SUPPLIER_ID)
    .eq('is_active', true)
    .maybeSingle();

  const today = toLocalDateStr(new Date());

  if (existing) {
    await supabase.from('prices').update({
      price_per_purchase_uom: 0,
      price_per_usage_uom: costPerGram,
      effective_date: today,
      note: BOM_PRICE_NOTE,
    }).eq('id', existing.id);
  } else {
    await supabase.from('prices').update({ is_active: false })
      .eq('sku_id', skuId)
      .eq('supplier_id', BOM_SUPPLIER_ID);

    await supabase.from('prices').insert({
      sku_id: skuId,
      supplier_id: BOM_SUPPLIER_ID,
      price_per_purchase_uom: 0,
      price_per_usage_uom: costPerGram,
      vat: false,
      is_active: true,
      effective_date: today,
      note: BOM_PRICE_NOTE,
    });
  }

  return costPerGram;
}

/**
 * After an SM SKU's BOM price is synced, cascade the updated cost
 * to all Menu BOMs and SP BOMs that reference this SM SKU as an ingredient.
 */
export async function cascadeBomCost(smSkuId: string, newCostPerGram: number): Promise<{ menuBomCount: number; spBomCount: number }> {
  let menuBomCount = 0;
  let spBomCount = 0;

  // 1) Update menu_bom lines that use this SM SKU
  const { data: menuLines } = await supabase
    .from('menu_bom')
    .select('id, qty_per_serving, yield_pct, effective_qty')
    .eq('sku_id', smSkuId);

  if (menuLines && menuLines.length > 0) {
    for (const line of menuLines) {
      const effQty = line.effective_qty ?? (line.yield_pct > 0 ? line.qty_per_serving / (line.yield_pct / 100) : line.qty_per_serving);
      const newCost = effQty * newCostPerGram;
      await supabase.from('menu_bom').update({ cost_per_serving: newCost }).eq('id', line.id);
    }
    menuBomCount = menuLines.length;
  }

  // 2) Update sp_bom lines that use this SM SKU
  const { data: spLines } = await supabase
    .from('sp_bom')
    .select('id, qty_per_batch, batch_yield_qty, sp_sku_id')
    .eq('ingredient_sku_id', smSkuId);

  if (spLines && spLines.length > 0) {
    const spSkuIds = new Set<string>();
    for (const line of spLines) {
      spSkuIds.add(line.sp_sku_id);
    }
    spBomCount = spLines.length;

    const { data: freshPrices } = await supabase
      .from('prices')
      .select('sku_id, price_per_usage_uom')
      .eq('is_active', true);
    const priceMap = new Map<string, number>();
    freshPrices?.forEach(p => priceMap.set(p.sku_id, p.price_per_usage_uom));

    for (const spSkuId of spSkuIds) {
      const { data: allSpLines } = await supabase
        .from('sp_bom')
        .select('id, qty_per_batch, batch_yield_qty, ingredient_sku_id')
        .eq('sp_sku_id', spSkuId);

      if (allSpLines && allSpLines.length > 0) {
        const batchYield = allSpLines[0].batch_yield_qty || 1;
        const totalBatchCost = allSpLines.reduce((sum, l) => {
          const unitPrice = priceMap.get(l.ingredient_sku_id) ?? 0;
          return sum + l.qty_per_batch * unitPrice;
        }, 0);
        const spCostPerUnit = batchYield > 0 ? totalBatchCost / batchYield : 0;

        for (const l of allSpLines) {
          const lineCost = batchYield > 0 ? (l.qty_per_batch * (priceMap.get(l.ingredient_sku_id) ?? 0)) / batchYield : 0;
          await supabase.from('sp_bom').update({ cost_per_unit: lineCost }).eq('id', l.id);
        }

        if (spCostPerUnit > 0) {
          await syncBomPrice(spSkuId, spCostPerUnit);
        }
      }
    }
  }

  return { menuBomCount, spBomCount };
}

/**
 * Check if a price record is BOM-calculated (system-managed)
 */
export function isBomPrice(supplierId: string): boolean {
  return supplierId === BOM_SUPPLIER_ID;
}
