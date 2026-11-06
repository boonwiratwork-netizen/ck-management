# Text on a phone — rules for every page

The owner's complaint (Nov 2026): text crowded, labels wrapping into many lines, text cut off, walls of small grey
explanation, jargon nobody says. Every page must read cleanly at **375px** wide. These rules are the bar.

## Size
- Nothing under **12px**, except a tiny unit/date under a number (11px minimum). No `text-[9.5px]`, `text-[10px]`, `text-[10.5px]`.
- Body / row titles 14px; supporting line 12–13px.
- No letter-spaced tiny section labels (`tracking-[0.14em] text-xs uppercase` style). A section heading is a normal 13–15px semibold line.

## No wrapping into a mess
- A label lives in a space wide enough for it on **one line** (two at most for a long proper name, e.g. a branch).
  If it can't fit beside something, put it **above** it — never squeeze it into a narrow column.
- Text and buttons/pills on one row: the text gets `min-w-0 flex-1`; if both don't fit, the pill/button moves to its
  **own row below** (`flex-wrap`, or stack). A text column must never collapse to one word per line.
- Document / item codes (`TO-…`, `TR-…`, `MN-…`, `SM-…`) are never the headline. Show them small, `whitespace-nowrap`,
  or not at all. Never let a code push out the useful part (date, count).
- Keep phrases together: wrap units with their number (`whitespace-nowrap` on "9 รายการ", "(6 ชิ้น)").
- Never `truncate` text whose end carries meaning (a date, an amount). Shorten the copy instead.

## No floods
- No formula or legend paragraph under a title or table (`X = A + B − C`, `แตะ… = …`, `สี = …`).
  If it's needed, it goes in the page's วิธีใช้ / a tap-to-explain, or is cut.
- A row shows at most one short supporting line. Dot-separated meta lines with 3+ parts → keep the one that matters.
- A subtitle under a page title: one short line or none.

## Numbers
- Every number says what it is (a label or unit next to it). A lone `฿102.45 / 32.7%` or `—` with no label is not OK.
- Numbers: `font-mono tabular-nums`, right-aligned in tables.

## Words people actually say
- No English jargon or abbreviations in the UI: `diff`, `Waste`, `Food cost`, `vs`, `POS`, `CSV`, `SM/RM/PK`, `Area`.
  Use: ของขาด/เกิน, ของเสีย, ต้นทุนอาหาร, เทียบกับ, เครื่องขาย (POS), ไฟล์ยอดขาย, ของครัวผลิต/วัตถุดิบ/บรรจุภัณฑ์.
  (Brand and menu names stay as they are.)
- No coined terms: `กฎ`, `ตัดของ`, `/ที่`, `บรรทัด`, `รายการหลังนับ`. Say it the way a branch manager would:
  "ต่อจาน", "แถว", "ใช้ของตามสูตร".
- Short and concrete: "ยังไม่รับ 2 วัน" beats "สถานะ: รอการรับสินค้า (2 วัน)".

## Checking
Screenshot the page at 375×812 (tour popup dismissed) and **look** at it. A `scrollWidth` check passes even when
text is clipped — only eyes catch a word broken across lines.
