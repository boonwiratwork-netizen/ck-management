import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { POSMappingProfile } from "@/hooks/use-sales-entry-data";
import { ScrollArea } from "@/components/ui/scroll-area";

const MAPPING_FIELDS: { key: string; label: string; required: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "menu_code", label: "Menu Code", required: true },
  { key: "menu_name", label: "Menu Name", required: true },
  { key: "qty", label: "Quantity", required: true },
  { key: "receipt_no", label: "Receipt No", required: false },
  { key: "unit_price", label: "Unit Price", required: false },
  { key: "net_amount", label: "Net Amount", required: false },
  { key: "channel", label: "Channel", required: false },
  { key: "order_type", label: "Order Type", required: false },
];

const SEED_PROFILE_NAME = "FoodStory POS";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: POSMappingProfile | null; // null = create new
  onSave: (profile: Omit<POSMappingProfile, "id"> & { id?: string }) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

export function POSProfileModal({ open, onOpenChange, profile, onSave, onDelete }: Props) {
  const [name, setName] = useState("");
  const [separator, setSeparator] = useState<"tab" | "comma" | "semicolon">("tab");
  const [hasHeaderRow, setHasHeaderRow] = useState(false);
  const [dateFormat, setDateFormat] = useState("DD/MM/YYYY");
  const [mappings, setMappings] = useState<Record<string, number>>({});
  const [sampleText, setSampleText] = useState("");
  const [saving, setSaving] = useState(false);

  const isSeed = profile?.name === SEED_PROFILE_NAME;

  useEffect(() => {
    if (open) {
      if (profile) {
        setName(profile.name);
        setSeparator(profile.separator);
        setHasHeaderRow(profile.hasHeaderRow);
        setDateFormat(profile.dateFormat);
        setMappings({ ...profile.mappings });
      } else {
        setName("");
        setSeparator("tab");
        setHasHeaderRow(false);
        setDateFormat("DD/MM/YYYY");
        setMappings({});
      }
      setSampleText("");
    }
  }, [open, profile]);

  const sampleColumns = useMemo(() => {
    if (!sampleText.trim()) return [];
    const line = sampleText.trim().split("\n")[0];
    if (separator === "comma") {
      // Simple CSV split for sample preview
      const result: string[] = [];
      let current = "";
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === "," && !inQuotes) {
          result.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
      result.push(current);
      return result;
    }
    if (separator === "semicolon") return line.split(";");
    return line.split("\t");
  }, [sampleText, separator]);

  const handleMappingChange = (field: string, value: string) => {
    const newMappings = { ...mappings };
    if (value === "__none__") {
      delete newMappings[field];
    } else {
      newMappings[field] = parseInt(value);
    }
    setMappings(newMappings);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const success = await onSave({
      id: profile?.id,
      name: name.trim(),
      separator,
      hasHeaderRow,
      mappings,
      dateFormat,
    });
    setSaving(false);
    if (success) onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!profile?.id || isSeed) return;
    setSaving(true);
    const success = await onDelete(profile.id);
    setSaving(false);
    if (success) onOpenChange(false);
  };

  const requiredMissing = MAPPING_FIELDS.filter((f) => f.required).some((f) => mappings[f.key] === undefined);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{profile ? "Edit POS Profile" : "New POS Profile"}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto pr-2">
          <div className="space-y-4 pb-2">
            {/* Profile Name */}
            <div>
              <Label className="text-sm font-medium">Profile Name *</Label>
              <Input
                className="h-10 mt-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My POS System"
              />
            </div>

            {/* Separator */}
            <div>
              <Label className="text-sm font-medium">Separator</Label>
              <div className="flex gap-2 mt-1">
                {(["tab", "comma", "semicolon"] as const).map((sep) => (
                  <Button
                    key={sep}
                    type="button"
                    variant={separator === sep ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSeparator(sep)}
                  >
                    {sep === "tab" ? "Tab" : sep === "comma" ? "Comma" : "Semicolon"}
                  </Button>
                ))}
              </div>
            </div>

            {/* Has header row */}
            <div className="flex items-center gap-3">
              <Switch checked={hasHeaderRow} onCheckedChange={setHasHeaderRow} />
              <Label className="text-sm">First row is header (skip it)</Label>
            </div>

            {/* Date format */}
            <div>
              <Label className="text-sm font-medium">Date Format</Label>
              <Select value={dateFormat} onValueChange={setDateFormat}>
                <SelectTrigger className="h-10 mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                  <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                  <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Sample Data */}
            <div>
              <Label className="text-sm font-medium">Paste a sample row from your POS to auto-detect columns:</Label>
              <Textarea
                className="mt-1 font-mono text-xs"
                rows={2}
                placeholder="Paste one row here..."
                value={sampleText}
                onChange={(e) => setSampleText(e.target.value)}
              />
            </div>

            {/* Column chips */}
            {sampleColumns.length > 0 && (
              <div className="overflow-x-auto">
                <div className="flex gap-1 min-w-max pb-1">
                  {sampleColumns.map((col, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs font-mono whitespace-nowrap"
                    >
                      <span className="text-muted-foreground">{i}:</span>
                      <span className="max-w-[120px] truncate">{col || "(empty)"}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Column Mapping */}
            <div>
              <Label className="text-sm font-medium mb-2 block">Column Mapping</Label>
              <div className="space-y-2">
                {MAPPING_FIELDS.map((field) => (
                  <div key={field.key} className="flex items-center gap-2">
                    <span className="text-sm w-28 shrink-0">
                      {field.label}
                      {field.required && " *"}
                    </span>
                    <Select
                      value={mappings[field.key] !== undefined ? String(mappings[field.key]) : "__none__"}
                      onValueChange={(v) => handleMappingChange(field.key, v)}
                    >
                      <SelectTrigger className="h-10 flex-1">
                        <SelectValue placeholder="— Not mapped —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Not mapped —</SelectItem>
                        {(sampleColumns.length > 0 ? sampleColumns : Array.from({ length: 30 }, (_, i) => "")).map(
                          (val, i) => (
                            <SelectItem key={i} value={String(i)}>
                              Column {i}
                              {val ? `: ${val.substring(0, 30)}` : ""}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between gap-2 pt-4 border-t">
          <div>
            {profile && !isSeed && (
              <Button variant="destructive" onClick={handleDelete} disabled={saving}>
                Delete Profile
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !name.trim() || requiredMissing}>
              {saving ? "Saving..." : "Save Profile"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
