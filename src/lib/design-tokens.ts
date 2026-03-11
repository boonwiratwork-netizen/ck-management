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
  primary: 'primary',            // hsl(var(--primary)) → orange-500
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
} as const;

// ─── TABLE STANDARDS ────────────────────────────────────────────────────────
export const table = {
  /** Wrapper for tables */
  wrapper: 'rounded-lg border overflow-hidden',
  /** Table element */
  base: 'w-full table-fixed text-sm',
  /** Header row */
  headerRow: 'bg-table-header border-b',
  /** Header cell */
  headerCell: 'px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground',
  /** Data row */
  dataRow: 'border-b border-table-border hover:bg-table-hover transition-colors',
  /** Data cell */
  dataCell: 'px-3 py-2 text-sm',
  /** Data cell for numbers — right-aligned mono */
  dataCellMono: 'px-3 py-2 text-sm font-mono text-right',
  /** Truncated text cell with tooltip */
  truncatedCell: 'px-3 py-2 text-sm truncate',
  /**
   * Filled/entered row highlight
   * 3px green left border + light green bg + reduced opacity for unfilled
   */
  filledRow: 'border-l-[3px] border-l-success bg-success/5',
  unfilledRow: 'opacity-40',
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
