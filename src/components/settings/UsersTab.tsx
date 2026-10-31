import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/hooks/use-auth";
import type { Branch } from "@/types/branch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Choices, EditSheet, Field } from "./EditSheet";

export interface ManagedUser {
  userId: string;
  fullName: string;
  email: string;
  role: AppRole;
  status: string;
  branchId: string | null;
  /** Area managers: the brands they look after (the database shows them only these) */
  brands: string[];
}

/** The admin edge function (list, create, role, status, password) */
export type CallAdmin = (body: Record<string, unknown>) => Promise<Record<string, unknown>>;

export const ROLES: { key: AppRole; label: string }[] = [
  { key: "management", label: "ผู้บริหาร" },
  { key: "ck_manager", label: "ครัวกลาง" },
  { key: "store_manager", label: "หัวหน้าสาขา" },
  { key: "area_manager", label: "Area" },
];
const roleLabel = (r: AppRole) => ROLES.find((x) => x.key === r)?.label ?? r;
const roleTone: Record<string, string> = {
  management: "bg-brand-soft text-brand-soft-foreground",
  ck_manager: "bg-warning-soft text-warning",
  store_manager: "bg-secondary text-foreground",
  area_manager: "bg-success-soft text-success",
};

const callAdminLive: CallAdmin = async (body) => {
  const { data, error } = await supabase.functions.invoke("admin-create-user", { body });
  if (error) {
    // A refusal from the function carries its own reason in the reply body
    const reply = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(reply?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
};

async function loadUsersLive(call: CallAdmin): Promise<ManagedUser[]> {
  const data = await call({ action: "list_users" });
  const { data: assigned, error } = await supabase.from("user_brand_assignments").select("user_id, brand");
  if (error) throw error;
  return ((data.users as Record<string, unknown>[]) || []).map((u) => ({
    userId: String(u.user_id),
    fullName: String(u.full_name ?? ""),
    email: String(u.email ?? ""),
    // Old role names from the first version
    role: (u.role === "admin" ? "management" : u.role === "branch_manager" ? "store_manager" : u.role) as AppRole,
    status: String(u.status ?? "Active"),
    branchId: (u.branch_id as string | null) ?? null,
    brands: (assigned ?? []).filter((a) => a.user_id === u.user_id).map((a) => a.brand as string),
  }));
}

interface Props {
  branches: Branch[];
  /** Dev harness only */
  demo?: { call: CallAdmin; load: () => Promise<ManagedUser[]>; save: (u: ManagedUser, before: ManagedUser | null) => Promise<void> };
}

/** What one user looks after, in words */
function scope(u: ManagedUser, branches: Branch[]) {
  if (u.role === "store_manager") return branches.find((b) => b.id === u.branchId)?.branchName ?? "ยังไม่ได้เลือกสาขา";
  // The database shows an area manager only the brands assigned to them
  if (u.role === "area_manager") return u.brands.length ? `แบรนด์ ${u.brands.join(", ")}` : "ยังไม่มีแบรนด์ · มองไม่เห็นข้อมูลสาขา";
  return "ทุกอย่าง";
}

/**
 * Users (management only). Changes are made in a sheet and saved with one button,
 * not straight from the list (the old page changed a role the moment it was
 * picked). No delete: an account is turned off, and what it did stays.
 */
export function UsersTab({ branches, demo }: Props) {
  const call = demo?.call ?? callAdminLive;
  const { user: me } = useAuth();
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | "new" | null>(null);
  const reload = useCallback(() => {
    setFailed(false);
    (demo?.load ?? (() => loadUsersLive(call)))()
      .then(setUsers)
      .catch(() => setFailed(true));
  }, [call, demo]);
  useEffect(reload, [reload]);
  const brands = useMemo(() => [...new Set(branches.map((b) => b.brandName).filter(Boolean))].sort(), [branches]);
  const sorted = useMemo(
    () => [...(users ?? [])].sort((a, b) => (a.status === b.status ? ROLES.findIndex((r) => r.key === a.role) - ROLES.findIndex((r) => r.key === b.role) || a.fullName.localeCompare(b.fullName) : a.status === "Active" ? -1 : 1)),
    [users],
  );

  // Name/branch and brands first, the role last: a write failing halfway leaves the
  // old role on rows that already fit the new one, never e.g. an area manager with
  // no brands (the database would show them nothing)
  const saveLive = async (u: ManagedUser, before: ManagedUser | null) => {
    const { error } = await supabase.from("profiles").update({ full_name: u.fullName, branch_id: u.role === "store_manager" ? u.branchId : null }).eq("user_id", u.userId);
    if (error) throw error;
    const had = [...(before?.brands ?? [])].sort();
    const want = u.role === "area_manager" ? [...u.brands].sort() : [];
    if (had.join() !== want.join()) {
      // Add the new ones before taking the old ones away: never a moment with none
      const add = want.filter((b) => !had.includes(b));
      if (add.length) {
        const ins = await supabase.from("user_brand_assignments").insert(add.map((brand) => ({ user_id: u.userId, brand })));
        if (ins.error) throw ins.error;
      }
      const drop = had.filter((b) => !want.includes(b));
      if (drop.length) {
        const del = await supabase.from("user_brand_assignments").delete().eq("user_id", u.userId).in("brand", drop);
        if (del.error) throw del.error;
      }
    }
    if (!before || u.role !== before.role) await call({ action: "update_role", user_id: u.userId, role: u.role });
  };

  const active = (users ?? []).filter((u) => u.status === "Active").length;
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 className="font-semibold">{users ? `ผู้ใช้ ${users.length} คน · ใช้อยู่ ${active}` : "ผู้ใช้"}</h2>
        <Button variant="brand" className="h-10" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> เพิ่มผู้ใช้
        </Button>
      </div>
      {failed ? (
        <p className="border-t border-border px-4 py-4 text-sm text-destructive">
          โหลดรายชื่อไม่สำเร็จ{" "}
          <button type="button" className="underline" onClick={reload}>
            ลองใหม่
          </button>
        </p>
      ) : !users ? (
        <div className="space-y-2 border-t border-border p-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-secondary" />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {sorted.map((u) => (
            <li key={u.userId}>
              <button type="button" onClick={() => setEditing(u)} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-secondary/50">
                <span className="min-w-0 flex-1">
                  <span className={cn("block font-medium", u.status !== "Active" && "text-muted-foreground")}>{u.fullName || u.email}</span>
                  <span className="block break-all text-sm text-muted-foreground">
                    {u.email} · {scope(u, branches)}
                  </span>
                </span>
                <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs", u.status === "Active" ? roleTone[u.role] : "bg-secondary text-muted-foreground")}>{u.status === "Active" ? roleLabel(u.role) : "ปิดใช้"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <UserSheet
          user={editing === "new" ? null : editing}
          self={editing !== "new" && editing.userId === me?.id}
          branches={branches.filter((b) => b.status === "Active")}
          brands={brands}
          call={call}
          save={demo?.save ?? saveLive}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </section>
  );
}

function UserSheet({ user, self, branches, brands: brandList, call, save, onClose, onDone }: { user: ManagedUser | null; self: boolean; branches: Branch[]; brands: string[]; call: CallAdmin; save: (u: ManagedUser, before: ManagedUser | null) => Promise<void>; onClose: () => void; onDone: () => void }) {
  // Brands this user already has stay pickable (and removable) even if no branch uses them now
  const brands = [...new Set([...brandList, ...(user?.brands ?? [])])].sort();
  const [d, setD] = useState<ManagedUser>(user ?? { userId: "", fullName: "", email: "", role: "store_manager", status: "Active", branchId: branches[0]?.id ?? null, brands: [] });
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [askOff, setAskOff] = useState(false);
  const problem = !d.fullName.trim()
    ? "ใส่ชื่อก่อน"
    : !user && !/^\S+@\S+\.\S+$/.test(d.email.trim())
      ? "อีเมลไม่ถูกรูปแบบ"
      : !user && password.length < 6
        ? "รหัสผ่านเริ่มต้นอย่างน้อย 6 ตัว"
        : d.role === "store_manager" && !d.branchId
          ? "หัวหน้าสาขาต้องเลือกสาขา"
          : d.role === "area_manager" && !brands.length
            ? "ยังไม่มีสาขาที่ตั้งแบรนด์ไว้ · ตั้งแบรนด์ให้สาขาก่อน"
            : null;

  // `stay`: the sheet stays open (setting a password keeps unsaved edits)
  const run = async (job: () => Promise<unknown>, done: string, stay = false) => {
    setBusy(true);
    try {
      await job();
      toast.success(done);
      if (!stay) onDone();
    } catch (e) {
      toast.error(`ไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    setTried(true);
    if (problem) return;
    // No brand picked = every brand, written out (as the old page did): the database
    // shows an area manager only the brands listed for them
    const u = { ...d, fullName: d.fullName.trim(), email: d.email.trim(), brands: d.role === "area_manager" && !d.brands.length ? brands : d.brands };
    if (user) return run(() => save(u, user), `บันทึก ${u.fullName} แล้ว`);
    return run(async () => {
      const res = await call({ action: "create", email: u.email, password, full_name: u.fullName, role: u.role, branch_id: u.role === "store_manager" ? u.branchId : null });
      if (u.role !== "area_manager") return;
      // The account exists now: from here a failure must not invite "add" again (the
      // email is taken). Close, reload, and say to open the account and save again.
      const id = (res.user as { id?: string } | undefined)?.id;
      try {
        if (!id) throw new Error("no id");
        await save({ ...u, userId: id }, { ...u, userId: id, brands: [] });
      } catch {
        onDone();
        throw new Error(`สร้างบัญชี ${u.fullName} แล้ว แต่ใส่แบรนด์ไม่สำเร็จ · เปิดบัญชีนี้แล้วกดบันทึกอีกครั้ง`);
      }
    }, `เพิ่ม ${u.fullName} แล้ว · ส่งอีเมลกับรหัสเริ่มต้นให้เขาเอง`);
  };

  return (
    <EditSheet
      title={user ? user.fullName || user.email : "เพิ่มผู้ใช้"}
      onClose={onClose}
      footer={
        <Button variant="brand" className="h-12 text-base" loading={busy} onClick={submit}>
          {user ? "บันทึก" : "เพิ่มผู้ใช้"}
        </Button>
      }
    >
      <Field label="ชื่อ">
        <Input value={d.fullName} onChange={(e) => setD({ ...d, fullName: e.target.value })} className="h-12 text-base" />
      </Field>
      {user ? (
        <Field label="อีเมล" hint="ใช้เข้าระบบ · แก้ไม่ได้">
          <Input value={d.email} disabled className="h-12 text-base" />
        </Field>
      ) : (
        <>
          <Field label="อีเมล" hint="ใช้เข้าระบบ">
            <Input type="email" inputMode="email" autoComplete="off" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} className="h-12 text-base" />
          </Field>
          <Field label="รหัสผ่านเริ่มต้น" hint="อย่างน้อย 6 ตัว · เข้าครั้งแรกแล้วให้เขาเปลี่ยนเอง">
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 text-base" />
          </Field>
        </>
      )}
      <Field label="ตำแหน่ง" hint={self ? "บัญชีของคุณเอง: เปลี่ยนตำแหน่งตัวเองไม่ได้ (กันล็อกตัวเองออก) · ให้ผู้บริหารคนอื่นเปลี่ยนให้" : undefined}>
        <Choices options={ROLES} picked={[d.role]} disabled={self} onPick={(r) => setD({ ...d, role: r })} />
      </Field>
      {d.role === "store_manager" && (
        <Field label="สาขา">
          <Choices options={branches.map((b) => ({ key: b.id, label: b.branchName }))} picked={d.branchId ? [d.branchId] : []} onPick={(id) => setD({ ...d, branchId: id })} />
        </Field>
      )}
      {d.role === "area_manager" && (
        <Field label="แบรนด์ที่ดูแล" hint="ไม่เลือก = ใส่ให้ทุกแบรนด์">
          <Choices options={brands.map((b) => ({ key: b, label: b }))} picked={d.brands} onPick={(b) => setD({ ...d, brands: d.brands.includes(b) ? d.brands.filter((x) => x !== b) : [...d.brands, b].sort() })} />
        </Field>
      )}
      {tried && problem && <p className="text-sm text-destructive">{problem}</p>}

      {user && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {newPassword === null ? (
            <Button variant="outline" className="h-11 justify-start" onClick={() => setNewPassword("")}>
              ตั้งรหัสผ่านใหม่ให้…
            </Button>
          ) : (
            <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 6 ตัว · บอกเขาเองแล้วให้เปลี่ยนหลังเข้าระบบ">
              <div className="flex gap-2">
                <Input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="h-12 flex-1 text-base" />
                <Button variant="outline" className="h-12" disabled={newPassword.length < 6 || busy} onClick={() =>
                    run(() => call({ action: "reset_password", user_id: user.userId, new_password: newPassword }), "ตั้งรหัสผ่านใหม่แล้ว", true).then(() => setNewPassword(null))
                  }>
                  ตั้งรหัส
                </Button>
              </div>
            </Field>
          )}
          {/* Turning your own account off would lock you out */}
          {!self && (
            <Button variant="ghost" className={cn("h-11 justify-start", user.status === "Active" ? "text-destructive" : "text-success")} disabled={busy} onClick={() => setAskOff(true)}>
              {user.status === "Active" ? "ปิดใช้บัญชีนี้" : "เปิดใช้บัญชีนี้อีกครั้ง"}
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={askOff}
        onOpenChange={setAskOff}
        title={user?.status === "Active" ? "ปิดใช้บัญชีนี้?" : "เปิดใช้อีกครั้ง?"}
        description={user?.status === "Active" ? `${user?.fullName} จะเข้าระบบไม่ได้ · ข้อมูลที่เขาทำไว้อยู่ครบ เปิดคืนได้ทีหลัง` : `${user?.fullName ?? ""} จะเข้าระบบได้อีกครั้ง`}
        confirmLabel={user?.status === "Active" ? "ปิดใช้" : "เปิดใช้"}
        cancelLabel="ไม่ใช่"
        variant={user?.status === "Active" ? "destructive" : "default"}
        onConfirm={() => {
          setAskOff(false);
          if (user) run(() => call({ action: "update_status", user_id: user.userId, status: user.status === "Active" ? "Inactive" : "Active" }), user.status === "Active" ? "ปิดใช้แล้ว" : "เปิดใช้แล้ว");
        }}
      />
    </EditSheet>
  );
}
