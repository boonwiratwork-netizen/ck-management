import { useState, useMemo } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { SkuCategory, useSkuCategories } from '@/hooks/use-sku-categories';
import { SKU } from '@/types/sku';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Pencil, Trash2, Save, X, Tags } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';

interface Props {
  categoryData: ReturnType<typeof useSkuCategories>;
  skus: SKU[];
  readOnly?: boolean;
}

export default function SkuCategoriesPage({ categoryData, skus, readOnly = false }: Props) {
  const { categories, addCategory, updateCategory, deleteCategory } = categoryData;
  const { t } = useLanguage();
  const [adding, setAdding] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newEn, setNewEn] = useState('');
  const [newTh, setNewTh] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEn, setEditEn] = useState('');
  const [editTh, setEditTh] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; code: string } | null>(null);

  const skuCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    skus.forEach(s => { map[s.category] = (map[s.category] || 0) + 1; });
    return map;
  }, [skus]);

  const handleAdd = async () => {
    const result = await addCategory(newCode, newEn, newTh);
    if (result) {
      toast.success(`Category "${result.code}" added`);
      setAdding(false);
      setNewCode('');
      setNewEn('');
      setNewTh('');
    }
  };

  const handleUpdate = async (id: string) => {
    await updateCategory(id, editEn, editTh);
    toast.success('Category updated');
    setEditingId(null);
  };

  const startEdit = (cat: SkuCategory) => {
    setEditingId(cat.id);
    setEditEn(cat.nameEn);
    setEditTh(cat.nameTh);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">{t('title.skuCategories')}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Manage ingredient categories for SKU classification</p>
        </div>
        {!readOnly && (
          <Button onClick={() => setAdding(true)} disabled={adding}>
            <Plus className="w-4 h-4" /> {t('btn.addCategory')}
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Code</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name (EN)</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name (TH)</th>
              <th className="text-center px-4 py-3 font-medium text-muted-foreground">SKU Count</th>
              {!readOnly && <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {adding && (
              <tr className="border-b bg-primary/5">
                <td className="px-4 py-2">
                  <Input value={newCode} onChange={e => setNewCode(e.target.value.toUpperCase())} placeholder="e.g. BV" className="h-8 w-20 font-mono" maxLength={4} />
                </td>
                <td className="px-4 py-2">
                  <Input value={newEn} onChange={e => setNewEn(e.target.value)} placeholder="English name" className="h-8" />
                </td>
                <td className="px-4 py-2">
                  <Input value={newTh} onChange={e => setNewTh(e.target.value)} placeholder="ชื่อภาษาไทย" className="h-8" />
                </td>
                <td className="px-4 py-2 text-center text-muted-foreground">—</td>
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setAdding(false)}><X className="w-4 h-4" /></Button>
                    <Button size="sm" onClick={handleAdd} disabled={!newCode.trim() || !newEn.trim()}><Save className="w-4 h-4" /></Button>
                  </div>
                </td>
              </tr>
            )}
            {categories.length === 0 ? (
              <tr><td colSpan={5} className="px-4"><EmptyState icon={Tags} title="No categories" description="Add your first SKU category" /></td></tr>
            ) : categories.map((cat, idx) => {
              const count = skuCountMap[cat.code] || 0;
              const isEditing = editingId === cat.id;
              return (
                <tr key={cat.id} className={`border-b last:border-0 ${idx % 2 === 1 ? 'bg-muted/10' : ''}`}>
                  <td className="px-4 py-3 font-mono font-semibold text-xs">{cat.code}</td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <Input value={editEn} onChange={e => setEditEn(e.target.value)} className="h-8" />
                    ) : cat.nameEn}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <Input value={editTh} onChange={e => setEditTh(e.target.value)} className="h-8" />
                    ) : cat.nameTh}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${count > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      {count}
                    </span>
                  </td>
                  {!readOnly && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isEditing ? (
                          <>
                            <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}><X className="w-3.5 h-3.5" /></Button>
                            <Button size="icon" variant="ghost" onClick={() => handleUpdate(cat.id)}><Save className="w-3.5 h-3.5" /></Button>
                          </>
                        ) : (
                          <>
                            <Button size="icon" variant="ghost" onClick={() => startEdit(cat)}><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button size="icon" variant="ghost" disabled={count > 0} onClick={() => setDeleteConfirm({ id: cat.id, code: cat.code })}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={o => !o && setDeleteConfirm(null)}
        title="Delete Category"
        description={`Delete category "${deleteConfirm?.code}"? Only possible when no SKUs use it.`}
        confirmLabel="Delete"
        onConfirm={() => { if (deleteConfirm) { deleteCategory(deleteConfirm.id); setDeleteConfirm(null); } }}
      />
    </div>
  );
}
