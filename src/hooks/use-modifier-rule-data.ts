import { useState, useCallback, useEffect } from "react";
import { ModifierRule } from "@/types/modifier-rule";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { loadWithDeviceCopy } from "@/lib/base-cache";
import { fetchAllRows } from "@/lib/fetch-all";

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
    // Rules + their menu links as one device copy, so a saved copy never pairs
    // today's rules with yesterday's links
    const fetchRules = async () => {
      const [rulesRes, junctionRes] = await Promise.all([
        fetchAllRows((a, b) => supabase.from("menu_modifier_rules").select("*").order("created_at").order("id").range(a, b)),
        fetchAllRows((a, b) => (supabase.from("modifier_rule_menus" as any) as any).select("rule_id, menu_id").order("rule_id").order("menu_id").range(a, b)),
      ]);
      if (rulesRes.error) return { data: null, error: { kind: "rules" } };
      // Without the links every rule would look like "all menus": better to show nothing
      if (junctionRes.error) return { data: null, error: { kind: "links" } };
      const menusByRule = new Map<string, string[]>();
      (junctionRes.data as any[]).forEach((j) => {
        const arr = menusByRule.get(j.rule_id) || [];
        arr.push(j.menu_id);
        menusByRule.set(j.rule_id, arr);
      });
      return { data: (rulesRes.data as any[]).map((r) => ({ ...r, _menu_ids: menusByRule.get(r.id) || [] })), error: null };
    };
    loadWithDeviceCopy("modifier_rules", fetchRules, (rows: any[], fromDevice) => {
      setRules(rows.map((r) => toLocal(r, r._menu_ids || [])));
      if (fromDevice) setLoading(false);
    }).then(({ error }) => {
      if (error) toast.error((error as { kind: string }).kind === "links" ? "โหลดเมนูของกฎไม่สำเร็จ ลองรีเฟรช" : "Failed to load modifier rules");
      setLoading(false);
    });
  }, []);

  // Replace a rule's menu links. Returns an error message or null. A rule with no
  // links applies to EVERY menu, so callers must not report success on failure.
  const syncMenuIds = useCallback(async (ruleId: string, menuIds: string[]): Promise<string | null> => {
    const del = await (supabase.from("modifier_rule_menus" as any) as any).delete().eq("rule_id", ruleId);
    if (del.error) return del.error.message;
    if (menuIds.length > 0) {
      const ins = await (supabase.from("modifier_rule_menus" as any) as any).insert(
        menuIds.map((menu_id) => ({ rule_id: ruleId, menu_id })),
      );
      if (ins.error) return ins.error.message;
    }
    return null;
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
          // A rule limited to some menus starts off until its menu links are saved,
          // so it never counts against every menu in between
          is_active: data.menuIds.length > 0 ? false : data.isActive,
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
      if (data.menuIds.length > 0) {
        const linkError = await syncMenuIds(row.id, data.menuIds);
        const activate = !linkError && data.isActive ? await supabase.from("menu_modifier_rules").update({ is_active: true }).eq("id", row.id) : null;
        if (linkError || activate?.error) {
          await supabase.from("menu_modifier_rules").delete().eq("id", row.id);
          toast.error("บันทึกกฎไม่สำเร็จ: " + (linkError ?? activate?.error?.message));
          return null;
        }
        row.is_active = data.isActive;
      }
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
        const previous = rules.find((r) => r.id === id)?.menuIds ?? [];
        const linkError = await syncMenuIds(id, data.menuIds);
        if (linkError) {
          // Put the old links back so the rule doesn't turn into "every menu"
          await syncMenuIds(id, previous);
          toast.error("บันทึกเมนูของกฎไม่สำเร็จ: " + linkError);
          return;
        }
      }

      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...data } : r)));
    },
    [syncMenuIds, rules],
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
