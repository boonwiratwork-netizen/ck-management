import { afterEach, describe, expect, it, vi } from "vitest";
import { ask, RateLimited } from "../../../supabase/functions/line-bot/gemini.ts";

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
});
