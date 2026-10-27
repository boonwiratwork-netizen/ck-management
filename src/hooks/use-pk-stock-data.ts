import { useKitchenItemStock } from "@/hooks/use-kitchen-item-stock";
import { GoodsReceipt } from "@/types/goods-receipt";
import { SKU } from "@/types/sku";
import { Price } from "@/types/price";

/** Kitchen PK stock: the same hook as RM (use-kitchen-item-stock), on PK */
export function usePkStockData(skus: SKU[], _receipts: GoodsReceipt[], prices: Price[], enabled = true) {
  return useKitchenItemStock("PK", skus, prices, enabled);
}
