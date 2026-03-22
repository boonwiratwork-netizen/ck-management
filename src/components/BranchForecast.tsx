import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pencil, X, Save } from 'lucide-react';
import { toast } from 'sonner';
import { toLocalDateStr } from '@/lib/utils';

interface Forecast {
  id: string;
  forecastValue: number;
  forecastUnit: string;
  expiresAt: string;
  createdAt: string;
  assumptionText: string | null;
}

interface Props {
  branchId: string;
  avgSellingPrice: number | null;
}

export function BranchForecast({ branchId, avgSellingPrice }: Props) {
  const { user } = useAuth();
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  // Form state
  const [formValue, setFormValue] = useState('');
  const [formUnit, setFormUnit] = useState<'bowls_per_day' | 'thb_per_day'>('bowls_per_day');
  const [formAvgPrice, setFormAvgPrice] = useState('');
  const [saving, setSaving] = useState(false);

  const today = toLocalDateStr(new Date());

  const fetchForecast = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('branch_forecasts')
      .select('*')
      .eq('branch_id', branchId)
      .gte('expires_at', today)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Failed to load forecast', error);
    } else if (data && data.length > 0) {
      const r = data[0];
      setForecast({
        id: r.id,
        forecastValue: r.forecast_value,
        forecastUnit: r.forecast_unit,
        expiresAt: r.expires_at,
        createdAt: r.created_at ?? '',
        assumptionText: r.assumption_text,
      });
    } else {
      setForecast(null);
    }
    setLoading(false);
  }, [branchId, today]);

  useEffect(() => { fetchForecast(); }, [fetchForecast]);

  const openEdit = () => {
    setFormValue(forecast ? String(forecast.forecastValue) : '');
    setFormUnit(forecast ? (forecast.forecastUnit as 'bowls_per_day' | 'thb_per_day') : 'bowls_per_day');
    setFormAvgPrice(avgSellingPrice ? String(avgSellingPrice) : '');
    setEditing(true);
  };

  const handleSave = async () => {
    const val = parseFloat(formValue);
    if (!val || val <= 0) {
      toast.error('กรุณาใส่ค่าพยากรณ์');
      return;
    }

    if (formUnit === 'thb_per_day') {
      const price = parseFloat(formAvgPrice);
      if (!price || price <= 0) {
        toast.error('กรุณาใส่ราคาขายเฉลี่ย');
        return;
      }
    }

    setSaving(true);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const { error: insertErr } = await supabase.from('branch_forecasts').insert({
      branch_id: branchId,
      forecast_value: val,
      forecast_unit: formUnit,
      expires_at: toLocalDateStr(expiresAt),
      created_by: user?.id ?? null,
    });

    if (insertErr) {
      toast.error('บันทึกไม่สำเร็จ: ' + insertErr.message);
      setSaving(false);
      return;
    }

    // Update avg_selling_price on branches table if thb_per_day
    if (formUnit === 'thb_per_day') {
      const price = parseFloat(formAvgPrice);
      if (price > 0) {
        await supabase.from('branches').update({ avg_selling_price: price }).eq('id', branchId);
      }
    }

    toast.success('บันทึกพยากรณ์แล้ว');
    setEditing(false);
    setSaving(false);
    fetchForecast();
  };

  const unitLabel = (u: string) => u === 'bowls_per_day' ? 'ชาม/วัน' : '฿/วัน';

  if (loading) {
    return <div className="text-xs text-muted-foreground py-2">กำลังโหลด...</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Forecast Settings</h4>
        {!editing && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={openEdit}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {!editing ? (
        <div className="text-sm space-y-0.5">
          {forecast ? (
            <>
              <p>
                <span className="font-mono font-medium">{forecast.forecastValue.toLocaleString()}</span>
                {' '}
                <span className="text-muted-foreground">{unitLabel(forecast.forecastUnit)}</span>
                <span className="text-muted-foreground ml-2">· หมดอายุ {forecast.expiresAt}</span>
              </p>
              {forecast.createdAt && (
                <p className="text-xs text-muted-foreground">
                  อัปเดตล่าสุด: {new Date(forecast.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-xs">
              ใช้ข้อมูลยอดขายจริง (7 วันล่าสุด)
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-md border bg-card p-3 space-y-3">
          {/* Forecast value */}
          <div className="space-y-1">
            <Label className="text-xs">ค่าพยากรณ์</Label>
            <Input
              type="number"
              min={0}
              value={formValue}
              onChange={e => setFormValue(e.target.value)}
              placeholder="เช่น 120"
              className="h-8"
            />
          </div>

          {/* Unit toggle */}
          <div className="space-y-1">
            <Label className="text-xs">หน่วย</Label>
            <div className="flex gap-1">
              {(['bowls_per_day', 'thb_per_day'] as const).map(u => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setFormUnit(u)}
                  className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                    formUnit === u
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-muted-foreground border-border hover:bg-muted'
                  }`}
                >
                  {unitLabel(u)}
                </button>
              ))}
            </div>
          </div>

          {/* Avg selling price — only for thb_per_day */}
          {formUnit === 'thb_per_day' && (
            <div className="space-y-1">
              <Label className="text-xs">ราคาขายเฉลี่ย/ชาม (฿)</Label>
              <Input
                type="number"
                min={0}
                value={formAvgPrice}
                onChange={e => setFormAvgPrice(e.target.value)}
                placeholder="เช่น 89"
                className="h-8"
              />
            </div>
          )}

          <p className="text-xs text-muted-foreground">ระยะเวลา: 7 วัน (หมดอายุอัตโนมัติ)</p>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={saving}>
              <Save className="w-3 h-3 mr-1" /> บันทึก
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)} disabled={saving}>
              <X className="w-3 h-3 mr-1" /> ยกเลิก
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
