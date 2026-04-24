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
import { Camera, ClipboardList, ChevronLeft, ChevronRight, Plus, Search, Loader2, X } from "lucide-react";
import { toast } from "sonner";

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
  /** Quantity in PACKS when isPacksMode, else in usage UOM (grams) */
  packs: number;
  /** Always in usage UOM (grams). Derived from packs * packSize when in packs mode. */
  qty: number;
  actualTotal: number;
  rawName?: string;
  matchConfidence?: MatchConfidence;
  isAdHoc?: boolean;
}

interface ScanItem {
  code: string;
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
  "และ",
  "หรือ",
  "ของ",
  "ที่",
  "ใน",
  "ไป",
  "มา",
  "เป็น",
  "ให้",
  "กับ",
  "นี้",
  "นั้น",
  "ก็",
  "จะ",
  "ได้",
  "คัด",
  "ขนาด",
  "เบอร์",
  "พิเศษ",
  "ธรรมดา",
  "ใหญ่",
  "เล็ก",
  "กลาง",
  "the",
  "and",
  "or",
  "of",
  "a",
  "an",
  "for",
  "with",
  "size",
  "pack",
]);

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(/[\s,()/\\\-_.]+/)
    .filter((w) => w.length >= 2 && !TH_PARTICLES.has(w));
}

function stripSizeDescriptors(s: string): string {
  return s
    .replace(/\d+(\.\d+)?\s*(กรัม|กิโล|กิโลกรัม|ลิตร|มล|ml|g|kg|l)\s*(\/\s*\w+)?/gi, "")
    .replace(/\d+(\.\d+)?\s*(แพ็ค|ชิ้น|ขวด|กระปุก|ลัง|ถุง)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchSkuFromRawName(
  rawName: string,
  code: string,
  candidates: SKU[],
): { sku: SKU | null; confidence: MatchConfidence } {
  const cleanedName = stripSizeDescriptors(rawName);
  const rawWords = tokenize(cleanedName);
  if (rawWords.length === 0) return { sku: null, confidence: "none" };

  let bestSku: SKU | null = null;
  let bestScore = 0;
  let bestStrongMatches = 0;

  for (const sku of candidates) {
    const haystack = `${sku.name} ${sku.skuId}`.toLowerCase();
    let score = 0;
    let strongMatches = 0;
    for (const w of rawWords) {
      if (haystack.includes(w)) {
        if (w.length >= 5) {
          score += 4;
          strongMatches += 1;
        } else if (w.length >= 3) {
          score += 2;
          strongMatches += 1;
        } else {
          score += 1;
        }
      }
    }
    if (sku.name.toLowerCase().includes(cleanedName.toLowerCase()) && cleanedName.length > 3) score += 6;
    if (score > bestScore) {
      bestScore = score;
      bestStrongMatches = strongMatches;
      bestSku = sku;
    }
  }

  if (!bestSku || bestScore === 0 || bestStrongMatches === 0) {
    return { sku: null, confidence: "none" };
  }
  const confidence: MatchConfidence =
    bestScore >= 8 && bestStrongMatches >= 2 ? "high" : bestScore >= 4 && bestStrongMatches >= 1 ? "low" : "none";
  return { sku: bestSku, confidence };
}

// ─── Visual constants ───────────────────────────────────

const PAGE_BG = "#f2f2f7";
const INK = "#1a1a1a";
const MUTED = "#8e8e93";
const DIVIDER = "rgba(0,0,0,0.1)";
const FILLED_ROW_BG = "rgba(34,197,94,0.05)";
const FILLED_QTY_BG = "rgba(34,197,94,0.12)";
const QTY_BG = "rgba(0,0,0,0.05)";
const SEARCH_BG = "rgba(0,0,0,0.06)";
const CHIP_BG = "rgba(0,0,0,0.07)";
const DELETE_RED = "#dc2626";
const SWIPE_REVEAL = 80; // px width of red delete drawer

// ─── Main Component ─────────────────────────────────────

export default function BranchReceiptMobilePage({ skus, prices, branches, suppliers = [] }: Props) {
  const { profile, isStoreManager, isManagement } = useAuth();
  const { saveReceipts } = useBranchReceiptData();

  const [screen, setScreen] = useState<Screen>("select");
  const [date, setDate] = useState<Date>(new Date());
  const [branchId, setBranchId] = useState<string>(isStoreManager && profile?.branch_id ? profile.branch_id : "");
  const [supplierId, setSupplierId] = useState<string>("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [rows, setRows] = useState<ManualRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [addSheetSearch, setAddSheetSearch] = useState("");
  const [scanMeta, setScanMeta] = useState<{ count: number; confidence: number } | null>(null);
  const [swipedRowId, setSwipedRowId] = useState<string | null>(null);
  // When set, the bottom sheet is in "assign mode" — picking an SKU re-targets this row
  const [assigningRowId, setAssigningRowId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const selectedBranch = useMemo(() => branches.find((b) => b.id === branchId), [branches, branchId]);
  const selectedSupplier = useMemo(() => suppliers.find((s) => s.id === supplierId), [suppliers, supplierId]);

  const brandRmSkuIds = useMemo(() => {
    return new Set<string>(skus.filter((s) => s.status === "Active").map((s) => s.id));
  }, [skus]);

  const brandSupplierIds = useMemo(() => {
    if (!branchId) return new Set<string>();
    const ids = new Set<string>();
    prices.filter((p) => p.isActive && brandRmSkuIds.has(p.skuId)).forEach((p) => ids.add(p.supplierId));
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

  const supplierSkus = useMemo(() => {
    if (!supplierId) return [] as SKU[];
    const activePrices = prices.filter((p) => p.supplierId === supplierId && p.isActive && brandRmSkuIds.has(p.skuId));
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

  const addSheetSkus = useMemo(() => {
    const base = supplierSkus.length
      ? supplierSkus
      : skus
          .filter((s) => s.status === "Active" && (s.type === "RM" || s.type === "PK"))
          .sort((a, b) => a.skuId.localeCompare(b.skuId));
    const q = addSheetSearch.toLowerCase().trim();
    // In "add" mode, exclude SKUs already in rows. In "assign" mode, allow any.
    const usedIds = assigningRowId ? new Set<string>() : new Set(rows.map((r) => r.skuId).filter(Boolean) as string[]);
    return base.filter((s) => {
      if (usedIds.has(s.id)) return false;
      if (!q) return true;
      return s.skuId.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
    });
  }, [supplierSkus, skus, addSheetSearch, rows, assigningRowId]);

  const getStdUnitPrice = (skuId: string): number => {
    const fromSupplier = prices.find((p) => p.skuId === skuId && p.supplierId === supplierId && p.isActive);
    if (fromSupplier) return fromSupplier.pricePerUsageUom || 0;
    const any = prices.find((p) => p.skuId === skuId && p.isActive);
    return any?.pricePerUsageUom || 0;
  };

  const isPacksModeFor = (sku: SKU | null | undefined): boolean => {
    if (!sku) return false;
    return (sku.packSize ?? 0) > 1 && (sku.packUnit ?? "").length > 0;
  };

  // ─── Flow transitions ─────────────────────────────────

  const handleSelectSupplier = (id: string) => {
    setSupplierId(id);
    pushRecentSupplier(id);
    setRecentIds(getRecentSupplierIds());
    setScreen("method");
  };

  const handleManualMethod = () => {
    setRows([]);
    setScreen("manual");
  };

  const handleCameraClick = () => {
    fileInputRef.current?.click();
  };

  const buildScanRows = (scanned: ScanItem[]): ManualRow[] => {
    const matchedMap = new Map<string, { sku: SKU; confidence: MatchConfidence; packs: number; rawNames: string[] }>();
    const unmatched: ManualRow[] = [];

    scanned.forEach((item, idx) => {
      const { sku, confidence } = matchSkuFromRawName(item.raw_name, item.code ?? "", supplierSkus);
      const inputQty = Math.max(0, Number(item.quantity) || 0);

      if (sku) {
        const existing = matchedMap.get(sku.id);
        if (existing) {
          existing.packs += inputQty;
          existing.rawNames.push(item.raw_name);
          if (confidence === "high") existing.confidence = "high";
        } else {
          matchedMap.set(sku.id, {
            sku,
            confidence,
            packs: inputQty,
            rawNames: [item.raw_name],
          });
        }
      } else {
        unmatched.push({
          rowId: `scan-u-${idx}-${Date.now()}`,
          skuId: null,
          packs: inputQty,
          qty: 0,
          actualTotal: 0,
          rawName: item.raw_name,
          matchConfidence: "none",
          isAdHoc: true,
        });
      }
    });

    const matchedRows: ManualRow[] = [];
    matchedMap.forEach((m, skuId) => {
      const packsMode = isPacksModeFor(m.sku);
      const packs = m.packs;
      const qty = packsMode ? packs * (m.sku.packSize || 1) : packs;
      matchedRows.push({
        rowId: `scan-m-${skuId}-${Date.now()}`,
        skuId,
        packs,
        qty,
        actualTotal: 0,
        rawName: m.rawNames.join(" + "),
        matchConfidence: m.confidence,
      });
    });

    return [...matchedRows, ...unmatched];
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
      const matchedCount = built.filter((r) => r.matchConfidence !== "none").length;
      const highCount = built.filter((r) => r.matchConfidence === "high").length;
      const conf = built.length ? Math.round(((matchedCount + highCount) / (built.length * 2)) * 100) : 0;
      setRows(built);
      setScanMeta({ count: items.length, confidence: conf });
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

  const updateRowPacks = (rowId: string, inputValue: number) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r;
        const sku = r.skuId ? skuMap[r.skuId] : null;
        const packsMode = isPacksModeFor(sku);
        const packs = Math.max(0, inputValue);
        const qty = packsMode && sku ? packs * (sku.packSize || 1) : packs;
        return { ...r, packs, qty };
      }),
    );
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
    setSwipedRowId(null);
  };

  // FIX 3: Default new rows to qty = 1 (1 pack or 1 unit)
  const addSkuToRows = (skuId: string) => {
    const sku = skuMap[skuId];
    const packsMode = isPacksModeFor(sku);
    const packs = 1;
    const qty = packsMode && sku ? packs * (sku.packSize || 1) : packs;
    setRows((prev) => [
      ...prev,
      {
        rowId: `row-${skuId}-${Date.now()}`,
        skuId,
        packs,
        qty,
        actualTotal: 0,
      },
    ]);
    setAddSheetOpen(false);
    setAddSheetSearch("");
  };

  // FIX 4: Assign an SKU to an existing unmatched (raw-name) row
  const assignSkuToUnmatchedRow = (rowId: string, skuId: string) => {
    const sku = skuMap[skuId];
    if (!sku) return;
    const packsMode = isPacksModeFor(sku);
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r;
        const packs = r.packs > 0 ? r.packs : 1;
        const qty = packsMode ? packs * (sku.packSize || 1) : packs;
        return {
          ...r,
          skuId,
          packs,
          qty,
          matchConfidence: "high",
          isAdHoc: false,
          // keep rawName so staff still sees what AI read
        };
      }),
    );
    setAddSheetOpen(false);
    setAddSheetSearch("");
    setAssigningRowId(null);
  };

  const openAssignSheet = (row: ManualRow) => {
    setAssigningRowId(row.rowId);
    setAddSheetSearch(row.rawName ?? "");
    setAddSheetOpen(true);
  };

  const openAddSheet = () => {
    setAssigningRowId(null);
    setAddSheetSearch("");
    setAddSheetOpen(true);
  };

  const closeSheet = () => {
    setAddSheetOpen(false);
    setAddSheetSearch("");
    setAssigningRowId(null);
  };

  const handleSheetSelectSku = (skuId: string) => {
    if (assigningRowId) {
      assignSkuToUnmatchedRow(assigningRowId, skuId);
    } else {
      addSkuToRows(skuId);
    }
  };

  const filledRows = useMemo(() => rows.filter((r) => r.qty > 0 && r.skuId), [rows]);
  const filledCount = filledRows.length;

  const resetToStart = () => {
    setSupplierId("");
    setSupplierSearch("");
    setRows([]);
    setScanMeta(null);
    setSwipedRowId(null);
    setAssigningRowId(null);
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
          // FIX 5: match desktop — use purchaseUom on the receipt record
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
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  // ─── Swipeable row (Screens 3 & 4) ─────────────────────

  const ItemRow = ({ r, showDot }: { r: ManualRow; showDot?: boolean }) => {
    const sku = r.skuId ? skuMap[r.skuId] : null;
    const filled = r.qty > 0;
    const packsMode = isPacksModeFor(sku);
    const inputUnit = packsMode && sku ? sku.packUnit : (sku?.usageUom ?? "");
    const showEst = packsMode && sku && r.packs > 0;
    const estGrams = packsMode && sku ? r.packs * (sku.packSize || 1) : 0;
    const isUnmatched = !sku;

    const dotColor =
      r.matchConfidence === "high"
        ? "#34c759"
        : r.matchConfidence === "low" || r.matchConfidence === "none"
          ? "#f59e0b"
          : "transparent";

    const isOpen = swipedRowId === r.rowId;
    const touchStartXRef = useRef<number | null>(null);
    const fgRef = useRef<HTMLDivElement | null>(null);

    const onTouchStart = (e: React.TouchEvent) => {
      touchStartXRef.current = e.touches[0].clientX;
    };
    const onTouchMove = (e: React.TouchEvent) => {
      if (touchStartXRef.current == null) return;
      const dx = e.touches[0].clientX - touchStartXRef.current;
      if (dx >= 0) {
        if (fgRef.current) fgRef.current.style.transform = "translateX(0px)";
        return;
      }
      const clamped = Math.max(dx, -SWIPE_REVEAL);
      if (fgRef.current) {
        fgRef.current.style.transition = "none";
        fgRef.current.style.transform = `translateX(${clamped}px)`;
      }
    };
    const onTouchEnd = (e: React.TouchEvent) => {
      if (touchStartXRef.current == null) return;
      const dx = e.changedTouches[0].clientX - touchStartXRef.current;
      touchStartXRef.current = null;
      if (fgRef.current) {
        fgRef.current.style.transition = "transform 0.2s ease-out";
      }
      if (dx <= -60) {
        setSwipedRowId(r.rowId);
      } else {
        if (isOpen) setSwipedRowId(null);
        if (fgRef.current) fgRef.current.style.transform = "translateX(0px)";
      }
    };

    const handleForegroundClick = () => {
      if (isOpen) {
        setSwipedRowId(null);
        return;
      }
      if (isUnmatched) {
        openAssignSheet(r);
      }
    };

    return (
      <div
        className="relative overflow-hidden"
        style={{
          borderBottom: `0.5px solid ${DIVIDER}`,
          background: filled ? FILLED_ROW_BG : "#fff",
        }}
      >
        {/* Red delete drawer (behind) */}
        <button
          type="button"
          onClick={() => removeRow(r.rowId)}
          className="absolute top-0 bottom-0 right-0 flex items-center justify-center"
          style={{
            width: SWIPE_REVEAL,
            background: DELETE_RED,
            color: "#fff",
            border: "none",
            fontFamily: "DM Sans, sans-serif",
            fontSize: 14,
            fontWeight: 600,
          }}
          tabIndex={-1}
          aria-label="ลบ"
        >
          ลบ
        </button>

        {/* Foreground (swipes) */}
        <div
          ref={fgRef}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onClick={handleForegroundClick}
          className="flex items-stretch gap-2 px-4 relative"
          style={{
            minHeight: 52,
            background: filled ? FILLED_ROW_BG : "#fff",
            transform: isOpen ? `translateX(-${SWIPE_REVEAL}px)` : "translateX(0px)",
            transition: "transform 0.2s ease-out",
            cursor: isUnmatched ? "pointer" : "default",
          }}
        >
          {showDot && (
            <span className="shrink-0 self-center rounded-full" style={{ width: 7, height: 7, background: dotColor }} />
          )}

          <div className="min-w-0 flex-1 py-1.5 self-center">
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
                    fontWeight: filled ? 600 : 400,
                  }}
                >
                  {sku.name}
                </div>
                {showEst && (
                  <div
                    style={{
                      fontFamily: "DM Mono, monospace",
                      fontSize: 10,
                      color: MUTED,
                      lineHeight: 1.2,
                      marginTop: 1,
                    }}
                  >
                    est. {estGrams.toLocaleString()} {sku.usageUom}
                  </div>
                )}
              </>
            ) : (
              <>
                <div
                  className="truncate italic"
                  style={{
                    fontFamily: "DM Sans, sans-serif",
                    fontSize: 13,
                    color: INK,
                    lineHeight: 1.3,
                  }}
                >
                  {r.rawName ?? "—"}
                </div>
                <div
                  style={{
                    fontFamily: "DM Sans, sans-serif",
                    fontSize: 11,
                    color: "#d97706",
                    lineHeight: 1.2,
                    marginTop: 1,
                  }}
                >
                  แตะเพื่อเลือก SKU
                </div>
              </>
            )}
            {sku && r.matchConfidence === "low" && (
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

          <div
            className="flex items-center gap-1 shrink-0 self-center"
            // Stop touch propagation from input/UOM area so qty editing isn't a swipe
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {isUnmatched ? (
              <ChevronRight size={18} style={{ color: MUTED }} />
            ) : (
              <>
                <input
                  type="number"
                  inputMode={packsMode ? "numeric" : "decimal"}
                  min={0}
                  step={packsMode ? 1 : "any"}
                  defaultValue={r.packs || ""}
                  key={`qty-${r.rowId}-${r.packs}`}
                  onFocus={(e) => e.target.select()}
                  onBlur={(e) => {
                    const v = Number(e.target.value) || 0;
                    const normalized = packsMode ? Math.round(v) : v;
                    updateRowPacks(r.rowId, normalized);
                  }}
                  placeholder="0"
                  className="text-center outline-none"
                  style={{
                    width: 56,
                    height: 36,
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
                    fontSize: 10,
                    color: MUTED,
                    width: 30,
                    textAlign: "left",
                  }}
                >
                  {inputUnit}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ─── SCREEN 1 — supplier select ───────────────────────

  if (screen === "select") {
    return (
      <div className="w-full min-h-screen" style={{ background: PAGE_BG }}>
        <div className="px-4 pt-4 pb-6">
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
            {selectedBranch?.branchName ?? (isManagement ? "เลือกสาขา" : "—")} · {format(date, "d MMM yyyy")}
          </div>

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
              <DatePicker value={date} onChange={(d) => d && setDate(d)} className="h-9 w-full" />
            </div>
          )}

          <div className="relative mt-4">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
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
        </div>

        {!branchId ? (
          <p className="py-12 text-center" style={{ color: MUTED, fontSize: 13, fontFamily: "DM Sans, sans-serif" }}>
            เลือกสาขาก่อน
          </p>
        ) : filteredSuppliers.length === 0 ? (
          <p className="py-12 text-center" style={{ color: MUTED, fontSize: 13, fontFamily: "DM Sans, sans-serif" }}>
            ไม่พบซัพพลายเออร์
          </p>
        ) : (
          <div style={{ background: "#fff" }}>
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
                    minHeight: 48,
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
    );
  }

  // ─── SCREEN 2 — method choice ─────────────────────────

  if (screen === "method") {
    return (
      <div className="w-full min-h-screen" style={{ background: PAGE_BG }}>
        <div className="px-4 pt-3 pb-8">
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
              {scanning ? <Loader2 size={20} className="animate-spin" /> : <Camera size={20} />}
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
              เคล็ดลับ: ถ่ายรูปใบส่งให้ชัดและตรง AI จะอ่านรายการให้อัตโนมัติ คุณยังตรวจสอบและแก้ไขได้ก่อนบันทึก
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

  // ─── Shared bottom sheet ──────────────────────────────

  const renderSheet = () => {
    if (!addSheetOpen) return null;
    const isAssign = !!assigningRowId;
    return (
      <>
        <div onClick={closeSheet} className="fixed inset-0" style={{ background: "rgba(0,0,0,0.35)", zIndex: 60 }} />
        <div
          className="fixed left-0 right-0 bottom-0 w-full pb-safe"
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
              {isAssign ? "เลือก SKU ที่ตรงกับรายการ" : "เลือก SKU"}
            </span>
            <button type="button" onClick={closeSheet} style={{ color: MUTED }} aria-label="ปิด">
              <X size={20} />
            </button>
          </div>

          <div className="px-4 pt-3 pb-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
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
              addSheetSkus.map((s) => {
                const packsMode = isPacksModeFor(s);
                const inputUnit = packsMode ? s.packUnit : s.usageUom;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSheetSelectSku(s.id)}
                    className="w-full flex items-center gap-2 px-4 active:bg-black/5 text-left"
                    style={{
                      minHeight: 48,
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
                      {inputUnit}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </>
    );
  };

  // ─── SCREEN 3 — manual entry ──────────────────────────

  if (screen === "manual") {
    return (
      <div className="w-full min-h-screen" style={{ background: PAGE_BG }}>
        <div className="pt-3 pb-32">
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
                แตะ "เพิ่มรายการ" ด้านล่างเพื่อเริ่ม
              </div>
            ) : (
              rows.map((r) => <ItemRow key={r.rowId} r={r} />)
            )}

            <button
              type="button"
              onClick={openAddSheet}
              className="w-full flex items-center gap-3 px-4 active:bg-black/5"
              style={{
                minHeight: 48,
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

        <div
          className="fixed bottom-0 left-0 right-0 w-full pb-safe"
          style={{
            background: "rgba(242,242,247,0.97)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            borderTop: `0.5px solid ${DIVIDER}`,
            zIndex: 50,
          }}
        >
          <div className="px-4 py-3">
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
              {saving ? <Loader2 size={18} className="animate-spin" /> : `บันทึก ${filledCount} รายการ`}
            </button>
          </div>
        </div>

        {renderSheet()}
      </div>
    );
  }

  // ─── SCREEN 4 — AI scan result ────────────────────────

  return (
    <div className="w-full min-h-screen" style={{ background: PAGE_BG }}>
      <div className="pt-3 pb-40">
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

        <div
          className="mt-4 px-4 flex items-center w-full"
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
          AI อ่านได้ {scanMeta?.count ?? rows.length} รายการ · มั่นใจ {scanMeta?.confidence ?? 0}%
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

          <button
            type="button"
            onClick={openAddSheet}
            className="w-full flex items-center gap-3 px-4 active:bg-black/5"
            style={{
              minHeight: 48,
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

      <div
        className="fixed bottom-0 left-0 right-0 w-full pb-safe"
        style={{
          background: "rgba(242,242,247,0.97)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          borderTop: `0.5px solid ${DIVIDER}`,
          zIndex: 50,
        }}
      >
        <div className="px-4 py-3">
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
            {saving ? <Loader2 size={18} className="animate-spin" /> : `ยืนยันและรับของ (${filledCount} รายการ)`}
          </button>
        </div>
      </div>

      {renderSheet()}
    </div>
  );
}
