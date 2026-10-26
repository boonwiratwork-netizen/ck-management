import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductLevel } from "@/lib/product-health";

/** One look per kind of thing, the same on every Cost Center screen */
export type Kind = "supplier" | "RM" | "PK" | "SM" | "SP" | "menu" | "branch";

const KIND: Record<Kind, { label: string; cls: string }> = {
  supplier: { label: "ซัพ", cls: "bg-secondary text-muted-foreground" },
  RM: { label: "RM", cls: "bg-brand-soft text-brand-soft-foreground" },
  PK: { label: "PK", cls: "bg-secondary text-foreground" },
  SM: { label: "SM", cls: "bg-primary text-primary-foreground" },
  SP: { label: "SP", cls: "border border-primary text-foreground" },
  menu: { label: "เมนู", cls: "bg-success-soft text-success" },
  branch: { label: "สาขา", cls: "bg-accent text-accent-foreground" },
};

export const KIND_NAME: Record<Kind, string> = {
  supplier: "ซัพพลายเออร์",
  RM: "วัตถุดิบ",
  PK: "บรรจุภัณฑ์",
  SM: "ครัวผลิต",
  SP: "หน้าร้านเตรียม",
  menu: "เมนู",
  branch: "สาขา",
};

export function KindBadge({ kind, label, className }: { kind: Kind; label?: string; className?: string }) {
  return <span className={cn("inline-flex h-6 min-w-[2.5rem] shrink-0 items-center justify-center rounded-md px-1.5 text-xs font-bold", KIND[kind].cls, className)}>{label ?? KIND[kind].label}</span>;
}

export const LEVEL_LABEL: Record<ProductLevel, string> = { ok: "ครบ", warn: "ควรดู", error: "ต้องแก้", idle: "ไม่ได้ใช้" };

export function LevelDot({ level }: { level: ProductLevel }) {
  return (
    <span
      role="img"
      aria-label={LEVEL_LABEL[level]}
      className={cn("h-2.5 w-2.5 shrink-0 rounded-full", level === "error" ? "bg-destructive" : level === "warn" ? "bg-warning" : level === "idle" ? "bg-muted-foreground/40" : "bg-success")}
    />
  );
}

export interface ChainNode {
  kind: Kind;
  title: string;
  sub?: string;
  current?: boolean;
  onOpen?: () => void;
}

/**
 * Where this item sits: supplier → raw material → kitchen recipe → menu → branch.
 * Every box opens what it names; the current item is outlined. Across on a wide
 * screen, down on a phone.
 */
export function Chain({ nodes }: { nodes: ChainNode[] }) {
  return (
    <nav aria-label="เส้นทางของสินค้านี้" data-tour="cc-chain" className="flex flex-col gap-1.5 md:flex-row md:flex-wrap md:items-stretch">
      {nodes.map((n, i) => {
        const body = (
          <>
            <span className="flex items-center gap-2">
              <KindBadge kind={n.kind} />
              <span className="min-w-0 truncate text-[15px] font-semibold">{n.title}</span>
            </span>
            {n.sub && <span className="truncate text-sm text-muted-foreground">{n.sub}</span>}
          </>
        );
        const box = cn(
          "flex min-h-[56px] min-w-0 flex-col justify-center gap-0.5 rounded-xl border bg-card px-3.5 py-2 text-left md:min-w-[150px] md:max-w-[240px]",
          n.current ? "border-2 border-brand bg-brand-soft/40" : "border-border",
        );
        return (
          <div key={i} className="flex flex-col md:flex-row md:items-center md:gap-1.5">
            {i > 0 && (
              <span aria-hidden="true" className="ml-8 h-2.5 w-0.5 bg-border md:ml-0 md:h-auto md:w-auto md:bg-transparent md:text-muted-foreground">
                <ChevronRight className="hidden h-4 w-4 md:block" />
              </span>
            )}
            {n.onOpen && !n.current ? (
              <button type="button" onClick={n.onOpen} className={cn(box, "transition-colors hover:bg-secondary")}>
                {body}
              </button>
            ) : (
              <div className={box} aria-current={n.current ? "true" : undefined}>
                {body}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export const baht = (n: number, digits = 2) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
/** A price per usage unit: ฿0.10/ก. (more decimals when tiny) */
export const perUnit = (n: number, uom: string) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 })}/${uom}`;
