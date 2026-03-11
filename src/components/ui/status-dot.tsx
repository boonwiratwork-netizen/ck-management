import { cn } from '@/lib/utils';
import { statusDotColors, statusDotSizes } from '@/lib/design-tokens';

export type StatusDotStatus = 'green' | 'amber' | 'red';
export type StatusDotSize = 'sm' | 'md';

interface StatusDotProps {
  status: StatusDotStatus;
  size?: StatusDotSize;
  className?: string;
}

/**
 * Consistent status indicator dot.
 * Use instead of inline emoji or ad-hoc colored circles.
 *
 * @example
 * <StatusDot status="green" />
 * <StatusDot status="amber" size="sm" />
 */
export function StatusDot({ status, size = 'md', className }: StatusDotProps) {
  return (
    <span
      className={cn(
        'inline-block rounded-full shrink-0',
        statusDotSizes[size],
        statusDotColors[status],
        className,
      )}
      aria-label={status}
    />
  );
}
