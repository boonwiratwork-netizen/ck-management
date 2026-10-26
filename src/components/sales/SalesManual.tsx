import { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import type { Menu } from "@/types/menu";
import type { ModifierRule } from "@/types/modifier-rule";
import { manualRow, type SalesInsertRow } from "@/lib/sales-import";
import { ActionFooter, PackStepper, baht } from "@/components/receive/parts";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Sales made outside the POS, one menu at a time (the old "บันทึกทีละรายการ").
 * Writes the same row as before: receipt MANUAL-<time>, channel/order type "Manual",
 * the picked option's keyword added to the name so its rule still fires.
 */
export function SalesManual({
  branchId,
  menus,
  rules,
  today,
  defaultDate,
  onSave,
}: {
  branchId: string;
  menus: Menu[];
  rules: ModifierRule[];
  today: string;
  defaultDate: string;
  onSave: (row: SalesInsertRow) => Promise<boolean>;
}) {
  const [date, setDate] = useState(defaultDate);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [ruleId, setRuleId] = useState("");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState<string[]>([]);

  const found = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return menus.filter((m) => words.every((w) => `${m.menuCode} ${m.menuName}`.toLowerCase().includes(w))).slice(0, 20);
  }, [menus, query]);
  const options = useMemo(
    () => (menu ? rules.filter((r) => r.isActive && (r.menuIds.length === 0 || r.menuIds.includes(menu.id)) && (r.ruleType === "add" || r.ruleType === "swap")) : []),
    [menu, rules],
  );
  const unitPrice = price ?? menu?.sellingPrice ?? 0;
  const rule = options.find((r) => r.id === ruleId);

  const pick = (m: Menu | null) => {
    setMenu(m);
    setRuleId("");
    setPrice(null);
    setQty(1);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold">เพิ่มรายการเอง</h2>
        <p className="text-sm text-muted-foreground">ใช้กับของที่ขายนอก POS หรือแถวที่ POS ไม่มีรหัสเมนู</p>
      </div>

      <label className="flex max-w-[220px] flex-col gap-1 text-sm">
        <span className="font-medium">วันที่ขาย</span>
        <Input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-11 text-base" />
      </label>

      {!menu ? (
        <div className="flex flex-col gap-2">
          <label className="relative block">
            <span className="sr-only">ค้นเมนู</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นรหัสหรือชื่อเมนู…" className="h-11 pl-9 text-base" />
          </label>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {found.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => pick(m)} className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-secondary/60">
                  <span className="w-[68px] shrink-0 font-mono text-sm text-muted-foreground">{m.menuCode}</span>
                  <span className="min-w-0 flex-1 break-words text-[15px]">{m.menuName}</span>
                  <span className={cn("font-mono text-sm", m.sellingPrice > 0 ? "" : "text-warning")}>{m.sellingPrice > 0 ? baht(m.sellingPrice) : "ไม่มีราคา"}</span>
                </button>
              </li>
            ))}
            {!found.length && <li className="p-6 text-center text-sm text-muted-foreground">ไม่พบเมนู</li>}
          </ul>
        </div>
      ) : (
        <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-card">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-sm text-muted-foreground">{menu.menuCode}</div>
              <div className="text-[17px] font-semibold">{menu.menuName}</div>
            </div>
            <button type="button" aria-label="เปลี่ยนเมนู" onClick={() => pick(null)} className="-mr-2 -mt-1 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary">
              <X className="h-5 w-5" />
            </button>
          </div>
          {options.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">ตัวเลือก (ถ้ามี)</legend>
              <div className="flex flex-wrap gap-2">
                {options.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={ruleId === r.id}
                    title={r.description}
                    onClick={() => setRuleId(ruleId === r.id ? "" : r.id)}
                    className={cn("min-h-[40px] rounded-full border px-4 text-sm", ruleId === r.id ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card")}
                  >
                    {r.keyword}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium">จำนวน</span>
              <PackStepper label="จำนวน" value={qty} onChange={(v) => setQty(Math.max(1, Math.round(v)))} />
            </div>
            <label className="flex w-[140px] flex-col gap-1 text-sm">
              <span className="font-medium">ราคา/หน่วย</span>
              <Input type="number" inputMode="decimal" value={unitPrice || ""} onChange={(e) => setPrice(Number(e.target.value) || 0)} className="h-11 text-right font-mono text-base" />
            </label>
          </div>
          {unitPrice <= 0 && <p className="text-sm text-warning">เมนูนี้ยังไม่มีราคา ใส่ราคาก่อนบันทึก</p>}
        </section>
      )}

      {added.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {added.map((a, k) => (
            <li key={k} className="flex items-center gap-2">
              <Check className="h-4 w-4 text-success" /> {a}
            </li>
          ))}
        </ul>
      )}

      <ActionFooter
        title={menu ? `${menu.menuName}${rule ? ` + ${rule.keyword}` : ""} × ${qty}` : "เลือกเมนูก่อน"}
        sub={menu ? baht(qty * unitPrice, 2) : undefined}
        action="บันทึก"
        busy={saving}
        disabled={!menu || unitPrice <= 0}
        onAction={async () => {
          if (!menu) return;
          setSaving(true);
          const ok = await onSave(manualRow({ branchId, date, menuCode: menu.menuCode, menuName: menu.menuName, optionKeyword: rule?.keyword, qty, unitPrice }));
          setSaving(false);
          if (ok) {
            setAdded((a) => [`${menu.menuName}${rule ? ` + ${rule.keyword}` : ""} × ${qty} (${date})`, ...a]);
            pick(null);
            setQuery("");
          }
        }}
      />
    </div>
  );
}
