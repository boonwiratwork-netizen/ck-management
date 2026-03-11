import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';

interface Props {
  open: boolean;
  onClose: () => void;
  skuName: string;
  skuId: string;
  usageUom: string;
  currentStock: number;
  onSubmit: (data: { skuId: string; date: string; quantity: number; reason: string }) => void;
}

export function StockAdjustmentModal({ open, onClose, skuName, skuId, usageUom, currentStock, onSubmit }: Props) {
  const [adjustType, setAdjustType] = useState<'add' | 'subtract'>('add');
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const handleSubmit = () => {
    if (quantity <= 0 || !reason.trim()) return;
    onSubmit({
      skuId,
      date,
      quantity: adjustType === 'subtract' ? -quantity : quantity,
      reason: reason.trim(),
    });
    setQuantity(0);
    setReason('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust Stock — {skuName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Current stock: <span className="font-semibold text-foreground">{currentStock.toLocaleString()} {usageUom}</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={adjustType} onValueChange={v => setAdjustType(v as 'add' | 'subtract')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">+ Add</SelectItem>
                  <SelectItem value="subtract">− Subtract</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DatePicker
              value={date ? new Date(date + 'T00:00:00') : undefined}
              onChange={d => setDate(d ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10))}
              defaultToday
              label="Date"
              required
              labelPosition="above"
              align="start"
            />
          </div>
          <div>
            <Label>Quantity ({usageUom})</Label>
            <Input
              type="number"
              min={0}
              value={quantity || ''}
              onChange={e => setQuantity(Number(e.target.value))}
              placeholder={`Amount in ${usageUom}`}
            />
          </div>
          <div>
            <Label>Reason</Label>
            <Input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g., Physical count correction, Wastage, Donation"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={quantity <= 0 || !reason.trim()}>
            Confirm Adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
