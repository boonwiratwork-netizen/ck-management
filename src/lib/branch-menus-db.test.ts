import { describe, expect, it, vi } from "vitest";

// A fake client that, like supabase-js, needs its object as "this" (a detached call throws)
const answers = vi.hoisted(() => ({ branch: { brand_name: "Sendo" } as { brand_name: string } | null }));
vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => ({
    select() {
      if (!this) throw new TypeError("detached");
      return this;
    },
    eq() {
      if (!this) throw new TypeError("detached");
      return this;
    },
    order() {
      if (!this) throw new TypeError("detached");
      return this;
    },
    range() {
      if (!this) throw new TypeError("detached");
      return this;
    },
    single() {
      if (!this) throw new TypeError("detached");
      return Promise.resolve({ data: answers.branch, error: null });
    },
    then(ok: (v: unknown) => unknown) {
      if (!this) throw new TypeError("detached");
      return Promise.resolve({ data: table === "menus" ? [{ id: "m1", brand_name: "Sendo" }, { id: "m2", brand_name: "Shiro" }, { id: "m3", brand_name: "Sendo" }] : [], error: null }).then(ok);
    },
  });
  return {
    supabase: {
      from(this: unknown, table: string) {
        if (!this) throw new TypeError("detached");
        return builder(table);
      },
    },
  };
});

import { brandMenuIds, menusOfBrand } from "./branch-menus-db";

describe("a branch's brand menus", () => {
  it("picks the branch's brand from every active menu; no branch = null", async () => {
    expect(menusOfBrand([{ id: "a", brand_name: "Sendo" }, { id: "b", brand_name: null }], "Sendo")).toEqual(["a"]);
    expect(await brandMenuIds("b1")).toEqual({ brandName: "Sendo", menuIds: ["m1", "m3"] });
    answers.branch = null;
    expect(await brandMenuIds("gone")).toBeNull();
  });
});
