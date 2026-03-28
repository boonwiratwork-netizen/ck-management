import { useState, useCallback, useEffect } from "react";
import { ModifierRule } from "@/types/modifier-rule";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const toLocal = (row: any, menuIds: string[]): ModifierRule => ({
  id: row.id,
  keyword: row.keyword,
  skuId: row.sku_id,
  qtyPerMatch: Number(row.qty_per_match),
  uom: row.uom,
  description: row.description,
  isActive: row.is_active,
  menuId: row.menu_id ?? null,
  menuIds,
  ruleType: row.rule_type || "add",
  swapSkuId: row.swap_sku_id ?? null,
  submenuId: row.submenu_id ?? null,
  branchIds: row.branch_ids ?? [],
});

export function useModifierRuleData() {
  const [rules, setRules] = useState<ModifierRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from("menu_modifier_rules").select("*").order("created_at"),
      supabase.from("modifier_rule_menus" as any).select("rule_id, menu_id"),
    ]).then(([rulesRes, junctionRes]) => {
      if (rulesRes.error) {
        toast.error("Failed to load modifier rules");
        setLoading(false);
        return;
      }
      const junctionData = (junctionRes.data || []) as any[];
      const menusByRule = new Map<string, string[]>();
      junctionData.forEach((j: any) => {
        const arr = menusByRule.get(j.rule_id) || [];
        arr.push(j.menu_id);
        menusByRule.set(j.rule_id, arr);
      });
      setRules((rulesRes.data || []).map((r) => toLocal(r, menusByRule.get(r.id) || [])));
      setLoading(false);
    });
  }, []);

  const syncMenuIds = useCallback(async (ruleId: string, menuIds: string[]) => {
    // Delete all existing, then insert new
    await (supabase.from("modifier_rule_menus" as any) as any).delete().eq("rule_id", ruleId);
    if (menuIds.length > 0) {
      await (supabase.from("modifier_rule_menus" as any) as any).insert(
        menuIds.map((menu_id) => ({ rule_id: ruleId, menu_id })),
      );
    }
  }, []);

  const addRule = useCallback(
    async (data: Omit<ModifierRule, "id">) => {
      const { data: row, error } = await supabase
        .from("menu_modifier_rules")
        .insert({
          keyword: data.keyword,
          sku_id: data.skuId || null,
          qty_per_match: data.qtyPerMatch,
          uom: data.uom,
          description: data.description,
          is_active: data.isActive,
          menu_id: null, // deprecated, use junction table
          rule_type: data.ruleType,
          swap_sku_id: data.swapSkuId,
          submenu_id: data.submenuId,
          branch_ids: data.branchIds ?? [],
        })
        .select()
        .single();
      if (error) {
        toast.error("Failed to add rule: " + error.message);
        return null;
      }
      await syncMenuIds(row.id, data.menuIds);
      const newRule = toLocal(row, data.menuIds);
      setRules((prev) => [...prev, newRule]);
      return newRule;
    },
    [syncMenuIds],
  );

  const updateRule = useCallback(
    async (id: string, data: Partial<Omit<ModifierRule, "id">>) => {
      const dbData: any = {};
      if (data.keyword !== undefined) dbData.keyword = data.keyword;
      if (data.skuId !== undefined) dbData.sku_id = data.skuId;
      if (data.qtyPerMatch !== undefined) dbData.qty_per_match = data.qtyPerMatch;
      if (data.uom !== undefined) dbData.uom = data.uom;
      if (data.description !== undefined) dbData.description = data.description;
      if (data.isActive !== undefined) dbData.is_active = data.isActive;
      if (data.ruleType !== undefined) dbData.rule_type = data.ruleType;
      if (data.swapSkuId !== undefined) dbData.swap_sku_id = data.swapSkuId;
      if (data.submenuId !== undefined) dbData.submenu_id = data.submenuId;
      if (data.branchIds !== undefined) dbData.branch_ids = data.branchIds;

      const { error } = await supabase.from("menu_modifier_rules").update(dbData).eq("id", id);
      if (error) {
        toast.error("Failed to update rule: " + error.message);
        return;
      }

      if (data.menuIds !== undefined) {
        await syncMenuIds(id, data.menuIds);
      }

      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...data } : r)));
    },
    [syncMenuIds],
  );

  const deleteRule = useCallback(async (id: string) => {
    const { error } = await supabase.from("menu_modifier_rules").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete rule: " + error.message);
      return;
    }
    setRules((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { rules, loading, addRule, updateRule, deleteRule };
}
