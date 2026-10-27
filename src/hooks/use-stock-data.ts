import { useKitchenItemStock } from "@/hooks/use-kitchen-item-stock";
import { GoodsReceipt } from "@/types/goods-receipt";
import { SKU } from "@/types/sku";
import { Price } from "@/types/price";

/**
 * Kitchen RM stock. Same hook as PK (use-kitchen-item-stock); `receipts` is no longer
 * used — the shared list only holds 90 days, the stock reads every receipt itself.
 */
export function useStockData(skus: SKU[], _receipts: GoodsReceipt[], prices: Price[], enabled = true) {
  return useKitchenItemStock("RM", skus, prices, enabled);
}
