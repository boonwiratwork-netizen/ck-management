/**
 * Single source of truth for "does this modifier rule fire on this sale line?".
 * Every screen that turns sales into ingredient usage must call this, so the
 * same setup gives the same numbers everywhere (Food Cost, Daily Stock Count,
 * branch RM/SM stock, Transfer Request, Store Stock, Stock Card).
 *
 * - Keyword match ignores upper/lower case.
 * - Submenu rules also match when the POS sends the set item's code as menu_code;
 *   usually the code sits inside menu_name ("Set Menu : MN-011 …").
 */
export interface RuleLike {
  keyword: string;
  ruleType?: string;
  rule_type?: string;
}

export interface SaleLike {
  menu_code?: string | null;
  menu_name?: string | null;
}

export function ruleMatchesSale(rule: RuleLike, sale: SaleLike): boolean {
  const keyword = (rule.keyword || "").trim();
  if (!keyword) return false;
  const name = (sale.menu_name || "").toLowerCase();
  const type = rule.ruleType ?? rule.rule_type;
  if (type === "submenu" && sale.menu_code === keyword) return true;
  return name.includes(keyword.toLowerCase());
}
