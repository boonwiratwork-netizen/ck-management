import { useMemo, useRef, useState } from "react";
import { Camera, Images, Loader2, Plus, Search, ClipboardList } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Supplier } from "@/types/supplier";
import type { PRGroup } from "@/hooks/use-receive-data";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { isPacksMode, packsFromQty, qtyFromPacks, stdUnitPriceFor, supplierRow, type ReceiptRow } from "@/lib/receive-rows";
import { fileToBase64, matchSkuFromRawName, type MatchConfidence, type ScanItem } from "@/lib/receive-scan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionFooter, NoteField, PackStepper, RemoveButton, SkuPicker, WeightField, baht, packHint } from "./parts";
import { cn } from "@/lib/utils";

interface Line {
  key: string;
  skuId: string | null;
  /** Stored qty (usage units) */
  qty: number;
  /** Price per pack from the invoice, 0 = not entered (priced at standard) */
  invoicePrice: number;
  note: string;
  rawName?: string;
  confidence?: MatchConfidence;
}

interface Props {
  supplier: Supplier;
  branchId: string;
  receiptDate: string;
  /** Active RM/PK this supplier sells for the branch's brand (old pages' list) */
  supplierSkus: SKU[];
  /** Every active RM/PK, for "add another product" */
  allSkus: SKU[];
  skuMap: Map<string, SKU>;
  prices: Price[];
  prGroup?: PRGroup;
  onSave: (rows: ReceiptRow[], prIds: string[]) => Promise<boolean>;
}

const VARIANCE_TOL = 0.005; // ignore rounding below 0.5%

/** Qty from packs read off a delivery note — not rounded, like the old phone page */
const scanQty = (sku: SKU, packs: number) => (isPacksMode(sku) ? packs * (sku.packSize || 1) : packs);

/**
 * Receiving from an outside supplier. Starts with the supplier's products (filled
 * from due purchase requests when there are some); a delivery-note photo fills
 * quantities and prices through the AI scan, same as the old phone page.
 */
export function ReceiveSupplier({ supplier, branchId, receiptDate, supplierSkus, allSkus, skuMap, prices, prGroup, onSave }: Props) {
  const [lines, setLines] = useState<Line[]>(() => {
    const fromPr = new Map((prGroup?.lines ?? []).map((l) => [l.skuId, l.suggestedQty]));
    const listed = supplierSkus.map((s) => ({ key: s.id, skuId: s.id, qty: fromPr.get(s.id) ?? 0, invoicePrice: 0, note: "" }));
    // PR lines for products outside the supplier's price list still show
    const extra = [...fromPr.entries()].filter(([id]) => !supplierSkus.some((s) => s.id === id)).map(([id, qty]) => ({ key: id, skuId: id, qty, invoicePrice: 0, note: "" }));
    return [...extra, ...listed];
  });
  const [query, setQuery] = useState("");
  const [picker, setPicker] = useState<{ open: boolean; assignKey?: string; q?: string }>({ open: false });
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [priceEdit, setPriceEdit] = useState<string | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const std = (skuId: string) => stdUnitPriceFor(prices, skuId, supplier.id);
  const patch = (key: string, p: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const rowFor = (l: Line): ReceiptRow | null => {
    const sku = l.skuId ? skuMap.get(l.skuId) : undefined;
    if (!sku || l.qty <= 0) return null;
    return supplierRow({ branchId, receiptDate, supplierName: supplier.name, sku, qty: l.qty, stdUnitPrice: std(sku.id), invoicePrice: l.invoicePrice, note: l.note || l.rawName || "" });
  };
  const rows = lines.map(rowFor).filter((r): r is ReceiptRow => !!r);
  const unmatched = lines.filter((l) => !l.skuId);
  const total = rows.reduce((s, r) => s + r.actualTotal, 0);
  const over = rows.reduce((s, r) => s + Math.max(0, r.priceVariance), 0);

  // Filled lines first, then the rest; search narrows the list
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const match = (l: Line) => {
      if (!words.length) return true;
      const s = l.skuId ? skuMap.get(l.skuId) : undefined;
      return words.every((w) => `${s?.name ?? l.rawName ?? ""} ${s?.skuId ?? ""}`.toLowerCase().includes(w));
    };
    return [...lines.filter((l) => !l.skuId), ...lines.filter((l) => l.skuId && l.qty > 0 && match(l)), ...lines.filter((l) => l.skuId && l.qty <= 0 && match(l))];
  }, [lines, query, skuMap]);

  // ── Delivery-note photo → lines (same steps as the old phone page) ──
  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setScanning(true);
    try {
      const imageBase64 = await fileToBase64(file);
      const skuCatalog = supplierSkus.map((s) => ({ skuId: s.id, name: s.name }));
      const { data, error } = await supabase.functions.invoke("scan-delivery-invoice", { body: { imageBase64, mimeType: file.type || "image/jpeg", skuCatalog } });
      if (error) throw error;
      const items: ScanItem[] = Array.isArray(data?.items) ? data.items : [];
      const ai = new Map<string, { sku_id: string; confidence: MatchConfidence }>();
      for (const m of Array.isArray(data?.matches) ? data.matches : []) ai.set(m.raw_name, { sku_id: m.sku_id, confidence: m.confidence });

      setLines((prev) => {
        const next = [...prev];
        items.forEach((item, i) => {
          const packs = Math.max(0, Number(item.quantity) || 0);
          const price = Math.max(0, Number(item.unit_price) || 0);
          let sku: SKU | null = null;
          let confidence: MatchConfidence = "none";
          const m = ai.get(item.raw_name);
          if (m?.sku_id && supplierSkus.some((s) => s.id === m.sku_id)) {
            sku = skuMap.get(m.sku_id) ?? null;
            confidence = m.confidence;
          }
          if (!sku) ({ sku, confidence } = matchSkuFromRawName(item.raw_name, item.code ?? "", supplierSkus));
          if (sku) {
            const idx = next.findIndex((l) => l.skuId === sku!.id);
            const addQty = scanQty(sku, packs);
            const cur = idx >= 0 ? next[idx] : null;
            const merged: Line = {
              key: cur?.key ?? sku.id,
              skuId: sku.id,
              // A product listed twice on the note adds up; a PR prefill is replaced by what arrived
              qty: cur && cur.rawName ? cur.qty + addQty : addQty,
              invoicePrice: cur?.invoicePrice || price,
              note: cur?.note ?? "",
              rawName: cur?.rawName ? `${cur.rawName} + ${item.raw_name}` : item.raw_name,
              confidence: cur?.confidence === "high" ? "high" : confidence,
            };
            if (idx >= 0) next[idx] = merged;
            else next.unshift(merged);
          } else {
            next.unshift({ key: `scan-${Date.now()}-${i}`, skuId: null, qty: packs, invoicePrice: price, note: "", rawName: item.raw_name, confidence: "none" });
          }
        });
        return next;
      });
      toast.success(`อ่านใบส่งได้ ${items.length} รายการ`);
    } catch (err) {
      toast.error("อ่านใบส่งไม่สำเร็จ กรอกเองได้เลย: " + (err instanceof Error ? err.message : ""));
    } finally {
      setScanning(false);
    }
  };

  const pick = (sku: SKU) => {
    if (picker.assignKey) {
      // An AI line the matcher couldn't place: its number was packs as written on the note
      setLines((prev) => {
        const target = prev.find((l) => l.key === picker.assignKey)!;
        const rest = prev.filter((l) => l.key !== picker.assignKey && l.skuId !== sku.id);
        const existing = prev.find((l) => l.skuId === sku.id);
        return [{ ...target, key: sku.id, skuId: sku.id, qty: scanQty(sku, target.qty > 0 ? target.qty : 1) + (existing?.qty ?? 0), confidence: "high" }, ...rest];
      });
    } else if (!lines.some((l) => l.skuId === sku.id)) {
      setLines((prev) => [{ key: sku.id, skuId: sku.id, qty: qtyFromPacks(sku, 1), invoicePrice: 0, note: "" }, ...prev]);
    }
    setPicker({ open: false });
  };

  const save = async () => {
    if (unmatched.length) {
      toast.error(`ยังมี ${unmatched.length} รายการที่ AI อ่านได้แต่ยังไม่ได้เลือกสินค้า — เลือกหรือลบก่อน`);
      return;
    }
    if (!rows.length) return;
    setSaving(true);
    await onSave(rows, prGroup?.prIds ?? []);
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-sm text-muted-foreground">ซัพพลายเออร์</div>
        <h2 className="text-xl font-bold">{supplier.name}</h2>
      </div>

      <div className="grid grid-cols-[2fr_1fr] gap-2">
        <Button className="h-12 text-[15px]" onClick={() => camRef.current?.click()} disabled={scanning}>
          {scanning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />} {scanning ? "AI กำลังอ่าน…" : "ถ่ายรูปใบส่ง"}
        </Button>
        <Button variant="outline" className="h-12" onClick={() => galleryRef.current?.click()} disabled={scanning}>
          <Images className="h-5 w-5" /> เลือกรูป
        </Button>
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
        <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} />
      </div>
      {prGroup && (
        <div className="flex items-center gap-2 rounded-xl bg-brand-soft px-3 py-2.5 text-sm text-brand-soft-foreground">
          <ClipboardList className="h-4 w-4 shrink-0" />
          เติมจากใบขอซื้อ {prGroup.prNumbers.join(", ")} แล้ว — แก้ให้ตรงกับของที่มาจริง
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`ค้นสินค้าของ ${supplier.name}…`} className="h-11 pl-9" aria-label="ค้นสินค้า" />
      </div>

      <ul className="flex flex-col gap-2">
        {shown.map((l) => {
          if (!l.skuId)
            return (
              <li key={l.key} className="flex items-center gap-2 rounded-2xl border border-dashed border-warning bg-card p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-warning">AI อ่านได้แต่ยังไม่รู้ว่าเป็นสินค้าไหน</div>
                  <div className="truncate text-[15px] font-semibold">"{l.rawName}" × {l.qty}</div>
                </div>
                <Button variant="outline" className="h-11 border-foreground font-semibold" onClick={() => setPicker({ open: true, assignKey: l.key, q: "" })}>
                  เลือกสินค้า
                </Button>
                <RemoveButton label="ลบรายการนี้" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))} />
              </li>
            );
          const sku = skuMap.get(l.skuId);
          const row = rowFor(l);
          const variance = row && row.stdTotal > 0 ? row.priceVariance / row.stdTotal : 0;
          const pricey = row && variance > VARIANCE_TOL;
          const filled = l.qty > 0;
          return (
            <li key={l.key} className={cn("flex flex-col gap-2 rounded-2xl border bg-card p-3 shadow-card", pricey ? "border-warning/50" : "border-border", !filled && "shadow-none")}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className={cn("truncate text-[15px]", filled ? "font-semibold" : "text-muted-foreground")}>{sku?.name}</div>
                  <div className="truncate text-sm text-muted-foreground">
                    {packHint(sku) || sku?.purchaseUom || sku?.usageUom}
                    {l.confidence && l.confidence !== "none" && ` · AI ${l.confidence === "high" ? "มั่นใจสูง" : "ไม่แน่ใจ ช่วยเช็ค"}`}
                  </div>
                </div>
                <PackStepper label={`จำนวน ${sku?.name ?? ""}`} value={packsFromQty(sku, l.qty)} onChange={(v) => patch(l.key, { qty: qtyFromPacks(sku, v) })} />
              </div>
              {filled && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {priceEdit === l.key ? (
                    <Input
                      autoFocus
                      inputMode="decimal"
                      defaultValue={l.invoicePrice || ""}
                      placeholder="ราคาในบิล"
                      aria-label={`ราคาต่อ${isPacksMode(sku) ? sku?.packUnit : "หน่วย"}`}
                      className="h-10 w-32 text-right font-mono"
                      onBlur={(e) => {
                        patch(l.key, { invoicePrice: Math.max(0, Number(e.target.value) || 0) });
                        setPriceEdit(null);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPriceEdit(l.key)}
                      className={cn("min-h-[36px] rounded-full border px-3 font-mono", pricey ? "border-warning/50 bg-warning-soft text-warning" : "border-border")}
                    >
                      {l.invoicePrice > 0 ? baht(l.invoicePrice, 2) : "ใส่ราคา"} / {isPacksMode(sku) ? sku?.packUnit : `${(sku?.packSize ?? 1) > 1 ? `${sku?.packSize} ` : ""}${sku?.purchaseUom || "หน่วย"}`}
                    </button>
                  )}
                  {pricey && <span className="text-warning">แพงกว่าปกติ +{baht(row!.priceVariance)}</span>}
                  {l.invoicePrice <= 0 && <span className="text-muted-foreground">คิดราคามาตรฐาน</span>}
                  <span className="ml-auto font-mono font-semibold tabular-nums">{row ? baht(row.actualTotal) : "—"}</span>
                </div>
              )}
              {filled && (
                <div className="flex flex-wrap items-center gap-x-4">
                  <WeightField sku={sku} qty={l.qty} onChange={(qty) => patch(l.key, { qty })} />
                  <div className="min-w-0 flex-1"><NoteField value={l.note} onChange={(note) => patch(l.key, { note })} /></div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Button variant="outline" className="h-12 border-dashed" onClick={() => setPicker({ open: true })}>
        <Plus className="h-4 w-4" /> เพิ่มสินค้าอื่น
      </Button>

      <SkuPicker
        open={picker.open}
        title={picker.assignKey ? "AI อ่านได้ — เป็นสินค้าตัวไหน?" : "เพิ่มสินค้า"}
        skus={picker.assignKey ? supplierSkus.length ? supplierSkus : allSkus : allSkus.filter((s) => !lines.some((l) => l.skuId === s.id))}
        initialQuery={picker.q ?? ""}
        onPick={pick}
        onClose={() => setPicker({ open: false })}
      />

      <ActionFooter
        title={
          <>
            {rows.length} รายการ · <span className="font-mono text-highlight">{baht(total)}</span>
          </>
        }
        sub={[unmatched.length ? `รอเลือกสินค้า ${unmatched.length}` : "", over > 0 ? `แพงกว่าปกติ ${baht(over)}` : ""].filter(Boolean).join(" · ") || "ราคาที่ไม่ได้ใส่ คิดตามราคามาตรฐาน"}
        action="บันทึก"
        busy={saving}
        disabled={rows.length === 0}
        onAction={save}
      />
    </div>
  );
}
