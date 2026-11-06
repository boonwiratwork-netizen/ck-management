/**
 * Guard for src/components/TEXT-RULES.md: no text under 11px anywhere in the app.
 * (The Nov 2026 phone audit found 9.5–10.5px labels that nobody could read.)
 */
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const full = path.join(dir, n);
    if (statSync(full).isDirectory()) return n === "test" ? [] : files(full);
    return /\.tsx$/.test(n) && !n.includes(".test.") ? [full] : [];
  });

describe("text is at least 11px", () => {
  it("no text-[Npx] / fontSize below 11 in any component", () => {
    const bad: string[] = [];
    for (const f of files(SRC)) {
      const rel = path.relative(SRC, f);
      if (rel.startsWith("pages/dev/") || rel.startsWith("components/ui/")) continue;
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const m of line.matchAll(/text-\[(\d+(?:\.\d+)?)px\]|fontSize:\s*(\d+(?:\.\d+)?)\b/g)) {
            const px = Number(m[1] ?? m[2]);
            if (px < 11) bad.push(`${rel}:${i + 1} ${m[0]}`);
          }
        });
    }
    expect(bad).toEqual([]);
  });
});
