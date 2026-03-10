import { supabase } from '@/integrations/supabase/client';

// Well-known supplier ID for BOM-calculated prices
export const BOM_SUPPLIER_ID = '45cd33bb-82b7-4865-be1e-3c88f085cc72';
export const BOM_SUPPLIER_NAME = 'BOM Calculation';
export const BOM_PRICE_NOTE = 'Auto-calculated from BOM — do not edit manually';

/**
 * Upsert the active price record for an SM or SP SKU
 * based on BOM cost calculation.
 * Returns the cost per gram that was saved.
 */
export async function syncBomPrice(skuId: string, costPerGram: number): Promise<number> {
  // Check if an active BOM price already exists for this SKU
  const { data: existing } = await supabase
    .from('prices')
    .select('id')
    .eq('sku_id', skuId)
    .eq('supplier_id', BOM_SUPPLIER_ID)
    .eq('is_active', true)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);

  if (existing) {
    // Update existing
    await supabase.from('prices').update({
      price_per_purchase_uom: 0,
      price_per_usage_uom: costPerGram,
      effective_date: today,
      note: BOM_PRICE_NOTE,
    }).eq('id', existing.id);
  } else {
    // Deactivate any old BOM prices for this SKU
    await supabase.from('prices').update({ is_active: false })
      .eq('sku_id', skuId)
      .eq('supplier_id', BOM_SUPPLIER_ID);

    // Insert new active price
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
 * Returns { menuBomCount, spBomCount } of affected rows.
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
    // Group by sp_sku_id to recalculate total cost per SP
    const spSkuIds = new Set<string>();
    for (const line of spLines) {
      const costPerUnit = line.batch_yield_qty > 0 ? (line.qty_per_batch * newCostPerGram) / line.batch_yield_qty : 0;
      await supabase.from('sp_bom').update({ cost_per_unit: costPerUnit }).eq('id', line.id);
      spSkuIds.add(line.sp_sku_id);
    }
    spBomCount = spLines.length;

    // Recalculate and sync the SP SKU price for each affected SP
    for (const spSkuId of spSkuIds) {
      const { data: allSpLines } = await supabase
        .from('sp_bom')
        .select('qty_per_batch, batch_yield_qty, ingredient_sku_id, cost_per_unit')
        .eq('sp_sku_id', spSkuId);

      if (allSpLines && allSpLines.length > 0) {
        // Get fresh active prices for all ingredients
        const { data: activePrices } = await supabase
          .from('prices')
          .select('sku_id, price_per_usage_uom')
          .eq('is_active', true);

        const priceMap = new Map<string, number>();
        activePrices?.forEach(p => priceMap.set(p.sku_id, p.price_per_usage_uom));
        // Override the SM SKU's price with the new cost
        priceMap.set(smSkuId, newCostPerGram);

        const batchYield = allSpLines[0].batch_yield_qty || 1;
        const totalBatchCost = allSpLines.reduce((sum, l) => {
          const unitPrice = priceMap.get(l.ingredient_sku_id) ?? 0;
          return sum + l.qty_per_batch * unitPrice;
        }, 0);
        const spCostPerUnit = batchYield > 0 ? totalBatchCost / batchYield : 0;
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
