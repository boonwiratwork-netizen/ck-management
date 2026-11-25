import { supabase } from "@/integrations/supabase/client";
import type { SKU } from "@/types/sku";
import { kitchenStockFor } from "../../supabase/functions/_shared/kitchen-stock.ts";

// Lives with the Edge Functions' shared code (the LINE bot reads kitchen stock the same way)
export { USAGE_WINDOW_DAYS, isKitchenUse, kitchenUsePerDay } from "../../supabase/functions/_shared/kitchen-stock.ts";

/** The kitchen's current stock per SKU (SM / RM / PK): see the shared kitchenStockFor */
export const kitchenStockForSkus = (skus: SKU[], skuIdsInput: string[]): Promise<Record<string, number>> => kitchenStockFor(supabase, skus, skuIdsInput);
