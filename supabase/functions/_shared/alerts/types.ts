// Push alerts: what a rule reads and what it hands back. Plain TypeScript, relative imports only.

import type { RuleConfig, RuleId, Tier } from "./config.ts";
import type { CountLine, PlanLine, ProductionRun, TransferLine, TransferOrder } from "../team-score.ts";

export type Severity = "high" | "medium" | "low";

/** Where a case's button goes in the app (the app turns it into a page + branch + day) */
export type CaseLink =
  | { page: "count"; branchId: string; date: string }
  | { page: "sales"; branchId: string; date: string }
  | { page: "transfer" }
  | { page: "price"; skuCode: string }
  | { page: "admin"; teamId?: string }
  | { page: "kitchen-count" }
  | { page: "food-cost" }
  | { page: "production" };

/** What a rule found: one case per thing that is wrong, keyed so it is the same case tomorrow */
export interface CaseCandidate {
  /** Stable: e.g. price_rise:<sku_id>, count_diff:<branch>:<date>, to_unreceived:<to_id>, team_red:<branch> */
  key: string;
  rule: RuleId;
  title: string;
  detail: string;
  severity: Severity;
  /** The size of the problem (baht, %, days…) — compared for "got worse" */
  value: number;
  /** What "ใช้ราคานี้เป็นปกติ" sets as the new normal (price cases: today's price) */
  baselineCandidate?: number;
  scope: { branchId?: string; date?: string; toId?: string; skuId?: string };
  link: CaseLink;
  /** Same habit = same branch failing the same daily rule (count_diff:<branch>) */
  habitKey?: string;
  /** The day it failed (habit counting) */
  habitDay?: string;
  /** The habit in words, for its one digest line ("Sendo สยาม นับ diff เกิน ฿1,000") */
  habitLabel?: string;
  /**
   * Still there but not news: keeps an open/acknowledged case alive without telling anyone
   * (a price that rose but stands at the price set as normal). Never opens or reopens a case.
   */
  quiet?: boolean;
}

/** A line of a digest that isn't a case (close-of-day numbers, weekly scores, month close) */
export interface InfoLine {
  rule: RuleId;
  text: string;
  link?: CaseLink;
}

export interface RuleOutput {
  cases: CaseCandidate[];
  info: InfoLine[];
}

// ─── What the rules read (alerts-run loads only what the evaluated rules need) ───

export type DataNeed =
  | "tos"
  | "toLines"
  | "receipts"
  | "counts"
  | "salesDaily"
  | "prices"
  | "plans"
  | "production"
  | "kitchenMonth"
  | "foodCostMonthly"
  | "newItems";

export interface BranchInfo {
  id: string;
  name: string;
  brand: string;
}
export interface SkuInfo {
  id: string;
  code: string;
  name: string;
  type: string;
  packSize: number;
  uom: string;
}
export type AlertTransferOrder = TransferOrder & { decline_reason: string | null; updated_at: string | null };
export type AlertCountRow = CountLine & { branch_id: string };
/** sales_entries summed per branch and day (SQL function alerts_sales_daily) */
export interface SalesDay {
  branch_id: string;
  sale_date: string;
  /** The first sales row saved for the day */
  first_created_at: string;
  net_amount: number;
}
export interface PriceRow {
  sku_id: string;
  price_per_usage_uom: number;
  valid_from: string;
}
/** Last month's kitchen count, for the shared ≥50%-of-RM rule (../month-count.ts) */
export interface KitchenMonth {
  /** Completed sessions within ±3 days of last month's end */
  sessions: { id: string; count_date: string; status: string }[];
  /** Their RM lines */
  lines: { session_id: string; sku_id: string; physical_qty: number | null }[];
  /** SM items made last month */
  producedSm: string[];
  /** SM → RM items in its recipe */
  recipeRm: Map<string, string[]>;
}
export interface FoodCostMonthRow {
  branch_id: string;
  month: string;
  revenue: number;
  std_cost: number | null;
  has_recipe_cost: boolean;
  is_closed_month: boolean;
  computed_at: string;
}
export interface NewItem {
  kind: "menu" | "sku";
  name: string;
  created_at: string;
}

export interface AlertData {
  nowMs: number;
  /** Bangkok day of nowMs */
  today: string;
  branches: BranchInfo[];
  skus: SkuInfo[];
  tos: AlertTransferOrder[];
  toLines: TransferLine[];
  receipts: { transfer_order_id: string; created_at: string }[];
  counts: AlertCountRow[];
  salesDaily: SalesDay[];
  /** price_history, every change */
  priceChanges: PriceRow[];
  /** Today's standard price (the newest active price row of each item) */
  stdPrice: Map<string, number>;
  plans: PlanLine[];
  production: ProductionRun[];
  kitchenMonth: KitchenMonth;
  foodCostMonthly: FoodCostMonthRow[];
  newItems: NewItem[];
  /** "ใช้ราคานี้เป็นปกติ": case key → the price set as normal and when (ms) */
  baselines: Map<string, { price: number; setAt: number }>;
}

export interface AlertRule {
  id: RuleId;
  /** case = opens/closes cases; info = lines in a digest only */
  kind: "case" | "info";
  needs: DataNeed[];
  evaluate(data: AlertData, cfg: RuleConfig): RuleOutput;
}

/** The tier a rule's news goes out on (from its settings) */
export type { Tier };
