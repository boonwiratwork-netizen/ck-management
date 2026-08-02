# Show Price / Pack for SM (BOM-calculated) items

## Why it's blank today

SM/SP prices are not entered by a person — they are produced automatically by the BOM cost engine, which only knows a **cost per usage unit** (per gram). When it writes the price record it stores `0` in the "price per purchase unit" field, and both the Price table and the export deliberately show a blank / "from BOM" placeholder there. So the number is missing, not wrong.

## What to do

Do **not** start storing a pack price for SM in the database. The stored `0` is read by other logic and the BOM engine would keep overwriting it. Instead, derive the pack price for display only:

```text
Price / Pack = Price per Usage UOM  x  Pack Size  x  Converter
```

This is the exact inverse of the formula the system already uses for purchased items (`price / pack size / converter`), so RM and SM become directly comparable.

Applied in two places:

1. **Price Master table** — the "Price/Purchase UOM" column shows the derived value for BOM rows instead of the "from BOM" text, with a small marker (calculator icon / muted style) so it stays obvious the figure is derived, not entered. Purchased rows are untouched.
2. **Export (Excel + clipboard)** — the `Price / Pack` column is filled for BOM rows with the same derived value, instead of being left empty.

Edge case: if a SKU has pack size or converter of 0 or missing, leave the cell blank rather than showing 0.

## Blast radius

- No database writes, no migration, no change to the BOM sync engine.
- No change to `price_per_usage_uom`, which is the value every downstream calculation uses (food cost, stock value, transfer cost, dashboards). Those are untouched.
- The price entry form is unchanged: SM prices remain system-managed and non-editable.
- CSV import is unchanged.

## Technical notes

- Add a shared helper (e.g. `derivePricePerPack(price, sku)`) in `src/lib/price-export.ts` returning `pricePerUsageUom * packSize * converter`, or `null` when `packSize <= 0` or `converter <= 0`.
- `buildActivePriceRows`: replace `pricePerPack: bom ? null : p.pricePerPurchaseUom` with the derived value for BOM rows.
- `src/components/PriceTable.tsx`: in the `isBom` branch of the Price/Purchase UOM cell, render the derived amount (`toFixed(2)`) in muted style with the calculator icon tooltip, falling back to the existing "from BOM" text when it can't be derived.
