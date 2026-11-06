import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * The exported picture/PDF is always light: the export node carries .force-light, and
 * index.css gives .force-light the same token block as :root (so inside .dark it resets).
 */
const src = (p: string) => readFileSync(path.resolve(__dirname, "..", p), "utf8");

describe("recipe sheet export is always light", () => {
  it("index.css defines the light tokens for :root and .force-light together", () => {
    const css = src("index.css");
    expect(css).toMatch(/:root,\s*\.force-light\s*\{/);
    // the dark block must not also target .force-light
    expect(css).not.toMatch(/\.dark[^{]*\.force-light/);
  });

  it("the export node carries force-light", () => {
    const panel = src("components/recipe-sheet/RecipeSheetPanel.tsx");
    const node = panel.split("\n").find((l) => l.includes("ref={imageNode}"));
    expect(node).toMatch(/className="force-light\b/);
  });
});
