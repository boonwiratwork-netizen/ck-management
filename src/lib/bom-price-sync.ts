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
 * Check if a price record is BOM-calculated (system-managed)
 */
export function isBomPrice(supplierId: string): boolean {
  return supplierId === BOM_SUPPLIER_ID;
}
