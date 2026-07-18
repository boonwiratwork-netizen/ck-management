# CK Manager — CLAUDE.md

Central Kitchen + Store Management app for **Live to Eat Group** (multi-brand restaurant operation). Manages inventory flow between a central kitchen (CK) and branch stores: production, transfers, receiving, stock counts, sales, and food cost.

**Owner:** Bucci — product owner, not a developer. Speak in product terms (user flows, operational impact, tradeoffs), not code jargon, unless implementation detail is explicitly requested.

Live app: `livetoeat-scm.lovable.app` · Repo: `boonwiratwork-netizen/ck-management` (main) · Built originally on Lovable.dev, migrating to Claude Code.

---

## Stack & commands

- **Frontend:** React 18 + TypeScript + Vite, Tailwind + shadcn/ui (Radix), lucide-react icons
- **Backend:** Supabase (PostgreSQL + RLS + Edge Functions)
- **State/data:** custom hooks per domain (`src/hooks/use-*.ts`), no Redux
- **Path alias:** `@/` → `src/`

```bash
npm run dev          # local dev server (vite)
npm run build        # production build — run before declaring a change done
npm run lint         # eslint
npm run test         # vitest run (jsdom)
npm run test:watch   # vitest watch
```

Always run `npm run build` and `npm run test` before considering a change complete.

---

## Repo layout

```
src/
  pages/          # one file per screen (TransferOrder.tsx, DailyStockCount.tsx, FoodCost.tsx, ...)
  hooks/          # domain data hooks (use-sm-stock-data.ts, use-transfer-order.ts, ...)
  components/     # shared components; components/ui = shadcn primitives
  types/          # domain TS types (sku.ts, bom.ts, stock.ts, ...)
  lib/            # design-tokens.ts, translations.ts, utils.ts, bom-export.ts, bom-price-sync.ts
  integrations/supabase/   # client.ts (the Supabase client), types.ts (generated DB types)
supabase/migrations/       # 37+ SQL migrations
```

Env vars (in `.env`, VITE_-prefixed for the client): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.

---

## Domain model

**Brands & branches:** Each branch belongs to one brand via `branches.brand_name`. Menus link to brands via `menus.brand_name` (brand-level, NOT branch-level — intentional). Brands: Sendo, Shiro, Thaniya, Wanmai.

**Roles** (`user_roles`, checked in `use-auth.tsx`): `management`, `ck_manager`, `store_manager`, `area_manager`. ~8 internal users under `@livetoeat.live`.

**SKU types — this distinction drives most logic:**
- **RM** (raw material) — purchased ingredients. Deducted by production.
- **SM** (semi-manufactured) — produced at CK from RM via BOM. **The only type with production lots.**
- **PK** (packaging) — consumables. Flow like "RM distributable" (TR→TO→Branch Receipt) but tracked with `stock_type = "PK"`. **No BOM, no lots, no cover day.**
- **SP** — store-level semi-prep, no CK inventory.

**Core inventory flow:**
```
CK: Goods Receipt (RM in) → Production (RM→SM via BOM) → Transfer Order (SM/PK/distributable-RM out to branches)
Store: Branch Receipt (goods in) → Sales Entry → Daily Stock Count (physical count = ground truth)
```

---

## Non-negotiable invariants

These are hard-won rules. Breaking them silently corrupts stock math. Do not "simplify" them away.

### Stock is a pooled anchor model
SM/store stock balance per SKU is computed as:
```
balance = latest physical-count anchor
          + production/receipts after anchor
          − deliveries after anchor
          + adjustments after anchor (EXCLUDING "Stock Count" adjustments)
```
Physical counts are **ground truth** — they snap the balance on entry and override calculated values. The canonical implementation is `use-sm-stock-data.ts`; replicate its exact formula if you ever need the balance elsewhere (see `TransferOrder.tsx` lot capping for a scoped copy). Never invent a second, divergent stock formula.

### Lots are SM-only and traceability-only
- Production lots exist **only for SM items**. RM and PK also have a `packSize`, so **never gate lot logic on `packSize > 0` alone** — always also require the SKU `type === "SM"`. (A regression here caused PK items to demand lot assignment and block sending.)
- `transfer_order_lot_lines` is a **pure traceability layer**. No stock/dashboard/food-cost number reads it. It is safe to filter/compute on for display, but it is NOT a source of truth and must never drive a balance.
- Lot dropdown filtering (in `TransferOrder.tsx`) caps visible lots by **current stock balance**: sort production runs newest-first, accumulate output until reaching current stock, hide older lots. Always keep the currently-selected lot visible; fall back to showing all if filtering leaves none.

### UOM architecture (do not change)
- **Purchase UOM** = what staff see when receiving. **Usage UOM** = what calculations use (usually grams).
- `Usage QTY = Purchase QTY × pack_size × converter`. Converter applied **only** at Daily Stock Count read time for the EXT. RECEIVED column — NOT at Goods Receipt storage, Branch Receipt, or Physical Count input.
- SM quantities are stored in grams (`actual_output_g`, `qty_delivered_g`). `production_records.actual_output_g` is unit-agnostic despite the name.
- `prices.price_per_usage_uom` is pre-converted price per gram (`unit_price ÷ pack_size ÷ converter`).

### Negative values
- Display columns (RM/SM/Store stock, StockCard running balance, Daily Stock Count calc. balance) **show real negative values** (audit tool) — negatives are intentional (BOM usage diverges from real ops).
- All monetary/stock-**value** cells clamp: `Math.max(0, value)`.
- Physical count inputs: `min={0}` + onBlur clamp to 0.

### Table & input patterns
- Inputs in tables: **`defaultValue` + `onBlur`**, never controlled `value` + `onChange` (see `GoodsReceiptTable.tsx`). For keyboard nav, call `blur()` before `focus()` so the save fires before the row moves.
- Tables: `table-fixed` with `<colgroup>`, always `style={{ width: 'Npx' }}` (not `width="N"`).
- Pagination/queries: always end Supabase queries with `.order("id")` as a tiebreaker.
- Slide-over drawers: plain `div` (fixed inset-y-0 right-0 z-[70]), NOT shadcn `Sheet`.
- No hardcoded colors — semantic tokens from `src/lib/design-tokens.ts`. No emoji — lucide icons only. Numbers: `font-mono text-right`.
- Mobile inputs: `fontSize ≥ 16px` to stop iOS auto-zoom.

---

## Key DB facts (Supabase)

- `to` is a **reserved word** in PostgreSQL — always alias in raw SQL.
- `stock_adjustments.reason` is the only type discriminator: `startsWith('Production:')` = production deduction; `includes('Stock Count')` = count variance; `startsWith('Distribution:')` = TO deduction; else = manual adjustment.
- `stock_adjustments.branch_id IS NULL` = CK-level; a value = branch-level. SM adjustments are CK-level (`branch_id IS NULL`).
- `branch_receipts.transfer_order_id IS NULL` = external supplier receipt (vs a TO receipt). CK-received-from-TO source of truth = `branch_receipts WHERE transfer_order_id IS NOT NULL` — NOT `transfer_order_lines` filtered by status (status "Sent" ≠ arrived at branch).
- `daily_stock_counts.physical_count` is nullable (null = not counted). Has `received_from_ck` and `received_external` split columns.
- `menu_bom.branch_id`: null = global (all branches), a UUID = branch-specific override. **Every query reading menu_bom for usage must filter** `.or('branch_id.is.null,branch_id.eq.[branchId]')`, else other branches' BOM lines inflate avgDaily → wrong cover day/ROP/parstock.
- `transfer_orders.status`: Draft → Sent → Received / Partially Received / Declined (free text). `decline_reason` nullable.
- `transfer_order_lines.packs_count`: nullable int — the manager's explicit pack count, persisted so history doesn't re-derive packs from weight.
- Master tables (never wipe): `skus, sku_categories, suppliers, prices, bom_*, sp_bom, menus, menu_bom, menu_categories, modifier_rules, modifier_rule_menus, branches, profiles, user_roles, global_settings`.
- Transactional tables (wiped at go-live): `goods_receipts, production_records, deliveries, stock_adjustments, stock_*, sales_entries, branch_receipts, daily_stock_counts, transfer_requests, transfer_orders, weekly_plan_lines`.

---

## Calculation rules

- **avgDailyUsage** (unified across all pages/hooks): `(salesUsage + waste) / actualSaleDays`, where `salesUsage = Menu BOM × effective_qty + SP expansion + Modifier Rules`, `waste` from `daily_stock_counts.waste`.
- **Modifier rules** (`menu_modifier_rules`, keywords match menu **name** strings): swap/add → `sale.menu_name.includes(rule.keyword)`; submenu → `sale.menu_code === rule.keyword` (keyword IS the menu_code, e.g. "MN-011").
- **Cover Day scorecards:** weighted average `Σ(currentStock) ÷ Σ(dailyUsage)` per storage group, not a simple average.
- **Stock Value:** `price_per_usage_uom × Math.max(0, physical_count ?? calculated_balance)`.
- **Food Cost Act Qty:** `Opening (last physical count of prev month, fallback calc balance) + branch_receipts in period − Closing (last physical count this month, fallback calc balance)`. Don't add adjustments — closing already reflects them. Variance shows only for a past full month with a single branch selected.
- **CK Dashboard production cost:** `begin + purchased − end` per RM SKU. Ending count requires a valid RM session within ±3 days AND RM `physical_qty ≥ 50%` of RM SKUs; else estimated (period open) or blocked (period closed). Never fall back to a session outside that window.

---

## Working conventions

- **Diagnose before building.** When logic or data structure is unclear, inspect the actual source and the actual data first; don't guess column names (check `information_schema.columns`).
- **Verify deployment → data → code**, in that order, when a fix doesn't produce the expected result.
- **Surgical, targeted changes** over broad refactors. One concern at a time.
- **Stop and confirm with Bucci before destructive DB operations** (DELETE/UPDATE on production data) and before changing production write paths.
- SQL diagnosis/fixes run in the Supabase SQL Editor. CSV exports from that tool may use `;` separators.
- Prefer runtime inspection (console.log / a scratch test) over SQL guessing for in-memory calculation bugs.

---

## Reference implementations

- Table inputs (defaultValue+onBlur): `GoodsReceiptTable.tsx`
- Table layout (table-fixed + colgroup): `GoodsReceipt.tsx`
- Anchor-based stock formula: `use-sm-stock-data.ts`
- SM cover day (shared hook, used by Dashboard + SM Stock): `use-sm-daily-usage.ts`
- Lot capping by current stock: `TransferOrder.tsx` (`getVisibleRecords`)
- Branch relevance filter: Branch → `brand_name` → active menus → `menu_bom` ingredients → supplier active prices
