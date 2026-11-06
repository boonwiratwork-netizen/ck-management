// Digest-only lines (no cases): close of day (10), weekly team scores (11), weekly food
// cost / waste / new items (12), the month-close checklist (13). Plain TypeScript, relative
// imports only.

import { num } from "../config.ts";
import { shiftDay } from "../../day-math.ts";
import {
  DEFAULT_TARGETS,
  bangkokDay,
  branchMetrics,
  branchTotals,
  daysBetween,
  monthStartOf,
  periodOf,
  planToday,
  previousPeriod,
  scoreOf,
  STATUS_LABEL,
} from "../../team-score.ts";
import type { AlertRule, InfoLine } from "../types.ts";
import { COUNT_WINDOW_DAYS, monthEndCount, rmIdsOf } from "../../month-count.ts";
import { baht, branchInputsOf, firstReceiptOf, pct, thDay, thDow, thMonth } from "./common.ts";

const DAY = 86_400_000;

/**
 * 10 · Close of day (21:15): each branch's sales today against the same weekday last week
 * (net, as imported so far), today's production against today's share of the week's plan
 * (the team score's planToday), and transfer orders due by today still not sent (Draft).
 */
export const closeOfDay: AlertRule = {
  id: "close_of_day",
  kind: "info",
  needs: ["salesDaily", "plans", "production", "tos"],
  evaluate(data, cfg) {
    const info: InfoLine[] = [];
    const lastWeek = shiftDay(data.today, -7);
    const net = (b: string, d: string) => data.salesDaily.filter((s) => s.branch_id === b && s.sale_date === d).reduce((a, s) => a + (Number(s.net_amount) || 0), 0);
    const has = (b: string, d: string) => data.salesDaily.some((s) => s.branch_id === b && s.sale_date === d);
    for (const b of data.branches) {
      if (!has(b.id, data.today)) {
        info.push({ rule: "close_of_day", text: `${b.name}: ยังไม่มียอดขายวันนี้ในระบบ`, link: { page: "sales", branchId: b.id, date: data.today } });
        continue;
      }
      const now = net(b.id, data.today);
      const before = net(b.id, lastWeek);
      let cmp = "";
      if (has(b.id, lastWeek) && before > 0) {
        const ch = ((now - before) / before) * 100;
        const drop = ch <= -num(cfg.thresholds, "sales_drop_pct");
        cmp = ` (${ch >= 0 ? "+" : "−"}${pct(Math.abs(ch))} จาก${thDow(lastWeek)}${drop ? " · ตกมาก" : ""})`;
      }
      info.push({ rule: "close_of_day", text: `${b.name}: ยอดขาย ${baht(now)}${cmp}`, link: { page: "sales", branchId: b.id, date: data.today } });
    }
    const plan = planToday(data.plans, data.production, data.today);
    info.push({
      rule: "close_of_day",
      text: plan.value === null ? `ครัวกลาง: ${plan.why ?? "ไม่มีแผนผลิตวันนี้"}` : `ครัวกลาง: ผลิตวันนี้ ${pct(plan.value * 100)} ของแผน (1/6 ของแผนสัปดาห์)`,
      link: { page: "production" },
    });
    const draft = data.tos.filter((t) => t.status === "Draft" && t.delivery_date <= data.today);
    if (draft.length)
      info.push({
        rule: "close_of_day",
        text: `ใบโอนถึงกำหนดแต่ยังไม่ส่ง ${draft.length} ใบ: ${draft
          .slice(0, 4)
          .map((t) => t.to_number)
          .join(", ")}${draft.length > 4 ? " …" : ""}`,
        link: { page: "transfer" },
      });
    else info.push({ rule: "close_of_day", text: "ใบโอนที่ถึงกำหนดส่งครบแล้ว" });
    return { cases: [], info };
  },
};

/**
 * 11 · Weekly (Monday): every branch's team score for the 7 days ending yesterday, best
 * first, with the week before. The kitchen's score needs its month cost (worked out in the
 * app only), so it isn't in this list — see the home page.
 */
export const weeklyScores: AlertRule = {
  id: "weekly_scores",
  kind: "info",
  needs: ["counts", "salesDaily", "tos", "receipts", "prices"],
  evaluate(data) {
    const inputs = branchInputsOf(data);
    const week = periodOf("week", data.today);
    const prev = previousPeriod(week);
    const rows = data.branches.map((b) => {
      const s = scoreOf(Object.values(branchMetrics(inputs.get(b.id)!, week, data.nowMs, DEFAULT_TARGETS)));
      const p = scoreOf(Object.values(branchMetrics(inputs.get(b.id)!, prev, data.nowMs, DEFAULT_TARGETS)));
      return { b, s, p };
    });
    rows.sort((x, y) => (y.s.total ? y.s.score / y.s.total : -1) - (x.s.total ? x.s.score / x.s.total : -1) || x.b.name.localeCompare(y.b.name));
    const info: InfoLine[] = rows.map((r, i) => ({
      rule: "weekly_scores",
      text: `${i + 1}. ${r.b.name} ${r.s.total ? `${r.s.score}/${r.s.total}` : "—"} ${STATUS_LABEL[r.s.status]}${r.p.total ? ` (สัปดาห์ก่อน ${r.p.score}/${r.p.total})` : ""}`,
      link: { page: "admin", teamId: r.b.id },
    }));
    return { cases: [], info };
  },
};

/**
 * 12 · Weekly (Monday): food cost by recipe from the saved analysis (food_cost_menu_monthly,
 * written by the app's Food Cost page — so "as of" its last save), waste as % of net sales
 * for the 7 days ending yesterday (the team score's own totals), and menus / items added in
 * the last new_item_days. RD: nothing in the app yet.
 */
export const weeklyCost: AlertRule = {
  id: "weekly_cost",
  kind: "info",
  needs: ["foodCostMonthly", "counts", "salesDaily", "prices", "newItems"],
  evaluate(data, cfg) {
    const info: InfoLine[] = [];
    // Food cost: the newest month with saved rows, up to this one
    const thisMonth = monthStartOf(data.today);
    const months = [...new Set(data.foodCostMonthly.map((r) => r.month.slice(0, 10)))].filter((m) => m <= thisMonth).sort();
    const month = months[months.length - 1];
    if (month) {
      const rows = data.foodCostMonthly.filter((r) => r.month.slice(0, 10) === month && r.has_recipe_cost && r.std_cost !== null);
      const rev = rows.reduce((a, r) => a + (Number(r.revenue) || 0), 0);
      const cost = rows.reduce((a, r) => a + (Number(r.std_cost) || 0), 0);
      const last = rows.map((r) => r.computed_at).sort().pop();
      info.push({
        rule: "weekly_cost",
        text: rev > 0 ? `Food cost ตามสูตร ${thMonth(month)} ${(cost / rev * 100).toFixed(1)}% (คิดล่าสุด ${last ? thDay(bangkokDay(last)) : "—"})` : `Food cost ตามสูตร ${thMonth(month)}: ยังไม่มียอดขายที่มีสูตร`,
        link: { page: "food-cost" },
      });
    } else info.push({ rule: "weekly_cost", text: "Food cost ตามสูตร: ยังไม่มีผลที่บันทึก (เปิดหน้า Food Cost แล้วกดอัปเดตข้อมูลวิเคราะห์)", link: { page: "food-cost" } });

    const inputs = branchInputsOf(data);
    const week = periodOf("week", data.today);
    let sales = 0;
    let waste = 0;
    for (const b of data.branches) {
      const t = branchTotals(inputs.get(b.id)!, week);
      sales += t.sales;
      waste += t.waste;
    }
    info.push({ rule: "weekly_cost", text: sales > 0 ? `Waste 7 วัน ${(waste / sales * 100).toFixed(2)}% ของยอดขาย (${baht(waste)})` : "Waste 7 วัน: ไม่มียอดขายในช่วงนี้" });

    const since = data.nowMs - num(cfg.thresholds, "new_item_days") * DAY;
    const fresh = data.newItems.filter((x) => Date.parse(x.created_at) >= since);
    const menus = fresh.filter((x) => x.kind === "menu");
    const skus = fresh.filter((x) => x.kind === "sku");
    const names = (l: typeof fresh) => l.slice(0, 3).map((x) => x.name).join(", ") + (l.length > 3 ? " …" : "");
    info.push({ rule: "weekly_cost", text: `เมนูใหม่ ${menus.length}${menus.length ? `: ${names(menus)}` : ""} · วัตถุดิบใหม่ ${skus.length}${skus.length ? `: ${names(skus)}` : ""}` });
    info.push({ rule: "weekly_cost", text: "RD: ยังไม่มีข้อมูลในแอป" });
    return { cases: [], info };
  },
};

/**
 * 13 · Month close: from the 1st until `max_days`, each morning, what of last month is
 * still missing — the kitchen's month-end count (the shared rule in ../../month-count.ts:
 * a completed session within ±3 days covering ≥ half of the RM in what was made), each branch's count on the last day, days with a
 * count sheet but no sales imported, transfer orders sent that month not received, and the
 * Food Cost analysis saved for the closed month. Nothing missing = no lines.
 */
export const monthClose: AlertRule = {
  id: "month_close",
  kind: "info",
  needs: ["kitchenMonth", "counts", "salesDaily", "tos", "receipts", "foodCostMonthly"],
  evaluate(data, cfg) {
    const dom = Number(data.today.slice(8, 10));
    if (dom > num(cfg.thresholds, "max_days")) return { cases: [], info: [] };
    const end = shiftDay(monthStartOf(data.today), -1);
    const start = monthStartOf(end);
    const label = thMonth(end);
    const info: InfoLine[] = [];
    // The same rule as the kitchen cost / home page: a completed session within ±3 days that
    // counted at least half of the RM in the recipes of what was made (../../month-count.ts)
    const km = data.kitchenMonth;
    const kitchen = monthEndCount({ end, sessions: km.sessions, linesOf: (id) => km.lines.filter((l) => l.session_id === id), rmIds: rmIdsOf(km.producedSm, (sm) => km.recipeRm.get(sm) ?? []) });
    if (kitchen === "fail") info.push({ rule: "month_close", text: `ครัวกลางยังไม่นับปิดเดือน ${label} (ภายใน ±${COUNT_WINDOW_DAYS} วันจากสิ้นเดือน · นับอย่างน้อยครึ่งหนึ่งของวัตถุดิบ)`, link: { page: "kitchen-count" } });

    for (const b of data.branches) {
      const lastRows = data.counts.filter((c) => c.branch_id === b.id && c.count_date === end);
      if (!lastRows.length || lastRows.some((r) => !r.is_submitted)) info.push({ rule: "month_close", text: `${b.name} ยังไม่นับปิดวันสุดท้าย ${thDay(end)}`, link: { page: "count", branchId: b.id, date: end } });
      const sheetDays = new Set(data.counts.filter((c) => c.branch_id === b.id && c.count_date >= start && c.count_date <= end).map((c) => c.count_date));
      const saleDays = new Set(data.salesDaily.filter((s) => s.branch_id === b.id).map((s) => s.sale_date));
      const missing = daysBetween(start, end).filter((d) => sheetDays.has(d) && !saleDays.has(d));
      if (missing.length) info.push({ rule: "month_close", text: `${b.name} ยังไม่นำเข้ายอดขาย ${missing.length} วัน (${missing.slice(0, 3).map(thDay).join(", ")}${missing.length > 3 ? " …" : ""})`, link: { page: "sales", branchId: b.id, date: missing[0] } });
    }

    const first = firstReceiptOf(data);
    const open = data.tos.filter((t) => t.status === "Sent" && t.sent_at && !first.has(t.id) && bangkokDay(t.sent_at) >= start && bangkokDay(t.sent_at) <= end);
    if (open.length) info.push({ rule: "month_close", text: `ใบโอนเดือน ${label} ยังไม่กดรับ ${open.length} ใบ`, link: { page: "transfer" } });

    const saved = new Set(data.foodCostMonthly.filter((r) => r.month.slice(0, 10) === start && r.is_closed_month).map((r) => r.branch_id));
    const notSaved = data.branches.filter((b) => !saved.has(b.id));
    if (notSaved.length) info.push({ rule: "month_close", text: `Food cost ${label} ยังไม่บันทึก: ${notSaved.map((b) => b.name).join(", ")}`, link: { page: "food-cost" } });
    return { cases: [], info };
  },
};
