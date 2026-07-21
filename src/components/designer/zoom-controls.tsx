'use client';

import { useDesignerStore, ZOOM_STEP_PRESETS } from '@/store/designer-store';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, Maximize, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useState } from 'react';

// Zoom level presets
const zoomPresets = [
  { label: '1%', value: 0.01 },
  { label: '5%', value: 0.05 },
  { label: '10%', value: 0.1 },
  { label: '20%', value: 0.2 },
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1 },
  { label: '150%', value: 1.5 },
  { label: '200%', value: 2 },
  { label: '300%', value: 3 },
];

interface ZoomControlsProps {
  viewportRef: React.RefObject<HTMLDivElement | null>;
}

export function ZoomControls({ viewportRef }: ZoomControlsProps) {
  // Use selectors only for rendering the display values
  const zoom = useDesignerStore((s) => s.zoom);
  const zoomStep = useDesignerStore((s) => s.zoomStep);
  const setZoomStep = useDesignerStore((s) => s.setZoomStep);
  const resetZoom = useDesignerStore((s) => s.resetZoom);
  const fitToPage = useDesignerStore((s) => s.fitToPage);

  const [customStep, setCustomStep] = useState('');
  const [showCustomStep, setShowCustomStep] = useState(false);

  const zoomPercent = Math.round(zoom * 100);

  const getViewportCenter = () => {
    const viewport = viewportRef.current;
    if (!viewport) return { x: 0, y: 0 };
    return { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
  };

  // Read latest state from store directly to avoid stale closures
  const handleZoomIn = () => {
    const state = useDesignerStore.getState();
    const center = getViewportCenter();
    const step = state.zoomStep / 100;
    state.zoomAtPoint(+(state.zoom + step).toFixed(4), center.x, center.y);
  };

  const handleZoomOut = () => {
    const state = useDesignerStore.getState();
    const center = getViewportCenter();
    const step = state.zoomStep / 100;
    state.zoomAtPoint(+(state.zoom - step).toFixed(4), center.x, center.y);
  };

  const handleSetZoom = (value: number) => {
    const state = useDesignerStore.getState();
    const center = getViewportCenter();
    state.zoomAtPoint(value, center.x, center.y);
  };

  // Fit the entire page to the viewport with padding, centered — matches the
  // "Fit to Page" View-menu action and the initial app centering. Previously
  // this button called resetZoom (zoom=1, pan=0) which neither fit nor centered
  // the page, leaving it zoomed-in and shifted toward the left panel.
  const handleFitToScreen = () => {
    const viewport = viewportRef.current;
    if (viewport) {
      fitToPage(viewport.clientWidth, viewport.clientHeight);
    }
  };

  const handleStepSelect = (value: number) => {
    setZoomStep(value);
    setShowCustomStep(false);
    setCustomStep('');
  };

  const handleCustomStepSubmit = () => {
    const val = parseInt(customStep, 10);
    if (!isNaN(val) && val >= 1 && val <= 100) {
      setZoomStep(val);
      setShowCustomStep(false);
      setCustomStep('');
    }
  };

  return (
    <div data-tour="zoom-controls" className="flex items-center gap-1">
      {/* Zoom Level Controls */}
      <div className="flex items-center gap-1 bg-card border border-border rounded-lg px-1 py-0.5 shadow-sm">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomOut} title="Zoom out">
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-mono gap-0.5" title="Zoom level">
              {zoomPercent}%
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="min-w-[120px]">
            {zoomPresets.map((preset) => (
              <DropdownMenuItem
                key={preset.label}
                onClick={() => handleSetZoom(preset.value)}
                className={zoomPercent === Math.round(preset.value * 100) ? 'bg-accent' : ''}
              >
                {preset.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomIn} title="Zoom in">
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <div className="w-px h-4 bg-border mx-0.5" />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleFitToScreen} title="Fit to screen">
          <Maximize className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Zoom Step Selector */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs font-mono gap-0.5" title="Zoom step size">
            Step: {zoomStep}%
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-[140px]">
          {ZOOM_STEP_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.label}
              onClick={() => handleStepSelect(preset.value)}
              className={zoomStep === preset.value ? 'bg-accent' : ''}
            >
              {preset.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setShowCustomStep(true)}
            className={zoomStep !== 1 && zoomStep !== 5 && zoomStep !== 10 && zoomStep !== 20 && zoomStep !== 50 ? 'bg-accent' : ''}
          >
            Custom ({zoomStep}%)
          </DropdownMenuItem>
          {showCustomStep && (
            <div className="px-2 py-1.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <Input
                type="number"
                min={1}
                max={100}
                value={customStep}
                onChange={(e) => setCustomStep(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCustomStepSubmit()}
                placeholder="1-100"
                className="h-7 w-16 text-xs"
                autoFocus
              />
              <Button size="sm" className="h-7 text-xs px-2" onClick={handleCustomStepSubmit}>
                Set
              </Button>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
