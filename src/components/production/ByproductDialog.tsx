import { useState } from "react";
import { Button } from "@/components/ui/button";

export interface ByproductAsk {
  /** The recipe being recorded (น้ำสต๊อก) */
  name: string;
  grams: number;
  /** Each by-product and what the recipe expects for this much output */
  items: { skuId: string; name: string; expected: number; uom: string }[];
}

const n0 = (n: number) => Math.round(n).toLocaleString();

/**
 * Before saving a pot that has by-products (น้ำสต๊อก → น้ำมันไก่ + น้ำสต๊อกโทริ ไพตัน):
 * what came out for real. The recipe's amount is filled in; the kitchen types what
 * it weighed (0 if it wasn't kept). Saved amounts go into stock as typed — the old
 * fixed 8 kg / 30 kg every pot is what made both pile up.
 */
export function ByproductDialog({ ask, busy, onSave, onCancel }: { ask: ByproductAsk; busy: boolean; onSave: (qty: Record<string, number>) => void; onCancel: () => void }) {
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(ask.items.map((i) => [i.skuId, String(Math.round(i.expected))])));
  const parsed = Object.fromEntries(Object.entries(qty).map(([k, v]) => [k, Math.max(0, Number(v.replace(/,/g, "")) || 0)]));
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-label="ผลพลอยได้ที่ได้จริง" className="flex w-full max-w-md flex-col gap-4 rounded-t-3xl bg-background p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-xl font-bold">ได้ผลพลอยได้จริงเท่าไร</h2>
          <p className="text-sm text-muted-foreground">
            {ask.name} {n0(ask.grams)} ก. · ใส่ตามที่ชั่งได้ ไม่ได้เก็บใส่ 0
          </p>
        </div>
        <div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
          {ask.items.map((i) => (
            <label key={i.skuId} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block break-words font-semibold">{i.name}</span>
                <span className="block text-xs text-muted-foreground">ตามสูตร {n0(i.expected)} {i.uom}</span>
              </span>
              <input
                inputMode="decimal"
                value={qty[i.skuId]}
                onChange={(e) => setQty((q) => ({ ...q, [i.skuId]: e.target.value }))}
                onFocus={(e) => e.target.select()}
                className="h-12 w-32 rounded-xl border border-input bg-background px-3 text-right font-mono text-base"
                aria-label={`${i.name} ที่ได้จริง`}
              />
              <span className="w-6 text-sm text-muted-foreground">{i.uom}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">เข้าสต๊อกตามที่ใส่ · ต้นทุนยังแบ่งตามสัดส่วนในสูตรเหมือนเดิม · ไม่ต้องลงผลิตผลพลอยได้แยกอีก</p>
        <div className="flex gap-2">
          <Button variant="outline" className="h-12 flex-1" onClick={onCancel}>
            ยกเลิก
          </Button>
          <Button variant="brand" className="h-12 flex-[2] text-base" loading={busy} onClick={() => onSave(parsed)}>
            บันทึกผลิต
          </Button>
        </div>
      </div>
    </div>
  );
}
