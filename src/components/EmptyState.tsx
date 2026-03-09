import { LucideIcon, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon = Package,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
        <Icon className="w-7 h-7 text-muted-foreground" />
      </div>
      <div className="text-center">
        <p className="font-medium text-foreground">{title}</p>
        {description && (
          <p className="text-helper text-muted-foreground mt-1 max-w-sm">
            {description}
          </p>
        )}
      </div>
      {actionLabel && onAction && (
        <Button onClick={onAction} size="sm" className="mt-2">
          <Plus className="w-4 h-4" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
