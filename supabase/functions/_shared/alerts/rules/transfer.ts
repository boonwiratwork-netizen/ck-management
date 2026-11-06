// Transfer-order alerts: declined by a branch (1), the kitchen sent short (2), sent but not
// received (6). Plain TypeScript, relative imports only.

import { num } from "../config.ts";
import { packsOf } from "../../transfer-short.ts";
import type { AlertRule, CaseCandidate } from "../types.ts";
import { baht, branchName, firstReceiptOf, pct, qty } from "./common.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 1 · A branch declined a transfer order (status Declined, changed within the look-back) — every time */
export const toDeclined: AlertRule = {
  id: "to_declined",
  kind: "case",
  needs: ["tos"],
  evaluate(data, cfg) {
    const since = data.nowMs - num(cfg.thresholds, "lookback_hours") * HOUR;
    const cases: CaseCandidate[] = [];
    for (const to of data.tos) {
      if (to.status !== "Declined") continue;
      const at = Date.parse(to.updated_at ?? to.sent_at ?? "");
      if (!(at >= since)) continue;
      cases.push({
        key: `to_declined:${to.id}`,
        rule: "to_declined",
        title: `${branchName(data, to.branch_id)} ปฏิเสธใบโอน ${to.to_number}`,
        detail: `${to.decline_reason ? `เหตุผล: ${to.decline_reason}` : "ไม่ได้ใส่เหตุผล"} · มูลค่า ${baht(Number(to.total_value) || 0)}`,
        severity: "high",
        value: 1,
        scope: { branchId: to.branch_id, toId: to.id },
        link: { page: "transfer" },
      });
    }
    return { cases, info: [] };
  },
};

/**
 * 2 · The kitchen sent less than the branch asked for, by more than short_pct of a request
 * line (lines made from a branch request only). Packed items compare packs × pack size,
 * others the weight sent; a request that isn't a whole number of packs (the pack size
 * changed since) is skipped, like the kitchen score does. One case per transfer order.
 */
export const toShort: AlertRule = {
  id: "to_short",
  kind: "case",
  needs: ["tos", "toLines"],
  evaluate(data, cfg) {
    const since = data.nowMs - num(cfg.thresholds, "lookback_hours") * HOUR;
    const limit = num(cfg.thresholds, "short_pct") / 100;
    const sku = new Map(data.skus.map((s) => [s.id, s]));
    const sent = new Map(data.tos.filter((t) => t.sent_at && t.status !== "Draft" && t.status !== "Declined" && Date.parse(t.sent_at) >= since).map((t) => [t.id, t]));
    const byTo = new Map<string, { name: string; short: number; uom: string; share: number }[]>();
    for (const l of data.toLines) {
      const to = sent.get(l.to_id);
      if (!to || !l.tr_line_id) continue;
      const asked = Number(l.planned_qty) || 0;
      if (asked <= 0) continue;
      const pack = sku.get(l.sku_id)?.packSize ?? 0;
      let got: number;
      if (pack > 1) {
        const askedPacks = asked / pack;
        if (Math.abs(askedPacks - Math.round(askedPacks)) > 0.01) continue;
        got = packsOf({ packsCount: l.packs_count, actualQty: Number(l.actual_qty) || 0 }, pack) * pack;
      } else got = Number(l.actual_qty) || 0;
      const share = (asked - got) / asked;
      if (share <= limit + 1e-9) continue;
      const list = byTo.get(to.id) ?? [];
      list.push({ name: sku.get(l.sku_id)?.name ?? "สินค้า", short: asked - got, uom: l.uom, share });
      byTo.set(to.id, list);
    }
    const cases: CaseCandidate[] = [];
    for (const [id, items] of byTo) {
      const to = sent.get(id)!;
      items.sort((a, b) => b.share - a.share);
      cases.push({
        key: `to_short:${id}`,
        rule: "to_short",
        title: `ครัวส่ง ${to.to_number} ให้ ${branchName(data, to.branch_id)} ไม่ครบ ${items.length} รายการ`,
        detail: items
          .slice(0, 3)
          .map((x) => `${x.name} ขาด ${qty(x.short)} ${x.uom} (${pct(x.share * 100)})`)
          .join(" · "),
        severity: "medium",
        value: items.length,
        scope: { branchId: to.branch_id, toId: id },
        link: { page: "transfer" },
      });
    }
    return { cases, info: [] };
  },
};

/** 6 · Sent more than `hours` ago and the branch hasn't received it (no branch receipt of it) */
export const toUnreceived: AlertRule = {
  id: "to_unreceived",
  kind: "case",
  needs: ["tos", "receipts"],
  evaluate(data, cfg) {
    const limit = num(cfg.thresholds, "hours") * HOUR;
    const first = firstReceiptOf(data);
    const cases: CaseCandidate[] = [];
    for (const to of data.tos) {
      if (to.status !== "Sent" || !to.sent_at || first.has(to.id) || !data.branches.some((b) => b.id === to.branch_id)) continue;
      const age = data.nowMs - Date.parse(to.sent_at);
      if (age <= limit) continue;
      const days = Math.floor(age / DAY);
      cases.push({
        key: `to_unreceived:${to.id}`,
        rule: "to_unreceived",
        title: `${to.to_number} ส่งแล้ว ${branchName(data, to.branch_id)} ยังไม่กดรับ`,
        detail: `${days >= 1 ? `${days} วัน` : `${Math.floor(age / HOUR)} ชม.`} · มูลค่า ${baht(Number(to.total_value) || 0)} · สต๊อกสาขาจะไม่ตรง`,
        severity: days >= 3 ? "high" : "medium",
        value: days,
        scope: { branchId: to.branch_id, toId: to.id },
        link: { page: "transfer" },
      });
    }
    return { cases, info: [] };
  },
};
