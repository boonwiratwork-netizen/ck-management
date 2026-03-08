import { useState, useCallback, useRef } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Download, Upload, FileUp, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface CSVColumnDef {
  key: string;
  label: string;
  required?: boolean;
}

export interface CSVValidationError {
  row: number;
  message: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  columns: CSVColumnDef[];
  validate: (rows: Record<string, string>[]) => { valid: Record<string, string>[]; errors: CSVValidationError[]; skipped: number };
  onConfirm: (rows: Record<string, string>[]) => void;
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

function downloadTemplate(columns: CSVColumnDef[], title: string) {
  const csv = columns.map(c => c.label).join(',') + '\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/\s+/g, '_')}_Template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function CSVImportModal({ open, onClose, title, columns, validate, onConfirm }: Props) {
  const [allRows, setAllRows] = useState<Record<string, string>[]>([]);
  const [validRows, setValidRows] = useState<Record<string, string>[]>([]);
  const [errors, setErrors] = useState<CSVValidationError[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [fileName, setFileName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setAllRows([]);
    setValidRows([]);
    setErrors([]);
    setSkipped(0);
    setFileName('');
  };

  const handleClose = () => { reset(); onClose(); };

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { rows } = parseCSV(text);
      setAllRows(rows);
      const result = validate(rows);
      setValidRows(result.valid);
      setErrors(result.errors);
      setSkipped(result.skipped);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [validate]);

  const handleConfirm = () => {
    onConfirm(validRows);
    handleClose();
  };

  const previewRows = allRows.slice(0, 5);
  const hasData = allRows.length > 0;
  const hasErrors = errors.length > 0;

  return (
    <Dialog open={open} onOpenChange={o => !o && handleClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import CSV — {title}</DialogTitle>
          <DialogDescription>
            Download the template, fill in your data, then upload the CSV file.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4">
          {/* Step 1: Template & Upload */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => downloadTemplate(columns, title)}>
              <Download className="w-4 h-4" /> Download Template
            </Button>
            <div className="flex-1" />
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4" /> {fileName || 'Upload CSV'}
            </Button>
          </div>

          {!hasData && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border border-dashed rounded-lg">
              <FileUp className="w-10 h-10 mb-2 opacity-50" />
              <p className="text-sm">Upload a CSV file to preview data</p>
            </div>
          )}

          {hasData && (
            <>
              {/* Summary badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary">{allRows.length} rows total</Badge>
                <Badge className="bg-success/15 text-success border-success/30">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> {validRows.length} valid
                </Badge>
                {hasErrors && (
                  <Badge variant="destructive">
                    <AlertTriangle className="w-3 h-3 mr-1" /> {errors.length} errors
                  </Badge>
                )}
                {skipped > 0 && (
                  <Badge variant="outline" className="text-warning border-warning/30">
                    {skipped} duplicates skipped
                  </Badge>
                )}
              </div>

              {/* Error list */}
              {hasErrors && (
                <ScrollArea className="max-h-28 border rounded-md p-2 bg-destructive/5">
                  {errors.map((err, i) => (
                    <p key={i} className="text-xs text-destructive py-0.5">
                      Row {err.row}: {err.message}
                    </p>
                  ))}
                </ScrollArea>
              )}

              {/* Preview table */}
              <div className="border rounded-md overflow-hidden">
                <p className="text-xs text-muted-foreground px-3 py-1.5 bg-muted/50 border-b">
                  Preview (first {Math.min(5, allRows.length)} rows)
                </p>
                <ScrollArea className="max-h-48">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        {columns.map(c => (
                          <TableHead key={c.key} className="text-xs">{c.label}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewRows.map((row, i) => {
                        const rowErrors = errors.filter(e => e.row === i + 2);
                        return (
                          <TableRow key={i} className={rowErrors.length > 0 ? 'bg-destructive/5' : ''}>
                            <TableCell className="text-xs text-muted-foreground">{i + 2}</TableCell>
                            {columns.map(c => (
                              <TableCell key={c.key} className="text-xs">{row[c.label] ?? ''}</TableCell>
                            ))}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!hasData || validRows.length === 0}>
            <CheckCircle2 className="w-4 h-4" />
            Confirm Import ({validRows.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
