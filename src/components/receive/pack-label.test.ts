import { describe, expect, it } from "vitest";
import { packLabel } from "./parts";
import type { SKU } from "@/types/sku";

const neck = { packSize: 350, packUnit: "แพ็ค", usageUom: "ก." } as SKU;

describe("pack labels never make up a pack count from weight", () => {
  it("with the packed count: packs, and the weight when it isn't whole packs", () => {
    expect(packLabel(neck, 2005, 5)).toBe("5 แพ็ค (2,005 ก.)");
    expect(packLabel(neck, 1750, 5)).toBe("5 แพ็ค");
  });
  it("without it: whole packs as packs, any other weight as weight only (not '6 แพ็ค')", () => {
    expect(packLabel(neck, 1750)).toBe("5 แพ็ค");
    expect(packLabel(neck, 2005)).toBe("2,005 ก.");
  });
});
