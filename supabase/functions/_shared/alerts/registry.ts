// Every push-alert rule, in one list. Adding a rule = write it (rules/*.ts, a pure
// evaluate(data, settings)), add one line here, add its defaults to DEFAULT_RULES in
// config.ts and a row to alert_settings (migration). Removing one = take its line out
// (or switch it off in the settings, no code change).

import type { RuleId } from "./config.ts";
import type { AlertRule, DataNeed } from "./types.ts";
import { toDeclined, toShort, toUnreceived } from "./rules/transfer.ts";
import { priceRise, priceRiseBig } from "./rules/price.ts";
import { countedEarly, countProblem, salesMissing, teamRed } from "./rules/branch.ts";
import { closeOfDay, monthClose, weeklyCost, weeklyScores } from "./rules/summary.ts";

export const RULES: AlertRule[] = [
  toDeclined, // 1
  toShort, // 2
  priceRiseBig, // 3
  teamRed, // 4
  countProblem, // 5
  toUnreceived, // 6
  salesMissing, // 7
  priceRise, // 8
  countedEarly, // 9
  closeOfDay, // 10
  weeklyScores, // 11
  weeklyCost, // 12
  monthClose, // 13
];

export const ruleById = (id: RuleId) => RULES.find((r) => r.id === id);

/** Everything the given rules read, once */
export const needsOf = (rules: AlertRule[]): Set<DataNeed> => new Set(rules.flatMap((r) => r.needs));
