import { SKUType, SKU_TYPE_LABELS } from '@/types/sku';
import { Package, Layers, Sparkles, Box } from 'lucide-react';

const icons: Record<SKUType, React.ElementType> = {
  RM: Package,
  SM: Layers,
  SP: Sparkles,
  PK: Box,
};

const badgeClasses: Record<SKUType, string> = {
  RM: 'badge-rm',
  SM: 'badge-sm',
  SP: 'badge-sp',
  PK: 'badge-pk',
};

interface SummaryCardsProps {
  counts: Record<SKUType, number>;
  total: number;
}

export function SummaryCards({ counts, total }: SummaryCardsProps) {
  const types: SKUType[] = ['RM', 'SM', 'SP', 'PK'];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <div className="rounded-lg border bg-card p-5 animate-fade-in">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total SKUs</p>
        <p className="text-3xl font-heading font-bold mt-1">{total}</p>
      </div>
      {types.map((type) => {
        const Icon = icons[type];
        return (
          <div key={type} className="rounded-lg border bg-card p-5 animate-fade-in">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{type}</p>
              <span className={`inline-flex items-center justify-center w-8 h-8 rounded-md ${badgeClasses[type]}`}>
                <Icon className="w-4 h-4" />
              </span>
            </div>
            <p className="text-3xl font-heading font-bold mt-1">{counts[type]}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{SKU_TYPE_LABELS[type]}</p>
          </div>
        );
      })}
    </div>
  );
}
