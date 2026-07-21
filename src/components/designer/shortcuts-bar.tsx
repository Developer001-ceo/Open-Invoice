'use client';

import { Keyboard, Eye, EyeOff, Info } from 'lucide-react';
import { useDesignerStore } from '@/store/designer-store';
import { Button } from '@/components/ui/button';

const shortcuts = [
  { keys: 'Scroll', label: 'Zoom' },
  { keys: 'Space+Drag', label: 'Pan' },
  { keys: 'Alt+Click', label: 'Select Cells' },
  { keys: 'Alt+Drag', label: 'Multi-Select Cells' },
  { keys: 'Del', label: 'Remove' },
  { keys: 'Ctrl+C/V', label: 'Copy/Paste' },
  { keys: '←→↑↓', label: 'Move' },
  { keys: 'Shift+Arrow', label: 'Move 10px' },
  { keys: 'Shift+Q', label: 'Blocks' },
  { keys: 'Shift+S', label: 'Properties' },
];

export function ShortcutsBar() {
  // Toggle for the on-canvas shortcuts overlay (the muted instruction text on
  // the right side of the workspace). This button sits at the bottom-right of
  // the footer; the overlay itself lives inside the canvas viewport.
  const overlayVisible = useDesignerStore((s) => s.shortcutsOverlayVisible);
  const setOverlayVisible = useDesignerStore((s) => s.setShortcutsOverlayVisible);
  // Per-element "ⓘ" info icons toggle.
  const infoIconsVisible = useDesignerStore((s) => s.toolInfoIconsVisible);
  const setInfoIconsVisible = useDesignerStore((s) => s.setToolInfoIconsVisible);

  return (
    <div className="h-7 border-t border-border bg-card flex items-center px-4 gap-4 shrink-0 select-none">
      {/* Left: scrollable inline shortcuts reference */}
      <div className="flex items-center gap-4 overflow-x-auto min-w-0 flex-1 scrollbar-none">
        <Keyboard className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {shortcuts.map((s) => (
          <div key={s.keys} className="flex items-center gap-1.5 shrink-0">
            <kbd className="text-[10px] font-medium text-muted-foreground bg-secondary/80 px-1.5 py-0 rounded border border-border leading-none">
              {s.keys}
            </kbd>
            <span className="text-[10px] text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Right: toggles for the on-canvas info icons + shortcuts overlay */}
      <Button
        variant="ghost"
        size="sm"
        className="h-5 px-1.5 text-[10px] gap-1 text-muted-foreground hover:text-foreground shrink-0"
        onClick={() => setInfoIconsVisible(!infoIconsVisible)}
        title={infoIconsVisible ? 'Hide tool info icons' : 'Show tool info icons'}
        aria-pressed={infoIconsVisible}
      >
        <Info className="h-3 w-3" />
        <span className="hidden sm:inline">{infoIconsVisible ? 'Hide' : 'Show'} Info</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 px-1.5 text-[10px] gap-1 text-muted-foreground hover:text-foreground shrink-0"
        onClick={() => setOverlayVisible(!overlayVisible)}
        title={overlayVisible ? 'Hide on-canvas shortcuts' : 'Show on-canvas shortcuts'}
        aria-pressed={overlayVisible}
      >
        {overlayVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        <span className="hidden sm:inline">{overlayVisible ? 'Hide' : 'Show'} Hints</span>
      </Button>
    </div>
  );
}
