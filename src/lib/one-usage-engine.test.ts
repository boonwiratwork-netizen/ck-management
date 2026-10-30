import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard: sales → ingredients is worked out in one place only (sale-usage.ts).
 * Six screens once had their own copies; each drifted (Delivery Set noodle swaps,
 * SP swaps, branch recipe lines) and the same sales gave different numbers on
 * different pages. A screen that needs usage calls addSaleUsage / usageOf.
 */
const ALLOWED = new Set(["src/lib/sale-usage.ts", "src/lib/bill-check.ts", "src/lib/pos-options.ts", "src/lib/modifier-rules.ts"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

describe("one usage engine", () => {
  it("no screen matches modifier rules to sales on its own", () => {
    const offenders = files("src").filter((p) => !ALLOWED.has(p) && readFileSync(p, "utf8").includes("ruleMatchesSale("));
    expect(offenders).toEqual([]);
  });
});
