'use client';

import { useDesignerStore, FloatingCardData } from '@/store/designer-store';
import { CanvasElement, TextProperties, TableProperties, ImageProperties, LineProperties, RectangleProperties, EllipseProperties, CellOverride, ShadowEffect, ReflectionEffect, RectangleEffects, GradientFill, GradientStop, ElementProperties, DEFAULT_SHADOW, DEFAULT_EFFECTS, GRADIENT_PRESETS, buildGradientCSS, computeLineBounds, normalizeRectBorderRadius, getRectRotation } from '@/lib/element-types';
import { ensureColWidths, ensureRowHeights, ensureRowNames, ensureColNames } from '@/lib/table-helpers';
import { useRef, useState, useCallback, useEffect, memo, useMemo } from 'react';
import { X, ChevronDown, ChevronUp, GripHorizontal, PanelTop, PanelLeft, PanelRight, PanelBottom, Square, Bold, Italic, Underline as UnderlineIcon, Strikethrough, AlignLeft, AlignCenter, AlignRight, AlignJustify, Type, Columns3, Rows3, RotateCcw } from 'lucide-react';
import { GradientStopBar } from '@/components/designer/gradient-stop-bar';
import { DraggableReorderList, ReorderItem } from '@/components/designer/draggable-reorder-list';
import { SliderField } from '@/components/ui/slider-field';
import { ColorInput } from '@/components/ui/color-input';
import { FormattingToolbar, LabeledSelect } from '@/components/designer/rich-text-editor';
import { FONT_FAMILIES, FONT_FAMILIES_GROUPED, DEFAULT_FONT_FAMILY } from '@/lib/fonts';

interface FloatingCardProps {
  card: FloatingCardData;
  element: CanvasElement;
  multiSelectIds?: string[];
  onBringToFront: (cardId: string) => void;
  boundsRef?: React.RefObject<HTMLDivElement | null>;
}

export function FloatingCard({ card, element, multiSelectIds, onBringToFront, boundsRef }: FloatingCardProps) {
  const removeFloatingCard = useDesignerStore((s) => s.removeFloatingCard);
  const clearCardInitialPosition = useDesignerStore((s) => s.clearCardInitialPosition);
  const spotlightOpen = useDesignerStore((s) => s.spotlightOpen);
  const settingsOpen = useDesignerStore((s) => s.settingsOpen);
  // Subscribe to ALL modal states so floating cards hide behind any modal
  const newProjectOpen = useDesignerStore((s) => s.newProjectOpen);
  const exportPdfOpen = useDesignerStore((s) => s.exportPdfOpen);
  const largePreviewOpen = useDesignerStore((s) => s.largePreviewOpen);
  const welcomeModalOpen = useDesignerStore((s) => s.welcomeModalOpen);
  const predefinedBlocksOpen = useDesignerStore((s) => s.predefinedBlocksOpen);
  // Any modal open → cards go behind (z-40, below the z-50 dialogs)
  const anyModalOpen = settingsOpen || newProjectOpen || exportPdfOpen || largePreviewOpen || welcomeModalOpen || predefinedBlocksOpen;

  // Fly-in animation: start at initialX/initialY (spotlight card position) if provided,
  // then animate to the target position (card.x/card.y)
  const hasInitialPosition = card.initialX !== undefined && card.initialY !== undefined;
  const [position, setPosition] = useState({
    x: hasInitialPosition ? card.initialX! : card.x,
    y: hasInitialPosition ? card.initialY! : card.y,
  });
  const [isAnimating, setIsAnimating] = useState(hasInitialPosition);
  const [isMinimized, setIsMinimized] = useState(card.minimized);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement>(null);

  // Fly-in animation: after mount, animate from initial position to target position
  useEffect(() => {
    if (!hasInitialPosition) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let raf2: number | null = null;
    // Use double-rAF to ensure the browser has painted the initial position first
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setPosition({ x: card.x, y: card.y });
        // Clear animation state after transition completes
        timer = setTimeout(() => {
          setIsAnimating(false);
          clearCardInitialPosition(card.id);
        }, 450); // Match the CSS transition duration
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 !== null) cancelAnimationFrame(raf2);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  // Handle dragging — RAF-throttled position updates to avoid layout thrashing
  const rafRef = useRef<number | null>(null);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
    onBringToFront(card.id);
  }, [position, onBringToFront, card.id]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      let newX = e.clientX - dragOffset.x;
      let newY = e.clientY - dragOffset.y;

      // Constrain to bounds if provided
      if (boundsRef?.current) {
        const rect = boundsRef.current.getBoundingClientRect();
        newX = Math.max(rect.left, Math.min(newX, rect.right - getCardWidthPx(card.sectionLabel)));
        newY = Math.max(rect.top, Math.min(newY, rect.bottom - 40));
      }

      // Throttle position updates via RAF
      pendingPosRef.current = { x: newX, y: newY };
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          if (pendingPosRef.current) {
            setPosition(pendingPosRef.current);
            pendingPosRef.current = null;
          }
          rafRef.current = null;
        });
      }
    };

    const handleMouseUp = () => {
      // Flush any pending position before stopping drag
      if (pendingPosRef.current) {
        setPosition(pendingPosRef.current);
        pendingPosRef.current = null;
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, boundsRef]);

  const handleClose = useCallback(() => {
    removeFloatingCard(card.id);
  }, [removeFloatingCard, card.id]);

  const handleToggleMinimize = useCallback(() => {
    setIsMinimized(!isMinimized);
  }, [isMinimized]);

  // Render the appropriate property content based on sectionLabel
  const renderContent = () => {
    return <PropertyContent sectionLabel={card.sectionLabel} element={element} multiSelectIds={multiSelectIds} />;
  };

  return (
    <div
      ref={cardRef}
      className="fixed select-none"
      style={{
        left: position.x,
        top: position.y,
        // When ANY modal is open (z-50), push floating cards behind it (z-40)
        // When spotlight is open, force z-index below the spotlight overlay (z-99999)
        // Otherwise use the card's z-index for stacking among floating cards
        zIndex: anyModalOpen ? 40 : spotlightOpen ? 100 : card.zIndex,
        // Smooth transition for fly-in animation (not during drag)
        transition: isAnimating && !isDragging
          ? 'left 400ms cubic-bezier(0.34, 1.56, 0.64, 1), top 400ms cubic-bezier(0.34, 1.56, 0.64, 1)'
          : isAnimating
          ? 'none'
          : 'none',
      }}
      onMouseDown={() => onBringToFront(card.id)}
    >
      <div
        className={`${getCardWidthClass(card.sectionLabel)} rounded-lg border border-border/60 bg-card shadow-xl overflow-hidden transition-all duration-200 relative ${
          isDragging ? 'shadow-2xl cursor-grabbing' : 'cursor-grab'
        } ${spotlightOpen || anyModalOpen ? 'pointer-events-none' : ''}`}
        style={spotlightOpen || anyModalOpen ? { opacity: 0.4, filter: 'saturate(0.3) brightness(0.6)' } : undefined}
      >
        {/* Title bar */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-muted/30 border-b border-border/40 hover:bg-muted/50 transition-colors"
          onMouseDown={handleMouseDown}
          onDoubleClick={handleToggleMinimize}
        >
          <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
          <span className="text-[11px] font-medium text-foreground truncate flex-1">
            {card.sectionLabel}
          </span>
          <button
            data-no-drag
            type="button"
            className="p-0.5 rounded hover:bg-muted transition-colors"
            onClick={handleToggleMinimize}
            title={isMinimized ? 'Expand' : 'Minimize'}
          >
            {isMinimized ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronUp className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
          <button
            data-no-drag
            type="button"
            className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
            onClick={handleClose}
            title="Close"
          >
            <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
          </button>
        </div>

        {/* Content */}
        {!isMinimized && (
          <div className="p-3 max-h-[70vh] overflow-y-auto">
            {renderContent()}
          </div>
        )}

        {/* Blue dim overlay when spotlight or settings is open */}
        {(spotlightOpen || anyModalOpen) && (
          <div className="absolute inset-0 bg-blue-500/20 pointer-events-none rounded-lg" />
        )}
      </div>
    </div>
  );
}

// ─── Shared input classes ──────────────────────────────────────────────
const inputCls = 'w-full min-w-0 h-7 text-xs px-2 border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring';
const inputFlexCls = 'flex-1 min-w-0 h-7 text-xs px-2 border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring';
const selectCls = 'w-full h-7 text-xs px-2 border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring';
const labelCls = 'text-[10px] text-muted-foreground uppercase tracking-wide';

// ─── Dynamic card width based on section content ───────────────────────
function getCardWidthClass(sectionLabel: string): string {
  // Wide sections (320px) - complex UI with grids, color pickers, presets, etc.
  const wideSections = new Set([
    'Fill & Gradient', 'Gradient',
    'Cell Properties',
    'Shadow',
    'Reflection',
    'Text Content',
    'Formatting',
  ]);
  // Medium-wide sections (280px) - multiple fields, color rows, checkbox grids
  const mediumSections = new Set([
    'Typography',
    'Borders', 'Table Border',
    'Corner Radius',
    'Header Row',
    'Cell Styling', 'Cell Defaults',
    'Image Filters', 'Adjustments',
    'Stroke',
    'Glow',
    'Reorder',
  ]);

  if (wideSections.has(sectionLabel)) return 'w-[320px]';
  if (mediumSections.has(sectionLabel)) return 'w-[280px]';
  return 'w-[260px]';
}

function getCardWidthPx(sectionLabel: string): number {
  const wideSections = new Set([
    'Fill & Gradient', 'Gradient',
    'Cell Properties',
    'Shadow',
    'Reflection',
    'Text Content',
    'Formatting',
  ]);
  const mediumSections = new Set([
    'Typography',
    'Borders', 'Table Border',
    'Corner Radius',
    'Header Row',
    'Cell Styling', 'Cell Defaults',
    'Image Filters', 'Adjustments',
    'Stroke',
    'Glow',
    'Reorder',
  ]);

  if (wideSections.has(sectionLabel)) return 320;
  if (mediumSections.has(sectionLabel)) return 280;
  return 260;
}

// ─── Inline field helper ───────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

// ─── Checkbox row ──────────────────────────────────────────────────────
function CheckboxRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer" data-no-drag>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-border"
      />
      <span className="text-xs text-foreground">{label}</span>
    </label>
  );
}

// ─── Cell Properties sub-component ─────────────────────────────────
function CellPropertiesEditor({ element, props, update, compact }: { element: CanvasElement; props: TableProperties; update: (updates: Partial<TableProperties>) => void; compact?: boolean }) {
  // Sync with store's Alt-key cell selection from the canvas.
  // Only reflect the store selection when it belongs to THIS table — the
  // store tracks tableCellSelectTableId so selections stay scoped per table
  // (otherwise cells at the same {row, col} in other tables would light up).
  const storeSelectedTableCells = useDesignerStore((s) => s.selectedTableCells);
  const tableCellSelectTableId = useDesignerStore((s) => s.tableCellSelectTableId);
  // Only reflect the store selection when it belongs to THIS table. Memoized
  // so the dependency identity stays stable for useCallback/useMemo below.
  const storeSelectionForThisTable = useMemo(
    () => (tableCellSelectTableId === element.id ? storeSelectedTableCells : []),
    [tableCellSelectTableId, element.id, storeSelectedTableCells]
  );
  const [localSelectedCells, setLocalSelectedCells] = useState<Set<string>>(new Set());

  // Merge store's canvas cell selection with local selection.
  // Store selection takes priority when present (from Alt+click on canvas).
  const selectedCells = storeSelectionForThisTable.length > 0
    ? new Set(storeSelectionForThisTable.map(cell => `${cell.row}-${cell.col}`))
    : localSelectedCells;

  // Wrapper for setSelectedCells that updates local state and clears store selection
  const setSelectedCells = useCallback((updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    // Clear store selection when using the card mini-table to select
    if (storeSelectionForThisTable.length > 0) {
      useDesignerStore.getState().clearTableCellSelection();
    }
    setLocalSelectedCells((prev) => {
      const resolved = typeof updater === 'function' ? updater(storeSelectionForThisTable.length > 0 ? new Set(storeSelectionForThisTable.map(cell => `${cell.row}-${cell.col}`)) : prev) : updater;
      return resolved;
    });
  }, [storeSelectionForThisTable]);

  const getCellOverride = (r: number, c: number): CellOverride => {
    return props.cellOverrides[`${r}-${c}`] || {};
  };

  const updateCellOverride = (r: number, c: number, updates: Partial<CellOverride>) => {
    const key = `${r}-${c}`;
    const existing = props.cellOverrides[key] ?? {};
    const newOverrides = { ...props.cellOverrides, [key]: { ...existing, ...updates } };
    update({ cellOverrides: newOverrides });
  };

  const clearCellOverride = (r: number, c: number) => {
    const key = `${r}-${c}`;
    const newOverrides = { ...props.cellOverrides };
    delete newOverrides[key];
    update({ cellOverrides: newOverrides });
  };

  // ---- Multi-cell helpers ----

  const toggleCellSelection = (r: number, c: number, multi: boolean) => {
    const key = `${r}-${c}`;
    setSelectedCells((prev) => {
      const next = new Set(prev);
      if (multi) {
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
      } else {
        if (next.size === 1 && next.has(key)) {
          return prev;
        }
        next.clear();
        next.add(key);
      }
      return next;
    });
  };

  const parseCellKey = (key: string): { r: number; c: number } => {
    const [r, c] = key.split('-').map(Number);
    return { r, c };
  };

  // Update an override property for all selected cells at once
  const updateSelectedCellsOverride = (overrideUpdate: Partial<CellOverride>) => {
    const newOverrides = { ...props.cellOverrides };
    for (const key of selectedCells) {
      const existing = newOverrides[key] || {};
      const merged = { ...existing, ...overrideUpdate };
      const cleaned: CellOverride = {};
      for (const [k, v] of Object.entries(merged)) {
        if (v !== undefined) (cleaned as Record<string, unknown>)[k] = v;
      }
      if (Object.keys(cleaned).length === 0) {
        delete newOverrides[key];
      } else {
        newOverrides[key] = cleaned;
      }
    }
    update({ cellOverrides: newOverrides });
  };

  // Clear overrides for all selected cells
  const clearSelectedCellsOverrides = () => {
    const newOverrides = { ...props.cellOverrides };
    for (const key of selectedCells) {
      delete newOverrides[key];
    }
    update({ cellOverrides: newOverrides });
  };

  // Compute the common value of a property across all selected cells
  const getMultiCellValue = <T,>(
    getter: (r: number, c: number) => T,
    fallback: T
  ): { value: T; mixed: boolean } => {
    if (selectedCells.size === 0) return { value: fallback, mixed: false };
    const values: T[] = [];
    for (const key of selectedCells) {
      const { r, c } = parseCellKey(key);
      values.push(getter(r, c));
    }
    const first = values[0];
    const mixed = values.some((v) => v !== first);
    return { value: mixed ? fallback : first, mixed };
  };

  // Computed override values for selected cells
  const multiAlign = getMultiCellValue(
    (r, c) => getCellOverride(r, c).textAlign ?? 'left',
    'left'
  );
  const multiVAlign = getMultiCellValue(
    (r, c) => getCellOverride(r, c).verticalAlign ?? 'middle',
    'middle'
  );
  const multiPadding = getMultiCellValue(
    (r, c) => getCellOverride(r, c).padding ?? props.cellPadding,
    props.cellPadding
  );
  const multiBgColor = getMultiCellValue(
    (r, c) => getCellOverride(r, c).bgColor || props.cellBg,
    props.cellBg
  );
  const multiTextColor = getMultiCellValue(
    (r, c) => getCellOverride(r, c).color || props.cellColor,
    props.cellColor
  );
  const multiFontWeight = getMultiCellValue(
    (r, c) => getCellOverride(r, c).fontWeight || 'normal',
    'normal'
  );
  const multiFontFamily = getMultiCellValue(
    (r, c) => getCellOverride(r, c).fontFamily || props.fontFamily || 'Inter, sans-serif',
    props.fontFamily || 'Inter, sans-serif'
  );
  const multiFontSize = getMultiCellValue(
    (r, c) => getCellOverride(r, c).fontSize || props.fontSize,
    props.fontSize
  );
  const multiTextTransform = getMultiCellValue(
    (r, c) => getCellOverride(r, c).textTransform || 'none',
    'none'
  );

  // Linked cell border toggle — when toggling a side, also toggle the adjacent cell's opposite side
  const toggleCellBorderLinked = (r: number, c: number, side: 'borderTop' | 'borderRight' | 'borderBottom' | 'borderLeft') => {
    const current = props.cellOverrides[`${r}-${c}`] ?? {};
    const currentVal = current[side] ?? true;
    const newVal = !currentVal;

    const newOverrides = { ...props.cellOverrides };

    // Update the target cell
    const targetKey = `${r}-${c}`;
    const targetExisting = newOverrides[targetKey] || {};
    const targetMerged = { ...targetExisting, [side]: newVal };
    const targetCleaned: CellOverride = {};
    for (const [k, v] of Object.entries(targetMerged)) {
      if (v !== undefined) (targetCleaned as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(targetCleaned).length === 0) {
      delete newOverrides[targetKey];
    } else {
      newOverrides[targetKey] = targetCleaned;
    }

    // Determine adjacent cell and its opposite side
    let adjR = r;
    let adjC = c;
    let adjSide: 'borderTop' | 'borderRight' | 'borderBottom' | 'borderLeft' = side;

    switch (side) {
      case 'borderTop':
        adjR = r - 1;
        adjSide = 'borderBottom';
        break;
      case 'borderBottom':
        adjR = r + 1;
        adjSide = 'borderTop';
        break;
      case 'borderLeft':
        adjC = c - 1;
        adjSide = 'borderRight';
        break;
      case 'borderRight':
        adjC = c + 1;
        adjSide = 'borderLeft';
        break;
    }

    // Only update adjacent cell if it exists (not out of bounds)
    if (adjR >= 0 && adjR < props.rows && adjC >= 0 && adjC < props.cols) {
      const adjKey = `${adjR}-${adjC}`;
      const adjExisting = newOverrides[adjKey] || {};
      const adjMerged = { ...adjExisting, [adjSide]: newVal };
      const adjCleaned: CellOverride = {};
      for (const [k, v] of Object.entries(adjMerged)) {
        if (v !== undefined) (adjCleaned as Record<string, unknown>)[k] = v;
      }
      if (Object.keys(adjCleaned).length === 0) {
        delete newOverrides[adjKey];
      } else {
        newOverrides[adjKey] = adjCleaned;
      }
    }

    update({ cellOverrides: newOverrides });
  };

  return (
    <div className="space-y-2">
      <label className={labelCls}>Select Cell(s)</label>
      <p className="text-[9px] text-muted-foreground -mt-1">Click to select · Shift/Ctrl+Click to multi-select</p>
      <div className="max-h-32 overflow-auto border border-border rounded-md">
        <table className="w-full text-xs border-collapse">
          <tbody>
            {props.cellData.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => {
                  const cellKey = `${r}-${c}`;
                  const isSelected = selectedCells.has(cellKey);
                  const isHeader = r === 0 && props.showHeader;
                  return (
                    <td
                      key={c}
                      className={`border border-border/30 p-0 cursor-pointer ${
                        isSelected ? 'bg-black/10 ring-1 ring-black/30' : 'hover:bg-muted/50'
                      }`}
                      onClick={(e) => toggleCellSelection(r, c, e.shiftKey || e.ctrlKey || e.metaKey)}
                    >
                      <input
                        value={cell}
                        onChange={(e) => {
                          const newCellData = props.cellData.map((r2) => [...r2]);
                          newCellData[r][c] = e.target.value;
                          update({ cellData: newCellData });
                        }}
                        className="w-full text-[10px] p-1 bg-transparent outline-none truncate"
                        style={{
                          fontWeight: isHeader ? props.headerFontWeight : 'normal',
                          color: isHeader ? props.headerColor : props.cellColor,
                          minWidth: props.cols <= 4 ? 50 : 36,
                        }}
                        onClick={(e) => { e.stopPropagation(); toggleCellSelection(r, c, e.shiftKey || e.ctrlKey || e.metaKey); }}
                        data-no-drag
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!compact && selectedCells.size > 0 && (
        <div className="space-y-2 p-2 border border-border rounded-md bg-muted/20">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground font-medium">
              {selectedCells.size === 1
                ? `Cell (${parseCellKey([...selectedCells][0]).r + 1}, ${parseCellKey([...selectedCells][0]).c + 1})`
                : `${selectedCells.size} cells selected`}
            </span>
            <button
              data-no-drag
              className="text-[9px] text-destructive hover:underline"
              onClick={clearSelectedCellsOverrides}
            >
              Reset
            </button>
          </div>

          {/* Cell text — only shown for single selection */}
          {selectedCells.size === 1 && (() => {
            const { r, c } = parseCellKey([...selectedCells][0]);
            return (
              <Field label="Text">
                <input
                  data-no-drag
                  value={props.cellData[r]?.[c] ?? ''}
                  onChange={(e) => {
                    const newCellData = props.cellData.map((r2) => [...r2]);
                    newCellData[r][c] = e.target.value;
                    update({ cellData: newCellData });
                  }}
                  className={inputCls}
                />
              </Field>
            );
          })()}

          <Field label="H-Align">
            <select
              data-no-drag
              value={multiAlign.mixed ? '__mixed__' : multiAlign.value}
              onChange={(e) => { if (e.target.value !== '__mixed__') updateSelectedCellsOverride({ textAlign: e.target.value as CellOverride['textAlign'] }); }}
              className={selectCls}
            >
              {multiAlign.mixed && <option value="__mixed__">— mixed —</option>}
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
              <option value="justify">Justify</option>
            </select>
          </Field>

          <Field label="V-Align">
            <select
              data-no-drag
              value={multiVAlign.mixed ? '__mixed__' : multiVAlign.value}
              onChange={(e) => { if (e.target.value !== '__mixed__') updateSelectedCellsOverride({ verticalAlign: e.target.value as 'top' | 'middle' | 'bottom' }); }}
              className={selectCls}
            >
              {multiVAlign.mixed && <option value="__mixed__">— mixed —</option>}
              <option value="top">Top</option>
              <option value="middle">Middle</option>
              <option value="bottom">Bottom</option>
            </select>
          </Field>

          <Field label="Padding">
            <input
              data-no-drag
              type="number"
              min={0}
              max={20}
              value={multiPadding.mixed ? '' : multiPadding.value}
              placeholder={multiPadding.mixed ? 'mixed' : undefined}
              onChange={(e) => updateSelectedCellsOverride({ padding: +e.target.value })}
              className={inputCls}
            />
          </Field>

          <Field label="BG Color">
            <div className="flex items-center gap-1.5">
              {multiBgColor.mixed && <span className="text-[9px] text-muted-foreground italic">mixed</span>}
              <ColorInput
                value={multiBgColor.value}
                onChange={(v) => updateSelectedCellsOverride({ bgColor: v })}
                noDrag
              />
            </div>
          </Field>

          <Field label="Text Color">
            <div className="flex items-center gap-1.5">
              {multiTextColor.mixed && <span className="text-[9px] text-muted-foreground italic">mixed</span>}
              <ColorInput
                value={multiTextColor.value}
                onChange={(v) => updateSelectedCellsOverride({ color: v })}
                noDrag
              />
            </div>
          </Field>

          <Field label="Font Weight">
            <select
              data-no-drag
              value={multiFontWeight.mixed ? '__mixed__' : multiFontWeight.value}
              onChange={(e) => { if (e.target.value !== '__mixed__') updateSelectedCellsOverride({ fontWeight: e.target.value }); }}
              className={selectCls}
            >
              {multiFontWeight.mixed && <option value="__mixed__">— mixed —</option>}
              <option value="normal">Normal</option>
              <option value="bold">Bold</option>
              <option value="lighter">Lighter</option>
              <option value="500">500</option>
              <option value="600">600</option>
              <option value="700">700</option>
            </select>
          </Field>

          <Field label="Font Family">
            <select
              data-no-drag
              value={multiFontFamily.mixed ? '__mixed__' : multiFontFamily.value}
              onChange={(e) => { if (e.target.value !== '__mixed__') updateSelectedCellsOverride({ fontFamily: e.target.value }); }}
              className={selectCls}
            >
              {multiFontFamily.mixed && <option value="__mixed__">— mixed —</option>}
              {FONT_FAMILIES_GROUPED.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((f) => (
                    <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>

          <Field label="Font Size">
            <div className="flex items-center gap-1">
              {multiFontSize.mixed && <span className="text-[9px] text-muted-foreground italic">mixed</span>}
              <input
                data-no-drag
                type="number"
                value={multiFontSize.mixed ? '' : multiFontSize.value}
                placeholder={multiFontSize.mixed ? 'mixed' : undefined}
                onChange={(e) => updateSelectedCellsOverride({ fontSize: +e.target.value })}
                className={`${inputCls} flex-1`}
              />
              <span className="text-xs text-muted-foreground">px</span>
            </div>
          </Field>

          <Field label="Text Transform">
            <select
              data-no-drag
              value={multiTextTransform.mixed ? '__mixed__' : multiTextTransform.value}
              onChange={(e) => { if (e.target.value !== '__mixed__') updateSelectedCellsOverride({ textTransform: e.target.value as 'none' | 'uppercase' | 'lowercase' | 'capitalize' }); }}
              className={selectCls}
            >
              {multiTextTransform.mixed && <option value="__mixed__">— mixed —</option>}
              <option value="none">None</option>
              <option value="uppercase">UPPERCASE</option>
              <option value="lowercase">lowercase</option>
              <option value="capitalize">Capitalize</option>
            </select>
          </Field>

          {/* Justify columns/rows — equally space selected columns and rows */}
          {selectedCells.size > 0 && (() => {
            // Determine which columns and rows have at least one selected cell
            const selectedCols = new Set<number>();
            const selectedRows = new Set<number>();
            for (const key of selectedCells) {
              const { r, c } = parseCellKey(key);
              selectedCols.add(c);
              selectedRows.add(r);
            }
            const hasMultipleCols = selectedCols.size >= 2;
            const hasMultipleRows = selectedRows.size >= 2;

            const justifyColumns = () => {
              const cw = ensureColWidths(props.cols, props.colWidths);
              const cols = [...selectedCols].sort((a, b) => a - b);
              const totalWidth = cols.reduce((sum, c) => sum + (cw[c] || 1), 0);
              const equalWidth = totalWidth / cols.length;
              const newColWidths = [...cw];
              for (const c of cols) {
                newColWidths[c] = equalWidth;
              }
              update({ colWidths: newColWidths });
            };

            const justifyRows = () => {
              const rh = ensureRowHeights(props.rows, props.rowHeights);
              const rows = [...selectedRows].sort((a, b) => a - b);
              const totalHeight = rows.reduce((sum, r) => sum + (rh[r] || 1), 0);
              const equalHeight = totalHeight / rows.length;
              const newRowHeights = [...rh];
              for (const r of rows) {
                newRowHeights[r] = equalHeight;
              }
              update({ rowHeights: newRowHeights });
            };

            if (!hasMultipleCols && !hasMultipleRows) return null;

            return (
              <div className="flex gap-1.5">
                {hasMultipleCols && (
                  <button
                    data-no-drag
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[9px] font-medium rounded border border-border hover:bg-accent transition-colors"
                    onClick={justifyColumns}
                    title="Equalize selected column widths"
                  >
                    <Columns3 className="w-3 h-3" />
                    Justify Cols
                  </button>
                )}
                {hasMultipleRows && (
                  <button
                    data-no-drag
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[9px] font-medium rounded border border-border hover:bg-accent transition-colors"
                    onClick={justifyRows}
                    title="Equalize selected row heights"
                  >
                    <Rows3 className="w-3 h-3" />
                    Justify Rows
                  </button>
                )}
              </div>
            );
          })()}

          {/* Per-side cell border toggles — single cell only for simplicity */}
          {selectedCells.size === 1 && (() => {
            const { r, c } = parseCellKey([...selectedCells][0]);
            const cellOverride = getCellOverride(r, c);
            return (
              <>
                <Field label="Cell Borders">
                  <div className="flex items-center justify-center">
                    <div className="grid grid-cols-3 grid-rows-3 gap-0.5 w-fit">
                      <div />
                      <button
                        data-no-drag
                        className={`h-7 w-7 rounded flex items-center justify-center transition-colors ${
                          cellOverride.borderTop !== false ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground border border-border'
                        }`}
                        onClick={() => toggleCellBorderLinked(r, c, 'borderTop')}
                        title="Top cell border"
                      >
                        <PanelTop className="h-3.5 w-3.5" />
                      </button>
                      <div />
                      <button
                        data-no-drag
                        className={`h-7 w-7 rounded flex items-center justify-center transition-colors ${
                          cellOverride.borderLeft !== false ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground border border-border'
                        }`}
                        onClick={() => toggleCellBorderLinked(r, c, 'borderLeft')}
                        title="Left cell border"
                      >
                        <PanelLeft className="h-3.5 w-3.5" />
                      </button>
                      <div className="h-7 w-7 flex items-center justify-center">
                        <Square className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <button
                        data-no-drag
                        className={`h-7 w-7 rounded flex items-center justify-center transition-colors ${
                          cellOverride.borderRight !== false ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground border border-border'
                        }`}
                        onClick={() => toggleCellBorderLinked(r, c, 'borderRight')}
                        title="Right cell border"
                      >
                        <PanelRight className="h-3.5 w-3.5" />
                      </button>
                      <div />
                      <button
                        data-no-drag
                        className={`h-7 w-7 rounded flex items-center justify-center transition-colors ${
                          cellOverride.borderBottom !== false ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground border border-border'
                        }`}
                        onClick={() => toggleCellBorderLinked(r, c, 'borderBottom')}
                        title="Bottom cell border"
                      >
                        <PanelBottom className="h-3.5 w-3.5" />
                      </button>
                      <div />
                    </div>
                  </div>
                </Field>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0 text-[9px] text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${cellOverride.borderTop !== false ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                    Top
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${cellOverride.borderRight !== false ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                    Right
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${cellOverride.borderBottom !== false ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                    Bottom
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${cellOverride.borderLeft !== false ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                    Left
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}
      {compact && selectedCells.size > 0 && (
        <p className="text-[9px] text-muted-foreground italic">
          {selectedCells.size === 1
            ? `1 cell selected — click to edit`
            : `${selectedCells.size} cells selected — click to edit`}
        </p>
      )}
    </div>
  );
}

// ─── ReorderCardContent: combined rows & columns reorder with tab toggle ─────
function ReorderCardContent({
  props,
  onRowReorder,
  onColReorder,
}: {
  props: TableProperties;
  onRowReorder: (fromIndex: number, toIndex: number) => void;
  onColReorder: (fromIndex: number, toIndex: number) => void;
}) {
  const [tab, setTab] = useState<'rows' | 'cols'>('rows');

  const rowNames = props.rowNames ?? Array.from({ length: props.cellData.length }, (_, i) => `Row ${i + 1}`);
  const colNames = props.colNames ?? Array.from({ length: props.cols }, (_, i) => `Column ${i + 1}`);

  const rowItems: ReorderItem[] = props.cellData.map((_, i) => ({
    id: `row-${i}`,
    label: rowNames[i],
    color: props.rowBgColors[i] || undefined,
  }));

  const colItems: ReorderItem[] = Array.from({ length: props.cols }, (_, i) => ({
    id: `col-${i}`,
    label: colNames[i],
    color: props.colBgColors[i] || undefined,
  }));

  return (
    <div className="space-y-2">
      {/* Tab toggle */}
      <div className="flex rounded-md bg-muted/50 p-0.5">
        <button
          data-no-drag
          className={`flex-1 text-[10px] font-medium py-1 rounded-sm transition-colors ${
            tab === 'rows'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('rows')}
        >
          Rows
        </button>
        <button
          data-no-drag
          className={`flex-1 text-[10px] font-medium py-1 rounded-sm transition-colors ${
            tab === 'cols'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('cols')}
        >
          Columns
        </button>
      </div>

      {/* Draggable list */}
      <div data-no-drag className="relative">
        {tab === 'rows' ? (
          <DraggableReorderList items={rowItems} onReorder={onRowReorder} maxHeight={140} />
        ) : (
          <DraggableReorderList items={colItems} onReorder={onColReorder} maxHeight={140} />
        )}
      </div>
    </div>
  );
}

// ─── Static Formatting Toolbar ──────────────────────────────────────────
// A compact toolbar that modifies TextProperties directly (without an active editor).
// Shown in the floating card's "Formatting" section when the text element is NOT
// being actively edited on canvas. Mirrors the look of FormattingToolbar but
// operates on the element's base/default properties.

// Reuse the shared catalog (src/lib/fonts.ts) so the static formatting toolbar
// offers the same font list as the inline editor, cards, and panel.
const FONT_FAMILIES_STATIC = FONT_FAMILIES;

const FONT_SIZES_STATIC = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72];

function StaticToolbarButton({ active, onClick, title, children }: {
  active?: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`p-1 rounded transition-colors ${
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-foreground'
      }`}
      title={title}
      data-no-drag
    >
      {children}
    </button>
  );
}

function StaticToolbarDivider() {
  return <div className="w-px h-5 bg-border mx-0.5 shrink-0" />;
}

export function StaticFormattingToolbar({ data, update }: {
  data: TextProperties;
  update: (updates: Partial<TextProperties>) => void;
}) {
  return (
    <div className="space-y-1.5 p-1.5 bg-popover border border-border rounded-lg select-none" data-no-drag>
      {/* Row 1: Font Family + Font Size + Letter Spacing + Color — wraps to prevent overflow */}
      <div className="flex items-center gap-1 flex-wrap">
        {/* Font Family */}
        <LabeledSelect
          label="Font"
          value={data.fontFamily}
          onChange={(e) => update({ fontFamily: e.target.value })}
          onMouseDown={(e) => e.stopPropagation()}
          title="Font Family"
          className="flex-1 min-w-[60px]"
        >
          {FONT_FAMILIES_GROUPED.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((f) => (
                <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
              ))}
            </optgroup>
          ))}
        </LabeledSelect>

        {/* Font Size */}
        <LabeledSelect
          label="Size"
          value={FONT_SIZES_STATIC.includes(data.fontSize) ? String(data.fontSize) : '__custom__'}
          onChange={(e) => {
            if (e.target.value !== '__custom__') {
              update({ fontSize: Number(e.target.value) });
            }
          }}
          onMouseDown={(e) => e.stopPropagation()}
          title="Font Size"
          className="w-[60px]"
        >
          {!FONT_SIZES_STATIC.includes(data.fontSize) && (
            <option value="__custom__">{data.fontSize}px</option>
          )}
          {FONT_SIZES_STATIC.map((s) => (
            <option key={s} value={s}>{s}px</option>
          ))}
        </LabeledSelect>

        {/* Letter Spacing */}
        <LabeledSelect
          label="Spacing"
          value={(() => {
            const ls = data.letterSpacing;
            const predefined = [-2, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20];
            return predefined.includes(ls) ? String(ls) : '__custom__';
          })()}
          onChange={(e) => {
            if (e.target.value !== '__custom__') {
              update({ letterSpacing: Number(e.target.value) });
            }
          }}
          onMouseDown={(e) => e.stopPropagation()}
          title="Letter Spacing"
          className="w-[72px]"
        >
          {(() => {
            const predefined = [-2, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20];
            if (!predefined.includes(data.letterSpacing)) {
              return <option value="__custom__">{data.letterSpacing}px</option>;
            }
            return null;
          })()}
          {[-2, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map((s) => (
            <option key={s} value={s}>{s}px</option>
          ))}
        </LabeledSelect>

        {/* Text Color */}
        <label className="relative cursor-pointer shrink-0" title="Text Color">
          <input
            type="color"
            data-no-drag
            className="absolute inset-0 opacity-0 cursor-pointer w-7 h-7"
            defaultValue={data.color}
            onInput={(e) => update({ color: (e.target as HTMLInputElement).value })}
            onChange={(e) => update({ color: (e.target as HTMLInputElement).value })}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <div className="p-1 rounded hover:bg-muted">
            <Type className="h-3.5 w-3.5" />
            <div
              className="h-0.5 mt-0.5 rounded-full"
              style={{ backgroundColor: data.color }}
            />
          </div>
        </label>
      </div>

      {/* Row 2: Bold, Italic, Underline, Strikethrough | Align Left, Center, Right, Justify — wraps to prevent overflow */}
      <div className="flex items-center gap-0.5 flex-wrap">
        <StaticToolbarButton
          active={data.fontWeight === 'bold' || data.fontWeight === '700'}
          onClick={() => update({ fontWeight: (data.fontWeight === 'bold' || data.fontWeight === '700') ? 'normal' : 'bold' })}
          title="Bold"
        >
          <Bold className="h-3.5 w-3.5" />
        </StaticToolbarButton>

        <StaticToolbarButton
          active={data.fontStyle === 'italic'}
          onClick={() => update({ fontStyle: data.fontStyle === 'italic' ? 'normal' : 'italic' })}
          title="Italic"
        >
          <Italic className="h-3.5 w-3.5" />
        </StaticToolbarButton>

        <StaticToolbarButton
          active={data.textDecoration === 'underline'}
          onClick={() => update({ textDecoration: data.textDecoration === 'underline' ? 'none' : 'underline' })}
          title="Underline"
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </StaticToolbarButton>

        <StaticToolbarButton
          active={data.textDecoration === 'line-through'}
          onClick={() => update({ textDecoration: data.textDecoration === 'line-through' ? 'none' : 'line-through' })}
          title="Strikethrough"
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </StaticToolbarButton>

        <StaticToolbarDivider />

        <StaticToolbarButton
          active={data.textAlign === 'left'}
          onClick={() => update({ textAlign: 'left' })}
          title="Align Left"
        >
          <AlignLeft className="h-3.5 w-3.5" />
        </StaticToolbarButton>
        <StaticToolbarButton
          active={data.textAlign === 'center'}
          onClick={() => update({ textAlign: 'center' })}
          title="Align Center"
        >
          <AlignCenter className="h-3.5 w-3.5" />
        </StaticToolbarButton>
        <StaticToolbarButton
          active={data.textAlign === 'right'}
          onClick={() => update({ textAlign: 'right' })}
          title="Align Right"
        >
          <AlignRight className="h-3.5 w-3.5" />
        </StaticToolbarButton>
        <StaticToolbarButton
          active={data.textAlign === 'justify'}
          onClick={() => update({ textAlign: 'justify' })}
          title="Justify"
        >
          <AlignJustify className="h-3.5 w-3.5" />
        </StaticToolbarButton>
      </div>
    </div>
  );
}

// Property content renderer - renders the actual form fields for each section
// Exported so spotlight-overlay.tsx can reuse it for preview cards
// Wrapped in React.memo to prevent re-renders when only the card position changes
export const PropertyContent = memo(function PropertyContent({ sectionLabel, element, compact, multiSelectIds }: { sectionLabel: string; element: CanvasElement; compact?: boolean; multiSelectIds?: string[] }) {
  const updateElement = useDesignerStore((s) => s.updateElement);
  const updateElementProperties = useDesignerStore((s) => s.updateElementProperties);
  const alignElementHorizontalCenter = useDesignerStore((s) => s.alignElementHorizontalCenter);
  const alignElementVerticalCenter = useDesignerStore((s) => s.alignElementVerticalCenter);
  // Multi-select block alignment — shifts all selected elements as a group,
  // preserving their relative positions (mirrors grouped-element alignment).
  const alignElementsHorizontalCenter = useDesignerStore((s) => s.alignElementsHorizontalCenter);
  const alignElementsVerticalCenter = useDesignerStore((s) => s.alignElementsVerticalCenter);
  // Multi-select & group opacity setter — subscribed (not getState()) so the
  // callback identity is stable and the slider's onValueChange fires correctly.
  const setElementsOpacity = useDesignerStore((s) => s.setElementsOpacity);
  // Subscribe to editing state so the Formatting section re-renders
  // when the user starts/stops editing a text element
  const editingTextElementId = useDesignerStore((s) => s.editingTextElementId);
  const activeTextEditor = useDesignerStore((s) => s.activeTextEditor);
  // Rectangle rotation setter — used by the 'Transform' card section.
  const setRectRotation = useDesignerStore((s) => s.setRectRotation);

  // Helper to get props data based on element type
  const getProps = () => {
    return element.properties as { type: string; data: Record<string, unknown> };
  };

  const updateProps = (updates: Record<string, unknown>) => {
    const props = getProps();
    updateElementProperties(element.id, {
      type: props.type as 'text' | 'table' | 'image' | 'line' | 'rectangle' | 'ellipse',
      data: { ...props.data, ...updates },
    } as unknown as ElementProperties);
  };

  // Render based on section label
  switch (sectionLabel) {
    // ─── COMMON: Position ──────────────────────────────────────────
    case 'Position': {
      if (element.type === 'line') return <div className="text-xs text-muted-foreground italic">Use Endpoints section</div>;
      return (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>X</label>
            <input data-no-drag type="number" value={Math.round(element.x)} onChange={(e) => updateElement(element.id, { x: +e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Y</label>
            <input data-no-drag type="number" value={Math.round(element.y)} onChange={(e) => updateElement(element.id, { y: +e.target.value })} className={inputCls} />
          </div>
        </div>
      );
    }

    // ─── COMMON: Size ──────────────────────────────────────────────
    case 'Size': {
      return (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Width</label>
            <input data-no-drag type="number" value={Math.round(element.width)} onChange={(e) => updateElement(element.id, { width: Math.max(10, +e.target.value) })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Height</label>
            <input data-no-drag type="number" value={Math.round(element.height)} onChange={(e) => updateElement(element.id, { height: Math.max(10, +e.target.value) })} className={inputCls} />
          </div>
        </div>
      );
    }

    // ─── COMMON: Alignment ─────────────────────────────────────────
    case 'Alignment': {
      // When multiple elements are selected, align them as a BLOCK (preserving
      // their relative positions) via the multi-select actions. Single element
      // uses the standard single-element align.
      const isMulti = !!(multiSelectIds && multiSelectIds.length > 1);
      const ids = isMulti ? multiSelectIds! : [element.id];
      const onHCenter = isMulti
        ? () => alignElementsHorizontalCenter(ids)
        : () => alignElementHorizontalCenter(element.id);
      const onVCenter = isMulti
        ? () => alignElementsVerticalCenter(ids)
        : () => alignElementVerticalCenter(element.id);
      return (
        <div className="flex gap-1.5">
          <button data-no-drag className="flex-1 h-7 text-[10px] border border-border rounded hover:bg-accent transition-colors" onClick={onHCenter}>H-Center</button>
          <button data-no-drag className="flex-1 h-7 text-[10px] border border-border rounded hover:bg-accent transition-colors" onClick={onVCenter}>V-Center</button>
        </div>
      );
    }

    // ─── TEXT: Formatting ────────────────────────────────────────
    case 'Formatting': {
      if (element.type === 'text') {
        const data = (element.properties as { type: 'text'; data: TextProperties }).data;
        // Update function that handles textAlign changes in HTML content
        // (same logic as the properties panel)
        const update = (updates: Partial<TextProperties>) => {
          let finalUpdates = updates;
          if (updates.textAlign) {
            if (activeTextEditor && editingTextElementId === element.id) {
              // While editing: use TipTap's setTextAlign to update all paragraphs
              activeTextEditor.chain().focus().setTextAlign(updates.textAlign).run();
            } else {
              // While not editing: update the HTML content directly to change/add
              // text-align on all block-level elements
              const align = updates.textAlign;
              let updatedContent = data.content;
              updatedContent = updatedContent.replace(
                /(<(?:p|h[1-6]|li|div|blockquote)[^>]*?style=")([^"]*)(")/gi,
                (_match: string, styleStart: string, styleContent: string, styleEnd: string) => {
                  if (styleContent.includes('text-align')) {
                    return `${styleStart}${styleContent.replace(/text-align:\s*[^;"]+/gi, `text-align: ${align}`)}${styleEnd}`;
                  }
                  const sep = styleContent && !styleContent.endsWith(';') ? ';' : '';
                  return `${styleStart}${styleContent}${sep}text-align: ${align}${styleEnd}`;
                }
              );
              updatedContent = updatedContent.replace(
                /<(p|h[1-6]|li|div|blockquote)(\s[^>]*?)?>/gi,
                (match: string, tag: string, attrs: string | undefined) => {
                  if (attrs && attrs.includes('style=')) return match;
                  return `<${tag}${attrs || ''} style="text-align: ${align}">`;
                }
              );
              finalUpdates = { ...updates, content: updatedContent };
            }
          }
          updateElementProperties(element.id, { type: 'text', data: { ...data, ...finalUpdates } });
        };

        if (activeTextEditor && editingTextElementId === element.id) {
          // When actively editing: use the rich TipTap-connected toolbar
          // for per-character/per-selection formatting
          return <FormattingToolbar editor={activeTextEditor} baseProps={data} />;
        }
        // When NOT editing: show a static toolbar that modifies the
        // element's base/default text properties directly
        return <StaticFormattingToolbar data={data} update={update} />;
      }
      return (
        <div className="text-xs text-muted-foreground italic">
          Select a text element to apply formatting.
        </div>
      );
    }

    // ─── TEXT: Typography ──────────────────────────────────────────
    case 'Typography': {
      const data = (element.properties as { type: 'text'; data: TextProperties }).data;
      const update = (updates: Partial<TextProperties>) => {
        updateElementProperties(element.id, { type: 'text', data: { ...data, ...updates } });
      };
      return (
        <div className="space-y-2">
          <p className="text-[9px] text-muted-foreground">Base styles for all text. Use inline editor for per-character formatting.</p>
          <Field label="Font Size">
            <SliderField value={[data.fontSize]} min={6} max={100} step={1} unit="px" colorTheme="purple" onValueChange={([v]) => update({ fontSize: v })} compact />
          </Field>
          <Field label="Font Family">
            <select data-no-drag value={data.fontFamily} onChange={(e) => update({ fontFamily: e.target.value })} className={selectCls}>
              {FONT_FAMILIES_GROUPED.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((f) => (
                    <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="Weight">
            <select data-no-drag value={data.fontWeight} onChange={(e) => update({ fontWeight: e.target.value })} className={selectCls}>
              <option value="normal">Normal</option>
              <option value="bold">Bold</option>
              <option value="lighter">Lighter</option>
              <option value="100">100</option>
              <option value="300">300</option>
              <option value="500">500</option>
              <option value="700">700</option>
              <option value="900">900</option>
            </select>
          </Field>
          <Field label="Style">
            <select data-no-drag value={data.fontStyle} onChange={(e) => update({ fontStyle: e.target.value })} className={selectCls}>
              <option value="normal">Normal</option>
              <option value="italic">Italic</option>
            </select>
          </Field>
          <Field label="Decoration">
            <select data-no-drag value={data.textDecoration} onChange={(e) => update({ textDecoration: e.target.value })} className={selectCls}>
              <option value="none">None</option>
              <option value="underline">Underline</option>
              <option value="line-through">Strikethrough</option>
              <option value="overline">Overline</option>
            </select>
          </Field>
          <Field label="Transform">
            <select data-no-drag value={data.textTransform} onChange={(e) => update({ textTransform: e.target.value as 'none' | 'uppercase' | 'lowercase' | 'capitalize' })} className={selectCls}>
              <option value="none">None</option>
              <option value="uppercase">UPPERCASE</option>
              <option value="lowercase">lowercase</option>
              <option value="capitalize">Capitalize</option>
            </select>
          </Field>
        </div>
      );
    }

    // ─── TEXT: Alignment & Spacing ─────────────────────────────────
    case 'Alignment & Spacing': {
      const data = (element.properties as { type: 'text'; data: TextProperties }).data;
      const update = (updates: Partial<TextProperties>) => {
        let finalUpdates = updates;
        // When textAlign is changed, apply it to the entire content
        if (updates.textAlign) {
          if (activeTextEditor && editingTextElementId === element.id) {
            // While editing: use TipTap's setTextAlign to update all paragraphs
            activeTextEditor.chain().focus().setTextAlign(updates.textAlign).run();
          } else {
            // While not editing: update the HTML content directly to change/add
            // text-align on all block-level elements (p, h1-h6, li, etc.)
            const align = updates.textAlign;
            let updatedContent = data.content;
            // Step 1: For tags with style="..." — replace or add text-align
            updatedContent = updatedContent.replace(
              /(<(?:p|h[1-6]|li|div|blockquote)[^>]*?style=")([^"]*)(")/gi,
              (_match: string, styleStart: string, styleContent: string, styleEnd: string) => {
                if (styleContent.includes('text-align')) {
                  return `${styleStart}${styleContent.replace(/text-align:\s*[^;"]+/gi, `text-align: ${align}`)}${styleEnd}`;
                }
                const sep = styleContent && !styleContent.endsWith(';') ? ';' : '';
                return `${styleStart}${styleContent}${sep}text-align: ${align}${styleEnd}`;
              }
            );
            // Step 2: For tags without any style attribute — add style="text-align: X"
            updatedContent = updatedContent.replace(
              /<(p|h[1-6]|li|div|blockquote)(\s[^>]*?)?>/gi,
              (match: string, tag: string, attrs: string | undefined) => {
                if (attrs && attrs.includes('style=')) return match;
                return `<${tag}${attrs || ''} style="text-align: ${align}">`;
              }
            );
            finalUpdates = { ...updates, content: updatedContent };
          }
        }
        updateElementProperties(element.id, { type: 'text', data: { ...data, ...finalUpdates } });
      };
      return (
        <div className="space-y-2">
          <Field label="Align">
            <select data-no-drag value={data.textAlign} onChange={(e) => update({ textAlign: e.target.value as 'left' | 'center' | 'right' | 'justify' })} className={selectCls}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
              <option value="justify">Justify</option>
            </select>
          </Field>
          <Field label="Line Height">
            <SliderField value={[Math.round(data.lineHeight * 100)]} min={80} max={300} step={10} unit="%" colorTheme="green" onValueChange={([v]) => update({ lineHeight: v / 100 })} compact />
          </Field>
          <Field label="Letter Spacing">
            <SliderField value={[data.letterSpacing]} min={-5} max={20} step={0.5} unit="px" colorTheme="teal" onValueChange={([v]) => update({ letterSpacing: v })} compact />
          </Field>
        </div>
      );
    }

    // ─── TEXT: Color ───────────────────────────────────────────────
    case 'Color': {
      const data = (element.properties as { type: 'text'; data: TextProperties }).data;
      const update = (updates: Partial<TextProperties>) => {
        updateElementProperties(element.id, { type: 'text', data: { ...data, ...updates } });
      };
      return (
        <div className="space-y-2">
          <Field label="Color">
            <ColorInput value={data.color} onChange={(v) => update({ color: v })} noDrag />
          </Field>
          <Field label="Opacity">
            <SliderField value={[Math.round(data.opacity * 100)]} min={0} max={100} step={1} unit="%" colorTheme="gray" onValueChange={([v]) => update({ opacity: v / 100 })} compact />
          </Field>
        </div>
      );
    }

    // ─── TABLE: Structure ──────────────────────────────────────────
    case 'Structure': {
      const rawProps = (element.properties as { type: 'table'; data: TableProperties }).data;
      const props: TableProperties = {
        rows: rawProps.rows ?? 4,
        cols: rawProps.cols ?? 3,
        cellData: rawProps.cellData ?? [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']],
        cellOverrides: rawProps.cellOverrides ?? {},
        showHeader: rawProps.showHeader ?? true,
        headerBg: rawProps.headerBg ?? '#f3f4f6',
        headerColor: rawProps.headerColor ?? '#111827',
        headerFontWeight: rawProps.headerFontWeight ?? 'bold',
        cellBg: rawProps.cellBg ?? '#ffffff',
        cellColor: rawProps.cellColor ?? '#374151',
        cellPadding: rawProps.cellPadding ?? 8,
        fontFamily: rawProps.fontFamily ?? 'Inter, sans-serif',
        fontSize: rawProps.fontSize ?? 13,
        rowBgColors: rawProps.rowBgColors ?? {},
        colBgColors: rawProps.colBgColors ?? {},
        borderWidth: rawProps.borderWidth ?? 1,
        borderStyle: rawProps.borderStyle ?? 'solid',
        borderColor: rawProps.borderColor ?? '#d1d5db',
        showBorderTop: rawProps.showBorderTop ?? true,
        showBorderRight: rawProps.showBorderRight ?? true,
        showBorderBottom: rawProps.showBorderBottom ?? true,
        showBorderLeft: rawProps.showBorderLeft ?? true,
        showInnerBorders: rawProps.showInnerBorders ?? true,
        cornerRadius: rawProps.cornerRadius ?? { mode: 'linked', all: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
        colWidths: rawProps.colWidths ?? Array(rawProps.cols ?? 3).fill(1),
        rowHeights: rawProps.rowHeights ?? Array(rawProps.rows ?? 4).fill(1),
        rowNames: rawProps.rowNames ?? Array.from({ length: rawProps.rows ?? 4 }, (_, i) => `Row ${i + 1}`),
        colNames: rawProps.colNames ?? Array.from({ length: rawProps.cols ?? 3 }, (_, i) => `Column ${i + 1}`),
        opacity: rawProps.opacity ?? 1,
      };
      const update = (updates: Partial<TableProperties>) => {
        // Read latest data from store to avoid stale closure (e.g. after col/row resize)
        const currentEl = useDesignerStore.getState().elements.find((el) => el.id === element.id);
        const currentData = currentEl ? (currentEl.properties as { type: 'table'; data: TableProperties }).data : props;
        updateElementProperties(element.id, { type: 'table', data: { ...currentData, ...updates } });
      };

      const addRow = () => {
        // Read latest data from store to avoid stale closure issues
        const currentEl = useDesignerStore.getState().elements.find((el) => el.id === element.id);
        const currentData = currentEl ? (currentEl.properties as { type: 'table'; data: TableProperties }).data : props;
        const newRow = Array(currentData.cols).fill('');
        const newCellData = [...currentData.cellData.map((r) => [...r]), newRow];
        const newRowHeights = [...(currentData.rowHeights ?? Array(currentData.rows).fill(1)), 1];
        const newRowNames = [...(currentData.rowNames ?? Array.from({ length: currentData.rows }, (_, i) => `Row ${i + 1}`)), `Row ${currentData.rows + 1}`];
        update({ rows: currentData.rows + 1, cellData: newCellData, rowHeights: newRowHeights, rowNames: newRowNames });
      };

      const addColumn = () => {
        // Read latest data from store to avoid stale closure issues
        const currentEl = useDesignerStore.getState().elements.find((el) => el.id === element.id);
        const currentData = currentEl ? (currentEl.properties as { type: 'table'; data: TableProperties }).data : props;
        const newCellData = currentData.cellData.map((row) => [...row, '']);
        const newColWidths = [...(currentData.colWidths ?? Array(currentData.cols).fill(1)), 1];
        const newColNames = [...(currentData.colNames ?? Array.from({ length: currentData.cols }, (_, i) => `Column ${i + 1}`)), `Column ${currentData.cols + 1}`];
        update({ cols: currentData.cols + 1, cellData: newCellData, colWidths: newColWidths, colNames: newColNames });
      };

      return (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Rows</label>
              <input
                data-no-drag
                type="number"
                min={1}
                max={50}
                value={props.rows}
                onChange={(e) => {
                  const newRows = Math.max(1, +e.target.value);
                  const newCellData: string[][] = [];
                  const newRowHeights: number[] = [];
                  const newRowNames: string[] = [];
                  const currentRowNames = props.rowNames ?? Array.from({ length: props.rows }, (_, i) => `Row ${i + 1}`);
                  for (let r = 0; r < newRows; r++) {
                    newCellData[r] = [];
                    for (let c = 0; c < props.cols; c++) {
                      newCellData[r][c] = props.cellData[r]?.[c] || '';
                    }
                    newRowHeights[r] = (props.rowHeights ?? Array(props.rows).fill(1))[r] ?? 1;
                    newRowNames[r] = currentRowNames[r] ?? `Row ${r + 1}`;
                  }
                  update({ rows: newRows, cellData: newCellData, rowHeights: newRowHeights, rowNames: newRowNames });
                }}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Columns</label>
              <input
                data-no-drag
                type="number"
                min={1}
                max={20}
                value={props.cols}
                onChange={(e) => {
                  const newCols = Math.max(1, +e.target.value);
                  const newCellData = props.cellData.map((row) => {
                    const newRow: string[] = [];
                    for (let c = 0; c < newCols; c++) {
                      newRow[c] = row[c] || '';
                    }
                    return newRow;
                  });
                  const newColWidths: number[] = [];
                  const newColNames: string[] = [];
                  const currentColNames = props.colNames ?? Array.from({ length: props.cols }, (_, i) => `Column ${i + 1}`);
                  for (let c = 0; c < newCols; c++) {
                    newColWidths[c] = (props.colWidths ?? Array(props.cols).fill(1))[c] ?? 1;
                    newColNames[c] = currentColNames[c] ?? `Column ${c + 1}`;
                  }
                  update({ cols: newCols, cellData: newCellData, colWidths: newColWidths, colNames: newColNames });
                }}
                className={inputCls}
              />
            </div>
          </div>
          <div className="flex gap-1.5">
            <button data-no-drag className="flex-1 h-7 text-[10px] border border-border rounded hover:bg-accent transition-colors" onClick={addRow}>+ Row</button>
            <button data-no-drag className="flex-1 h-7 text-[10px] border border-border rounded hover:bg-accent transition-colors" onClick={addColumn}>+ Col</button>
          </div>
        </div>
      );
    }

    // ─── TABLE: Header Row ─────────────────────────────────────────
    case 'Header Row': {
      const rawProps = (element.properties as { type: 'table'; data: TableProperties }).data;
      const props: TableProperties = {
        rows: rawProps.rows ?? 4,
        cols: rawProps.cols ?? 3,
        cellData: rawProps.cellData ?? [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']],
        cellOverrides: rawProps.cellOverrides ?? {},
        showHeader: rawProps.showHeader ?? true,
        headerBg: rawProps.headerBg ?? '#f3f4f6',
        headerColor: rawProps.headerColor ?? '#111827',
        headerFontWeight: rawProps.headerFontWeight ?? 'bold',
        cellBg: rawProps.cellBg ?? '#ffffff',
        cellColor: rawProps.cellColor ?? '#374151',
        cellPadding: rawProps.cellPadding ?? 8,
        fontFamily: rawProps.fontFamily ?? 'Inter, sans-serif',
        fontSize: rawProps.fontSize ?? 13,
        rowBgColors: rawProps.rowBgColors ?? {},
        colBgColors: rawProps.colBgColors ?? {},
        borderWidth: rawProps.borderWidth ?? 1,
        borderStyle: rawProps.borderStyle ?? 'solid',
        borderColor: rawProps.borderColor ?? '#d1d5db',
        showBorderTop: rawProps.showBorderTop ?? true,
        showBorderRight: rawProps.showBorderRight ?? true,
        showBorderBottom: rawProps.showBorderBottom ?? true,
        showBorderLeft: rawProps.showBorderLeft ?? true,
        showInnerBorders: rawProps.showInnerBorders ?? true,
        cornerRadius: rawProps.cornerRadius ?? { mode: 'linked', all: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
        colWidths: rawProps.colWidths ?? Array(rawProps.cols ?? 3).fill(1),
        rowHeights: rawProps.rowHeights ?? Array(rawProps.rows ?? 4).fill(1),
        rowNames: rawProps.rowNames ?? Array.from({ length: rawProps.rows ?? 4 }, (_, i) => `Row ${i + 1}`),
        colNames: rawProps.colNames ?? Array.from({ length: rawProps.cols ?? 3 }, (_, i) => `Column ${i + 1}`),
        opacity: rawProps.opacity ?? 1,
      };
      const update = (updates: Partial<TableProperties>) => {
        // Read latest data from store to avoid stale closure (e.g. after col/row resize)
        const currentEl = useDesignerStore.getState().elements.find((el) => el.id === element.id);
        const currentData = currentEl ? (currentEl.properties as { type: 'table'; data: TableProperties }).data : props;
        updateElementProperties(element.id, { type: 'table', data: { ...currentData, ...updates } });
      };
      return (
        <div className="space-y-2">
          <CheckboxRow label="Show Header" checked={props.showHeader} onChange={(v) => update({ showHeader: v })} />
          {props.showHeader && (
            <>
              <Field label="Header BG">
                <ColorInput value={props.headerBg} onChange={(v) => update({ headerBg: v })} noDrag />
              </Field>
              <Field label="Header Color">
                <ColorInput value={props.headerColor} onChange={(v) => update({ headerColor: v })} noDrag />
              </Field>
              <Field label="Header Weight">
                <select data-no-drag value={props.headerFontWeight} onChange={(e) => update({ headerFontWeight: e.target.value })} className={selectCls}>
                  <option value="normal">Normal</option>
                  <option value="bold">Bold</option>
                  <option value="lighter">Lighter</option>
                  <option value="500">500</option>
                  <option value="600">600</option>
                  <option value="700">700</option>
                </select>
              </Field>
            </>
          )}
        </div>
      );
    }

    // ─── TABLE: Cell Defaults / Cell Styling ────────────────────
    case 'Cell Defaults':
    case 'Cell Styling': {
      const rawProps = (element.properties as { type: 'table'; data: TableProperties }).data;
      const props: TableProperties = {
        rows: rawProps.rows ?? 4,
        cols: rawProps.cols ?? 3,
        cellData: rawProps.cellData ?? [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']],
        cellOverrides: rawProps.cellOverrides ?? {},
        showHeader: rawProps.showHeader ?? true,
        headerBg: rawProps.headerBg ?? '#f3f4f6',
        headerColor: rawProps.headerColor ?? '#111827',
        headerFontWeight: rawProps.headerFontWeight ?? 'bold',
        cellBg: rawProps.cellBg ?? '#ffffff',
        cellColor: rawProps.cellColor ?? '#374151',
        cellPadding: rawProps.cellPadding ?? 8,
        fontFamily: rawProps.fontFamily ?? 'Inter, sans-serif',
        fontSize: rawProps.fontSize ?? 13,
        rowBgColors: rawProps.rowBgColors ?? {},
        colBgColors: rawProps.colBgColors ?? {},
        borderWidth: rawProps.borderWidth ?? 1,
        borderStyle: rawProps.borderStyle ?? 'solid',
        borderColor: rawProps.borderColor ?? '#d1d5db',
        showBorderTop: rawProps.showBorderTop ?? true,
        showBorderRight: rawProps.showBorderRight ?? true,
        showBorderBottom: rawProps.showBorderBottom ?? true,
        showBorderLeft: rawProps.showBorderLeft ?? true,
        showInnerBorders: rawProps.showInnerBorders ?? true,
        cornerRadius: rawProps.cornerRadius ?? { mode: 'linked', all: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
        colWidths: rawProps.colWidths ?? Array(rawProps.cols ?? 3).fill(1),
        rowHeights: rawProps.rowHeights ?? Array(rawProps.rows ?? 4).fill(1),
        rowNames: rawProps.rowNames ?? Array.from({ length: rawProps.rows ?? 4 }, (_, i) => `Row ${i + 1}`),
        colNames: rawProps.colNames ?? Array.from({ length: rawProps.cols ?? 3 }, (_, i) => `Column ${i + 1}`),
        opacity: rawProps.opacity ?? 1,
      };
      const update = (updates: Partial<TableProperties>) => {
        // Read latest data from store to avoid stale closure (e.g. after col/row resize)
        const currentEl = useDesignerStore.getState().elements.find((el) => el.id === element.id);
        const currentData = currentEl ? (currentEl.properties as { type: 'table'; data: TableProperties }).data : props;
        updateElementProperties(element.id, { type: 'table', data: { ...currentData, ...updates } });
      };
      return (
        <div className="space-y-2">
          <Field label="Cell BG">
            <ColorInput value={props.cellBg} onChange={(v) => update({ cellBg: v })} noDrag />
          </Field>
          <Field label="Cell Color">
            <ColorInput value={props.cellColor} onChange={(v) => update({ cellColor: v })} noDrag />
          </Field>
          <Field label="Cell Padding">
            <input data-no-drag type="number" value={props.cellPadding} onChange={(e) => update({ cellPadding: +e.target.value })} min={0} max={20} className={inputCls} />
          </Field>
          <Field label="Font Size">
            <SliderField value={[props.fontSize]} min={6} max={72} step={1} unit="px" colorTheme="purple" onValueChange={([v]) => update({ fontSize: v })} compact />
          </Field>
          <Field label="Font Family">
            <select data-no-drag value={props.fontFamily} onChange={(e) => update({ fontFamily: e.target.value })} className={selectCls}>
              {FONT_FAMILIES_GROUPED.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((f) => (
                    <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
        </div>
      );
    }

    // ─── TABLE: Remove Row ────────────────────────────────────────
    case 'Remove Row': {
      const rawProps = (element.properties as { type: 'table'; data: TableProperties }).data;
      const props: TableProperties = {
        rows: rawProps.rows ?? 4,
        cols: rawProps.cols ?? 3,
        cellData: rawProps.cellData ?? [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']],
        cellOverrides: rawProps.cellOverrides ?? {},
        showHeader: rawProps.showHeader ?? true,
        headerBg: rawProps.headerBg ?? '#f3f4f6',
        headerColor: rawProps.headerColor ?? '#111827',
        headerFontWeight: rawProps.headerFontWeight ?? 'bold',
        cellBg: rawProps.cellBg ?? '#ffffff',
        cellColor: rawProps.cellColor ?? '#374151',
        cellPadding: rawProps.cellPadding ?? 8,
        fontFamily: rawProps.fontFamily ?? 'Inter, sans-serif',
        fontSize: rawProps.fontSize ?? 13,
        rowBgColors: rawProps.rowBgColors ?? {},
        colBgColors: rawProps.colBgColors ?? {},
        borderWidth: rawProps.borderWidth ?? 1,
        borderStyle: rawProps.borderStyle ?? 'solid',
        borderColor: rawProps.borderColor ?? '#d1d5db',
        showBorderTop: rawProps.showBorderTop ?? true,
        showBorderRight: rawProps.showBorderRight ?? true,
        showBorderBottom: rawProps.showBorderBottom ?? true,
        showBorderLeft: rawProps.showBorderLeft ?? true,
        showInnerBorders: rawProps.showInnerBorders ?? true,
        cornerRadius: rawProps.cornerRadius ?? { mode: 'linked', all: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
        colWidths: rawProps.colWidths ?? Array(rawProps.cols ?? 3).fill(1),
        rowHeights: rawProps.rowHeights ?? Array(rawProps.rows ?? 4).fill(1),
        rowNames: rawProps.rowNames ?? Array.from({ length: rawProps.rows ?? 4 }, (_, i) => `Row ${i + 1}`),
        colNames: rawProps.colNames ?? Array.from({ length: rawProps.cols ?? 3 }, (_, i) => `Column ${i + 1}`),
        opacity: rawProps.opacity ?? 1,
      };
      const update = (updates: Partial<TableProperties>) => {
        // Read latest data from store to avoid stale closure (e.g. after col/row resize)
        const currentEl = useDesignerStore.getState().elements.find((el) => el.id === element.id);
        const currentData = currentEl ? (currentEl.properties as { type: 'table'; data: TableProperties }).data : props;
        updateElementProperties(element.id, { type: 'table', data: { ...currentData, ...updates } });
      };
      const removeRow = (idx: number) => {
        if (props.rows <= 1) return;
        const newCellData = props.cellData.filter((_, i) => i !== idx);
        const newRowHeights = (props.rowHeights ?? Array(props.rows).fill(1)).filter((_, i) => i !== idx);
        const newRowNames = (props.rowNames ?? Array.from({ length: props.rows }, (_, i) => `Row ${i + 1}`)).filter((_, i) => i !== idx);
        const newOverrides: Record<string, CellOverride> = {};
        for (const [key, val] of Object.entries(props.cellOverrides)) {
          const [r, c] = key.split('-').map(Number);
          if (r === idx) continue;
          const newR = r > idx ? r - 1 : r;
          newOverrides[`${newR}-${c}`] = val;
        }
        const newRowBg: Record<number, string> = {};
        for (const [k, v] of Object.entries(props.rowBgColors)) {
          const r = Number(k);
          if (r === idx) continue;
          const newR = r > idx ? r - 1 : r;
          newRowBg[newR] = v;
        }
        update({ rows: props.rows - 1, cellData: newCellData, cellOverrides: newOverrides, rowBgColors: newRowBg, rowHeights: newRowHeights, rowNames: newRowNames });
      };
      return (
        <div className="space-y-2">
          <Field label="Row Index">
            <select data-no-drag defaultValue="0" id={`remove-row-sel-${element.id}`} className={selectCls}>
              {Array.from({ length: props.rows }, (_, i) => (
                <option key={i} value={i}>{(props.rowNames ?? Array.from({ length: props.rows }, (_, j) => `Row ${j + 1}`))[i]}</option>
              ))}
            </select>
          </Field>
          <button
            data-no-drag
            className="w-full h-7 text-[10px] border border-destructive/50 text-destructive rounded hover:bg-destructive/10 transition-colors"
            onClick={() => {
              const sel = document.getElementById(`remove-row-sel-${element.id}`) as HTMLSelectElement;
              if (sel) removeRow(+sel.value);
            }}
          >
            Remove Row
          </button>
        </div>
      );
    }

    // ─── TABLE: Remove Column ─────────────────────────────────────
    case 'Remove Column': {
      const rawProps = (element.properties as { type: 'table'; data: TableProperties }).data;
      const props: TableProperties = {
        rows: rawProps.rows ?? 4,
        cols: rawProps.cols ?? 3,
        cellData: rawProps.cellData ?? [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']],
        cellOverrides: rawProps.cellOverrides ?? {},
        showHeader: rawProps.showHeader ?? true,
        headerBg: rawProps.headerBg ?? '#f3f4f6',
        headerColor: rawProps.headerColor ?? '#111827',
        headerFontWeight: rawProps.headerFontWeight ?? 'bold',
        cellBg: rawProps.cellBg ?? '#ffffff',
        cellColor: rawProps.cellColor ?? '#374151',
        cellPadding: rawProps.cellPadding ?? 8,
        fontFamily: rawProps.fontFamily ?? 'Inter, sans-serif',
        fontSize: rawProps.fontSize ?? 13,
        rowBgColors: rawProps.rowBgColors ?? {},
        colBgColors: rawProps.colBgColors ?? {},
        borderWidth: rawProps.borderWidth ?? 1,
        borderStyle: rawProps.borderStyle ?? 'solid',
        borderColor: rawProps.borderColor ?? '#d1d5db',
        showBorderTop: rawProps.showBorderTop ?? true,
        showBorderRight: rawProps.showBorderRight ?? true,
        showBorderBottom: rawProps.showBorderBottom ?? true,
        showBorderLeft: rawProps.showBorderLeft ?? true,
        showInnerBorders: rawProps.showInnerBorders ?? true,
        cornerRadius: rawProps.cornerRadius ?? { mode: 'linked', all: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
        colWidths: rawProps.colWidths ?? Array(rawProps.cols ?? 3).fill(1),
        rowHeights: rawProps.rowHeights ?? Array(rawProps.rows ?? 4).fill(1),
        rowNames: rawProps.rowNames ?? Array.from({ length: rawProps.rows ?? 4 }, (_, i) => `Row ${i + 1}`),
        colNames: rawProps.colNames ?? Array.from({ length: rawProps.cols ?? 3 }, (_, i) => `Column ${i + 1}`),
        opacity: rawProps.opacity ?? 1,
      };
      const update = (updates: Partial<TableProperties>) => {
        // Read latest data from store to avoid stale closure (e.g. after col/row resize)
        const currentEl = useDesignerStore.getState().elements.find((el) => el.id === element.id);
        const currentData = currentEl ? (currentEl.properties as { type: 'table'; data: TableProperties }).data : props;
        updateElementProperties(element.id, { type: 'table', data: { ...currentData, ...updates } });
      };
      const removeColumn = (idx: number) => {
        if (props.cols <= 1) return;
        const newCellData = props.cellData.map((row) => row.filter((_, i) => i !== idx));
        const newColWidths = (props.colWidths ?? Array(props.cols).fill(1)).filter((_, i) => i !== idx);
        const newColNames = (props.colNames ?? Array.from({ length: props.cols }, (_, i) => `Column ${i + 1}`)).filter((_, i) => i !== idx);
        const newOverrides: Record<string, CellOverride> = {};
        for (const [key, val] of Object.entries(props.cellOverrides)) {
          const [r, c] = key.split('-').map(Number);
          if (c === idx) continue;
          const newC = c > idx ? c - 1 : c;
          newOverrides[`${r}-${newC}`] = val;
        }
        const newColBg: Record<number, string> = {};
        for (const [k, v] of Object.entries(props.colBgColors)) {
          const c = Number(k);
          if (c === idx) continue;
          const newC = c > idx ? c - 1 : c;
          newColBg[newC] = v;
        }
        update({ cols: props.cols - 1, cellData: newCellData, cellOverrides: newOverrides, colBgColors: newColBg, colWidths: newColWidths, colNames: newColNames });
      };
      return (
        <div className="space-y-2">
          <Field label="Column Index">
            <select data-no-drag defaultValue="0" id={`remove-col-sel-${element.id}`} className={selectCls}>
              {Array.from({ length: props.cols }, (_, i) => (
                <option key={i} value={i}>{(props.colNames ?? Array.from({ length: props.cols }, (_, j) => `Column ${j + 1}`))[i]}</option>
              ))}
            </select>
          </Field>
          <button
            data-no-drag
            className="w-full h-7 text-[10px] border border-destructive/50 text-destructive rounded hover:bg-destructive/10 transition-colors"
            onClick={() => {
              const sel = document.getElementById(`remove-col-sel-${element.id}`) as HTMLSelectElement;
              if (sel) removeColumn(+sel.value);
            }}
          >
            Remove Column
          </button>
        </div>
      );
    }

    // ─── TABLE: Reorder (combined rows & columns) ────────────────
    case 'Reorder': {
      const rawProps = (element.properties as { type: 'table'; data: TableProperties }).data;
      const props: TableProperties = {
        rows: rawProps.rows ?? 4,
        cols: rawProps.cols ?? 3,
        cellData: rawProps.cellData ?? [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']],
        cellOverrides: rawProps.cellOverrides ?? {},
        showHeader: rawProps.showHeader ?? true,
        headerBg: rawProps.headerBg ?? '#f3f4f6',
        headerColor: rawProps.headerColor ?? '#111827',
        headerFontWeight: rawProps.headerFontWeight ?? 'bold',
        cellBg: rawProps.cellBg ?? '#ffffff',
        cellColor: rawProps.cellColor ?? '#374151',
        cellPadding: rawProps.cellPadding ?? 8,
        fontFamily: rawProps.fontFamily ?? 'Inter, sans-serif',
        fontSize: rawProps.fontSize ?? 13,
        rowBgColors: rawProps.rowBgColors ?? {},
        colBgColors: rawProps.colBgColors ?? {},
        borderWidth: rawProps.borderWidth ?? 1,
        borderStyle: rawProps.borderStyle ?? 'solid',
        borderColor: rawProps.borderColor ?? '#d1d5db',
        showBorderTop: rawProps.showBorderTop ?? true,
        showBorderRight: rawProps.showBorderRight ?? true,
        showBorderBottom: rawProps.showBorderBottom ?? true,
        showBorderLeft: rawProps.showBorderLeft ?? true,
        showInnerBorders: rawProps.showInnerBorders ?? true,
        cornerRadius: rawProps.cornerRadius ?? { mode: 'linked', all: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
        colWidths: rawProps.colWidths ?? Array(rawProps.cols ?? 3).fill(1),
        rowHeights: rawProps.rowHeights ?? Array(rawProps.rows ?? 4).fill(1),
        rowNames: rawProps.rowNames ?? Array.from({ length: rawProps.rows ?? 4 }, (_, i) => `Row ${i + 1}`),
        colNames: rawProps.colNames ?? Array.from({ length: rawProps.cols ?? 3 }, (_, i) => `Column ${i + 1}`),
        opacity: rawProps.opacity ?? 1,
      };
      const update = (updates: Partial<TableProperties>) => {
        // Read latest data from store to avoid stale closure (e.g. after col/row resize)
        const currentEl = useDesignerStore.getState().elements.find((el) => el.id === element.id);
        const currentData = currentEl ? (currentEl.properties as { type: 'table'; data: TableProperties }).data : props;
        updateElementProperties(element.id, { type: 'table', data: { ...currentData, ...updates } });
      };

      // Reorder handlers using insertion-style remapping (arbitrary from→to)
      const handleRowReorder = (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex) return;
        const newCellData = props.cellData.map((r) => [...r]);
        const [moved] = newCellData.splice(fromIndex, 1);
        newCellData.splice(toIndex, 0, moved);
        const newOverrides: Record<string, CellOverride> = {};
        for (const [key, val] of Object.entries(props.cellOverrides)) {
          const [r, c] = key.split('-').map(Number);
          let newR = r;
          if (r === fromIndex) {
            newR = toIndex;
          } else if (fromIndex < toIndex) {
            if (r > fromIndex && r <= toIndex) newR = r - 1;
          } else {
            if (r >= toIndex && r < fromIndex) newR = r + 1;
          }
          newOverrides[`${newR}-${c}`] = val;
        }
        const newRowBg: Record<number, string> = {};
        for (const [k, v] of Object.entries(props.rowBgColors)) {
          const r = Number(k);
          let newR = r;
          if (r === fromIndex) {
            newR = toIndex;
          } else if (fromIndex < toIndex) {
            if (r > fromIndex && r <= toIndex) newR = r - 1;
          } else {
            if (r >= toIndex && r < fromIndex) newR = r + 1;
          }
          newRowBg[newR] = v;
        }
        const rowNames = [...(props.rowNames ?? Array.from({ length: props.rows }, (_, i) => `Row ${i + 1}`))];
        const [movedRowName] = rowNames.splice(fromIndex, 1);
        rowNames.splice(toIndex, 0, movedRowName);
        update({ cellData: newCellData, cellOverrides: newOverrides, rowBgColors: newRowBg, rowNames });
      };

      const handleColReorder = (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex) return;
        const newCellData = props.cellData.map((row) => {
          const newRow = [...row];
          const [moved] = newRow.splice(fromIndex, 1);
          newRow.splice(toIndex, 0, moved);
          return newRow;
        });
        const newOverrides: Record<string, CellOverride> = {};
        for (const [key, val] of Object.entries(props.cellOverrides)) {
          const [r, c] = key.split('-').map(Number);
          let newC = c;
          if (c === fromIndex) {
            newC = toIndex;
          } else if (fromIndex < toIndex) {
            if (c > fromIndex && c <= toIndex) newC = c - 1;
          } else {
            if (c >= toIndex && c < fromIndex) newC = c + 1;
          }
          newOverrides[`${r}-${newC}`] = val;
        }
        const newColBg: Record<number, string> = {};
        for (const [k, v] of Object.entries(props.colBgColors)) {
          const c = Number(k);
          let newC = c;
          if (c === fromIndex) {
            newC = toIndex;
          } else if (fromIndex < toIndex) {
            if (c > fromIndex && c <= toIndex) newC = c - 1;
          } else {
            if (c >= toIndex && c < fromIndex) newC = c + 1;
          }
          newColBg[newC] = v;
        }
        const colNames = [...(props.colNames ?? Array.from({ length: props.cols }, (_, i) => `Column ${i + 1}`))];
        const [movedColName] = colNames.splice(fromIndex, 1);
        colNames.splice(toIndex, 0, movedColName);
        update({ cellData: newCellData, cellOverrides: newOverrides, colBgColors: newColBg, colNames });
      };

      return <ReorderCardContent props={props} onRowReorder={handleRowReorder} onColReorder={handleColReorder} />;
    }

    // ─── TABLE: Cell Properties ────────────────────────────────────
    case 'Cell Properties': {
      const rawProps = (element.properties as { type: 'table'; data: TableProperties }).data;
      const props: TableProperties = {
        rows: rawProps.rows ?? 4,
        cols: rawProps.cols ?? 3,
        cellData: rawProps.cellData ?? [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']],
        cellOverrides: rawProps.cellOverrides ?? {},
        showHeader: rawProps.showHeader ?? true,
        headerBg: rawProps.headerBg ?? '#f3f4f6',
        headerColor: rawProps.headerColor ?? '#111827',
        headerFontWeight: rawProps.headerFontWeight ?? 'bold',
        cellBg: rawProps.cellBg ?? '#ffffff',
        cellColor: rawProps.cellColor ?? '#374151',
        cellPadding: rawProps.cellPadding ?? 8,
        fontFamily: rawProps.fontFamily ?? 'Inter, sans-serif',
        fontSize: rawProps.fontSize ?? 13,
        rowBgColors: rawProps.rowBgColors ?? {},
        colBgColors: rawProps.colBgColors ?? {},
        borderWidth: rawProps.borderWidth ?? 1,
        borderStyle: rawProps.borderStyle ?? 'solid',
        borderColor: rawProps.borderColor ?? '#d1d5db',
        showBorderTop: rawProps.showBorderTop ?? true,
        showBorderRight: rawProps.showBorderRight ?? true,
        showBorderBottom: rawProps.showBorderBottom ?? true,
        showBorderLeft: rawProps.showBorderLeft ?? true,
        showInnerBorders: rawProps.showInnerBorders ?? true,
        cornerRadius: rawProps.cornerRadius ?? { mode: 'linked', all: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
        colWidths: rawProps.colWidths ?? Array(rawProps.cols ?? 3).fill(1),
        rowHeights: rawProps.rowHeights ?? Array(rawProps.rows ?? 4).fill(1),
        rowNames: rawProps.rowNames ?? Array.from({ length: rawProps.rows ?? 4 }, (_, i) => `Row ${i + 1}`),
        colNames: rawProps.colNames ?? Array.from({ length: rawProps.cols ?? 3 }, (_, i) => `Column ${i + 1}`),
        opacity: rawProps.opacity ?? 1,
      };
      const update = (updates: Partial<TableProperties>) => {
        // Read latest data from store to avoid stale closure (e.g. after col/row resize)
        const currentEl = useDesignerStore.getState().elements.find((el) => el.id === element.id);
        const currentData = currentEl ? (currentEl.properties as { type: 'table'; data: TableProperties }).data : props;
        updateElementProperties(element.id, { type: 'table', data: { ...currentData, ...updates } });
      };
      return <CellPropertiesEditor element={element} props={props} update={update} compact={compact} />;
    }

    // ─── TABLE: Borders (also handles 'Table Border') ──────────────
    case 'Table Border':
    case 'Borders': {
      const rawProps = (element.properties as { type: 'table'; data: TableProperties }).data;
      const legacyOuter = rawProps.showOuterBorder;
      const legacyInner = rawProps.showInnerBorder;
      const props: TableProperties = {
        rows: rawProps.rows ?? 4,
        cols: rawProps.cols ?? 3,
        cellData: rawProps.cellData ?? [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']],
        cellOverrides: rawProps.cellOverrides ?? {},
        showHeader: rawProps.showHeader ?? true,
        headerBg: rawProps.headerBg ?? '#f3f4f6',
        headerColor: rawProps.headerColor ?? '#111827',
        headerFontWeight: rawProps.headerFontWeight ?? 'bold',
        cellBg: rawProps.cellBg ?? '#ffffff',
        cellColor: rawProps.cellColor ?? '#374151',
        cellPadding: rawProps.cellPadding ?? 8,
        fontFamily: rawProps.fontFamily ?? 'Inter, sans-serif',
        fontSize: rawProps.fontSize ?? 13,
        rowBgColors: rawProps.rowBgColors ?? {},
        colBgColors: rawProps.colBgColors ?? {},
        borderWidth: rawProps.borderWidth ?? 1,
        borderStyle: rawProps.borderStyle ?? 'solid',
        borderColor: rawProps.borderColor ?? '#d1d5db',
        showBorderTop: rawProps.showBorderTop ?? (legacyOuter !== undefined ? legacyOuter : true),
        showBorderRight: rawProps.showBorderRight ?? (legacyOuter !== undefined ? legacyOuter : true),
        showBorderBottom: rawProps.showBorderBottom ?? (legacyOuter !== undefined ? legacyOuter : true),
        showBorderLeft: rawProps.showBorderLeft ?? (legacyOuter !== undefined ? legacyOuter : true),
        showInnerBorders: rawProps.showInnerBorders ?? (legacyInner !== undefined ? legacyInner : true),
        cornerRadius: rawProps.cornerRadius ?? { mode: 'linked', all: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
        colWidths: rawProps.colWidths ?? Array(rawProps.cols ?? 3).fill(1),
        rowHeights: rawProps.rowHeights ?? Array(rawProps.rows ?? 4).fill(1),
        rowNames: rawProps.rowNames ?? Array.from({ length: rawProps.rows ?? 4 }, (_, i) => `Row ${i + 1}`),
        colNames: rawProps.colNames ?? Array.from({ length: rawProps.cols ?? 3 }, (_, i) => `Column ${i + 1}`),
        opacity: rawProps.opacity ?? 1,
      };
      const update = (updates: Partial<TableProperties>) => {
        // Read latest data from store to avoid stale closure (e.g. after col/row resize)
        const currentEl = useDesignerStore.getState().elements.find((el) => el.id === element.id);
        const currentData = currentEl ? (currentEl.properties as { type: 'table'; data: TableProperties }).data : props;
        updateElementProperties(element.id, { type: 'table', data: { ...currentData, ...updates } });
      };
      return (
        <div className="space-y-2">
          <Field label="Width">
            <SliderField value={[props.borderWidth]} min={0} max={5} step={1} unit="px" colorTheme="orange" onValueChange={([v]) => update({ borderWidth: v })} compact />
          </Field>
          <Field label="Style">
            <select data-no-drag value={props.borderStyle} onChange={(e) => update({ borderStyle: e.target.value as 'solid' | 'dashed' | 'dotted' })} className={selectCls}>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </Field>
          <Field label="Color">
            <ColorInput value={props.borderColor} onChange={(v) => update({ borderColor: v })} noDrag />
          </Field>
          <div className="space-y-1">
            <label className={labelCls}>Outer Borders</label>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <CheckboxRow label="Top" checked={props.showBorderTop} onChange={(v) => update({ showBorderTop: v })} />
              <CheckboxRow label="Right" checked={props.showBorderRight} onChange={(v) => update({ showBorderRight: v })} />
              <CheckboxRow label="Bottom" checked={props.showBorderBottom} onChange={(v) => update({ showBorderBottom: v })} />
              <CheckboxRow label="Left" checked={props.showBorderLeft} onChange={(v) => update({ showBorderLeft: v })} />
            </div>
            <CheckboxRow label="Inner Borders" checked={props.showInnerBorders} onChange={(v) => update({ showInnerBorders: v })} />
          </div>
        </div>
      );
    }

    // ─── TABLE: Corner Radius ──────────────────────────────────────
    case 'Corner Radius': {
      // Could be table or rectangle — check element type
      if (element.type === 'rectangle') {
        const rawProps = (element.properties as { type: 'rectangle'; data: RectangleProperties }).data;
        const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
        const props: RectangleProperties = { ...rawProps, effects };
        const update = (updates: Partial<RectangleProperties>) => {
          updateElementProperties(element.id, { type: 'rectangle', data: { ...props, ...updates } });
        };
        const cr = normalizeRectBorderRadius(props.borderRadius);
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className={labelCls}>{cr.mode === 'linked' ? 'All Corners' : 'Individual'}</label>
              <button
                data-no-drag
                className="text-[10px] text-primary hover:underline"
                onClick={() => {
                  if (cr.mode === 'linked') {
                    update({ borderRadius: { ...cr, mode: 'individual', topLeft: cr.all, topRight: cr.all, bottomRight: cr.all, bottomLeft: cr.all } });
                  } else {
                    const avg = Math.round((cr.topLeft + cr.topRight + cr.bottomRight + cr.bottomLeft) / 4);
                    update({ borderRadius: { ...cr, mode: 'linked', all: avg, topLeft: avg, topRight: avg, bottomRight: avg, bottomLeft: avg } });
                  }
                }}
              >
                {cr.mode === 'linked' ? 'Unlink' : 'Link'}
              </button>
            </div>
            {cr.mode === 'linked' ? (
              <SliderField value={[cr.all]} min={0} max={100} step={1} unit="px" colorTheme="blue" onValueChange={([v]) => update({ borderRadius: { ...cr, all: v, topLeft: v, topRight: v, bottomRight: v, bottomLeft: v } })} compact />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-muted-foreground w-5">TL</span>
                  <input data-no-drag type="number" value={cr.topLeft} onChange={(e) => update({ borderRadius: { ...cr, topLeft: Math.max(0, +e.target.value) } })} min={0} max={100} className={inputFlexCls} />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-muted-foreground w-5">TR</span>
                  <input data-no-drag type="number" value={cr.topRight} onChange={(e) => update({ borderRadius: { ...cr, topRight: Math.max(0, +e.target.value) } })} min={0} max={100} className={inputFlexCls} />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-muted-foreground w-5">BL</span>
                  <input data-no-drag type="number" value={cr.bottomLeft} onChange={(e) => update({ borderRadius: { ...cr, bottomLeft: Math.max(0, +e.target.value) } })} min={0} max={100} className={inputFlexCls} />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-muted-foreground w-5">BR</span>
                  <input data-no-drag type="number" value={cr.bottomRight} onChange={(e) => update({ borderRadius: { ...cr, bottomRight: Math.max(0, +e.target.value) } })} min={0} max={100} className={inputFlexCls} />
                </div>
              </div>
            )}
          </div>
        );
      }

      // Table corner radius
      const rawProps = (element.properties as { type: 'table'; data: TableProperties }).data;
      const props: TableProperties = {
        rows: rawProps.rows ?? 4,
        cols: rawProps.cols ?? 3,
        cellData: rawProps.cellData ?? [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']],
        cellOverrides: rawProps.cellOverrides ?? {},
        showHeader: rawProps.showHeader ?? true,
        headerBg: rawProps.headerBg ?? '#f3f4f6',
        headerColor: rawProps.headerColor ?? '#111827',
        headerFontWeight: rawProps.headerFontWeight ?? 'bold',
        cellBg: rawProps.cellBg ?? '#ffffff',
        cellColor: rawProps.cellColor ?? '#374151',
        cellPadding: rawProps.cellPadding ?? 8,
        fontFamily: rawProps.fontFamily ?? 'Inter, sans-serif',
        fontSize: rawProps.fontSize ?? 13,
        rowBgColors: rawProps.rowBgColors ?? {},
        colBgColors: rawProps.colBgColors ?? {},
        borderWidth: rawProps.borderWidth ?? 1,
        borderStyle: rawProps.borderStyle ?? 'solid',
        borderColor: rawProps.borderColor ?? '#d1d5db',
        showBorderTop: rawProps.showBorderTop ?? true,
        showBorderRight: rawProps.showBorderRight ?? true,
        showBorderBottom: rawProps.showBorderBottom ?? true,
        showBorderLeft: rawProps.showBorderLeft ?? true,
        showInnerBorders: rawProps.showInnerBorders ?? true,
        cornerRadius: rawProps.cornerRadius ?? { mode: 'linked', all: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
        colWidths: rawProps.colWidths ?? Array(rawProps.cols ?? 3).fill(1),
        rowHeights: rawProps.rowHeights ?? Array(rawProps.rows ?? 4).fill(1),
        rowNames: rawProps.rowNames ?? Array.from({ length: rawProps.rows ?? 4 }, (_, i) => `Row ${i + 1}`),
        colNames: rawProps.colNames ?? Array.from({ length: rawProps.cols ?? 3 }, (_, i) => `Column ${i + 1}`),
        opacity: rawProps.opacity ?? 1,
      };
      const update = (updates: Partial<TableProperties>) => {
        // Read latest data from store to avoid stale closure (e.g. after col/row resize)
        const currentEl = useDesignerStore.getState().elements.find((el) => el.id === element.id);
        const currentData = currentEl ? (currentEl.properties as { type: 'table'; data: TableProperties }).data : props;
        updateElementProperties(element.id, { type: 'table', data: { ...currentData, ...updates } });
      };
      const cr = props.cornerRadius;
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className={labelCls}>{cr.mode === 'linked' ? 'All Corners' : 'Individual'}</label>
            <button
              data-no-drag
              className="text-[10px] text-primary hover:underline"
              onClick={() => {
                if (cr.mode === 'linked') {
                  update({ cornerRadius: { ...cr, mode: 'individual', topLeft: cr.all, topRight: cr.all, bottomRight: cr.all, bottomLeft: cr.all } });
                } else {
                  const avg = Math.round((cr.topLeft + cr.topRight + cr.bottomRight + cr.bottomLeft) / 4);
                  update({ cornerRadius: { ...cr, mode: 'linked', all: avg, topLeft: avg, topRight: avg, bottomRight: avg, bottomLeft: avg } });
                }
              }}
            >
              {cr.mode === 'linked' ? 'Unlink' : 'Link'}
            </button>
          </div>
          {cr.mode === 'linked' ? (
            <SliderField value={[cr.all]} min={0} max={100} step={1} unit="px" colorTheme="blue" onValueChange={([v]) => update({ cornerRadius: { ...cr, all: v, topLeft: v, topRight: v, bottomRight: v, bottomLeft: v } })} compact />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-muted-foreground w-5">TL</span>
                <input data-no-drag type="number" value={cr.topLeft} onChange={(e) => update({ cornerRadius: { ...cr, topLeft: Math.max(0, +e.target.value) } })} min={0} max={100} className={inputFlexCls} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-muted-foreground w-5">TR</span>
                <input data-no-drag type="number" value={cr.topRight} onChange={(e) => update({ cornerRadius: { ...cr, topRight: Math.max(0, +e.target.value) } })} min={0} max={100} className={inputFlexCls} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-muted-foreground w-5">BL</span>
                <input data-no-drag type="number" value={cr.bottomLeft} onChange={(e) => update({ cornerRadius: { ...cr, bottomLeft: Math.max(0, +e.target.value) } })} min={0} max={100} className={inputFlexCls} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-muted-foreground w-5">BR</span>
                <input data-no-drag type="number" value={cr.bottomRight} onChange={(e) => update({ cornerRadius: { ...cr, bottomRight: Math.max(0, +e.target.value) } })} min={0} max={100} className={inputFlexCls} />
              </div>
            </div>
          )}
        </div>
      );
    }

    // ─── RECTANGLE: Transform (rotation) ───────────────────────────
    // Only rectangles support rotation (per spec). The slider covers the
    // full [-180, 180] range at 1° resolution; the numeric input lets the
    // user type an exact value. The reset button restores 0°. The store's
    // setRectRotation action normalizes the angle to [-180, 180] before
    // writing, so the displayed value stays bounded even if the user types
    // something like 540°.
    case 'Transform': {
      if (element.type !== 'rectangle') {
        return <div className="text-xs text-muted-foreground italic">Transform not available for this element</div>;
      }
      const rotation = getRectRotation(element);
      return (
        <div className="space-y-2">
          <Field label="Rotation">
            <div className="flex items-center gap-1">
              <input
                data-no-drag
                type="number"
                value={Math.round(rotation)}
                onChange={(e) => setRectRotation(element.id, +e.target.value)}
                min={-180}
                max={180}
                step={1}
                className={inputFlexCls}
              />
              <span className="text-[9px] text-muted-foreground">deg</span>
              <button
                data-no-drag
                type="button"
                className="h-6 px-1.5 text-[10px] border border-border rounded hover:bg-accent transition-colors shrink-0"
                title="Reset rotation to 0°"
                onClick={() => setRectRotation(element.id, 0)}
                disabled={rotation === 0}
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            </div>
          </Field>
          {/* Quick-preset buttons for common angles — snaps to the nearest
              15° increment when held, but the presets give one-click access
              to the most-used rotations. */}
          <div className="flex gap-1 flex-wrap">
            {[-90, -45, 0, 45, 90, 180].map((angle) => (
              <button
                key={angle}
                data-no-drag
                type="button"
                className={`flex-1 min-w-[36px] h-6 text-[10px] border rounded transition-colors ${
                  rotation === angle
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:bg-accent'
                }`}
                onClick={() => setRectRotation(element.id, angle)}
              >
                {angle}°
              </button>
            ))}
          </div>
        </div>
      );
    }

    // ─── IMAGE: Image Source ───────────────────────────────────────
    case 'Image Source': {
      const data = (element.properties as { type: 'image'; data: ImageProperties }).data;
      const update = (updates: Partial<ImageProperties>) => {
        updateElementProperties(element.id, { type: 'image', data: { ...data, ...updates } });
      };
      return (
        <div className="space-y-2">
          {data.src && (
            <div className="border border-border rounded overflow-hidden h-20 flex items-center justify-center bg-muted/30">
              <img src={data.src} alt="Preview" className="max-h-full max-w-full object-contain" />
            </div>
          )}
          <Field label="Image URL">
            <input
              data-no-drag
              type="text"
              value={data.src}
              onChange={(e) => update({ src: e.target.value })}
              placeholder="Enter URL or paste data URI"
              className="w-full h-7 text-xs px-2 border border-border rounded bg-background"
            />
          </Field>
          <input
            data-no-drag
            type="file"
            accept="image/*"
            className="text-[10px] w-full"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                  update({ src: ev.target?.result as string });
                };
                reader.readAsDataURL(file);
              }
            }}
          />
        </div>
      );
    }

    // ─── IMAGE: Fitting / Fit Mode ───────────────────────────────
    case 'Fitting':
    case 'Fit Mode': {
      const data = (element.properties as { type: 'image'; data: ImageProperties }).data;
      const update = (updates: Partial<ImageProperties>) => {
        updateElementProperties(element.id, { type: 'image', data: { ...data, ...updates } });
      };
      return (
        <div className="space-y-2">
          <Field label="Object Fit">
            <select data-no-drag value={data.objectFit} onChange={(e) => update({ objectFit: e.target.value as 'contain' | 'cover' | 'fill' })} className={selectCls}>
              <option value="contain">Contain</option>
              <option value="cover">Cover</option>
              <option value="fill">Fill</option>
            </select>
          </Field>
        </div>
      );
    }

    // ─── IMAGE: Adjustments / Image Filters ─────────────────────
    case 'Adjustments':
    case 'Image Filters': {
      const data = (element.properties as { type: 'image'; data: ImageProperties }).data;
      const update = (updates: Partial<ImageProperties>) => {
        updateElementProperties(element.id, { type: 'image', data: { ...data, ...updates } });
      };
      return (
        <div className="space-y-2">
          <Field label="Brightness">
            <div className="flex items-center gap-1">
              <input data-no-drag type="number" value={Math.round((data.brightness ?? 100))} onChange={(e) => update({ brightness: +e.target.value })} min={0} max={200} className={inputFlexCls} />
              <span className="text-[9px] text-muted-foreground">%</span>
            </div>
          </Field>
          <Field label="Contrast">
            <div className="flex items-center gap-1">
              <input data-no-drag type="number" value={Math.round((data.contrast ?? 100))} onChange={(e) => update({ contrast: +e.target.value })} min={0} max={200} className={inputFlexCls} />
              <span className="text-[9px] text-muted-foreground">%</span>
            </div>
          </Field>
          <Field label="Saturation">
            <div className="flex items-center gap-1">
              <input data-no-drag type="number" value={Math.round((data.saturation ?? 100))} onChange={(e) => update({ saturation: +e.target.value })} min={0} max={200} className={inputFlexCls} />
              <span className="text-[9px] text-muted-foreground">%</span>
            </div>
          </Field>
          <Field label="Blur">
            <div className="flex items-center gap-1">
              <input data-no-drag type="number" value={data.blur ?? 0} onChange={(e) => update({ blur: +e.target.value })} min={0} max={20} step={0.5} className={inputFlexCls} />
              <span className="text-[9px] text-muted-foreground">px</span>
            </div>
          </Field>
        </div>
      );
    }

    // ─── IMAGE: Image Border ──────────────────────────────────────
    case 'Image Border': {
      const data = (element.properties as { type: 'image'; data: ImageProperties }).data;
      const update = (updates: Partial<ImageProperties>) => {
        updateElementProperties(element.id, { type: 'image', data: { ...data, ...updates } });
      };
      return (
        <div className="space-y-2">
          <Field label="Width">
            <SliderField value={[data.borderWidth ?? 0]} min={0} max={10} step={1} unit="px" colorTheme="orange" onValueChange={([v]) => update({ borderWidth: v })} compact />
          </Field>
          <Field label="Color">
            <ColorInput value={data.borderColor ?? '#000000'} onChange={(v) => update({ borderColor: v })} noDrag />
          </Field>
          <Field label="Style">
            <select data-no-drag value={data.borderStyle ?? 'solid'} onChange={(e) => update({ borderStyle: e.target.value as 'solid' | 'dashed' | 'dotted' })} className={selectCls}>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </Field>
          <Field label="Radius">
            <SliderField value={[data.borderRadius ?? 0]} min={0} max={50} step={1} unit="px" colorTheme="blue" onValueChange={([v]) => update({ borderRadius: v })} compact />
          </Field>
        </div>
      );
    }

    // ─── RECTANGLE / ELLIPSE: Gradient ────────────────────────────
    case 'Fill & Gradient':
    case 'Gradient': {
      // Works for both rectangle and ellipse
      const isRect = element.type === 'rectangle';
      const getEffectsAndGradient = () => {
        if (isRect) {
          const rawProps = (element.properties as { type: 'rectangle'; data: RectangleProperties }).data;
          const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
          return { effects, gradient: effects.gradient, rawProps };
        } else {
          const rawProps = (element.properties as { type: 'ellipse'; data: EllipseProperties }).data;
          const effects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
          return { effects, gradient: effects.gradient, rawProps };
        }
      };
      const { effects: gradientEffects, gradient, rawProps: gradientRawProps } = getEffectsAndGradient();

      const updateGradient = (updates: Partial<GradientFill>) => {
        const newGradient = { ...gradient, ...updates };
        const newEffects = { ...gradientEffects, gradient: newGradient };
        if (isRect) {
          updateElementProperties(element.id, {
            type: 'rectangle',
            data: { ...gradientRawProps, effects: newEffects } as RectangleProperties,
          });
        } else {
          updateElementProperties(element.id, {
            type: 'ellipse',
            data: { ...gradientRawProps, effects: newEffects } as EllipseProperties,
          });
        }
      };

      return (
        <div className="space-y-2">
          <GradientStopBar
            gradient={gradient}
            onGradientChange={updateGradient}
            compact
          />
          {gradient.type === 'solid' && (
            <Field label="Fill Color">
              <ColorInput
                value={(gradientRawProps as { fill: string }).fill || '#93c5fd'}
                onChange={(v) => {
                  if (isRect) {
                    updateElementProperties(element.id, {
                      type: 'rectangle',
                      data: { ...gradientRawProps, fill: v } as RectangleProperties,
                    });
                  } else {
                    updateElementProperties(element.id, {
                      type: 'ellipse',
                      data: { ...gradientRawProps, fill: v } as EllipseProperties,
                    });
                  }
                }}
                noDrag
              />
            </Field>
          )}
        </div>
      );
    }

    // ─── RECTANGLE / ELLIPSE: Reflection ──────────────────────────
    case 'Reflection': {
      const isRect = element.type === 'rectangle';
      const getReflection = () => {
        if (isRect) {
          const rawProps = (element.properties as { type: 'rectangle'; data: RectangleProperties }).data;
          const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
          return effects.reflection;
        } else {
          const rawProps = (element.properties as { type: 'ellipse'; data: EllipseProperties }).data;
          const effects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
          return effects.reflection;
        }
      };
      const reflection = getReflection();
      const updateReflection = (updates: Record<string, unknown>) => {
        if (isRect) {
          const rawProps = (element.properties as { type: 'rectangle'; data: RectangleProperties }).data;
          const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
          updateElementProperties(element.id, {
            type: 'rectangle',
            data: { ...rawProps, effects: { ...effects, reflection: { ...effects.reflection, ...updates } } },
          });
        } else {
          const rawProps = (element.properties as { type: 'ellipse'; data: EllipseProperties }).data;
          const effects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
          updateElementProperties(element.id, {
            type: 'ellipse',
            data: { ...rawProps, effects: { ...effects, reflection: { ...effects.reflection, ...updates } } },
          });
        }
      };
      return (
        <div className="space-y-2">
          <CheckboxRow label="Enable Reflection" checked={reflection?.enabled ?? false} onChange={(v) => updateReflection({ enabled: v })} />
          {(reflection?.enabled ?? false) && (
            <>
              <Field label="Preset">
                <select data-no-drag value={reflection?.preset ?? 'soft'} onChange={(e) => updateReflection({ preset: e.target.value })} className={selectCls}>
                  <option value="soft">Soft</option>
                  <option value="tight">Tight</option>
                  <option value="fade">Fade</option>
                  <option value="mirror">Mirror</option>
                </select>
              </Field>
              <Field label="Size">
                <input data-no-drag type="number" value={reflection?.size ?? 50} onChange={(e) => updateReflection({ size: +e.target.value })} min={0} max={100} className={inputCls} />
              </Field>
              <Field label="Opacity">
                <div className="flex items-center gap-1">
                  <input data-no-drag type="number" value={Math.round((reflection?.opacity ?? 0.3) * 100)} onChange={(e) => updateReflection({ opacity: +e.target.value / 100 })} min={0} max={100} className={inputFlexCls} />
                  <span className="text-[9px] text-muted-foreground">%</span>
                </div>
              </Field>
              <Field label="Distance">
                <input data-no-drag type="number" value={reflection?.distance ?? 10} onChange={(e) => updateReflection({ distance: +e.target.value })} min={0} max={50} className={inputCls} />
              </Field>
            </>
          )}
        </div>
      );
    }

    // ─── RECTANGLE / ELLIPSE: Glow ────────────────────────────────
    case 'Glow': {
      const isRect = element.type === 'rectangle';
      const getGlow = () => {
        if (isRect) {
          const rawProps = (element.properties as { type: 'rectangle'; data: RectangleProperties }).data;
          const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
          return effects.glow;
        } else {
          const rawProps = (element.properties as { type: 'ellipse'; data: EllipseProperties }).data;
          const effects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
          return effects.glow;
        }
      };
      const glow = getGlow();
      const updateGlow = (updates: Record<string, unknown>) => {
        if (isRect) {
          const rawProps = (element.properties as { type: 'rectangle'; data: RectangleProperties }).data;
          const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
          updateElementProperties(element.id, {
            type: 'rectangle',
            data: { ...rawProps, effects: { ...effects, glow: { ...effects.glow, ...updates } } },
          });
        } else {
          const rawProps = (element.properties as { type: 'ellipse'; data: EllipseProperties }).data;
          const effects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
          updateElementProperties(element.id, {
            type: 'ellipse',
            data: { ...rawProps, effects: { ...effects, glow: { ...effects.glow, ...updates } } },
          });
        }
      };
      return (
        <div className="space-y-2">
          <CheckboxRow label="Enable Glow" checked={glow?.enabled ?? false} onChange={(v) => updateGlow({ enabled: v })} />
          {(glow?.enabled ?? false) && (
            <>
              <Field label="Color">
                <ColorInput value={glow?.color ?? '#3b82f6'} onChange={(v) => updateGlow({ color: v })} noDrag />
              </Field>
              <Field label="Size">
                <input data-no-drag type="number" value={glow?.size ?? 10} onChange={(e) => updateGlow({ size: +e.target.value })} min={1} max={50} className={inputCls} />
              </Field>
              <Field label="Opacity">
                <div className="flex items-center gap-1">
                  <input data-no-drag type="number" value={Math.round((glow?.opacity ?? 0.5) * 100)} onChange={(e) => updateGlow({ opacity: +e.target.value / 100 })} min={0} max={100} className={inputFlexCls} />
                  <span className="text-[9px] text-muted-foreground">%</span>
                </div>
              </Field>
            </>
          )}
        </div>
      );
    }

    // ─── ALL: Appearance (also handles 'Opacity') ───────────────
    case 'Appearance': {
      if (element.type === 'image') {
        const data = (element.properties as { type: 'image'; data: ImageProperties }).data;
        const update = (updates: Partial<ImageProperties>) => {
          updateElementProperties(element.id, { type: 'image', data: { ...data, ...updates } });
        };
        return (
          <div className="space-y-2">
            <Field label="Border Radius">
              <SliderField value={[data.borderRadius]} min={0} max={50} step={1} unit="px" colorTheme="blue" onValueChange={([v]) => update({ borderRadius: v })} compact />
            </Field>
            <Field label="Opacity">
              <SliderField value={[Math.round(data.opacity * 100)]} min={0} max={100} step={1} unit="%" colorTheme="gray" onValueChange={([v]) => update({ opacity: v / 100 })} compact />
            </Field>
          </div>
        );
      }
      if (element.type === 'table') {
        const data = (element.properties as { type: 'table'; data: TableProperties }).data;
        const update = (updates: Partial<TableProperties>) => {
          updateElementProperties(element.id, { type: 'table', data: { ...data, ...updates } });
        };
        return (
          <div>
            <label className={labelCls}>Opacity</label>
            <SliderField value={[Math.round(data.opacity * 100)]} min={0} max={100} step={1} unit="%" colorTheme="gray" onValueChange={([v]) => update({ opacity: v / 100 })} compact />
          </div>
        );
      }
      if (element.type === 'line') {
        const data = (element.properties as { type: 'line'; data: LineProperties }).data;
        const update = (updates: Partial<LineProperties>) => {
          updateElementProperties(element.id, { type: 'line', data: { ...data, ...updates } });
        };
        return (
          <div>
            <label className={labelCls}>Opacity</label>
            <SliderField value={[Math.round(data.opacity * 100)]} min={0} max={100} step={1} unit="%" colorTheme="gray" onValueChange={([v]) => update({ opacity: v / 100 })} compact />
          </div>
        );
      }
      // Rectangle / Ellipse opacity
      if (element.type === 'rectangle') {
        const rawProps = (element.properties as { type: 'rectangle'; data: RectangleProperties }).data;
        const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
        const props: RectangleProperties = { ...rawProps, effects };
        const update = (updates: Partial<RectangleProperties>) => {
          updateElementProperties(element.id, { type: 'rectangle', data: { ...props, ...updates } });
        };
        return (
          <div className="space-y-2">
            <Field label="Opacity">
              <SliderField value={[Math.round(props.opacity * 100)]} min={0} max={100} step={1} unit="%" colorTheme="gray" onValueChange={([v]) => update({ opacity: v / 100 })} compact />
            </Field>
          </div>
        );
      }
      if (element.type === 'ellipse') {
        const rawProps = (element.properties as { type: 'ellipse'; data: EllipseProperties }).data;
        const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
        const props: EllipseProperties = { ...rawProps, effects };
        const update = (updates: Partial<EllipseProperties>) => {
          updateElementProperties(element.id, { type: 'ellipse', data: { ...props, ...updates } });
        };
        return (
          <div className="space-y-2">
            <Field label="Opacity">
              <SliderField value={[Math.round(props.opacity * 100)]} min={0} max={100} step={1} unit="%" colorTheme="gray" onValueChange={([v]) => update({ opacity: v / 100 })} compact />
            </Field>
          </div>
        );
      }
      // Generic fallback
      const data = getProps().data;
      const opacity = (data.opacity as number) ?? 1;
      return (
        <div>
          <label className={labelCls}>Opacity</label>
          <SliderField value={[Math.round(opacity * 100)]} min={0} max={100} step={1} unit="%" colorTheme="gray" onValueChange={([v]) => updateProps({ opacity: v / 100 })} compact />
        </div>
      );
    }

    // ─── IMAGE: Opacity (falls through to Appearance) ─────────────
    case 'Opacity': {
      // Group opacity — groups have no properties.data, so use the top-level
      // element.opacity field (applied via the wrapper in canvas-element.tsx).
      if (element.type === 'group') {
        const opacity = element.opacity ?? 1;
        return (
          <div className="space-y-2">
            <Field label="Opacity">
              <SliderField value={[Math.round(opacity * 100)]} min={0} max={100} step={1} unit="%" colorTheme="gray" onValueChange={([v]) => setElementsOpacity([element.id], v / 100)} compact />
            </Field>
          </div>
        );
      }
      // Could be image or rectangle/ellipse depending on context
      if (element.type === 'image') {
        const data = (element.properties as { type: 'image'; data: ImageProperties }).data;
        const update = (updates: Partial<ImageProperties>) => {
          updateElementProperties(element.id, { type: 'image', data: { ...data, ...updates } });
        };
        return (
          <div className="space-y-2">
            <Field label="Opacity">
              <SliderField value={[Math.round(data.opacity * 100)]} min={0} max={100} step={1} unit="%" colorTheme="gray" onValueChange={([v]) => update({ opacity: v / 100 })} compact />
            </Field>
            <Field label="Radius">
              <SliderField value={[data.borderRadius]} min={0} max={50} step={1} unit="px" colorTheme="blue" onValueChange={([v]) => update({ borderRadius: v })} compact />
            </Field>
          </div>
        );
      }
      // Rectangle/Ellipse opacity
      if (element.type === 'rectangle') {
        const rawProps = (element.properties as { type: 'rectangle'; data: RectangleProperties }).data;
        const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
        const props: RectangleProperties = { ...rawProps, effects };
        const update = (updates: Partial<RectangleProperties>) => {
          updateElementProperties(element.id, { type: 'rectangle', data: { ...props, ...updates } });
        };
        return (
          <div className="space-y-2">
            <Field label="Opacity">
              <SliderField value={[Math.round(props.opacity * 100)]} min={0} max={100} step={1} unit="%" colorTheme="gray" onValueChange={([v]) => update({ opacity: v / 100 })} compact />
            </Field>
          </div>
        );
      }
      if (element.type === 'ellipse') {
        const rawProps = (element.properties as { type: 'ellipse'; data: EllipseProperties }).data;
        const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
        const props: EllipseProperties = { ...rawProps, effects };
        const update = (updates: Partial<EllipseProperties>) => {
          updateElementProperties(element.id, { type: 'ellipse', data: { ...props, ...updates } });
        };
        return (
          <div className="space-y-2">
            <Field label="Opacity">
              <SliderField value={[Math.round(props.opacity * 100)]} min={0} max={100} step={1} unit="%" colorTheme="gray" onValueChange={([v]) => update({ opacity: v / 100 })} compact />
            </Field>
          </div>
        );
      }
      // Generic fallback
      const data = getProps().data;
      const opacity = (data.opacity as number) ?? 1;
      return (
        <div>
          <label className={labelCls}>Opacity</label>
          <SliderField value={[Math.round(opacity * 100)]} min={0} max={100} step={1} unit="%" colorTheme="gray" onValueChange={([v]) => updateProps({ opacity: v / 100 })} compact />
        </div>
      );
    }

    // ─── MULTI-SELECT: Opacity (applies to ALL selected elements) ──────
    case 'Multi-Selection Opacity': {
      const ids = multiSelectIds && multiSelectIds.length > 1 ? multiSelectIds : [element.id];
      // Show the primary element's opacity as the representative value.
      const opacity = element.opacity ?? 1;
      return (
        <div className="space-y-2">
          <p className="text-[9px] text-muted-foreground">Applies to all {ids.length} selected elements.</p>
          <Field label="Opacity">
            <SliderField value={[Math.round(opacity * 100)]} min={0} max={100} step={1} unit="%" colorTheme="gray" onValueChange={([v]) => setElementsOpacity(ids, v / 100)} compact />
          </Field>
        </div>
      );
    }

    // ─── LINE: Start Point ──────────────────────────────────────
    case 'Start Point': {
      const startX = element.lineStartX ?? element.x;
      const startY = element.lineStartY ?? element.y;
      const endX = element.lineEndX ?? (element.x + element.width);
      const endY = element.lineEndY ?? element.y;

      const updateEndpoint = (axis: 'x' | 'y', value: number) => {
        const newStartX = axis === 'x' ? value : startX;
        const newStartY = axis === 'y' ? value : startY;
        const bounds = computeLineBounds(newStartX, newStartY, endX, endY);
        updateElement(element.id, {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          lineStartX: newStartX,
          lineStartY: newStartY,
          lineEndX: endX,
          lineEndY: endY,
        });
      };

      return (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>X</label>
            <input data-no-drag type="number" value={Math.round(startX)} onChange={(e) => updateEndpoint('x', +e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Y</label>
            <input data-no-drag type="number" value={Math.round(startY)} onChange={(e) => updateEndpoint('y', +e.target.value)} className={inputCls} />
          </div>
        </div>
      );
    }

    // ─── LINE: End Point ──────────────────────────────────────────
    case 'End Point': {
      const startX = element.lineStartX ?? element.x;
      const startY = element.lineStartY ?? element.y;
      const endX = element.lineEndX ?? (element.x + element.width);
      const endY = element.lineEndY ?? element.y;

      const updateEndpoint = (axis: 'x' | 'y', value: number) => {
        const newEndX = axis === 'x' ? value : endX;
        const newEndY = axis === 'y' ? value : endY;
        const bounds = computeLineBounds(startX, startY, newEndX, newEndY);
        updateElement(element.id, {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          lineStartX: startX,
          lineStartY: startY,
          lineEndX: newEndX,
          lineEndY: newEndY,
        });
      };

      return (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>X</label>
            <input data-no-drag type="number" value={Math.round(endX)} onChange={(e) => updateEndpoint('x', +e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Y</label>
            <input data-no-drag type="number" value={Math.round(endY)} onChange={(e) => updateEndpoint('y', +e.target.value)} className={inputCls} />
          </div>
        </div>
      );
    }

    // ─── LINE: Endpoints ──────────────────────────────────────────
    case 'Endpoints': {
      const startX = element.lineStartX ?? element.x;
      const startY = element.lineStartY ?? element.y;
      const endX = element.lineEndX ?? (element.x + element.width);
      const endY = element.lineEndY ?? element.y;

      const updateEndpoint = (endpoint: 'start' | 'end', axis: 'x' | 'y', value: number) => {
        let newStartX = startX;
        let newStartY = startY;
        let newEndX = endX;
        let newEndY = endY;

        if (endpoint === 'start') {
          if (axis === 'x') newStartX = value;
          else newStartY = value;
        } else {
          if (axis === 'x') newEndX = value;
          else newEndY = value;
        }

        const bounds = computeLineBounds(newStartX, newStartY, newEndX, newEndY);
        updateElement(element.id, {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          lineStartX: newStartX,
          lineStartY: newStartY,
          lineEndX: newEndX,
          lineEndY: newEndY,
        });
      };

      return (
        <div className="space-y-2">
          <div>
            <label className={labelCls}>Start Point</label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[9px] text-muted-foreground">X</span>
                <input data-no-drag type="number" value={Math.round(startX)} onChange={(e) => updateEndpoint('start', 'x', +e.target.value)} className={inputCls} />
              </div>
              <div>
                <span className="text-[9px] text-muted-foreground">Y</span>
                <input data-no-drag type="number" value={Math.round(startY)} onChange={(e) => updateEndpoint('start', 'y', +e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>
          <div>
            <label className={labelCls}>End Point</label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[9px] text-muted-foreground">X</span>
                <input data-no-drag type="number" value={Math.round(endX)} onChange={(e) => updateEndpoint('end', 'x', +e.target.value)} className={inputCls} />
              </div>
              <div>
                <span className="text-[9px] text-muted-foreground">Y</span>
                <input data-no-drag type="number" value={Math.round(endY)} onChange={(e) => updateEndpoint('end', 'y', +e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>
        </div>
      );
    }

    // ─── LINE: Stroke ─────────────────────────────────────────────
    case 'Stroke': {
      const data = (element.properties as { type: 'line'; data: LineProperties }).data;
      const update = (updates: Partial<LineProperties>) => {
        updateElementProperties(element.id, { type: 'line', data: { ...data, ...updates } });
      };
      return (
        <div className="space-y-2">
          <Field label="Color">
            <ColorInput value={data.strokeColor} onChange={(v) => update({ strokeColor: v })} noDrag />
          </Field>
          <Field label="Width">
            <SliderField value={[data.strokeWidth]} min={1} max={20} step={1} unit="px" colorTheme="red" onValueChange={([v]) => update({ strokeWidth: v })} compact />
          </Field>
          <Field label="Style">
            <select data-no-drag value={data.strokeStyle} onChange={(e) => update({ strokeStyle: e.target.value as 'solid' | 'dashed' | 'dotted' })} className={selectCls}>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </Field>
          <Field label="Cap">
            <select data-no-drag value={data.lineCap} onChange={(e) => update({ lineCap: e.target.value as 'butt' | 'round' | 'square' })} className={selectCls}>
              <option value="butt">Butt</option>
              <option value="round">Round</option>
              <option value="square">Square</option>
            </select>
          </Field>
        </div>
      );
    }

    // ─── RECTANGLE / ELLIPSE: Fill ────────────────────────────────
    case 'Fill': {
      if (element.type === 'rectangle') {
        const rawProps = (element.properties as { type: 'rectangle'; data: RectangleProperties }).data;
        const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
        const props: RectangleProperties = { ...rawProps, effects };
        const update = (updates: Partial<RectangleProperties>) => {
          updateElementProperties(element.id, { type: 'rectangle', data: { ...props, ...updates } });
        };
        return (
          <div className="space-y-2">
            <Field label="Background">
              <ColorInput value={props.fill} onChange={(v) => update({ fill: v })} noDrag />
            </Field>
          </div>
        );
      }
      if (element.type === 'ellipse') {
        const rawProps = (element.properties as { type: 'ellipse'; data: EllipseProperties }).data;
        const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
        const props: EllipseProperties = { ...rawProps, effects };
        const update = (updates: Partial<EllipseProperties>) => {
          updateElementProperties(element.id, { type: 'ellipse', data: { ...props, ...updates } });
        };
        return (
          <div className="space-y-2">
            <Field label="Background">
              <ColorInput value={props.fill} onChange={(v) => update({ fill: v })} noDrag />
            </Field>
          </div>
        );
      }
      // Generic fill (shouldn't normally reach here)
      const data = getProps().data;
      const bgColor = (data.backgroundColor as string) || '#ffffff';
      return (
        <div>
          <label className={labelCls}>Background</label>
          <ColorInput value={bgColor} onChange={(v) => updateProps({ backgroundColor: v })} noDrag />
        </div>
      );
    }

    // ─── RECTANGLE / ELLIPSE: Border ──────────────────────────────
    case 'Border': {
      if (element.type === 'rectangle') {
        const rawProps = (element.properties as { type: 'rectangle'; data: RectangleProperties }).data;
        const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
        const props: RectangleProperties = { ...rawProps, effects };
        const update = (updates: Partial<RectangleProperties>) => {
          updateElementProperties(element.id, { type: 'rectangle', data: { ...props, ...updates } });
        };
        return (
          <div className="space-y-2">
            <Field label="Color">
              <ColorInput value={props.borderColor} onChange={(v) => update({ borderColor: v })} noDrag />
            </Field>
            <Field label="Width">
              <SliderField value={[props.borderWidth]} min={0} max={20} step={1} unit="px" colorTheme="orange" onValueChange={([v]) => update({ borderWidth: v })} compact />
            </Field>
            <Field label="Style">
              <select data-no-drag value={props.borderStyle} onChange={(e) => update({ borderStyle: e.target.value as 'solid' | 'dashed' | 'dotted' })} className={selectCls}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </Field>
          </div>
        );
      }
      if (element.type === 'ellipse') {
        const rawProps = (element.properties as { type: 'ellipse'; data: EllipseProperties }).data;
        const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
        const props: EllipseProperties = { ...rawProps, effects };
        const update = (updates: Partial<EllipseProperties>) => {
          updateElementProperties(element.id, { type: 'ellipse', data: { ...props, ...updates } });
        };
        return (
          <div className="space-y-2">
            <Field label="Color">
              <ColorInput value={props.borderColor} onChange={(v) => update({ borderColor: v })} noDrag />
            </Field>
            <Field label="Width">
              <SliderField value={[props.borderWidth]} min={0} max={20} step={1} unit="px" colorTheme="orange" onValueChange={([v]) => update({ borderWidth: v })} compact />
            </Field>
            <Field label="Style">
              <select data-no-drag value={props.borderStyle} onChange={(e) => update({ borderStyle: e.target.value as 'solid' | 'dashed' | 'dotted' })} className={selectCls}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </Field>
          </div>
        );
      }
      // Generic border
      const data = getProps().data;
      const borderColor = (data.borderColor as string) || '#000000';
      const borderWidth = (data.borderWidth as number) ?? 1;
      return (
        <div className="space-y-2">
          <div>
            <label className={labelCls}>Border Color</label>
            <ColorInput value={borderColor} onChange={(v) => updateProps({ borderColor: v })} noDrag />
          </div>
          <div>
            <label className={labelCls}>Border Width</label>
            <SliderField value={[borderWidth]} min={0} max={20} step={1} unit="px" colorTheme="orange" onValueChange={([v]) => updateProps({ borderWidth: v })} compact />
          </div>
        </div>
      );
    }

    // ─── RECTANGLE / ELLIPSE: Shadow ──────────────────────────────
    case 'Shadow': {
      if (element.type === 'rectangle') {
        const rawProps = (element.properties as { type: 'rectangle'; data: RectangleProperties }).data;
        const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
        const props: RectangleProperties = { ...rawProps, effects };
        const update = (updates: Partial<RectangleProperties>) => {
          updateElementProperties(element.id, { type: 'rectangle', data: { ...props, ...updates } });
        };
        const shadow = effects.shadow ?? { ...DEFAULT_SHADOW };
        const updateShadow = (shadowUpdates: Partial<ShadowEffect>) => {
          update({ effects: { ...effects, shadow: { ...shadow, ...shadowUpdates } } });
        };
        return (
          <div className="space-y-2">
            <CheckboxRow label="Enabled" checked={shadow.enabled} onChange={(v) => updateShadow({ enabled: v })} />
            {shadow.enabled && (
              <>
                <Field label="Type">
                  <select data-no-drag value={shadow.type ?? 'outer'} onChange={(e) => updateShadow({ type: e.target.value as ShadowEffect['type'] })} className={selectCls}>
                    <option value="outer">Outer</option>
                    <option value="inner">Inner</option>
                    <option value="drop">Drop</option>
                  </select>
                </Field>
                <Field label="Color">
                  <ColorInput value={shadow.color} onChange={(v) => updateShadow({ color: v })} noDrag />
                </Field>
                <Field label="Opacity">
                  <div className="flex items-center gap-1">
                    <input data-no-drag type="number" value={Math.round(shadow.opacity * 100)} onChange={(e) => updateShadow({ opacity: +e.target.value / 100 })} min={0} max={100} className={inputFlexCls} />
                    <span className="text-[9px] text-muted-foreground">%</span>
                  </div>
                </Field>
                <Field label="Blur">
                  <input data-no-drag type="number" value={shadow.blur} onChange={(e) => updateShadow({ blur: +e.target.value })} min={0} max={50} className={inputCls} />
                </Field>
                <Field label="Distance">
                  <input data-no-drag type="number" value={shadow.distance} onChange={(e) => updateShadow({ distance: +e.target.value })} min={0} max={50} className={inputCls} />
                </Field>
                <Field label="Angle">
                  <div className="flex items-center gap-1">
                    <input data-no-drag type="number" value={shadow.angle} onChange={(e) => updateShadow({ angle: +e.target.value })} min={0} max={360} className={inputFlexCls} />
                    <span className="text-[9px] text-muted-foreground">deg</span>
                  </div>
                </Field>
              </>
            )}
          </div>
        );
      }
      if (element.type === 'ellipse') {
        const rawProps = (element.properties as { type: 'ellipse'; data: EllipseProperties }).data;
        const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
        const props: EllipseProperties = { ...rawProps, effects };
        const update = (updates: Partial<EllipseProperties>) => {
          updateElementProperties(element.id, { type: 'ellipse', data: { ...props, ...updates } });
        };
        const shadow = effects.shadow ?? { ...DEFAULT_SHADOW };
        const updateShadow = (shadowUpdates: Partial<ShadowEffect>) => {
          update({ effects: { ...effects, shadow: { ...shadow, ...shadowUpdates } } });
        };
        return (
          <div className="space-y-2">
            <CheckboxRow label="Enabled" checked={shadow.enabled} onChange={(v) => updateShadow({ enabled: v })} />
            {shadow.enabled && (
              <>
                <Field label="Type">
                  <select data-no-drag value={shadow.type ?? 'outer'} onChange={(e) => updateShadow({ type: e.target.value as ShadowEffect['type'] })} className={selectCls}>
                    <option value="outer">Outer</option>
                    <option value="inner">Inner</option>
                    <option value="drop">Drop</option>
                  </select>
                </Field>
                <Field label="Color">
                  <ColorInput value={shadow.color} onChange={(v) => updateShadow({ color: v })} noDrag />
                </Field>
                <Field label="Opacity">
                  <div className="flex items-center gap-1">
                    <input data-no-drag type="number" value={Math.round(shadow.opacity * 100)} onChange={(e) => updateShadow({ opacity: +e.target.value / 100 })} min={0} max={100} className={inputFlexCls} />
                    <span className="text-[9px] text-muted-foreground">%</span>
                  </div>
                </Field>
                <Field label="Blur">
                  <input data-no-drag type="number" value={shadow.blur} onChange={(e) => updateShadow({ blur: +e.target.value })} min={0} max={50} className={inputCls} />
                </Field>
                <Field label="Distance">
                  <input data-no-drag type="number" value={shadow.distance} onChange={(e) => updateShadow({ distance: +e.target.value })} min={0} max={50} className={inputCls} />
                </Field>
                <Field label="Angle">
                  <div className="flex items-center gap-1">
                    <input data-no-drag type="number" value={shadow.angle} onChange={(e) => updateShadow({ angle: +e.target.value })} min={0} max={360} className={inputFlexCls} />
                    <span className="text-[9px] text-muted-foreground">deg</span>
                  </div>
                </Field>
              </>
            )}
          </div>
        );
      }
      if (element.type === 'image') {
        const rawProps = (element.properties as { type: 'image'; data: ImageProperties }).data;
        const effects: RectangleEffects = rawProps.effects ?? { ...DEFAULT_EFFECTS };
        const props: ImageProperties = { ...rawProps, effects };
        const update = (updates: Partial<ImageProperties>) => {
          updateElementProperties(element.id, { type: 'image', data: { ...props, ...updates } });
        };
        const shadow = effects.shadow ?? { ...DEFAULT_SHADOW };
        const updateShadow = (shadowUpdates: Partial<ShadowEffect>) => {
          update({ effects: { ...effects, shadow: { ...shadow, ...shadowUpdates } } });
        };
        return (
          <div className="space-y-2">
            <CheckboxRow label="Enabled" checked={shadow.enabled} onChange={(v) => updateShadow({ enabled: v })} />
            {shadow.enabled && (
              <>
                <Field label="Type">
                  <select data-no-drag value={shadow.type ?? 'outer'} onChange={(e) => updateShadow({ type: e.target.value as ShadowEffect['type'] })} className={selectCls}>
                    <option value="outer">Outer</option>
                    <option value="inner">Inner</option>
                    <option value="drop">Drop</option>
                  </select>
                </Field>
                <Field label="Color">
                  <ColorInput value={shadow.color} onChange={(v) => updateShadow({ color: v })} noDrag />
                </Field>
                <Field label="Opacity">
                  <div className="flex items-center gap-1">
                    <input data-no-drag type="number" value={Math.round(shadow.opacity * 100)} onChange={(e) => updateShadow({ opacity: +e.target.value / 100 })} min={0} max={100} className={inputFlexCls} />
                    <span className="text-[9px] text-muted-foreground">%</span>
                  </div>
                </Field>
                <Field label="Blur">
                  <input data-no-drag type="number" value={shadow.blur} onChange={(e) => updateShadow({ blur: +e.target.value })} min={0} max={50} className={inputCls} />
                </Field>
                <Field label="Distance">
                  <input data-no-drag type="number" value={shadow.distance} onChange={(e) => updateShadow({ distance: +e.target.value })} min={0} max={50} className={inputCls} />
                </Field>
                <Field label="Angle">
                  <div className="flex items-center gap-1">
                    <input data-no-drag type="number" value={shadow.angle} onChange={(e) => updateShadow({ angle: +e.target.value })} min={0} max={360} className={inputFlexCls} />
                    <span className="text-[9px] text-muted-foreground">deg</span>
                  </div>
                </Field>
              </>
            )}
          </div>
        );
      }
      return <div className="text-xs text-muted-foreground italic">Shadow not available for this element</div>;
    }

    // ─── Fallback ─────────────────────────────────────────────────
    default:
      return <div className="text-xs text-muted-foreground italic">Properties for {sectionLabel}</div>;
  }
});
