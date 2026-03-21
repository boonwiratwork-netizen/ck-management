import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

/* ── Types ── */

interface SmCostRow {
  skuId: string;
  skuName: string;
  actualOutputG: number;
  standardCost: number;
  actualCost: number;
  totalVariance: number;
  totalVariancePct: number;
  priceVariance: number;
  usageVariance: number;
  beginCountDate: string | null;
  endCountDate: string | null;
  beginIsEstimated: boolean;
  endIsEstimated: boolean;
}

interface InventorySection {
  rmProduction: number;
  rmDistribution: number;
  sm: number;
  total: number;
  lastCountDate: string | null;
  countDaysOld: number;
}

interface SupplierSpend {
  supplierName: string;
  totalActual: number;
  pct: number;
}

interface PurchaseSummary {
  totalActualSpend: number;
  bySupplier: SupplierSpend[];
}

interface BranchDistribution {
  branchName: string;
  smValue: number;
  rmValue: number;
}

interface DistributionSummary {
  totalSmValue: number;
  totalRmValue: number;
  byBranch: BranchDistribution[];
}

export interface CkDashboardData {
  productionCost: SmCostRow[];
  totalStandardCost: number;
  totalActualCost: number;
  totalVariance: number;
  totalVariancePct: number;
  totalPriceVariance: number;
  totalUsageVariance: number;
  inventory: InventorySection;
  purchase: PurchaseSummary;
  distribution: DistributionSummary;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/* ── Helper: BOM cost per gram — NO byproduct allocation, SM ingredients = ฿0 ── */

function calcBomCostPerGram(
  skuId: string,
  bomHeaders: any[],
  bomLines: any[],
  bomSteps: any[],
  activePrices: Map<string, number>,
  smSkuIds: Set<string>,
): number {
  const bh = bomHeaders.find((h: any) => h.sm_sku_id === skuId);
  if (!bh) return 0;

  let totalCost = 0;
  let mainOutput = 0;

  if (bh.bom_mode === 'multistep') {
    const steps = bomSteps
      .filter((s: any) => s.bom_header_id === bh.id)
      .sort((a: any, b: any) => a.step_number - b.step_number);
    const allLines = bomLines.filter((l: any) => l.bom_header_id === bh.id);
    if (steps.length === 0) return 0;

    let prevOutput = 0;
    steps.forEach((step: any, idx: number) => {
      const sLines = allLines.filter((l: any) => l.step_id === step.id);
      const inputQty = idx === 0
        ? sLines.reduce((s: number, l: any) => s + l.qty_per_batch, 0)
        : prevOutput;
      const addedQty = idx === 0 ? 0 : sLines.reduce((s: number, l: any) => {
        if (l.qty_type === 'percent' && l.percent_of_input) return s + l.percent_of_input * inputQty;
        return s + l.qty_per_batch;
      }, 0);
      const effectiveInput = idx === 0 ? inputQty : inputQty + addedQty;
      prevOutput = effectiveInput * step.yield_percent;

      totalCost += sLines.reduce((s: number, l: any) => {
        // Skip SM-to-SM ingredients
        if (smSkuIds.has(l.rm_sku_id)) return s;
        let qty = l.qty_per_batch;
        if (l.qty_type === 'percent' && l.percent_of_input) qty = l.percent_of_input * inputQty;
        return s + qty * (activePrices.get(l.rm_sku_id) ?? 0);
      }, 0);
    });
    mainOutput = prevOutput;
  } else {
    const bLines = bomLines.filter((l: any) => l.bom_header_id === bh.id);
    totalCost = bLines.reduce((s: number, l: any) => {
      // Skip SM-to-SM ingredients
      if (smSkuIds.has(l.rm_sku_id)) return s;
      return s + l.qty_per_batch * (activePrices.get(l.rm_sku_id) ?? 0);
    }, 0);
    mainOutput = bh.batch_size * bh.yield_percent;
  }

  return mainOutput > 0 ? totalCost / mainOutput : 0;
}

/* ── Helper: find closest stock count ── */

async function findClosestCount(
  beforeDate: string,
  rmSkuIds: string[],
): Promise<{ bySkuId: Map<string, number>; countDate: string | null; isEstimated: boolean }> {
  const { data: sessions } = await supabase
    .from('stock_count_sessions')
    .select('id, count_date')
    .eq('status', 'Completed')
    .is('deleted_at', null)
    .lte('count_date', beforeDate)
    .order('count_date', { ascending: false })
    .limit(1);

  const session = sessions?.[0];
  const bySkuId = new Map<string, number>();

  if (session) {
    const sessionDate = new Date(session.count_date);
    const targetDate = new Date(beforeDate);
    const daysDiff = Math.floor((targetDate.getTime() - sessionDate.getTime()) / 86400000);

    if (daysDiff <= 30) {
      const { data: lines } = await supabase
        .from('stock_count_lines')
        .select('sku_id, physical_qty')
        .eq('session_id', session.id)
        .eq('type', 'RM');

      for (const l of lines || []) {
        if (l.physical_qty != null && rmSkuIds.includes(l.sku_id)) {
          bySkuId.set(l.sku_id, l.physical_qty);
        }
      }
      return { bySkuId, countDate: session.count_date, isEstimated: false };
    }
  }

  // Fallback: estimate from goods_receipts + stock_adjustments up to beforeDate
  const [grRes, adjRes, obRes] = await Promise.all([
    supabase.from('goods_receipts').select('sku_id, quantity_received').lte('receipt_date', beforeDate),
    supabase.from('stock_adjustments').select('sku_id, quantity').eq('stock_type', 'RM').lte('adjustment_date', beforeDate),
    supabase.from('stock_opening_balances').select('sku_id, quantity'),
  ]);

  const balances = new Map<string, number>();
  for (const ob of obRes.data || []) {
    if (rmSkuIds.includes(ob.sku_id)) balances.set(ob.sku_id, ob.quantity);
  }
  for (const gr of grRes.data || []) {
    if (rmSkuIds.includes(gr.sku_id)) {
      balances.set(gr.sku_id, (balances.get(gr.sku_id) ?? 0) + gr.quantity_received);
    }
  }
  for (const adj of adjRes.data || []) {
    if (rmSkuIds.includes(adj.sku_id)) {
      balances.set(adj.sku_id, (balances.get(adj.sku_id) ?? 0) + adj.quantity);
    }
  }

  return { bySkuId: balances, countDate: session?.count_date ?? null, isEstimated: true };
}

/* ── Main Hook ── */

export function useCkDashboardData({
  rangeStart,
  rangeEnd,
  rmStockBalances,
  smStockBalances,
}: {
  rangeStart: string;
  rangeEnd: string;
  rmStockBalances: Array<{ skuId: string; currentStock: number }>;
  smStockBalances: Array<{ skuId: string; currentStock: number }>;
}): CkDashboardData {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [productionCost, setProductionCost] = useState<SmCostRow[]>([]);
  const [totals, setTotals] = useState({ totalStd: 0, totalAct: 0, totalVar: 0, totalVarPct: 0, totalPriceVar: 0, totalUsageVar: 0 });
  const [inventory, setInventory] = useState<InventorySection>({ rmProduction: 0, rmDistribution: 0, sm: 0, total: 0, lastCountDate: null, countDaysOld: 0 });
  const [purchase, setPurchase] = useState<PurchaseSummary>({ totalActualSpend: 0, bySupplier: [] });
  const [distribution, setDistribution] = useState<DistributionSummary>({ totalSmValue: 0, totalRmValue: 0, byBranch: [] });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      /* ── Fetch shared reference data ── */
      const [
        skuRes, bomHeaderRes, bomLineRes, bomStepRes, priceRes,
        prodRecRes, grRes, supplierRes, branchRes,
      ] = await Promise.all([
        supabase.from('skus').select('id, sku_id, name, type, is_distributable, converter, purchase_uom, usage_uom'),
        supabase.from('bom_headers').select('*'),
        supabase.from('bom_lines').select('*'),
        supabase.from('bom_steps').select('*'),
        supabase.from('prices').select('*'),
        supabase.from('production_records').select('*').gte('production_date', rangeStart).lte('production_date', rangeEnd),
        supabase.from('goods_receipts').select('*').gte('receipt_date', rangeStart).lte('receipt_date', rangeEnd),
        supabase.from('suppliers').select('id, name'),
        supabase.from('branches').select('id, branch_name'),
      ]);

      const skus = skuRes.data || [];
      const bomHeaders = bomHeaderRes.data || [];
      const bomLines = bomLineRes.data || [];
      const bomSteps = bomStepRes.data || [];
      const allPrices = priceRes.data || [];
      const prodRecs = prodRecRes.data || [];
      const goodsReceipts = grRes.data || [];
      const suppliers = supplierRes.data || [];
      const branches = branchRes.data || [];

      // Active prices map: skuId → price_per_usage_uom
      const activePrices = new Map<string, number>();
      for (const p of allPrices) {
        if (p.is_active) activePrices.set(p.sku_id, p.price_per_usage_uom);
      }

      const supplierMap = new Map(suppliers.map((s: any) => [s.id, s.name]));
      const branchMap = new Map(branches.map((b: any) => [b.id, b.branch_name]));
      const skuMap = new Map(skus.map((s: any) => [s.id, s]));

      // Set of SM SKU IDs for Fix 2
      const smSkuIds = new Set(skus.filter((s: any) => s.type === 'SM').map((s: any) => s.id));

      // SM SKUs that were produced in this period
      const producedSmIds = [...new Set(prodRecs.map((r: any) => r.sm_sku_id))];

      // All RM SKUs used in any BOM of produced SM SKUs (excluding SM-to-SM)
      const rmSkuIds = [...new Set(
        bomLines
          .filter((l: any) =>
            !smSkuIds.has(l.rm_sku_id) &&
            bomHeaders.some((h: any) => producedSmIds.includes(h.sm_sku_id) && h.id === l.bom_header_id)
          )
          .map((l: any) => l.rm_sku_id)
      )];

      /* ── SECTION 1: Production Cost Performance ── */

      // Weighted avg actual price per RM from goods_receipts in period
      const rmWeightedPrice = new Map<string, number>();
      const rmReceiptQty = new Map<string, number>();
      const rmReceiptValue = new Map<string, number>();
      for (const gr of goodsReceipts) {
        const prev_qty = rmReceiptQty.get(gr.sku_id) ?? 0;
        const prev_val = rmReceiptValue.get(gr.sku_id) ?? 0;
        rmReceiptQty.set(gr.sku_id, prev_qty + gr.quantity_received);
        rmReceiptValue.set(gr.sku_id, prev_val + gr.actual_unit_price * gr.quantity_received);
      }
      for (const [skuId, totalQty] of rmReceiptQty) {
        if (totalQty > 0) rmWeightedPrice.set(skuId, (rmReceiptValue.get(skuId) ?? 0) / totalQty);
      }

      // Find beginning and ending RM stock
      const [beginCount, endCount] = await Promise.all([
        findClosestCount(rangeStart, rmSkuIds),
        findClosestCount(rangeEnd, rmSkuIds),
      ]);

      // RM purchased qty in period (in usage UOM)
      const rmPurchasedInPeriod = new Map<string, number>();
      for (const gr of goodsReceipts) {
        if (rmSkuIds.includes(gr.sku_id)) {
          rmPurchasedInPeriod.set(gr.sku_id, (rmPurchasedInPeriod.get(gr.sku_id) ?? 0) + gr.quantity_received);
        }
      }

      // Actual qty used per RM = begin + purchased - end
      const rmActualUsed = new Map<string, number>();
      for (const rmId of rmSkuIds) {
        const begin = beginCount.bySkuId.get(rmId) ?? 0;
        const purchased = rmPurchasedInPeriod.get(rmId) ?? 0;
        const end = endCount.bySkuId.get(rmId) ?? 0;
        rmActualUsed.set(rmId, Math.max(0, begin + purchased - end));
      }

      // Per SM SKU cost analysis
      const smRows: SmCostRow[] = [];
      let grandStd = 0, grandAct = 0, grandPriceVar = 0, grandUsageVar = 0;

      for (const smId of producedSmIds) {
        const sku = skuMap.get(smId);
        const smName = sku?.name ?? smId;
        const skuCode = sku?.sku_id ?? '';

        const smProdRecs = prodRecs.filter((r: any) => r.sm_sku_id === smId);
        const totalOutputG = smProdRecs.reduce((s: number, r: any) => s + r.actual_output_g, 0);
        const totalBatches = smProdRecs.reduce((s: number, r: any) => s + r.batches_produced, 0);

        // Standard cost (no byproduct allocation, SM ingredients = ฿0)
        const costPerGram = calcBomCostPerGram(smId, bomHeaders, bomLines, bomSteps, activePrices, smSkuIds);
        const standardCost = totalOutputG * costPerGram;

        // BOM lines for this SM (excluding SM-to-SM)
        const bh = bomHeaders.find((h: any) => h.sm_sku_id === smId);
        const myBomLines = bh
          ? bomLines.filter((l: any) => l.bom_header_id === bh.id && !smSkuIds.has(l.rm_sku_id))
          : [];

        // Actual cost using beginning + purchases - ending per RM
        let smActualCost = 0;
        let smPriceVar = 0;
        let smUsageVar = 0;

        for (const bl of myBomLines) {
          const rmId = bl.rm_sku_id;
          const totalRmUsed = rmActualUsed.get(rmId) ?? 0;

          // Proportional allocation when multiple SM BOMs use same RM
          const bomsUsingRm = bomHeaders.filter((h: any) =>
            producedSmIds.includes(h.sm_sku_id) &&
            bomLines.some((l: any) => l.bom_header_id === h.id && l.rm_sku_id === rmId && !smSkuIds.has(l.rm_sku_id))
          );
          const bomShareQty = bomsUsingRm.length > 1
            ? totalRmUsed * (bl.qty_per_batch / bomLines.filter((l: any) => l.rm_sku_id === rmId && !smSkuIds.has(l.rm_sku_id) && bomsUsingRm.some((h: any) => h.id === l.bom_header_id)).reduce((s: number, l: any) => s + l.qty_per_batch, 0))
            : totalRmUsed;

          const actualPrice = rmWeightedPrice.get(rmId) ?? activePrices.get(rmId) ?? 0;
          const stdPrice = activePrices.get(rmId) ?? 0;
          const stdQty = bl.qty_per_batch * totalBatches;

          smActualCost += bomShareQty * actualPrice;
          smPriceVar += (actualPrice - stdPrice) * bomShareQty;
          smUsageVar += (bomShareQty - stdQty) * stdPrice;
        }

        const totalVar = smActualCost - standardCost;
        const totalVarPct = standardCost > 0 ? (totalVar / standardCost) * 100 : 0;

        smRows.push({
          skuId: smId,
          skuName: `${skuCode} ${smName}`,
          actualOutputG: totalOutputG,
          standardCost,
          actualCost: smActualCost,
          totalVariance: totalVar,
          totalVariancePct: totalVarPct,
          priceVariance: smPriceVar,
          usageVariance: smUsageVar,
          beginCountDate: beginCount.countDate,
          endCountDate: endCount.countDate,
          beginIsEstimated: beginCount.isEstimated,
          endIsEstimated: endCount.isEstimated,
        });

        grandStd += standardCost;
        grandAct += smActualCost;
        grandPriceVar += smPriceVar;
        grandUsageVar += smUsageVar;
      }

      const grandVar = grandAct - grandStd;
      const grandVarPct = grandStd > 0 ? (grandVar / grandStd) * 100 : 0;

      setProductionCost(smRows);
      setTotals({ totalStd: grandStd, totalAct: grandAct, totalVar: grandVar, totalVarPct: grandVarPct, totalPriceVar: grandPriceVar, totalUsageVar: grandUsageVar });

      /* ── SECTION 2: Inventory Value (from live stock balance props) ── */

      const today = new Date().toISOString().slice(0, 10);

      // Staleness signal from most recent completed count session
      const { data: invSessions } = await supabase
        .from('stock_count_sessions')
        .select('count_date')
        .eq('status', 'Completed')
        .is('deleted_at', null)
        .lte('count_date', today)
        .order('count_date', { ascending: false })
        .limit(1);

      const lastCountDate = invSessions?.[0]?.count_date ?? null;
      const countDaysOld = lastCountDate
        ? Math.floor((new Date(today).getTime() - new Date(lastCountDate).getTime()) / 86400000)
        : 999;

      // RM SKUs in active BOMs
      const bomRmIds = new Set(bomLines.map((l: any) => l.rm_sku_id));

      let rmProdVal = 0;
      for (const bal of rmStockBalances) {
        if (bomRmIds.has(bal.skuId)) {
          const price = activePrices.get(bal.skuId) ?? 0;
          rmProdVal += Math.max(0, bal.currentStock) * price;
        }
      }

      let rmDistVal = 0;
      for (const bal of rmStockBalances) {
        const sku = skuMap.get(bal.skuId);
        if (sku?.is_distributable) {
          const price = activePrices.get(bal.skuId) ?? 0;
          rmDistVal += Math.max(0, bal.currentStock) * price;
        }
      }

      let smVal = 0;
      for (const bal of smStockBalances) {
        const cpg = calcBomCostPerGram(bal.skuId, bomHeaders, bomLines, bomSteps, activePrices, smSkuIds);
        smVal += Math.max(0, bal.currentStock) * cpg;
      }

      setInventory({
        rmProduction: rmProdVal,
        rmDistribution: rmDistVal,
        sm: smVal,
        total: rmProdVal + rmDistVal + smVal,
        lastCountDate,
        countDaysOld,
      });

      /* ── SECTION 3: Purchase Summary ── */

      const supplierSpend = new Map<string, number>();
      let totalSpend = 0;
      for (const gr of goodsReceipts) {
        totalSpend += gr.actual_total;
        const sName = supplierMap.get(gr.supplier_id) ?? 'Unknown';
        supplierSpend.set(sName, (supplierSpend.get(sName) ?? 0) + gr.actual_total);
      }

      const bySupplier: SupplierSpend[] = [...supplierSpend.entries()]
        .map(([supplierName, totalActual]) => ({
          supplierName,
          totalActual,
          pct: totalSpend > 0 ? (totalActual / totalSpend) * 100 : 0,
        }))
        .sort((a, b) => b.totalActual - a.totalActual);

      setPurchase({ totalActualSpend: totalSpend, bySupplier });

      /* ── SECTION 4: Distribution Summary ── */

      const [toRes, tolRes] = await Promise.all([
        supabase
          .from('transfer_orders')
          .select('id, branch_id, status, delivery_date')
          .in('status', ['Sent', 'Received'])
          .gte('delivery_date', rangeStart)
          .lte('delivery_date', rangeEnd),
        supabase.from('transfer_order_lines').select('to_id, sku_id, sku_type, actual_qty, unit_cost'),
      ]);

      const validTos = new Map((toRes.data || []).map((t: any) => [t.id, t]));
      let distSm = 0, distRm = 0;
      const branchDist = new Map<string, { smValue: number; rmValue: number }>();

      for (const tl of tolRes.data || []) {
        const to = validTos.get(tl.to_id);
        if (!to || tl.actual_qty <= 0) continue;
        const val = tl.actual_qty * tl.unit_cost;
        const bName = branchMap.get(to.branch_id) ?? 'Unknown';

        if (!branchDist.has(bName)) branchDist.set(bName, { smValue: 0, rmValue: 0 });
        const bd = branchDist.get(bName)!;

        if (tl.sku_type === 'RM') {
          distRm += val;
          bd.rmValue += val;
        } else {
          distSm += val;
          bd.smValue += val;
        }
      }

      setDistribution({
        totalSmValue: distSm,
        totalRmValue: distRm,
        byBranch: [...branchDist.entries()]
          .map(([branchName, v]) => ({ branchName, ...v }))
          .sort((a, b) => (b.smValue + b.rmValue) - (a.smValue + a.rmValue)),
      });

    } catch (e: any) {
      setError(e?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd, rmStockBalances, smStockBalances]);

  return {
    productionCost,
    totalStandardCost: totals.totalStd,
    totalActualCost: totals.totalAct,
    totalVariance: totals.totalVar,
    totalVariancePct: totals.totalVarPct,
    totalPriceVariance: totals.totalPriceVar,
    totalUsageVariance: totals.totalUsageVar,
    inventory,
    purchase,
    distribution,
    loading,
    error,
    refresh,
  };
}
