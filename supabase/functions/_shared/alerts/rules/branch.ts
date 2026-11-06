// Branch alerts for the morning digest: team status มีปัญหา (4), the daily count missing or
// over the difference (5), yesterday's sales not imported (7), counted before the sales came
// in (9). Every judgement is the team score's own (../../team-score.ts), the same code the
// management home page runs. Plain TypeScript, relative imports only.

import { flag, num } from "../config.ts";
import { shiftDay } from "../../day-math.ts";
import {
  DEFAULT_TARGETS,
  bangkokAt,
  branchMetrics,
  countedBeforeSales,
  countedBeforeSalesDays,
  diffBaht,
  diffMark,
  periodOf,
  scoreOf,
  STATUS_LABEL,
  type PeriodKind,
} from "../../team-score.ts";
import type { AlertRule, CaseCandidate } from "../types.ts";
import { baht, branchInputsOf, thDow } from "./common.ts";

/** Days from `lookback_days` back to yesterday, oldest first */
function lookbackDays(today: string, n: number): string[] {
  const out: string[] = [];
  for (let k = Math.max(1, n); k >= 1; k--) out.push(shiftDay(today, -k));
  return out;
}

/** 4 · A branch's status for the period (default: the 7 days ending yesterday) is มีปัญหา */
export const teamRed: AlertRule = {
  id: "team_red",
  kind: "case",
  needs: ["counts", "salesDaily", "tos", "receipts", "prices"],
  evaluate(data, cfg) {
    const kind = (String(cfg.thresholds.period) as PeriodKind) || "week";
    const period = periodOf(kind === "today" || kind === "month" ? kind : "week", data.today);
    const inputs = branchInputsOf(data);
    const cases: CaseCandidate[] = [];
    for (const b of data.branches) {
      const m = branchMetrics(inputs.get(b.id)!, period, data.nowMs, DEFAULT_TARGETS);
      const s = scoreOf(Object.values(m));
      if (s.status !== "bad") continue;
      cases.push({
        key: `team_red:${b.id}`,
        rule: "team_red",
        title: `${b.name} สถานะ ${STATUS_LABEL.bad}`,
        detail: `ตรงเป้า ${s.score}/${s.total} ตัวชี้วัด (7 วันถึงเมื่อวาน)`,
        severity: "high",
        value: s.total - s.score,
        scope: { branchId: b.id },
        link: { page: "admin", teamId: b.id },
      });
    }
    return { cases, info: [] };
  },
};

/**
 * 5 · Daily count: the sheet not finished (นับเสร็จ) by close_hour on its own day, or the
 * day's difference Σ|variance| × price over diff_baht. A day with no sheet and no sales is
 * a closed day: skipped. A sheet finished before the sales came in isn't judged on its
 * difference (its stored difference has no recipe use in it).
 */
export const countProblem: AlertRule = {
  id: "count_problem",
  kind: "case",
  needs: ["counts", "salesDaily", "prices"],
  evaluate(data, cfg) {
    const t = { ...DEFAULT_TARGETS, countCloseHour: num(cfg.thresholds, "close_hour"), diffBahtPerDay: num(cfg.thresholds, "diff_baht") };
    const inputs = branchInputsOf(data);
    const cases: CaseCandidate[] = [];
    for (const b of data.branches) {
      const input = inputs.get(b.id)!;
      for (const day of lookbackDays(data.today, num(cfg.thresholds, "lookback_days"))) {
        const rows = input.counts.filter((r) => r.count_date === day);
        const sales = input.sales.filter((s) => s.sale_date === day);
        if (rows.length === 0 && sales.length === 0) continue;
        const open = rows.length === 0 || rows.some((r) => !r.is_submitted);
        if (open && data.nowMs > bangkokAt(day, t.countCloseHour)) {
          cases.push({
            key: `count_missing:${b.id}:${day}`,
            rule: "count_problem",
            title: `${b.name} ยังไม่กดนับเสร็จ ${thDow(day)}`,
            detail: rows.length ? `เลย ${t.countCloseHour}:00 แล้ว · ยอดคงเหลือวันถัดไปจะเริ่มจากใบที่ยังไม่ปิด` : `ไม่มีใบนับของวันนั้น (มียอดขาย)`,
            severity: "medium",
            value: 1,
            scope: { branchId: b.id, date: day },
            link: { page: "count", branchId: b.id, date: day },
            habitKey: `count_missing:${b.id}`,
            habitDay: day,
            habitLabel: `${b.name} นับสต๊อกไม่ทันเวลา`,
          });
        }
        if (diffMark(rows, day, data.nowMs, input.priceOn, t) === "fail" && !countedBeforeSales(rows, sales)) {
          const total = diffBaht(rows, day, input.priceOn);
          cases.push({
            key: `count_diff:${b.id}:${day}`,
            rule: "count_problem",
            title: `${b.name} นับแล้วขาด/เกิน ${baht(total)} ${thDow(day)}`,
            detail: `เกินเกณฑ์ ${baht(t.diffBahtPerDay)}/วัน`,
            severity: total >= t.diffBahtPerDay * 2 ? "high" : "medium",
            value: total,
            scope: { branchId: b.id, date: day },
            link: { page: "count", branchId: b.id, date: day },
            habitKey: `count_diff:${b.id}`,
            habitDay: day,
            habitLabel: `${b.name} นับแล้วต่างจากระบบเกิน ${baht(t.diffBahtPerDay)}`,
          });
        }
      }
    }
    return { cases, info: [] };
  },
};

/** 7 · No sales imported for a past day (skip_if_no_count: a day with no count sheet either = closed) */
export const salesMissing: AlertRule = {
  id: "sales_missing",
  kind: "case",
  needs: ["salesDaily", "counts"],
  evaluate(data, cfg) {
    const has = new Set(data.salesDaily.map((s) => `${s.branch_id}|${s.sale_date}`));
    const sheet = new Set(data.counts.map((c) => `${c.branch_id}|${c.count_date}`));
    const cases: CaseCandidate[] = [];
    for (const b of data.branches)
      for (const day of lookbackDays(data.today, num(cfg.thresholds, "lookback_days"))) {
        const k = `${b.id}|${day}`;
        if (has.has(k)) continue;
        if (flag(cfg.thresholds, "skip_if_no_count") && !sheet.has(k)) continue;
        cases.push({
          key: `sales_missing:${b.id}:${day}`,
          rule: "sales_missing",
          title: `${b.name} ยังไม่ลงยอดขาย ${thDow(day)}`,
          detail: "ยอดใช้ตามสูตรและของขาด/เกินของวันนั้นจะยังไม่ถูก",
          severity: "medium",
          value: 1,
          scope: { branchId: b.id, date: day },
          link: { page: "sales", branchId: b.id, date: day },
          habitKey: `sales_missing:${b.id}`,
          habitDay: day,
          habitLabel: `${b.name} ลงยอดขายไม่ทัน`,
        });
      }
    return { cases, info: [] };
  },
};

/** 9 · The count sheet was finished before the day's sales came in, on ≥ min_days of the last window_days */
export const countedEarly: AlertRule = {
  id: "counted_early",
  kind: "case",
  needs: ["counts", "salesDaily"],
  evaluate(data, cfg) {
    const inputs = branchInputsOf(data);
    const y = shiftDay(data.today, -1);
    const from = shiftDay(y, -(Math.max(1, num(cfg.thresholds, "window_days")) - 1));
    const cases: CaseCandidate[] = [];
    for (const b of data.branches) {
      const days = countedBeforeSalesDays(inputs.get(b.id)!, { from, to: y });
      if (days.length < num(cfg.thresholds, "min_days")) continue;
      cases.push({
        key: `counted_early:${b.id}`,
        rule: "counted_early",
        title: `${b.name} กดนับเสร็จก่อนลงยอดขาย ${days.length} วัน`,
        detail: `${days.map(thDow).join(" · ")} · ให้ลงยอดขายก่อนกดนับเสร็จ`,
        severity: "low",
        value: days.length,
        scope: { branchId: b.id, date: days[days.length - 1] },
        link: { page: "count", branchId: b.id, date: days[days.length - 1] },
      });
    }
    return { cases, info: [] };
  },
};
