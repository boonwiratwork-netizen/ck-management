## Goal
When the CK manager edits PACKS on a Transfer Order line, keep the line's Lot Assignment total exactly equal to the new pack count (FIFO), and block Send if any line's lot total still doesn't match.

## Scope
Single file: `src/pages/TransferOrder.tsx`. No other files, no UI redesign, no schema changes.

## Part 1 — Auto-reconcile Lot Assignment on PACKS blur

Add a new helper `reconcileLotsToPacks(lineId, skuId, newPacks, packSize)` and call it from the PACKS input's `onBlur` (line ~1068) instead of the current "only auto-fill when empty" block. The helper runs after `handleLineUpdate(line.id, "actualQty", grams)`.

Behavior:

1. Read current lots from `lotLinesRef.current[lineId]` and available production records from `prodRecordsMapRef.current[skuId]` (already sorted oldest → newest).
2. Compute `assigned = sum(lot.packs)`.
3. If `newPacks === assigned` → nothing to do.
4. If `newPacks < assigned` (trim / clear-to-zero case):
   - Walk existing lots from the end of the array backward (newest first, since records were fetched ascending and both auto-fill and manual add preserve that order).
   - Reduce each lot's packs to absorb the overage; if a lot reaches 0, mark it for deletion.
   - For each deleted lot with a persisted `id`, call `supabase.from("transfer_order_lot_lines").delete().eq("id", ...)`.
   - For each surviving lot with changed packs, call `handleLotLineSave(lineId, idx, updatedLot)`.
   - Update `lotLines` state so trimmed-to-zero rows are removed from the array (mirrors `handleDeleteLotLine`).
   - When `newPacks === 0`, this naturally clears the entire array.
5. If `newPacks > assigned` (top up):
   - `remaining = newPacks - assigned`.
   - Build a set of `productionRecordId`s already present in current lots.
   - Iterate `records` oldest → newest, skipping any already present; append new `LotLineLocal` entries with `packs = remaining` on the first unused record and stop.
   - Fallback when no unused older record exists (all records already assigned): add the remainder to the newest existing lot (last entry) by increasing its packs, so the invariant `assigned === newPacks` is always restored.
   - Fallback when there are zero production records at all: leave lots empty; Part 2's guard will surface the mismatch at Send time.
   - Persist via `handleLotLineSave` for new/modified rows.
6. Silent: no toasts, no confirm dialogs.
7. Keep the existing `handleLineUpdate` call unchanged and keep the `key` `packs-${line.id}` so the input still resets its display after state updates.

## Part 2 — Send-time validation

In `handleSend` (line ~463), before `setFormSending(true)` and after the existing `actualQty < 0` guard, add a lot-mismatch check:

- For each line where `packSize > 0`:
  - `currentPacks = round(line.actualQty / packSize)`
  - `assignedPacks = sum(lotLines[line.id]?.packs)`
  - If `currentPacks !== assignedPacks` → collect `line.skuCode` (or `skuName`).
- If any mismatches: `toast.error("Lot mismatch: <code1>, <code2> — please fix Lot Assignment before sending")` and return without calling `sendTO`.
- Lines with `packSize === 0` (weight-only SM) are skipped from this check because they have no lot UI.

## Out of scope / preserved

- Draft save (`handleSaveDraft`), edit-sent flow (`saveTOEdits`), cancel, delete TO, and standalone line add stay untouched.
- Lot Assignment sub-row UI (chevron expand, per-lot dropdowns, add/delete buttons) unchanged.
- Weight override input on `WEIGHT (g)` column unchanged (reconciliation is only tied to PACKS input per the request).
- No changes to `useTransferOrder` hook or DB schema.

## Verification checklist

1. Open a TO with multi-lot assignment, reduce PACKS → newest lot trims first; total matches.
2. Reduce PACKS to 0 → all lot rows for that SKU deleted from DB and state.
3. Increase PACKS → next unused older record picks up the remainder; if none, newest existing lot absorbs it.
4. Force a mismatch (e.g. manually edit a lot dropdown so two lots point to same record, or add a lot then delete a production record row) and click Send → blocked with toast listing SKU codes.
5. Send a TO where PACKS and Lot Assignment already match → sends normally, no regression.
6. Save Draft still saves without triggering lot validation.
