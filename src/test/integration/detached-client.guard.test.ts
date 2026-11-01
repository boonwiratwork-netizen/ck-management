import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

/**
 * supabase-js methods read `this` (rpc reads this.rest). Taken off the client they throw
 * before anything is sent — on 31 Oct `const call = supabase.rpc as unknown as …` left every
 * receive / decline / stock-move button spinning. Mocked unit tests can't see it, so the
 * source is checked for the shapes that detach a method. Bind it instead:
 * `supabase.rpc.bind(supabase)`, or call it in place.
 */
const SRC = path.resolve(__dirname, "../..");
const PATTERNS: [string, RegExp][] = [
  ["cast of a detached method", /supabase\.(rpc|from|auth\.[a-zA-Z]+)\s+as\b/],
  ["method assigned to a variable", /=\s*supabase\.(rpc|from)\s*;/],
  ["method destructured off the client", /\{\s*(rpc|from)\s*\}\s*=\s*supabase\b/],
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return name === "test" ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("no supabase method is used off its client", () => {
  it("src/ (tests excluded) has none of the detaching patterns", () => {
    const found: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const [what, re] of PATTERNS) if (re.test(line)) found.push(`${path.relative(SRC, file)}:${i + 1} ${what}: ${line.trim()}`);
        });
    }
    expect(found).toEqual([]);
  });

  it("the patterns do catch the 31 Oct line", () => {
    const bad = "  const call = supabase.rpc as unknown as (f: string) => Promise<unknown>;";
    expect(PATTERNS.some(([, re]) => re.test(bad))).toBe(true);
    expect(PATTERNS.some(([, re]) => re.test("const f = supabase.from;"))).toBe(true);
    expect(PATTERNS.some(([, re]) => re.test("const { rpc } = supabase;"))).toBe(true);
    expect(PATTERNS.some(([, re]) => re.test("const call = supabase.rpc.bind(supabase) as unknown as X;"))).toBe(false);
  });
});
