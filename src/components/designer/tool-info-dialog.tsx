'use client';

import { useDesignerStore } from '@/store/designer-store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { getToolInfo } from '@/lib/tool-info-data';

// ─────────────────────────────────────────────────────────────────────────────
// ToolInfoDialog — a small modal that shows the tool-specific shortcuts for
// the element type the user clicked the "ⓘ" icon on.
//
// Controlled by `toolInfoElementType` in the store (null = closed). The icon
// above each element sets this to its element's type; closing the dialog sets
// it back to null.
// ─────────────────────────────────────────────────────────────────────────────

export function ToolInfoDialog() {
  const elementType = useDesignerStore((s) => s.toolInfoElementType);
  const setElementType = useDesignerStore((s) => s.setToolInfoElementType);

  const info = elementType ? getToolInfo(elementType) : null;

  return (
    <Dialog open={elementType !== null} onOpenChange={(open) => { if (!open) setElementType(null); }}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{info?.title ?? 'Tool'}</DialogTitle>
          {info?.description && (
            <DialogDescription>{info.description}</DialogDescription>
          )}
        </DialogHeader>

        {info?.groups.map((group) => (
          <div key={group.title} className="flex flex-col gap-2 mt-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {group.title}
            </span>
            <div className="flex flex-col gap-1.5">
              {group.entries.map((entry) => (
                <div
                  key={entry.keys + entry.label}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card/40 px-3 py-2"
                >
                  <span className="text-xs text-foreground/80">{entry.label}</span>
                  <kbd className="shrink-0 text-[11px] font-medium text-muted-foreground bg-secondary px-2 py-0.5 rounded border border-border font-mono leading-none">
                    {entry.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Footer note — small, light-colored. Tells the user they can hide
            these icons via the footer toggle. */}
        <p className="mt-3 text-[10px] text-muted-foreground/50 leading-relaxed">
          Tip: you can hide these info icons from the canvas by toggling the
          &#8220;Hide Info&#8221; button in the bottom footer.
        </p>
      </DialogContent>
    </Dialog>
  );
}
