import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_GLOBAL, DEFAULT_RULES, GLOBAL_ROW, RULE_IDS, RULE_LABEL, globalToJson, parseConfig, parseGlobal } from "../../../supabase/functions/_shared/alerts/config.ts";

const migration = readFileSync(resolve(__dirname, "../../../supabase/migrations/20261107120000_push_alerts.sql"), "utf8");

describe("alert settings: defaults", () => {
  it("the migration seeds exactly the defaults in config.ts (one place to change, checked here)", () => {
    const json = migration.split("-- ALERT_DEFAULTS_BEGIN")[1].split("-- ALERT_DEFAULTS_END")[0].replace(/^\s*\$json\$/, "").replace(/\$json\$::jsonb\s*$/, "");
    const rows = JSON.parse(json);
    const expected = [
      { rule: GLOBAL_ROW, enabled: true, tier: "morning", thresholds: globalToJson(DEFAULT_GLOBAL), worsen_step: null, worsen_mode: null },
      ...DEFAULT_RULES.map((r) => ({ rule: r.rule, enabled: r.enabled, tier: r.tier, thresholds: r.thresholds, worsen_step: r.worsenStep, worsen_mode: r.worsenMode })),
    ];
    expect(rows).toEqual(expected);
  });

  it("every rule id has defaults and a Thai name, once", () => {
    expect(DEFAULT_RULES.map((r) => r.rule).sort()).toEqual([...RULE_IDS].sort());
    for (const id of RULE_IDS) expect(RULE_LABEL[id]).toBeTruthy();
  });

  it("owner's numbers: window 08:00–21:30, digests 08:00 / 21:15 (Monday weekly), cap 5, 24 h", () => {
    expect(DEFAULT_GLOBAL).toMatchObject({ windowStart: "08:00", windowEnd: "21:30", morningAt: "08:00", eveningAt: "21:15", weeklyDow: 1, dailyCap: 5, dedupeHours: 24, habitDays: 4, habitWindowDays: 7 });
    const c = parseConfig([]);
    expect(c.rules.get("to_short")!.thresholds.short_pct).toBe(10);
    expect(c.rules.get("price_rise_big")!.thresholds.rise_pct).toBe(25);
    expect(c.rules.get("price_rise")!.thresholds.rise_pct).toBe(10);
    expect(c.rules.get("count_problem")!.thresholds).toMatchObject({ close_hour: 23, diff_baht: 1000 });
    expect(c.rules.get("to_unreceived")!.thresholds.hours).toBe(24);
  });
});

describe("alert settings: reading the table", () => {
  it("a stored value wins; a missing or wrong-typed key falls back to its default", () => {
    const c = parseConfig([
      { rule: "to_short", enabled: false, tier: "morning", thresholds: { short_pct: "15", lookback_hours: "abc" }, worsen_step: null, worsen_mode: null },
      { rule: GLOBAL_ROW, enabled: true, tier: "morning", thresholds: { daily_cap: 3, window_start: "7:00", morning_at: "07:30" }, worsen_step: null, worsen_mode: null },
    ]);
    const r = c.rules.get("to_short")!;
    expect(r.enabled).toBe(false);
    expect(r.tier).toBe("morning");
    expect(r.thresholds).toEqual({ short_pct: 15, lookback_hours: 48 });
    expect(c.global.dailyCap).toBe(3);
    expect(c.global.windowStart).toBe("08:00"); // "7:00" isn't HH:MM
    expect(c.global.morningAt).toBe("07:30");
  });

  it("an unknown tier keeps the default; worsen step needs a mode and a positive number", () => {
    const c = parseConfig([{ rule: "price_rise", enabled: null, tier: "hourly", thresholds: null, worsen_step: "0", worsen_mode: "add" }]);
    const r = c.rules.get("price_rise")!;
    expect(r.enabled).toBe(true);
    expect(r.tier).toBe("morning");
    expect(r.worsenStep).toBeNull();
    expect(r.worsenMode).toBeNull();
  });

  it("global round-trips through its stored JSON", () => {
    const g = { ...DEFAULT_GLOBAL, dailyCap: 7, eveningAt: "20:45", vapidPublicKey: "BKey" };
    expect(parseGlobal(globalToJson(g))).toEqual(g);
  });
});
