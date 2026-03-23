import { SKUType, SKU_TYPE_LABELS } from "@/types/sku";
import { Package, Layers, Sparkles, Box } from "lucide-react";

const icons: Record<SKUType, React.ElementType> = {
  RM: Package,
  SM: Layers,
  SP: Sparkles,
  PK: Box,
};

const badgeClasses: Record<SKUType, string> = {
  RM: "badge-rm",
  SM: "badge-sm",
  SP: "badge-sp",
  PK: "badge-pk",
};

const categoryCardColors: Record<SKUType, { bg: string; label: string; value: string }> = {
  RM: { bg: "bg-[#FAECE7]", label: "text-[#712B13]", value: "text-[#4A1A0A]" },
  SM: { bg: "bg-[#E6F1FB]", label: "text-[#0C447C]", value: "text-[#042C53]" },
  SP: { bg: "bg-[#EEEDFE]", label: "text-[#3C3489]", value: "text-[#1E1A5A]" },
  PK: { bg: "bg-[#E1F5EE]", label: "text-[#085041]", value: "text-[#03302A]" },
};

interface SummaryCardsProps {
  counts: Record<SKUType, number>;
  total: number;
}

export function SummaryCards({ counts, total }: SummaryCardsProps) {
  const types: SKUType[] = ["RM", "SM", "SP", "PK"];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <div className="rounded-lg border bg-[#F1EFE8] p-card-p animate-fade-in card-hover">
        <p className="text-helper uppercase tracking-wider font-semibold text-[#5F5E5A]">Total SKUs</p>
        <p className="text-2xl font-bold mt-2 font-mono-num text-[#2C2C2A]">{total}</p>
      </div>
      {types.map((type) => {
        const Icon = icons[type];
        const colors = categoryCardColors[type];
        return (
          <div key={type} className={`rounded-lg border ${colors.bg} p-card-p animate-fade-in card-hover`}>
            <div className="flex items-center justify-between">
              <p className={`text-helper uppercase tracking-wider font-semibold ${colors.label}`}>{type}</p>
              <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full ${badgeClasses[type]}`}>
                <Icon className="w-4 h-4" />
              </span>
            </div>
            <p className={`text-2xl font-bold mt-2 font-mono-num ${colors.value}`}>{counts[type]}</p>
            <p className={`text-helper mt-0.5 ${colors.label}`}>{SKU_TYPE_LABELS[type]}</p>
          </div>
        );
      })}
    </div>
  );
}
