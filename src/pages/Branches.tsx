import { useState, useMemo, Fragment } from 'react';
import { Branch, EMPTY_BRANCH, BranchStatus } from '@/types/branch';
import { useBranchData } from '@/hooks/use-branch-data';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2, Search, Store, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/hooks/use-language';
import { BranchMenuAvailability } from '@/components/BranchMenuAvailability';

interface Props {
  branchData: ReturnType<typeof useBranchData>;
  readOnly?: boolean;
}

export default function BranchesPage({ branchData, readOnly = false }: Props) {
  const { branches, addBranch, updateBranch, deleteBranch } = branchData;
  const { t } = useLanguage();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState<Omit<Branch, 'id'>>(EMPTY_BRANCH);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [expandedBranchId, setExpandedBranchId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return branches.filter(b => {
      const matchSearch = b.branchName.toLowerCase().includes(search.toLowerCase()) ||
        b.brandName.toLowerCase().includes(search.toLowerCase()) ||
        b.location.toLowerCase().includes(search.toLowerCase());
      const matchStatus = filterStatus === 'all' || b.status === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [branches, search, filterStatus]);

  const handleAdd = () => { setEditing(null); setForm(EMPTY_BRANCH); setErrors({}); setModalOpen(true); };
  const handleEdit = (b: Branch) => {
    setEditing(b);
    setForm({ branchName: b.branchName, brandName: b.brandName, location: b.location, status: b.status });
    setErrors({});
    setModalOpen(true);
  };

  const handleSubmit = () => {
    const errs: Record<string, string> = {};
    if (!form.branchName.trim()) errs.branchName = 'Branch Name is required';
    if (!form.brandName.trim()) errs.brandName = 'Brand Name is required';
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error('Please fill in all required fields');
      return;
    }
    if (editing) {
      updateBranch(editing.id, form);
      toast.success('Branch updated');
    } else {
      addBranch(form);
      toast.success('Branch added');
    }
    setModalOpen(false);
  };

  const handleDeleteRequest = (id: string) => {
    const b = branches.find(x => x.id === id);
    setDeleteConfirm({ id, name: b?.branchName || 'this branch' });
  };
  const handleDeleteConfirm = () => {
    if (deleteConfirm) {
      deleteBranch(deleteConfirm.id);
      toast.success(`Branch "${deleteConfirm.name}" deleted`);
      setDeleteConfirm(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">{t('title.branches')}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Manage branch and brand master data</p>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="w-4 h-4" /> {t('btn.addBranch')}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('summary.totalBranches')}</p>
          <p className="text-3xl font-heading font-bold mt-1">{branches.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('status.active')}</p>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
              <Store className="w-4 h-4 text-primary" />
            </span>
          </div>
          <p className="text-3xl font-heading font-bold mt-1">{branches.filter(b => b.status === 'Active').length}</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('summary.brands')}</p>
          <p className="text-3xl font-heading font-bold mt-1">{new Set(branches.map(b => b.brandName)).size}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search branches..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.allStatus')}</SelectItem>
            <SelectItem value="Active">{t('status.active')}</SelectItem>
            <SelectItem value="Inactive">{t('status.inactive')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('col.name')}</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('col.brand')}</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('col.location')}</th>
              <th className="text-center px-4 py-3 font-medium text-muted-foreground">{t('col.status')}</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">{t('col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => (
              <Fragment key={b.id}>
                <tr className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${!readOnly ? 'cursor-pointer' : ''}`}
                    onClick={() => !readOnly && setExpandedBranchId(prev => prev === b.id ? null : b.id)}>
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      {!readOnly && (
                        expandedBranchId === b.id
                          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      )}
                      {b.branchName}
                    </div>
                  </td>
                  <td className="px-4 py-3">{b.brandName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{b.location || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={b.status === 'Active' ? 'default' : 'secondary'}>{b.status === 'Active' ? t('status.active') : t('status.inactive')}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(b)}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteRequest(b.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </td>
                </tr>
                {!readOnly && expandedBranchId === b.id && (
                  <tr key={`${b.id}-menu`}>
                    <td colSpan={5} className="px-4 py-4 bg-muted/20 border-b">
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold">Menu Availability</h4>
                        <BranchMenuAvailability branchId={b.id} brandName={b.brandName} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                  <Store className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  {branches.length === 0
                    ? 'No branches yet. Click "Add Branch" to create your first branch.'
                    : 'No branches match your filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Branch' : 'Add Branch'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Branch Name *</Label>
              <Input value={form.branchName} onChange={e => { setForm(f => ({ ...f, branchName: e.target.value })); if (errors.branchName) setErrors(e => { const n = {...e}; delete n.branchName; return n; }); }} className={errors.branchName ? 'border-destructive' : ''} />
              {errors.branchName && <p className="text-xs text-destructive mt-1">{errors.branchName}</p>}
            </div>
            <div>
              <Label>Brand Name *</Label>
              <Input value={form.brandName} onChange={e => { setForm(f => ({ ...f, brandName: e.target.value })); if (errors.brandName) setErrors(e => { const n = {...e}; delete n.brandName; return n; }); }} className={errors.brandName ? 'border-destructive' : ''} />
              {errors.brandName && <p className="text-xs text-destructive mt-1">{errors.brandName}</p>}
            </div>
            <div>
              <Label>Location</Label>
              <Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as BranchStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>{t('btn.cancel')}</Button>
            <Button onClick={handleSubmit}>{editing ? t('btn.update') : t('btn.add')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={open => !open && setDeleteConfirm(null)}
        title="Delete Branch"
        description={`Are you sure you want to delete "${deleteConfirm?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
