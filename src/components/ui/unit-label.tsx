import { cn } from '@/lib/utils';

interface UnitLabelProps {
  unit: string;
  className?: string;
}

/**
 * Inline unit label rendered after numeric values in tables.
 *
 * @example
 * <span className="font-mono">12,345</span>
 * <UnitLabel unit="ก." />
 */
export function UnitLabel({ unit, className }: UnitLabelProps) {
  return (
    <span className={cn('text-xs text-muted-foreground ml-0.5', className)}>
      {unit}
    </span>
  );
}
