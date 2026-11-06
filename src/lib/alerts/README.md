# Push alerts (แจ้งเตือนเข้ามือถือ)

Phone notifications for **management** and **ck_manager** (kitchen manager), sent to the installed app (Web Push). The LINE reports are separate and unchanged. Branch heads are not included in this round.

## What a person sees

- **Immediate** news (a TO declined, the kitchen sent short, a big price rise) arrives as a phone notification, but only between **08:00 and 21:30** Bangkok time and at most **5 a day** per person. Anything outside the hours or over the cap waits for the next digest.
- **สรุปเช้า 08:00**: what is new since yesterday, habits as one line each, and one line "ยังค้าง N เรื่อง". On **Monday** it also carries the weekly summary; from the **1st** of the month (until the 10th, or until it is complete) the month-close checklist.
- **สรุปปิดวัน 21:15**: today's sales against the same weekday last week, production against plan, transfer orders due and not sent.
- Tapping a notification opens the case's page (with its branch and day already picked). The bell on the management home page (and "แจ้งเตือน" in the menu) opens the inbox: **ยังค้าง** (age in days, severity, a button to the page, รับทราบ, and for prices ใช้ราคานี้เป็นปกติ), **ล่าสุด** (digests and recent changes), **ตั้งค่า** (this device on/off, which rules I get, and for management the thresholds and times for everybody).
- iPhone/iPad: notifications only work once the app is added to the home screen (iOS 16.4 or later). The settings screen says so.
- If a new app version is waiting (or the running one predates notifications) the switch is replaced by "อัปเดตแอป": the app subscribes only through a service worker that answers the `version` message with `push: true`. A subscription made with an old server key is renewed.

## The rules

All numbers below are defaults. They live in the database table `alert_settings` (one row per rule + `_global`) and are edited in the app (ตั้งค่า, management). Nothing is hard-coded in the rules; the defaults in `supabase/functions/_shared/alerts/config.ts` are only the seed and the fallback for a missing value.

| # | Rule (`alert_settings.rule`) | When | What it checks | Data | Case key |
|---|---|---|---|---|---|
| 1 | `to_declined` | immediate | A branch declined a transfer order (status Declined, changed in the last `lookback_hours` 48) — every time | `transfer_orders.status, decline_reason, updated_at` | `to_declined:<to_id>` |
| 2 | `to_short` | immediate | The kitchen sent more than `short_pct` 10% less than a branch request line asked. Packed items: packs × pack size; a request that isn't whole packs (pack size changed) is skipped, like the kitchen score | `transfer_order_lines` (lines with `tr_line_id`) of orders sent in the last 48 h, `skus.pack_size` | `to_short:<to_id>` |
| 3 | `price_rise_big` | immediate | An item's standard price changed in the last `lookback_days` 7 and is now `rise_pct` ≥25% above the price before (or above the price set as normal). `sku_types` RM | `price_history`, `prices` (newest active row = standard price) | `price_rise:<sku_id>` |
| 4 | `team_red` | morning | A branch's team status for the last 7 days (ending yesterday) is มีปัญหา — the home page's own score | as the home page: `daily_stock_counts`, sales per day, `transfer_orders`, `branch_receipts`, prices | `team_red:<branch>` |
| 5 | `count_problem` | morning | For the last `lookback_days` 2 days: the count sheet not finished by `close_hour` 23:00, or the day's difference Σ\|variance\| × price over `diff_baht` ฿1,000. Closed days (no sheet, no sales) and sheets finished before the sales came in are not judged on the difference | `daily_stock_counts`, price on that day | `count_missing:<branch>:<date>`, `count_diff:<branch>:<date>` |
| 6 | `to_unreceived` | morning | Status Sent for more than `hours` 24 and no branch receipt of it | `transfer_orders`, `branch_receipts.transfer_order_id` | `to_unreceived:<to_id>` |
| 7 | `sales_missing` | morning | No sales imported for one of the last 2 days; with `skip_if_no_count` a day without a count sheet either counts as closed | sales per day, `daily_stock_counts` | `sales_missing:<branch>:<date>` |
| 8 | `price_rise` | morning | As 3 with `rise_pct` 10% | as 3 | `price_rise:<sku_id>` (same case as 3) |
| 9 | `counted_early` | morning | "นับก่อนนำเข้ายอดขาย" on ≥ `min_days` 2 of the last `window_days` 7 | counts' finish time vs the day's first sales row | `counted_early:<branch>` |
| 10 | `close_of_day` | evening | Sales today vs same weekday last week (marks "ตกมาก" past `sales_drop_pct` 15%), kitchen production vs 1/6 of the week's plan, transfer orders due by today still Draft | sales per day, `weekly_plan_lines`, `production_records`, `transfer_orders` | — (digest lines) |
| 11 | `weekly_scores` | weekly | Every branch's team score, best first, with the week before | as 4 | — |
| 12 | `weekly_cost` | weekly | Food cost by recipe of the newest month saved by the Food Cost page, waste % of sales (7 days), menus / RM items created in the last `new_item_days` 7, RD (not in the app yet) | `food_cost_menu_monthly`, counts, sales, `menus.created_at`, `skus.created_at` | — |
| 13 | `month_close` | monthly | Up to day `max_days` 10: kitchen month-end count (the home page's own rule, shared code `_shared/month-count.ts`: a completed session within ±3 days counting ≥50% of the RM in the recipes of what was made), each branch's count on the last day, days with a count but no sales, TOs of the month not received, Food Cost saved for the closed month | `stock_count_sessions` + `stock_count_lines`, `production_records`, `bom_headers`/`bom_lines`, counts, sales, TOs, `food_cost_menu_monthly` | — |

Notes:
- "Sales per day" is `sales_entries` summed in the database by `alerts_sales_daily()` (net amount, first row's time).
- The kitchen is not in rules 4 and 11: its score needs the month kitchen cost, which only the app works out.
- Rule 12's food cost is only as fresh as the last time someone opened Food Cost / pressed "อัปเดตข้อมูลวิเคราะห์ทุกสาขา".
- Rule 13 takes the recipes as they are today (the kitchen cost page uses the recipe of the time), so a recipe changed since last month can shift its RM base slightly.
- Prices are read with `alerts_prices()` (per item: the last change before the look-back, every change since, today's standard price), not the whole history.

Global settings (`_global`): `window_start` 08:00, `window_end` 21:30, `morning_at` 08:00, `evening_at` 21:15, `weekly_dow` 1 (Monday), `daily_cap` 5, `dedupe_hours` 24, `habit_days` 4 of `habit_window_days` 7, `digest_catchup_minutes` 120 (a digest whose run failed still goes out up to 2 h late), `digest_push_lines` 3, `case_retention_days` 90 (closed cases deleted after), `vapid_public_key` (written by the server; the app subscribes with it).

## Cases: repeats are one case, not many messages

1. **Open**: the first time a rule finds something, a case opens under its key and people are told once (push or digest by tier).
2. **Still there**: not sent again. Digests count it in "ยังค้าง N เรื่อง"; the app shows its age in days.
3. **Worse**: told once more only if the value passes the rule's step from what people were last told (`worsen_step` + `worsen_mode`: price +10 points, count difference ×2, TO +2 days, team +1 missed metric), or if it moves to an immediate rule (+12% → +28%). A worse case clears "รับทราบ".
4. **รับทราบ**: silent until it closes or gets worse.
5. **ใช้ราคานี้เป็นปกติ** (prices): today's price becomes the base the rise is measured from (only while it is newer than the last change before the look-back). The case stays acknowledged and silent while the rise lasts, is news again if the price rises past the limit from the base, and closes when the change leaves the look-back; the base is cleared with it.
6. **Closed**: when the rule no longer finds it (count finished, TO received, price no longer up…), the case closes by itself. If it comes back it reopens as new news.
7. **Habits**: the same branch failing the same daily rule (count missing, count difference, sales missing) on ≥4 of the last 7 days is one line "เป็นประจำ: …" in the morning digest and is never pushed day by day.
8. A case is never pushed to the same person twice within 24 h (held for the digest instead).
9. No burst: a person's first device, or a rule switched back on, only gets news from then on as pushes; what was already open comes in the next digest.

## Changing things

- **A threshold, time, cap, on/off, or which digest a rule goes in**: the app, ตั้งค่า (management). Takes effect on the next run (≤15 min). Or SQL: `update alert_settings set thresholds = thresholds || '{"diff_baht": 1500}' where rule = 'count_problem';`
- **A new rule**: write it in `supabase/functions/_shared/alerts/rules/` (a pure `evaluate(data, settings)` returning cases or digest lines, listing the data it `needs`), add one line to `RULES` in `registry.ts`, add its defaults to `DEFAULT_RULES` (+ `RULE_LABEL`) in `config.ts`, add the same row to the seed JSON in a new migration (`insert … on conflict do nothing`), and tests in `src/lib/alerts/rules.test.ts`. New data → a loader branch in `supabase/functions/alerts-run/load.ts`.
- **Remove a rule**: switch it off in the settings (no code), or take its line out of `RULES`.

## Deploy (owner)

1. SQL Editor: run `supabase/migrations/20261107120000_push_alerts.sql` (tables, row security, the three buttons' functions, the sales-per-day function, the 15-minute cron job `alerts-tick`).
2. Keys, once: `node scripts/generate-vapid-keys.mjs` → in Supabase › Edge Functions › Secrets add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` = `mailto:` + an address you read. `REPORT_KEY` is already there (same key as the LINE reports).
3. Lovable chat: "Deploy the Supabase edge function alerts-run (supabase/functions/alerts-run/index.ts, verify_jwt = false as in supabase/config.toml). Don't change any other function."
4. Publish the app (new service worker + แจ้งเตือน page). On each phone: open the installed app → แจ้งเตือน → ตั้งค่า → เปิดแจ้งเตือนบนเครื่องนี้.

Rollback: `select cron.unschedule('alerts-tick');` stops everything; the tables can stay.

## Testing

- `npx vitest run src/lib/alerts src/test/integration/alerts.integration.test.tsx` — every rule (edge cases, thresholds from settings), Bangkok window and digest times, caps, 24 h dedupe, worsening, baseline, auto-close, habits, digest Thai text, registry, the screen through the real Supabase client over a fake network.
- A dry run against live data (reads only, writes and pushes nothing):
  `curl -X POST 'https://lyhhaeikbvhmjpyjhdbg.supabase.co/functions/v1/alerts-run?mode=digest-morning&dryRun=1' -H "x-report-key: <REPORT_KEY>"` — shows the rules run, case changes, planned pushes and each person's digest.
- Send a digest now: `?mode=digest-evening` (add `&force=1` if today's already went out).

## Technical notes

- Shared, pure code lives in `supabase/functions/_shared/` (plain TypeScript, relative `.ts` imports, no Deno/Node APIs) so the Edge Function and the app import the same files: `team-score.ts` (moved from `src/lib`, which now re-exports it), `transfer-short.ts`, `price-at.ts`, `day-math.ts`, and `alerts/` (`config`, `time`, `types`, `rules/*`, `registry`, `engine`, `digest`). The app imports them by relative path; `tsc -p tsconfig.app.json` type-checks them, vitest tests them.
- `alerts-run` (Deno): run lease (`alert_try_lock`, a lease row rather than `pg_try_advisory_lock`, which would leak on PostgREST's pooled connections) → settings → rules due (tick = immediate case rules; at the digest times = everything of that digest) → loads only what those rules `need` → `reconcile` (open/update/worsen/close) → `planPushes` (window, cap, dedupe, prefs) → `buildDigest` per person → writes `alert_cases`, `alert_deliveries`, `alert_digests`. A digest is claimed with `alert_claim_digest` (claim row `user_id` all zeros: running → done; a running claim older than 20 min is taken over; a failed run releases it; people who already got it are skipped on the retry). Every read and write is checked; any failure of what caps/dedupe/history depend on stops the run before sending, and each push is logged right after it goes out (a failed log stops further sends). A rule that throws is reported and its cases are left as they were.
- Web Push: `npm:web-push@3.6.7` with VAPID; payload `{title, body, url, tag}`; 404/410 deletes the device, 10 failures in a row too. `public/sw.js` shows the notification and on tap focuses an open app window (navigates it to the link) or opens one.
- Row security: people manage only their own devices and switches (endpoints must be https on fcm.googleapis.com, web.push.apple.com, *.push.services.mozilla.com or *.notify.windows.com — `alert_push_endpoint_ok`, enforced by a check constraint, the insert/update policies and the register function); management + ck_manager read cases; only the service role writes cases, deliveries, digests; the buttons are `security definer` functions that check the role.
- Cron: one job every 15 minutes in UTC (`*/15 * * * *`); the Bangkok times are read from the settings each run, so changing a time needs no SQL. Use times on :00/:15/:30/:45.
