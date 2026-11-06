/**
 * Guard: every `table-fixed` table leaves its auto (name) column real room.
 *
 * With table-layout: fixed the one auto <col> only gets what is LEFT of the table
 * width after the fixed cols. A table whose min-width barely covers its fixed cols
 * (RecipeEditor had 620px for 554px of fixed cols) squeezes the ingredient name to
 * ~34px on a narrow screen, and Thai names wrap letter by letter into very tall rows.
 *
 * Rule checked per table (statically, from the source text):
 *   min-width − Σ fixed <col> widths ≥ MIN_ROOM px, and the table sits directly in
 *   an `overflow-x-auto` wrapper so the table scrolls, never the page.
 * - min-width comes from `min-w-[Npx]` or `style={{ minWidth: X }}` where X is a
 *   module const `= tableMinWidth([..], n?)` (src/lib/design-tokens.ts) or a number.
 *   A ternary (`a ? A_MIN : B_MIN`) counts as its widest value.
 * - Fixed cols count at their widest: `cond ? "128px" : "12px"` → 128, and cols
 *   behind `{cond && <col …/>}` are always counted.
 * - A table that never renders on phones/tablets can opt out with a `// desktop-only`
 *   (or `{/* desktop-only *\/}`) comment within the 3 lines above it — say why.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { NAME_COL_MIN, tableMinWidth } from "@/lib/design-tokens";

const MIN_ROOM = 160;
const SRC = path.resolve(__dirname, "..");

/** Files not checked, with the reason. Keep this list short. */
const SKIP: Record<string, string> = {
  // Legacy component, not imported anywhere (no colgroup at all). Delete or fix before reuse.
  "components/GoodsReceiptTable.tsx": "unused",
};

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith(".tsx") && !name.includes(".test.") ? [full] : [];
  });
}

export interface TableCheck {
  line: number;
  skipped: boolean;
  minWidth: number | null;
  fixedSum: number;
  autoCols: number;
  hasScrollWrapper: boolean;
  room: number | null;
}

/** Value of `const NAME = tableMinWidth([..], n?)` or `const NAME = 123` in the file. */
function resolveConst(src: string, name: string): number | null {
  const helper = new RegExp(`const\\s+${name}\\s*=\\s*tableMinWidth\\(\\s*\\[([^\\]]*)\\]\\s*(?:,\\s*(\\d+)\\s*)?\\)`).exec(src);
  if (helper) {
    const cols = helper[1].split(",").map((n) => Number(n.trim())).filter((n) => !Number.isNaN(n));
    return tableMinWidth(cols, helper[2] ? Number(helper[2]) : NAME_COL_MIN);
  }
  const literal = new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)\\s*;`).exec(src);
  return literal ? Number(literal[1]) : null;
}

/** Statically check every `<table … table-fixed …>` in one file's source. */
export function checkTables(src: string): TableCheck[] {
  const lines = src.split("\n");
  const out: TableCheck[] = [];
  const tableRe = /<table\b[^\n]*table-fixed[^\n]*/g;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(src))) {
    const line = src.slice(0, m.index).split("\n").length; // 1-based
    const above = lines.slice(Math.max(0, line - 4), line - 1).join("\n");
    const skipped = /desktop-only/.test(above);
    const tag = m[0];

    // min-width
    let minWidth: number | null = null;
    const tw = /min-w-\[(\d+)px\]/.exec(tag);
    if (tw) minWidth = Number(tw[1]);
    const sw = /minWidth:\s*([^}]+)/.exec(tag);
    if (sw) {
      const candidates = [...sw[1].matchAll(/\b([A-Z][A-Z0-9_]*|\d+)\b/g)].map(([, t]) => (/^\d+$/.test(t) ? Number(t) : resolveConst(src, t)));
      const known = candidates.filter((n): n is number => n !== null);
      if (known.length) minWidth = Math.max(...known);
    }

    // colgroup (must belong to this table: before its </table>)
    const end = src.indexOf("</table>", m.index);
    const body = src.slice(m.index, end === -1 ? undefined : end);
    const cg = /<colgroup>([\s\S]*?)<\/colgroup>/.exec(body);
    let fixedSum = 0;
    let autoCols = 0;
    if (cg) {
      for (const [col] of cg[1].matchAll(/<col\b[^>]*\/>/g)) {
        const widths = [...col.matchAll(/(\d+)px/g)].map(([, n]) => Number(n));
        if (widths.length) fixedSum += Math.max(...widths);
        else autoCols += 1;
      }
    }

    const hasScrollWrapper = /overflow-x-auto/.test(lines.slice(Math.max(0, line - 3), line - 1).join("\n"));
    out.push({ line, skipped, minWidth, fixedSum, autoCols, hasScrollWrapper, room: minWidth === null ? null : minWidth - fixedSum });
  }
  return out;
}

describe("table-fixed name column room", () => {
  it("parser catches the original RecipeEditor squeeze (620px table, 554px fixed)", () => {
    const bad = `
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] table-fixed text-sm">
            <colgroup>
              <col />
              <col style={{ width: "130px" }} />
              {!isSp && <col style={{ width: "96px" }} />}
              <col style={{ width: "90px" }} />
              <col style={{ width: "110px" }} />
              <col style={{ width: canEdit ? "128px" : "12px" }} />
            </colgroup>
          </table>
        </div>`;
    const [t] = checkTables(bad);
    expect(t.fixedSum).toBe(554);
    expect(t.room).toBe(66);
  });

  it("resolves tableMinWidth consts and ternaries", () => {
    const src = `
const A_MIN = tableMinWidth([100, 200]);
const B_MIN = tableMinWidth([100], 160);
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm" style={{ minWidth: on ? A_MIN : B_MIN }}>
          <colgroup><col /><col style={{ width: "100px" }} /><col style={{ width: on ? "200px" : "0px" }} /></colgroup>
        </table>
      </div>`;
    const [t] = checkTables(src);
    expect(t.minWidth).toBe(480);
    expect(t.room).toBe(180);
  });

  const files = tsxFiles(SRC).filter((f) => !(path.relative(SRC, f).split(path.sep).join("/") in SKIP));
  for (const file of files) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    const src = readFileSync(file, "utf8");
    if (!src.includes("table-fixed")) continue;
    for (const t of checkTables(src)) {
      if (t.skipped) continue;
      it(`${rel}:${t.line} gives its name column ≥ ${MIN_ROOM}px and scrolls inside overflow-x-auto`, () => {
        expect(t.autoCols, "exactly one auto <col /> (the name column) in a <colgroup>").toBe(1);
        expect(t.minWidth, "needs min-w-[Npx] or style={{ minWidth: tableMinWidth(...) }}").not.toBeNull();
        expect(t.room!, `min-width ${t.minWidth} − fixed cols ${t.fixedSum}`).toBeGreaterThanOrEqual(MIN_ROOM);
        expect(t.hasScrollWrapper, "wrap the table in an overflow-x-auto element").toBe(true);
      });
    }
  }
});
