'use client';

import { useDesignerStore } from '@/store/designer-store';
import { Button } from '@/components/ui/button';
import { Magnet, Grid3X3, BoxSelect, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useState, useRef, useEffect } from 'react';

export function SnapControls() {
  const snapEnabled = useDesignerStore((s) => s.snapEnabled);
  const snapToGrid = useDesignerStore((s) => s.snapToGrid);
  const snapToElements = useDesignerStore((s) => s.snapToElements);
  const snapUnit = useDesignerStore((s) => s.snapUnit);
  const setSnapEnabled = useDesignerStore((s) => s.setSnapEnabled);
  const setSnapToGrid = useDesignerStore((s) => s.setSnapToGrid);
  const setSnapToElements = useDesignerStore((s) => s.setSnapToElements);
  const setSnapUnit = useDesignerStore((s) => s.setSnapUnit);

  const [customUnit, setCustomUnit] = useState('');
  const [showCustomUnit, setShowCustomUnit] = useState(false);
  const customInputRef = useRef<HTMLDivElement>(null);

  // Register a native capture-phase event listener to intercept keyboard events
  // before Radix UI's DropdownMenu can process them (arrow key navigation, type-ahead, etc.)
  useEffect(() => {
    const el = customInputRef.current;
    if (!el || !showCustomUnit) return;

    const stopRadixKeyboard = (e: KeyboardEvent) => {
      // Let only Escape bubble up so Radix can close the menu
      if (e.key !== 'Escape') {
        e.stopPropagation();
      }
    };

    el.addEventListener('keydown', stopRadixKeyboard, true);
    return () => el.removeEventListener('keydown', stopRadixKeyboard, true);
  }, [showCustomUnit]);

  const unitPresets = [5, 10, 15, 20, 25, 50];

  const handleUnitSelect = (value: number) => {
    setSnapUnit(value);
    setShowCustomUnit(false);
    setCustomUnit('');
  };

  const handleCustomUnitSubmit = () => {
    const val = parseInt(customUnit, 10);
    if (!isNaN(val) && val >= 1 && val <= 200) {
      setSnapUnit(val);
      setShowCustomUnit(false);
      setCustomUnit('');
    }
  };

  return (
    <div className="flex items-center gap-1">
      {/* Snap toggle button */}
      <Button
        variant={snapEnabled ? 'default' : 'outline'}
        size="sm"
        className="h-7 px-2 text-xs gap-1"
        onClick={() => setSnapEnabled(!snapEnabled)}
        title={snapEnabled ? 'Snapping enabled (click to disable)' : 'Snapping disabled (click to enable)'}
      >
        <Magnet className="h-3.5 w-3.5" />
        Snap
      </Button>

      {/* Snap options dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="h-7 w-7" title="Snap settings">
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[200px]" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownMenuLabel className="text-xs">Snap Options</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={snapToElements}
            onCheckedChange={setSnapToElements}
            className="text-xs"
          >
            <BoxSelect className="h-3.5 w-3.5 mr-2" />
            Snap to Elements
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={snapToGrid}
            onCheckedChange={setSnapToGrid}
            className="text-xs"
          >
            <Grid3X3 className="h-3.5 w-3.5 mr-2" />
            Snap to Grid
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs">Grid Unit Size</DropdownMenuLabel>
          {unitPresets.map((unit) => (
            <DropdownMenuItem
              key={unit}
              onClick={() => handleUnitSelect(unit)}
              className={snapUnit === unit ? 'bg-accent text-xs' : 'text-xs'}
            >
              {unit}px
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onClick={() => setShowCustomUnit(true)}
            onSelect={(e) => e.preventDefault()}
            className={!unitPresets.includes(snapUnit) ? 'bg-accent text-xs' : 'text-xs'}
          >
            Custom ({snapUnit}px)
          </DropdownMenuItem>
          {showCustomUnit && (
            <div
              ref={customInputRef}
              className="px-2 py-1.5 flex items-center gap-1.5"
            >
              <Input
                type="number"
                min={1}
                max={200}
                value={customUnit}
                onChange={(e) => setCustomUnit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCustomUnitSubmit();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowCustomUnit(false);
                    setCustomUnit('');
                  }
                }}
                placeholder="1-200"
                className="h-7 w-20 text-xs"
                autoFocus
              />
              <Button size="sm" className="h-7 text-xs px-2" onClick={handleCustomUnitSubmit}>
                Set
              </Button>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
