import { useState, useMemo } from 'react';
import { Branch, EMPTY_BRANCH, BranchStatus } from '@/types/branch';
import { useBranchData } from '@/hooks/use-branch-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2, Search, Store } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  branchData: ReturnType<typeof useBranchData>;
}

export default function BranchesPage({ branchData }: Props) {
  const { branches, addBranch, updateBranch, deleteBranch } = branchData;
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState<Omit<Branch, 'id'>>(EMPTY_BRANCH);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const filtered = useMemo(() => {
    return branches.filter(b => {
      const matchSearch = b.branchName.toLowerCase().includes(search.toLowerCase()) ||
        b.brandName.toLowerCase().includes(search.toLowerCase()) ||
        b.location.toLowerCase().includes(search.toLowerCase());
      const matchStatus = filterStatus === 'all' || b.status === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [branches, search, filterStatus]);

  const handleAdd = () => { setEditing(null); setForm(EMPTY_BRANCH); setModalOpen(true); };
  const handleEdit = (b: Branch) => {
    setEditing(b);
    setForm({ branchName: b.branchName, brandName: b.brandName, location: b.location, status: b.status });
    setModalOpen(true);
  };

  const handleSubmit = () => {
    if (!form.branchName.trim() || !form.brandName.trim()) {
      toast.error('Branch Name and Brand Name are required');
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

  const handleDelete = (id: string) => {
    deleteBranch(id);
    toast.success('Branch deleted');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">Branches</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Manage branch and brand master data</p>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="w-4 h-4" /> Add Branch
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Branches</p>
          <p className="text-3xl font-heading font-bold mt-1">{branches.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active</p>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
              <Store className="w-4 h-4 text-primary" />
            </span>
          </div>
          <p className="text-3xl font-heading font-bold mt-1">{branches.filter(b => b.status === 'Active').length}</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Brands</p>
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
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="Active">Active</SelectItem>
            <SelectItem value="Inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Branch Name</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Brand</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Location</th>
              <th className="text-center px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => (
              <tr key={b.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium">{b.branchName}</td>
                <td className="px-4 py-3">{b.brandName}</td>
                <td className="px-4 py-3 text-muted-foreground">{b.location || '—'}</td>
                <td className="px-4 py-3 text-center">
                  <Badge variant={b.status === 'Active' ? 'default' : 'secondary'}>{b.status}</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(b)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(b.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">No branches found.</td></tr>
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
              <Input value={form.branchName} onChange={e => setForm(f => ({ ...f, branchName: e.target.value }))} />
            </div>
            <div>
              <Label>Brand Name *</Label>
              <Input value={form.brandName} onChange={e => setForm(f => ({ ...f, brandName: e.target.value }))} />
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
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit}>{editing ? 'Update' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
