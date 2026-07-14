'use client';

import { CanvasElement, TextProperties, TableProperties, ImageProperties, LineProperties, RectangleProperties, EllipseProperties, RectangleEffects, DEFAULT_EFFECTS, buildGradientCSS, buildShadowCSS, buildGlowCSS, buildPictureFillCSS, resolveCornerRadius, resolveRectBorderRadius, getRectRotation } from '@/lib/element-types';
import { getCellBg, getCellColor, getCellFontWeight, getCellFontSize, getCellPadding, getCellTextAlign, getCellVerticalAlign, getCellTextTransform, getCellRotation, getCellBorderTop, getCellBorderBottom, getCellBorderLeft, getCellBorderRight, normalizeTableProps, ensureColWidths, ensureRowHeights } from '@/lib/table-helpers';
import {
  hasCustomCorners,
  getRectCornerPoints,
  buildRoundedPolygonPath,
  buildSvgFillDescriptor,
  buildSvgFilterCSS,
  svgStrokeDasharray,
  bboxOfPoints,
  CORNER_HANDLE_MAP,
} from '@/lib/rectangle-corners';
import { properCapitalize } from '@/lib/utils';
import { getResizeCursor } from '@/lib/resize-cursor';
import { useDesignerStore } from '@/store/designer-store';
import { useRef, useState, useCallback, useEffect, useMemo, memo } from 'react';
import { Upload, Info } from 'lucide-react';
import { motion } from 'framer-motion';
import { RichTextRenderer, CanvasTextEditor } from '@/components/designer/rich-text-editor';

// ── Constants defined outside components to avoid re-allocation ────────────────

// Resize handle positions — static constant to avoid array recreation on every render
const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

// Reflection mask lookup — avoids function call per render
const REFLECTION_MASKS: Record<string, string> = {
  soft: 'linear-gradient(to bottom, black 0%, transparent 80%)',
  tight: 'linear-gradient(to bottom, black 0%, transparent 50%)',
  fade: 'linear-gradient(to bottom, black 0%, transparent 100%)',
  mirror: 'linear-gradient(to bottom, black 0%, transparent 60%, transparent 100%)',
};

const DEFAULT_REFLECTION_MASK = 'linear-gradient(to bottom, black 0%, transparent 100%)';

function getReflectionMask(preset: string): string {
  return REFLECTION_MASKS[preset] ?? DEFAULT_REFLECTION_MASK;
}

// Resize handle component
function ResizeHandle({ position, rotation, onResizeStart }: { position: string; rotation: number; onResizeStart: (handle: string, e: React.MouseEvent) => void }) {
  const isCorner = position.length === 2;
  const size = isCorner ? 'w-2.5 h-2.5' : 'w-2 h-2';

  // Rotation-aware cursor: at 0° (and 45° increments) this returns the native
  // built-in CSS cursor; at other angles it generates a custom SVG double-arrow
  // rotated to the handle's visual screen direction. See src/lib/resize-cursor.ts.
  const cursor = getResizeCursor(position, rotation);

  const getPositionStyle = () => {
    const offset = -5;
    switch (position) {
      case 'nw': return { top: offset, left: offset };
      case 'n': return { top: offset, left: '50%', transform: 'translateX(-50%)' };
      case 'ne': return { top: offset, right: offset };
      case 'e': return { top: '50%', right: offset, transform: 'translateY(-50%)' };
      case 'se': return { bottom: offset, right: offset };
      case 's': return { bottom: offset, left: '50%', transform: 'translateX(-50%)' };
      case 'sw': return { bottom: offset, left: offset };
      case 'w': return { top: '50%', left: offset, transform: 'translateY(-50%)' };
      default: return {};
    }
  };

  // Accessible label for screen readers + arrow-key nudging for keyboard users.
  const ariaLabel = `${position} resize handle`;
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      // Keyboard users can't drag, but Enter/Space focuses the element for
      // subsequent arrow-key nudging handled by the canvas keyboard layer.
    }
  };

  return (
    <div
      data-resize-handle
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      className={`absolute ${size} bg-white border-2 border-primary rounded-sm hover:bg-primary hover:border-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary/60`}
      style={{ ...getPositionStyle() as React.CSSProperties, cursor, zIndex: 10000, pointerEvents: 'auto' }}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          useDesignerStore.getState().startPanning(e.clientX, e.clientY);
          return;
        }
        if (e.button !== 0) return;
        e.stopPropagation();
        onResizeStart(position, e);
      }}
      onKeyDown={handleKeyDown}
    />
  );
}

// Endpoint handle for line elements
function EndpointHandle({
  x,
  y,
  endpoint,
  onEndpointDragStart,
}: {
  x: number;
  y: number;
  endpoint: 'start' | 'end';
  onEndpointDragStart: (endpoint: 'start' | 'end', e: React.MouseEvent) => void;
}) {
  const ariaLabel = `${endpoint} endpoint handle`;
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      className="absolute focus:outline-none"
      style={{
        left: x - 7,
        top: y - 7,
        width: 14,
        height: 14,
        cursor: 'crosshair',
        zIndex: 10000,
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          useDesignerStore.getState().startPanning(e.clientX, e.clientY);
          return;
        }
        if (e.button !== 0) return;
        e.stopPropagation();
        onEndpointDragStart(endpoint, e);
      }}
      onKeyDown={handleKeyDown}
    >
      {/* Outer circle */}
      <div className="w-3.5 h-3.5 rounded-full bg-white border-2 border-primary hover:bg-primary hover:border-primary transition-colors absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
    </div>
  );
}

// Rectangle corner handle — appears at each of the 4 corner points of a
// selected rectangle. Behavior is ALT-gated:
//  - Alt+drag  → individual corner deformation (the corner moves independently,
//    the other 3 stay fixed). On a fresh axis-aligned rect this lazily
//    converts it to a polygon; on an already-deformed rect it just moves the
//    dragged corner.
//  - Plain drag (no Alt) → standard corner resize (nw/ne/se/sw). For a normal
//    rect this preserves the axis-aligned box; for a deformed rect the polygon
//    resizes per-edge (the opposite corner stays fixed).
// Alignment modifiers (held during an Alt+drag):
//  - Alt+Shift             → horizontal align (partner corner on the same
//                            horizontal edge snaps its Y to the dragged corner's Y).
//  - Alt+Ctrl              → vertical align (partner corner on the same vertical
//                            edge snaps its X to the dragged corner's X).
//  - Alt+Shift+Ctrl        → both (horizontal + vertical simultaneously).
function CornerHandle({
  x,
  y,
  cornerIndex,
  isCustom,
  rotation,
  onCornerMouseDown,
}: {
  x: number;
  y: number;
  cornerIndex: number; // 0=TL, 1=TR, 2=BR, 3=BL
  isCustom: boolean; // whether the rectangle already has deformed corners
  rotation: number; // rectangle rotation in degrees (for rotation-aware cursor)
  onCornerMouseDown: (cornerIndex: number, altHeld: boolean, e: React.MouseEvent) => void;
}) {
  // Rotation-aware cursor: maps corner index to its handle position (nw/ne/se/sw)
  // and generates a cursor rotated to the visual screen direction. At 0° this
  // returns the native nwse/nesw built-in; at other angles a custom SVG arrow.
  const handlePos = CORNER_HANDLE_MAP[cornerIndex];
  const cursor = getResizeCursor(handlePos, rotation);
  return (
    <div
      data-resize-handle
      data-corner-handle
      className={`absolute w-2.5 h-2.5 rounded-sm transition-colors ${
        isCustom
          ? 'bg-white border-2 border-purple-500 hover:bg-purple-500 hover:border-purple-500'
          : 'bg-white border-2 border-primary hover:bg-primary hover:border-primary'
      }`}
      style={{
        left: x - 5,
        top: y - 5,
        cursor,
        zIndex: 10000,
        pointerEvents: 'auto',
      }}
      title={isCustom ? 'Alt+drag to move corner · Alt+Shift horizontal align · Alt+Ctrl vertical align · Alt+Shift+Ctrl both' : 'Alt+drag to move corner independently'}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          useDesignerStore.getState().startPanning(e.clientX, e.clientY);
          return;
        }
        if (e.button !== 0) return;
        e.stopPropagation();
        onCornerMouseDown(cornerIndex, e.altKey, e);
      }}
    />
  );
}

// Text Element Renderer — displays formatted HTML content on the canvas.
// Double-clicking opens an inline TipTap editor directly on the canvas.
// Formatting controls live in the properties panel / floating card.
const TextElementRenderer = memo(function TextElementRenderer({ element }: { element: CanvasElement }) {
  const props = (element.properties as { type: 'text'; data: TextProperties }).data;
  const editingTextElementId = useDesignerStore((s) => s.editingTextElementId);
  const setEditingTextElement = useDesignerStore((s) => s.setEditingTextElement);
  const selectElement = useDesignerStore((s) => s.selectElement);
  const updateElementProperties = useDesignerStore((s) => s.updateElementProperties);

  const isEditing = editingTextElementId === element.id;

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // Select the element and open the inline text editor on canvas
    selectElement(element.id);
    setEditingTextElement(element.id);

    // Auto-open the Formatting floating card so the user has access to
    // formatting tools while editing (keyboard shortcuts like Shift+S
    // produce characters instead of triggering shortcuts in edit mode).
    const store = useDesignerStore.getState();
    const cardId = `${element.id}-text-content`;
    const alreadyFloating = store.floatingCards.some(c => c.id === cardId);
    if (!alreadyFloating) {
      const CARD_WIDTH = 320;
      const PANEL_WIDTH = 288;
      const PANEL_GAP = 24;
      const RIGHT_MARGIN = 90;
      const TOP_OFFSET = 160;
      const CARD_STACK_GAP = 40;

      const propertyDisplayMode = store.propertyDisplayMode;
      const targetX = propertyDisplayMode !== 'floating'
        ? window.innerWidth - PANEL_WIDTH - CARD_WIDTH - PANEL_GAP
        : window.innerWidth - CARD_WIDTH - RIGHT_MARGIN;

      const existingCards = store.floatingCards.length;
      const targetY = TOP_OFFSET + existingCards * CARD_STACK_GAP;

      store.addFloatingCard({
        id: cardId,
        sectionLabel: 'Formatting',
        x: targetX,
        y: targetY,
        minimized: false,
        zIndex: Date.now(),
      });
    }
  }, [element.id, selectElement, setEditingTextElement]);

  const handleContentChange = useCallback((html: string) => {
    const currentProps = (element.properties as { type: 'text'; data: TextProperties }).data;
    updateElementProperties(element.id, {
      type: 'text',
      data: { ...currentProps, content: html },
    });
  }, [element.id, element.properties, updateElementProperties]);

  const handleFinishEditing = useCallback(() => {
    // Capture current scroll position before exiting, so the display
    // renderer can start there and animate back to top smoothly.
    const tiptapEl = document.querySelector('.tiptap.ProseMirror') as HTMLElement | null;
    if (tiptapEl) {
      _lastTextScrollTop = tiptapEl.scrollTop;
    }
    setEditingTextElement(null);
  }, [setEditingTextElement]);

  return (
    <div
      className={`w-full h-full outline-none overflow-hidden ${
        isEditing
          ? 'ring-2 ring-primary/50 rounded cursor-default'
          : ''
      }`}
      onDoubleClick={handleDoubleClick}
    >
      {isEditing ? (
        <CanvasTextEditor
          elementId={element.id}
          props={props}
          onContentChange={handleContentChange}
          onFinishEditing={handleFinishEditing}
        />
      ) : (
        <RichTextRenderer props={props} initialScrollTop={_lastTextScrollTop} />
      )}
    </div>
  );
});

// Table Element Renderer — uses CSS Grid for fixed row heights
const TableElementRenderer = memo(function TableElementRenderer({ element }: { element: CanvasElement }) {
  const rawProps = (element.properties as { type: 'table'; data: TableProperties }).data;
  const updateElementProperties = useDesignerStore((s) => s.updateElementProperties);

  // Alt-key cell selection state from the store
  const altHeld = useDesignerStore((s) => s.altHeld);
  const selectedTableCells = useDesignerStore((s) => s.selectedTableCells);
  const hoveredTableCell = useDesignerStore((s) => s.hoveredTableCell);
  const isTableCellSelecting = useDesignerStore((s) => s.isTableCellSelecting);
  // The table that owns the current cell selection. The selection is scoped
  // to this table only — other tables on the canvas must NOT highlight cells
  // just because they share the same {row, col} coordinates.
  const tableCellSelectTableId = useDesignerStore((s) => s.tableCellSelectTableId);
  const isTableSelected = useDesignerStore(
    useCallback((s) => s.selectedElementIds.includes(element.id), [element.id])
  );
  // Whether this table is the active owner of the cell selection.
  const selectionOwnsTable = tableCellSelectTableId === element.id;

  // Normalize legacy table properties using shared helper
  const props: TableProperties = normalizeTableProps(rawProps);
  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleCellDoubleClick = (r: number, c: number) => {
    // Entering edit mode — clear any cell selection first
    useDesignerStore.getState().clearTableCellSelection();
    setEditingCell({ r, c });
    setEditValue(props.cellData[r]?.[c] || '');
  };

  const handleCellBlur = () => {
    if (editingCell) {
      const newCellData = props.cellData.map((row) => [...row]);
      newCellData[editingCell.r][editingCell.c] = editValue;
      updateElementProperties(element.id, {
        type: 'table',
        data: { ...props, cellData: newCellData },
      });
      setEditingCell(null);
    }
  };

  // ── Alt-key cell selection handlers ──────────────────────────────────────
  const handleCellMouseEnter = useCallback((r: number, c: number) => {
    if (!altHeld) return;
    const state = useDesignerStore.getState();
    state.setHoveredTableCell({ row: r, col: c, tableId: element.id });

    // If currently dragging (Alt+drag multi-select), update the selection range
    if (state.isTableCellSelecting) {
      state.updateTableCellSelecting(r, c);
    }
  }, [altHeld, element.id]);

  const handleCellMouseLeave = useCallback(() => {
    if (!altHeld) return;
    useDesignerStore.getState().setHoveredTableCell(null);
  }, [altHeld]);

  const handleCellContextMenu = useCallback((e: React.MouseEvent, r: number, c: number) => {
    if (!altHeld) return;
    e.preventDefault();
    e.stopPropagation();
    const state = useDesignerStore.getState();
    // Alt+right-click always toggles the cell selection
    state.selectTableCell(element.id, r, c, true);
  }, [altHeld, element.id]);

  const handleCellPointerDown = useCallback((e: React.PointerEvent, r: number, c: number) => {
    if (e.button !== 0) return;
    const state = useDesignerStore.getState();

    if (altHeld) {
      e.stopPropagation();
      e.preventDefault();
      if (!state.isTableCellSelecting) {
        state.startTableCellSelecting(element.id, r, c, state.selectedTableCells);
      }
    } else {
      // Non-Alt click — only deselect if clicking an unselected cell
      // Clicking a selected cell keeps the selection (double-click enters edit mode instead)
      if (state.selectedTableCells.length > 0) {
        const cellKey = `${r}-${c}`;
        const isAlreadySelected = state.selectedTableCells.some(c => `${c.row}-${c.col}` === cellKey);
        if (!isAlreadySelected) {
          e.stopPropagation();
          e.preventDefault();
          state.clearTableCellSelection();
        }
      }
    }
  }, [altHeld, element.id]);

  const handleCellPointerUp = useCallback(() => {
    const state = useDesignerStore.getState();
    if (state.isTableCellSelecting) {
      state.finishTableCellSelecting();
    }
  }, []);

  // Cell styling and border helpers are now imported from table-helpers.ts
  // They are used as: getCellBg(r, c, props), getCellBorderTop(r, c, props), etc.

  const bw = props.borderWidth;
  const borderStyleValue = props.borderStyle;
  const borderColorValue = props.borderColor;
  // Collapsed border model: each shared edge is drawn only ONCE.
  // Every cell draws its top and left borders.
  // Only the last row draws bottom borders; only the last column draws right borders.
  // This guarantees exactly one border per edge, all at the same thickness.
  const borderStr = `${bw}px ${borderStyleValue} ${borderColorValue}`;

  // Use colWidths/rowHeights fractions for grid template.
  // We convert fractions to EXPLICIT PIXEL values rather than using CSS `fr`
  // units. With `fr`, the browser redistributes all track sizes whenever any
  // fraction changes, and sub-pixel rounding can cause other rows/columns to
  // shift by ~1px during a resize drag. With explicit `px` values, each
  // track's size is computed independently and stays stable when other tracks
  // change — only the two resizing tracks actually change size. The last
  // track absorbs any rounding remainder so the grid fills the element exactly.
  const cw = ensureColWidths(props.cols, props.colWidths);
  const rh = ensureRowHeights(props.rows, props.rowHeights);
  const totalColFr = cw.reduce((a, b) => a + b, 0) || 1;
  const visibleRowHeights = props.showHeader ? rh : rh.slice(1);
  const totalRowFr = (visibleRowHeights.length > 0 ? visibleRowHeights : [1]).reduce((a, b) => a + b, 0) || 1;

  // Compute explicit pixel sizes; the last track gets the remainder to avoid
  // gaps/overflow from rounding.
  const computeTrackSizes = (fracs: number[], total: number, totalFr: number): string[] => {
    if (fracs.length === 0) return ['100%'];
    const sizes = fracs.map(f => (f / totalFr) * total);
    // Last track absorbs the rounding difference
    const allocated = sizes.slice(0, -1).reduce((a, b) => a + b, 0);
    sizes[sizes.length - 1] = total - allocated;
    return sizes.map(s => `${s}px`);
  };

  const gridTemplateColumns = computeTrackSizes(cw, element.width, totalColFr).join(' ');
  const gridTemplateRows = computeTrackSizes(
    visibleRowHeights.length > 0 ? visibleRowHeights : [1],
    element.height,
    totalRowFr
  ).join(' ');

  // Build a Set of selected cell keys for quick lookup.
  // IMPORTANT: only include cells when THIS table is the owner of the
  // selection (tableCellSelectTableId === element.id). Without this guard,
  // every table on the canvas would highlight cells at the same {row, col}
  // as the selected ones, making it look like all tables got selected.
  const selectedCellSet = useMemo(() => {
    const set = new Set<string>();
    if (!selectionOwnsTable) return set;
    for (const cell of selectedTableCells) {
      set.add(`${cell.row}-${cell.col}`);
    }
    return set;
  }, [selectedTableCells, selectionOwnsTable]);

  // Render all visible cells as grid children
  const renderCells = () => {
    const cells: React.ReactNode[] = [];

    for (let r = 0; r < props.rows; r++) {
      // Skip header row if hidden
      if (r === 0 && !props.showHeader) continue;

      const gridRow = props.showHeader ? r + 1 : r; // 1-based grid row

      for (let c = 0; c < props.cols; c++) {
        const padding = getCellPadding(r, c, props);
        const bgColor = getCellBg(r, c, props);
        const textColor = getCellColor(r, c, props);
        const fontWeight = getCellFontWeight(r, c, props);
        const fontSize = getCellFontSize(r, c, props);
        const textAlign = getCellTextAlign(r, c, props);
        const verticalAlign = getCellVerticalAlign(r, c, props);
        const textTransform = getCellTextTransform(r, c, props);
        const rotation = getCellRotation(r, c, props);

        // ── Alt-key cell selection visual feedback ──────────────────────────
        const cellKey = `${r}-${c}`;
        const isSelected = selectedCellSet.has(cellKey);
        const isHovered = altHeld && hoveredTableCell?.row === r && hoveredTableCell?.col === c && hoveredTableCell?.tableId === element.id;

        // Collapsed border model:
        // - Every cell draws top & left borders (handles outer + inner edges)
        // - Only last row draws bottom border (outer bottom edge)
        // - Only last column draws right border (outer right edge)
        // This avoids double-thick inner borders since each edge is drawn exactly once.
        // For selected cells, borders stay normal — only the dim overlay marks selection.
        const borderTop = getCellBorderTop(r, c, props) ? borderStr : 'none';
        const borderLeft = getCellBorderLeft(r, c, props) ? borderStr : 'none';
        const borderBottom = (r === props.rows - 1 && getCellBorderBottom(r, c, props)) ? borderStr : 'none';
        const borderRight = (c === props.cols - 1 && getCellBorderRight(r, c, props)) ? borderStr : 'none';

        // Corner radius: apply to corner cells so borders follow the curve
        const isFirstVisibleRow = props.showHeader ? r === 0 : r === 1;
        const isLastRow = r === props.rows - 1;
        const isFirstCol = c === 0;
        const isLastCol = c === props.cols - 1;
        const cellBorderRadius = `${isFirstVisibleRow && isFirstCol ? radii.topLeft : 0}px ${isFirstVisibleRow && isLastCol ? radii.topRight : 0}px ${isLastRow && isLastCol ? radii.bottomRight : 0}px ${isLastRow && isFirstCol ? radii.bottomLeft : 0}px`;

        // Vertical alignment via flexbox
        const justifyContent = verticalAlign === 'top'
          ? 'flex-start'
          : verticalAlign === 'bottom'
            ? 'flex-end'
            : 'center';

        // For 'capitalize', we apply proper title case via JS (first letter uppercase, rest lowercase)
        // because CSS text-transform: capitalize only uppercases first letters without lowercasing the rest.
        const effectiveTextTransform = textTransform === 'capitalize' ? 'none' : textTransform;
        const cellText = props.cellData[r]?.[c] || '';
        const displayText = textTransform === 'capitalize' ? properCapitalize(cellText) : cellText;

        cells.push(
          <div
            key={`${r}-${c}`}
            className="overflow-hidden"
            style={{
              gridRow,
              gridColumn: c + 1,
              padding: `${padding}px`,
              backgroundColor: bgColor,
              color: textColor,
              fontWeight,
              fontSize: `${fontSize}px`,
              textAlign: textAlign as 'left' | 'center' | 'right' | 'justify',
              ...(textAlign === 'justify' ? { textAlignLast: 'left' as const, textJustify: 'inter-character' as const, hyphens: 'auto' as const } : {}),
              textTransform: effectiveTextTransform as 'none' | 'uppercase' | 'lowercase',
              borderTop,
              borderBottom,
              borderLeft,
              borderRight,
              borderRadius: cellBorderRadius,
              boxSizing: 'border-box',
              // Use flexbox for vertical alignment, prevent content from expanding the cell
              display: 'flex',
              alignItems: justifyContent,
              minHeight: 0, // critical: allows grid to shrink below content size
              minWidth: 0,
              ...(rotation ? { transform: `rotate(${rotation}deg)` } : {}),
              position: 'relative',
              cursor: altHeld && isTableSelected ? 'pointer' : undefined,
            }}
            onDoubleClick={() => handleCellDoubleClick(r, c)}
            onMouseEnter={() => handleCellMouseEnter(r, c)}
            onMouseLeave={handleCellMouseLeave}
            onContextMenu={(e) => handleCellContextMenu(e, r, c)}
            onPointerDown={(e) => handleCellPointerDown(e, r, c)}
            onPointerUp={handleCellPointerUp}
          >
            {/* Alt-hover dim overlay — only when the table itself is selected */}
            {isHovered && !isSelected && isTableSelected && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ backgroundColor: 'rgba(0, 0, 0, 0.08)', zIndex: 1 }}
              />
            )}
            {/* Selected cell dim overlay */}
            {isSelected && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ backgroundColor: 'rgba(0, 0, 0, 0.06)', zIndex: 1 }}
              />
            )}
            {editingCell?.r === r && editingCell?.c === c ? (
              <input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleCellBlur}
                onKeyDown={(e) => e.key === 'Enter' && handleCellBlur()}
                className="w-full bg-transparent outline-none border-none p-0 m-0"
                style={{
                  fontSize: 'inherit',
                  fontWeight: 'inherit',
                  color: 'inherit',
                  textAlign: 'inherit',
                  lineHeight: 1.2,
                }}
              />
            ) : (
              <span
                style={{
                  display: 'block',
                  width: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.2,
                  position: 'relative',
                  zIndex: 2,
                }}
              >
                {displayText}
              </span>
            )}
          </div>
        );
      }
    }

    return cells;
  };

  const radii = resolveCornerRadius(props.cornerRadius);

  return (
    <div
      className="w-full h-full"
      style={{
        opacity: props.opacity,
        borderRadius: `${radii.topLeft}px ${radii.topRight}px ${radii.bottomRight}px ${radii.bottomLeft}px`,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateRows,
          gridTemplateColumns,
          width: '100%',
          height: '100%',
          fontSize: `${props.fontSize}px`,
          overflow: 'hidden',
          position: 'relative',
          userSelect: altHeld && isTableSelected ? 'none' : undefined,
        }}
      >
        {renderCells()}
      </div>
    </div>
  );
});

// Image Element Renderer
const ImageElementRenderer = memo(function ImageElementRenderer({ element }: { element: CanvasElement }) {
  const props = (element.properties as { type: 'image'; data: ImageProperties }).data;
  const updateElementProperties = useDesignerStore((s) => s.updateElementProperties);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effects: RectangleEffects = props.effects ?? { ...DEFAULT_EFFECTS };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const src = ev.target?.result as string;
        updateElementProperties(element.id, {
          type: 'image',
          data: { ...props, src },
        });
      };
      reader.readAsDataURL(file);
    }
  };

  // Compute combined box shadow (glow + shadow)
  const combinedBoxShadow = useMemo(() => {
    const glowBoxShadow = buildGlowCSS(effects.glow).boxShadow as string | undefined;
    const shadowBoxShadow = buildShadowCSS(effects.shadow, props.borderRadius).boxShadow as string | undefined;
    if (glowBoxShadow && shadowBoxShadow) return `${glowBoxShadow}, ${shadowBoxShadow}`;
    if (glowBoxShadow) return glowBoxShadow;
    if (shadowBoxShadow) return shadowBoxShadow;
    return undefined;
  }, [effects.glow, effects.shadow, props.borderRadius]);

  const reflectionMask = effects.reflection.enabled ? getReflectionMask(effects.reflection.preset) : undefined;

  if (!props.src) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center bg-muted/30 border-2 border-dashed border-muted-foreground/30 rounded cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => fileInputRef.current?.click()}
        style={{ borderRadius: `${props.borderRadius}px`, opacity: props.opacity, boxShadow: combinedBoxShadow }}
      >
        <Upload className="h-8 w-8 text-muted-foreground/50 mb-2" />
        <span className="text-xs text-muted-foreground/50">Click to upload</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageUpload}
        />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', contain: 'layout style' }}>
      {/* Main image with glow + shadow */}
      <div
        className="w-full h-full overflow-hidden"
        style={{
          borderRadius: `${props.borderRadius}px`,
          border: props.borderWidth > 0 ? `${props.borderWidth}px solid ${props.borderColor}` : 'none',
          opacity: props.opacity,
          boxShadow: combinedBoxShadow,
          position: 'relative',
          zIndex: 2,
        }}
      >
        <img
          src={props.src}
          alt="Element"
          className="w-full h-full"
          style={{
            objectFit: props.objectFit,
            filter: `brightness(${props.brightness ?? 100}%) contrast(${props.contrast ?? 100}%) saturate(${props.saturation ?? 100}%) blur(${props.blur ?? 0}px)`,
          }}
          draggable={false}
        />
      </div>

      {/* Reflection below */}
      {effects.reflection.enabled && (
        <div
          style={{
            position: 'absolute',
            top: `calc(100% + ${effects.reflection.distance}px)`,
            left: 0,
            width: '100%',
            height: `${effects.reflection.size}%`,
            overflow: 'hidden',
            zIndex: 1,
            pointerEvents: 'none',
            maskImage: reflectionMask,
            WebkitMaskImage: reflectionMask,
            borderRadius: `${props.borderRadius}px`,
          }}
        >
          <div style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            borderRadius: `${props.borderRadius}px`,
            border: props.borderWidth > 0 ? `${props.borderWidth}px solid ${props.borderColor}` : 'none',
            transform: 'scaleY(-1)',
            opacity: effects.reflection.opacity,
          }}>
            <img
              src={props.src}
              alt=""
              className="w-full h-full"
              style={{
                objectFit: props.objectFit,
                filter: `brightness(${props.brightness ?? 100}%) contrast(${props.contrast ?? 100}%) saturate(${props.saturation ?? 100}%) blur(${props.blur ?? 0}px)`,
              }}
              draggable={false}
            />
          </div>
        </div>
      )}
    </div>
  );
});

// Line Element Renderer — uses absolute endpoint coordinates
const LineElementRenderer = memo(function LineElementRenderer({ element }: { element: CanvasElement }) {
  const props = (element.properties as { type: 'line'; data: LineProperties }).data;

  // Get endpoint coordinates (absolute canvas position)
  const startX = element.lineStartX ?? element.x;
  const startY = element.lineStartY ?? (element.y + element.height / 2);
  const endX = element.lineEndX ?? (element.x + element.width);
  const endY = element.lineEndY ?? (element.y + element.height / 2);

  // Convert to relative coordinates within the bounding box
  const relStartX = startX - element.x;
  const relStartY = startY - element.y;
  const relEndX = endX - element.x;
  const relEndY = endY - element.y;

  const dashArray = props.strokeStyle === 'dashed' ? '8,4' : props.strokeStyle === 'dotted' ? '2,4' : 'none';

  return (
    <svg
      className="w-full h-full"
      style={{ opacity: props.opacity, overflow: 'visible' }}
    >
      <path
        d={`M ${relStartX} ${relStartY} L ${relEndX} ${relEndY}`}
        stroke={props.strokeColor}
        strokeWidth={props.strokeWidth}
        strokeDasharray={dashArray}
        strokeLinecap={props.lineCap}
        fill="none"
      />
    </svg>
  );
});

// Rectangle Element Renderer
const RectangleElementRenderer = memo(function RectangleElementRenderer({ element }: { element: CanvasElement }) {
  const props = (element.properties as { type: 'rectangle'; data: RectangleProperties }).data;
  const effects: RectangleEffects = props.effects ?? { ...DEFAULT_EFFECTS };

  // ── All hooks MUST run before any conditional return (Rules of Hooks) ──────
  // Custom-corner (deformed) rectangle: render as an SVG polygon.
  const custom = hasCustomCorners(element);
  // Skip the expensive drop-shadow filter while THIS rectangle is being
  // corner-dragged. The CSS `filter: drop-shadow(...)` on an SVG polygon
  // forces the browser to re-rasterize the filtered region on every frame;
  // temporarily disabling it during the drag eliminates the main source of
  // lag during fast mouse movement. The filter is reapplied when the drag ends.
  // The selector returns true only for the one rectangle being dragged, so
  // all other rectangles are unaffected (no re-render).
  const isBeingCornerDragged = useDesignerStore(
    (s) => s.isCornerDragging && s.cornerDragStart?.elementId === element.id,
  );
  // During an active corner drag, read the LIVE preview corners from a
  // dedicated store field (cornerDragPreview) instead of element.cornerPoints.
  // This selector only returns a new reference when THIS element's preview
  // changes — so only the dragged rectangle re-renders, not the whole canvas.
  // (Mutating elements[] on every mousemove caused the entire <Canvas> to
  // re-render, which was the main source of lag.)
  const previewCorners = useDesignerStore((s) =>
    s.isCornerDragging && s.cornerDragPreview?.elementId === element.id
      ? s.cornerDragPreview.corners
      : null,
  );
  // Effective rotation: read directly from the element's stored properties.
  // Rotation is applied by the PARENT (CanvasElementComponentInner's content
  // div, which also carries the selection ring) — NOT inside this renderer.
  // This keeps the ring + shape + reflection all rotating together as a unit,
  // and avoids a compound rotation (parent rotates, then child rotates again)
  // which would visually be the same but wastes a transform layer.
  // Effective corners: live preview during drag, otherwise the element's stored corners.
  const effectiveCorners = previewCorners ?? (custom ? getRectCornerPoints(element) : null);
  const corners = effectiveCorners;
  // During a corner drag, element.x/y/width/height are stale (we don't mutate
  // elements[] during the drag). Compute the effective bbox from the preview
  // corners so the SVG viewBox and polygon points use the correct origin/size.
  const effectiveBbox = useMemo(() => {
    if (previewCorners) return bboxOfPoints(previewCorners);
    return { x: element.x, y: element.y, width: element.width, height: element.height };
  }, [previewCorners, element.x, element.y, element.width, element.height]);
  // Rounded path "d" for the deformed rectangle. Applies the per-corner
  // borderRadius so corner radius keeps working after Alt+drag deformation
  // (the straight-edged <polygon> ignored borderRadius entirely). When all
  // radii are 0 this is equivalent to the polygon points.
  const roundedPathD = useMemo(() => {
    if (!corners) return '';
    const radii = resolveRectBorderRadius(props.borderRadius);
    return buildRoundedPolygonPath(corners, radii, { x: effectiveBbox.x, y: effectiveBbox.y });
  }, [corners, props.borderRadius, effectiveBbox.x, effectiveBbox.y]);
  const svgIdPrefix = useMemo(() => `rect-${element.id}`, [element.id]);
  const svgFill = useMemo(
    () => (custom ? buildSvgFillDescriptor(effects.gradient, svgIdPrefix, props.fill) : null),
    [custom, effects.gradient, svgIdPrefix, props.fill],
  );
  const svgFilterCSS = useMemo(
    () => (custom ? buildSvgFilterCSS(effects) : ''),
    [custom, effects],
  );
  const svgDasharray = useMemo(
    () => (custom ? svgStrokeDasharray(props.borderStyle, props.borderWidth) : undefined),
    [custom, props.borderStyle, props.borderWidth],
  );

  // Normal axis-aligned rectangle CSS computations
  const combinedBoxShadow = useMemo(() => {
    const glowBoxShadow = buildGlowCSS(effects.glow).boxShadow as string | undefined;
    const radii = resolveRectBorderRadius(props.borderRadius);
    const shadowBoxShadow = buildShadowCSS(effects.shadow, typeof props.borderRadius === 'number' ? props.borderRadius : radii.topLeft).boxShadow as string | undefined;
    if (glowBoxShadow && shadowBoxShadow) return `${glowBoxShadow}, ${shadowBoxShadow}`;
    if (glowBoxShadow) return glowBoxShadow;
    if (shadowBoxShadow) return shadowBoxShadow;
    return undefined;
  }, [effects.glow, effects.shadow, props.borderRadius]);

  const fillStyles = useMemo(() => {
    if (effects.gradient.type === 'transparent') {
      return {} as React.CSSProperties;
    }
    if (effects.gradient.type === 'gradient') {
      const gradientCSS = buildGradientCSS(effects.gradient, element.width, element.height);
      if (gradientCSS) {
        return { backgroundImage: gradientCSS } as React.CSSProperties;
      }
    }
    if (effects.gradient.type === 'picture' && effects.gradient.pictureSrc) {
      return {
        backgroundColor: props.fill,
        ...buildPictureFillCSS(effects.gradient),
      } as React.CSSProperties;
    }
    return { backgroundColor: props.fill } as React.CSSProperties;
  }, [effects.gradient, element.width, element.height, props.fill]);

  const borderRadStr = useMemo(() => {
    const radii = resolveRectBorderRadius(props.borderRadius);
    return `${radii.topLeft}px ${radii.topRight}px ${radii.bottomRight}px ${radii.bottomLeft}px`;
  }, [props.borderRadius]);

  // ── Custom-corner early return (all hooks already executed above) ─────────
  if (custom && corners && svgFill) {
    const borderStyleValue =
      props.borderStyle === 'dotted' ? 'dotted' : props.borderStyle === 'dashed' ? 'dashed' : 'solid';
    const reflectionMask = effects.reflection.enabled ? getReflectionMask(effects.reflection.preset) : undefined;
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Main polygon shape — drop-shadow filter follows the polygon alpha so
            shadows/glows conform to the custom quadrilateral automatically. */}
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${effectiveBbox.width} ${effectiveBbox.height}`}
          overflow="visible"
          style={{ position: 'relative', zIndex: 2, display: 'block', filter: (!isBeingCornerDragged && svgFilterCSS) ? svgFilterCSS : undefined, opacity: props.opacity, pointerEvents: 'none' }}
        >
          {svgFill.defs ? <g dangerouslySetInnerHTML={{ __html: svgFill.defs }} /> : null}
          <path
            d={roundedPathD}
            fill={svgFill.fill}
            stroke={props.borderColor}
            strokeWidth={props.borderWidth}
            strokeDasharray={svgDasharray}
            strokeLinejoin="round"
            strokeLinecap={borderStyleValue === 'dotted' ? 'round' : 'butt'}
          />
        </svg>

        {/* Reflection below (mirrored polygon) */}
        {effects.reflection.enabled && (
          <div
            style={{
              position: 'absolute',
              top: `calc(100% + ${effects.reflection.distance}px)`,
              left: 0,
              width: '100%',
              height: `${effects.reflection.size}%`,
              overflow: 'hidden',
              zIndex: 1,
              pointerEvents: 'none',
              maskImage: reflectionMask,
              WebkitMaskImage: reflectionMask,
            }}
          >
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${effectiveBbox.width} ${effectiveBbox.height}`}
              overflow="visible"
              style={{ display: 'block', transform: 'scaleY(-1)', opacity: effects.reflection.opacity }}
            >
              {svgFill.defs ? <g dangerouslySetInnerHTML={{ __html: svgFill.defs }} /> : null}
              <path
                d={roundedPathD}
                fill={svgFill.fill}
                stroke={props.borderColor}
                strokeWidth={props.borderWidth}
                strokeDasharray={svgDasharray}
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}
      </div>
    );
  }

  // ── Normal axis-aligned rectangle (original div-based renderer) ───────────
  const borderStyleValue = props.borderStyle === 'dotted'
    ? 'dotted'
    : props.borderStyle === 'dashed'
      ? 'dashed'
      : 'solid';

  const shapeStyles: React.CSSProperties = {
    width: '100%',
    height: '100%',
    ...fillStyles,
    borderWidth: `${props.borderWidth}px`,
    borderColor: props.borderColor,
    borderStyle: borderStyleValue,
    borderRadius: borderRadStr,
    opacity: props.opacity,
    boxSizing: 'border-box',
  };

  const reflectionShapeStyles: React.CSSProperties = {
    width: '100%',
    height: '100%',
    ...fillStyles,
    borderRadius: borderRadStr,
    boxSizing: 'border-box',
  };

  const reflectionMask = effects.reflection.enabled ? getReflectionMask(effects.reflection.preset) : undefined;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', contain: 'layout style' }}>
      {/* Main shape with glow + shadow + fill + border */}
      <div
        style={{
          ...shapeStyles,
          position: 'relative',
          zIndex: 2,
          boxShadow: combinedBoxShadow,
        }}
      />

      {/* Reflection below */}
      {effects.reflection.enabled && (
        <div
          style={{
            position: 'absolute',
            top: `calc(100% + ${effects.reflection.distance}px)`,
            left: 0,
            width: '100%',
            height: `${effects.reflection.size}%`,
            overflow: 'hidden',
            zIndex: 1,
            pointerEvents: 'none',
            maskImage: reflectionMask,
            WebkitMaskImage: reflectionMask,
          }}
        >
          <div style={{
            ...reflectionShapeStyles,
            transform: 'scaleY(-1)',
            opacity: effects.reflection.opacity,
          }} />
        </div>
      )}
    </div>
  );
});

// Ellipse Element Renderer
const EllipseElementRenderer = memo(function EllipseElementRenderer({ element }: { element: CanvasElement }) {
  const props = (element.properties as { type: 'ellipse'; data: EllipseProperties }).data;
  const effects: RectangleEffects = props.effects ?? { ...DEFAULT_EFFECTS };

  // Memoize expensive CSS computations
  const combinedBoxShadow = useMemo(() => {
    const glowBoxShadow = buildGlowCSS(effects.glow).boxShadow as string | undefined;
    const shadowBoxShadow = buildShadowCSS(effects.shadow, 50).boxShadow as string | undefined;
    if (glowBoxShadow && shadowBoxShadow) return `${glowBoxShadow}, ${shadowBoxShadow}`;
    if (glowBoxShadow) return glowBoxShadow;
    if (shadowBoxShadow) return shadowBoxShadow;
    return undefined;
  }, [effects.glow, effects.shadow]);

  // Build fill styles using only longhand CSS properties to avoid
  // React warnings about mixing shorthand (`background`) with longhand
  // (`backgroundImage`, `backgroundSize`, etc.).
  const fillStyles = useMemo(() => {
    if (effects.gradient.type === 'transparent') {
      // Transparent fill — no background at all
      return {} as React.CSSProperties;
    }
    if (effects.gradient.type === 'gradient') {
      const gradientCSS = buildGradientCSS(effects.gradient, element.width, element.height);
      if (gradientCSS) {
        return { backgroundImage: gradientCSS } as React.CSSProperties;
      }
    }
    if (effects.gradient.type === 'picture' && effects.gradient.pictureSrc) {
      // Picture fill: backgroundColor from props.fill + picture longhand properties
      return {
        backgroundColor: props.fill,
        ...buildPictureFillCSS(effects.gradient),
      } as React.CSSProperties;
    }
    // Solid fill
    return { backgroundColor: props.fill } as React.CSSProperties;
  }, [effects.gradient, element.width, element.height, props.fill]);

  // Border style resolution
  const borderStyleValue = props.borderStyle === 'dotted'
    ? 'dotted'
    : props.borderStyle === 'dashed'
      ? 'dashed'
      : 'solid';

  // Main shape styles (reused for reflection copy without shadow/glow)
  const shapeStyles: React.CSSProperties = {
    width: '100%',
    height: '100%',
    ...fillStyles,
    borderWidth: `${props.borderWidth}px`,
    borderColor: props.borderColor,
    borderStyle: borderStyleValue,
    borderRadius: '50%',
    opacity: props.opacity,
    boxSizing: 'border-box',
  };

  // Reflection shape styles (no shadow/glow, no border)
  const reflectionShapeStyles: React.CSSProperties = {
    width: '100%',
    height: '100%',
    ...fillStyles,
    borderRadius: '50%',
    boxSizing: 'border-box',
  };

  const reflectionMask = effects.reflection.enabled ? getReflectionMask(effects.reflection.preset) : undefined;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', contain: 'layout style' }}>
      {/* Main shape with glow + shadow + fill + border */}
      <div
        style={{
          ...shapeStyles,
          position: 'relative',
          zIndex: 2,
          boxShadow: combinedBoxShadow,
        }}
      />

      {/* Reflection below */}
      {effects.reflection.enabled && (
        <div
          style={{
            position: 'absolute',
            top: `calc(100% + ${effects.reflection.distance}px)`,
            left: 0,
            width: '100%',
            height: `${effects.reflection.size}%`,
            overflow: 'hidden',
            zIndex: 1,
            pointerEvents: 'none',
            maskImage: reflectionMask,
            WebkitMaskImage: reflectionMask,
          }}
        >
          <div style={{
            ...reflectionShapeStyles,
            transform: 'scaleY(-1)',
            opacity: effects.reflection.opacity,
          }} />
        </div>
      )}
    </div>
  );
});

// Group Element Renderer — renders children inside a group container
const GroupElementRenderer = memo(function GroupElementRenderer({ element, isInEditMode }: { element: CanvasElement; isInEditMode: boolean }) {
  if (!element.children || element.children.length === 0) return null;

  if (isInEditMode) {
    // In group edit mode: render children individually at their relative positions
    // inside a relative container with a dashed border
    return (
      <div className="w-full h-full relative">
        {element.children.map((child) => (
          <CanvasElementComponent key={child.id} element={child} isGroupChild />
        ))}
      </div>
    );
  }

  // Not in edit mode: render children at their relative positions inside a transparent container
  return (
    <div className="w-full h-full relative">
      {element.children.map((child) => (
        <div
          key={child.id}
          className="absolute"
          style={{
            left: child.x,
            top: child.y,
            width: child.width,
            height: child.height,
            pointerEvents: 'none', // children are not individually clickable
          }}
        >
          <GroupChildContent element={child} />
        </div>
      ))}
    </div>
  );
});

// Renders the visual content of a child element inside a group (non-interactive)
const GroupChildContent = memo(function GroupChildContent({ element }: { element: CanvasElement }) {
  if (!element.visible) return null;
  switch (element.type) {
    case 'text':
      return <TextElementRenderer element={element} />;
    case 'table':
      return <TableElementRenderer element={element} />;
    case 'image':
      return <ImageElementRenderer element={element} />;
    case 'line':
      return <LineElementRenderer element={element} />;
    case 'rectangle':
      return <RectangleElementRenderer element={element} />;
    case 'ellipse':
      return <EllipseElementRenderer element={element} />;
    case 'group':
      return <GroupElementRenderer element={element} isInEditMode={false} />;
    default:
      return null;
  }
});

// Table Resize Handles — draggable column/row borders for resizing table cells
// Hidden when Alt is held (cell selection mode)
function TableResizeHandles({ element, hidden }: { element: CanvasElement; hidden?: boolean }) {
  const rawProps = (element.properties as { type: 'table'; data: TableProperties }).data;
  const props = normalizeTableProps(rawProps);
  const startTableColResize = useDesignerStore((s) => s.startTableColResize);
  const startTableRowResize = useDesignerStore((s) => s.startTableRowResize);
  // Suppress hover highlights on ALL handles during an active resize so that
  // hovering other handles while dragging doesn't show a hover effect.
  const isTableColResizing = useDesignerStore((s) => s.isTableColResizing);
  const isTableRowResizing = useDesignerStore((s) => s.isTableRowResizing);
  const isResizing = isTableColResizing || isTableRowResizing;

  // Must be after hooks to avoid React Rules of Hooks violation
  if (hidden) return null;

  const cw = ensureColWidths(props.cols, props.colWidths);
  const rh = ensureRowHeights(props.rows, props.rowHeights);
  // Guard against NaN / zero values that would produce invalid CSS positions
  const safeCw = cw.map(v => (isFinite(v) && v > 0 ? v : 1));
  const safeRh = rh.map(v => (isFinite(v) && v > 0 ? v : 1));
  const totalColFr = safeCw.reduce((a, b) => a + b, 0) || 1;
  // For row handle positions, use the SAME total as the grid template (visible
  // rows only when showHeader is false) so handles align with the actual grid
  // boundaries. Previously this used all rows including the hidden header,
  // causing handle positions to drift from the rendered row boundaries.
  const startRow = props.showHeader ? 0 : 1;
  const visibleSafeRh = safeRh.slice(startRow);
  const totalRowFr = (visibleSafeRh.length > 0 ? visibleSafeRh : [1]).reduce((a, b) => a + b, 0) || 1;

  const handles: React.ReactNode[] = [];

  // Column borders (vertical lines between columns)
  // Column handles use z-index 10002 (higher than row handles at 10001)
  // so they take priority at intersection points — column resize is more common.
  let cumX = 0;
  for (let c = 0; c < props.cols - 1; c++) {
    cumX += safeCw[c];
    const x = (cumX / totalColFr) * element.width;
    const colIndex = c; // capture for closure
    handles.push(
      <div
        key={`col-${c}`}
        className="absolute top-0 bottom-0 group/col-handle"
        data-table-resize-handle="col"
        style={{
          left: x - 5,
          width: 10,
          cursor: 'col-resize',
          zIndex: 10002,
          pointerEvents: isResizing ? 'none' : 'auto',
        }}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.preventDefault();
          startTableColResize(element.id, colIndex, e.clientX);
        }}
      >
        {/* Invisible hit area covers full height; visible highlight line on hover.
            Suppress hover during an active resize so other handles don't react. */}
        <div
          className={`absolute left-1/2 top-0 bottom-0 w-0.5 transition-colors ${isResizing ? 'bg-transparent' : 'bg-transparent group-hover/col-handle:bg-primary/60'}`}
          style={{ transform: 'translateX(-50%)' }}
        />
      </div>
    );
  }

  // Row borders (horizontal lines between rows)
  // Row handles use z-index 10001 (lower than column handles at 10002)
  let cumY = 0;
  // startRow and totalRowFr are computed above (consistent with the grid template)
  for (let r = startRow; r < props.rows - 1; r++) {
    cumY += safeRh[r];
    const y = (cumY / totalRowFr) * element.height;
    const rowIndex = r; // capture for closure
    handles.push(
      <div
        key={`row-${r}`}
        className="absolute left-0 right-0 group/row-handle"
        data-table-resize-handle="row"
        style={{
          top: y - 5,
          height: 10,
          cursor: 'row-resize',
          zIndex: 10001,
          pointerEvents: isResizing ? 'none' : 'auto',
        }}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.preventDefault();
          startTableRowResize(element.id, rowIndex, e.clientY);
        }}
      >
        <div
          className={`absolute top-1/2 left-0 right-0 h-0.5 transition-colors ${isResizing ? 'bg-transparent' : 'bg-transparent group-hover/row-handle:bg-primary/60'}`}
          style={{ transform: 'translateY(-50%)' }}
        />
      </div>
    );
  }

  return <>{handles}</>;
}

// Helper: capture the current TipTap scroll position into a module-level
// variable so that RichTextRenderer can pick it up and animate from that
// offset back to 0 (smooth scroll-back when exiting edit mode).
let _lastTextScrollTop = 0;
export function getLastTextScrollTop() { return _lastTextScrollTop; }
export function resetLastTextScrollTop() { _lastTextScrollTop = 0; }

function captureTextScrollAndExit(state: ReturnType<typeof useDesignerStore.getState>) {
  const tiptapEl = document.querySelector('.tiptap.ProseMirror') as HTMLElement | null;
  if (tiptapEl) {
    _lastTextScrollTop = tiptapEl.scrollTop;
  }
  state.setEditingTextElement(null);
}

// Main Canvas Element Component — wrapped in React.memo with custom comparator
// to avoid re-rendering when only unrelated selection state changes
function CanvasElementComponentInner({ element, isGroupChild: isGroupChildProp = false }: { element: CanvasElement; isGroupChild?: boolean }) {
  // Use derived selectors to avoid re-rendering all elements when selection changes.
  // Only elements whose selection state actually changes will re-render.
  const isSelected = useDesignerStore(
    useCallback((s) => s.selectedElementIds.includes(element.id), [element.id])
  );
  const isPrimarySelected = useDesignerStore(
    useCallback((s) => s.selectedElementIds[0] === element.id, [element.id])
  );
  const selectionCount = useDesignerStore((s) => s.selectedElementIds.length);
  const startDragging = useDesignerStore((s) => s.startDragging);
  const selectElement = useDesignerStore((s) => s.selectElement);
  const toggleInSelection = useDesignerStore((s) => s.toggleInSelection);
  const startResizing = useDesignerStore((s) => s.startResizing);
  const startEndpointDrag = useDesignerStore((s) => s.startEndpointDrag);
  const startGroupChildResize = useDesignerStore((s) => s.startGroupChildResize);
  const startCornerDrag = useDesignerStore((s) => s.startCornerDrag);
  const angleSnapInfo = useDesignerStore((s) => s.angleSnapInfo);
  const editingGroupId = useDesignerStore((s) => s.editingGroupId);
  const enterGroup = useDesignerStore((s) => s.enterGroup);
  const editingTextElementId = useDesignerStore((s) => s.editingTextElementId);
  const altHeld = useDesignerStore((s) => s.altHeld);
  // Per-element "ⓘ" info icons — shown above dropped tools when the footer
  // toggle is on. Clicking opens the ToolInfoDialog for this element's type.
  const toolInfoIconsVisible = useDesignerStore((s) => s.toolInfoIconsVisible);
  const setToolInfoElementType = useDesignerStore((s) => s.setToolInfoElementType);
  // exitGroup accessed via getState() to avoid unnecessary re-renders

  const isLine = element.type === 'line';
  const isGroup = element.type === 'group';
  // A deformed rectangle has custom corner points — its visible shape is a
  // polygon, not the bounding box. We suppress the rectangular selection ring
  // for these and draw a dashed polygon outline instead.
  const isDeformedRect = element.type === 'rectangle' && hasCustomCorners(element);
  // A group is in edit mode if editingGroupId matches its id
  const isGroupInEditMode = isGroup && editingGroupId === element.id;
  // Whether this text element is currently being edited inline
  const isTextEditing = element.type === 'text' && editingTextElementId === element.id;
  // When Alt is held on a SINGLE-selected rectangle (not in multi-select),
  // hide the bounding-box ring, the dashed polygon outline, and the 4 edge
  // (midpoint) resize handles — leaving only the 4 corner handles visible so
  // the user can focus on corner manipulation. Everything reappears when Alt
  // is released. This only applies to rectangles (single-select only).
  const hideRectBBoxOnAlt =
    altHeld && element.type === 'rectangle' && isPrimarySelected && selectionCount === 1 && !isGroupChildProp;
  // Live preview corners during a corner drag — read here so the corner
  // handles and dashed outline follow the drag in real time. Only this
  // element subscribes, so only it re-renders (not the whole canvas).
  const previewCornersForHandles = useDesignerStore((s) =>
    s.isCornerDragging && s.cornerDragPreview?.elementId === element.id
      ? s.cornerDragPreview.corners
      : null,
  );
  // During an active corner drag, element.x/y/width/height are STALE (they
  // are only committed in stopCornerDrag). The SVG polygon + corner handles
  // are rendered relative to the LIVE preview-corners' bbox, so if the outer
  // wrapper div stays anchored at the stale bbox, the SVG viewBox mapping
  // (viewBox="0 0 newW newH" into the old div size) SCALES the polygon and the
  // handles shift by (oldOrigin - newOrigin) — making the fixed corners appear
  // to "move around". To keep the wrapper, SVG viewBox, polygon points and
  // handles all in the same coordinate space, we reposition/resize the wrapper
  // to the live preview-corners' bbox for the duration of the drag.
  const cornerDragBbox = useMemo(
    () => (previewCornersForHandles ? bboxOfPoints(previewCornersForHandles) : null),
    [previewCornersForHandles],
  );

  // Rectangle rotation (rectangle-only feature, per spec). Read directly from
  // the element's stored properties. Applied to the CONTENT div below (the one
  // carrying the selection ring) so the ring + shape + reflection all rotate
  // together as a unit. The outer wrapper (motion.div) and the selection
  // handles overlay (corner/edge handles) stay axis-aligned — handles need to
  // stay at the bbox corners so they remain grabbable at predictable spots.
  // The memo comparator on CanvasElementComponent re-renders whenever the
  // element's properties reference changes, which is exactly when rotation can
  // change, so this stays in sync with property-panel edits in real time.
  const rectRotation = element.type === 'rectangle' ? getRectRotation(element) : 0;
  // During an active corner drag on THIS rectangle, pin the rotation pivot to
  // the ORIGINAL bbox center (captured at drag start) instead of the live bbox
  // center. The corner points are in unrotated space and the renderer rotates
  // them around `transform-origin` — if the origin followed the live bbox
  // center (which shifts whenever a corner moves), the three "fixed" corners
  // would visibly drift because they get re-rotated around the new center.
  // Pinning the origin to the original center keeps the fixed corners visually
  // stationary while the dragged corner follows the mouse 1:1 (the store's
  // updateCornerDrag transforms the mouse delta by R(-θ) to compensate for the
  // rotation, so visual movement = R(θ)·R(-θ)·screenDelta = screenDelta).
  const cornerDragOrigBbox = useDesignerStore((s) =>
    s.isCornerDragging && s.cornerDragStart?.elementId === element.id
      ? s.cornerDragStart.origBbox
      : null,
  );
  const rotationStyle: React.CSSProperties = (() => {
    if (!rectRotation) return {};
    if (cornerDragOrigBbox && cornerDragBbox) {
      // Express the original center relative to the current (live) wrapper bbox
      // so the CSS transform-origin lands at the correct pixel position.
      const origCx = cornerDragOrigBbox.x + cornerDragOrigBbox.width / 2;
      const origCy = cornerDragOrigBbox.y + cornerDragOrigBbox.height / 2;
      return {
        transform: `rotate(${rectRotation}deg)`,
        transformOrigin: `${origCx - cornerDragBbox.x}px ${origCy - cornerDragBbox.y}px`,
      };
    }
    return { transform: `rotate(${rectRotation}deg)`, transformOrigin: 'center' };
  })();

  // Drop animation: check if this element was just added
  const lastAddedElementId = useDesignerStore((s) => s.lastAddedElementId);
  const clearLastAddedElementId = useDesignerStore((s) => s.clearLastAddedElementId);
  const isJustAdded = !isGroupChildProp && lastAddedElementId === element.id;

  useEffect(() => {
    if (isJustAdded) {
      // Clear after animation completes
      const timer = setTimeout(() => {
        clearLastAddedElementId();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [isJustAdded, clearLastAddedElementId]);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Middle mouse button → always pan, regardless of what's under the cursor
    if (e.button === 1) {
      e.preventDefault();
      useDesignerStore.getState().startPanning(e.clientX, e.clientY);
      return;
    }
    // Only respond to left mouse button
    if (e.button !== 0) return;

    e.stopPropagation();

    const state = useDesignerStore.getState();

    // ── Text edit mode handling ──────────────────────────────────────
    // If this text element is currently being edited (inline TipTap editor
    // is active), handle the click based on where it lands:
    // - Inside the TipTap editor → let TipTap handle text selection
    // - On the border/ring area or resize handles → exit edit mode
    if (
      element.type === 'text' &&
      state.editingTextElementId === element.id
    ) {
      // If clicking on a resize handle, let the resize handler deal with it
      // (the resize handler will exit edit mode separately)
      if ((e.target as HTMLElement).closest?.('[data-resize-handle]')) {
        // Don't return — fall through to normal drag/resize logic
        // But exit edit mode first (capture scroll for smooth transition)
        captureTextScrollAndExit(state);
      } else if ((e.target as HTMLElement).closest?.('[data-no-drag]')) {
        // Click inside the TipTap editor — let TipTap handle text selection
        // Don't start dragging, don't exit edit mode
        return;
      } else {
        // Click on the border/ring area or elsewhere on the element — exit edit mode
        captureTextScrollAndExit(state);
        return;
      }
    }

    // If clicking on a different element while a text element is being edited,
    // exit text edit mode first
    if (state.editingTextElementId && state.editingTextElementId !== element.id) {
      captureTextScrollAndExit(state);
    }

    // If we're in group edit mode and clicking on a root-level element,
    // exit group edit mode first
    if (!isGroupChildProp && state.editingGroupId) {
      const editingGroup = state.elements.find((el) => el.id === state.editingGroupId);
      if (editingGroup && element.id !== state.editingGroupId) {
        state.exitGroup();
      }
    }

    // If this is a group child element and we're NOT in group edit mode,
    // select the parent group instead
    if (isGroupChildProp && !state.editingGroupId) {
      const parentGroup = state.findParentGroup(element.id);
      if (parentGroup) {
        if (e.shiftKey) {
          toggleInSelection(parentGroup.id);
        } else {
          selectElement(parentGroup.id);
          startDragging(parentGroup.id, e.clientX, e.clientY);
        }
        return;
      }
    }

    // In group edit mode, handle child element selection and dragging
    if (isGroupChildProp && state.editingGroupId) {
      if (element.locked) {
        selectElement(element.id);
        return;
      }
      if (e.shiftKey) {
        toggleInSelection(element.id);
      } else if (isSelected && state.selectedElementIds.length > 1) {
        // Already in multi-selection, start dragging
        state.startGroupChildDrag(element.id, e.clientX, e.clientY);
      } else {
        selectElement(element.id);
        state.startGroupChildDrag(element.id, e.clientX, e.clientY);
      }
      return;
    }

    if (e.shiftKey) {
      // Shift+click: toggle this element in/out of selection
      toggleInSelection(element.id);
      // If the element was NOT in the selection before toggle, it's being added — start multi-drag
      if (!element.locked && !state.selectedElementIds.includes(element.id)) {
        startDragging(element.id, e.clientX, e.clientY);
      }
    } else if (!element.locked) {
      // Normal click: if clicking an already-selected element in a multi-selection,
      // don't change the selection (so we can drag the whole group)
      if (isSelected && state.selectedElementIds.length > 1) {
        startDragging(element.id, e.clientX, e.clientY);
      } else {
        selectElement(element.id);
        startDragging(element.id, e.clientX, e.clientY);
      }
    } else {
      selectElement(element.id);
    }
  };

  const handleResizeStart = useCallback((handle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Exit text edit mode if resizing this element
    const state = useDesignerStore.getState();
    if (state.editingTextElementId === element.id) {
      captureTextScrollAndExit(state);
    }
    startResizing(element.id, handle, e.clientX, e.clientY);
  }, [element.id, startResizing]);

  const handleGroupChildResizeStart = useCallback((handle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Exit text edit mode if resizing this element
    const state = useDesignerStore.getState();
    if (state.editingTextElementId === element.id) {
      captureTextScrollAndExit(state);
    }
    startGroupChildResize(element.id, handle, e.clientX, e.clientY);
  }, [element.id, startGroupChildResize]);

  const handleEndpointDragStart = useCallback((endpoint: 'start' | 'end', e: React.MouseEvent) => {
    e.stopPropagation();
    startEndpointDrag(element.id, endpoint, e.clientX, e.clientY);
  }, [element.id, startEndpointDrag]);

  // Corner handle mousedown for rectangles:
  //  - If Alt is held → start a corner drag (individual corner deformation).
  //    On a fresh axis-aligned rect this lazily initializes cornerPoints,
  //    converting it to a polygon; on an already-deformed rect it just moves
  //    the dragged corner while the other 3 stay fixed.
  //  - Else (Alt NOT held) → standard corner resize using the matching
  //    nw/ne/se/sw handle id. For a normal rect this preserves the
  //    axis-aligned box; for a deformed rect the polygon scales
  //    proportionally (same as dragging an edge handle). This is intentional:
  //    individual corner movement is Alt-only, so releasing Alt restores the
  //    "normal" resize behavior on every corner handle.
  const handleCornerMouseDown = useCallback((cornerIndex: number, altHeldFlag: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    const state = useDesignerStore.getState();
    if (state.editingTextElementId === element.id) {
      captureTextScrollAndExit(state);
    }
    // Read the live Alt state from the store as a fallback — the store's
    // keydown listener sets altHeld synchronously, so this is reliable even
    // when the native mouse event's altKey flag is inconsistent (e.g. when
    // Alt is pressed slightly before the mousedown reaches the element).
    const altActive = altHeldFlag || state.altHeld;
    // Individual corner movement is ALT-ONLY. Previously the condition was
    // `isCustom || altActive`, which meant that once a rectangle had been
    // deformed (has cornerPoints), the user could keep dragging any corner
    // individually WITHOUT holding Alt — making it impossible to get back to
    // "normal" axis-aligned corner resize on a deformed rect.
    //
    // New behavior:
    //   - Alt held  + drag corner  → individual corner deformation (polygon).
    //   - Alt NOT held + drag corner → standard corner resize (preserves the
    //     axis-aligned box for normal rects; scales the polygon proportionally
    //     for already-deformed rects, exactly like dragging an edge handle).
    // This matches the user's expectation: after releasing Alt, the corner
    // points behave like the middle (edge) handles again.
    if (altActive) {
      startCornerDrag(element.id, cornerIndex, e.clientX, e.clientY);
    } else {
      // Map corner index → standard resize handle id and delegate to normal resize
      const handleId = CORNER_HANDLE_MAP[cornerIndex];
      if (isGroupChildProp && editingGroupId) {
        startGroupChildResize(element.id, handleId, e.clientX, e.clientY);
      } else {
        startResizing(element.id, handleId, e.clientX, e.clientY);
      }
    }
  }, [element, startCornerDrag, startResizing, startGroupChildResize, isGroupChildProp, editingGroupId]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    // Double-click on a group → enter group edit mode
    if (element.type === 'group' && !element.locked) {
      e.stopPropagation();
      enterGroup(element.id);
    }
  };

  const renderContent = () => {
    switch (element.type) {
      case 'text':
        return <TextElementRenderer element={element} />;
      case 'table':
        return <TableElementRenderer element={element} />;
      case 'image':
        return <ImageElementRenderer element={element} />;
      case 'line':
        return <LineElementRenderer element={element} />;
      case 'rectangle':
        return <RectangleElementRenderer element={element} />;
      case 'ellipse':
        return <EllipseElementRenderer element={element} />;
      case 'group':
        return <GroupElementRenderer element={element} isInEditMode={isGroupInEditMode} />;
      default:
        return null;
    }
  };

  if (!element.visible) return null;

  // For line elements, compute endpoint handle positions relative to bounding box
  const getLineEndpointPositions = () => {
    const startX = element.lineStartX ?? element.x;
    const startY = element.lineStartY ?? (element.y + element.height / 2);
    const endX = element.lineEndX ?? (element.x + element.width);
    const endY = element.lineEndY ?? (element.y + element.height / 2);

    // Relative to the bounding box (element.x, element.y)
    return {
      startRelX: startX - element.x,
      startRelY: startY - element.y,
      endRelX: endX - element.x,
      endRelY: endY - element.y,
    };
  };

  return (
    <motion.div
      className="absolute group"
      style={{
        // During an active corner drag, follow the LIVE preview-corners' bbox
        // so the wrapper, the SVG viewBox, the polygon points, and the corner
        // handles all share the same coordinate space. Without this the wrapper
        // stays at the stale (pre-drag) bbox, causing the SVG viewBox→div
        // mapping to scale the polygon and shift the handles — which made the
        // non-dragged corners appear to drift and the shape look "stuck".
        left: cornerDragBbox ? cornerDragBbox.x : element.x,
        top: cornerDragBbox ? cornerDragBbox.y : element.y,
        width: cornerDragBbox ? cornerDragBbox.width : element.width,
        height: cornerDragBbox ? cornerDragBbox.height : element.height,
        // No explicit zIndex — DOM order (array index) determines z-order.
        // z-index: auto does NOT create a stacking context, so selection handles
        // with high z-index can participate in the ancestor stacking context
        // and appear above all elements regardless of this element's z-order.
      }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      initial={isJustAdded ? { scale: 0.5, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={isJustAdded ? { type: 'spring', stiffness: 300, damping: 25, duration: 0.3 } : { duration: 0 }}
    >
      {/* Element content — renders at natural z-order via DOM position.
          The rotation transform is applied HERE (not inside the renderer) so
          that the selection ring (ring-2 ring-primary) rotates together with
          the shape. The outer motion.div wrapper and the selection-handles
          overlay (corner/edge handles rendered in the next sibling block)
          stay axis-aligned — handles remain at the bbox corners where they're
          grabbable. */}
      <div
        className={`w-full h-full ${
          isSelected && !isLine && !isGroup && !isTextEditing && (!isDeformedRect || selectionCount > 1) && !hideRectBBoxOnAlt ? 'ring-2 ring-primary ring-offset-1' : ''
        } ${isSelected && isGroup ? 'ring-2 ring-primary ring-offset-1' : ''} ${isTextEditing ? 'cursor-text' : element.locked ? 'cursor-not-allowed' : !isLine ? 'cursor-move' : ''}`}
        style={{
          contain: 'layout style',
          ...rotationStyle,
          // Top-level element opacity (applies to ALL types, including groups).
          // Defaults to 1 when undefined. Applied here (on the content div)
          // rather than the motion.div wrapper so framer-motion's entrance
          // animation (animate={{ opacity: 1 }}) doesn't override it.
          ...(element.opacity !== undefined && element.opacity !== 1
            ? { opacity: element.opacity }
            : {}),
        }}
      >
        {renderContent()}
      </div>

      {/* Per-element "ⓘ" info icon — sits above the element. Only shown when
          the element is SELECTED, and gated by the footer toggle. Clicking
          opens the ToolInfoDialog for this element's type. stopPropagation on
          pointer/mouse down so it doesn't start a canvas drag. Hidden for
          group children (they show their own group's icon via the parent). */}
      {toolInfoIconsVisible && isSelected && !isGroupChildProp && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setToolInfoElementType(element.type);
          }}
          className="absolute -top-6 left-1/2 -translate-x-1/2 z-[10001] flex items-center justify-center w-5 h-5 rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground transition-colors cursor-help"
          title={`${properCapitalize(element.type)} shortcuts`}
          aria-label={`Show ${element.type} shortcuts`}
        >
          <Info className="h-3 w-3" />
        </button>
      )}

      {/* Selection outline and handles — high z-index escapes the element's
          stacking context (since parent has z-index: auto) and appears above
          all elements in the canvas.

          ROTATION: This entire overlay is wrapped in a div that mirrors the
          content div's rotation transform. This is critical — without it, the
          selection ring rotates (because it's on the content div) but the
          handles would stay anchored to the axis-aligned bbox corners, floating
          in the air around the rotated shape. By rotating the overlay too, the
          handles track the rotated rectangle's actual corners/edges.

          The wrapper has `pointer-events: none` so it doesn't intercept clicks
          on the rotated rectangle's body (those should bubble to motion.div's
          onMouseDown for drag-to-move). The handles themselves opt back in to
          pointer events via their inline `pointerEvents: 'auto'` style.

          transform-origin is `center` to match the content div — both pivot
          around the bbox center, so handles and shape stay aligned. */}
      {isSelected && (
        <div
          className="absolute inset-0"
          style={{
            ...rotationStyle,
            pointerEvents: 'none',
          }}
        >
        <>
          {isPrimarySelected && isLine && selectionCount <= 1 ? (
            (() => {
              const { startRelX, startRelY, endRelX, endRelY } = getLineEndpointPositions();
              const isAngleSnapping = !!angleSnapInfo && isSelected;
              return (
                <>
                  {/* Selection line highlight — brighter when angle snapping */}
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ overflow: 'visible', zIndex: 10000 }}
                  >
                    <path
                      d={`M ${startRelX} ${startRelY} L ${endRelX} ${endRelY}`}
                      stroke="#ec4899"
                      strokeWidth={isAngleSnapping ? 3 : 2}
                      strokeDasharray={isAngleSnapping ? undefined : "4,3"}
                      fill="none"
                      opacity={isAngleSnapping ? 0.8 : 0.4}
                    />
                  </svg>
                  {/* Start endpoint */}
                  <EndpointHandle
                    x={startRelX}
                    y={startRelY}
                    endpoint="start"
                    onEndpointDragStart={handleEndpointDragStart}
                  />
                  {/* End endpoint */}
                  <EndpointHandle
                    x={endRelX}
                    y={endRelY}
                    endpoint="end"
                    onEndpointDragStart={handleEndpointDragStart}
                  />
                </>
              );
            })()
          ) : isPrimarySelected && !isLine && selectionCount <= 1 && (!isGroupChildProp || editingGroupId) ? (
            // Primary non-line element: standard resize handles (single-select only)
            // In multi-select, no resize handles are shown.
            // For rectangles, the 4 corner resize handles (nw/ne/se/sw) are
            // replaced by dedicated CornerHandles positioned at the ACTUAL
            // corner points (= bbox corners for a normal rect, anywhere for a
            // deformed rect). Edge handles (n/e/s/w) are only shown on a
            // FRESH axis-aligned rectangle — once the rect is deformed into a
            // polygon, the edge handles are hidden (they would float in the
            // air around the polygon since the bbox doesn't match the shape)
            // and all resizing goes through the 4 corner handles.
            (() => {
              const isRect = element.type === 'rectangle';
              // Edge (midpoint) handles are hidden for rectangles in two cases:
              //   1. Alt is held (corner-focus mode — only corner handles show).
              //   2. The rectangle has been deformed (custom corner points).
              //      Once the shape is a polygon, the bbox no longer matches the
              //      visible shape, so midpoint handles would float in the air
              //      around the polygon. All resizing on a deformed rect goes
              //      through the 4 corner handles (plain drag = per-edge resize
              //      via the bbox; Alt+drag = individual corner deformation),
              //      so the midpoint handles are not needed.
              //      The dashed polygon outline (rendered below) is the sole
              //      selection indicator for deformed rects.
              const edgeHandles = isRect
                ? ((hideRectBBoxOnAlt || hasCustomCorners(element)) ? [] : (['n', 'e', 's', 'w'] as const))
                : RESIZE_HANDLES;
              // Use live preview corners during a drag so handles follow the cursor.
              const storedCorners = isRect ? getRectCornerPoints(element) : null;
              const rectCorners = isRect ? (previewCornersForHandles ?? storedCorners) : null;
              const rectCustom = isRect ? (hasCustomCorners(element) || !!previewCornersForHandles) : false;
              // Effective origin: during a corner drag, element.x/y is stale —
              // use the preview corners' bbox min so handle positions are correct.
              const rectOrigin = previewCornersForHandles
                ? { x: Math.min(...previewCornersForHandles.map((c) => c.x)), y: Math.min(...previewCornersForHandles.map((c) => c.y)) }
                : { x: element.x, y: element.y };
              return (
                <>
                  {edgeHandles.map((pos) => (
                    <ResizeHandle key={pos} position={pos} rotation={rectRotation} onResizeStart={isGroupChildProp && editingGroupId ? handleGroupChildResizeStart : handleResizeStart} />
                  ))}
                  {/* Dashed polygon outline for deformed rectangles — replaces the
                      rectangular bounding-box ring (which is suppressed for
                      deformed rects). Follows the actual shape of the polygon.
                      Hidden when Alt is held (corner-focus mode). */}
                  {isRect && rectCorners && rectCustom && !hideRectBBoxOnAlt ? (
                    <svg
                      className="absolute inset-0 w-full h-full pointer-events-none"
                      style={{ overflow: 'visible', zIndex: 9999 }}
                    >
                      <polygon
                        points={rectCorners.map((c) => `${(c.x - rectOrigin.x).toFixed(2)},${(c.y - rectOrigin.y).toFixed(2)}`).join(' ')}
                        fill="none"
                        stroke="hsl(var(--primary))"
                        strokeWidth={1.5}
                        strokeDasharray="4,3"
                        opacity={0.5}
                      />
                    </svg>
                  ) : null}
                  {isRect && rectCorners ? (
                    rectCorners.map((c, idx) => (
                      <CornerHandle
                        key={`corner-${idx}`}
                        x={c.x - rectOrigin.x}
                        y={c.y - rectOrigin.y}
                        cornerIndex={idx}
                        isCustom={rectCustom}
                        rotation={rectRotation}
                        onCornerMouseDown={handleCornerMouseDown}
                      />
                    ))
                  ) : null}
                  {/* Table column/row resize handles — only for table elements when single-selected; hidden when Alt is held (cell selection mode) */}
                  {element.type === 'table' && selectionCount <= 1 && (
                    <TableResizeHandles element={element} hidden={altHeld} />
                  )}
                </>
              );
            })()
          ) : isSelected && isLine && selectionCount <= 1 ? (
            // Non-primary selected line: just highlight
            (() => {
              const { startRelX, startRelY, endRelX, endRelY } = getLineEndpointPositions();
              return (
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  style={{ overflow: 'visible', zIndex: 10000 }}
                >
                  <path
                    d={`M ${startRelX} ${startRelY} L ${endRelX} ${endRelY}`}
                    stroke="#ec4899"
                    strokeWidth={2}
                    strokeDasharray="4,3"
                    fill="none"
                    opacity={0.4}
                  />
                </svg>
              );
            })()
          ) : isSelected && isLine && selectionCount > 1 ? (
            // Line in multi-selection: show pink highlight to indicate selection
            (() => {
              const { startRelX, startRelY, endRelX, endRelY } = getLineEndpointPositions();
              return (
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  style={{ overflow: 'visible', zIndex: 10000 }}
                >
                  {/* Thicker semi-transparent pink glow behind the line */}
                  <path
                    d={`M ${startRelX} ${startRelY} L ${endRelX} ${endRelY}`}
                    stroke="#ec4899"
                    strokeWidth={6}
                    fill="none"
                    opacity={0.35}
                    strokeLinecap="round"
                  />
                  {/* Dashed pink overlay on top */}
                  <path
                    d={`M ${startRelX} ${startRelY} L ${endRelX} ${endRelY}`}
                    stroke="#ec4899"
                    strokeWidth={2}
                    strokeDasharray="4,3"
                    fill="none"
                    opacity={0.7}
                  />
                </svg>
              );
            })()
          ) : null}


        </>
        </div>
      )}
    </motion.div>
  );
}

// Custom comparator for React.memo — only re-render when element data or key props actually change
const arePropsEqual = (prev: { element: CanvasElement; isGroupChild?: boolean }, next: { element: CanvasElement; isGroupChild?: boolean }) => {
  // If isGroupChild changed, must re-render
  if (prev.isGroupChild !== next.isGroupChild) return false;
  // If element reference is the same (Zustand immutable updates), skip re-render
  if (prev.element === next.element) return true;
  // If element id changed, must re-render
  if (prev.element.id !== next.element.id) return false;
  // If element type changed, must re-render
  if (prev.element.type !== next.element.type) return false;
  // If visible or locked changed, must re-render
  if (prev.element.visible !== next.element.visible || prev.element.locked !== next.element.locked) return false;
  // If position/size changed, must re-render
  if (
    prev.element.x !== next.element.x ||
    prev.element.y !== next.element.y ||
    prev.element.width !== next.element.width ||
    prev.element.height !== next.element.height
  ) return false;
  // Rectangle corner points changed (reference equality — Zustand creates a new
  // array on every corner edit, so this catches all deformations).
  // IMPORTANT: This MUST be checked BEFORE the `properties` reference short-circuit
  // below. The first Alt+drag on a fresh axis-aligned rectangle adds `cornerPoints`
  // WITHOUT changing x/y/width/height/properties — if this check came after the
  // properties short-circuit, the parent wouldn't re-render, the memoized child
  // renderer would keep seeing the old element (custom=false), and the live
  // cornerDragPreview would be ignored (svgFill=null when custom=false), causing
  // the rectangle to grow in BOTH width and height instead of deforming into a
  // polygon. This was the root cause of the "first corner drag doesn't work"
  // bug — the shape only became a polygon after stopCornerDrag committed the
  // new bbox (which finally tripped the position/size check above).
  if (prev.element.cornerPoints !== next.element.cornerPoints) return false;
  // Line endpoints changed
  if (
    prev.element.lineStartX !== next.element.lineStartX ||
    prev.element.lineStartY !== next.element.lineStartY ||
    prev.element.lineEndX !== next.element.lineEndX ||
    prev.element.lineEndY !== next.element.lineEndY
  ) return false;
  // Children changed (for groups)
  if (prev.element.children !== next.element.children) return false;
  // If properties reference is the same AND none of the primitive fields above
  // changed, no visual change — safe to skip re-render.
  if (prev.element.properties === next.element.properties) return true;
  // If name changed, re-render (shown in label)
  if (prev.element.name !== next.element.name) return false;
  // For deep property changes where the reference changed, we need to re-render
  // since we can't cheaply deep-compare all property types.
  // Falling through to return false (re-render) is the safe default.
  return false;
};

export const CanvasElementComponent = memo(CanvasElementComponentInner, arePropsEqual);
