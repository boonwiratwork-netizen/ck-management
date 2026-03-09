import { useEffect, useState } from 'react';
import { Supplier, EMPTY_SUPPLIER, SupplierStatus } from '@/types/supplier';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Check } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<Supplier, 'id'>) => void;
  editing?: Supplier | null;
}

export function SupplierFormModal({ open, onClose, onSubmit, editing }: Props) {
  const [form, setForm] = useState<Omit<Supplier, 'id'>>(EMPTY_SUPPLIER);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (editing) {
      const { id, ...rest } = editing;
      setForm(rest);
    } else {
      setForm(EMPTY_SUPPLIER);
    }
    setErrors({});
    setSaving(false);
    setSaved(false);
  }, [editing, open]);

  const handleBlur = (key: string) => {
    if (key === 'name' && !form.name.trim()) {
      setErrors(prev => ({ ...prev, name: 'Supplier Name is required' }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setErrors({ name: 'Supplier Name is required' });
      return;
    }
    setSaving(true);
    try {
      onSubmit(form);
      setSaved(true);
      setTimeout(() => {
        onClose();
        setSaved(false);
      }, 400);
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-xl">
        <DialogHeader className="border-b pb-4">
          <DialogTitle className="font-heading text-xl">
            {editing ? `Edit ${editing.name}` : 'Add New Supplier'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div>
            <Label className="label-required">Supplier Name</Label>
            <Input required value={form.name} onChange={e => update('name', e.target.value)} onBlur={() => handleBlur('name')} placeholder="Enter supplier name" className={errors.name ? 'input-error' : ''} />
            {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Lead Time (days)</Label>
              <Input type="number" min={0} value={form.leadTime} onChange={e => update('leadTime', Number(e.target.value))} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => update('status', v as SupplierStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>MOQ</Label>
              <Input type="number" min={0} value={form.moq} onChange={e => update('moq', Number(e.target.value))} />
            </div>
            <div>
              <Label>MOQ Unit</Label>
              <Input value={form.moqUnit} onChange={e => update('moqUnit', e.target.value)} placeholder="e.g. บาท, กล่อง" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Contact Person</Label>
              <Input value={form.contactPerson} onChange={e => update('contactPerson', e.target.value)} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => update('phone', e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Credit Terms</Label>
            <Input value={form.creditTerms} onChange={e => update('creditTerms', e.target.value)} placeholder="e.g. 30 วัน, COD" />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || !form.name.trim()}>
              {saving ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              ) : saved ? (
                <><Check className="w-4 h-4" /> Saved!</>
              ) : (
                editing ? 'Update Supplier' : 'Add Supplier'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
