# Review: 6 audit fixes in commit 78b3519

Traced each commit against the current code. Verdict per fix below.

---

## 1. Branch-context StockCard anchor — **CORRECT**
`src/components/StockCard.tsx` lines 158–440.

- Anchor lookup correctly filters `is_submitted = true` and `physical_count IS NOT NULL`, and only returns counts strictly `< resolvedStartDate` — unsubmitted / null drafts can't poison the anchor.
- The day-by-day loop now walks from `effectiveStartDate` (anchor date) to today. `prevBalance = nextBalance` is assigned on **every** path: on the pre-window `continue`, on the no-activity `continue`, and on the display push. So skipped/hidden days still advance the running balance — the classic bug of "forgetting to advance state on `continue`" is not present.
- Never-counted branch: `anchor` is `null` → `effectiveStartDate = resolvedStartDate`, no gap days walked, `prevBalance` starts at 0 — identical to pre-fix behavior, as intended.
- Minor observation (not a bug): the anchor day itself only snaps prevBalance to `physicalCount`; if a receipt/sale/adj also happened that day it's still captured through the day's normal aggregation before the snap. Consistent with the SM ledger convention.

## 2. RM/PK Opening-row gap fold — **CORRECT**
`src/components/StockCard.tsx` lines 518–556.

- Gap query boundaries: `.gt(count_date).lt(fromDate)` for both goods_receipts and stock_adjustments. Main in-window queries (lines 450, 459) use `.gte(fromDate)`. **No overlap, no double-count** — gap is strictly `< fromDate`, in-window is `>= fromDate`.
- Converter applied to gap goods_receipts (`× converter`) — matches how in-window receipts are converted downstream.
- "Stock Count" reason exclusion in gap adjustments matches the canonical anchor formula.
- Anchor-day activity: anything ON `count_date` is neither in gap (`.gt`) nor in the main window (`.gte fromDate` when count < fromDate) — but this is the standing convention (physical count is "as-of" that date; same-day movements are subsumed into the snap). Consistent with the SM path and with `use-stock-data.ts`.

## 3. CK Dashboard Distribution — **CORRECT**
`src/hooks/use-ck-dashboard-data.ts` lines 496–528.

- Now uses `TO_DELIVERED_STATUSES` and `computeToLineQty` from `src/lib/to-line-qty.ts`. Grep confirms this is the single formula also used by `use-sm-stock-data.ts` and `StockCard.tsx`.
- Behavior change to flag (intentional, but worth calling out to Bucci): Sent TOs with `actual_qty = 0` (or null) now contribute `planned_qty × unit_cost` to the Distribution Summary, whereas before they contributed nothing. This is exactly what makes it agree with SM Stock, but the dashboard total for the current in-flight period **will nudge up** vs. yesterday's number if any recent Sent TOs haven't had actuals entered yet. Not a bug — that's the whole point of the fix.
- `Partially Received` now included, matching SM/RM stock.

## 4. `use-branch-sm-stock.ts` — **CORRECT with one minor perf note**
`src/hooks/use-branch-sm-stock.ts` lines 324–410.

- Conditional `.gt()` chaining is valid Supabase JS pattern (reassign `query = query.gt(...)`) — filters compose correctly.
- CK receipts / external receipts / adjustments queries are all further bounded by `.eq("branch_id", branchId)` and `.in("sku_id", skuIds)` — even when `earliestSnap` is null, the result set is bounded by branch+SKU list. Safe.
- `.in("reason")`-style filter isn't applied SQL-side; instead the "Stock Count" exclusion is done in JS on the fetched rows. Fine functionally; results are correct.
- **Minor perf concern (not correctness):** the sales query is scoped by branch and by date `<= todayStr`, but it has **no `.in("menu_code", …)` filter** and no lower bound when `earliestSnap` is null. For a brand-new branch (no snap anywhere in the batch) this fetches the branch's entire sales history. In practice a branch always has at least one snap for at least one SM SKU very quickly, so this window is small — but flagging it in case a truly untouched branch ever hits this path.

## 5. `checkLotsAndSend` fallback — **CORRECT**
`src/pages/TransferOrder.tsx` line 765.

- New chain `packsOverride[l.id] ?? l.packsCount ?? Math.round(l.actualQty / ps)` matches the other three fallback sites in the file (266, 1454, 2224).
- Common-case is a no-op: whenever `packsOverride[l.id]` is defined (which is the normal seeded state), the second and third terms aren't evaluated → identical behavior.
- Only changes the rare "override momentarily unseeded" path, and in the right direction (persisted `packsCount` beats weight-derived guess).

## 6. SM delivery boundary → `updated_at` — **CORRECT BUT WITH A REAL CAVEAT TO FLAG**
`src/hooks/use-sm-stock-data.ts` lines 40, 101–147, 161–171, 347–374.

Correctness of the mechanical change: both initial load and `refreshToDelivered` fetch `updated_at`, both map it into `toUpdatedAtMap`, both fall back to `delivery_date` when null. The comparison `l.deliveredAt > anchor.completed_at` is symmetric with the production side. No divergence between the two code paths. Good.

**However — the caveat you specifically asked about is real.** `transfer_orders.updated_at` is written by Postgres/Supabase (or a trigger) on any UPDATE to the row, not just on the send event. Concretely, in this codebase:

- `sendTO` writes to `transfer_orders` → bumps `updated_at` to the send moment. ✅ intended.
- `saveTOEdits` (edit-after-send) writes to `transfer_orders` → bumps `updated_at` to the **edit** moment. ⚠️
- Status changes to `Received` / `Partially Received` / `Declined` from the branch-receipt flow write to `transfer_orders` → bump `updated_at` to the receive moment, not the send moment. ⚠️
- Notes / delivery-date edits on a Sent TO → bump `updated_at`.
- Line-level edits (`transfer_order_lines`) do NOT bump the parent's `updated_at` unless there's a trigger — I did not find one in the migrations.

Concrete scenario this can produce: CK sends TO on Monday, physical count runs Tuesday morning (count anchor = Tue 09:00). Branch marks the TO Received on Tuesday afternoon → `transfer_orders.updated_at` moves to Tue afternoon. Now `deliveredAt (Tue PM) > anchor.completed_at (Tue AM)` is **true** → the same delivery that was correctly deducted before is now deducted *again* on top of the post-count anchor, silently double-counting the deduction and understating SM stock.

The pre-fix code (comparing `delivery_date > count_date`) had the opposite same-day bug (missed a same-day-after-count delivery). The new code correctly handles the same-day-after-count case, but introduces a **timestamp-drift** bug whenever anything mutates the TO row after the delivery moment.

Recommendation (not implementing — review only): consider persisting a dedicated `sent_at` / `delivered_at` timestamp column that's written once at send/receive time and never mutated by later edits, and compare against that instead of `updated_at`. Until then, this fix trades a rare edge case for a more common one. Worth Bucci's explicit go/no-go before we consider #6 truly closed.

---

## Summary
- Fixes 1, 2, 3, 5 — clean, no concerns.
- Fix 4 — correct; one minor perf note on the sales query when a brand-new branch has no snaps anywhere.
- Fix 6 — mechanically correct and matches production's semantics, **but** `updated_at` isn't a stable delivery timestamp; recommend a follow-up to introduce a dedicated column before considering this fully resolved.

No code changes proposed here — this is a review only.
