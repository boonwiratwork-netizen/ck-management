import { useState } from "react";
import { GripVertical, Printer } from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SKU } from "@/types/sku";
import type { DailyStockCountRow } from "@/hooks/use-daily-stock-count";
import { zoneLabel, zoneOf } from "@/lib/stock-count";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Drag products into the order the shop walks (the old จัดลำดับแถว, saved per person and branch) */
export function CountArrange({ skus, initial, saving, onSave, onCancel, onReset, hasCustom }: { skus: SKU[]; initial: string[]; saving: boolean; onSave: (order: string[]) => void; onCancel: () => void; onReset: () => void; hasCustom: boolean }) {
  const [order, setOrder] = useState(initial);
  const byId = new Map(skus.map((s) => [s.id, s]));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (e.over && e.active.id !== e.over.id) setOrder((p) => arrayMove(p, p.indexOf(e.active.id as string), p.indexOf(e.over!.id as string)));
  };
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-bold">จัดลำดับการนับ</h2>
        <p className="text-sm text-muted-foreground">ลากรายการให้ตรงกับทางเดินในร้าน ลำดับนี้ใช้กับบัญชีนี้ที่สาขานี้ทุกวัน</p>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {order.map((id) => {
              const s = byId.get(id);
              return s ? <ArrangeRow key={id} sku={s} /> : null;
            })}
          </ul>
        </SortableContext>
      </DndContext>
      <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 flex flex-wrap gap-2 rounded-2xl bg-primary p-3 md:bottom-4">
        <Button variant="brand" className="h-11 flex-1" loading={saving} onClick={() => onSave(order)}>
          บันทึกลำดับ
        </Button>
        <Button variant="ghost" className="h-11 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground" onClick={onCancel}>
          ยกเลิก
        </Button>
        {hasCustom && (
          <Button variant="ghost" className="h-11 text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground" onClick={onReset}>
            กลับไปเรียงตามโซน
          </Button>
        )}
      </div>
    </div>
  );
}

function ArrangeRow({ sku }: { sku: SKU }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sku.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("flex min-h-[52px] items-center gap-3 bg-card px-3", isDragging && "relative z-10 shadow-raised")}>
      <button type="button" aria-label={`ลาก ${sku.name}`} className="flex h-11 w-11 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground" {...attributes} {...listeners}>
        <GripVertical className="h-5 w-5" />
      </button>
      <span className="min-w-0 flex-1 break-words py-2 text-[15px] leading-snug">{sku.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{zoneLabel(zoneOf(sku))}</span>
    </li>
  );
}

/** The paper count sheet (the old พิมพ์ใบนับ: today or month-end) */
export function CountPrint({ open, onClose, branchName, date, rows, skuMap }: { open: boolean; onClose: () => void; branchName: string; date: string; rows: DailyStockCountRow[]; skuMap: Map<string, SKU> }) {
  const [scope, setScope] = useState<"today" | "month">("today");
  const pack = (s: SKU) => (s.packSize && s.packUnit ? `${s.packSize.toLocaleString()} ${s.usageUom}/${s.packUnit}` : "—");
  const cell = { border: "1px solid #ccc", padding: "4px" };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl print:max-w-full print:shadow-none" style={{ overflow: "visible" }}>
        <DialogHeader className="no-print">
          <DialogTitle>พิมพ์ใบนับสต๊อก</DialogTitle>
        </DialogHeader>
        <div className="no-print grid grid-cols-2 gap-3">
          {(["today", "month"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setScope(k)} className={cn("rounded-xl border-2 p-4 text-left", scope === k ? "border-primary bg-primary/5" : "border-border")}>
              <div className="text-sm font-semibold">{k === "today" ? "ประจำวัน" : "สิ้นเดือน"}</div>
              <div className="mt-1 text-xs text-muted-foreground">{rows.length} รายการ</div>
            </button>
          ))}
        </div>
        <div className="only-print" style={{ paddingTop: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
            <span>{branchName}</span>
            <span>{`${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`}</span>
          </div>
          <div style={{ fontWeight: 600 }}>{scope === "today" ? "ใบนับสต๊อกประจำวัน" : "ใบนับสต๊อกสิ้นเดือน"}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", marginTop: "8px" }}>
            <thead style={{ display: "table-header-group" }}>
              <tr style={{ background: "#eee" }}>
                {["โซน", "รหัส", "ชื่อ", "ขนาดแพ็ค", "หน่วย", "คงเหลือ", "ของเสีย", "นับได้"].map((h) => (
                  <th key={h} style={{ ...cell, textAlign: "left" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = skuMap.get(r.skuId);
                if (!s) return null;
                return (
                  <tr key={r.id}>
                    <td style={cell}>{zoneLabel(zoneOf(s))}</td>
                    <td style={{ ...cell, fontFamily: "monospace" }}>{s.skuId}</td>
                    <td style={cell}>{s.name}</td>
                    <td style={cell}>{pack(s)}</td>
                    <td style={cell}>{s.usageUom}</td>
                    <td style={{ ...cell, textAlign: "right" }}>{Math.round(r.calculatedBalance)}</td>
                    <td style={cell} />
                    <td style={cell} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Button className="no-print mt-2 w-full" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> พิมพ์
        </Button>
        <style>{`@media print { .no-print { display: none !important; } [data-radix-dialog-overlay] { display: none !important; } } @media screen { .only-print { display: none; } }`}</style>
      </DialogContent>
    </Dialog>
  );
}
