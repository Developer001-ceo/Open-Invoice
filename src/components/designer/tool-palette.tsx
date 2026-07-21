'use client';

import { ElementType } from '@/lib/element-types';
import {
  Type,
  Table,
  Image as ImageIcon,
  Minus,
  Square,
  Circle,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  GripVertical,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { useDesignerStore } from '@/store/designer-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import React, { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react';

interface ToolItem {
  type: ElementType;
  label: string;
  icon: React.ReactNode;
}

// Map element types to their icons for layer display
const elementTypeIcons: Record<string, React.ReactNode> = {
  text: <Type className="h-3.5 w-3.5" />,
  table: <Table className="h-3.5 w-3.5" />,
  image: <ImageIcon className="h-3.5 w-3.5" />,
  line: <Minus className="h-3.5 w-3.5" />,
  rectangle: <Square className="h-3.5 w-3.5" />,
  ellipse: <Circle className="h-3.5 w-3.5" />,
  group: <Layers className="h-3.5 w-3.5" />,
};

const tools: ToolItem[] = [
  { type: 'text', label: 'Text', icon: <Type className="h-5 w-5" /> },
  { type: 'table', label: 'Table', icon: <Table className="h-5 w-5" /> },
  { type: 'line', label: 'Line', icon: <Minus className="h-5 w-5" /> },
  { type: 'rectangle', label: 'Rectangle', icon: <Square className="h-5 w-5" /> },
  { type: 'ellipse', label: 'Ellipse', icon: <Circle className="h-5 w-5" /> },
];

// ─── Flattened layer item for display ──────────────────────────────────
// We flatten the element tree so groups show their children indented below.
interface FlatLayerItem {
  id: string;
  name: string;
  type: ElementType;
  visible: boolean;
  locked: boolean;
  depth: number;              // 0 = root, 1 = group child, 2 = nested group child, etc.
  parentGroupId: string | null;
  isGroup: boolean;
  isCollapsed: boolean;       // only for groups — whether children are hidden
  originalIndex: number;      // index in the root `elements` array (for reorder)
}

// ─── Layer Row ─────────────────────────────────────────────────────────

const LayerRow = memo(function LayerRow({
  element,
  displayIndex,
  isSelected,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onRemove,
  onRename,
  onPointerDown,
  isDragActive,
  isDraggedItem,
  translateY,
  isSettling,
  depth,
  isGroup,
  isCollapsed,
  onToggleCollapse,
  isBouncing,
}: {
  element: { id: string; name: string; visible: boolean; locked: boolean; type: ElementType };
  displayIndex: number;
  isSelected: boolean;
  onSelect: (shiftKey: boolean) => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onRemove: () => void;
  onRename: (id: string, newName: string) => void;
  onPointerDown: (e: React.PointerEvent, displayIndex: number) => void;
  isDragActive: boolean;
  isDraggedItem: boolean;
  translateY: number;
  isSettling: boolean;
  depth: number;
  isGroup: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isBouncing: boolean;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(element.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const handleDoubleClickName = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setRenameValue(element.name);
      setIsRenaming(true);
      setTimeout(() => renameInputRef.current?.focus(), 0);
    },
    [element.name]
  );

  const handleRenameConfirm = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== element.name) {
      onRename(element.id, trimmed);
    }
    setIsRenaming(false);
  }, [renameValue, element.name, element.id, onRename]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleRenameConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsRenaming(false);
        setRenameValue(element.name);
      }
    },
    [handleRenameConfirm, element.name]
  );

  const isHidden = !element.visible;
  const indentPx = depth * 16;

  return (
    <div
      data-layer-index={displayIndex}
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
          relative flex items-center gap-1 px-1 py-1 cursor-pointer select-none
          transition-all duration-150 ease-out group m-0.5 shadow-[0_0_3px_rgba(0,0,0,0.06)] overflow-hidden w-full min-w-0
          ${isSelected
            ? 'bg-primary/[0.08] ring-1 ring-primary/20'
            : 'hover:bg-muted/60'
          }
          ${isRenaming ? 'bg-primary/[0.05] ring-1 ring-primary/30' : ''}
          ${isHidden ? 'opacity-50' : ''}
          ${isDragActive ? 'pointer-events-none' : ''}
          ${isDraggedItem && isDragActive ? 'opacity-0' : ''}
        `}
        style={{ paddingLeft: `${3 + indentPx}px` }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (isRenaming) return;
          // Don't handle from action buttons or collapse chevron
          const target = e.target as HTMLElement;
          if (target.closest('button') || target.closest('[data-collapse-toggle]')) return;
          // Select the element immediately on pointer down (before drag state blocks click events)
          onSelect(e.shiftKey);
          onPointerDown(e, displayIndex);
        }}
      >
        {/* Left accent bar for selected state */}
        <div
          className={`
            absolute top-1/2 -translate-y-1/2 w-[3px] rounded-r-full
            transition-all duration-200 ease-out
            ${isSelected ? 'h-4 bg-primary' : 'h-0 bg-primary'}
          `}
          style={{ left: `${1 + indentPx}px` }}
        />

        {/* Group collapse chevron */}
        {isGroup ? (
          <div
            data-collapse-toggle
            className="shrink-0 cursor-pointer p-0.5 rounded hover:bg-muted transition-all duration-150"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
          >
            <ChevronRight
              className={`h-3 w-3 text-muted-foreground/60 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}
            />
          </div>
        ) : (
          <div className="shrink-0 w-1.5" />
        )}

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
            if (isRenaming) return;
            e.stopPropagation();
            onPointerDown(e, displayIndex);
          }}
        >
          <GripVertical className="h-3 w-3" />
        </div>

        {/* Element type icon */}
        <div
          className={`
            shrink-0 flex items-center justify-center h-6 w-6 rounded-md
            transition-colors duration-150
            ${isSelected
              ? 'bg-primary/15 text-primary'
              : 'bg-muted text-muted-foreground'
            }
          `}
        >
          {elementTypeIcons[element.type] || <Square className="h-3.5 w-3.5" />}
        </div>

        {/* Name / Rename input */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameConfirm}
            onKeyDown={handleRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="text-xs flex-1 bg-background border border-primary/40 rounded-md px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary/60 min-w-0 font-medium"
            autoFocus
          />
        ) : (
          <span
            className={`text-xs flex-1 min-w-0 truncate transition-colors duration-150 ${
              isSelected ? 'font-medium text-foreground' : 'text-muted-foreground'
            }`}
            onDoubleClick={handleDoubleClickName}
          >
            {element.name}
          </span>
        )}

        {/* Action buttons — visible on hover */}
        {!isDragActive && (
          <div className="flex items-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 rounded-md hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleVisibility();
                  }}
                >
                  {element.visible ? (
                    <Eye className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <EyeOff className="h-3 w-3 text-muted-foreground" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {element.visible ? 'Hide layer' : 'Show layer'}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 rounded-md hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleLock();
                  }}
                >
                  {element.locked ? (
                    <Lock className="h-3 w-3 text-amber-500" />
                  ) : (
                    <Unlock className="h-3 w-3 text-muted-foreground" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {element.locked ? 'Unlock layer' : 'Lock layer'}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 rounded-md hover:bg-destructive/10 hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                Delete layer
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Tool Palette ──────────────────────────────────────────────────────

export function ToolPalette() {
  const addElement = useDesignerStore((s) => s.addElement);
  const elements = useDesignerStore((s) => s.elements);
  const selectedElementIds = useDesignerStore((s) => s.selectedElementIds);
  const selectElement = useDesignerStore((s) => s.selectElement);
  const toggleInSelection = useDesignerStore((s) => s.toggleInSelection);
  const panToElement = useDesignerStore((s) => s.panToElement);
  const removeElement = useDesignerStore((s) => s.removeElement);
  const toggleLock = useDesignerStore((s) => s.toggleLock);
  const toggleVisibility = useDesignerStore((s) => s.toggleVisibility);
  const reorderElement = useDesignerStore((s) => s.reorderElement);
  const updateElement = useDesignerStore((s) => s.updateElement);

  const handleRename = useCallback(
    (id: string, newName: string) => {
      updateElement(id, { name: newName });
    },
    [updateElement]
  );

  const handleLayerSelect = useCallback(
    (id: string, shiftKey: boolean) => {
      if (shiftKey) {
        toggleInSelection(id);
      } else {
        selectElement(id);
      }
      panToElement(id);
    },
    [selectElement, toggleInSelection, panToElement]
  );

  // ─── Collapsed groups state ──────────────────────────────────────
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroupCollapse = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  // ─── Build flattened layer list ──────────────────────────────────
  // Reversed list for display (top layer first), with group children indented
  const flatLayers: FlatLayerItem[] = useMemo(() => {
    const result: FlatLayerItem[] = [];
    const reversed = [...elements].reverse();

    const processElement = (el: typeof elements[0], depth: number, parentGroupId: string | null) => {
      const isGroup = el.type === 'group';
      result.push({
        id: el.id,
        name: el.name,
        type: el.type,
        visible: el.visible,
        locked: el.locked,
        depth,
        parentGroupId,
        isGroup,
        isCollapsed: isGroup ? collapsedGroups.has(el.id) : false,
        originalIndex: elements.indexOf(el),
      });

      // If this is a group and it's not collapsed, add children
      if (isGroup && !collapsedGroups.has(el.id) && 'children' in el && el.children) {
        // Children are stored in forward order; reverse for display
        const reversedChildren = [...el.children].reverse();
        for (const child of reversedChildren) {
          processElement(child as typeof elements[0], depth + 1, el.id);
        }
      }
    };

    for (const el of reversed) {
      processElement(el, 0, null);
    }

    return result;
  }, [elements, collapsedGroups]);

  // ─── Layer drag state ────────────────────────────────────────────
  const [layerDrag, setLayerDrag] = useState<{
    fromIndex: number;         // display index in flatLayers
    currentY: number;          // initial pointer Y
    offsetY: number;           // how far cursor moved
    rowHeight: number;         // measured height of a row + gap
    draggedRowTop: number;     // absolute Y of the dragged row at drag start
    draggedRowLeft: number;    // absolute X of the dragged row at drag start
    dropIndex: number;         // current target display index
    elementId: string;
    depth: number;             // depth of the dragged item
  } | null>(null);

  // Brief settling state after drag ends
  const [layerDragSettling, setLayerDragSettling] = useState(false);

  // Bounce animation on dropped element (by ID)
  const [bouncedElementId, setBouncedElementId] = useState<string | null>(null);

  const layerDragRef = useRef<typeof layerDrag>(null);
  const layerListRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const autoScrollRAF = useRef<number | null>(null);

  // Keep ref in sync
  useEffect(() => {
    layerDragRef.current = layerDrag;
  }, [layerDrag]);

  // ─── Auto-scroll during drag ─────────────────────────────────────
  // Smooth, slow, proportional scrolling based on cursor distance from edge
  const AUTO_SCROLL_EDGE = 35;        // px from edge to start scrolling
  const AUTO_SCROLL_MAX_SPEED = 2;    // max px per frame (smooth & slow)

  useEffect(() => {
    if (!layerDrag) {
      if (autoScrollRAF.current) {
        cancelAnimationFrame(autoScrollRAF.current);
        autoScrollRAF.current = null;
      }
      return;
    }

    let lastPointerY = layerDrag.currentY + layerDrag.offsetY;

    const handlePointerMoveForScroll = (e: PointerEvent) => {
      lastPointerY = e.clientY;
    };

    const autoScroll = () => {
      const scrollEl = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
      if (!scrollEl) {
        autoScrollRAF.current = requestAnimationFrame(autoScroll);
        return;
      }

      const rect = scrollEl.getBoundingClientRect();
      const pointerY = lastPointerY;

      if (pointerY < rect.top + AUTO_SCROLL_EDGE && pointerY > rect.top - 20) {
        // Scroll up — proportional to distance into edge zone
        const distanceIntoZone = Math.max(0, rect.top + AUTO_SCROLL_EDGE - pointerY);
        const ratio = Math.min(distanceIntoZone / AUTO_SCROLL_EDGE, 1);
        scrollEl.scrollTop -= AUTO_SCROLL_MAX_SPEED * ratio;
      } else if (pointerY > rect.bottom - AUTO_SCROLL_EDGE && pointerY < rect.bottom + 20) {
        // Scroll down — proportional to distance into edge zone
        const distanceIntoZone = Math.max(0, pointerY - (rect.bottom - AUTO_SCROLL_EDGE));
        const ratio = Math.min(distanceIntoZone / AUTO_SCROLL_EDGE, 1);
        scrollEl.scrollTop += AUTO_SCROLL_MAX_SPEED * ratio;
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
  }, [layerDrag]);

  // Handle drag handle pointer down — initiates layer drag
  const handleDragPointerDown = useCallback((e: React.PointerEvent, displayIndex: number) => {
    if (e.button !== 0) return;

    const listEl = layerListRef.current;
    if (!listEl) return;

    const rowEl = listEl.querySelector(`[data-layer-index="${displayIndex}"]`) as HTMLElement;
    if (!rowEl) return;

    const rowRect = rowEl.getBoundingClientRect();

    // Measure row height including gap
    const rowEls = listEl.querySelectorAll('[data-layer-index]');
    let rowHeight = 36; // fallback
    if (rowEls.length > 1) {
      const firstRect = (rowEls[0] as HTMLElement).getBoundingClientRect();
      const secondRect = (rowEls[1] as HTMLElement).getBoundingClientRect();
      rowHeight = secondRect.top - firstRect.top;
    } else if (rowEls.length === 1) {
      rowHeight = rowRect.height + 2;
    }

    const item = flatLayers[displayIndex];
    if (!item) return;

    // Auto-collapse groups when starting to drag them
    if (item.isGroup && !item.isCollapsed) {
      toggleGroupCollapse(item.id);
    }

    const dragState = {
      fromIndex: displayIndex,
      currentY: e.clientY,
      offsetY: 0,
      rowHeight,
      draggedRowTop: rowRect.top,
      draggedRowLeft: rowRect.left,
      dropIndex: displayIndex,
      elementId: item.id,
      depth: item.depth,
    };

    setLayerDrag(dragState);
    layerDragRef.current = dragState;

    // Set global cursor
    document.body.style.cursor = 'grabbing';
    document.body.classList.add('layer-dragging');
  }, [flatLayers, toggleGroupCollapse]);

  // Calculate the drop index based on cursor Y position
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

  // Handle layer drag pointer move/up using window listeners
  useEffect(() => {
    if (!layerDrag) return;

    const handlePointerMove = (e: PointerEvent) => {
      const drag = layerDragRef.current;
      if (!drag) return;

      // Constrain the drag to the layers list boundaries
      const listEl = layerListRef.current;
      let clampedOffsetY = e.clientY - drag.currentY;

      if (listEl) {
        const listRect = listEl.getBoundingClientRect();
        const minOffsetY = listRect.top - drag.draggedRowTop;
        const maxOffsetY = listRect.bottom - drag.draggedRowTop - drag.rowHeight;
        clampedOffsetY = Math.max(minOffsetY, Math.min(maxOffsetY, clampedOffsetY));
      }

      const newDropIndex = computeDropIndex(
        clampedOffsetY,
        drag.fromIndex,
        drag.rowHeight,
        flatLayers.length
      );

      const newState = {
        ...drag,
        offsetY: clampedOffsetY,
        dropIndex: newDropIndex,
      };

      setLayerDrag(newState);
      layerDragRef.current = newState;
    };

    const handlePointerUp = () => {
      const drag = layerDragRef.current;
      if (!drag) return;

      // Perform the reorder if needed
      if (drag.fromIndex !== drag.dropIndex) {
        const fromItem = flatLayers[drag.fromIndex];
        const toItem = flatLayers[drag.dropIndex];

        if (fromItem && toItem && fromItem.depth === 0 && toItem.depth === 0) {
          // Only reorder root-level elements
          const fromArrayIndex = fromItem.originalIndex;
          const toArrayIndex = toItem.originalIndex;
          reorderElement(fromArrayIndex, toArrayIndex);
        }

        // Trigger bounce on the dropped element
        setBouncedElementId(drag.elementId);
        setTimeout(() => setBouncedElementId(null), 500);
      }

      // Start settling animation
      setLayerDragSettling(true);

      // Clean up drag state
      setLayerDrag(null);
      layerDragRef.current = null;
      document.body.style.cursor = '';
      document.body.classList.remove('layer-dragging');

      // End settling after transition completes
      setTimeout(() => setLayerDragSettling(false), 280);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [layerDrag, flatLayers, reorderElement, computeDropIndex]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.classList.remove('layer-dragging');
    };
  }, []);

  // ─── Tool drag state (pointer-based) ──────────────────────────────
  const [toolDragType, setToolDragType] = useState<ElementType | null>(null);
  const [toolDragPos, setToolDragPos] = useState<{ x: number; y: number } | null>(null);
  const toolDragStartRef = useRef<{ x: number; y: number; type: ElementType; moved: boolean } | null>(null);

  const handleToolPointerDown = useCallback((e: React.PointerEvent, type: ElementType) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    toolDragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      type,
      moved: false,
    };
  }, []);

  const handleToolPointerMove = useCallback((e: React.PointerEvent) => {
    const start = toolDragStartRef.current;
    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 4) {
      if (!start.moved) {
        start.moved = true;
        setToolDragType(start.type);
      }
      setToolDragPos({ x: e.clientX, y: e.clientY });
    }
  }, []);

  const handleToolPointerUp = useCallback((e: React.PointerEvent) => {
    const start = toolDragStartRef.current;
    if (!start) return;

    // Only add element when the user actually dragged the tool onto the canvas.
    // Simple clicks do NOT add elements — the user must drag and drop.
    if (start.moved) {
      const viewport = document.querySelector('.canvas-viewport') as HTMLElement | null;
      if (viewport) {
        const rect = viewport.getBoundingClientRect();
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          const state = useDesignerStore.getState();
          const canvasX = (e.clientX - rect.left) / state.zoom - state.panX;
          const canvasY = (e.clientY - rect.top) / state.zoom - state.panY;
          addElement(start.type, canvasX, canvasY);
        }
      }
    }

    toolDragStartRef.current = null;
    setToolDragType(null);
    setToolDragPos(null);
  }, [addElement]);

  // Set global cursor during tool drag
  useEffect(() => {
    if (toolDragType) {
      document.body.style.cursor = 'grabbing';
      document.body.classList.add('tool-dragging');
      return () => {
        document.body.style.cursor = '';
        document.body.classList.remove('tool-dragging');
      };
    }
  }, [toolDragType]);

  // Compute translateY for each row during drag
  const getRowTranslateY = useCallback((displayIndex: number): number => {
    if (!layerDrag) return 0;
    if (displayIndex === layerDrag.fromIndex) return 0; // dragged row is handled by floating preview

    const { fromIndex, dropIndex, rowHeight } = layerDrag;

    // Moving down: items between fromIndex+1 and dropIndex shift UP
    if (dropIndex > fromIndex) {
      if (displayIndex > fromIndex && displayIndex <= dropIndex) {
        return -rowHeight;
      }
    }
    // Moving up: items between dropIndex and fromIndex-1 shift DOWN
    if (dropIndex < fromIndex) {
      if (displayIndex >= dropIndex && displayIndex < fromIndex) {
        return rowHeight;
      }
    }

    return 0;
  }, [layerDrag]);

  return (
    <div data-ui-panel className="w-60 border-r border-border bg-card flex flex-col h-full select-none">
      {/* ── Tools Section ── */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-1.5 mb-2">
          <div className="h-1 w-1 rounded-full bg-primary" />
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Tools
          </h2>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {tools.map((tool, index) => (
            <button
              key={tool.type}
              onPointerDown={(e) => handleToolPointerDown(e, tool.type)}
              onPointerMove={handleToolPointerMove}
              onPointerUp={handleToolPointerUp}
              style={{ animationDelay: `${index * 50}ms` }}
              className={`
                group/tool relative flex items-center justify-center
                aspect-square w-full rounded-xl cursor-grab
                bg-muted/40 text-muted-foreground
                hover:bg-primary hover:text-primary-foreground
                hover:shadow-md hover:shadow-primary/20
                active:cursor-grabbing active:scale-90
                transition-all duration-200 ease-out
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
                overflow-hidden
                animate-[fadeSlideUp_200ms_ease-out_both]
                touch-none
              `}
            >
              <span className="absolute inset-0 rounded-xl bg-primary/0 transition-colors duration-200 group-hover/tool:bg-primary/10" />
              <span className="relative transition-transform duration-200 ease-out group-hover/tool:scale-110">
                {tool.icon}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 py-1.5">
        <Separator />
      </div>

      {/* ── Layers Section ── */}
      <div data-tour="layers-panel" className="flex-1 flex flex-col min-h-0">
        {/* Layers header */}
        <div className="px-3 pt-3 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="h-1 w-1 rounded-full bg-primary" />
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Layers
            </h2>
          </div>
          {elements.length > 0 && (
            <span className="text-[10px] tabular-nums text-muted-foreground/60 bg-muted/50 px-1.5 py-0.5 rounded-md font-medium">
              {elements.length}
            </span>
          )}
        </div>

        {/* Layers list */}
        <ScrollArea ref={scrollAreaRef} className="flex-1 overflow-hidden">
          <div ref={layerListRef} className="px-1 pb-2 flex flex-col gap-0.5 overflow-hidden">
            {(() => {
              // Render layers in groups: each root-level group + its children form a section.
              // Children are wrapped in an animated container for smooth open/close.
              const sections: React.ReactNode[] = [];
              let i = 0;
              while (i < flatLayers.length) {
                const item = flatLayers[i];
                const displayIndex = i;
                const isDraggedItem = layerDrag?.fromIndex === displayIndex;

                if (item.isGroup) {
                  // Render the group row itself
                  sections.push(
                    <LayerRow
                      key={item.id}
                      element={item}
                      displayIndex={displayIndex}
                      isSelected={selectedElementIds.includes(item.id)}
                      onSelect={(shiftKey) => handleLayerSelect(item.id, shiftKey)}
                      onToggleVisibility={() => toggleVisibility(item.id)}
                      onToggleLock={() => toggleLock(item.id)}
                      onRemove={() => removeElement(item.id)}
                      onRename={handleRename}
                      onPointerDown={handleDragPointerDown}
                      isDragActive={layerDrag !== null}
                      isDraggedItem={isDraggedItem}
                      translateY={getRowTranslateY(displayIndex)}
                      isSettling={layerDragSettling}
                      depth={item.depth}
                      isGroup={item.isGroup}
                      isCollapsed={item.isCollapsed}
                      onToggleCollapse={() => toggleGroupCollapse(item.id)}
                      isBouncing={bouncedElementId === item.id}
                    />
                  );
                  i++;

                  // Collect children of this group
                  const children: FlatLayerItem[] = [];
                  while (i < flatLayers.length && flatLayers[i].depth > 0 && flatLayers[i].parentGroupId === item.id) {
                    children.push(flatLayers[i]);
                    i++;
                  }

                  // Render children in an animated wrapper
                  if (children.length > 0) {
                    sections.push(
                      <div
                        key={`group-children-${item.id}`}
                        className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.33,1,0.68,1)]"
                        style={{
                          gridTemplateRows: item.isCollapsed ? '0fr' : '1fr',
                        }}
                      >
                        <div className="overflow-hidden">
                          <div
                            className="flex flex-col gap-0.5"
                            style={{
                              opacity: item.isCollapsed ? 0 : 1,
                              transform: item.isCollapsed ? 'translateY(-4px)' : 'translateY(0)',
                              transition: 'opacity 250ms ease, transform 300ms cubic-bezier(0.33,1,0.68,1)',
                            }}
                          >
                            {children.map((child) => {
                              const childDisplayIndex = flatLayers.indexOf(child);
                              const isChildDragged = layerDrag?.fromIndex === childDisplayIndex;
                              return (
                                <LayerRow
                                  key={child.id}
                                  element={child}
                                  displayIndex={childDisplayIndex}
                                  isSelected={selectedElementIds.includes(child.id)}
                                  onSelect={(shiftKey) => handleLayerSelect(child.id, shiftKey)}
                                  onToggleVisibility={() => toggleVisibility(child.id)}
                                  onToggleLock={() => toggleLock(child.id)}
                                  onRemove={() => removeElement(child.id)}
                                  onRename={handleRename}
                                  onPointerDown={handleDragPointerDown}
                                  isDragActive={layerDrag !== null}
                                  isDraggedItem={isChildDragged}
                                  translateY={getRowTranslateY(childDisplayIndex)}
                                  isSettling={layerDragSettling}
                                  depth={child.depth}
                                  isGroup={child.isGroup}
                                  isCollapsed={child.isCollapsed}
                                  onToggleCollapse={() => toggleGroupCollapse(child.id)}
                                  isBouncing={bouncedElementId === child.id}
                                />
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  }
                } else {
                  // Non-group root element
                  sections.push(
                    <LayerRow
                      key={item.id}
                      element={item}
                      displayIndex={displayIndex}
                      isSelected={selectedElementIds.includes(item.id)}
                      onSelect={(shiftKey) => handleLayerSelect(item.id, shiftKey)}
                      onToggleVisibility={() => toggleVisibility(item.id)}
                      onToggleLock={() => toggleLock(item.id)}
                      onRemove={() => removeElement(item.id)}
                      onRename={handleRename}
                      onPointerDown={handleDragPointerDown}
                      isDragActive={layerDrag !== null}
                      isDraggedItem={isDraggedItem}
                      translateY={getRowTranslateY(displayIndex)}
                      isSettling={layerDragSettling}
                      depth={item.depth}
                      isGroup={item.isGroup}
                      isCollapsed={item.isCollapsed}
                      onToggleCollapse={() => toggleGroupCollapse(item.id)}
                      isBouncing={bouncedElementId === item.id}
                    />
                  );
                  i++;
                }
              }
              return sections;
            })()}
            {elements.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 px-4">
                <div className="h-10 w-10 rounded-full bg-muted/50 flex items-center justify-center mb-2">
                  <Layers className="h-5 w-5 text-muted-foreground/40" />
                </div>
                <p className="text-[11px] text-muted-foreground/60 text-center leading-relaxed">
                  No layers yet
                  <br />
                  <span className="text-muted-foreground/40">Drag elements from tools above</span>
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ── Floating layer drag preview ── */}
      {layerDrag && (() => {
        const draggedItem = flatLayers[layerDrag.fromIndex];
        if (!draggedItem) return null;

        const indentPx = draggedItem.depth * 16;

        return (
          <div
            className="fixed pointer-events-none z-[9999]"
            style={{
              left: layerDrag.draggedRowLeft,
              top: layerDrag.draggedRowTop + layerDrag.offsetY,
              width: 228,
              transition: 'none',
            }}
          >
            <div className="flex items-center gap-1 px-1 py-1 bg-card shadow-xl shadow-primary/25 select-none backdrop-blur-sm"
              style={{ paddingLeft: `${3 + indentPx}px` }}
            >
              {/* Collapse spacer */}
              {draggedItem.isGroup ? (
                <div className="shrink-0 p-0.5">
                  <ChevronRight className={`h-3 w-3 text-primary/60 ${draggedItem.isCollapsed ? '' : 'rotate-90'}`} />
                </div>
              ) : (
                <div className="shrink-0 w-1.5" />
              )}
              {/* Drag handle */}
              <div className="shrink-0 p-0.5 rounded text-primary/60">
                <GripVertical className="h-3 w-3" />
              </div>
              {/* Element type icon */}
              <div className="shrink-0 flex items-center justify-center h-6 w-6 rounded-md bg-primary/15 text-primary">
                {elementTypeIcons[draggedItem.type] || <Square className="h-3.5 w-3.5" />}
              </div>
              {/* Name */}
              <span className="text-xs flex-1 truncate font-medium text-foreground">
                {draggedItem.name}
              </span>
            </div>
          </div>
        );
      })()}

      {/* ── Floating tool drag preview ── */}
      {toolDragType && toolDragPos && (
        <div
          className="fixed pointer-events-none z-[9999] flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/30 cursor-grabbing"
          style={{
            left: toolDragPos.x - 20,
            top: toolDragPos.y - 20,
            transition: 'none',
          }}
        >
          {tools.find((t) => t.type === toolDragType)?.icon}
        </div>
      )}
    </div>
  );
}
