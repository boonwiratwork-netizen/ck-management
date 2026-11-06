import { goCount, goSales, type Go } from "@/lib/admin-home";
import type { CaseLink } from "../../../supabase/functions/_shared/alerts/types.ts";
import type { CaseRow } from "../../../supabase/functions/_shared/alerts/engine.ts";
import type { Severity } from "../../../supabase/functions/_shared/alerts/types.ts";

/**
 * Where a case's button goes (the page, with its branch and day already picked), and the
 * verb on the button. The push itself links to /alerts#go/<key>, which follows this.
 */
export function goOf(link: CaseLink | null | undefined): Go | null {
  if (!link || typeof link !== "object") return null;
  switch (link.page) {
    case "count":
      return goCount(link.branchId, link.date);
    case "sales":
      return goSales(link.branchId, link.date);
    case "transfer":
      return { path: "/transfer-order", hash: "history" };
    case "price":
      return link.skuCode ? { path: "/cost-center", hash: `p/${encodeURIComponent(link.skuCode)}` } : { path: "/cost-center" };
    case "admin":
      return { path: "/admin", hash: link.teamId ? `team/${link.teamId}` : undefined };
    case "kitchen-count":
      return { path: "/stockcount" };
    case "food-cost":
      return { path: "/food-cost" };
    case "production":
      return { path: "/production", hash: "plan" };
    default:
      return null;
  }
}

export function verbOf(link: CaseLink | null | undefined): string {
  switch (link?.page) {
    case "count":
      return "ดูใบนับ";
    case "sales":
      return "ไปนำเข้ายอดขาย";
    case "transfer":
      return "ดูใบโอน";
    case "price":
      return "ดูราคา";
    case "admin":
      return "ดูทีม";
    case "kitchen-count":
      return "ไปนับครัว";
    case "food-cost":
      return "ดู Food cost";
    case "production":
      return "ดูแผนผลิต";
    default:
      return "เปิด";
  }
}

export const SEVERITY_LABEL: Record<Severity, string> = { high: "ด่วน", medium: "ควรดู", low: "แจ้งให้ทราบ" };

const SEV: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
/** Still open (not closed): open before acknowledged, then severity, then the oldest first */
export function sortOpen(cases: CaseRow[]): CaseRow[] {
  return cases
    .filter((c) => c.status !== "closed")
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1) || SEV[a.severity] - SEV[b.severity] || Date.parse(a.opened_at) - Date.parse(b.opened_at));
}

/** The case a push opened: "#go/<key>" */
export function goKeyOf(hash: string): string | null {
  const h = hash.replace(/^#/, "");
  if (!h.startsWith("go/")) return null;
  try {
    return decodeURIComponent(h.slice(3));
  } catch {
    return null;
  }
}
