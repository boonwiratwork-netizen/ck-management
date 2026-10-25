import { useMemo, useState } from "react";
import type { Menu } from "@/types/menu";
import type { Branch } from "@/types/branch";
import { useMenuCategories } from "@/hooks/use-menu-categories";
import { SearchableSelect } from "@/components/SearchableSelect";
import { FieldError } from "@/components/form/FieldError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface NewMenuFormProps {
  menus: Menu[];
  branches: Branch[];
  nextCode: string;
  addMenu: (data: Omit<Menu, "id">) => Promise<Menu | null>;
  /** Close the menu at these branches right after it is created */
  closeAt: (menuId: string, branchIds: string[]) => Promise<boolean>;
  onCreated: (menu: Menu) => void;
  onCancel: () => void;
}

/**
 * Step 1 of a new menu: the facts the POS and reports match on. Brand is picked
 * from real branches (no free text), the code is checked against every menu, and
 * the branches it sells at are chosen here. Recipe and rules come next, in the
 * menu's own workspace, guided by its checklist.
 */
export function NewMenuForm({ menus, branches, nextCode, addMenu, closeAt, onCreated, onCancel }: NewMenuFormProps) {
  const { categories } = useMenuCategories();
  const brands = useMemo(() => [...new Set(branches.filter((b) => b.status === "Active").map((b) => b.brandName).filter(Boolean))].sort(), [branches]);
  const [brand, setBrand] = useState(brands.length === 1 ? brands[0] : "");
  const [code, setCode] = useState(nextCode);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [mainDish, setMainDish] = useState(true);
  const [closed, setClosed] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);

  const brandBranches = branches.filter((b) => b.status === "Active" && b.brandName === brand);
  const codeTaken = menus.some((m) => m.menuCode.trim().toLowerCase() === code.trim().toLowerCase());
  const errors = {
    brand: !brand ? "เลือกแบรนด์" : null,
    code: !code.trim() ? "ใส่รหัสเมนู" : codeTaken ? `รหัส ${code.trim()} มีอยู่แล้ว` : /\s/.test(code.trim()) ? "รหัสห้ามมีช่องว่าง" : null,
    name: !name.trim() ? "ใส่ชื่อเมนู" : null,
    price: price === "" || Number(price) < 0 || Number.isNaN(Number(price)) ? "ใส่ราคาขาย (0 ได้ ถ้าเป็นท็อปปิ้ง)" : null,
  };
  const valid = Object.values(errors).every((e) => !e);
  const catOptions = useMemo(() => categories.map((c) => ({ value: c.name, label: c.name })), [categories]);

  const create = async () => {
    setTried(true);
    if (!valid) return;
    setSaving(true);
    const menu = await addMenu({
      menuCode: code.trim(),
      menuName: name.trim(),
      category,
      sellingPrice: Number(price),
      status: "Active",
      brandName: brand,
      isMaindish: mainDish,
    });
    if (menu && closed.length > 0) await closeAt(menu.id, closed);
    setSaving(false);
    if (menu) onCreated(menu);
  };

  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-card md:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        create();
      }}
    >
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">เมนูใหม่ · ขั้นที่ 1 จาก 4</div>
        <h3 className="mt-1 text-xl font-bold">ข้อมูลเมนู</h3>
        <p className="text-sm text-muted-foreground">ถัดไป: ตั้งสูตร · เช็คราคาวัตถุดิบ · เลือกสาขา — ระบบพาไปทีละขั้น</p>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">แบรนด์</legend>
        <div className="flex flex-wrap gap-1.5">
          {brands.map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={brand === b}
              onClick={() => {
                setBrand(b);
                setClosed([]);
              }}
              className={cn(
                "min-h-[40px] rounded-full border px-4 text-sm transition-colors",
                brand === b ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {b}
            </button>
          ))}
        </div>
        <FieldError message={tried ? errors.brand : null} />
      </fieldset>

      <div className="grid gap-4 md:grid-cols-[180px_1fr]">
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="nm-code">รหัสเมนู (ตรงกับ POS)</label>
          <Input id="nm-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="h-11 font-mono" autoComplete="off" />
          <FieldError message={errors.code && (tried || codeTaken) ? errors.code : null} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="nm-name">ชื่อเมนู</label>
          <Input id="nm-name" value={name} onChange={(e) => setName(e.target.value)} className="h-11" autoComplete="off" />
          <FieldError message={tried ? errors.name : null} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="nm-price">ราคาขาย (บาท)</label>
          <Input id="nm-price" type="number" inputMode="decimal" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} className="h-11 text-right font-mono" />
          <FieldError message={tried ? errors.price : null} />
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium">หมวด</span>
          <SearchableSelect value={category} onValueChange={setCategory} options={catOptions} placeholder="เลือกหมวด" triggerClassName="h-11 w-full" />
        </div>
      </div>

      <label className="flex min-h-[48px] items-center justify-between gap-3 rounded-xl bg-secondary px-4">
        <span>
          <span className="block text-[15px] font-medium">จานหลัก</span>
          <span className="block text-sm text-muted-foreground">ปิดสำหรับท็อปปิ้ง เครื่องดื่ม ของทานเล่น</span>
        </span>
        <Switch checked={mainDish} onCheckedChange={setMainDish} />
      </label>

      {brandBranches.length > 0 && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">เปิดขายที่สาขา</legend>
          <div className="flex flex-col gap-1.5">
            {brandBranches.map((b) => (
              <label key={b.id} className="flex min-h-[48px] items-center justify-between gap-3 rounded-xl bg-secondary px-4">
                <span className="text-[15px]">{b.branchName}</span>
                <Switch
                  checked={!closed.includes(b.id)}
                  onCheckedChange={(on) => setClosed((c) => (on ? c.filter((x) => x !== b.id) : [...c, b.id]))}
                />
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" className="h-11" onClick={onCancel}>
          ยกเลิก
        </Button>
        <Button type="submit" variant="brand" className="h-11 min-w-[140px]" loading={saving}>
          สร้างเมนู แล้วตั้งสูตร
        </Button>
      </div>
    </form>
  );
}
