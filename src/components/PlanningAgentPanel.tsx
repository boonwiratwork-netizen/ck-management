import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { StatusDot, StatusDotStatus } from '@/components/ui/status-dot';
import { Badge } from '@/components/ui/badge';
import { X, AlertTriangle, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { table as tableTokens, inputs, spacing } from '@/lib/design-tokens';
import { PlanningBranch, PlanSuggestion } from '@/hooks/use-planning-agent';

interface PlanningAgentPanelProps {
  open: boolean;
  onClose: () => void;
  branches: PlanningBranch[];
  suggestions: PlanSuggestion[];
  isLoading: boolean;
  weekStart: string;
  onRecalculate: (overrides: Record<string, number>) => void;
  onApplyPlan: (planBatches: Record<string, number>) => void;
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

export function PlanningAgentPanel({
  open,
  onClose,
  branches,
  suggestions,
  isLoading,
  weekStart,
  onRecalculate,
  onApplyPlan,
}: PlanningAgentPanelProps) {
  const [bowlsOverrides, setBowlsOverrides] = useState<Record<string, number>>({});
  const [calculated, setCalculated] = useState(false);

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
              {branches.map(br => (
                <div
                  key={br.branchId}
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
                </div>
              ))}
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
