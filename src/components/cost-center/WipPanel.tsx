import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/SearchableSelect";
import { setWipInputs, type WipInput } from "@/lib/wip";

/**
 * A WIP's set-up in Cost Center: what may go into it (a list, no amounts: the branch
 * weighs what it puts in each time). Its cost comes from those batches, not from here.
 */
export function WipPanel({ sku, skus, prices, inputs, canEdit, onChanged, onActivate }: { sku: SKU; skus: SKU[]; prices: Price[]; inputs: WipInput[]; canEdit: boolean; onChanged: () => void; /** A draft goes live once what may go in is chosen */ onActivate?: () => Promise<boolean> }) {
  const own = useMemo(() => inputs.filter((i) => i.wipSkuId === sku.id).map((i) => i.skuId), [inputs, sku.id]);
  const [list, setList] = useState<string[]>(own);
  const [saving, setSaving] = useState(false);
  useEffect(() => setList(own), [own]);
  const byId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const priceOf = (id: string) => prices.find((p) => p.skuId === id && p.isActive)?.pricePerUsageUom ?? 0;
  // What can go in: items the branch keeps (RM / SM), active, not already on the list
  const options = skus
    .filter((s) => (s.type === "SM" || s.type === "RM") && s.status === "Active" && !list.includes(s.id))
    .map((s) => ({ value: s.id, label: s.name, sublabel: s.skuId }));
  const dirty = list.length !== own.length || list.some((id) => !own.includes(id));
  const cost = priceOf(sku.id);

  const save = async () => {
    setSaving(true);
    const err = await setWipInputs(sku.id, list, inputs);
    setSaving(false);
    if (err) {
      toast.error("บันทึกไม่ได้: " + err);
      return;
    }
    // A draft WIP goes live once something may go in (it shows on the count sheets from then on)
    if (sku.status === "Draft" && list.length && onActivate) await onActivate();
    toast.success(sku.status === "Draft" && list.length ? "บันทึกแล้ว · เปิดใช้แล้ว" : "บันทึกของที่ใส่ได้แล้ว");
    onChanged();
  };

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-[15px] font-semibold">ของที่ใส่ได้</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">ไม่ใช่สูตร ไม่มีสัดส่วน · หน้าร้านชั่งของที่ใส่จริงทุกครั้งที่ทำ</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {list.map((id) => (
            <li key={id} className="inline-flex items-center gap-1 rounded-full border border-border bg-background py-1 pl-3 pr-1 text-sm">
              {byId.get(id)?.name ?? id}
              <span className="text-xs text-muted-foreground">{byId.get(id)?.skuId}</span>
              {canEdit && (
                <button type="button" aria-label={`เอา ${byId.get(id)?.name ?? ""} ออก`} onClick={() => setList((l) => l.filter((x) => x !== id))} className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-secondary">
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
          {!list.length && <li className="text-sm text-muted-foreground">ยังไม่ได้เลือก · หน้าร้านบันทึกการทำไม่ได้จนกว่าจะเลือก</li>}
        </ul>
        {canEdit && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="min-w-[240px] flex-1">
              <SearchableSelect value="" onValueChange={(v) => v && setList((l) => (l.includes(v) ? l : [...l, v]))} options={options} placeholder="+ เพิ่มของที่ใส่ได้" />
            </div>
            <Button variant="brand" className="h-11" disabled={!dirty || saving} loading={saving} onClick={save}>
              บันทึก
            </Button>
          </div>
        )}
      </section>
      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-[15px] font-semibold">ต้นทุน</h3>
        <p className="mt-1 font-mono text-lg font-semibold">{cost > 0 ? `฿${cost.toLocaleString("th-TH", { maximumFractionDigits: 4 })}/${sku.usageUom || "ก."}` : "—"}</p>
        <p className="text-sm text-muted-foreground">
          {cost > 0 ? "เฉลี่ยจากรอบที่หน้าร้านทำใน 30 วัน · ของที่ใส่คิดตามน้ำหนักที่ราคาของแต่ละอย่าง" : "ยังไม่เคยทำ · ต้นทุนเป็น ฿0 จนกว่าหน้าร้านบันทึกการทำรอบแรก"}
        </p>
      </section>
    </div>
  );
}
