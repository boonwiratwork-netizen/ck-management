import { useState } from "react";
import { AlertTriangle, ChevronDown, CircleDashed, XCircle } from "lucide-react";
import type { ProductCheck, ProductLevel, ProductSummary } from "@/lib/product-health";
import { cn } from "@/lib/utils";
import { KindBadge } from "./parts";

const GROUPS: { id: ProductCheck["id"]; level: ProductLevel; title: string; why: string }[] = [
  { id: "multi-price", level: "error", title: "มีราคาใช้งานหลายเจ้า", why: "เลือกเจ้าหลัก · ไม่งั้นแต่ละหน้าอาจคิดต้นทุนจากคนละเจ้า" },
  { id: "inactive-used", level: "error", title: "ปิดใช้แล้ว แต่ยังอยู่ในสูตร", why: "สูตรยังตัดของที่ไม่ได้ใช้แล้ว" },
  { id: "no-price", level: "error", title: "ใช้ในสูตรแต่ไม่มีราคา", why: "ต้นทุนเป็น ฿0 ทุกที่ที่ใช้" },
  { id: "no-recipe", level: "error", title: "ของที่ทำเองยังไม่มีสูตร", why: "ผลิตแล้วไม่ตัดวัตถุดิบ" },
  { id: "recipe-inactive", level: "error", title: "สูตรใช้ของที่ปิดใช้แล้ว", why: "เปลี่ยนเป็นตัวที่ใช้อยู่" },
  { id: "recipe-no-price", level: "error", title: "สูตรมีวัตถุดิบที่ไม่มีราคา", why: "ต้นทุนสูตรต่ำกว่าจริง" },
  { id: "bill-drift", level: "warn", title: "ราคาในบิลต่างจากราคามาตรฐานเกิน 10%", why: "ต้นทุนเมนูคลาดจากจริง" },
  { id: "stale-cost", level: "warn", title: "ต้นทุนสูตรในระบบยังไม่ได้คิดใหม่", why: "ราคาวัตถุดิบเปลี่ยนหลังคิดครั้งล่าสุด" },
  { id: "no-price", level: "warn", title: "ยังไม่มีราคา (ยังไม่ได้ใช้ในสูตร)", why: "ใส่ก่อนเอาไปใช้" },
  { id: "draft", level: "warn", title: "ร่างค้าง", why: "ยังไม่ขึ้นในงานประจำวัน" },
  { id: "unused", level: "idle", title: "ไม่ได้ใช้ในสูตรไหน และไม่ได้ซื้อ 90 วัน", why: "ปิดใช้ได้ รายการจะสั้นลง" },
];

const ICON: Record<ProductLevel, { icon: React.ElementType; cls: string }> = {
  error: { icon: XCircle, cls: "bg-destructive-soft text-destructive" },
  warn: { icon: AlertTriangle, cls: "bg-warning-soft text-warning" },
  idle: { icon: CircleDashed, cls: "bg-secondary text-muted-foreground" },
  ok: { icon: CircleDashed, cls: "bg-secondary text-muted-foreground" },
};

/** Cost Center overview: product problems grouped, each opening the product */
export function ProductOverview({ summaries, onOpenProduct }: { summaries: ProductSummary[]; onOpenProduct: (skuId: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = GROUPS.map((g) => ({
    ...g,
    key: `${g.id}-${g.level}`,
    items: summaries.filter((s) => s.checks.some((c) => c.id === g.id && c.level === g.level) && (g.id === "inactive-used" || s.sku.status !== "Inactive")),
  })).filter((g) => g.items.length);

  if (!groups.length) return <p className="rounded-2xl border border-border bg-card p-4 text-sm shadow-card">สินค้าตั้งครบทุกตัว</p>;
  return (
    <ul className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      {groups.map((g) => {
        const Icon = ICON[g.level].icon;
        const isOpen = open === g.key;
        return (
          <li key={g.key} className="border-t border-border first:border-t-0">
            <button type="button" onClick={() => setOpen(isOpen ? null : g.key)} aria-expanded={isOpen} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/60">
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", ICON[g.level].cls)}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{g.title}</span>
                <span className="block text-sm text-muted-foreground">{g.why}</span>
              </span>
              <span className="shrink-0 text-sm">{g.items.length} ตัว</span>
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
            </button>
            {isOpen && (
              <ul className="divide-y divide-border border-t border-border bg-secondary/30">
                {g.items.map((s) => {
                  const c = s.checks.find((x) => x.id === g.id);
                  return (
                    <li key={s.sku.id}>
                      <button type="button" onClick={() => onOpenProduct(s.sku.id)} className="flex min-h-[48px] w-full items-center gap-3 px-4 py-2 pl-14 text-left hover:bg-secondary">
                        <KindBadge kind={s.sku.type} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px]">{s.sku.name}</span>
                          {c?.detail && g.id !== "draft" && <span className="block truncate text-sm text-muted-foreground">{c.title !== g.title ? c.title : c.detail}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
