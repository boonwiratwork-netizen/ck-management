/**
 * CK Manager Design System — Single Source of Truth
 * 
 * This file defines all design tokens for consistent UI across the application.
 * Pages should reference these tokens instead of hardcoding Tailwind classes.
 * 
 * IMPORTANT: Do not use raw color values (e.g. "bg-orange-500") in components.
 * Always use semantic tokens from index.css (e.g. "bg-primary") or reference
 * the mappings defined here.
 */

// ─── TYPOGRAPHY ─────────────────────────────────────────────────────────────
export const typography = {
  /** Page titles — e.g. "Production Plan", "Goods Receipt" */
  pageTitle: 'text-2xl font-bold tracking-tight',
  /** Section titles inside cards or panels */
  sectionTitle: 'text-lg font-semibold',
  /** Table column headers */
  tableHeader: 'text-xs font-medium uppercase tracking-wide text-muted-foreground',
  /** Table body text */
  tableData: 'text-sm',
  /** Table body numbers — monospaced for alignment */
  tableDataMono: 'text-sm font-mono',
  /** Small unit labels next to values (e.g. "ก.", "฿") */
  unitLabel: 'text-xs text-muted-foreground',
  /** Badge text */
  badge: 'text-xs font-medium',
  /** Summary card labels */
  cardLabel: 'text-xs uppercase tracking-wide text-muted-foreground',
  /** Summary card large values */
  cardValue: 'text-2xl font-bold',
} as const;

// ─── COLORS (semantic mapping to Tailwind tokens) ───────────────────────────
// These map to CSS custom properties defined in index.css.
// Use the semantic token classes (bg-primary, text-destructive, etc.) in components.
export const colors = {
  /** Primary action color — buttons, active states, accents */
  primary: 'primary',            // hsl(var(--primary)) → ink black
  primaryHover: 'primary/90',    // hover darkened via opacity or index.css
  /** Positive / success states */
  success: 'success',            // hsl(var(--success)) → green-500
  /** Warning / caution states */
  warning: 'warning',            // hsl(var(--warning)) → yellow/amber-500
  /** Destructive / critical states */
  danger: 'destructive',         // hsl(var(--destructive)) → red-500
  /** Secondary text, units */
  muted: 'muted-foreground',     // hsl(var(--muted-foreground)) → gray-400/500
  /** Table & card borders */
  border: 'border',              // hsl(var(--border)) → gray-200
  /** Input borders */
  inputBorder: 'input',          // hsl(var(--input)) → gray-300
  /** Input focus ring */
  inputFocusBorder: 'ring',      // hsl(var(--ring)) → orange-400
  /** Row hover background */
  rowHoverBg: 'table-hover',     // hsl(var(--table-hover))
  /** Filled/entered row background */
  rowFilledBg: 'success/5',      // light green tint
  /** Filled row left border accent */
  rowFilledBorder: 'success',    // green-400/500
} as const;

// ─── STATUS DOT COLORS ─────────────────────────────────────────────────────
export const statusDotColors = {
  green: 'bg-success',
  amber: 'bg-warning',
  red: 'bg-destructive',
} as const;

export const statusDotSizes = {
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
} as const;

// ─── FORM CONTROLS ──────────────────────────────────────────────────────────
export const formControl = {
  /** Universal height for all interactive form controls (Input, Select, DatePicker) */
  height: 'h-10',
} as const;

// ─── SPACING ────────────────────────────────────────────────────────────────
export const spacing = {
  /** Standard table row height */
  tableRowHeight: 'h-10',
  /** Table cell padding */
  tableCellPadding: 'px-3 py-2',
  /** Compact table cell padding (for dense spreadsheet views) */
  tableCellPaddingCompact: 'px-2 py-1.5',
  /** Card internal padding */
  cardPadding: 'p-4',
  /** Panel / page section padding */
  panelPadding: 'p-6',
  /** Gap between sections */
  sectionGap: 'gap-4',
  /** Gap between summary cards */
  cardGap: 'gap-3',
} as const;

// ─── INPUT STANDARDS ────────────────────────────────────────────────────────
export const inputs = {
  /**
   * Table cell inputs use uncontrolled pattern:
   *   defaultValue + onBlur (NOT controlled onChange)
   * This prevents keystroke-dropping and re-render lag.
   *
   * Modal/form inputs may use controlled pattern.
   */
  tableCellInput: 'h-8 text-sm px-2 w-full rounded-md border border-input focus:border-ring focus:ring-0 focus:outline-none bg-background',
  /** Standard form input */
  formInput: 'h-10 w-full rounded-md border border-input px-3 py-2 text-sm focus:border-ring focus:ring-0 focus:outline-none bg-background',
  /** Number input attributes */
  numberInputProps: {
    type: 'number' as const,
    inputMode: 'decimal' as const,
  },
} as const;

// ─── DECIMAL FORMATTING ─────────────────────────────────────────────────────
export const decimals = {
  /** Currency values: ฿0.0000 */
  currency: 4,
  /** Weight in grams: no decimals, with thousands separator */
  grams: 0,
  /** Days: 1 decimal place */
  days: 1,
  /** Percentage: 1 decimal place */
  percentage: 1,
} as const;

/**
 * Format a number with thousands separator and fixed decimals.
 * @param value - The number to format
 * @param dp - Decimal places (default 0)
 * @returns Formatted string e.g. "12,345" or "0.0012"
 */
export function formatNumber(value: number, dp: number = 0): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

/** Format grams with thousands separator, 0 dp */
export const fmtGrams = (v: number) => formatNumber(v, decimals.grams);

/** Format currency with 4 dp */
export const fmtCurrency = (v: number) => `฿${formatNumber(v, decimals.currency)}`;

/** Format days with 1 dp */
export const fmtDays = (v: number) => formatNumber(v, decimals.days);

/** Format percentage with 1 dp */
export const fmtPct = (v: number) => `${formatNumber(v, decimals.percentage)}%`;

// ─── BUTTON STANDARDS ───────────────────────────────────────────────────────
export const buttons = {
  /** Primary action button */
  primary: 'bg-primary hover:bg-primary/90 text-primary-foreground rounded-md px-4 py-2 text-sm font-medium transition-colors',
  /** Secondary / outlined button */
  secondary: 'border border-primary text-primary hover:bg-accent rounded-md px-4 py-2 text-sm transition-colors',
  /** Destructive action */
  destructive: 'border border-destructive/30 text-destructive hover:bg-destructive/5 rounded-md px-3 py-1.5 text-sm transition-colors',
  /** Ghost / text-only */
  ghost: 'text-primary hover:text-primary/80 text-sm transition-colors',
  /** Dashed "add row" button */
  dashedAdd: 'w-full border-2 border-dashed border-primary/40 text-primary hover:border-primary/60 hover:bg-accent rounded-md py-2 text-sm transition-colors',

  // Segmented mode toggle — for embedded table header use
  // Use with plain <button> elements or ToggleGroup from @/components/ui/toggle
  modeToggleWrapper: 'flex rounded-md overflow-hidden border border-border',
  modeToggleActive: 'px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground transition-colors',
  modeToggleInactive: 'px-3 py-1.5 text-xs font-medium bg-background text-muted-foreground hover:bg-muted transition-colors',
} as const;

// ─── TABLE STANDARDS ────────────────────────────────────────────────────────

/*
 * ═══════════════════════════════════════════════
 * TABLE DESIGN PLAYBOOK — CK Manager Design System
 * Single source of truth for all table UI.
 * Every prompt touching a table must reference
 * this object and follow these principles.
 * ═══════════════════════════════════════════════
 *
 * SECTION 1 — STRUCTURE
 * ─────────────────────
 * Always use table-fixed with colgroup:
 *   <table className={table.base}>
 *   <colgroup> with explicit <col width="Xpx">
 *   for every column. Never rely on auto-sizing.
 *
 * One flex column per table:
 *   Exactly one column uses width="auto" in
 *   colgroup — the primary name/description column.
 *   This absorbs all remaining space.
 *   Never have two auto-width columns.
 *
 * Column width by content role:
 *   Icon/status dot:          24-28px
 *   Code (SKU, doc number):   72-80px
 *   Short label (UOM, TYPE):  48-60px
 *   Numeric QTY:              65-80px
 *   Numeric wide (input):     85-95px
 *   Amount/value:             90-100px
 *   Date:                     88px
 *   Status badge:             90-105px
 *   Action icons:             40-48px
 *   Name/description:         auto (flex)
 *
 * SECTION 2 — DENSITY VARIANTS
 * ─────────────────────────────
 * Sparse tables (under 8 columns):
 *   Use standard cells: table.dataCell,
 *   table.dataCellMono, table.truncatedCell
 *   Padding: px-3 py-2
 *
 * Dense tables (8 or more columns):
 *   Use compact cells: table.dataCellCompact,
 *   table.dataCellCompactMono,
 *   table.truncatedCellCompact
 *   Padding: px-2 py-1
 *   Headers may wrap to 2 lines —
 *   never whitespace-nowrap on header cells
 *
 * SECTION 3 — HEADER ROW
 * ──────────────────────
 * Always: <tr className={table.headerRow}>
 * Non-sortable: table.headerCell (left-aligned)
 *   or table.headerCellNumeric (right-aligned)
 *   or table.headerCellCenter (centered)
 * Sortable: table.headerCellSortable (inactive)
 *   or table.headerCellSortableActive (active)
 * Sort icon: ChevronUp/ChevronDown w-3 h-3
 *   inline after header text, from lucide-react
 * Default sort must always be defined —
 *   never leave a table in an unsorted state
 *
 * SECTION 4 — DATA ROWS
 * ──────────────────────
 * Standard: <tr className={table.dataRow}>
 * Selected: <tr className={table.dataRowSelected}>
 * Locked/read-only: <tr className={table.dataRowLocked}>
 * No zebra striping — ever
 * No vertical borders between cells — ever
 *
 * SECTION 5 — CELL CONTENT RULES
 * ────────────────────────────────
 * Numbers: font-mono text-right
 *   Zero or empty: show "—" in text-muted-foreground
 *   Negative: text-destructive
 *   Currency: ฿ prefix, 2 decimal places
 *   Quantities: 0 decimal places
 *
 * Name cells: always truncate with title tooltip
 *   <td className={table.truncatedCell}
 *       title={fullValue}>
 *
 * Code cells (SKU CODE, TR/TO numbers):
 *   font-mono, never truncate
 *
 * Status dots: use <StatusDot> component
 *   Color semantics (universal):
 *   red   = critical (at or below zero)
 *   amber = low (below ROP)
 *   green = sufficient (at or above parstock)
 *   gray  = no data
 *   Always leftmost or second column only
 *
 * Status badges: use table.badge.base plus
 *   the appropriate status key from table.badge
 *   Never hardcode badge colors outside this object
 *
 * Action cells: icon buttons only, no text labels
 *   Icon size w-4 h-4, button padding p-1.5
 *   Default: text-muted-foreground
 *            hover:text-foreground
 *   Destructive: hover:text-destructive
 *   Always add title= tooltip
 *
 * UOM anchor column (one per table maximum):
 *   text-sm font-medium text-primary bg-orange-50
 *   Use only when UOM needs to be the visual
 *   anchor for staff reading across the row
 *
 * SECTION 6 — INPUT CELLS
 * ────────────────────────
 * Always defaultValue + onBlur
 * Never value + onChange
 * Editable numeric: table.inputCell (amber bg)
 * Editable text: table.inputCellText
 * Validation error: table.inputCellError
 * Read-only display: table.readOnlyCell
 *
 * SECTION 7 — FOOTER ROWS
 * ────────────────────────
 * Always use <tfoot> inside the table —
 * never a separate div outside the table.
 * This keeps summary columns aligned with
 * data columns automatically.
 * First summary row: <tr className={table.footerRow}>
 * Label cell: table.footerCell
 * Numeric total: table.footerCellMono
 *
 * SECTION 8 — EMPTY STATE
 * ────────────────────────
 * Every table must have an empty state.
 * <tr><td colSpan={n} className={table.emptyState}>
 *   No [items] found.
 * </td></tr>
 * Format: "No X found." — sentence case with period
 * Never: "No data", "Empty", "N/A"
 * Show only after fetch completes — not during load
 *
 * SECTION 9 — LOADING STATE
 * ──────────────────────────
 * Always use <SkeletonTable> component for
 * initial page load — never plain text "Loading..."
 * Show 5 skeleton rows matching actual column count
 * Skeleton cells use table.skeletonCell variants
 * On refresh/re-fetch: keep existing data visible,
 * do not replace with skeleton
 *
 * SECTION 10 — COLUMN PRIORITY UNDER PRESSURE
 * ─────────────────────────────────────────────
 * When table risks overflow, trim in this order:
 * 1. Optional context columns (ROP, PARSTOCK)
 * 2. Wider numeric columns before narrower
 * 3. Name column minimum: 120px
 * 4. Code and unit columns: never below minimum
 * 5. Action columns: never shrink
 * ═══════════════════════════════════════════════
 */

export const table = {
  // ─── Layout ───────────────────────────────────
  wrapper: 'rounded-lg border overflow-hidden',
  base: 'w-full table-fixed text-sm',

  // ─── Header ───────────────────────────────────
  headerRow: 'bg-table-header border-b',
  headerCell: 'px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground',
  headerCellNumeric: 'px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground text-right',
  headerCellCenter: 'px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground text-center',
  headerCellSortable: 'px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors',
  headerCellSortableActive: 'px-3 py-2 text-xs font-medium uppercase tracking-wide text-foreground cursor-pointer select-none',

  // ─── Data rows ────────────────────────────────
  dataRow: 'border-b border-table-border hover:bg-table-hover transition-colors',
  dataRowSelected: 'border-b border-table-border bg-primary/5 border-l-2 border-l-primary',
  dataRowLocked: 'border-b border-table-border bg-muted/20',

  // ─── Cells — standard (sparse tables <8 cols) ─
  dataCell: 'px-3 py-2 text-sm',
  dataCellMono: 'px-3 py-2 text-sm font-mono text-right',
  dataCellCenter: 'px-3 py-2 text-sm text-center',
  truncatedCell: 'px-3 py-2 text-sm truncate',

  // ─── Cells — compact (dense tables 8+ cols) ───
  dataCellCompact: 'px-2 py-1 text-xs',
  dataCellCompactMono: 'px-2 py-1 text-xs font-mono text-right',
  dataCellCompactCenter: 'px-2 py-1 text-xs text-center',
  truncatedCellCompact: 'px-2 py-1 text-xs truncate',

  // ─── Input cells ──────────────────────────────
  inputCell: 'bg-amber-50 border border-input rounded px-2 py-1 text-sm font-mono text-right w-full h-8 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
  inputCellText: 'bg-background border border-input rounded px-2 py-1 text-sm text-left w-full h-8',
  inputCellError: 'bg-amber-50 border border-destructive ring-1 ring-destructive rounded px-2 py-1 text-sm font-mono text-right w-full h-8',
  readOnlyCell: 'bg-muted/30 border border-transparent rounded px-2 py-1 text-sm font-mono text-right w-full h-8 cursor-default',

  // ─── Special row states ───────────────────────
  filledRow: 'border-l-[3px] border-l-success bg-success/5',
  unfilledRow: 'opacity-40',

  // Production execution row states
  productionRowDone: 'border-l-[3px] border-l-success bg-success/5',
  productionRowInProgress: 'border-l-[3px] border-l-warning',
  productionRowNotStarted: 'border-l-[3px] border-l-destructive/30',

  // ─── Footer / summary rows ────────────────────
  footerRow: 'border-t-2 border-border bg-muted/20',
  footerCell: 'px-3 py-2 text-sm font-medium text-foreground',
  footerCellMono: 'px-3 py-2 text-sm font-mono font-semibold text-right text-foreground',

  // ─── Empty state ──────────────────────────────
  emptyState: 'text-center text-sm text-muted-foreground py-12',

  // ─── Loading skeleton ─────────────────────────
  skeletonCell: 'h-4 bg-muted animate-pulse rounded',
  skeletonCellName: 'h-4 bg-muted animate-pulse rounded w-[60%]',
  skeletonCellNumeric: 'h-4 bg-muted animate-pulse rounded w-[50%] ml-auto',

  // ─── Status badges ────────────────────────────
  badge: {
    base: 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
    draft:             'bg-muted text-muted-foreground',
    submitted:         'bg-amber-100 text-amber-700',
    acknowledged:      'bg-blue-100 text-blue-700',
    sent:              'bg-amber-100 text-amber-700',
    fulfilled:         'bg-green-100 text-green-700',
    received:          'bg-green-100 text-green-700',
    partiallyReceived: 'bg-blue-100 text-blue-700',
    cancelled:         'bg-red-100 text-red-700',
  },
} as const;

// ─── PROGRESS BAR ────────────────────────────────────────────────────────────
// Use with the existing Progress component from @radix-ui/react-progress
// For compact table use (h-2) and standard use (h-4)
export const progressBar = {
  // Outer track
  track: 'relative w-full overflow-hidden rounded-full bg-muted',
  trackCompact: 'h-3',      // for table rows
  trackStandard: 'h-4',     // for cards/modals

  // Fill variants — apply to ProgressPrimitive.Indicator or inner div
  // Color reflects production status
  fillNotStarted: 'bg-destructive transition-all',   // 0% — red
  fillInProgress: 'bg-warning transition-all',        // 1-99% — amber
  fillComplete: 'bg-success transition-all',          // 100% — green

  // Label below progress bar
  label: 'text-xs text-muted-foreground mt-0.5 font-mono',
} as const;

// ─── COVER DAYS DISPLAY ──────────────────────────────────────────────────────
// Reusable pattern for showing cover days with direction vs target.
// Used in Production planning, SM Stock, Daily Stock Count.
// Format: "X.X วัน ↓ need Y" or "X.X วัน ↑ need Y"
export const coverDisplay = {
  // Wrapper for the inline cover display
  wrapper: 'inline-flex items-baseline gap-1 font-mono text-xs',

  // Value + unit
  value: 'font-semibold',
  unit: 'text-muted-foreground',

  // Direction arrow + target — shows deviation from target
  arrow: 'text-xs',
  target: 'text-xs text-muted-foreground',

  // Color variants — apply to wrapper or value
  red: 'text-destructive',
  amber: 'text-warning',
  green: 'text-success',
} as const;

// ─── WORDING STANDARDS (Thai) ───────────────────────────────────────────────
export const wording = {
  /** Stock quantity unit */
  stockUnit: 'ก.',
  /** Cover days unit */
  coverDaysUnit: 'วัน',
  /** Save button text */
  save: 'บันทึก',
  /** Week reference format — use with week number */
  weekPrefix: 'สัปดาห์ที่',
  /** Batch unit */
  batch: 'แบทช์',
} as const;
