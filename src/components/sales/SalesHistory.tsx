import { useEffect, useMemo, useState } from "react";
import { addDays, endOfMonth, format, parseISO, startOfMonth, subMonths } from "date-fns";
import { Check, ChevronDown, Copy, Pencil, Search, Trash2 } from "lucide-react";
import type { Branch } from "@/types/branch";
import type { SaleLine } from "@/hooks/use-sales-data";
import { shortName } from "@/lib/sales-import";
import { useProgressiveList } from "@/hooks/use-progressive-list";
import { ShowMoreRows } from "@/components/ShowMoreRows";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { baht } from "@/components/receive/parts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { EditDialog, type Patch } from "./SalesDay";
import { thaiDay } from "./SalesDays";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Sales of several branches over any dates (the old history + Manage Transactions):
 * totals per branch with missing days, every line, copy to Excel, edit, and
 * delete selected / everything in the range for management.
 */
export function SalesHistory({
  branches,
  initialBranchIds,
  lockBranches,
  today,
  fetchHistory,
  canEdit,
  canBulk,
  onUpdate,
  onDelete,
}: {
  branches: Branch[];
  initialBranchIds: string[];
  lockBranches: boolean;
  today: string;
  fetchHistory: (ids: string[], from: string, to: string) => Promise<SaleLine[] | null>;
  canEdit: boolean;
  canBulk: boolean;
  onUpdate: (id: string, patch: Patch) => Promise<boolean>;
  onDelete: (ids: string[]) => Promise<boolean>;
}) {
  const [ids, setIds] = useState<string[]>(initialBranchIds);
  const [from, setFrom] = useState(() => iso(startOfMonth(parseISO(today))));
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ ids: string[]; text: string } | null>(null);
  const [editing, setEditing] = useState<SaleLine | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchHistory(ids, from, to).then((rows) => {
      if (!live) return;
      setLines(rows ?? []);
      setLoading(false);
      setPicked(new Set());
    });
    return () => {
      live = false;
    };
  }, [ids, from, to, fetchHistory, reloadKey]);

  const name = useMemo(() => new Map(branches.map((b) => [b.id, b.branchName])), [branches]);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return lines;
    return lines.filter((l) => words.every((w) => `${l.receipt_no} ${l.menu_code} ${l.menu_name} ${l.channel} ${name.get(l.branch_id) ?? ""}`.toLowerCase().includes(w)));
  }, [lines, query, name]);
  const page = useProgressiveList(shown);

  // Totals per branch, and days in the range with nothing saved
  const perBranch = useMemo(() => {
    const days: string[] = [];
    for (let d = parseISO(from); iso(d) <= to && iso(d) < today; d = addDays(d, 1)) days.push(iso(d));
    return ids.map((id) => {
      const mine = lines.filter((l) => l.branch_id === id);
      const have = new Set(mine.map((l) => l.sale_date));
      return { id, total: mine.reduce((s, l) => s + l.net_amount, 0), missing: days.filter((d) => !have.has(d)).length };
    });
  }, [ids, lines, from, to, today]);
  const total = shown.reduce((s, l) => s + l.net_amount, 0);
  const byDay = useMemo(() => {
    const m = new Map<string, SaleLine[]>();
    for (const l of shown) m.set(l.sale_date, [...(m.get(l.sale_date) ?? []), l]);
    return [...m.entries()];
  }, [shown]);

  const preset = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
  };
  const ref = parseISO(today);
  const presets = [
    { label: "7 วัน", f: iso(addDays(ref, -6)), t: today },
    { label: "เดือนนี้", f: iso(startOfMonth(ref)), t: today },
    { label: "เดือนก่อน", f: iso(startOfMonth(subMonths(ref, 1))), t: iso(endOfMonth(subMonths(ref, 1))) },
  ];
  const copy = () => {
    // Same columns as the old "Copy to Clipboard"
    const head = ["Date", "Receipt No", "Menu Code", "Menu Name", "Order Type", "Qty", "Unit Price", "Net Amount", "Channel", "Branch"];
    const rows = shown.map((e) =>
      [e.sale_date, e.receipt_no, e.menu_code, `"${e.menu_name.replace(/"/g, '""')}"`, e.order_type, e.qty, e.unit_price.toFixed(2), e.net_amount.toFixed(2), e.channel, name.get(e.branch_id) ?? ""].join("\t"),
    );
    navigator.clipboard.writeText([head.join("\t"), ...rows].join("\n")).then(() => toast.success(`คัดลอก ${shown.length.toLocaleString()} รายการแล้ว วางใน Excel ได้เลย`));
  };
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const rangeText = `${thaiDay(from)} – ${thaiDay(to)}`;
  const branchText = ids.map((i) => name.get(i)).join(", ");

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">ประวัติยอดขาย</h2>

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 lg:flex-row lg:flex-wrap lg:items-end">
        {!lockBranches && branches.length > 1 && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">สาขา (เลือกได้หลายสาขา)</legend>
            <div className="flex flex-wrap gap-1.5">
              {branches.map((b) => {
                const on = ids.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setIds((x) => (on ? (x.length > 1 ? x.filter((i) => i !== b.id) : x) : [...x, b.id]))}
                    className={cn("flex min-h-[40px] items-center gap-1.5 rounded-full border px-4 text-sm", on ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card")}
                  >
                    {on && <Check className="h-3.5 w-3.5" />}
                    {b.branchName}
                  </button>
                );
              })}
              {ids.length < branches.length && (
                <button type="button" onClick={() => setIds(branches.map((b) => b.id))} className="min-h-[40px] rounded-full border border-dashed border-border px-4 text-sm text-muted-foreground">
                  ทุกสาขา
                </button>
              )}
            </div>
          </fieldset>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">ช่วงวันที่</span>
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="ตั้งแต่" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="h-10 min-w-0 flex-1 text-base md:text-sm lg:w-[150px] lg:flex-none" />
            <span className="text-sm text-muted-foreground">ถึง</span>
            <Input type="date" aria-label="ถึง" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} className="h-10 min-w-0 flex-1 text-base md:text-sm lg:w-[150px] lg:flex-none" />
          </div>
        </div>
        <div className="flex gap-1.5">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={from === p.f && to === p.t}
              onClick={() => preset(p.f, p.t)}
              className={cn("min-h-[40px] flex-1 rounded-full border px-3 text-sm lg:flex-none", from === p.f && to === p.t ? "border-foreground font-semibold" : "border-border")}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="relative block lg:ml-auto lg:w-[260px]">
          <span className="sr-only">ค้นเมนู เลขบิล ช่องทาง</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นเมนู เลขบิล ช่องทาง…" className="h-10 pl-9 text-base md:text-sm" />
        </label>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={query ? "ยอดรวม (ที่ค้น)" : "ยอดรวม"} value={loading ? "…" : baht(total)} sub={`${rangeText}`} />
        {perBranch.map((b) => (
          <Stat
            key={b.id}
            label={name.get(b.id) ?? ""}
            value={loading ? "…" : baht(b.total)}
            sub={loading ? "" : b.missing ? `ขาด ${b.missing} วัน` : "ครบทุกวัน"}
            warn={!loading && b.missing > 0}
          />
        ))}
        <Stat label="รายการ" value={loading ? "…" : shown.length.toLocaleString()} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className="h-10" disabled={!shown.length} onClick={copy}>
          <Copy className="h-4 w-4" /> คัดลอกไป Excel
        </Button>
        {canBulk && (
          <Button
            variant={selecting ? "default" : "outline"}
            className="h-10"
            disabled={!shown.length}
            onClick={() => {
              setSelecting(!selecting);
              setPicked(new Set());
            }}
          >
            {selecting ? "เลิกเลือก" : "เลือกเพื่อลบ"}
          </Button>
        )}
      </div>

      {selecting && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-card px-3 py-2 shadow-card">
          <span className="mr-auto text-sm">
            เลือก {picked.size.toLocaleString()} รายการ · <span className="font-mono">{baht(shown.filter((l) => picked.has(l.id)).reduce((s, l) => s + l.net_amount, 0), 2)}</span>
          </span>
          <Button variant="ghost" className="h-10" onClick={() => setPicked(new Set(shown.map((l) => l.id)))}>
            เลือกทั้งหมด
          </Button>
          <Button
            variant="outline"
            className="h-10 border-destructive text-destructive hover:text-destructive"
            disabled={!picked.size}
            onClick={() => setConfirm({ ids: [...picked], text: `ลบ ${picked.size.toLocaleString()} รายการที่เลือกออกจากระบบ ยอดขายและการตัดสต๊อกของวันนั้นจะเปลี่ยนตาม` })}
          >
            <Trash2 className="h-4 w-4" /> ลบที่เลือก
          </Button>
          <Button
            variant="destructive"
            className="h-10"
            onClick={() =>
              setConfirm({
                ids: shown.map((l) => l.id),
                text: `ลบยอดขายทั้งหมด ${shown.length.toLocaleString()} รายการ (${baht(total, 2)}) ของ ${branchText} ช่วง ${rangeText}${query ? ` ที่ตรงกับ “${query}”` : ""} ออกจากระบบ ลบแล้วเอาคืนไม่ได้`,
              })
            }
          >
            ลบทั้งหมดในช่วงนี้ ({shown.length.toLocaleString()})
          </Button>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">กำลังโหลด…</div>
      ) : !shown.length ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">{query ? "ไม่พบรายการที่ค้น" : "ไม่มียอดขายในช่วงนี้"}</div>
      ) : (
        <>
          {/* Computers: one table */}
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                {selecting && <col style={{ width: "44px" }} />}
                <col style={{ width: "96px" }} />
                <col style={{ width: "100px" }} />
                <col style={{ width: "96px" }} />
                <col />
                <col style={{ width: "64px" }} />
                <col style={{ width: "112px" }} />
                <col style={{ width: "110px" }} />
                {canEdit && !selecting && <col style={{ width: "52px" }} />}
              </colgroup>
              <thead className="bg-secondary text-left text-xs font-semibold text-muted-foreground">
                <tr>
                  {selecting && <th className="px-3 py-2.5" />}
                  <th className="px-3 py-2.5">วันที่</th>
                  <th className="px-3 py-2.5">สาขา</th>
                  <th className="px-3 py-2.5">บิล</th>
                  <th className="px-3 py-2.5">เมนู</th>
                  <th className="px-3 py-2.5 text-right">จำนวน</th>
                  <th className="px-3 py-2.5 text-right">ยอด</th>
                  <th className="px-3 py-2.5">ช่องทาง</th>
                  {canEdit && !selecting && <th />}
                </tr>
              </thead>
              <tbody>
                {page.visible.map((l) => {
                  const n = shortName(l.menu_name);
                  return (
                    <tr key={l.id} className={cn("border-t border-border", picked.has(l.id) && "bg-destructive/5")}>
                      {selecting && (
                        <td className="px-3 py-2">
                          <Checkbox checked={picked.has(l.id)} onCheckedChange={() => toggle(l.id)} aria-label={`เลือก ${n.base}`} />
                        </td>
                      )}
                      <td className="px-3 py-2">{thaiDay(l.sale_date).split(" ").slice(1).join(" ")}</td>
                      <td className="truncate px-3 py-2">{name.get(l.branch_id)}</td>
                      <td className="truncate px-3 py-2 font-mono">{l.receipt_no}</td>
                      <td className="px-3 py-2">
                        <div className="truncate">{n.base}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          <span className="font-mono">{l.menu_code}</span>
                          {n.options && ` · ${n.options}`}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{l.qty}</td>
                      <td className="px-3 py-2 text-right font-mono">{l.net_amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                      <td className="truncate px-3 py-2">{l.channel}</td>
                      {canEdit && !selecting && (
                        <td className="px-1 py-1">
                          <Button variant="ghost" size="icon" className="h-10 w-10" aria-label={`แก้ ${n.base}`} onClick={() => setEditing(l)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ShowMoreRows shown={page.shown} total={page.total} hasMore={page.hasMore} onMore={page.showMore} onAll={page.showAll} />
          </div>

          {/* Phones: one row per day, tap to see its lines */}
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card md:hidden">
            {byDay.map(([d, items]) => {
              const open = openDay === d;
              const per = ids.map((id) => ({ id, sum: items.filter((l) => l.branch_id === id).reduce((s, l) => s + l.net_amount, 0) }));
              return (
                <li key={d}>
                  <button type="button" aria-expanded={open} onClick={() => setOpenDay(open ? null : d)} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px]">{thaiDay(d)}</span>
                      {ids.length > 1 && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {per.map((p) => `${name.get(p.id)} ${p.sum ? baht(p.sum) : "ไม่มี"}`).join(" · ")}
                        </span>
                      )}
                    </span>
                    <span className="font-mono font-semibold">{baht(items.reduce((s, l) => s + l.net_amount, 0))}</span>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
                  </button>
                  {open && (
                    <ul className="divide-y divide-border border-t border-border bg-secondary/30">
                      {items.map((l) => {
                        const n = shortName(l.menu_name);
                        return (
                          <li key={l.id} className="flex items-center gap-3 px-4 py-2">
                            {selecting && <Checkbox checked={picked.has(l.id)} onCheckedChange={() => toggle(l.id)} aria-label={`เลือก ${n.base}`} className="h-5 w-5" />}
                            <div className="min-w-0 flex-1">
                              <div className="text-sm">{n.base}</div>
                              <div className="text-xs text-muted-foreground">
                                {ids.length > 1 && `${name.get(l.branch_id)} · `}
                                <span className="font-mono">{l.receipt_no}</span>
                                {n.options && ` · ${n.options}`}
                              </div>
                            </div>
                            <span className="font-mono text-sm">{baht(l.net_amount, 2)}</span>
                            {canEdit && !selecting && (
                              <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label={`แก้ ${n.base}`} onClick={() => setEditing(l)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <EditDialog
        line={editing}
        onClose={() => setEditing(null)}
        onSave={async (patch) => {
          if (!editing) return;
          if (await onUpdate(editing.id, patch)) {
            toast.success("แก้ไขแล้ว");
            setLines((ls) => ls.map((l) => (l.id === editing.id ? { ...l, ...patch } : l)));
            setEditing(null);
          }
        }}
        onDelete={() => editing && setConfirm({ ids: [editing.id], text: `ลบ ${shortName(editing.menu_name).base} (บิล ${editing.receipt_no}) ออกจากระบบ` })}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="ลบรายการขาย"
        description={confirm?.text ?? ""}
        confirmLabel="ลบ"
        cancelLabel="ยกเลิก"
        onConfirm={async () => {
          if (!confirm) return;
          if (await onDelete(confirm.ids)) {
            toast.success(`ลบ ${confirm.ids.length.toLocaleString()} รายการแล้ว`);
            setEditing(null);
            setSelecting(false);
            setReloadKey((k) => k + 1);
          }
          setConfirm(null);
        }}
      />
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card px-4 py-3">
      <div className="truncate text-sm text-muted-foreground">{label}</div>
      <div className="font-mono text-xl font-semibold">{value}</div>
      {sub && <div className={cn("truncate text-xs", warn ? "font-semibold text-warning" : "text-muted-foreground")}>{sub}</div>}
    </div>
  );
}
