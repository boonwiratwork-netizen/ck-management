# Active Price List Export (Price Master)

Add an **Export** button at the top of the Price Master page that exports every active price, with both the pack price and the smallest-unit (usage UOM) price, in a table users can filter and sort in Excel.

## What gets exported

One row per active price record (all SKU types, including BOM-derived SM/SP prices). Columns:

| Column | Source |
|---|---|
| SKU Code | sku.skuId |
| SKU Name | sku.name |
| Type | RM / SM / SP / PK |
| Category | sku.category |
| Supplier | supplier name, or "BOM (calculated)" for system prices |
| Pack Size | sku.packSize |
| Pack Unit / Purchase UOM | sku.packUnit, sku.purchaseUom |
| Price / Pack (Purchase UOM) | price.pricePerPurchaseUom |
| Usage UOM | sku.usageUom |
| Price / Usage UOM (smallest unit) | price.pricePerUsageUom |
| VAT | Yes / No |
| Effective Date | price.effectiveDate |
| Note | price.note |

Sorted by SKU code. BOM-derived rows show a blank pack price (that value isn't meaningful for them) but keep the usage-unit price.

## Export options

The button opens a small dropdown with two actions:

1. **Download Excel (.xlsx)** — a single "Active Prices" sheet with a bold header row, frozen top row, an AutoFilter applied across all columns (so users can filter/sort directly in Excel), sensible column widths, and numeric cells stored as real numbers with money formats (`#,##0.00` for pack price, `0.0000` for usage-unit price).
2. **Copy to clipboard** — the same table as tab-separated text with the header row, so it pastes straight into Excel or Google Sheets as a proper table. Shows a success toast with the row count.

Both exports use exactly the same rows and column order.

## Technical notes

- New file `src/lib/price-export.ts` with `buildActivePriceRows(prices, skus, suppliers)`, `exportActivePricesXlsx(...)`, and `activePricesToTsv(...)`. Uses the existing `xlsx` (SheetJS) dependency and mirrors the workbook/download helpers already used in `src/lib/bom-export.ts`.
- `src/pages/Prices.tsx`: add an Export dropdown button (shadcn `DropdownMenu` + `Download` lucide icon) next to Import CSV / Add Price in the header. Hidden when `readOnly` is not relevant — it stays visible for read-only users since exporting is non-destructive.
- Filename: `Active_Prices_YYYY-MM-DD.xlsx` via `toLocalDateStr`.
- No database, hook, or existing table changes.
