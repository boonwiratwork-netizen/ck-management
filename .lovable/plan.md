# Transfer Order / Stock flow — correctness audit

Diagnosis only. No fix applied. Findings ordered by confidence.

## HIGH confidence (real bugs)

### 1. `use-ck-dashboard-data.ts:499` — TO status filter missing "Partially Received", and second divergent qty formula
```ts
.in('status', ['Sent', 'Received'])          // missing "Partially Received"
...
if (!to || tl.actual_qty <= 0) continue;      // no fallback to planned_qty for "Sent"
const val = tl.actual_qty * tl.unit_cost;
```
Two independent violations of the invariant from fixes #4 / `to-line-qty.ts`:
- "Partially Received" TOs are silently excluded from the Distribution Summary (SM/RM values by branch understated).
- A third, hand-rolled "delivered quantity" formula that ignores `computeToLineQty`'s `Sent → planned_qty` fallback. A "Sent" TO with no `actual_qty` yet entered contributes 0 to the dashboard but non-zero to SM Stock / StockCard, so the dashboard and the stock pages will disagree.

Should be `TO_DELIVERED_STATUSES` + `computeToLineQty(...)`, matching every other stock-side caller.

### 2. `StockCard.tsx:481-490` — RM CK ledger: pre-window count gap NOT folded (same bug fix #5 addressed for SM)
```ts
if (preWindowCount) {
  mvts.push({
    ...
    qtyIn: preWindowCount.physical_qty,   // no gap production/receipts/adj added
    ...
```
When the last physical RM count is older than the 14/30-day window, movements between `count_date` and `fromDate` are silently dropped from the Opening figure. Compare to the SM path a few hundred lines below (664-711) which correctly folds `gapProd - gapDel + gapAdj` (excluding "Stock Count" adjustments). Consequence: RM StockCard will flash false "Balance mismatch" banners and its Opening won't reconcile with RM Stock's `currentStock`. This is exactly the shape of the just-fixed SM bug.

### 3. `StockCard.tsx:158-404` — branch-context ledger silently starts from zero
```ts
let prevBalance = 0;
for (const date of allDates) { ... }
```
The branch ledger initialises `prevBalance = 0` at the start of the window and only queries data from `resolvedStartDate` onward. There is no pre-window `daily_stock_counts.physical_count` anchor read, no opening-balance fetch, no gap fold. If the SKU already had any real stock before the window opens (the normal case), the first activity day's calculated_balance starts from 0 and every downstream `variance = physical - calc` will be wrong until the branch happens to enter a physical count inside the window. Same category as fix #5, unfixed on this path.

### 4. `use-branch-sm-stock.ts:328` — arbitrary "2020-01-01" baseline when no snap exists
```ts
let earliestSnap = "2020-01-01";
```
This is the same anti-pattern fix #6 removed from StoreStock: a hardcoded date used when a SKU has no `daily_stock_counts` history. Because `earliestSnap` is later used with `.gt(receipt_date, earliestSnap)` etc., a SKU that has receipts before 2020 (unlikely) or a system-clock skew produces wrong totals; more importantly, `snapBySku[sku_id]` is optional per-SKU inside the aggregation loop that follows, so any SKU never snapped uses this floor date — silently including years of movements as "post-snap". Confirm behaviour matches intent; either way, the "2020-01-01" literal is the same code-smell fix #6 flagged.

### 5. `use-branch-sm-stock.ts:358-364` — branch adjustments query does not exclude "Stock Count" reason
```ts
supabase.from("stock_adjustments")
  .select("sku_id, quantity, adjustment_date")
  .eq("branch_id", branchId)
  .gt("adjustment_date", earliestSnap)
```
Every other anchor-based path (`use-sm-stock-data.ts:166`, `use-stock-data.ts:96`, `StockCard.tsx:541/701/815`) filters out `reason includes 'Stock Count'` — this one doesn't. Any branch-level Stock Count adjustment after the snap will be double-counted (once via the physical count anchor, once via this sum). Currently might be unreachable if branch counts never generate `stock_adjustments`, but it violates the documented invariant and is the same shape as the defensive filter added in fix #7.

### 6. `StockCard.tsx:281-323` — submenu / all rule types still use boolean `.includes(keyword)` in branch context
```ts
if (!menuName.includes(keyword)) continue;
```
The count-based submenu-match fix (`matchCount = menuName.split(keyword).length - 1`) that the user asked for last week is NOT present in this file (search for "matchCount" / "split(keyword)" returns no hits across the repo). Same regression pattern in `use-daily-stock-count.ts:200` and `:511`, `use-branch-rm-stock.ts:329/341/440/455`, and `StoreStock.tsx:115`. A Delivery Set containing the same submenu keyword twice (customer picked the same ramen for both bowls) is only expanded once → RM/SM usage understated → cover day / balance mismatch. Either the earlier fix was reverted, or it was never merged; either way the current code does not do count-based matching anywhere.

## MEDIUM confidence

### 7. `use-sm-stock-data.ts:161` — deliveries anchored on `delivery_date > count_date` while production uses `completed_at`
```ts
const producedAfter = ... > anchor.completed_at
const deliveredAfter = ... l.delivery_date > anchor.count_date
```
Asymmetric anchoring: a TO delivered on the same day as (but after) the count is treated as pre-anchor and NOT deducted — under-deducts real out-flow. The production side was moved to timestamp-based comparison in fix #5's sibling work; the delivery side wasn't. `transfer_orders.delivery_date` is date-only, so a full fix requires using `updated_at` for the "shipped after count" test (as StockCard's SM sort key already does at line 803). Real risk on count days that also had a same-day delivery.

### 8. `TransferOrder.tsx:257-272` — `packsOverride` seed effect keyed on `formState?.lines.length`
```ts
useEffect(() => { ... }, [formState?.toId, formState?.lines.length, skus]);
```
If a line is deleted AND another added in the same render tick (length unchanged), or if a server-side `packsCount` mutates without the local `lines.length` changing, the seed won't re-run and `packsOverride` stays stale. `checkLotsAndSend` (line 765) then compares assigned lots against a stale pack count and either blocks a legitimate send or lets through a real mismatch. Low practical incidence, but the dependency array is a classic footgun.

### 9. `TransferOrder.tsx:765` — send-time lot check fallback derives packs from weight
```ts
const currentPacks = packsOverride[l.id] ?? Math.round(l.actualQty / ps);
```
The fallback is `actual_qty / packSize`, not `line.packsCount ?? Math.round(...)`. In every other place (lines 266, 1454, 2224) the priority is `packsOverride → packsCount → derived`. If the seed effect above ever misses a line, the send-guard silently reverts to weight-derived packs, defeating the very invariant fix #3 protects. Small code drift, easy to bring into line with the other three sites.

## LOW confidence / stylistic

### 10. `use-transfer-order.ts:189` — pack size seeding uses `Number(s.pack_size) || 0`
Falsy coerce (`|| 0`) turns a legitimate `pack_size = 0` and `null` into the same thing — fine here because both correctly bypass `packs_count` seeding, but flagged only because the same pattern in a stock formula would be silently wrong.

### 11. `TransferOrder.tsx:1451` — `requestedPacks = Math.round(line.plannedQty / packSize)`
`plannedQty` is not user-entered as packs on the TR side either, so recomputing is defensible. Not a bug, but worth noting: if the TR ever gains its own `packs_count`, this display would silently diverge for exactly the same reason fix #3 was needed on TO.

### 12. `BranchReceipt.tsx:1010` and `:331` — branch's TO view does not `select packs_count`
Branch never sees the CK-declared pack count; the branch inputs its own `receivedQty` and derives packs from `receivedQty / packSize`. Not a correctness bug for balances (receipts are stored in grams both sides), but a traceability gap: if CK sent "25 packs, 9500g" and the branch inputs "27 packs, 9500g", nothing in the UI surfaces the mismatch. Low-priority.

## Explicit confirmations (nothing to fix)

- Fix #1 (delete TR-originated TO line → decline source TR line): in place.
- Fix #2 (over-stock warning uses same anchor formula for SM and equivalent for RM/PK): `computeCurrentStockForSkus` at TransferOrder.tsx:280 is the single source both the send warning and the lot-cap effect call.
- Fix #3 (weight input does not touch `packs_count`): reverted state confirmed at TransferOrder.tsx:1638 comment + `use-transfer-order.ts:258` `if (packsCount !== undefined)` guard. No other file writes `packs_count`.
- Fix #4 (shared `computeToLineQty` and `TO_DELIVERED_STATUSES`): used in `use-sm-stock-data.ts` and `StockCard.tsx`. Divergent copies remain only in `use-ck-dashboard-data.ts` (finding #1).
- Fix #5 (SM StockCard gap fold): in place at lines 664-711.
- Fix #6 (StoreStock 90-day cutoff removed): no other page has a `90` cutoff on the anchor.
- Fix #7 (DSC gap-period Stock-Count exclusion): in place; the same defensive filter is missing on `use-branch-sm-stock.ts` (finding #5).
- Lot-assignment SM gating: `TransferOrder.tsx:552` and `:762` both check `sku.type === "SM"`, not `packSize > 0`. No stale `packSize > 0` guard remains for lot logic.
- `transfer_order_lot_lines` is read only for display (`StockCard.tsx:774` for lot chips, `TransferOrder.tsx` UI). No stock/dashboard/food-cost number depends on it.
