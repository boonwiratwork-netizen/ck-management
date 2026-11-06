// Ingredient price rises: big ones pushed at once (3), smaller ones in the morning digest
// (8). Both use the case key price_rise:<sku_id>, so one item is one case: a rise of +12%
// sits in the digest, and if it grows to +28% the same case is re-sent at once (worse).
// Plain TypeScript, relative imports only.

import { list, num, type RuleConfig, type RuleId } from "../config.ts";
import type { AlertData, AlertRule, CaseCandidate } from "../types.ts";
import { pct } from "./common.ts";

const DAY = 86_400_000;

export interface PriceRise {
  skuId: string;
  /** The price it is compared with: "ใช้ราคานี้เป็นปกติ" if set, else the price before the look-back */
  from: number;
  to: number;
  rise: number;
  fromBaseline: boolean;
  /** Up from the price before the look-back, but not from the price set as normal: keeps the case, tells no one */
  quiet: boolean;
}

export const priceKey = (skuId: string) => `price_rise:${skuId}`;

/**
 * Items whose standard price changed within the look-back and now stands at least
 * `rise_pct` above the price it had just before the look-back began (price_history). An
 * item with no earlier price on record (new item) isn't judged.
 *
 * "ใช้ราคานี้เป็นปกติ" (a baseline on the case) replaces that reference — only if it was set
 * after the last change before the look-back (an older one is about a price long gone). A
 * rise that is over the limit only against the old price, not against the baseline, comes
 * back `quiet`: the case stays (acknowledged) without telling anyone, and closes once the
 * change leaves the look-back.
 */
export function priceRises(data: AlertData, cfg: RuleConfig): PriceRise[] {
  const since = data.nowMs - num(cfg.thresholds, "lookback_days") * DAY;
  const limit = num(cfg.thresholds, "rise_pct");
  const types = new Set(list(cfg.thresholds, "sku_types"));
  const typeOf = new Map(data.skus.map((s) => [s.id, s.type]));
  const bySku = new Map<string, { price: number; at: number }[]>();
  for (const c of data.priceChanges) {
    const l = bySku.get(c.sku_id) ?? [];
    l.push({ price: Number(c.price_per_usage_uom), at: Date.parse(c.valid_from) });
    bySku.set(c.sku_id, l);
  }
  const pctUp = (from: number, to: number) => ((to - from) / from) * 100;
  const out: PriceRise[] = [];
  for (const [skuId, changes] of bySku) {
    if (types.size && !types.has(typeOf.get(skuId) ?? "")) continue;
    changes.sort((a, b) => a.at - b.at);
    const recent = changes.filter((c) => c.at >= since);
    if (!recent.length) continue;
    const to = recent[recent.length - 1].price;
    const before = [...changes].reverse().find((c) => c.at < since);
    if (!before || !(before.price > 0) || !(to > 0)) continue;
    const plain = pctUp(before.price, to);
    if (plain + 1e-9 < limit) continue;
    const b = data.baselines.get(priceKey(skuId));
    if (b && b.price > 0 && b.setAt >= before.at) {
      const rise = pctUp(b.price, to);
      out.push(rise + 1e-9 >= limit ? { skuId, from: b.price, to, rise, fromBaseline: true, quiet: false } : { skuId, from: b.price, to, rise, fromBaseline: true, quiet: true });
    } else out.push({ skuId, from: before.price, to, rise: plain, fromBaseline: false, quiet: false });
  }
  return out;
}

const fmtPrice = (n: number) => (n >= 1 ? n.toFixed(2) : n.toPrecision(3));

function priceRule(id: RuleId, severity: CaseCandidate["severity"]): AlertRule {
  return {
    id,
    kind: "case",
    needs: ["prices"],
    evaluate(data, cfg) {
      const sku = new Map(data.skus.map((s) => [s.id, s]));
      const cases = priceRises(data, cfg).map((r): CaseCandidate => {
        const s = sku.get(r.skuId);
        return {
          key: priceKey(r.skuId),
          rule: id,
          title: `${s?.name ?? "วัตถุดิบ"} ราคาขึ้น ${pct(r.rise)}`,
          detail: `${fmtPrice(r.from)} → ${fmtPrice(r.to)} บาท/${s?.uom || "หน่วย"}${r.fromBaseline ? " (เทียบราคาที่ตั้งเป็นปกติ)" : ""}`,
          severity,
          value: r.rise,
          baselineCandidate: r.to,
          quiet: r.quiet || undefined,
          scope: { skuId: r.skuId },
          link: { page: "price", skuCode: s?.code ?? "" },
        };
      });
      return { cases, info: [] };
    },
  };
}

/** 3 · Up ≥ 25% (immediate) */
export const priceRiseBig = priceRule("price_rise_big", "high");
/** 8 · Up ≥ 10% (morning digest) */
export const priceRise = priceRule("price_rise", "medium");
