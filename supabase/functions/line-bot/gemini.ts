// Gemini with function calling, over plain REST. Gemini reads the question (and a photo),
// picks tools and their arguments; the tools work every number out.

import type { Card } from "./cards.ts";
import type { ToolResult } from "./tools.ts";

export class RateLimited extends Error {}

/** One Gemini call; a slower one moves on to the next model */
const PER_CALL_MS = 20_000;
const timeoutSignal = (ms: number): AbortSignal => {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(new DOMException("Signal timed out.", "TimeoutError")), ms);
  return c.signal;
};

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } } | { functionCall: { name: string; args: unknown } } | { functionResponse: { name: string; response: unknown } };
export interface Turn {
  role: "user" | "model";
  parts: Part[];
}

const S = (description: string) => ({ type: "STRING", description });
const N = (description: string) => ({ type: "NUMBER", description });
const PERIOD = {
  from: S("วันแรก yyyy-mm-dd (ไม่ระบุ = ต้นเดือนนี้)"),
  to: S("วันสุดท้าย yyyy-mm-dd (ไม่ระบุ = วันนี้)"),
  branch: S("ชื่อสาขา เช่น Shiro, Thaniya (ไม่ระบุ = ทุกสาขา)"),
};

export const DECLARATIONS = [
  {
    name: "ingredient_price",
    description: "ราคาวัตถุดิบในระบบตอนนี้ และราคาที่เปลี่ยนในช่วงที่ผ่านมา ค้นด้วยชื่อหรือรหัส (RM-/SM-)",
    parameters: {
      type: "OBJECT",
      properties: {
        query: S("ชื่อหรือรหัสวัตถุดิบ"),
        days: N("ย้อนดูการเปลี่ยนราคากี่วัน (ไม่ระบุ = 90)"),
        qty: N("ถ้าถามต้นทุนตามปริมาณ: ปริมาณ"),
        unit: S("หน่วยของปริมาณ เช่น g, กก., ml, ชิ้น"),
        cooked: { type: "BOOLEAN", description: "ปริมาณนั้นเป็นน้ำหนักหลังปรุง/หุงสุกแล้ว (เช่น ข้าวสุก)" },
      },
      required: ["query"],
    },
  },
  {
    name: "menu_cost",
    description: "ต้นทุนต่อจานตามสูตรหน้าร้านวันนี้ (รวมกฎพิเศษ) และ food cost % เทียบราคาขายหรือราคาใหม่ ใส่ชื่อกลุ่มได้ เช่น Standard, Signature, ด้ง จะได้ทุกเมนูในกลุ่ม",
    parameters: { type: "OBJECT", properties: { query: S("ชื่อหรือรหัสเมนู (MN-)"), branch: PERIOD.branch, new_price: N("ราคาขายใหม่ที่อยากเทียบ (ถ้ามี)") }, required: ["query"] },
  },
  {
    name: "food_cost",
    description: "Food cost ตามสูตรของช่วงเวลา (เหมือนหน้าต้นทุนอาหารในแอป): ยอดขาย ต้นทุน % และเมนูขายดี",
    parameters: { type: "OBJECT", properties: { ...PERIOD, top: N("จำนวนเมนูที่แสดง (ไม่ระบุ = 10)") } },
  },
  {
    name: "scenario",
    description: "ถ้าเปลี่ยนราคาขาย ราคาวัตถุดิบ หรือจำนวนที่ขาย food cost และกำไรหลังหักวัตถุดิบจะเป็นเท่าไหร่ คิดจากยอดขายจริงของช่วงเวลา ใส่เงื่อนไขทุกข้อที่คุยกันมาในครั้งเดียว",
    parameters: {
      type: "OBJECT",
      properties: {
        ...PERIOD,
        menu_prices: {
          type: "ARRAY",
          description: "เมนูที่เปลี่ยนราคาขาย: ทีละเมนู (menu) หรือทั้งหมวด (category เช่น ramen) ใส่ราคาใหม่ หรือเปลี่ยนกี่ %",
          items: { type: "OBJECT", properties: { menu: S("ชื่อหรือรหัสเมนู"), category: S("หรือทั้งหมวด เช่น ramen, appetizer, drinks"), new_price: N("ราคาใหม่ (บาท)"), change_pct: N("หรือขึ้น/ลงกี่ % เช่น 10 หรือ -5") } },
        },
        ingredient_prices: {
          type: "ARRAY",
          description: "วัตถุดิบที่ราคาเปลี่ยน",
          items: { type: "OBJECT", properties: { item: S("ชื่อหรือรหัสวัตถุดิบ"), new_price_per_kg: N("ราคาใหม่ต่อ กก. หรือต่อลิตร หรือต่อชิ้น"), change_pct: N("หรือเปลี่ยนกี่ % เช่น 10 = แพงขึ้น 10%") }, required: ["item"] },
        },
        volume: {
          type: "ARRAY",
          description: "จำนวนที่ขายเปลี่ยน",
          items: {
            type: "OBJECT",
            properties: { menus: { type: "ARRAY", items: S("ชื่อเมนู"), description: "เมนูที่ขายเปลี่ยน" }, group: { type: "STRING", enum: ["price_changed", "all"], description: "หรือทั้งกลุ่ม: เมนูที่เปลี่ยนราคา / ทุกเมนู" }, change_pct: N("ขายเพิ่ม/ลดกี่ % เช่น 20") },
            required: ["change_pct"],
          },
        },
        include_delivery: { type: "BOOLEAN", description: "ราคาใหม่ใช้กับเดลิเวอรี่ด้วยไหม (ไม่ระบุ = ไม่)" },
      },
    },
  },
  {
    name: "ingredient_in_menus",
    description: "วัตถุดิบนี้อยู่ในเมนูไหนบ้าง แต่ละเมนูใช้เท่าไหร่ ต้นทุนเท่าไหร่ (ข้าวบอกทั้งน้ำหนักดิบและสุก)",
    parameters: { type: "OBJECT", properties: { query: S("ชื่อหรือรหัสวัตถุดิบ"), menus: S("เฉพาะเมนูที่ชื่อมีคำนี้ เช่น ด้ง, ราเมน (ไม่ระบุ = ทุกเมนู)") }, required: ["query"] },
  },
  {
    name: "cannot_answer",
    description: "ใช้เมื่อไม่มีเครื่องมือไหนตอบคำถามนี้ได้ หรือข้อมูลในระบบไม่พอ (ห้ามเดาเรียกเครื่องมืออื่นแทน)",
    parameters: { type: "OBJECT", properties: { reason: S("ทำไมตอบไม่ได้ ขาดข้อมูลอะไร"), closest: S("สิ่งที่ใกล้เคียงที่สุดที่ตอบได้ (ถ้ามี)") }, required: ["reason"] },
  },
  {
    name: "compare_items",
    description: "เทียบรายการวัตถุดิบ ปริมาณ และต้นทุนที่มีคนแจ้งมา (จากภาพหรือข้อความ) กับราคาในระบบ",
    parameters: {
      type: "OBJECT",
      properties: {
        dish: S("ชื่อจาน (ถ้ามี)"),
        items: {
          type: "ARRAY",
          items: { type: "OBJECT", properties: { name: S("ชื่อวัตถุดิบตามที่เขียน"), qty: N("ปริมาณ"), unit: S("หน่วย เช่น g, กก., ชิ้น, ml"), stated_cost: N("ต้นทุนที่เขียนไว้ (บาท) ถ้ามี"), code: S("รหัสในระบบ ถ้ารู้") }, required: ["name", "qty"] },
        },
      },
      required: ["items"],
    },
  },
];

export async function ask(opts: {
  key: string;
  models: string[];
  system: string;
  turns: Turn[];
  runTool: (name: string, args: unknown) => Promise<ToolResult>;
  maxSteps?: number;
}): Promise<{ text: string; cards: Card[]; calls: { name: string; args: unknown }[]; model: string }> {
  const turns = [...opts.turns];
  const calls: { name: string; args: unknown }[] = [];
  let lastCards: Card[] = [];
  let models = [...opts.models];
  /** Models that refused the thinking setting (older ones): asked without it */
  const plainConfig = new Set<string>();
  // The whole answer has to fit the function's time (LINE also wants the reply soon)
  const deadline = Date.now() + 100_000;
  for (let step = 0; step < (opts.maxSteps ?? 6); step++) {
    let res: Response | null = null;
    let model = models[0];
    let retried = false;
    while (models.length) {
      model = models[0];
      if (Date.now() > deadline) throw new RateLimited("out of time");
      const generationConfig: Record<string, unknown> = { temperature: 0.2 };
      // Short thinking: these questions only need a tool picked (Gemini 3.x thinkingLevel;
      // a model that doesn't know it says so with a 400, and is asked again without it)
      if (!plainConfig.has(model)) generationConfig.thinkingConfig = { thinkingLevel: "low" };
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": opts.key },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: opts.system }] }, contents: turns, tools: [{ functionDeclarations: DECLARATIONS }], generationConfig }),
          signal: timeoutSignal(PER_CALL_MS),
        });
      } catch (e) {
        // Too slow (or the connection dropped): the next model, never a silent failure
        console.warn("[line-bot] gemini call failed", model, (e as Error).message);
        res = null;
        if (models.length > 1) {
          models = models.slice(1);
          retried = false;
          continue;
        }
        throw new RateLimited(`timeout ${model}`);
      }
      if (res.status === 400 && !plainConfig.has(model)) {
        const body = await res.clone().text();
        if (/thinking/i.test(body)) {
          plainConfig.add(model);
          continue;
        }
      }
      // Busy for a moment (503 "high demand", 500): once more on the same model after a pause
      if ((res.status === 503 || res.status === 500) && !retried) {
        retried = true;
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      // Still busy, a model name Google no longer serves, or its free quota used up: the next model
      if ((res.status === 404 || res.status === 429 || res.status === 503 || res.status === 500) && models.length > 1) {
        models = models.slice(1);
        retried = false;
        continue;
      }
      break;
    }
    if (!res) throw new Error("ไม่มีรุ่น Gemini ที่ใช้ได้");
    if (res.status === 429 || res.status === 503) throw new RateLimited(`busy ${res.status}`);
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const parts: Part[] = json?.candidates?.[0]?.content?.parts ?? [];
    const fc = parts.filter((p): p is { functionCall: { name: string; args: unknown } } => "functionCall" in p);
    if (!fc.length) {
      const text = parts.map((p) => ("text" in p ? p.text : "")).join("").trim();
      return { text, cards: lastCards.slice(-3), calls, model };
    }
    turns.push({ role: "model", parts });
    const responses: Part[] = [];
    // The tables shown are the ones the answer rests on: the last round of calls, not every try
    lastCards = [];
    for (const c of fc) {
      calls.push({ name: c.functionCall.name, args: c.functionCall.args });
      const r = await opts.runTool(c.functionCall.name, c.functionCall.args);
      if (r.card) lastCards.push(r.card);
      responses.push({ functionResponse: { name: c.functionCall.name, response: { result: r.data } } });
    }
    turns.push({ role: "user", parts: responses });
  }
  return { text: "คำถามนี้ต้องคิดหลายขั้นเกินไป ลองถามแยกเป็นทีละเรื่องได้ไหมครับ", cards: [], calls, model: models[0] ?? "" };
}
