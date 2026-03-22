import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { StatusDot, StatusDotStatus } from '@/components/ui/status-dot';
import { Badge } from '@/components/ui/badge';
import { X, AlertTriangle, Sparkles, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlanningBranch, PlanSuggestion, MenuInfo } from '@/hooks/use-planning-agent';
import { supabase } from '@/integrations/supabase/client';
import { toLocalDateStr } from '@/lib/utils';

interface PlanningAgentPanelProps {
  open: boolean;
  onClose: () => void;
  branches: PlanningBranch[];
  suggestions: PlanSuggestion[];
  menusByBrand: Record<string, MenuInfo[]>;
  menuBomByMenuId: Record<string, Array<{ skuId: string; effectiveQty: number }>>;
  isLoading: boolean;
  weekStart: string;
  onRecalculate: (overrides: Record<string, number>) => void;
  onApplyPlan: (planBatches: Record<string, number>) => void;
  onRefetch: () => void;
}

function getWeekRange(ws: string): string {
  const start = new Date(ws);
  const end = new Date(ws);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

function getBatchColor(batches: number): StatusDotStatus {
  if (batches === 0) return 'green';
  if (batches <= 3) return 'amber';
  return 'red';
}

// ─── Manual Assumption Inline ────────────────────────────────────────────

function ManualAssumptionInline({
  branch,
  menus,
  menuBomByMenuId,
  onSaved,
}: {
  branch: PlanningBranch;
  menus: MenuInfo[];
  menuBomByMenuId: Record<string, Array<{ skuId: string; effectiveQty: number }>>;
  onSaved: () => void;
}) {
  const bowlsRef = useRef<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recalcTotal = useCallback(() => {
    const sum = Object.values(bowlsRef.current).reduce((a, b) => a + b, 0);
    setTotal(sum);
  }, []);

  const handleBlur = useCallback((menuId: string, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num) && num >= 0) {
      bowlsRef.current[menuId] = num;
    } else {
      bowlsRef.current[menuId] = 0;
    }
    recalcTotal();
  }, [recalcTotal]);

  const handleSave = useCallback(async () => {
    if (total <= 0) return;
    setSaving(true);
    setError(null);

    try {
      // Calculate assumption_mix: grams_per_bowl per SM SKU
      const totalSmGrams = new Map<string, number>();
      let totalBowls = 0;

      for (const [menuId, bowls] of Object.entries(bowlsRef.current)) {
        if (bowls <= 0) continue;
        totalBowls += bowls;
        const ingredients = menuBomByMenuId[menuId];
        if (!ingredients) continue;
        for (const ing of ingredients) {
          totalSmGrams.set(ing.skuId, (totalSmGrams.get(ing.skuId) ?? 0) + bowls * ing.effectiveQty);
        }
      }

      const assumptionMix: Record<string, number> = {};
      if (totalBowls > 0) {
        for (const [skuId, grams] of totalSmGrams) {
          assumptionMix[skuId] = Math.round((grams / totalBowls) * 1000) / 1000;
        }
      }

      const { data: { user } } = await supabase.auth.getUser();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const forecastPayload = {
        branch_id: branch.branchId,
        forecast_value: total,
        forecast_unit: 'bowls_per_day',
        assumption_mix: assumptionMix,
        assumption_text: null,
        expires_at: toLocalDateStr(expiresAt),
        created_by: user?.id ?? null,
      };

      // Find-then-update-or-insert pattern
      const { data: existing, error: findErr } = await supabase
        .from('branch_forecasts')
        .select('id')
        .eq('branch_id', branch.branchId)
        .maybeSingle();

      if (findErr) throw findErr;

      if (existing) {
        const { error: updateErr } = await supabase
          .from('branch_forecasts')
          .update(forecastPayload)
          .eq('id', existing.id);
        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase
          .from('branch_forecasts')
          .insert(forecastPayload);
        if (insertErr) throw insertErr;
      }

      onSaved();
    } catch {
      setError('บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }, [total, menuBomByMenuId, branch.branchId, onSaved]);

  const noMenus = menus.length === 0;

  return (
    <div className="mt-1.5 rounded-md border border-dashed border-muted-foreground/30 px-2.5 py-2 space-y-2 bg-muted/20">
      {noMenus ? (
        <p className="text-[10px] text-muted-foreground text-center py-2">ไม่พบเมนูสำหรับแบรนด์นี้</p>
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {menus.map(m => (
            <div key={m.menuId} className="flex items-center gap-2">
              <span className="text-[11px] truncate flex-1" title={`${m.menuCode} ${m.menuName}`}>
                {m.menuName}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                defaultValue={0}
                onBlur={(e) => handleBlur(m.menuId, e.target.value)}
                className="w-16 h-6 text-[11px] font-mono text-right rounded border border-input px-1.5 bg-background focus:border-ring focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-[10px] text-muted-foreground w-12 shrink-0">ชาม/วัน</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-muted-foreground/20 pt-1.5">
        <span className="text-[11px] font-medium">รวม {total} ชาม/วัน</span>
      </div>

      {error && <p className="text-[10px] text-destructive">{error}</p>}

      <Button
        size="sm"
        className="h-7 text-xs w-full bg-success hover:bg-success/90 text-success-foreground"
        onClick={handleSave}
        disabled={saving || noMenus || total <= 0}
      >
        {saving ? 'กำลังบันทึก...' : 'บันทึก'}
      </Button>
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────

export function PlanningAgentPanel({
  open,
  onClose,
  branches,
  suggestions,
  menusByBrand,
  menuBomByMenuId,
  isLoading,
  weekStart,
  onRecalculate,
  onApplyPlan,
  onRefetch,
}: PlanningAgentPanelProps) {
  const [bowlsOverrides, setBowlsOverrides] = useState<Record<string, number>>({});
  const [calculated, setCalculated] = useState(false);
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null);

  const handleCalculate = useCallback(() => {
    onRecalculate(bowlsOverrides);
    setCalculated(true);
  }, [bowlsOverrides, onRecalculate]);

  const handleApply = useCallback(() => {
    const plan: Record<string, number> = {};
    for (const s of suggestions) {
      if (s.suggestedBatches > 0) {
        plan[s.skuId] = s.suggestedBatches;
      }
    }
    onApplyPlan(plan);
    onClose();
  }, [suggestions, onApplyPlan, onClose]);

  const handleBowlsBlur = useCallback((branchId: string, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num) && num >= 0) {
      setBowlsOverrides(prev => ({ ...prev, [branchId]: num }));
      setCalculated(false);
    }
  }, []);

  const handleAssumptionSaved = useCallback(() => {
    setExpandedBranch(null);
    onRefetch();
  }, [onRefetch]);

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-[60] bg-black/30"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-[70] w-[420px] max-w-full bg-background border-l shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">ผู้ช่วยวางแผนการผลิต</h2>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              อาทิตย์หน้า · {getWeekRange(weekStart)}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Section 1: Branch forecasts */}
          <div className="px-4 py-3">
            <h3 className="text-sm font-semibold mb-2">ยอดขายต่อสาขา</h3>
            <div className="space-y-1.5">
              {branches.map(br => {
                const showAssumptionLink =
                  !br.hasSalesHistory &&
                  br.forecastSource !== 'assumption' &&
                  br.forecastSource !== 'forecast' &&
                  !br.misconfigured;
                const showEditLink =
                  br.forecastSource === 'assumption' && !br.misconfigured;
                const isExpanded = expandedBranch === br.branchId;

                return (
                  <div key={br.branchId}>
                    <div
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 border',
                        br.misconfigured ? 'opacity-50 bg-muted/30' : 'bg-background',
                      )}
                    >
                      {br.misconfigured && (
                        <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                      )}
                      <span className="text-xs font-medium truncate flex-1" title={br.branchName}>
                        {br.branchName}
                      </span>

                      {showAssumptionLink ? (
                        <button
                          onClick={() => setExpandedBranch(isExpanded ? null : br.branchId)}
                          className="text-[10px] text-primary hover:underline shrink-0"
                        >
                          ตั้งสมมติฐาน
                        </button>
                      ) : (
                        <>
                          <input
                            type="number"
                            inputMode="decimal"
                            defaultValue={bowlsOverrides[br.branchId] ?? br.bowlsPerDay}
                            key={`${br.branchId}-${br.bowlsPerDay}`}
                            onBlur={(e) => handleBowlsBlur(br.branchId, e.target.value)}
                            disabled={br.misconfigured}
                            className="w-16 h-7 text-xs font-mono text-right rounded border border-input px-1.5 bg-background focus:border-ring focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <span className="text-[10px] text-muted-foreground w-12 shrink-0">ชาม/วัน</span>
                        </>
                      )}

                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] px-1.5 py-0 h-5 shrink-0',
                          br.forecastSource === 'forecast' && 'border-primary/40 text-primary',
                          br.forecastSource === 'historical' && 'border-muted-foreground/30 text-muted-foreground',
                          br.forecastSource === 'assumption' && 'border-warning/40 text-warning',
                        )}
                      >
                        {br.forecastSource === 'forecast' && 'กำหนดเอง'}
                        {br.forecastSource === 'historical' && 'เฉลี่ย 7 วัน'}
                        {br.forecastSource === 'assumption' && 'สมมติฐาน'}
                      </Badge>

                      {showEditLink && (
                        <button
                          onClick={() => setExpandedBranch(isExpanded ? null : br.branchId)}
                          className="text-muted-foreground hover:text-foreground shrink-0"
                          title="แก้ไขสมมติฐาน"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Inline manual assumption form */}
                    {isExpanded && (
                      <ManualAssumptionInline
                        branch={br}
                        menus={menusByBrand[br.brandName] ?? []}
                        menuBomByMenuId={menuBomByMenuId}
                        onSaved={handleAssumptionSaved}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 2: Suggestions (after calculate) */}
          {calculated && (
            <div className="px-4 py-3 border-t">
              <h3 className="text-sm font-semibold mb-2">แผนการผลิตที่แนะนำ</h3>
              {suggestions.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  สต็อกเพียงพอสำหรับสัปดาห์หน้า
                </p>
              ) : (
                <div className="space-y-1">
                  {suggestions.map(s => (
                    <div
                      key={s.skuId}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 border bg-background"
                    >
                      <StatusDot status={getBatchColor(s.suggestedBatches)} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-muted-foreground">{s.skuCode}</div>
                        <div className="text-xs truncate" title={s.skuName}>{s.skuName}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-mono font-semibold">
                          {s.suggestedBatches}
                          <span className="text-[10px] text-muted-foreground ml-0.5">แบทช์</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          ต้องการ {(s.weeklyDemandG / 1000).toFixed(1)} kg · มี {(s.currentStockG / 1000).toFixed(1)} kg
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t space-y-2 bg-background">
          <Button
            className="w-full"
            onClick={handleCalculate}
            disabled={isLoading}
          >
            {isLoading ? 'กำลังคำนวณ...' : 'คำนวณ'}
          </Button>

          {calculated && suggestions.length > 0 && (
            <Button
              className="w-full bg-success hover:bg-success/90 text-success-foreground"
              onClick={handleApply}
            >
              ใช้แผนนี้
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
