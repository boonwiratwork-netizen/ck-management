import { useState, useMemo, useRef, useEffect } from "react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { useBranchReceiptData } from "@/hooks/use-branch-receipt-data";
import { supabase } from "@/integrations/supabase/client";
import { SKU } from "@/types/sku";
import { Price } from "@/types/price";
import { Branch } from "@/types/branch";
import { Supplier } from "@/types/supplier";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Camera,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Loader2,
  X,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Screen = "select" | "method" | "manual" | "scanResult";
type MatchConfidence = "high" | "low" | "none";

interface Props {
  skus: SKU[];
  prices: Price[];
  branches: Branch[];
  suppliers?: Supplier[];
}

interface ManualRow {
  rowId: string;
  skuId: string | null;
  qty: number;
  actualTotal: number;
  rawName?: string;
  matchConfidence?: MatchConfidence;
  isAdHoc?: boolean;
}

interface ScanItem {
  raw_name: string;
  quantity: number;
  unit: string;
}

// ─── Helpers ─────────────────────────────────────────────

const RECENT_SUPPLIERS_KEY = "br-mobile-recent-suppliers";

function getRecentSupplierIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SUPPLIERS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function pushRecentSupplier(id: string) {
  try {
    const cur = getRecentSupplierIds();
    const next = [id, ...cur.filter((x) => x !== id)].slice(0, 5);
    localStorage.setItem(RECENT_SUPPLIERS_KEY, JSON.stringify(next));
  } catch {
    /* noop */
  }
}

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
  const confidence: MatchConfidence = bestScore >= 4 ? "high" : "low";
  return { sku: bestSku, confidence };
}

// ─── Reusable atomic styles ─────────────────────────────

const PAGE_BG = "#f2f2f7";
const INK = "#1a1a1a";
const MUTED = "#8e8e93";
const DIVIDER = "rgba(0,0,0,0.1)";
const FILLED_ROW_BG = "rgba(34,197,94,0.05)";
const FILLED_QTY_BG = "rgba(34,197,94,0.12)";
const QTY_BG = "rgba(0,0,0,0.05)";
const SEARCH_BG = "rgba(0,0,0,0.06)";
const CHIP_BG = "rgba(0,0,0,0.07)";

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
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [addSheetSearch, setAddSheetSearch] = useState("");
  const [scanMeta, setScanMeta] = useState<{ count: number; confidence: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync branchId with profile if SM
  useEffect(() => {
    if (isStoreManager && profile?.branch_id && !branchId) {
      setBranchId(profile.branch_id);
    }
  }, [isStoreManager, profile?.branch_id, branchId]);

  useEffect(() => {
    setRecentIds(getRecentSupplierIds());
  }, []);

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

  const brandRmSkuIds = useMemo(() => {
    return new Set<string>(skus.filter((s) => s.status === "Active").map((s) => s.id));
  }, [skus]);

  const brandSupplierIds = useMemo(() => {
    if (!branchId) return new Set<string>();
    const ids = new Set<string>();
    prices
      .filter((p) => p.isActive && brandRmSkuIds.has(p.skuId))
      .forEach((p) => ids.add(p.supplierId));
    return ids;
  }, [prices, brandRmSkuIds, branchId]);

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

  const recentSuppliers = useMemo(() => {
    const list = recentIds
      .map((id) => suppliers.find((s) => s.id === id))
      .filter((s): s is Supplier => !!s && s.status === "Active");
    return list.slice(0, 3);
  }, [recentIds, suppliers]);

  // SKUs available for the chosen supplier (active price for branch's brand)
  const supplierSkus = useMemo(() => {
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

  // SKU options for the bottom sheet — supplier scoped, fallback to all if empty
  const addSheetSkus = useMemo(() => {
    const base = supplierSkus.length
      ? supplierSkus
      : skus
          .filter((s) => s.status === "Active" && (s.type === "RM" || s.type === "PK"))
          .sort((a, b) => a.skuId.localeCompare(b.skuId));
    const q = addSheetSearch.toLowerCase().trim();
    const usedIds = new Set(rows.map((r) => r.skuId).filter(Boolean) as string[]);
    const filtered = base.filter((s) => {
      if (usedIds.has(s.id)) return false;
      if (!q) return true;
      return (
        s.skuId.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q)
      );
    });
    return filtered;
  }, [supplierSkus, skus, addSheetSearch, rows]);

  const getStdUnitPrice = (skuId: string): number => {
    const fromSupplier = prices.find(
      (p) => p.skuId === skuId && p.supplierId === supplierId && p.isActive,
    );
    if (fromSupplier) return fromSupplier.pricePerUsageUom || 0;
    const any = prices.find((p) => p.skuId === skuId && p.isActive);
    return any?.pricePerUsageUom || 0;
  };

  // ─── Flow transitions ─────────────────────────────────

  const handleSelectSupplier = (id: string) => {
    setSupplierId(id);
    pushRecentSupplier(id);
    setRecentIds(getRecentSupplierIds());
    setScreen("method");
  };

  const handleManualMethod = () => {
    setRows([]); // start EMPTY
    setScreen("manual");
  };

  const handleCameraClick = () => {
    fileInputRef.current?.click();
  };

  const buildScanRows = (scanned: ScanItem[]): ManualRow[] => {
    return scanned.map((item, idx) => {
      const { sku, confidence } = matchSkuFromRawName(item.raw_name, supplierSkus);
      return {
        rowId: `scan-${idx}-${Date.now()}`,
        skuId: sku?.id ?? null,
        qty: item.quantity || 0,
        actualTotal: 0,
        rawName: item.raw_name,
        matchConfidence: sku ? confidence : "none",
        isAdHoc: !sku,
      };
    });
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setScanning(true);
    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("scan-delivery-invoice", {
        body: { imageBase64: base64, mimeType: file.type || "image/jpeg" },
      });
      if (error) throw error;
      const items: ScanItem[] = Array.isArray(data?.items) ? data.items : [];
      const built = buildScanRows(items);
      const highCount = built.filter((r) => r.matchConfidence === "high").length;
      const conf = built.length ? Math.round((highCount / built.length) * 100) : 0;
      setRows(built);
      setScanMeta({ count: built.length, confidence: conf });
      setScreen("scanResult");
      toast.success(`อ่านได้ ${items.length} รายการ`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI scan failed";
      toast.error("ไม่สามารถอ่านใบส่งได้: " + msg);
      setRows([]);
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

  const addSkuToRows = (skuId: string) => {
    setRows((prev) => [
      ...prev,
      {
        rowId: `row-${skuId}-${Date.now()}`,
        skuId,
        qty: 0,
        actualTotal: 0,
      },
    ]);
    setAddSheetOpen(false);
    setAddSheetSearch("");
  };

  const filledRows = useMemo(() => rows.filter((r) => r.qty > 0 && r.skuId), [rows]);
  const filledCount = filledRows.length;

  const resetToStart = () => {
    setSupplierId("");
    setSupplierSearch("");
    setRows([]);
    setScanMeta(null);
    setDate(new Date());
    setScreen("select");
  };

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
        resetToStart();
      }
    } catch (err) {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  // ─── Reusable row renderer (Screens 3 & 4) ─────────────

  const ItemRow = ({
    r,
    showDot,
  }: {
    r: ManualRow;
    showDot?: boolean;
  }) => {
    const sku = r.skuId ? skuMap[r.skuId] : null;
    const filled = r.qty > 0;
    const dotColor =
      r.matchConfidence === "high"
        ? "#34c759"
        : r.matchConfidence === "low" || r.matchConfidence === "none"
          ? "#f59e0b"
          : "transparent";

    return (
      <div
        className="flex items-center gap-2 px-3"
        style={{
          minHeight: 44,
          background: filled ? FILLED_ROW_BG : "transparent",
          borderBottom: `0.5px solid ${DIVIDER}`,
        }}
      >
        {showDot && (
          <span
            className="shrink-0 rounded-full"
            style={{ width: 7, height: 7, background: dotColor }}
          />
        )}

        <div className="min-w-0 flex-1 py-1">
          {sku ? (
            <>
              <div
                className="truncate"
                style={{
                  fontFamily: "DM Mono, monospace",
                  fontSize: 10,
                  color: MUTED,
                  lineHeight: 1.2,
                }}
              >
                {sku.skuId}
              </div>
              <div
                className="truncate"
                style={{
                  fontFamily: "DM Sans, sans-serif",
                  fontSize: 13,
                  color: INK,
                  lineHeight: 1.3,
                }}
              >
                {sku.name}
              </div>
            </>
          ) : (
            <div
              className="truncate italic"
              style={{
                fontFamily: "DM Sans, sans-serif",
                fontSize: 13,
                color: MUTED,
              }}
            >
              {r.rawName ?? "—"}
            </div>
          )}
          {r.matchConfidence === "low" && (
            <div
              style={{
                fontFamily: "DM Sans, sans-serif",
                fontSize: 10,
                color: "#d97706",
                lineHeight: 1.2,
              }}
            >
              ตรวจสอบ
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            defaultValue={r.qty || ""}
            onBlur={(e) => updateRow(r.rowId, { qty: Number(e.target.value) || 0 })}
            placeholder="0"
            className="text-center outline-none"
            style={{
              width: 52,
              height: 36,
              minHeight: 44 - 8,
              borderRadius: 8,
              background: filled ? FILLED_QTY_BG : QTY_BG,
              border: "none",
              fontFamily: "DM Mono, monospace",
              fontSize: 16,
              fontWeight: 700,
              color: INK,
            }}
          />
          <span
            style={{
              fontFamily: "DM Sans, sans-serif",
              fontSize: 9,
              color: MUTED,
              width: 24,
              textAlign: "left",
            }}
          >
            {sku?.purchaseUom ?? ""}
          </span>
          {(r.isAdHoc || screen === "manual") && (
            <button
              type="button"
              onClick={() => removeRow(r.rowId)}
              className="p-1"
              style={{ color: MUTED }}
              aria-label="ลบ"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    );
  };

  // ─── SCREEN 1 — supplier select ───────────────────────

  if (screen === "select") {
    return (
      <div className="min-h-screen" style={{ background: PAGE_BG }}>
        <div className="max-w-sm mx-auto px-4 pt-4 pb-8">
          {/* Title */}
          <h1
            style={{
              fontFamily: "Syne, sans-serif",
              fontWeight: 700,
              fontSize: 26,
              color: INK,
              letterSpacing: "-0.01em",
            }}
          >
            รับของ
          </h1>
          <div
            style={{
              fontFamily: "DM Sans, sans-serif",
              fontSize: 12,
              color: MUTED,
              marginTop: 2,
            }}
          >
            {selectedBranch?.branchName ?? (isManagement ? "เลือกสาขา" : "—")} ·{" "}
            {format(date, "d MMM yyyy")}
          </div>

          {/* Branch + date pickers (inline, minimal) */}
          {(isManagement || !isStoreManager) && (
            <div className="mt-3 space-y-2">
              {isManagement && (
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="w-full outline-none px-3"
                  style={{
                    height: 34,
                    borderRadius: 999,
                    background: SEARCH_BG,
                    border: "none",
                    fontFamily: "DM Sans, sans-serif",
                    fontSize: 13,
                    color: INK,
                  }}
                >
                  <option value="">เลือกสาขา</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.branchName}
                    </option>
                  ))}
                </select>
              )}
              <DatePicker
                value={date}
                onChange={(d) => d && setDate(d)}
                className="h-9 w-full"
              />
            </div>
          )}

          {/* Search */}
          <div className="relative mt-4">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: MUTED }}
            />
            <input
              value={supplierSearch}
              onChange={(e) => setSupplierSearch(e.target.value)}
              placeholder="ค้นหา..."
              disabled={!branchId}
              className="w-full outline-none"
              style={{
                height: 34,
                paddingLeft: 32,
                paddingRight: 12,
                borderRadius: 999,
                background: SEARCH_BG,
                border: "none",
                fontFamily: "DM Sans, sans-serif",
                fontSize: 13,
                color: INK,
              }}
            />
          </div>

          {/* Recent chips */}
          {branchId && recentSuppliers.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
              {recentSuppliers.map((s, i) => {
                const isMostRecent = i === 0;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSelectSupplier(s.id)}
                    className="shrink-0 px-3 truncate"
                    style={{
                      height: 32,
                      borderRadius: 999,
                      background: isMostRecent ? INK : CHIP_BG,
                      color: isMostRecent ? "#fff" : "#3c3c43",
                      fontFamily: "DM Sans, sans-serif",
                      fontSize: 12,
                      fontWeight: 500,
                      maxWidth: 160,
                      border: "none",
                    }}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          )}

          {/* Section header */}
          {branchId && (
            <div
              className="mt-5 mb-1.5 px-1"
              style={{
                fontFamily: "DM Sans, sans-serif",
                fontSize: 11,
                color: MUTED,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                fontWeight: 600,
              }}
            >
              ซัพพลายเออร์
            </div>
          )}

          {/* Supplier list */}
          {!branchId ? (
            <p
              className="py-12 text-center"
              style={{ color: MUTED, fontSize: 13, fontFamily: "DM Sans, sans-serif" }}
            >
              เลือกสาขาก่อน
            </p>
          ) : filteredSuppliers.length === 0 ? (
            <p
              className="py-12 text-center"
              style={{ color: MUTED, fontSize: 13, fontFamily: "DM Sans, sans-serif" }}
            >
              ไม่พบซัพพลายเออร์
            </p>
          ) : (
            <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden" }}>
              {filteredSuppliers.map((s, idx) => {
                const isBrand = brandSupplierIds.has(s.id);
                const isLast = idx === filteredSuppliers.length - 1;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSelectSupplier(s.id)}
                    className="w-full flex items-center justify-between gap-3 px-4 active:bg-black/5 text-left"
                    style={{
                      minHeight: 44,
                      borderBottom: isLast ? "none" : `0.5px solid ${DIVIDER}`,
                      background: "#fff",
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate"
                        style={{
                          fontFamily: "DM Sans, sans-serif",
                          fontSize: 14,
                          fontWeight: 500,
                          color: INK,
                          lineHeight: 1.3,
                        }}
                      >
                        {s.name}
                      </div>
                      {isBrand && (
                        <div
                          style={{
                            fontFamily: "DM Sans, sans-serif",
                            fontSize: 11,
                            color: "#34c759",
                            lineHeight: 1.2,
                          }}
                        >
                          Brand
                        </div>
                      )}
                    </div>
                    <ChevronRight size={16} style={{ color: MUTED }} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── SCREEN 2 — method choice ─────────────────────────

  if (screen === "method") {
    return (
      <div className="min-h-screen" style={{ background: PAGE_BG }}>
        <div className="max-w-sm mx-auto px-4 pt-3 pb-8">
          <button
            type="button"
            onClick={() => {
              setSupplierId("");
              setScreen("select");
            }}
            className="flex items-center gap-1 -ml-1"
            style={{ color: MUTED, fontSize: 13, fontFamily: "DM Sans, sans-serif" }}
          >
            <ChevronLeft size={16} /> กลับ
          </button>
          <h1
            className="mt-2 truncate"
            style={{
              fontFamily: "Syne, sans-serif",
              fontWeight: 700,
              fontSize: 22,
              color: INK,
            }}
          >
            {selectedSupplier?.name}
          </h1>
          <div
            style={{
              fontFamily: "DM Sans, sans-serif",
              fontSize: 12,
              color: MUTED,
              marginTop: 2,
            }}
          >
            {format(date, "d MMM yyyy")}
          </div>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={handleCameraClick}
              disabled={scanning}
              className="w-full flex items-center justify-center gap-3 active:opacity-80 disabled:opacity-60"
              style={{
                height: 64,
                borderRadius: 14,
                background: INK,
                color: "#fff",
                fontFamily: "DM Sans, sans-serif",
                fontSize: 15,
                fontWeight: 500,
                border: "none",
              }}
            >
              {scanning ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Camera size={20} />
              )}
              <span>{scanning ? "AI กำลังอ่านใบส่ง..." : "ถ่ายรูปใบส่ง"}</span>
            </button>

            <button
              type="button"
              onClick={handleManualMethod}
              disabled={scanning}
              className="w-full flex items-center justify-center gap-3 active:bg-black/5 disabled:opacity-60"
              style={{
                height: 64,
                borderRadius: 14,
                background: "#fff",
                color: INK,
                fontFamily: "DM Sans, sans-serif",
                fontSize: 15,
                fontWeight: 500,
                border: `0.5px solid ${DIVIDER}`,
              }}
            >
              <ClipboardList size={20} />
              <span>กรอกเอง</span>
            </button>

            <div
              className="px-4 py-3"
              style={{
                background: "#fff",
                borderRadius: 12,
                fontFamily: "DM Sans, sans-serif",
                fontSize: 12,
                color: MUTED,
                lineHeight: 1.5,
              }}
            >
              เคล็ดลับ: ถ่ายรูปใบส่งให้ชัดและตรง AI จะอ่านรายการให้อัตโนมัติ
              คุณยังตรวจสอบและแก้ไขได้ก่อนบันทึก
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileSelected}
            />
          </div>
        </div>
      </div>
    );
  }

  // ─── SCREEN 3 — manual entry (and shared with edit-from-scan) ──

  if (screen === "manual") {
    return (
      <div className="min-h-screen" style={{ background: PAGE_BG }}>
        <div className="max-w-sm mx-auto pt-3 pb-32">
          <div className="px-4">
            <button
              type="button"
              onClick={() => setScreen("method")}
              className="flex items-center gap-1 -ml-1"
              style={{ color: MUTED, fontSize: 13, fontFamily: "DM Sans, sans-serif" }}
            >
              <ChevronLeft size={16} /> กลับ
            </button>
            <h1
              className="mt-2 truncate"
              style={{
                fontFamily: "Syne, sans-serif",
                fontWeight: 700,
                fontSize: 20,
                color: INK,
              }}
            >
              {selectedSupplier?.name}
            </h1>
            <div
              style={{
                fontFamily: "DM Sans, sans-serif",
                fontSize: 12,
                color: MUTED,
                marginTop: 2,
              }}
            >
              {rows.length} รายการ · {format(date, "d MMM yyyy")}
            </div>
          </div>

          <div className="mt-4" style={{ background: "#fff" }}>
            {rows.length === 0 ? (
              <div
                className="px-4 py-10 text-center"
                style={{
                  fontFamily: "DM Sans, sans-serif",
                  fontSize: 13,
                  color: MUTED,
                }}
              >
                ยังไม่มีรายการ
                <br />
                แตะ “เพิ่มรายการ” ด้านล่างเพื่อเริ่ม
              </div>
            ) : (
              rows.map((r) => <ItemRow key={r.rowId} r={r} />)
            )}

            {/* Add row */}
            <button
              type="button"
              onClick={() => setAddSheetOpen(true)}
              className="w-full flex items-center gap-3 px-3 active:bg-black/5"
              style={{
                minHeight: 44,
                background: "#fff",
                borderTop: rows.length > 0 ? `0.5px solid ${DIVIDER}` : "none",
              }}
            >
              <span
                className="inline-flex items-center justify-center shrink-0"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  background: "#34c759",
                  color: "#fff",
                }}
              >
                <Plus size={14} strokeWidth={3} />
              </span>
              <span
                style={{
                  fontFamily: "DM Sans, sans-serif",
                  fontSize: 14,
                  color: INK,
                  fontWeight: 500,
                }}
              >
                เพิ่มรายการ
              </span>
            </button>
          </div>
        </div>

        {/* Sticky save bar */}
        <div
          className="fixed bottom-0 left-0 right-0 pb-safe"
          style={{
            background: "rgba(242,242,247,0.97)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            borderTop: `0.5px solid ${DIVIDER}`,
            zIndex: 50,
          }}
        >
          <div className="max-w-sm mx-auto px-4 py-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={filledCount === 0 || saving}
              className="w-full flex items-center justify-center"
              style={{
                height: 46,
                borderRadius: 12,
                background: filledCount === 0 ? "rgba(0,0,0,0.15)" : INK,
                color: "#fff",
                fontFamily: "DM Sans, sans-serif",
                fontSize: 15,
                fontWeight: 600,
                border: "none",
                cursor: filledCount === 0 ? "default" : "pointer",
              }}
            >
              {saving ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                `บันทึก ${filledCount} รายการ`
              )}
            </button>
          </div>
        </div>

        {/* Bottom sheet — add SKU */}
        {addSheetOpen && (
          <>
            <div
              onClick={() => setAddSheetOpen(false)}
              className="fixed inset-0"
              style={{ background: "rgba(0,0,0,0.35)", zIndex: 60 }}
            />
            <div
              className="fixed left-0 right-0 bottom-0 max-w-sm mx-auto pb-safe"
              style={{
                background: "#fff",
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                height: "65vh",
                zIndex: 70,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: `0.5px solid ${DIVIDER}` }}
              >
                <span
                  style={{
                    fontFamily: "DM Sans, sans-serif",
                    fontSize: 15,
                    fontWeight: 600,
                    color: INK,
                  }}
                >
                  เลือก SKU
                </span>
                <button
                  type="button"
                  onClick={() => setAddSheetOpen(false)}
                  style={{ color: MUTED }}
                  aria-label="ปิด"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="px-4 pt-3 pb-2">
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: MUTED }}
                  />
                  <input
                    autoFocus
                    value={addSheetSearch}
                    onChange={(e) => setAddSheetSearch(e.target.value)}
                    placeholder="ค้นหา SKU..."
                    className="w-full outline-none"
                    style={{
                      height: 34,
                      paddingLeft: 32,
                      paddingRight: 12,
                      borderRadius: 999,
                      background: SEARCH_BG,
                      border: "none",
                      fontFamily: "DM Sans, sans-serif",
                      fontSize: 13,
                      color: INK,
                    }}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {addSheetSkus.length === 0 ? (
                  <div
                    className="py-10 text-center"
                    style={{
                      fontFamily: "DM Sans, sans-serif",
                      fontSize: 13,
                      color: MUTED,
                    }}
                  >
                    ไม่พบ SKU
                  </div>
                ) : (
                  addSheetSkus.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => addSkuToRows(s.id)}
                      className="w-full flex items-center gap-2 px-4 active:bg-black/5 text-left"
                      style={{
                        minHeight: 44,
                        borderBottom: `0.5px solid ${DIVIDER}`,
                        background: "#fff",
                      }}
                    >
                      <div className="min-w-0 flex-1 py-1">
                        <div
                          className="truncate"
                          style={{
                            fontFamily: "DM Mono, monospace",
                            fontSize: 10,
                            color: MUTED,
                            lineHeight: 1.2,
                          }}
                        >
                          {s.skuId}
                        </div>
                        <div
                          className="truncate"
                          style={{
                            fontFamily: "DM Sans, sans-serif",
                            fontSize: 13,
                            color: INK,
                            lineHeight: 1.3,
                          }}
                        >
                          {s.name}
                        </div>
                      </div>
                      <span
                        style={{
                          fontFamily: "DM Sans, sans-serif",
                          fontSize: 11,
                          color: MUTED,
                        }}
                      >
                        {s.purchaseUom}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // ─── SCREEN 4 — AI scan result ────────────────────────

  return (
    <div className="min-h-screen" style={{ background: PAGE_BG }}>
      <div className="max-w-sm mx-auto pt-3 pb-40">
        <div className="px-4">
          <button
            type="button"
            onClick={() => setScreen("method")}
            className="flex items-center gap-1 -ml-1"
            style={{ color: MUTED, fontSize: 13, fontFamily: "DM Sans, sans-serif" }}
          >
            <ChevronLeft size={16} /> กลับ
          </button>
          <h1
            className="mt-2 truncate"
            style={{
              fontFamily: "Syne, sans-serif",
              fontWeight: 700,
              fontSize: 20,
              color: INK,
            }}
          >
            {selectedSupplier?.name}
          </h1>
          <div
            style={{
              fontFamily: "DM Sans, sans-serif",
              fontSize: 12,
              color: MUTED,
              marginTop: 2,
            }}
          >
            ผลการอ่านจาก AI · {format(date, "d MMM yyyy")}
          </div>
        </div>

        {/* AI banner */}
        <div
          className="mt-4 px-4 flex items-center"
          style={{
            height: 28,
            background: PAGE_BG,
            borderTop: `0.5px solid ${DIVIDER}`,
            borderBottom: `0.5px solid ${DIVIDER}`,
            fontFamily: "DM Sans, sans-serif",
            fontSize: 12,
            color: MUTED,
          }}
        >
          AI อ่านได้ {scanMeta?.count ?? rows.length} รายการ · มั่นใจ{" "}
          {scanMeta?.confidence ?? 0}%
        </div>

        <div style={{ background: "#fff" }}>
          {rows.length === 0 ? (
            <div
              className="px-4 py-10 text-center"
              style={{
                fontFamily: "DM Sans, sans-serif",
                fontSize: 13,
                color: MUTED,
              }}
            >
              AI ไม่พบรายการ
            </div>
          ) : (
            rows.map((r) => <ItemRow key={r.rowId} r={r} showDot />)
          )}
        </div>
      </div>

      {/* Sticky bottom bar — confirm + edit */}
      <div
        className="fixed bottom-0 left-0 right-0 pb-safe"
        style={{
          background: "rgba(242,242,247,0.97)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          borderTop: `0.5px solid ${DIVIDER}`,
          zIndex: 50,
        }}
      >
        <div className="max-w-sm mx-auto px-4 py-3 space-y-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={filledCount === 0 || saving}
            className="w-full flex items-center justify-center"
            style={{
              height: 46,
              borderRadius: 12,
              background: filledCount === 0 ? "rgba(0,0,0,0.15)" : INK,
              color: "#fff",
              fontFamily: "DM Sans, sans-serif",
              fontSize: 15,
              fontWeight: 600,
              border: "none",
              cursor: filledCount === 0 ? "default" : "pointer",
            }}
          >
            {saving ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              `ยืนยันและรับของ (${filledCount} รายการ)`
            )}
          </button>
          <button
            type="button"
            onClick={() => setScreen("manual")}
            className="w-full active:bg-black/5"
            style={{
              height: 42,
              borderRadius: 12,
              background: "transparent",
              color: INK,
              fontFamily: "DM Sans, sans-serif",
              fontSize: 14,
              fontWeight: 500,
              border: `0.5px solid ${DIVIDER}`,
            }}
          >
            แก้ไขรายการ
          </button>
        </div>
      </div>
    </div>
  );
}
