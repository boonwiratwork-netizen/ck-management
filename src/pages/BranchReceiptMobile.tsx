import { useState, useMemo, useRef, useEffect } from "react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { useBranchReceiptData } from "@/hooks/use-branch-receipt-data";
import { supabase } from "@/integrations/supabase/client";
import { SKU } from "@/types/sku";
import { Price } from "@/types/price";
import { Branch } from "@/types/branch";
import { Supplier } from "@/types/supplier";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  Camera,
  ClipboardList,
  ChevronLeft,
  Plus,
  CheckCircle,
  Search,
  Loader2,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Screen = "select" | "method" | "manual" | "confirm";
type MatchConfidence = "high" | "low" | "none";

interface Props {
  skus: SKU[];
  prices: Price[];
  branches: Branch[];
  suppliers?: Supplier[];
}

interface ManualRow {
  rowId: string; // unique id (skuId for preloaded, ad-hoc-N for manual additions)
  skuId: string | null; // null until user picks one (ad-hoc)
  qty: number;
  actualTotal: number;
  rawName?: string; // from AI scan
  matchConfidence?: MatchConfidence;
  isAdHoc?: boolean;
}

interface ScanItem {
  raw_name: string;
  quantity: number;
  unit: string;
}

// ─── Helpers ─────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const TH_PARTICLES = new Set([
  "และ", "หรือ", "ของ", "ที่", "ใน", "ไป", "มา", "เป็น", "ให้", "กับ", "นี้", "นั้น", "ก็", "จะ", "ได้",
  "the", "and", "or", "of", "a", "an", "for", "with",
]);

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(/[\s,()/\\\-_.]+/)
    .filter((w) => w.length >= 2 && !TH_PARTICLES.has(w));
}

function matchSkuFromRawName(
  rawName: string,
  candidates: SKU[],
): { sku: SKU | null; confidence: MatchConfidence } {
  const rawWords = tokenize(rawName);
  if (rawWords.length === 0) return { sku: null, confidence: "none" };

  let bestSku: SKU | null = null;
  let bestScore = 0;
  for (const sku of candidates) {
    const haystack = `${sku.name} ${sku.skuId}`.toLowerCase();
    let score = 0;
    for (const w of rawWords) {
      if (haystack.includes(w)) score += w.length >= 4 ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestSku = sku;
    }
  }

  if (!bestSku || bestScore === 0) return { sku: null, confidence: "none" };
  // High if at least 2 strong words matched OR a single long word matched twice
  const confidence: MatchConfidence = bestScore >= 4 ? "high" : "low";
  return { sku: bestSku, confidence };
}

// ─── Main Component ─────────────────────────────────────

export default function BranchReceiptMobilePage({ skus, prices, branches, suppliers = [] }: Props) {
  const { profile, isStoreManager, isManagement } = useAuth();
  const { saveReceipts } = useBranchReceiptData();

  const [screen, setScreen] = useState<Screen>("select");
  const [date, setDate] = useState<Date>(new Date());
  const [branchId, setBranchId] = useState<string>(
    isStoreManager && profile?.branch_id ? profile.branch_id : "",
  );
  const [supplierId, setSupplierId] = useState<string>("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [rows, setRows] = useState<ManualRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync branchId with profile if SM
  useEffect(() => {
    if (isStoreManager && profile?.branch_id && !branchId) {
      setBranchId(profile.branch_id);
    }
  }, [isStoreManager, profile?.branch_id, branchId]);

  const skuMap = useMemo(() => {
    const m: Record<string, SKU> = {};
    skus.forEach((s) => (m[s.id] = s));
    return m;
  }, [skus]);

  const selectedBranch = useMemo(
    () => branches.find((b) => b.id === branchId),
    [branches, branchId],
  );
  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === supplierId),
    [suppliers, supplierId],
  );

  // Brand-relevant SKUs (suppliers offering active prices for SKUs of branch's brand)
  const brandRmSkuIds = useMemo(() => {
    // We don't have menus/menuBomLines here — fall back to "any SKU with active price for this supplier".
    // Brand grouping below uses prices.isActive intersection.
    return new Set<string>(skus.filter((s) => s.status === "Active").map((s) => s.id));
  }, [skus]);

  // Suppliers with active prices for any RM/PK SKU — flagged as "Brand supplier"
  const brandSupplierIds = useMemo(() => {
    if (!branchId) return new Set<string>();
    const ids = new Set<string>();
    prices
      .filter((p) => p.isActive && brandRmSkuIds.has(p.skuId))
      .forEach((p) => ids.add(p.supplierId));
    return ids;
  }, [prices, brandRmSkuIds, branchId]);

  // Filtered supplier list for SCREEN 1
  const filteredSuppliers = useMemo(() => {
    const active = suppliers.filter((s) => s.status === "Active");
    const q = supplierSearch.toLowerCase().trim();
    const filtered = q ? active.filter((s) => s.name.toLowerCase().includes(q)) : active;
    return filtered.sort((a, b) => {
      const aBrand = brandSupplierIds.has(a.id) ? 0 : 1;
      const bBrand = brandSupplierIds.has(b.id) ? 0 : 1;
      if (aBrand !== bBrand) return aBrand - bBrand;
      return a.name.localeCompare(b.name);
    });
  }, [suppliers, supplierSearch, brandSupplierIds]);

  // Preloaded SKUs for the chosen supplier (with active price for this branch's brand)
  const preloadedSkus = useMemo(() => {
    if (!supplierId) return [] as SKU[];
    const activePrices = prices.filter(
      (p) => p.supplierId === supplierId && p.isActive && brandRmSkuIds.has(p.skuId),
    );
    const seen = new Set<string>();
    const list: SKU[] = [];
    activePrices.forEach((p) => {
      const sku = skuMap[p.skuId];
      if (!sku || seen.has(sku.id)) return;
      if (sku.type !== "RM" && sku.type !== "PK") return;
      seen.add(sku.id);
      list.push(sku);
    });
    return list.sort((a, b) => a.skuId.localeCompare(b.skuId));
  }, [supplierId, prices, brandRmSkuIds, skuMap]);

  // Std unit price lookup for a given SKU (active price preferred)
  const getStdUnitPrice = (skuId: string): number => {
    // Prefer the active price from the selected supplier; fall back to any active price.
    const fromSupplier = prices.find(
      (p) => p.skuId === skuId && p.supplierId === supplierId && p.isActive,
    );
    if (fromSupplier) return fromSupplier.pricePerUsageUom || 0;
    const any = prices.find((p) => p.skuId === skuId && p.isActive);
    return any?.pricePerUsageUom || 0;
  };

  // ─── Flow transitions ─────────────────────────────────

  const initRowsFromPreloaded = (scanned: ScanItem[] = []) => {
    // Build base rows from supplier's preloaded SKUs
    const base: ManualRow[] = preloadedSkus.map((s) => ({
      rowId: s.id,
      skuId: s.id,
      qty: 0,
      actualTotal: 0,
    }));

    // Overlay AI-scanned items
    scanned.forEach((item, idx) => {
      const { sku, confidence } = matchSkuFromRawName(item.raw_name, preloadedSkus);
      if (sku) {
        const existing = base.find((r) => r.skuId === sku.id);
        if (existing) {
          existing.qty = item.quantity || 0;
          existing.rawName = item.raw_name;
          existing.matchConfidence = confidence;
          return;
        }
      }
      // Unmatched — push as ad-hoc row with rawName
      base.push({
        rowId: `scan-${idx}`,
        skuId: sku?.id ?? null,
        qty: item.quantity || 0,
        actualTotal: 0,
        rawName: item.raw_name,
        matchConfidence: sku ? confidence : "none",
        isAdHoc: !sku,
      });
    });

    setRows(base);
  };

  const handleSelectSupplier = (id: string) => {
    setSupplierId(id);
    setScreen("method");
  };

  const handleManualMethod = () => {
    initRowsFromPreloaded([]);
    setScreen("manual");
  };

  const handleCameraClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so same file can be re-picked
    if (!file) return;
    setScanning(true);
    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("scan-delivery-invoice", {
        body: { imageBase64: base64, mimeType: file.type || "image/jpeg" },
      });
      if (error) throw error;
      const items: ScanItem[] = Array.isArray(data?.items) ? data.items : [];
      initRowsFromPreloaded(items);
      setScreen("manual");
      toast.success(`อ่านได้ ${items.length} รายการ`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI scan failed";
      toast.error("ไม่สามารถอ่านใบส่งได้: " + msg);
      // Still proceed to manual entry with empty pre-fill
      initRowsFromPreloaded([]);
      setScreen("manual");
    } finally {
      setScanning(false);
    }
  };

  const updateRow = (rowId: string, patch: Partial<ManualRow>) => {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  };

  const addAdHocRow = () => {
    setRows((prev) => [
      ...prev,
      {
        rowId: `adhoc-${Date.now()}`,
        skuId: null,
        qty: 0,
        actualTotal: 0,
        isAdHoc: true,
      },
    ]);
  };

  const filledRows = useMemo(() => rows.filter((r) => r.qty > 0 && r.skuId), [rows]);
  const filledCount = filledRows.length;

  // SKU options for ad-hoc row picker (any active SKU, not restricted)
  const adHocSkuOptions = useMemo(
    () =>
      skus
        .filter((s) => s.status === "Active" && (s.type === "RM" || s.type === "PK"))
        .sort((a, b) => a.skuId.localeCompare(b.skuId))
        .map((s) => ({ value: s.id, label: `${s.skuId} — ${s.name}`, sublabel: s.purchaseUom })),
    [skus],
  );

  const handleSave = async () => {
    if (!branchId || !selectedSupplier) {
      toast.error("Missing branch or supplier");
      return;
    }
    if (filledRows.length === 0) {
      toast.error("ไม่มีรายการที่จะบันทึก");
      return;
    }
    setSaving(true);
    try {
      const dateStr = format(date, "yyyy-MM-dd");
      const payload = filledRows.map((r) => {
        const sku = skuMap[r.skuId!];
        const qty = r.qty;
        const actualTotal = r.actualTotal;
        const actualUnitPrice = qty > 0 ? actualTotal / qty : 0;
        const stdUnitPrice = getStdUnitPrice(r.skuId!);
        const stdTotal = qty * stdUnitPrice;
        const priceVariance = actualTotal - stdTotal;
        return {
          branchId,
          receiptDate: dateStr,
          skuId: r.skuId!,
          supplierName: selectedSupplier.name,
          qtyReceived: qty,
          uom: sku?.purchaseUom ?? "",
          actualUnitPrice,
          actualTotal,
          stdUnitPrice,
          stdTotal,
          priceVariance,
          notes: r.rawName ?? "",
          transferOrderId: null,
        };
      });
      const count = await saveReceipts(payload);
      if (count > 0) {
        toast.success(`บันทึกแล้ว ${count} รายการ`);
        // reset state back to SCREEN 1
        setSupplierId("");
        setSupplierSearch("");
        setRows([]);
        setDate(new Date());
        setScreen("select");
      }
    } catch (err) {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  // ─── Renders ──────────────────────────────────────────

  const PageWrap: React.FC<{ children: React.ReactNode; pad?: boolean }> = ({ children, pad = true }) => (
    <div className={cn("max-w-lg mx-auto", pad && "px-4 py-4")}>{children}</div>
  );

  // SCREEN 1 — supplier selection
  if (screen === "select") {
    return (
      <PageWrap>
        <h1 className="font-heading text-3xl font-bold tracking-tight">รับของ</h1>
        {selectedBranch ? (
          <p className="text-sm text-muted-foreground mt-1">{selectedBranch.branchName}</p>
        ) : isManagement ? (
          <p className="text-sm text-muted-foreground mt-1">เลือกสาขา</p>
        ) : null}

        <div className="mt-4 space-y-3">
          {isManagement && (
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="h-12 w-full">
                <SelectValue placeholder="เลือกสาขา" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.branchName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <DatePicker value={date} onChange={(d) => d && setDate(d)} className="h-12 w-full" />

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={supplierSearch}
              onChange={(e) => setSupplierSearch(e.target.value)}
              placeholder="ค้นหาซัพพลายเออร์"
              className="h-12 pl-9"
              disabled={!branchId}
            />
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {!branchId ? (
            <p className="text-sm text-muted-foreground py-8 text-center">เลือกสาขาก่อน</p>
          ) : filteredSuppliers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">ไม่พบซัพพลายเออร์</p>
          ) : (
            filteredSuppliers.map((s) => {
              const isBrand = brandSupplierIds.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleSelectSupplier(s.id)}
                  className="w-full h-14 flex items-center justify-between gap-3 px-4 rounded-xl border bg-card hover:bg-accent active:bg-accent/80 transition-colors text-left"
                >
                  <span className="font-medium truncate">{s.name}</span>
                  {isBrand && (
                    <span className="text-xs text-success font-medium shrink-0">Brand supplier</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </PageWrap>
    );
  }

  // SCREEN 2 — method choice
  if (screen === "method") {
    return (
      <PageWrap>
        <button
          type="button"
          onClick={() => {
            setSupplierId("");
            setScreen("select");
          }}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground -ml-1"
        >
          <ChevronLeft className="h-4 w-4" /> กลับ
        </button>
        <h1 className="font-heading text-2xl font-bold tracking-tight mt-2">{selectedSupplier?.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">{format(date, "d MMM yyyy")}</p>

        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={handleCameraClick}
            disabled={scanning}
            className="w-full h-16 rounded-xl bg-primary text-primary-foreground flex items-center justify-center gap-3 text-base font-medium hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-60"
          >
            {scanning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
            <span>{scanning ? "AI กำลังอ่านใบส่ง..." : "ถ่ายรูปใบส่ง"}</span>
          </button>

          <button
            type="button"
            onClick={handleManualMethod}
            disabled={scanning}
            className="w-full h-16 rounded-xl border border-primary text-primary bg-background flex items-center justify-center gap-3 text-base font-medium hover:bg-accent transition-colors disabled:opacity-60"
          >
            <ClipboardList className="h-5 w-5" />
            <span>กรอกเอง</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileSelected}
          />
        </div>
      </PageWrap>
    );
  }

  // SCREEN 3 — manual form
  if (screen === "manual") {
    return (
      <>
        <PageWrap>
          <button
            type="button"
            onClick={() => setScreen("method")}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground -ml-1"
          >
            <ChevronLeft className="h-4 w-4" /> กลับ
          </button>
          <h1 className="font-heading text-xl font-bold tracking-tight mt-2 truncate">
            {selectedSupplier?.name}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{format(date, "d MMM yyyy")}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {preloadedSkus.length} รายการ จากซัพฯ นี้
          </p>

          <div className="mt-4 space-y-2 pb-32">
            {rows.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-sm">ไม่มีรายการ — กดปุ่มด้านล่างเพื่อเพิ่ม</p>
              </div>
            ) : (
              rows.map((r) => {
                const sku = r.skuId ? skuMap[r.skuId] : null;
                const showWarn = r.matchConfidence === "low" || r.matchConfidence === "none";
                return (
                  <div key={r.rowId} className="bg-card border rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {r.isAdHoc && !r.skuId ? (
                          <SearchableSelect
                            value={r.skuId ?? ""}
                            onValueChange={(v) => updateRow(r.rowId, { skuId: v })}
                            options={adHocSkuOptions}
                            placeholder="เลือก SKU"
                            triggerClassName="h-10 w-full"
                          />
                        ) : (
                          <>
                            <div className="font-mono text-xs text-muted-foreground">
                              {sku?.skuId ?? "—"}
                            </div>
                            <div className="font-medium text-sm truncate">{sku?.name ?? "—"}</div>
                          </>
                        )}
                        {r.rawName && (
                          <div className="text-xs text-muted-foreground italic mt-0.5 truncate">
                            จากใบส่ง: {r.rawName}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {showWarn && (
                          <span className="inline-flex items-center gap-1 text-xs text-warning bg-warning/10 px-2 py-0.5 rounded">
                            <AlertTriangle className="h-3 w-3" /> ตรวจสอบ
                          </span>
                        )}
                        {r.isAdHoc && (
                          <button
                            type="button"
                            onClick={() => removeRow(r.rowId)}
                            className="p-1.5 text-muted-foreground hover:text-destructive"
                            title="ลบ"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-[1fr_auto] gap-2 items-center">
                      <Input
                        type="number"
                        inputMode="decimal"
                        defaultValue={r.qty || ""}
                        onBlur={(e) => updateRow(r.rowId, { qty: Number(e.target.value) || 0 })}
                        placeholder="0"
                        className="h-12 text-xl text-center font-mono"
                      />
                      <span className="text-sm text-muted-foreground px-2">
                        {sku?.purchaseUom ?? "—"}
                      </span>
                    </div>

                    <div className="mt-2 grid grid-cols-[auto_1fr_auto] gap-2 items-center">
                      <span className="text-xs text-muted-foreground">฿</span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        defaultValue={r.actualTotal || ""}
                        onBlur={(e) =>
                          updateRow(r.rowId, { actualTotal: Number(e.target.value) || 0 })
                        }
                        placeholder="0.00"
                        className="h-10 text-sm font-mono text-right"
                      />
                      <span className="text-xs text-muted-foreground">รวม</span>
                    </div>
                  </div>
                );
              })
            )}

            <button
              type="button"
              onClick={addAdHocRow}
              className="w-full border-2 border-dashed border-primary/40 text-primary rounded-xl py-3 text-sm font-medium hover:border-primary/60 hover:bg-accent transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="h-4 w-4" /> เพิ่มรายการ
            </button>
          </div>
        </PageWrap>

        <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 pb-safe z-50">
          <div className="max-w-lg mx-auto">
            <Button
              onClick={() => setScreen("confirm")}
              disabled={filledCount === 0}
              className="w-full h-14 text-base"
            >
              ตรวจสอบและบันทึก ({filledCount} รายการ)
            </Button>
          </div>
        </div>
      </>
    );
  }

  // SCREEN 4 — confirm
  const totalValue = filledRows.reduce((sum, r) => sum + (r.actualTotal || 0), 0);

  return (
    <PageWrap>
      <h1 className="font-heading text-2xl font-bold tracking-tight">ตรวจสอบก่อนบันทึก</h1>
      <p className="text-sm text-muted-foreground mt-1">
        {selectedSupplier?.name} · {format(date, "d MMM yyyy")}
      </p>

      <div className="mt-4 space-y-2">
        {filledRows.map((r) => {
          const sku = r.skuId ? skuMap[r.skuId] : null;
          return (
            <div
              key={r.rowId}
              className="bg-card border rounded-xl p-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-muted-foreground">{sku?.skuId ?? "—"}</div>
                <div className="font-medium text-sm truncate">{sku?.name ?? "—"}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono text-sm">
                  {r.qty.toLocaleString()} {sku?.purchaseUom ?? ""}
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  ฿{r.actualTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 bg-accent rounded-xl p-3 flex items-center justify-between">
        <span className="text-sm font-medium">รวมทั้งหมด</span>
        <span className="font-mono text-lg font-semibold">
          ฿{totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={() => setScreen("manual")} className="h-14">
          แก้ไข
        </Button>
        <Button onClick={handleSave} disabled={saving} className="h-14">
          {saving ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <CheckCircle className="h-4 w-4" /> บันทึกการรับของ
            </>
          )}
        </Button>
      </div>
    </PageWrap>
  );
}
