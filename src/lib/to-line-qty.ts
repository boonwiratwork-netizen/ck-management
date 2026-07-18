// Canonical set of Transfer Order statuses that represent a real (already-shipped)
// stock movement — used consistently by every stock-balance/ledger calculation that
// reads transfer_order_lines, so no two callers can silently drift apart.
export const TO_DELIVERED_STATUSES = ["Sent", "Received", "Partially Received"] as const;

// A TO line's actual delivered quantity: prefer the explicit actual_qty once it's been
// set (>0); for a TO that's only been marked "Sent" but never had actual_qty entered,
// fall back to planned_qty (the pre-send estimate) since something did leave CK. Any
// other status with no actual_qty (Draft, Declined, Cancelled) contributes zero.
export function computeToLineQty(actualQty: number, plannedQty: number, status: string): number {
  return actualQty > 0 ? actualQty : status === "Sent" ? plannedQty : 0;
}
