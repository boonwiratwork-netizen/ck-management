import { afterEach, describe, expect, it, vi } from "vitest";
import { ask, askTiered, gaveUp, isHard, RateLimited } from "../../../supabase/functions/line-bot/gemini.ts";

const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
const base = { key: "k", system: "s", turns: [{ role: "user" as const, parts: [{ text: "q" }] }], runTool: async () => ({ data: {} }) };
const modelOf = (url: string) => decodeURIComponent(url.split("/models/")[1].split(":")[0]);

afterEach(() => vi.unstubAllGlobals());

describe("Gemini calls", () => {
  it("only the last round's tables are shown (earlier tries aren't)", async () => {
    const replies = [
      { candidates: [{ content: { parts: [{ functionCall: { name: "food_cost", args: {} } }] } }] },
      { candidates: [{ content: { parts: [{ functionCall: { name: "menu_cost", args: { query: "x" } } }] } }] },
      { candidates: [{ content: { parts: [{ text: "คำตอบ" }] } }] },
    ];
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(replies.shift()), { status: 200 }));
    const r = await ask({ ...base, models: ["a"], runTool: async (name) => ({ data: {}, card: { title: name, columns: [], rows: [] } }) });
    expect(r.cards.map((c) => c.title)).toEqual(["menu_cost"]);
    expect(r.calls.map((c) => c.name)).toEqual(["food_cost", "menu_cost"]);
  });

  it("a model that times out passes the question to the next one", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(modelOf(url));
      if (seen.length === 1) throw new DOMException("Signal timed out.", "TimeoutError");
      return ok("ตอบแล้ว");
    });
    const r = await ask({ ...base, models: ["a", "b"] });
    expect(seen).toEqual(["a", "b"]);
    expect(r).toMatchObject({ text: "ตอบแล้ว", model: "b" });
  });

  it("a model that doesn't know the thinking setting is asked again without it", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body.generationConfig);
      if (body.generationConfig.thinkingConfig) return new Response('{"error":{"message":"Unknown name \\"thinkingLevel\\" at generation_config.thinking_config"}}', { status: 400 });
      return ok("ตอบแล้ว");
    });
    const r = await ask({ ...base, models: ["old"] });
    expect(r.text).toBe("ตอบแล้ว");
    expect(bodies).toEqual([{ temperature: 0.2, thinkingConfig: { thinkingLevel: "low" } }, { temperature: 0.2 }]);
  });

  it("busy once: retried; busy everywhere: says busy (the group gets 'try again')", async () => {
    let n = 0;
    vi.useFakeTimers();
    vi.stubGlobal("fetch", async () => (n++, new Response("{}", { status: 503 })));
    const p = ask({ ...base, models: ["a", "b"] }).catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await p).toBeInstanceOf(RateLimited);
    expect(n).toBe(4); // a, a again, b, b again
    vi.useRealTimers();
  });

  it("two tiers: the light model first; a stronger one only when the light one gives up", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const m = modelOf(url);
      seen.push(m);
      return ok(m === "gemini-flash-lite-latest" ? "ขออภัยครับ ระบบไม่สามารถคำนวณได้" : "ต้นทุน 35 บาท");
    });
    const r = await askTiered({ ...base, question: "ต้นทุนโปรตีนในราเมน" });
    expect(seen).toEqual(["gemini-flash-lite-latest", "gemini-flash-latest"]);
    expect(r).toMatchObject({ text: "ต้นทุน 35 บาท", tier: "escalated", model: "gemini-flash-latest" });
    expect(r.firstCalls).toEqual([]);

    seen.length = 0;
    vi.stubGlobal("fetch", async (url: string) => (seen.push(modelOf(url)), ok("ต้นทุน 35 บาท")));
    const easy = await askTiered({ ...base, question: "ต้นทุนสันคอ" });
    expect(seen).toEqual(["gemini-flash-lite-latest"]);
    expect(easy.tier).toBe("lite");
  });

  it("two tiers: many conditions go to the stronger model first; a failed second try keeps the first answer", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => (seen.push(modelOf(url)), ok("FC 31%")));
    const r = await askTiered({ ...base, question: "ถ้าราเมนขึ้น 10% ลดสันคอเหลือ 15 ก. ขายเพิ่ม 20%" });
    expect(seen[0]).toBe("gemini-flash-latest");
    expect(r.tier).toBe("strong");

    vi.stubGlobal("fetch", async (url: string) => {
      if (modelOf(url) === "gemini-flash-lite-latest") return ok("ตอบไม่ได้ครับ");
      throw new DOMException("Signal timed out.", "TimeoutError");
    });
    const kept = await askTiered({ ...base, question: "ต้นทุนโปรตีน" });
    expect(kept).toMatchObject({ text: "ตอบไม่ได้ครับ", tier: "lite" });
  });

  it("two tiers: no second try when there's no time left for it", async () => {
    const seen: string[] = [];
    let t = 1_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => t);
    vi.stubGlobal("fetch", async (url: string) => (seen.push(modelOf(url)), (t += 70_000), ok("ขออภัย ตอบไม่ได้")));
    const r = await askTiered({ ...base, question: "ต้นทุนโปรตีน" });
    clock.mockRestore();
    expect(seen).toEqual(["gemini-flash-lite-latest"]);
    expect(r.tier).toBe("lite");
  });

  it("what counts as hard, and as giving up", () => {
    expect(isHard("ต้นทุนสันคอ 10 ก.")).toBe(false);
    expect(isHard("FC Shiro 1/11 - 15/11")).toBe(false);
    expect(isHard("ถ้า Standard 289 Signature 339 ขายเพิ่ม 20% FC เท่าไหร่")).toBe(true);
    expect(gaveUp({ text: "", cards: [], calls: [], model: "a" })).toBe(true);
    expect(gaveUp({ text: "ok", cards: [], calls: [{ name: "cannot_answer", args: {} }], model: "a" })).toBe(true);
    expect(gaveUp({ text: "FC 31.0%", cards: [], calls: [], model: "a" })).toBe(false);
    expect(gaveUp({ text: "คำถามนี้ต้องคิดหลายขั้นเกินไป ลองถามแยกเป็นทีละเรื่องได้ไหมครับ", cards: [], calls: [], model: "a" })).toBe(true);
    // a real answer with a table, even with a "can't" in it
    expect(gaveUp({ text: "ขาย 259 ไม่สามารถถึง FC 30%", cards: [{ title: "x", columns: [], rows: [] }], calls: [], model: "a" })).toBe(false);
  });
});
