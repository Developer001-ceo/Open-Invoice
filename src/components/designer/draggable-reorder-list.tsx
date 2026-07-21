'use client';

import { useState, useRef, useCallback, useEffect, memo } from 'react';
import { GripVertical } from 'lucide-react';

export interface ReorderItem {
  id: string;
  label: string;
  color?: string; // optional color swatch
  badge?: string; // e.g. "Header"
}

interface DraggableReorderListProps {
  items: ReorderItem[];
  onReorder: (fromIndex: number, toIndex: number) => void;
  maxHeight?: number;
}

// Single row in the reorder list — matches layer card design
const ReorderRow = memo(function ReorderRow({
  item,
  index,
  translateY,
  isDraggedItem,
  isDragActive,
  isSettling,
  isBouncing,
  onPointerDown,
}: {
  item: ReorderItem;
  index: number;
  translateY: number;
  isDraggedItem: boolean;
  isDragActive: boolean;
  isSettling: boolean;
  isBouncing: boolean;
  onPointerDown: (e: React.PointerEvent, index: number) => void;
}) {
  return (
    <div
      data-reorder-index={index}
      className={`relative w-full min-w-0 ${isBouncing ? 'animate-[layerDropBounce_400ms_ease-out]' : ''}`}
      style={{
        transform: translateY !== 0 ? `translateY(${translateY}px)` : undefined,
        transition: (isDragActive || isSettling) && !isDraggedItem
          ? 'transform 280ms cubic-bezier(0.25, 1, 0.5, 1)'
          : undefined,
        zIndex: isDraggedItem ? -1 : undefined,
      }}
    >
      <div
        className={`
          relative flex items-center gap-1 px-1.5 py-1 cursor-pointer select-none
          transition-all duration-150 ease-out group m-0.5
          shadow-[0_0_3px_rgba(0,0,0,0.06)] overflow-hidden w-full min-w-0
          hover:bg-muted/60
          ${isDraggedItem && isDragActive ? 'opacity-0' : ''}
          ${isDragActive ? 'pointer-events-none' : ''}
        `}
      >
        {/* Drag handle */}
        <div
          className={`
            shrink-0 cursor-grab active:cursor-grabbing p-0.5 rounded
            text-muted-foreground/30 transition-colors duration-150
            hover:text-muted-foreground/70 hover:bg-muted
            ${isDragActive ? 'cursor-grabbing' : ''}
          `}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            onPointerDown(e, index);
          }}
        >
          <GripVertical className="h-3 w-3" />
        </div>

        {/* Color swatch (optional) */}
        {item.color && (
          <div
            className="shrink-0 flex items-center justify-center h-5 w-5 rounded-md"
            style={{ backgroundColor: item.color }}
          >
            <div className="h-3.5 w-3.5 rounded-sm border border-border/50" style={{ backgroundColor: item.color }} />
          </div>
        )}

        {/* Label */}
        <span className="text-xs flex-1 min-w-0 truncate text-muted-foreground font-medium">
          {item.label}
        </span>

        {/* Badge (e.g. "Header") */}
        {item.badge && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-semibold uppercase tracking-wider shrink-0">
            {item.badge}
          </span>
        )}
      </div>
    </div>
  );
});

export function DraggableReorderList({ items, onReorder, maxHeight = 160 }: DraggableReorderListProps) {
  const [dragState, setDragState] = useState<{
    fromIndex: number;
    currentY: number;
    offsetY: number;        // visual offset (clamped to list bounds)
    rowHeight: number;
    draggedRowTop: number;
    draggedRowLeft: number;
    dropIndex: number;
    scrollOffset: number;   // initial scroll position when drag starts
  } | null>(null);
  const [settling, setSettling] = useState(false);
  const [bouncedIndex, setBouncedIndex] = useState<number | null>(null);
  const dragRef = useRef<typeof dragState>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const autoScrollRAF = useRef<number | null>(null);

  useEffect(() => {
    dragRef.current = dragState;
  }, [dragState]);

  // Calculate translateY for each row based on drag state
  const getRowTranslateY = useCallback((index: number): number => {
    if (!dragState) return 0;
    const { fromIndex, dropIndex, rowHeight } = dragState;
    if (fromIndex === dropIndex) return 0;

    if (index === fromIndex) return 0; // handled by floating preview

    // Items between from and drop shift by one rowHeight
    if (fromIndex < dropIndex) {
      if (index > fromIndex && index <= dropIndex) return -rowHeight;
    } else {
      if (index >= dropIndex && index < fromIndex) return rowHeight;
    }
    return 0;
  }, [dragState]);

  const computeDropIndex = useCallback((
    offsetY: number,
    fromIndex: number,
    rowHeight: number,
    totalCount: number
  ): number => {
    const rowsMoved = Math.round(offsetY / rowHeight);
    let targetIndex = fromIndex + rowsMoved;
    targetIndex = Math.max(0, Math.min(totalCount - 1, targetIndex));
    return targetIndex;
  }, []);

  // Helper: compute effective offset and drop index from current scroll + pointer position
  const recalcDragState = useCallback((
    drag: NonNullable<typeof dragState>,
    listEl: HTMLElement,
    pointerY: number
  ): { offsetY: number; dropIndex: number } => {
    const scrollDelta = listEl.scrollTop - drag.scrollOffset;
    // Effective offset includes scroll — NOT clamped to visible area,
    // so it can reach items scrolled out of view
    const effectiveOffsetY = (pointerY - drag.currentY) + scrollDelta;

    const newDropIndex = computeDropIndex(effectiveOffsetY, drag.fromIndex, drag.rowHeight, items.length);

    // Clamp visual offset so floating preview stays within list visible bounds
    const listRect = listEl.getBoundingClientRect();
    const minVisual = listRect.top - drag.draggedRowTop;
    const maxVisual = listRect.bottom - drag.draggedRowTop - drag.rowHeight;
    const clampedOffsetY = Math.max(minVisual, Math.min(maxVisual, pointerY - drag.currentY));

    return { offsetY: clampedOffsetY, dropIndex: newDropIndex };
  }, [items.length, computeDropIndex]);

  const handlePointerDown = useCallback((e: React.PointerEvent, index: number) => {
    if (e.button !== 0) return;

    const listEl = listRef.current;
    if (!listEl) return;

    const rowEl = listEl.querySelector(`[data-reorder-index="${index}"]`) as HTMLElement;
    if (!rowEl) return;

    const rowRect = rowEl.getBoundingClientRect();

    // Measure row height including gap
    const rowEls = listEl.querySelectorAll('[data-reorder-index]');
    let rowHeight = 32; // fallback
    if (rowEls.length > 1) {
      const firstRect = (rowEls[0] as HTMLElement).getBoundingClientRect();
      const secondRect = (rowEls[1] as HTMLElement).getBoundingClientRect();
      rowHeight = secondRect.top - firstRect.top;
    } else if (rowEls.length === 1) {
      rowHeight = rowRect.height + 2;
    }

    const state = {
      fromIndex: index,
      currentY: e.clientY,
      offsetY: 0,
      rowHeight,
      draggedRowTop: rowRect.top,
      draggedRowLeft: rowRect.left,
      dropIndex: index,
      scrollOffset: listEl.scrollTop,
    };

    setDragState(state);
    dragRef.current = state;
    document.body.style.cursor = 'grabbing';
  }, []);

  // ─── Auto-scroll during drag ─────────────────────────────────────
  // Smooth, slow, proportional scrolling based on cursor distance from edge
  const AUTO_SCROLL_EDGE = 35;
  const AUTO_SCROLL_MAX_SPEED = 1.5;

  useEffect(() => {
    if (!dragState) {
      if (autoScrollRAF.current) {
        cancelAnimationFrame(autoScrollRAF.current);
        autoScrollRAF.current = null;
      }
      return;
    }

    let lastPointerY = dragState.currentY + dragState.offsetY;

    const handlePointerMoveForScroll = (e: PointerEvent) => {
      lastPointerY = e.clientY;
    };

    const autoScroll = () => {
      const listEl = listRef.current;
      if (!listEl) {
        autoScrollRAF.current = requestAnimationFrame(autoScroll);
        return;
      }

      const rect = listEl.getBoundingClientRect();
      const pointerY = lastPointerY;
      let scrolled = false;

      if (pointerY < rect.top + AUTO_SCROLL_EDGE && pointerY > rect.top - 20) {
        const distanceIntoZone = Math.max(0, rect.top + AUTO_SCROLL_EDGE - pointerY);
        const ratio = Math.min(distanceIntoZone / AUTO_SCROLL_EDGE, 1);
        listEl.scrollTop -= AUTO_SCROLL_MAX_SPEED * ratio;
        scrolled = true;
      } else if (pointerY > rect.bottom - AUTO_SCROLL_EDGE && pointerY < rect.bottom + 20) {
        const distanceIntoZone = Math.max(0, pointerY - (rect.bottom - AUTO_SCROLL_EDGE));
        const ratio = Math.min(distanceIntoZone / AUTO_SCROLL_EDGE, 1);
        listEl.scrollTop += AUTO_SCROLL_MAX_SPEED * ratio;
        scrolled = true;
      }

      // After scrolling, recalculate drop index so room is created
      if (scrolled) {
        const drag = dragRef.current;
        if (drag) {
          const { offsetY, dropIndex } = recalcDragState(drag, listEl, pointerY);
          if (dropIndex !== drag.dropIndex || offsetY !== drag.offsetY) {
            const newState = { ...drag, offsetY, dropIndex };
            setDragState(newState);
            dragRef.current = newState;
          }
        }
      }

      autoScrollRAF.current = requestAnimationFrame(autoScroll);
    };

    window.addEventListener('pointermove', handlePointerMoveForScroll);
    autoScrollRAF.current = requestAnimationFrame(autoScroll);

    return () => {
      window.removeEventListener('pointermove', handlePointerMoveForScroll);
      if (autoScrollRAF.current) {
        cancelAnimationFrame(autoScrollRAF.current);
        autoScrollRAF.current = null;
      }
    };
  }, [dragState, recalcDragState]);

  // Global pointer move/up listeners during drag
  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const listEl = listRef.current;
      if (!listEl) return;

      const { offsetY, dropIndex } = recalcDragState(drag, listEl, e.clientY);

      const newState = { ...drag, offsetY, dropIndex };
      setDragState(newState);
      dragRef.current = newState;
    };

    const handlePointerUp = () => {
      const drag = dragRef.current;
      if (!drag) return;

      if (drag.fromIndex !== drag.dropIndex) {
        onReorder(drag.fromIndex, drag.dropIndex);
        setBouncedIndex(drag.dropIndex);
        setTimeout(() => setBouncedIndex(null), 500);
      }

      setSettling(true);
      setDragState(null);
      dragRef.current = null;
      document.body.style.cursor = '';

      setTimeout(() => setSettling(false), 280);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragState, items.length, onReorder, recalcDragState]);

  // Cleanup cursor on unmount
  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
    };
  }, []);

  const needsScroll = items.length > 5;

  return (
    <div className="relative">
      <div
        ref={listRef}
        className={`flex flex-col gap-0 overflow-hidden ${needsScroll ? 'overflow-y-auto draggable-reorder-list-scroll' : ''}`}
        style={{ maxHeight: needsScroll ? `${maxHeight}px` : undefined }}
      >
        {items.map((item, index) => {
          const isDraggedItem = dragState?.fromIndex === index;
          return (
            <ReorderRow
              key={item.id}
              item={item}
              index={index}
              translateY={getRowTranslateY(index)}
              isDraggedItem={isDraggedItem}
              isDragActive={dragState !== null}
              isSettling={settling}
              isBouncing={bouncedIndex === index}
              onPointerDown={handlePointerDown}
            />
          );
        })}
      </div>

      {/* Floating drag preview — matches layer card style */}
      {dragState && (() => {
        const draggedItem = items[dragState.fromIndex];
        if (!draggedItem) return null;

        return (
          <div
            className="fixed pointer-events-none z-[9999]"
            style={{
              left: dragState.draggedRowLeft,
              top: dragState.draggedRowTop + dragState.offsetY,
              width: 220,
              transition: 'none',
            }}
          >
            <div className="flex items-center gap-1 px-1.5 py-1 m-0.5 bg-card shadow-xl shadow-primary/25 select-none backdrop-blur-sm">
              <GripVertical className="h-3 w-3 text-primary/60" />
              {draggedItem.color && (
                <div
                  className="shrink-0 h-5 w-5 rounded-md flex items-center justify-center"
                  style={{ backgroundColor: draggedItem.color }}
                >
                  <div className="h-3.5 w-3.5 rounded-sm border border-border/50" style={{ backgroundColor: draggedItem.color }} />
                </div>
              )}
              <span className="text-xs font-medium text-foreground">{draggedItem.label}</span>
              {draggedItem.badge && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-semibold uppercase tracking-wider">
                  {draggedItem.badge}
                </span>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
