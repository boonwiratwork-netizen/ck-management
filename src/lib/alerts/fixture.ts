// Test fixtures for the alert rules (not shipped: only *.test.ts files import it)
import type { AlertData } from "../../../supabase/functions/_shared/alerts/types.ts";
import { parseConfig, type AlertConfig, type RuleConfig, type RuleId } from "../../../supabase/functions/_shared/alerts/config.ts";

/** Monday 9 Nov 2026, 08:00 Bangkok */
export const NOW = Date.parse("2026-11-09T08:00:00+07:00");
export const at = (s: string) => Date.parse(`${s}+07:00`);
export const iso = (s: string) => new Date(at(s)).toISOString();

export function data(over: Partial<AlertData> = {}): AlertData {
  return {
    nowMs: NOW,
    today: "2026-11-09",
    branches: [
      { id: "b1", name: "Sendo สยาม", brand: "Sendo" },
      { id: "b2", name: "Shiro อารีย์", brand: "Shiro" },
    ],
    skus: [
      { id: "s1", code: "RM-001", name: "หมูสามชั้น", type: "RM", packSize: 0, uom: "g" },
      { id: "s2", code: "SM-001", name: "ซอสโชยุ", type: "SM", packSize: 500, uom: "g" },
      { id: "s3", code: "RM-002", name: "ไข่ไก่", type: "RM", packSize: 0, uom: "ฟอง" },
    ],
    tos: [],
    toLines: [],
    receipts: [],
    counts: [],
    salesDaily: [],
    priceChanges: [],
    stdPrice: new Map([
      ["s1", 0.2],
      ["s2", 0.1],
      ["s3", 4],
    ]),
    plans: [],
    production: [],
    kitchenMonth: { sessions: [], lines: [], producedSm: [], recipeRm: new Map() },
    foodCostMonthly: [],
    newItems: [],
    baselines: new Map(),
    ...over,
  };
}

export const config = (): AlertConfig => parseConfig([]);
export const cfg = (rule: RuleId, patch: Partial<RuleConfig> = {}): RuleConfig => ({ ...config().rules.get(rule)!, ...patch });
