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
      <div className="rounded-lg border bg-card p-card-p animate-fade-in card-hover">
        <p className="text-helper uppercase tracking-wider font-semibold text-muted-foreground">Total SKUs</p>
        <p className="text-2xl font-bold mt-2 font-mono-num">{total}</p>
      </div>
      {types.map((type) => {
        const Icon = icons[type];
        return (
          <div key={type} className="rounded-lg border bg-card p-card-p animate-fade-in card-hover">
            <div className="flex items-center justify-between">
              <p className="text-helper uppercase tracking-wider font-semibold text-muted-foreground">{type}</p>
              <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full ${badgeClasses[type]}`}>
                <Icon className="w-4 h-4" />
              </span>
            </div>
            <p className="text-2xl font-bold mt-2 font-mono-num">{counts[type]}</p>
            <p className="text-helper text-muted-foreground mt-0.5">{SKU_TYPE_LABELS[type]}</p>
          </div>
        );
      })}
    </div>
  );
}
