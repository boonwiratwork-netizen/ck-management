import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { SKU } from "@/types/sku";
import { Price } from "@/types/price";
import { Branch } from "@/types/branch";
import { Supplier } from "@/types/supplier";
import BranchReceiptMobilePage from "./BranchReceiptMobile";

const skuToLocal = (row: any): SKU => ({
  id: row.id,
  skuId: row.sku_id,
  name: row.name,
  type: row.type,
  category: row.category,
  status: row.status,
  specNote: row.spec_note,
  packSize: row.pack_size,
  packUnit: row.pack_unit,
  purchaseUom: row.purchase_uom,
  usageUom: row.usage_uom,
  converter: row.converter,
  storageCondition: row.storage_condition,
  shelfLife: row.shelf_life,
  vat: row.vat,
  supplier1: row.supplier1,
  supplier2: row.supplier2,
  leadTime: row.lead_time,
  isDistributable: row.is_distributable ?? false,
});

const priceToLocal = (row: any): Price => ({
  id: row.id,
  skuId: row.sku_id,
  supplierId: row.supplier_id,
  pricePerPurchaseUom: row.price_per_purchase_uom,
  pricePerUsageUom: row.price_per_usage_uom,
  vat: row.vat,
  isActive: row.is_active,
  effectiveDate: row.effective_date,
  note: row.note,
});

const supplierToLocal = (row: any): Supplier => ({
  id: row.id,
  name: row.name,
  leadTime: row.lead_time,
  moq: row.moq,
  moqUnit: row.moq_unit,
  contactPerson: row.contact_person ?? "",
  phone: row.phone ?? "",
  creditTerms: row.credit_terms,
  status: row.status,
});

const branchToLocal = (row: any): Branch => ({
  id: row.id,
  branchName: row.branch_name,
  brandName: row.brand_name,
  location: row.location,
  status: row.status,
  avgSellingPrice: row.avg_selling_price ?? null,
});

export default function MobileApp() {
  const { role, isManagement, isStoreManager, isCkManager, sessionLoading, profileLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [skus, setSkus] = useState<SKU[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  const allowed = isManagement || isStoreManager;
  const canReadFullSuppliers = isManagement || isCkManager;

  useEffect(() => {
    if (sessionLoading || profileLoading) return;
    if (!allowed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const supplierQuery = canReadFullSuppliers
        ? supabase.from("suppliers").select("*").order("created_at", { ascending: false })
        : supabase.from("suppliers_safe" as any).select("*").order("created_at", { ascending: false });

      const [skuRes, priceRes, supplierRes, branchRes] = await Promise.all([
        supabase.from("skus").select("*").order("created_at", { ascending: false }),
        supabase.from("prices").select("*").order("created_at", { ascending: false }),
        supplierQuery,
        supabase.from("branches").select("*").order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      setSkus(((skuRes.data as any[]) || []).map(skuToLocal));
      setPrices(((priceRes.data as any[]) || []).map(priceToLocal));
      setSuppliers((((supplierRes as any).data as any[]) || []).map(supplierToLocal));
      setBranches(((branchRes.data as any[]) || []).map(branchToLocal));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionLoading, profileLoading, allowed, canReadFullSuppliers, role]);

  if (sessionLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        กำลังโหลด...
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Access denied
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        กำลังโหลด...
      </div>
    );
  }

  return (
    <BranchReceiptMobilePage
      skus={skus}
      prices={prices}
      branches={branches}
      suppliers={suppliers}
    />
  );
}
