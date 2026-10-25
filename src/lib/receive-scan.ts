import type { SKU } from "@/types/sku";

/**
 * Delivery-note photo helpers shared by the receive screens: recent suppliers on
 * this device, image → base64 for the scan-delivery-invoice function, and the
 * local name matcher used when the AI can't match a line to an SKU.
 */

export type MatchConfidence = "high" | "low" | "none";

export interface ScanItem {
  code: string;
  raw_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
}


const RECENT_SUPPLIERS_KEY = "br-mobile-recent-suppliers";

export function getRecentSupplierIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SUPPLIERS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecentSupplier(id: string) {
  try {
    const cur = getRecentSupplierIds();
    const next = [id, ...cur.filter((x) => x !== id)].slice(0, 5);
    localStorage.setItem(RECENT_SUPPLIERS_KEY, JSON.stringify(next));
  } catch {
    /* noop */
  }
}

export function fileToBase64(file: File): Promise<string> {
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

export function matchSkuFromRawName(
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

