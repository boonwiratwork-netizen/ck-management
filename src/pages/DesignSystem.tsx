import { useState } from "react";
import { Plus, ShieldCheck, Soup, AlertTriangle, Check, ScanLine, ClipboardCheck, ArrowUpFromLine, ShoppingCart } from "lucide-react";
import { BottomNavBar } from "@/components/BottomNavBar";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { FieldError } from "@/components/form/FieldError";
import { SaveBar } from "@/components/form/SaveBar";
import { cn } from "@/lib/utils";

/**
 * Living style guide (public route /design, no data access).
 * Every swatch reads the CSS token, so this page always shows the current theme.
 * To re-skin the app, edit the PALETTE block at the top of src/index.css.
 */

const palette = [
  { token: "--palette-canvas", name: "พื้นแอป" },
  { token: "--palette-surface", name: "การ์ด" },
  { token: "--palette-surface-2", name: "การ์ดรอง / แถบตาราง" },
  { token: "--palette-ink", name: "ดำเทา · ปุ่มหลัก" },
  { token: "--palette-orange", name: "ส้ม · แบรนด์" },
  { token: "--palette-gold", name: "ทองอำพัน · ตัวเลขเด่น" },
];

const status = [
  { token: "--palette-green", soft: "--palette-green-soft", name: "ผ่าน" },
  { token: "--palette-amber", soft: "--palette-amber-soft", name: "เตือน" },
  { token: "--palette-red", soft: "--palette-red-soft", name: "ผิด" },
  { token: "--palette-orange-deep", soft: "--palette-orange-soft", name: "แบรนด์อ่อน" },
];

const tabs = ["ภาพรวม", "สูตร", "ตัวเลือก POS", "สาขาและราคา"];

// 3,000 sample rows to show the dropdown stays instant with a big list
const demoOptions = [
  { value: "g-rm", label: "วัตถุดิบ (RM)", isGroupHeader: true },
  ...Array.from({ length: 3000 }, (_, i) => ({
    value: `rm-${i}`,
    label: `ตัวอย่างวัตถุดิบ ${String(i + 1).padStart(4, "0")}`,
    sublabel: `RM-${String(i + 1).padStart(4, "0")}`,
  })),
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{children}</div>;
}

export default function DesignSystem() {
  const [tab, setTab] = useState(tabs[0]);
  const [navKey, setNavKey] = useState("count");
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState("0");
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(3);
  const qtyError = Number(qty) <= 0 ? "ปริมาณต้องมากกว่า 0" : null;
  const fakeSave = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setPending(0);
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-background px-4 py-8 md:px-12 md:py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <header className="flex flex-col gap-2">
          <SectionLabel>CK Manager · Design System v2</SectionLabel>
          <h1 className="text-3xl font-bold md:text-4xl">โทนพรีเมียม: off-white · ดำเทา · ส้ม</h1>
          <p className="max-w-3xl text-base text-muted-foreground">
            ทุกสีบนหน้านี้อ่านจาก token จริงของแอป เปลี่ยนสีทั้งแอปได้ที่บล็อก PALETTE บนสุดของ src/index.css
          </p>
        </header>

        <section className="flex flex-col gap-4">
          <SectionLabel>Palette</SectionLabel>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {palette.map((p) => (
              <Card key={p.token} className="flex flex-col gap-3 p-4">
                <div className="h-20 rounded-xl border border-border" style={{ background: `hsl(var(${p.token}))` }} />
                <div className="text-sm font-semibold">{p.name}</div>
                <code className="text-xs text-muted-foreground">{p.token}</code>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {status.map((s) => (
              <div
                key={s.token}
                className="rounded-xl px-4 py-3 text-sm font-semibold"
                style={{ background: `hsl(var(${s.soft}))`, color: `hsl(var(${s.token}))` }}
              >
                {s.name}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <Card className="flex flex-col gap-4 p-6">
            <SectionLabel>ปุ่ม</SectionLabel>
            <div className="flex flex-wrap gap-2">
              <Button>บันทึก</Button>
              <Button variant="brand">
                <Plus /> เพิ่มเมนู
              </Button>
              <Button variant="outline">CSV</Button>
              <Button variant="ghost">ยกเลิก</Button>
            </div>
            <SectionLabel>ช่องกรอก</SectionLabel>
            <Input placeholder="ค้นหาเมนูหรือรหัส" />
          </Card>

          <Card className="flex flex-col gap-3 p-6">
            <SectionLabel>การ์ดตัวเลข</SectionLabel>
            <div className="flex flex-col gap-2 rounded-2xl bg-secondary p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <Soup className="h-5 w-5" />
              </div>
              <div className="text-sm text-muted-foreground">% ต้นทุนตามสูตร</div>
              <div className="text-4xl font-bold">23.8%</div>
              <div className="text-sm text-muted-foreground">฿61.74 / ฿259 ต่อชาม</div>
            </div>
          </Card>

          <Card className="flex flex-col gap-3 p-6">
            <SectionLabel>ป้ายสถานะ และตัวเลขเด่น</SectionLabel>
            <div className="flex flex-wrap gap-2">
              <Badge variant="success">ครบแล้ว</Badge>
              <Badge variant="warning">ยังไม่มีกฎ</Badge>
              <Badge variant="danger">ไม่มีสูตร</Badge>
              <Badge variant="brand">RM</Badge>
              <Badge>SM</Badge>
            </div>
            <div className="flex items-baseline gap-2 pt-2">
              <span className="text-5xl font-bold text-highlight">61.2</span>
              <span className="text-sm text-muted-foreground">หน่วยเครื่องดื่ม / 100 ชาม</span>
            </div>
          </Card>
        </section>

        <section className="flex flex-col gap-4">
          <SectionLabel>ปุ่มและช่องกรอก</SectionLabel>
          <Card className="grid gap-6 p-6 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">เลือกวัตถุดิบ (3,000 รายการ)</label>
              <SearchableSelect value={pick} onValueChange={setPick} options={demoOptions} placeholder="เลือกวัตถุดิบ" />
              <p className="text-sm text-muted-foreground">พิมพ์หลายคำได้ · ลูกศรขึ้นลง · Enter เลือก · Esc ปิด</p>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="ds-qty" className="text-sm font-medium">ปริมาณต่อชาม (กรัม)</label>
              <Input
                id="ds-qty"
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                aria-invalid={!!qtyError}
                className={cn(qtyError && "input-error")}
              />
              <FieldError message={qtyError} />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">ปุ่มระหว่างบันทึก</span>
              <div className="flex flex-wrap gap-2">
                <Button loading={saving} onClick={fakeSave}>
                  {saving ? "กำลังบันทึก…" : "บันทึก"}
                </Button>
                <Button variant="outline" onClick={() => setPending(3)}>
                  แก้ 3 รายการ
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">กดแล้วปุ่มล็อกทันที กดซ้ำไม่ได้</p>
            </div>
          </Card>
          <SaveBar pending={pending} saving={saving} onSave={fakeSave} onDiscard={() => setPending(0)} />
        </section>

        <section className="flex flex-col gap-4">
          <SectionLabel>มือถือ · แถบล่างของหน้าร้าน</SectionLabel>
          <div className="relative mx-auto h-[420px] w-full max-w-[390px] overflow-hidden rounded-[32px] border border-border bg-background shadow-card">
            <div className="flex h-14 items-center border-b bg-card px-4 text-base font-semibold">นับสต๊อกรายวัน</div>
            <div className="flex flex-col gap-3 p-4">
              {["ซุปทงคตสึ", "สันคอหมูชาชู", "ทาเระ โชยุ"].map((n) => (
                <div key={n} className="flex items-center justify-between rounded-2xl bg-card p-4 shadow-card">
                  <span className="text-base">{n}</span>
                  <Input type="number" defaultValue="0" className="h-11 w-24" aria-label={`จำนวน ${n}`} />
                </div>
              ))}
            </div>
            <BottomNavBar
              className="!absolute"
              items={[
                { key: "receive", label: "รับของ", icon: ScanLine },
                { key: "count", label: "นับสต๊อก", icon: ClipboardCheck },
                { key: "request", label: "ขอเบิก", icon: ArrowUpFromLine },
                { key: "sales", label: "ยอดขาย", icon: ShoppingCart },
              ]}
              activeKey={navKey}
              onSelect={setNavKey}
              onMore={() => setNavKey("more")}
            />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <SectionLabel>หัวหน้าเมนู · แท็บ · เช็คลิสต์</SectionLabel>
          <div className="flex flex-col gap-6 rounded-[28px] bg-primary p-6 text-primary-foreground shadow-raised md:flex-row md:items-end md:justify-between md:p-8">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand">
                <Soup className="h-7 w-7" />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-soft">MN-081 · Ramen</div>
                <div className="text-2xl font-bold md:text-3xl">ราเมนแบบฝึกหัด ทงคตสึ</div>
              </div>
            </div>
            <div className="flex gap-8">
              <div>
                <div className="text-xs text-primary-foreground/60">ราคาขาย</div>
                <div className="text-2xl font-semibold">฿259</div>
              </div>
              <div>
                <div className="text-xs text-primary-foreground/60">% ต้นทุน</div>
                <div className="text-2xl font-bold text-brand-soft">23.8%</div>
              </div>
            </div>
          </div>

          <SegmentedTabs tabs={tabs.map((t) => ({ key: t, label: t }))} value={tab} onChange={setTab} />

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="flex flex-wrap items-start gap-4 border-warning-soft p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1 basis-48">
                <div className="font-semibold">ตัวเลือก POS ยังไม่มีกฎ 1 ข้อความ</div>
                <div className="text-sm text-muted-foreground">"Full Topping" (Shiro) · ยังไม่ถูกตัดวัตถุดิบ</div>
              </div>
              <Button variant="brand" size="sm" className="ml-auto">
                ผูกกฎ
              </Button>
            </Card>
            <Card className="flex items-start gap-4 p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success">
                <Check className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <div className="font-semibold">มีสูตรครบ</div>
                <div className="text-sm text-muted-foreground">5 วัตถุดิบ · ทุกตัวมีราคามาตรฐาน</div>
              </div>
              <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            </Card>
          </div>
        </section>
      </div>
    </div>
  );
}
