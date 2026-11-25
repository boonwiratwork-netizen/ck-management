// Gemini with function calling, over plain REST. Gemini reads the question (and a photo),
// picks tools and their arguments; the tools work every number out.

import type { Card } from "./cards.ts";
import type { ToolResult } from "./tools.ts";

export class RateLimited extends Error {}

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
    parameters: { type: "OBJECT", properties: { query: S("ชื่อหรือรหัสวัตถุดิบ"), days: N("ย้อนดูการเปลี่ยนราคากี่วัน (ไม่ระบุ = 90)") }, required: ["query"] },
  },
  {
    name: "menu_cost",
    description: "ต้นทุนต่อจานของเมนูเดียว ตามสูตรหน้าร้านวันนี้ (รวมกฎพิเศษ) และ food cost % เทียบราคาขาย หรือเทียบราคาใหม่ที่ถาม",
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
        menu_prices: { type: "ARRAY", description: "เมนูที่เปลี่ยนราคาขาย", items: { type: "OBJECT", properties: { menu: S("ชื่อหรือรหัสเมนู"), new_price: N("ราคาใหม่") }, required: ["menu", "new_price"] } },
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
  const cards: Card[] = [];
  let models = [...opts.models];
  for (let step = 0; step < (opts.maxSteps ?? 6); step++) {
    let res: Response | null = null;
    let model = models[0];
    while (models.length) {
      model = models[0];
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": opts.key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: opts.system }] }, contents: turns, tools: [{ functionDeclarations: DECLARATIONS }], generationConfig: { temperature: 0.2 } }),
        signal: AbortSignal.timeout(25_000),
      });
      // A model name Google no longer serves, or this model's free quota used up: try the next
      if ((res.status === 404 || res.status === 429) && models.length > 1) {
        models = models.slice(1);
        continue;
      }
      break;
    }
    if (!res) throw new Error("ไม่มีรุ่น Gemini ที่ใช้ได้");
    if (res.status === 429) throw new RateLimited("rate limited");
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const parts: Part[] = json?.candidates?.[0]?.content?.parts ?? [];
    const fc = parts.filter((p): p is { functionCall: { name: string; args: unknown } } => "functionCall" in p);
    if (!fc.length) {
      const text = parts.map((p) => ("text" in p ? p.text : "")).join("").trim();
      return { text, cards: cards.slice(-3), calls, model };
    }
    turns.push({ role: "model", parts });
    const responses: Part[] = [];
    for (const c of fc) {
      calls.push({ name: c.functionCall.name, args: c.functionCall.args });
      const r = await opts.runTool(c.functionCall.name, c.functionCall.args);
      if (r.card) cards.push(r.card);
      responses.push({ functionResponse: { name: c.functionCall.name, response: { result: r.data } } });
    }
    turns.push({ role: "user", parts: responses });
  }
  return { text: "คำถามนี้ต้องคิดหลายขั้นเกินไป ลองถามแยกเป็นทีละเรื่องได้ไหมครับ", cards: cards.slice(-3), calls, model: models[0] ?? "" };
}
