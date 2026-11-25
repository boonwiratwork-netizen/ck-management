// Every tool the bot has, by the name Gemini calls it (tools.ts: costs; tools-stock.ts: stock,
// run rate, option rules, transfers).
import { TOOLS, type ToolResult } from "./tools.ts";
import { STOCK_TOOLS, type FullStore } from "./tools-stock.ts";

type Fn = (s: FullStore, a: never) => Promise<ToolResult>;
const ALL: Record<string, Fn> = { ...(TOOLS as unknown as Record<string, Fn>), ...(STOCK_TOOLS as unknown as Record<string, Fn>) };

export async function runTool(store: FullStore, name: string, args: unknown): Promise<ToolResult> {
  const fn = ALL[name];
  if (!fn) return { data: { error: `ไม่มีเครื่องมือชื่อ ${name}` } };
  try {
    return await fn(store, (args ?? {}) as never);
  } catch (e) {
    return { data: { error: `คิดไม่สำเร็จ: ${(e as Error).message}` } };
  }
}
