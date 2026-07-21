'use client';

import { useDesignerStore } from '@/store/designer-store';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileDown, Loader2 } from 'lucide-react';
import { useState, useCallback } from 'react';
import {
  exportCanvasToPdf,
  DpiOption,
  CompressionOption,
  DEFAULT_EXPORT_OPTIONS,
} from '@/lib/pdf-export';

export function ExportPdfDialog() {
  const exportPdfOpen = useDesignerStore((s) => s.exportPdfOpen);
  const setExportPdfOpen = useDesignerStore((s) => s.setExportPdfOpen);
  const projectName = useDesignerStore((s) => s.projectName);
  const pageWidth = useDesignerStore((s) => s.canvasSettings.pageWidth);
  const pageHeight = useDesignerStore((s) => s.canvasSettings.pageHeight);

  const [dpi, setDpi] = useState<DpiOption>(DEFAULT_EXPORT_OPTIONS.dpi);
  const [compression, setCompression] = useState<CompressionOption>(DEFAULT_EXPORT_OPTIONS.compression);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const state = useDesignerStore.getState();
      await exportCanvasToPdf(state.elements, state.canvasSettings, state.projectName, {
        dpi,
        compression,
      });
      setExportPdfOpen(false);
    } catch (err) {
      console.error('PDF export failed:', err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'PDF export failed. Please try again.';
      alert(message);
    } finally {
      setIsExporting(false);
    }
  }, [dpi, compression, setExportPdfOpen]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setExportPdfOpen(false);
      }
    },
    [setExportPdfOpen],
  );

  // Orientation label
  const orientation = pageWidth > pageHeight ? 'Landscape' : 'Portrait';

  // Approximate file size estimate.
  // These are heuristic bytes-per-pixel figures for the FINAL PDF image stream
  // (after jsPDF's Deflate filter), not raw pixel sizes:
  //  • 'none'   → PNG + Deflate level 9 (lossless). A full-page screenshot
  //    is dominated by anti-aliased text/gradients, which Deflate compresses
  //    to roughly ~1.0 byte/px. (Previously this used raw RGBA ×4, which
  //    overstated the lossless size by ~4×.)
  //  • 'medium' → JPEG q85, ~1.0 byte/px (DCT, Deflate is a no-op).
  //  • 'high'   → JPEG q70, ~0.5 byte/px.
  const scaleFactor = dpi / 96;
  const pixelCount = pageWidth * scaleFactor * pageHeight * scaleFactor;
  const bytesPerPixel =
    compression === 'none'
      ? 1.0 // lossless PNG + Deflate-9
      : compression === 'high'
        ? 0.5 // JPEG q70
        : 1.0; // JPEG q85
  const estimatedMB = (pixelCount * bytesPerPixel) / 1024 / 1024;

  return (
    <Dialog open={exportPdfOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[440px] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="text-lg font-semibold flex items-center gap-2">
            <FileDown className="h-5 w-5 text-primary" />
            Export as PDF
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-5">
          {/* Project Info */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border">
            <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <FileDown className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{projectName}</p>
              <p className="text-xs text-muted-foreground">
                {pageWidth} × {pageHeight}px · {orientation}
              </p>
            </div>
          </div>

          {/* DPI Setting */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Resolution (DPI)</Label>
            <Select
              value={String(dpi)}
              onValueChange={(v) => setDpi(Number(v) as DpiOption)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="96">
                  96 DPI — Fast export (screen quality)
                </SelectItem>
                <SelectItem value="150">
                  150 DPI — Balanced quality
                </SelectItem>
                <SelectItem value="300">
                  300 DPI — Print quality
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Compression Setting */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Compression</Label>
            <Select
              value={compression}
              onValueChange={(v) => setCompression(v as CompressionOption)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  None — Lossless (PNG)
                </SelectItem>
                <SelectItem value="medium">
                  Medium — JPEG 85% quality
                </SelectItem>
                <SelectItem value="high">
                  High — JPEG 70% quality (smaller file)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Export Info */}
          <div className="text-xs text-muted-foreground space-y-1 p-3 rounded-lg bg-muted/30 border border-border">
            <div className="flex justify-between">
              <span>Page size</span>
              <span className="font-mono">
                {(pageWidth * 72 / 96).toFixed(1)} × {(pageHeight * 72 / 96).toFixed(1)} pt
              </span>
            </div>
            <div className="flex justify-between">
              <span>Render resolution</span>
              <span className="font-mono">
                {Math.round(pageWidth * scaleFactor)} × {Math.round(pageHeight * scaleFactor)} px
              </span>
            </div>
            <div className="flex justify-between">
              <span>Est. file size</span>
              <span className="font-mono">~{estimatedMB.toFixed(1)} MB</span>
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExportPdfOpen(false)}
            disabled={isExporting}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <FileDown className="h-3.5 w-3.5 mr-1.5" />
                Export PDF
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
