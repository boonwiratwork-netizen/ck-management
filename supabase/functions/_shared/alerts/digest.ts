// The morning (08:00) and close-of-day (21:15) digests, one per person: what is new since
// they were last told (including pushes held outside the hours or over the cap), habits as
// one line each, the digest-only sections (close of day, weekly, month close) and one
// collapsed line for what is still open. Plain TypeScript, relative imports only.

import { RULE_LABEL, type AlertConfig, type RuleId } from "./config.ts";
import type { CaseRow, DeliveryRow, Recipient } from "./engine.ts";
import type { DigestKind } from "./time.ts";
import { bkkDay, bkkDow } from "./time.ts";
import type { CaseLink, InfoLine } from "./types.ts";
import { thDay } from "./rules/common.ts";

export interface DigestLine {
  section: "new" | "habit" | "info" | "open";
  text: string;
  key?: string;
  rule?: RuleId;
  link?: CaseLink;
  severity?: CaseRow["severity"];
}

export interface Digest {
  kind: DigestKind;
  title: string;
  /** The push's text (short) */
  body: string;
  /** Everything, for the app's ล่าสุด list */
  lines: DigestLine[];
  /** Cases told in this digest (logged so they aren't told again) */
  newKeys: string[];
  /** Open cases already told, still open and not acknowledged */
  stillOpen: number;
  /** Nothing new, no habit, no section: no push is sent */
  empty: boolean;
}

const SEV: Record<CaseRow["severity"], number> = { high: 0, medium: 1, low: 2 };

const INFO_HEAD: Partial<Record<RuleId, string>> = {
  close_of_day: "สรุปปิดวัน",
  weekly_scores: "คะแนนทีม 7 วัน",
  weekly_cost: "ต้นทุน / waste / ของใหม่",
  month_close: "ปิดเดือน: ยังขาด",
};

/** Has this person already been told this case's latest news? (a push or a digest that went out) */
export function toldSince(c: Pick<CaseRow, "key" | "changed_at">, deliveries: DeliveryRow[]): boolean {
  const since = Date.parse(c.changed_at);
  return deliveries.some((d) => d.case_key === c.key && (d.result === "sent") && Date.parse(d.sent_at) >= since);
}

export function buildDigest(input: {
  kind: DigestKind;
  nowMs: number;
  config: AlertConfig;
  recipient: Recipient;
  /** Open and acknowledged cases */
  cases: CaseRow[];
  /** This person's deliveries */
  deliveries: DeliveryRow[];
  habits: Map<string, { days: number; label: string }>;
  info: InfoLine[];
}): Digest {
  const { kind, nowMs, config, recipient } = input;
  const g = config.global;
  const day = bkkDay(nowMs);
  const mine = input.cases.filter((c) => !recipient.off.has(c.rule));
  const habitual = (c: CaseRow) => !!c.habit_key && input.habits.has(c.habit_key);

  const fresh = mine.filter((c) => c.status === "open" && !habitual(c) && !toldSince(c, input.deliveries)).sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.title.localeCompare(b.title));
  const stillOpen = mine.filter((c) => c.status === "open" && !habitual(c) && !fresh.includes(c)).length;

  const lines: DigestLine[] = fresh.map((c) => ({ section: "new", text: c.detail ? `${c.title} · ${c.detail}` : c.title, key: c.key, rule: c.rule, link: c.link, severity: c.severity }));

  // One line per habit (only of rules this person gets), never the day-by-day cases
  const habitRules = new Map<string, RuleId>();
  for (const c of mine) if (c.habit_key && input.habits.has(c.habit_key)) habitRules.set(c.habit_key, c.rule);
  for (const [k, rule] of habitRules) {
    const h = input.habits.get(k)!;
    lines.push({ section: "habit", text: `เป็นประจำ: ${h.label} ${h.days}/${g.habitWindowDays} วัน`, rule });
  }

  const info = input.info.filter((i) => !recipient.off.has(i.rule));
  let lastRule: RuleId | null = null;
  for (const i of info) {
    if (i.rule !== lastRule && INFO_HEAD[i.rule]) lines.push({ section: "info", text: `— ${INFO_HEAD[i.rule]} —`, rule: i.rule });
    lastRule = i.rule;
    lines.push({ section: "info", text: i.text, rule: i.rule, link: i.link });
  }
  if (stillOpen > 0) lines.push({ section: "open", text: `ยังค้าง ${stillOpen} เรื่อง (ดูอายุแต่ละเรื่องในแอป)` });

  const weekly = kind === "morning" && bkkDow(nowMs) === g.weeklyDow && info.some((i) => i.rule === "weekly_scores" || i.rule === "weekly_cost");
  const title = kind === "morning" ? `สรุปเช้า ${thDay(day)}${weekly ? " + สรุปสัปดาห์" : ""}` : `สรุปปิดวัน ${thDay(day)}`;

  const body: string[] = [];
  const top = lines.filter((l) => l.section === "new" || l.section === "habit");
  if (top.length) {
    body.push(...top.slice(0, g.digestPushLines).map((l) => l.text.split(" · ")[0]));
    if (top.length > g.digestPushLines) body.push(`และอีก ${top.length - g.digestPushLines} เรื่อง`);
  } else if (info.length) body.push(info.find((i) => !i.text.startsWith("—"))?.text ?? "");
  if (stillOpen > 0) body.push(`ยังค้าง ${stillOpen} เรื่อง`);

  return {
    kind,
    title,
    body: body.filter(Boolean).join("\n") || "ไม่มีเรื่องใหม่",
    lines,
    newKeys: fresh.map((c) => c.key),
    stillOpen,
    empty: fresh.length === 0 && habitRules.size === 0 && info.length === 0,
  };
}

/** Rule names for a digest line's tag in the app */
export const ruleLabel = (r: RuleId) => RULE_LABEL[r];
