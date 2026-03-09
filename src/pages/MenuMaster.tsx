import { useState, useMemo } from 'react';
import { Menu, EMPTY_MENU } from '@/types/menu';
import { Branch } from '@/types/branch';
import { useAuth } from '@/hooks/use-auth';
import { useMenuCategories } from '@/hooks/use-menu-categories';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Plus, Edit2, Trash2, Search, UtensilsCrossed, X } from 'lucide-react';
import { toast } from 'sonner';

interface MenuMasterPageProps {
  menuData: {
    menus: Menu[];
    loading: boolean;
    getNextCode: () => string;
    addMenu: (data: Omit<Menu, 'id'>) => Promise<void>;
    updateMenu: (id: string, data: Partial<Omit<Menu, 'id'>>) => Promise<void>;
    deleteMenu: (id: string) => Promise<void>;
  };
  branches: Branch[];
}

export default function MenuMasterPage({ menuData, branches }: MenuMasterPageProps) {
  const { menus, loading, getNextCode, addMenu, updateMenu, deleteMenu } = menuData;
  const { isManagement, isStoreManager, profile } = useAuth();
  const { categories, addCategory, deleteCategory } = useMenuCategories();

  const [newCatInput, setNewCatInput] = useState('');
  const [showAddCat, setShowAddCat] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Menu | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterBranch, setFilterBranch] = useState<string>('all');

  // Form state
  const [form, setForm] = useState<Omit<Menu, 'id'>>(EMPTY_MENU);

  // Branch manager sees only their branch
  const visibleMenus = useMemo(() => {
    let result = menus;
    if (isStoreManager && profile?.branch_id) {
      result = result.filter(m => m.branchId === profile.branch_id);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(m => m.menuCode.toLowerCase().includes(q) || m.menuName.toLowerCase().includes(q));
    }
    if (filterCategory !== 'all') result = result.filter(m => m.category === filterCategory);
    if (filterStatus !== 'all') result = result.filter(m => m.status === filterStatus);
    if (filterBranch !== 'all') result = result.filter(m => m.branchId === filterBranch);
    return result;
  }, [menus, isStoreManager, profile, search, filterCategory, filterStatus, filterBranch]);

  // Summary
  const total = visibleMenus.length;
  const activeCount = visibleMenus.filter(m => m.status === 'Active').length;
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    visibleMenus.forEach(m => { counts[m.category] = (counts[m.category] || 0) + 1; });
    return counts;
  }, [visibleMenus]);

  const categoryNames = useMemo(() => categories.map(c => c.name), [categories]);

  const uniqueCategories = useMemo(() => {
    const cats = new Set(menus.map(m => m.category).filter(Boolean));
    categories.forEach(c => cats.add(c.name));
    return Array.from(cats).sort();
  }, [menus, categories]);

  const handleAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY_MENU, menuCode: getNextCode() });
    setModalOpen(true);
  };

  const handleEdit = (menu: Menu) => {
    setEditing(menu);
    setForm({
      menuCode: menu.menuCode,
      menuName: menu.menuName,
      category: menu.category,
      sellingPrice: menu.sellingPrice,
      status: menu.status,
      branchId: menu.branchId,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.menuCode || !form.menuName) {
      toast.error('Menu code and name are required');
      return;
    }
    if (editing) {
      await updateMenu(editing.id, form);
      toast.success('Menu updated');
    } else {
      await addMenu(form);
      toast.success('Menu added');
    }
    setModalOpen(false);
  };

  const handleDeleteConfirm = async () => {
    if (deleteConfirm) {
      await deleteMenu(deleteConfirm.id);
      toast.success(`Menu "${deleteConfirm.name}" deleted`);
      setDeleteConfirm(null);
    }
  };

  const getBranchName = (branchId: string | null) => {
    if (!branchId) return '—';
    return branches.find(b => b.id === branchId)?.branchName || '—';
  };

  const canEdit = isManagement;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">Menu Master</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Manage menus across branches</p>
        </div>
        {canEdit && (
          <Button onClick={handleAdd}>
            <Plus className="w-4 h-4" /> Add Menu
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Menus</p>
          <p className="text-3xl font-heading font-bold mt-1">{total}</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active</p>
          <p className="text-3xl font-heading font-bold mt-1 text-primary">{activeCount}</p>
        </div>
        {Object.entries(categoryCounts).slice(0, 2).map(([cat, count]) => (
          <div key={cat} className="rounded-lg border bg-card p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">{cat}</p>
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-accent">
                <UtensilsCrossed className="w-4 h-4 text-accent-foreground" />
              </span>
            </div>
            <p className="text-3xl font-heading font-bold mt-1">{count}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by code or name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {uniqueCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="Active">Active</SelectItem>
            <SelectItem value="Inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        {isManagement && (
          <Select value={filterBranch} onValueChange={setFilterBranch}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Branch" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.branchName}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[100px]">Code</TableHead>
              <TableHead>Menu Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Selling Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Branch</TableHead>
              {canEdit && <TableHead className="w-[100px] text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={canEdit ? 7 : 6} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : visibleMenus.length === 0 ? (
              <TableRow><TableCell colSpan={canEdit ? 7 : 6} className="text-center py-8 text-muted-foreground">No menus found</TableCell></TableRow>
            ) : (
              visibleMenus.map(menu => (
                <TableRow key={menu.id}>
                  <TableCell className="font-mono text-xs">{menu.menuCode}</TableCell>
                  <TableCell className="font-medium">{menu.menuName}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">{menu.category || '—'}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {menu.sellingPrice.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell>
                    <Badge variant={menu.status === 'Active' ? 'default' : 'outline'} className="text-xs">
                      {menu.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{getBranchName(menu.branchId)}</TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(menu)}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteConfirm({ id: menu.id, name: menu.menuName || menu.menuCode })}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Menu' : 'Add Menu'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Menu Code</label>
              <Input value={form.menuCode} onChange={e => setForm(f => ({ ...f, menuCode: e.target.value }))} placeholder="MN-001" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Menu Name</label>
              <Input value={form.menuName} onChange={e => setForm(f => ({ ...f, menuName: e.target.value }))} placeholder="ชิโอะ ราเมน" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Category</label>
              <Select value={form.category || '__none'} onValueChange={v => setForm(f => ({ ...f, category: v === '__none' ? '' : v }))}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— Select —</SelectItem>
                  {categoryNames.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  {isManagement && (
                    <>
                      <Separator className="my-1" />
                      {showAddCat ? (
                        <div className="flex items-center gap-1 px-2 py-1.5" onKeyDown={e => e.stopPropagation()}>
                          <Input
                            value={newCatInput}
                            onChange={e => setNewCatInput(e.target.value)}
                            placeholder="New category"
                            className="h-7 text-xs"
                            autoFocus
                            onKeyDown={async e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                await addCategory(newCatInput);
                                setNewCatInput('');
                                setShowAddCat(false);
                              }
                            }}
                          />
                          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => { setShowAddCat(false); setNewCatInput(''); }}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-xs text-primary hover:bg-accent cursor-pointer"
                          onClick={(e) => { e.preventDefault(); setShowAddCat(true); }}
                        >
                          <Plus className="w-3 h-3" /> Add Category
                        </button>
                      )}
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Selling Price (ex-VAT)</label>
              <Input type="number" value={form.sellingPrice || ''} onChange={e => setForm(f => ({ ...f, sellingPrice: Number(e.target.value) || 0 }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as 'Active' | 'Inactive' }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Branch</label>
              <Select value={form.branchId || '__none'} onValueChange={v => setForm(f => ({ ...f, branchId: v === '__none' ? null : v }))}>
                <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— No branch —</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.branchName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit}>{editing ? 'Save' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={open => !open && setDeleteConfirm(null)}
        title="Delete Menu"
        description={`Are you sure you want to delete "${deleteConfirm?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
