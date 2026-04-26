import React, { useState, useMemo, useRef, useEffect } from "react";
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
  Images,
  Info,
  Check,
  ShoppingBag,
} from "lucide-react";
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
    bestScore >= 6 && bestStrongMatches >= 2 ? "high" : bestScore >= 3 && bestStrongMatches >= 1 ? "low" : "none";
  return { sku: bestSku, confidence };
}

// ─── iOS visual constants ───────────────────────────────

const PAGE_BG = "#f2f2f7";
const CARD_BG = "#ffffff";
const INK = "#1c1c1e";
const MUTED = "#8e8e93";
const SUBTLE_INK = "#3c3c43";
const DIVIDER = "rgba(0,0,0,0.1)";
const ACCENT = "#007aff";
const SUCCESS = "#34c759";
const WARNING = "#ff9500";
const DANGER = "#ff3b30";
const CHEVRON_GREY = "#c7c7cc";
const SEARCH_BG = "rgba(118,118,128,0.12)";
const CHIP_BG = "rgba(0,0,0,0.07)";
const STEPPER_BG = "rgba(0,0,0,0.06)";
const STEPPER_FILLED_BG = "rgba(34,197,94,0.12)";
const BRAND_PILL_BG = "#e1f5ee";
const BRAND_PILL_FG = "#0f6e56";

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif";

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
  // When set, the bottom sheet is in "assign mode" — picking an SKU re-targets this row
  const [assigningRowId, setAssigningRowId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

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

  const buildScanRows = (
    scanned: ScanItem[],
    aiMatchMap: Map<string, { sku_id: string; confidence: MatchConfidence }>,
  ): ManualRow[] => {
    const matchedMap = new Map<string, { sku: SKU; confidence: MatchConfidence; packs: number; rawNames: string[] }>();
    const unmatched: ManualRow[] = [];

    scanned.forEach((item, idx) => {
      const inputQty = Math.max(0, Number(item.quantity) || 0);

      // 1) Try AI match first
      let sku: SKU | null = null;
      let confidence: MatchConfidence = "none";
      const aiMatch = aiMatchMap.get(item.raw_name);
      if (aiMatch && aiMatch.sku_id) {
        const aiSku = skuMap[aiMatch.sku_id];
        if (aiSku && supplierSkus.some((s) => s.id === aiSku.id)) {
          sku = aiSku;
          confidence = aiMatch.confidence;
        }
      }

      // 2) Fallback to local token matcher
      if (!sku) {
        const fallback = matchSkuFromRawName(item.raw_name, item.code ?? "", supplierSkus);
        sku = fallback.sku;
        confidence = fallback.confidence;
      }

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
      // Send a slim catalog so the AI can match invoice text → SKU IDs
      const skuCatalog = supplierSkus.map((s) => ({ skuId: s.id, name: s.name }));
      const { data, error } = await supabase.functions.invoke("scan-delivery-invoice", {
        body: { imageBase64: base64, mimeType: file.type || "image/jpeg", skuCatalog },
      });
      if (error) throw error;
      const items: ScanItem[] = Array.isArray(data?.items) ? data.items : [];
      const aiMatches: { raw_name: string; sku_id: string; confidence: MatchConfidence }[] = Array.isArray(
        data?.matches,
      )
        ? data.matches
        : [];
      const matchMap = new Map<string, { sku_id: string; confidence: MatchConfidence }>();
      aiMatches.forEach((m) => matchMap.set(m.raw_name, { sku_id: m.sku_id, confidence: m.confidence }));
      const built = buildScanRows(items, matchMap);
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
        const stdUnitPrice = getStdUnitPrice(r.skuId!);
        const stdTotal = qty * stdUnitPrice;
        const actualTotal = stdTotal;
        const actualUnitPrice = stdUnitPrice;
        const priceVariance = 0;
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

  const SwipeableRow = ({ rowId, children }: { rowId: string; children: React.ReactNode }) => {
    const [translate, setTranslate] = React.useState(0);
    const [transition, setTransition] = React.useState(false);
    const startXRef = React.useRef<number | null>(null);
    const currentRef = React.useRef(0);

    const onTouchStart = (e: React.TouchEvent) => {
      startXRef.current = e.touches[0].clientX - currentRef.current;
      setTransition(false);
    };

    const onTouchMove = (e: React.TouchEvent) => {
      if (startXRef.current === null) return;
      const dx = e.touches[0].clientX - startXRef.current;
      const clamped = Math.max(-80, Math.min(0, dx));
      currentRef.current = clamped;
      setTranslate(clamped);
    };

    // ใหม่ — reveal แล้วรอกดปุ่ม
    const onTouchEnd = () => {
      if (startXRef.current === null) return;
      startXRef.current = null;
      setTransition(true);
      if (currentRef.current < -60) {
        currentRef.current = -80;
        setTranslate(-80);
      } else {
        currentRef.current = 0;
        setTranslate(0);
      }
    };

    return (
      <div style={{ position: "relative", overflow: "hidden" }}>
        // ใหม่
        <button
          type="button"
          onClick={() => {
            setTransition(true);
            setTranslate(0);
            currentRef.current = 0;
            setTimeout(() => removeRow(rowId), 200);
          }}
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: 80,
            background: DANGER,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: FONT_STACK,
            fontSize: 15,
            fontWeight: 500,
            border: "none",
            cursor: "pointer",
          }}
        >
          ลบ
        </button>
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{
            transform: `translateX(${translate}px)`,
            transition: transition ? "transform 0.2s ease" : "none",
            background: CARD_BG,
            position: "relative",
          }}
        >
          {children}
        </div>
      </div>
    );
  };

  // ─── Stepper pill ───────────────────────────────────────

  const Stepper = ({ r, sku }: { r: ManualRow; sku: SKU | null }) => {
    const packsMode = isPacksModeFor(sku);
    const inputUnit = packsMode && sku ? (sku.packUnit ?? "") : (sku?.usageUom ?? "");
    const filled = r.packs > 0;
    const step = packsMode ? 1 : 0.1;

    const display = packsMode
      ? String(Math.round(r.packs))
      : Number.isInteger(r.packs)
        ? String(r.packs)
        : r.packs.toFixed(1);

    const dec = (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      updateRowPacks(r.rowId, Math.max(0, +(r.packs - step).toFixed(2)));
    };
    const inc = (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      updateRowPacks(r.rowId, +(r.packs + step).toFixed(2));
    };

    return (
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          alignItems: "center",
          background: filled ? STEPPER_FILLED_BG : STEPPER_BG,
          borderRadius: 10,
          height: 36,
          overflow: "hidden",
          flexShrink: 0,
          flexWrap: "nowrap",
          whiteSpace: "nowrap",
        }}
      >
        <button
          type="button"
          onPointerDown={dec}
          aria-label="ลด"
          style={{
            width: 32,
            height: 36,
            background: "none",
            border: "none",
            color: ACCENT,
            fontSize: 20,
            fontWeight: 400,
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
            fontFamily: FONT_STACK,
          }}
        >
          −
        </button>
        <span
          style={{
            minWidth: 28,
            textAlign: "center",
            fontFamily: FONT_STACK,
            fontSize: 16,
            fontWeight: 700,
            color: INK,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {display}
        </span>
        <button
          type="button"
          onPointerDown={inc}
          aria-label="เพิ่ม"
          style={{
            width: 32,
            height: 36,
            background: "none",
            border: "none",
            color: ACCENT,
            fontSize: 20,
            fontWeight: 400,
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
            fontFamily: FONT_STACK,
          }}
        >
          +
        </button>
        <span
          style={{
            width: 40,
            fontSize: 10,
            color: "#3c3c43",
            flexShrink: 0,
            paddingLeft: 4,
            paddingRight: 6,
            fontFamily: FONT_STACK,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {inputUnit}
        </span>
      </div>
    );
  };

  const ItemRow = ({ r, showDot }: { r: ManualRow; showDot?: boolean }) => {
    const sku = r.skuId ? skuMap[r.skuId] : null;
    const isUnmatched = !sku;
    const conf: MatchConfidence = (r.matchConfidence ?? (sku ? "high" : "none")) as MatchConfidence;

    const dotColor = conf === "high" ? SUCCESS : conf === "low" ? WARNING : DANGER;

    const rowBg = conf === "low" ? "rgba(255,149,0,0.05)" : isUnmatched ? "rgba(255,59,48,0.04)" : CARD_BG;

    const handleTextTap = () => {
      // ALL rows open assign sheet on text tap
      openAssignSheet(r);
    };

    return (
      <SwipeableRow rowId={r.rowId}>
        <div
          className="flex items-stretch w-full"
          style={{
            minHeight: 56,
            background: rowBg,
            borderBottom: `0.5px solid ${DIVIDER}`,
            paddingLeft: 16,
            paddingRight: 16,
            gap: 10,
            fontFamily: FONT_STACK,
          }}
        >
          {showDot && (
            <span className="shrink-0 self-center rounded-full" style={{ width: 8, height: 8, background: dotColor }} />
          )}

          <div
            onClick={handleTextTap}
            className="min-w-0 flex-1 self-center"
            style={{ cursor: "pointer", paddingTop: 8, paddingBottom: 8 }}
          >
            {sku ? (
              <>
                <div
                  className="truncate"
                  style={{
                    fontFamily: FONT_STACK,
                    fontSize: 11,
                    color: MUTED,
                    lineHeight: 1.2,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {sku.skuId}
                </div>
                <div
                  className="truncate"
                  style={{
                    fontFamily: FONT_STACK,
                    fontSize: 15,
                    color: INK,
                    lineHeight: 1.3,
                    fontWeight: 500,
                  }}
                >
                  {sku.name}
                </div>
                {conf === "low" && (
                  <div
                    style={{
                      fontFamily: FONT_STACK,
                      fontSize: 11,
                      color: WARNING,
                      lineHeight: 1.2,
                      marginTop: 2,
                    }}
                  >
                    ตรวจสอบ · แตะเพื่อแก้ไข
                  </div>
                )}
                {conf === "high" && (
                  <div
                    style={{
                      fontFamily: FONT_STACK,
                      fontSize: 10,
                      color: CHEVRON_GREY,
                      lineHeight: 1.2,
                      marginTop: 2,
                    }}
                  >
                    แตะที่ชื่อเพื่อเปลี่ยน SKU
                  </div>
                )}
              </>
            ) : (
              <>
                <div
                  className="truncate"
                  style={{
                    fontFamily: FONT_STACK,
                    fontSize: 14,
                    fontStyle: "italic",
                    fontWeight: 400,
                    color: INK,
                    lineHeight: 1.3,
                  }}
                >
                  {r.rawName ?? "—"}
                </div>
                <div
                  style={{
                    fontFamily: FONT_STACK,
                    fontSize: 11,
                    color: DANGER,
                    lineHeight: 1.2,
                    marginTop: 2,
                  }}
                >
                  ไม่พบใน Price Master · แตะเพื่อเลือก
                </div>
              </>
            )}
          </div>

          <div className="flex items-center shrink-0 self-center" style={{ flexShrink: 0 }}>
            {isUnmatched ? <ChevronRight size={20} style={{ color: CHEVRON_GREY }} /> : <Stepper r={r} sku={sku} />}
          </div>
        </div>
      </SwipeableRow>
    );
  };

  // ─── SCREEN 1 — supplier select ───────────────────────

  if (screen === "select") {
    return (
      <div className="w-full min-h-screen" style={{ background: PAGE_BG, fontFamily: FONT_STACK }}>
        <div className="px-4 pt-5 pb-4">
          <h1
            style={{
              fontFamily: FONT_STACK,
              fontWeight: 700,
              fontSize: 34,
              color: INK,
              letterSpacing: "-0.5px",
              lineHeight: 1.1,
            }}
          >
            รับของ
          </h1>
          <div
            style={{
              fontFamily: FONT_STACK,
              fontSize: 13,
              color: MUTED,
              marginTop: 4,
            }}
          >
            {selectedBranch?.branchName ?? (isManagement ? "เลือกสาขา" : "—")} · {format(date, "d MMM yyyy")}
          </div>

          {(isManagement || !isStoreManager) && (
            <div className="mt-4 space-y-2">
              {isManagement && (
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="w-full outline-none px-3"
                  style={{
                    height: 36,
                    borderRadius: 10,
                    background: SEARCH_BG,
                    border: "none",
                    fontFamily: FONT_STACK,
                    fontSize: 14,
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
                height: 36,
                paddingLeft: 32,
                paddingRight: 12,
                borderRadius: 10,
                background: SEARCH_BG,
                border: "none",
                fontFamily: FONT_STACK,
                fontSize: 14,
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
                      color: isMostRecent ? "#fff" : SUBTLE_INK,
                      fontFamily: FONT_STACK,
                      fontSize: 13,
                      fontWeight: 500,
                      maxWidth: 180,
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
                fontFamily: FONT_STACK,
                fontSize: 12,
                color: MUTED,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                fontWeight: 600,
              }}
            >
              ซัพพลายเออร์
            </div>
          )}
        </div>

        {!branchId ? (
          <p className="py-12 text-center" style={{ color: MUTED, fontSize: 14, fontFamily: FONT_STACK }}>
            เลือกสาขาก่อน
          </p>
        ) : filteredSuppliers.length === 0 ? (
          <p className="py-12 text-center" style={{ color: MUTED, fontSize: 14, fontFamily: FONT_STACK }}>
            ไม่พบซัพพลายเออร์
          </p>
        ) : (
          <div style={{ background: CARD_BG }}>
            {filteredSuppliers.map((s, idx) => {
              const isBrand = brandSupplierIds.has(s.id);
              const isLast = idx === filteredSuppliers.length - 1;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleSelectSupplier(s.id)}
                  className="w-full flex items-center gap-3 px-4 active:bg-black/5 text-left"
                  style={{
                    minHeight: 56,
                    borderBottom: isLast ? "none" : `0.5px solid ${DIVIDER}`,
                    background: CARD_BG,
                    fontFamily: FONT_STACK,
                  }}
                >
                  <span
                    className="shrink-0 inline-flex items-center justify-center"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: isBrand ? BRAND_PILL_BG : "#f2f2f7",
                    }}
                  >
                    <ShoppingBag size={16} strokeWidth={1.75} style={{ color: isBrand ? BRAND_PILL_FG : MUTED }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate"
                      style={{
                        fontFamily: FONT_STACK,
                        fontSize: 17,
                        fontWeight: 400,
                        color: INK,
                        lineHeight: 1.25,
                      }}
                    >
                      {s.name}
                    </div>
                    {isBrand && (
                      <div
                        style={{
                          fontFamily: FONT_STACK,
                          fontSize: 11,
                          color: SUCCESS,
                          lineHeight: 1.2,
                          marginTop: 1,
                        }}
                      >
                        Brand Supplier
                      </div>
                    )}
                  </div>
                  {isBrand && (
                    <span
                      className="shrink-0"
                      style={{
                        background: BRAND_PILL_BG,
                        color: BRAND_PILL_FG,
                        borderRadius: 999,
                        padding: "2px 8px",
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: FONT_STACK,
                      }}
                    >
                      Brand
                    </span>
                  )}
                  <ChevronRight size={18} style={{ color: CHEVRON_GREY }} />
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
    const MethodCard = ({
      onClick,
      iconBg,
      iconColor,
      icon,
      label,
      sub,
      disabled,
    }: {
      onClick: () => void;
      iconBg: string;
      iconColor: string;
      icon: React.ReactNode;
      label: string;
      sub: string;
      disabled?: boolean;
    }) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="w-full flex items-center active:opacity-70 disabled:opacity-60"
        style={{
          background: CARD_BG,
          borderRadius: 14,
          border: `0.5px solid ${DIVIDER}`,
          padding: 16,
          gap: 14,
          marginBottom: 10,
          fontFamily: FONT_STACK,
          textAlign: "left",
        }}
      >
        <span
          className="shrink-0 inline-flex items-center justify-center"
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: iconBg,
            color: iconColor,
          }}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div
            style={{
              fontFamily: FONT_STACK,
              fontSize: 17,
              fontWeight: 500,
              color: INK,
              lineHeight: 1.25,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontFamily: FONT_STACK,
              fontSize: 13,
              color: MUTED,
              lineHeight: 1.3,
              marginTop: 2,
            }}
          >
            {sub}
          </div>
        </div>
        <ChevronRight size={18} style={{ color: CHEVRON_GREY, marginLeft: "auto" }} />
      </button>
    );

    return (
      <div className="w-full min-h-screen" style={{ background: PAGE_BG, fontFamily: FONT_STACK }}>
        <div className="pt-3 pb-8">
          <div className="px-4">
            <button
              type="button"
              onClick={() => {
                setSupplierId("");
                setScreen("select");
              }}
              className="flex items-center -ml-1 active:opacity-60"
              style={{ color: ACCENT, fontSize: 13, fontFamily: FONT_STACK, gap: 2 }}
            >
              <ChevronLeft size={16} /> ซัพพลายเออร์
            </button>
            <h1
              className="mt-2 truncate"
              style={{
                fontFamily: FONT_STACK,
                fontWeight: 700,
                fontSize: 28,
                color: INK,
                letterSpacing: "-0.4px",
                lineHeight: 1.15,
              }}
            >
              {selectedSupplier?.name}
            </h1>
            <div
              style={{
                fontFamily: FONT_STACK,
                fontSize: 13,
                color: MUTED,
                marginTop: 2,
              }}
            >
              {format(date, "d MMM yyyy")}
            </div>
          </div>

          <div className="mt-6 px-0">
            <div style={{ paddingLeft: 0, paddingRight: 0 }}>
              <div style={{ marginLeft: 0, marginRight: 0 }} />
              <div className="px-4">
                <MethodCard
                  onClick={handleCameraClick}
                  disabled={scanning}
                  iconBg={INK}
                  iconColor="#fff"
                  icon={
                    scanning ? <Loader2 size={22} className="animate-spin" /> : <Camera size={22} strokeWidth={1.75} />
                  }
                  label={scanning ? "AI กำลังอ่านใบส่ง..." : "ถ่ายรูปใบส่ง"}
                  sub="AI อ่านรายการให้อัตโนมัติ"
                />
                <MethodCard
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={scanning}
                  iconBg="#f2f2f7"
                  iconColor={INK}
                  icon={<Images size={22} strokeWidth={1.75} />}
                  label="เลือกรูปจากคลัง"
                  sub="ใช้รูปที่ถ่ายไว้แล้ว"
                />
                <MethodCard
                  onClick={handleManualMethod}
                  disabled={scanning}
                  iconBg="#f2f2f7"
                  iconColor={INK}
                  icon={<ClipboardList size={22} strokeWidth={1.75} />}
                  label="กรอกเอง"
                  sub="เลือกรายการจาก Price Master"
                />
              </div>

              <div
                className="mx-4 mt-2"
                style={{
                  background: "rgba(0,122,255,0.07)",
                  borderRadius: 12,
                  padding: "12px 14px",
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                }}
              >
                <Info size={16} strokeWidth={1.75} style={{ color: ACCENT, flexShrink: 0, marginTop: 1 }} />
                <div
                  style={{
                    fontFamily: FONT_STACK,
                    fontSize: 13,
                    color: INK,
                    lineHeight: 1.4,
                  }}
                >
                  เคล็ดลับ: ถ่ายรูปใบส่งให้ชัดและตรง AI จะอ่านรายการให้อัตโนมัติ คุณยังตรวจสอบและแก้ไขได้ก่อนบันทึก
                </div>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileSelected}
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
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
            background: CARD_BG,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            height: "70vh",
            zIndex: 70,
            display: "flex",
            flexDirection: "column",
            fontFamily: FONT_STACK,
          }}
        >
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: `0.5px solid ${DIVIDER}` }}
          >
            <span
              style={{
                fontFamily: FONT_STACK,
                fontSize: 16,
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
                  height: 36,
                  paddingLeft: 32,
                  paddingRight: 12,
                  borderRadius: 10,
                  background: SEARCH_BG,
                  border: "none",
                  fontFamily: FONT_STACK,
                  fontSize: 14,
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
                  fontFamily: FONT_STACK,
                  fontSize: 14,
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
                      minHeight: 52,
                      borderBottom: `0.5px solid ${DIVIDER}`,
                      background: CARD_BG,
                      fontFamily: FONT_STACK,
                    }}
                  >
                    <div className="min-w-0 flex-1 py-1">
                      <div
                        className="truncate"
                        style={{
                          fontFamily: FONT_STACK,
                          fontSize: 11,
                          color: MUTED,
                          lineHeight: 1.2,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {s.skuId}
                      </div>
                      <div
                        className="truncate"
                        style={{
                          fontFamily: FONT_STACK,
                          fontSize: 15,
                          color: INK,
                          lineHeight: 1.3,
                        }}
                      >
                        {s.name}
                      </div>
                    </div>
                    <span
                      style={{
                        fontFamily: FONT_STACK,
                        fontSize: 12,
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

  // ─── Common header for screens 3 / 4 ─────────────────

  const ScreenHeader = ({ subRight }: { subRight: string }) => (
    <div className="px-4">
      <button
        type="button"
        onClick={() => setScreen("method")}
        className="flex items-center -ml-1 active:opacity-60"
        style={{ color: ACCENT, fontSize: 13, fontFamily: FONT_STACK, gap: 2 }}
      >
        <ChevronLeft size={16} /> {selectedSupplier?.name ? "วิธีรับของ" : "กลับ"}
      </button>
      <h1
        className="mt-2 truncate"
        style={{
          fontFamily: FONT_STACK,
          fontWeight: 700,
          fontSize: 26,
          color: INK,
          letterSpacing: "-0.4px",
          lineHeight: 1.15,
        }}
      >
        {selectedSupplier?.name}
      </h1>
      <div
        style={{
          fontFamily: FONT_STACK,
          fontSize: 13,
          color: MUTED,
          marginTop: 2,
        }}
      >
        {subRight}
      </div>
    </div>
  );

  const AddRow = (
    <button
      type="button"
      onClick={openAddSheet}
      className="w-full flex items-center px-4 active:bg-black/5"
      style={{
        height: 44,
        background: CARD_BG,
        borderTop: `0.5px solid ${DIVIDER}`,
        gap: 10,
        fontFamily: FONT_STACK,
      }}
    >
      <span
        className="inline-flex items-center justify-center shrink-0"
        style={{
          width: 24,
          height: 24,
          borderRadius: 999,
          background: SUCCESS,
          color: "#fff",
          fontSize: 18,
          lineHeight: 1,
        }}
      >
        <Plus size={14} strokeWidth={3} />
      </span>
      <span
        style={{
          fontFamily: FONT_STACK,
          fontSize: 17,
          color: ACCENT,
          fontWeight: 400,
        }}
      >
        เพิ่มรายการ
      </span>
    </button>
  );

  const SwipeHint = (
    <div
      className="text-center"
      style={{
        fontFamily: FONT_STACK,
        fontSize: 11,
        color: CHEVRON_GREY,
        padding: "8px 0 4px",
      }}
    >
      ← ปัดซ้ายเพื่อลบ
    </div>
  );

  // ─── SCREEN 3 — manual entry ──────────────────────────

  if (screen === "manual") {
    return (
      <div className="w-full min-h-screen" style={{ background: PAGE_BG, fontFamily: FONT_STACK }}>
        <div className="pt-3 pb-32">
          <ScreenHeader subRight={`${rows.length} รายการ · ${format(date, "d MMM yyyy")}`} />

          <div className="mt-4" style={{ background: CARD_BG }}>
            {rows.length === 0 ? (
              <div
                className="px-4 py-10 text-center"
                style={{
                  fontFamily: FONT_STACK,
                  fontSize: 14,
                  color: MUTED,
                }}
              >
                ยังไม่มีรายการ
                <br />
                แตะ "เพิ่มรายการ" ด้านล่างเพื่อเริ่ม
              </div>
            ) : (
              <div>
                {rows.map((r) => (
                  <ItemRow key={r.rowId} r={r} />
                ))}
              </div>
            )}

            {AddRow}
          </div>

          {rows.length > 0 && SwipeHint}
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
                height: 50,
                borderRadius: 14,
                background: filledCount === 0 ? "rgba(0,0,0,0.15)" : INK,
                color: "#fff",
                fontFamily: FONT_STACK,
                fontSize: 17,
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
    <div className="w-full min-h-screen" style={{ background: PAGE_BG, fontFamily: FONT_STACK }}>
      <div className="pt-3 pb-40">
        <ScreenHeader subRight={`${rows.length} รายการ · ${format(date, "d MMM yyyy")}`} />

        {/* AI scan banner */}
        <div
          className="mx-4 mt-3"
          style={{
            background: "rgba(52,199,89,0.1)",
            borderRadius: 10,
            padding: "10px 14px",
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
        >
          <span
            className="inline-flex items-center justify-center shrink-0"
            style={{
              width: 20,
              height: 20,
              borderRadius: 999,
              background: SUCCESS,
              color: "#fff",
            }}
          >
            <Check size={12} strokeWidth={3} />
          </span>
          <div
            style={{
              fontFamily: FONT_STACK,
              fontSize: 13,
              color: INK,
              lineHeight: 1.3,
            }}
          >
            อ่านได้{" "}
            <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {scanMeta?.count ?? rows.length}
            </span>{" "}
            รายการ · มั่นใจ{" "}
            <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{scanMeta?.confidence ?? 0}%</span>
          </div>
        </div>

        <div className="mt-3" style={{ background: CARD_BG }}>
          {rows.length === 0 ? (
            <div
              className="px-4 py-10 text-center"
              style={{
                fontFamily: FONT_STACK,
                fontSize: 14,
                color: MUTED,
              }}
            >
              AI ไม่พบรายการ
            </div>
          ) : (
            <div>
              {rows.map((r) => (
                <ItemRow key={r.rowId} r={r} showDot />
              ))}
            </div>
          )}

          {AddRow}
        </div>

        {rows.length > 0 && SwipeHint}
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
              height: 50,
              borderRadius: 14,
              background: filledCount === 0 ? "rgba(0,0,0,0.15)" : INK,
              color: "#fff",
              fontFamily: FONT_STACK,
              fontSize: 17,
              fontWeight: 600,
              border: "none",
              cursor: filledCount === 0 ? "default" : "pointer",
              gap: 8,
            }}
          >
            {saving ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <>
                <span>ยืนยันและรับของ</span>
                <span
                  style={{
                    background: ACCENT,
                    color: "#fff",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 700,
                    padding: "1px 8px",
                    fontFamily: FONT_STACK,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {filledCount}
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {renderSheet()}
    </div>
  );
}
