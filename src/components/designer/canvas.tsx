'use client';

import { useDesignerStore } from '@/store/designer-store';
import { CanvasElementComponent } from './canvas-element';
import { ElementType, CanvasElement, getRectRotation } from '@/lib/element-types';
import { getResizeCursor } from '@/lib/resize-cursor';
import { ZoomControls } from './zoom-controls';
import { SnapControls } from './snap-controls';
import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import { AlignmentGuide } from '@/lib/snapping';
import { Undo2, Redo2, Group, Ungroup, Scissors, Copy, ClipboardPaste, ClipboardCopy, Trash2 } from 'lucide-react';
import { SpotlightOverlay } from './spotlight-overlay';
import { PredefinedBlocksOverlay } from './predefined-blocks-overlay';
import { FloatingCardsManager } from './floating-cards-manager';
import { ShortcutsOverlay } from './shortcuts-overlay';

const VIEWPORT_PADDING = 40;

// ── Shift+S Keyboard Hint (Recommendation 4) ──────────────────────────────────
// Shows a subtle hint near the bottom of the canvas when an element is selected.
// Fades away permanently after the user uses Shift+S a few times.
const MAX_HINT_DISPLAYS = 3; // Show hint for the first 3 element selections

function ShiftSHint() {
  const selectedElementIds = useDesignerStore((s) => s.selectedElementIds);
  const spotlightHintShown = useDesignerStore((s) => s.spotlightHintShown);
  const setSpotlightHintShown = useDesignerStore((s) => s.setSpotlightHintShown);
  const spotlightOpen = useDesignerStore((s) => s.spotlightOpen);

  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasSelection = selectedElementIds.length > 0;
  // Derive reset state: when no selection or spotlight is open, treat as dismissed
  const isActive = hasSelection && !spotlightOpen;
  // Dismissed only applies while active; effectively resets when selection is cleared
  const effectiveDismissed = isActive && dismissed;
  const shouldShow = isActive && spotlightHintShown < MAX_HINT_DISPLAYS && !effectiveDismissed;

  useEffect(() => {
    // Show hint when element is selected (if not already shown too many times)
    if (shouldShow) {
      // Small delay so it doesn't flash during quick selections
      timerRef.current = setTimeout(() => {
        setVisible(true);
        setSpotlightHintShown(spotlightHintShown + 1);
      }, 800);

      // Auto-hide after 4 seconds
      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
        setDismissed(true);
      }, 4800);

      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      };
    }
  }, [shouldShow, spotlightHintShown, setSpotlightHintShown]);

  if (!visible || spotlightOpen) return null;

  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none"
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) translateY(${visible ? 0 : 8}px)`,
        transition: 'opacity 400ms ease-out, transform 400ms ease-out',
      }}
    >
      <div className="bg-card/90 backdrop-blur-sm border border-border/60 rounded-lg px-4 py-2 shadow-lg flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Press</span>
        <kbd className="px-2 py-0.5 rounded bg-muted border border-border font-mono text-[11px] text-foreground font-medium">
          Shift+S
        </kbd>
        <span className="text-xs text-muted-foreground">for quick properties</span>
      </div>
    </div>
  );
}

export function Canvas() {
  const elements = useDesignerStore((s) => s.elements);
  const zoom = useDesignerStore((s) => s.zoom);
  const panX = useDesignerStore((s) => s.panX);
  const panY = useDesignerStore((s) => s.panY);
  const isAutoPanning = useDesignerStore((s) => s.isAutoPanning);
  // Select individual canvas settings to avoid object reference changes
  const pageWidth = useDesignerStore((s) => s.canvasSettings.pageWidth);
  const pageHeight = useDesignerStore((s) => s.canvasSettings.pageHeight);
  const pageBackgroundColor = useDesignerStore((s) => s.canvasSettings.pageBackgroundColor);
  const marginTop = useDesignerStore((s) => s.canvasSettings.marginTop);
  const marginBottom = useDesignerStore((s) => s.canvasSettings.marginBottom);
  const marginLeft = useDesignerStore((s) => s.canvasSettings.marginLeft);
  const marginRight = useDesignerStore((s) => s.canvasSettings.marginRight);
  const marginShow = useDesignerStore((s) => s.canvasSettings.marginGuideline.show);
  const marginColor = useDesignerStore((s) => s.canvasSettings.marginGuideline.color);
  const marginThickness = useDesignerStore((s) => s.canvasSettings.marginGuideline.thickness);
  const marginStyle = useDesignerStore((s) => s.canvasSettings.marginGuideline.style);
  const marginOpacity = useDesignerStore((s) => s.canvasSettings.marginGuideline.opacity);

  const isPanning = useDesignerStore((s) => s.isPanning);
  const isDragging = useDesignerStore((s) => s.isDragging);
  const isGroupChildDragging = useDesignerStore((s) => s.isGroupChildDragging);
  const isSelecting = useDesignerStore((s) => s.isSelecting);
  const selectionRect = useDesignerStore((s) => s.selectionRect);
  const alignmentGuidelines = useDesignerStore((s) => s.alignmentGuidelines);
  const angleSnapInfo = useDesignerStore((s) => s.angleSnapInfo);
  const selectedElementId = useDesignerStore((s) => s.selectedElementId);
  const selectedElementIds = useDesignerStore((s) => s.selectedElementIds);
  const findElementById = useDesignerStore((s) => s.findElementById);
  const editingGroupId = useDesignerStore((s) => s.editingGroupId);
  const contextMenu = useDesignerStore((s) => s.contextMenu);
  const canUndo = useDesignerStore((s) => s.canUndo);
  const canRedo = useDesignerStore((s) => s.canRedo);
  const undo = useDesignerStore((s) => s.undo);
  const redo = useDesignerStore((s) => s.redo);
  const altHeld = useDesignerStore((s) => s.altHeld);
  const selectedTableCells = useDesignerStore((s) => s.selectedTableCells);
  // Active resize / corner-drag state — used to lock the cursor to the resize
  // arrow for the entire drag (not just while hovering the small handle), so
  // the cursor doesn't flicker between the resize arrow and the move/default
  // cursor as the mouse drifts off the handle onto the element body or canvas.
  const isResizing = useDesignerStore((s) => s.isResizing);
  const isCornerDragging = useDesignerStore((s) => s.isCornerDragging);
  const resizeHandle = useDesignerStore((s) => s.resizeHandle);
  const draggingCornerIndex = useDesignerStore((s) => s.draggingCornerIndex);
  // Note: addElement, groupSelected, ungroupSelected, enterGroup, exitGroup,
  // setContextMenu, clearContextMenu, canGroup, canUngroup are accessed via
  // getState() in event handlers to avoid unnecessary re-renders.

  const viewportRef = useRef<HTMLDivElement>(null);
  const isReadyRef = useRef(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const arrowKeyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null);
  // Tracks whether panning was initiated by spacebar (vs. middle-click).
  // Space-panning should continue until spacebar is released, not on mouseup.
  const spacePanningRef = useRef(false);
  // Synchronous mirror of spacePressed — avoids React re-render delay for
  // critical panning logic that must respond within the same event cycle.
  const spacePressedRef = useRef(false);

  // Stores the pointerId from the most recent pointerdown on the viewport.
  // Used to set pointer capture after startSelection is called in handleMouseDown,
  // ensuring reliable pointermove delivery during fast drag-to-select operations.
  const lastPointerIdRef = useRef<number | null>(null);

  // ── Cursor lock during active resize / corner-drag ─────────────────────────
  // While the user is dragging a resize handle (isResizing) or an individual
  // corner point (isCornerDragging), lock the cursor to the matching resize
  // arrow for the ENTIRE drag — not just while hovering the small handle. This
  // prevents the cursor from flickering between the resize arrow and the
  // move/default cursor as the mouse drifts off the handle onto the element
  // body or the canvas. The cursor is computed from the active handle + the
  // selected rectangle's rotation, so it matches the handle's visual direction.
  const activeResizeCursor = useMemo(() => {
    if (isResizing && resizeHandle) {
      const el = findElementById(selectedElementId ?? '');
      const rotation = el && el.type === 'rectangle' ? getRectRotation(el) : 0;
      return getResizeCursor(resizeHandle, rotation);
    }
    if (isCornerDragging && draggingCornerIndex !== null) {
      // Corner-drag uses the same handle layout as resize (nw/ne/se/sw). The
      // cursor reflects the dragged corner's direction so the user sees which
      // way the corner is free to move.
      const handlePos = (['nw', 'ne', 'se', 'sw'] as const)[draggingCornerIndex];
      const el = findElementById(selectedElementId ?? '');
      const rotation = el && el.type === 'rectangle' ? getRectRotation(el) : 0;
      return getResizeCursor(handlePos, rotation);
    }
    return null;
  }, [isResizing, isCornerDragging, resizeHandle, draggingCornerIndex, selectedElementId, findElementById, elements]);

  // Apply the locked cursor globally so it persists everywhere the mouse goes
  // during the drag — including off the handle, off the element body, off the
  // canvas viewport (over panels/menus), and even off the browser window. A
  // dynamically-injected <style> rule with `* { cursor: ... !important }` is
  // used so it overrides EVERY competing cursor rule (handle inline styles,
  // element `cursor-move` classes, panel cursors, etc.) — this is what
  // eliminates the flicker. The rule is removed on drag end so normal
  // per-element cursors resume.
  useEffect(() => {
    if (activeResizeCursor) {
      const styleId = 'active-resize-cursor-lock';
      let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
      }
      // `*` selector + !important overrides all element-level cursor rules.
      // We also set body directly as a belt-and-suspenders for browsers that
      // ignore the `*` rule on the root element.
      styleEl.textContent = `* { cursor: ${activeResizeCursor} !important; }`;
      document.body.style.cursor = activeResizeCursor;
      return () => {
        if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
        document.body.style.cursor = '';
      };
    }
  }, [activeResizeCursor]);

  // When spacebar is pressed, automatically start panning at the last known
  // mouse position. When released, stop space-panning. This allows the user
  // to pan by simply holding space and moving the mouse/touchpad — no click
  // required.
  // NOTE: The keydown/keyup handlers now start/stop panning SYNCHRONOUSLY
  // (via refs) for zero-delay response. This useEffect is a safety net that
  // ensures the React state and refs stay in sync.
  useEffect(() => {
    if (spacePressed) {
      // If the keydown handler didn't already start panning (shouldn't happen,
      // but just in case), start it here.
      if (!spacePanningRef.current) {
        spacePanningRef.current = true;
        const pos = lastMouseRef.current;
        if (pos) {
          useDesignerStore.getState().startPanning(pos.x, pos.y);
        }
      }
    } else {
      // Stop space-panning when spacebar is released (safety net — keyup
      // handler already does this synchronously)
      if (spacePanningRef.current) {
        if (panRafRef.current) {
          cancelAnimationFrame(panRafRef.current);
          panRafRef.current = null;
        }
        if (panCoordsRef.current) {
          useDesignerStore.getState().updatePan(panCoordsRef.current.x, panCoordsRef.current.y);
          panCoordsRef.current = null;
        }
        useDesignerStore.getState().stopPanning();
        spacePanningRef.current = false;
      }
    }
  }, [spacePressed]);

  // Center/re-center the page when dimensions change
  const prevSizeRef = useRef({ w: pageWidth, h: pageHeight });
  // Ref to hold RAF cleanup functions for the fit-on-mount effect
  const rafRefCleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const sizeChanged =
      prevSizeRef.current.w !== pageWidth ||
      prevSizeRef.current.h !== pageHeight;

    if (!sizeChanged && isReadyRef.current) return;

    // Use double-rAF so the viewport has its FINAL dimensions before we compute
    // the fit. On initial mount (and especially on reload), the properties panel
    // animates its width from 0 → 288px, so a synchronous clientWidth read gives
    // the wrong value. Waiting two frames ensures the layout has settled.
    const fit = () => {
      const vp = viewportRef.current;
      if (!vp) return;
      useDesignerStore.getState().fitToPage(vp.clientWidth, vp.clientHeight);
      prevSizeRef.current = { w: pageWidth, h: pageHeight };
      isReadyRef.current = true;
    };
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(fit);
      rafRefCleanup.current = () => cancelAnimationFrame(raf2);
    });
    rafRefCleanup.current = () => cancelAnimationFrame(raf1);

    return () => {
      if (rafRefCleanup.current) rafRefCleanup.current();
    };
  }, [pageWidth, pageHeight]);

  // ResizeObserver: re-fit the page when the viewport's actual size changes
  // during the initial mount settling period (e.g. when the properties panel
  // finishes its width animation). After the settling period, viewport resizes
  // (like window resize) don't override the user's zoom/pan.
  const hasObservedResizeRef = useRef(false);
  const settlingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSettlingRef = useRef(true);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // After 1.5s, stop re-fitting on viewport resize (user is in control now)
    settlingTimerRef.current = setTimeout(() => { isSettlingRef.current = false; }, 1500);
    const observer = new ResizeObserver(() => {
      if (!isSettlingRef.current) return;
      // Skip the very first observation (it fires on mount with the initial size)
      if (!hasObservedResizeRef.current) {
        hasObservedResizeRef.current = true;
        return;
      }
      const st = useDesignerStore.getState();
      const vp = viewportRef.current;
      if (!vp) return;
      st.fitToPage(vp.clientWidth, vp.clientHeight);
    });
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      if (settlingTimerRef.current) clearTimeout(settlingTimerRef.current);
    };
  }, []);

  // RAF-throttled panning: coalesce updatePan calls to once per animation frame
  const panRafRef = useRef<number | null>(null);
  const panCoordsRef = useRef<{ x: number; y: number } | null>(null);
  const flushPanRef = useRef(() => {});
  flushPanRef.current = () => {
    const raf = panRafRef.current;
    const coords = panCoordsRef.current;
    panRafRef.current = null;
    panCoordsRef.current = null;
    if (raf) cancelAnimationFrame(raf);
    if (coords) {
      useDesignerStore.getState().updatePan(coords.x, coords.y);
    }
  };

  // RAF-throttled selection: coalesce updateSelection calls to once per animation frame
  // for smooth drag-to-highlight without lag or jitter.
  const selRafRef = useRef<number | null>(null);
  const selCoordsRef = useRef<{ canvasX: number; canvasY: number } | null>(null);
  const flushSelRef = useRef(() => {});
  flushSelRef.current = () => {
    const raf = selRafRef.current;
    const coords = selCoordsRef.current;
    selRafRef.current = null;
    selCoordsRef.current = null;
    if (raf) cancelAnimationFrame(raf);
    if (coords) {
      useDesignerStore.getState().updateSelection(coords.canvasX, coords.canvasY);
    }
  };

  // RAF throttling for rectangle corner drag — prevents the store update +
  // React re-render from blocking the main thread during fast mouse movement.
  // Only the latest mouse position is processed per animation frame.
  const cornerRafRef = useRef<number | null>(null);
  const cornerCoordsRef = useRef<{ x: number; y: number } | null>(null);
  const flushCornerRef = useRef(() => {});
  flushCornerRef.current = () => {
    const raf = cornerRafRef.current;
    const coords = cornerCoordsRef.current;
    cornerRafRef.current = null;
    cornerCoordsRef.current = null;
    if (raf) cancelAnimationFrame(raf);
    if (coords) {
      const s = useDesignerStore.getState();
      if (s.isCornerDragging) {
        s.updateCornerDrag(coords.x, coords.y, s.shiftHeld, s.ctrlHeld);
      }
    }
  };

  // Handle global mouse events
  // IMPORTANT: We use getState() inside handlers for zoom/panX/panY to avoid
  // re-registering listeners on every pan/zoom change, which caused an infinite
  // re-render cycle (pan changes → effect re-registers → next mousemove → pan changes → ...)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Read latest state from store to avoid stale closures
      const state = useDesignerStore.getState();

      // When actively selecting, we MUST process ALL mousemove events so we can
      // clamp the cursor to the viewport boundary — even when the cursor moves
      // over panels during fast drags.  Skip the panel/input guards for selection.
      // The same applies to any in-progress canvas operation (corner drag, move,
      // resize, endpoint drag, table resize, group-child drag/resize): once the
      // user has started the gesture on the canvas, the cursor will often sweep
      // across the properties/left panel at high speed — if we `return` here the
      // operation freezes mid-drag and only resumes when the cursor re-enters
      // the canvas, which is the "stuck until I release" symptom. Bypass the
      // panel/input guards for the duration of any active gesture.
      const hasActiveGesture =
        state.isSelecting ||
        state.isCornerDragging ||
        state.isDragging ||
        state.isResizing ||
        state.isEndpointDragging ||
        state.isGroupChildDragging ||
        state.isGroupChildResizing ||
        state.isTableColResizing ||
        state.isTableRowResizing ||
        state.isPanning;
      if (!hasActiveGesture) {
        // Skip if user is interacting with a UI control outside the canvas
        // (e.g., sliders, inputs, color pickers in the properties panel)
        const target = e.target as HTMLElement;
        if (target?.closest?.('[data-ui-panel]')) return;
        if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.tagName === 'TEXTAREA') return;
      }

      // Space-panning: if spacebar is held but panning hasn't started yet
      // (e.g., mouse wasn't over canvas when space was pressed), start now.
      if (spacePanningRef.current && !state.isPanning) {
        state.startPanning(e.clientX, e.clientY);
      }

      if (state.isPanning) {
        // Throttle updatePan with RAF to avoid excessive state updates during panning
        panCoordsRef.current = { x: e.clientX, y: e.clientY };
        if (!panRafRef.current) {
          panRafRef.current = requestAnimationFrame(() => flushPanRef.current());
        }
      }
      if (state.isDragging) {
        state.updateDrag(e.clientX, e.clientY);
      }
      if (state.isGroupChildDragging) {
        state.updateGroupChildDrag(e.clientX, e.clientY);
      }
      if (state.isGroupChildResizing) {
        state.updateGroupChildResize(e.clientX, e.clientY);
      }
      if (state.isResizing) {
        state.updateResize(e.clientX, e.clientY);
      }
      if (state.isTableColResizing || state.isTableRowResizing) {
        state.updateTableResize(e.clientX, e.clientY);
        return;
      }
      if (state.isEndpointDragging) {
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
        state.updateEndpointDrag(e.clientX, e.clientY, e.shiftKey);
      }
      if (state.isCornerDragging) {
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
        // RAF-throttle: store the latest mouse position and process at most
        // once per animation frame. This prevents fast mouse movement from
        // queuing up stale store updates that cause visual lag.
        cornerCoordsRef.current = { x: e.clientX, y: e.clientY };
        if (!cornerRafRef.current) {
          cornerRafRef.current = requestAnimationFrame(() => flushCornerRef.current());
        }
      }
      if (state.isSelecting) {
        // Clamp cursor to viewport boundaries so the selection rectangle
        // never leaves the workspace area (between panels/menus).
        const viewport = viewportRef.current;
        if (!viewport) return;
        const rect = viewport.getBoundingClientRect();
        const clampedX = Math.max(rect.left, Math.min(e.clientX, rect.right));
        const clampedY = Math.max(rect.top, Math.min(e.clientY, rect.bottom));
        const canvasX = (clampedX - rect.left) / state.zoom - state.panX;
        const canvasY = (clampedY - rect.top) / state.zoom - state.panY;
        // RAF-throttle selection updates for smooth performance
        selCoordsRef.current = { canvasX, canvasY };
        if (!selRafRef.current) {
          selRafRef.current = requestAnimationFrame(() => flushSelRef.current());
        }
      }
    };

    const flushPendingSelection = () => {
      if (selRafRef.current) {
        cancelAnimationFrame(selRafRef.current);
        selRafRef.current = null;
      }
      if (selCoordsRef.current) {
        useDesignerStore.getState().updateSelection(selCoordsRef.current.canvasX, selCoordsRef.current.canvasY);
        selCoordsRef.current = null;
      }
    };

    const handleMouseUp = () => {
      // Flush any pending pan update before stopping
      if (panRafRef.current) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
      if (panCoordsRef.current) {
        useDesignerStore.getState().updatePan(panCoordsRef.current.x, panCoordsRef.current.y);
        panCoordsRef.current = null;
      }

      // Flush any pending selection update before finishing
      flushPendingSelection();

      const state = useDesignerStore.getState();
      // Don't stop panning on mouseup if space-panning is active —
      // space-panning should only stop when the spacebar is released.
      if (state.isPanning && !spacePanningRef.current) state.stopPanning();
      if (state.isDragging) state.stopDragging();
      if (state.isGroupChildDragging) state.stopGroupChildDrag();
      if (state.isGroupChildResizing) state.stopGroupChildResize();
      if (state.isResizing) state.stopResizing();
      if (state.isTableColResizing || state.isTableRowResizing) {
        state.stopTableResize();
        return;
      }
      if (state.isEndpointDragging) state.stopEndpointDrag();
      // Flush any pending corner-drag RAF before stopping so the final
      // mouse position is applied before the drag state is cleared.
      if (cornerRafRef.current) {
        cancelAnimationFrame(cornerRafRef.current);
        cornerRafRef.current = null;
      }
      if (cornerCoordsRef.current) {
        const { x: cx, y: cy } = cornerCoordsRef.current;
        cornerCoordsRef.current = null;
        const cs = useDesignerStore.getState();
        if (cs.isCornerDragging) cs.updateCornerDrag(cx, cy, cs.shiftHeld, cs.ctrlHeld);
      }
      if (state.isCornerDragging) state.stopCornerDrag();
      if (state.isSelecting) state.finishSelection();
      // Finish Alt+drag cell selection if active
      if (state.isTableCellSelecting) state.finishTableCellSelecting();
    };

    // Also listen for pointerup as a safety net: when the custom Slider
    // component calls preventDefault() on pointerdown, the browser will
    // NOT dispatch compatibility mouseup events per the Pointer Events spec.
    // Adding a pointerup listener ensures canvas operations are always
    // properly stopped when the user releases the mouse.
    const handlePointerUp = () => {
      // Flush any pending pan update before stopping
      if (panRafRef.current) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
      if (panCoordsRef.current) {
        useDesignerStore.getState().updatePan(panCoordsRef.current.x, panCoordsRef.current.y);
        panCoordsRef.current = null;
      }

      // Flush any pending selection update before finishing
      if (selRafRef.current) {
        cancelAnimationFrame(selRafRef.current);
        selRafRef.current = null;
      }
      if (selCoordsRef.current) {
        useDesignerStore.getState().updateSelection(selCoordsRef.current.canvasX, selCoordsRef.current.canvasY);
        selCoordsRef.current = null;
      }

      const state = useDesignerStore.getState();
      // Don't stop panning on pointerup if space-panning is active —
      // space-panning should only stop when the spacebar is released.
      if (state.isPanning && !spacePanningRef.current) state.stopPanning();
      if (state.isDragging) state.stopDragging();
      if (state.isGroupChildDragging) state.stopGroupChildDrag();
      if (state.isGroupChildResizing) state.stopGroupChildResize();
      if (state.isResizing) state.stopResizing();
      if (state.isTableColResizing || state.isTableRowResizing) {
        state.stopTableResize();
        return;
      }
      if (state.isEndpointDragging) state.stopEndpointDrag();
      // Flush any pending corner-drag RAF before stopping so the final
      // mouse position is applied before the drag state is cleared.
      if (cornerRafRef.current) {
        cancelAnimationFrame(cornerRafRef.current);
        cornerRafRef.current = null;
      }
      if (cornerCoordsRef.current) {
        const { x: cx, y: cy } = cornerCoordsRef.current;
        cornerCoordsRef.current = null;
        const cs = useDesignerStore.getState();
        if (cs.isCornerDragging) cs.updateCornerDrag(cx, cy, cs.shiftHeld, cs.ctrlHeld);
      }
      if (state.isCornerDragging) state.stopCornerDrag();
      if (state.isSelecting) state.finishSelection();
      // Finish Alt+drag cell selection if active
      if (state.isTableCellSelecting) state.finishTableCellSelecting();
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('pointerup', handlePointerUp);
      // Clean up any pending RAF on unmount
      if (panRafRef.current) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
      if (selRafRef.current) {
        cancelAnimationFrame(selRafRef.current);
        selRafRef.current = null;
      }
    };
  }, []); // flushPanRef is a stable ref — no deps needed

  // ── Pointer capture for reliable selection tracking ──────────────────────────
  // When the user starts a rubber-band selection, we capture the pointer on the
  // viewport element. This ensures ALL subsequent pointermove / pointerup events
  // are delivered to the viewport — even when the cursor moves outside the viewport
  // (over panels, menus, or even outside the browser window). Combined with cursor
  // clamping, this guarantees the selection rectangle never leaves the workspace.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handlePointerDown = (e: PointerEvent) => {
      // Store the pointerId so handleMouseDown can capture the pointer
      // after it determines this click should start a selection.
      if (e.button === 0) {
        lastPointerIdRef.current = e.pointerId;
      }

      // When spacebar is held, prevent the browser's default gesture
      // disambiguation (tap vs drag vs scroll) which causes a ~1s delay
      // on touchpads before pointermove events are dispatched.
      if (spacePanningRef.current) {
        e.preventDefault();
      }
    };

    const handleViewportPointerMove = (e: PointerEvent) => {
      const state = useDesignerStore.getState();

      // ── Space-panning via pointermove (touchpad fix) ────────────────────
      // On touchpads, mousemove events may be delayed by ~1 second after
      // keyboard input due to browser gesture disambiguation. Pointermove
      // events are dispatched immediately, so we handle space-panning here
      // as well to eliminate the touchpad delay.
      if (spacePanningRef.current) {
        if (!state.isPanning) {
          state.startPanning(e.clientX, e.clientY);
        } else {
          panCoordsRef.current = { x: e.clientX, y: e.clientY };
          if (!panRafRef.current) {
            panRafRef.current = requestAnimationFrame(() => flushPanRef.current());
          }
        }
      }

      if (!state.isSelecting) return;

      // Clamp cursor to viewport boundaries so the selection rectangle
      // never leaves the workspace area.
      const rect = viewport.getBoundingClientRect();
      const clampedX = Math.max(rect.left, Math.min(e.clientX, rect.right));
      const clampedY = Math.max(rect.top, Math.min(e.clientY, rect.bottom));
      const canvasX = (clampedX - rect.left) / state.zoom - state.panX;
      const canvasY = (clampedY - rect.top) / state.zoom - state.panY;

      // RAF-throttle selection updates for smooth performance.
      // This shares the same selCoordsRef / selRafRef as the window-level
      // mousemove handler, so double-writes are harmless — last write wins.
      selCoordsRef.current = { canvasX, canvasY };
      if (!selRafRef.current) {
        selRafRef.current = requestAnimationFrame(() => flushSelRef.current());
      }
    };

    const handleViewportPointerUp = (e: PointerEvent) => {
      const state = useDesignerStore.getState();
      if (state.isSelecting) {
        // Flush any pending selection update before finishing
        if (selRafRef.current) {
          cancelAnimationFrame(selRafRef.current);
          selRafRef.current = null;
        }
        if (selCoordsRef.current) {
          useDesignerStore.getState().updateSelection(
            selCoordsRef.current.canvasX,
            selCoordsRef.current.canvasY,
          );
          selCoordsRef.current = null;
        }
        state.finishSelection();
      }

      // Release pointer capture
      try { viewport.releasePointerCapture(e.pointerId); } catch {}
      lastPointerIdRef.current = null;
    };

    viewport.addEventListener('pointerdown', handlePointerDown);
    viewport.addEventListener('pointermove', handleViewportPointerMove);
    viewport.addEventListener('pointerup', handleViewportPointerUp);

    return () => {
      viewport.removeEventListener('pointerdown', handlePointerDown);
      viewport.removeEventListener('pointermove', handleViewportPointerMove);
      viewport.removeEventListener('pointerup', handleViewportPointerUp);
    };
  }, []);

  // Track SHIFT key state globally for angle snapping
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        useDesignerStore.getState().setShiftHeld(true);
        // When SHIFT is pressed during endpoint drag, re-trigger with current position
        const state = useDesignerStore.getState();
        if (state.isEndpointDragging && lastMouseRef.current) {
          state.updateEndpointDrag(lastMouseRef.current.x, lastMouseRef.current.y, true);
        }
        // When SHIFT is pressed during rectangle corner drag, re-trigger so the
        // H/V constraint applies immediately (without waiting for the next mousemove).
        if (state.isCornerDragging && lastMouseRef.current) {
          state.updateCornerDrag(lastMouseRef.current.x, lastMouseRef.current.y, true, state.ctrlHeld);
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        useDesignerStore.getState().setShiftHeld(false);
        // When SHIFT is released during endpoint drag, re-trigger with free-angle mode
        const state = useDesignerStore.getState();
        if (state.isEndpointDragging && lastMouseRef.current) {
          state.updateEndpointDrag(lastMouseRef.current.x, lastMouseRef.current.y, false);
        }
        // When SHIFT is released during rectangle corner drag, re-trigger so the
        // constraint releases immediately.
        if (state.isCornerDragging && lastMouseRef.current) {
          state.updateCornerDrag(lastMouseRef.current.x, lastMouseRef.current.y, false, state.ctrlHeld);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Track CTRL key state globally for Alt+Ctrl vertical corner alignment.
  // Mirrors the Shift listener above. We deliberately ignore Ctrl when the
  // user is also pressing Meta (Cmd on mac) — that combo is reserved for app
  // shortcuts (copy/paste/undo/etc.) and shouldn't toggle alignment mode.
  // Note: we read isCornerDragging fresh inside the handler so we don't race
  // with the corner-drag start.
  useEffect(() => {
    const isCtrlOnly = (e: KeyboardEvent) =>
      (e.key === 'Control' || e.key === 'ControlLeft' || e.key === 'ControlRight') && !e.metaKey;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isCtrlOnly(e)) return;
      useDesignerStore.getState().setCtrlHeld(true);
      // When CTRL is pressed during rectangle corner drag, re-trigger so the
      // vertical alignment applies immediately (without waiting for the next
      // mousemove).
      const state = useDesignerStore.getState();
      if (state.isCornerDragging && lastMouseRef.current) {
        state.updateCornerDrag(lastMouseRef.current.x, lastMouseRef.current.y, state.shiftHeld, true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isCtrlOnly(e)) return;
      useDesignerStore.getState().setCtrlHeld(false);
      // When CTRL is released during rectangle corner drag, re-trigger so the
      // vertical constraint releases immediately.
      const state = useDesignerStore.getState();
      if (state.isCornerDragging && lastMouseRef.current) {
        state.updateCornerDrag(lastMouseRef.current.x, lastMouseRef.current.y, state.shiftHeld, false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Track ALT key state globally for table cell multi-selection.
  // altHeld is always tracked, but preventDefault only fires while the pointer
  // is over the canvas viewport — swallowing Alt everywhere would break the
  // browser menu-access shortcut (notably Firefox) for the rest of the page.
  useEffect(() => {
    let pointerInCanvas = false;
    const handlePointerOver = (e: PointerEvent) => {
      const vp = viewportRef.current;
      pointerInCanvas = !!vp && !!e.target && vp.contains(e.target as Node);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        if (pointerInCanvas) e.preventDefault();
        useDesignerStore.getState().setAltHeld(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        useDesignerStore.getState().setAltHeld(false);
      }
    };
    window.addEventListener('pointerover', handlePointerOver, { passive: true });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('pointerover', handlePointerOver);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Handle keyboard shortcuts including arrow keys
  // Use getState() inside handler to avoid re-registering on every selection/setting change
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditable = target?.isContentEditable || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';

      const state = useDesignerStore.getState();

      if (e.code === 'Space' && !isEditable) {
        e.preventDefault();
        // Skip if space is already held (key repeat)
        if (spacePressedRef.current) return;
        // Synchronously update refs and start panning IMMEDIATELY — do NOT wait
        // for React re-render. This eliminates the ~1 frame delay between keydown
        // and the first pan response, which is especially noticeable on touchpads
        // where the browser's gesture disambiguation adds its own delay.
        spacePressedRef.current = true;
        spacePanningRef.current = true;
        // Apply touch-action: none synchronously to the DOM so the browser
        // skips gesture disambiguation for subsequent pointer events.
        if (viewportRef.current) {
          viewportRef.current.style.touchAction = 'none';
        }
        // Start panning at last known mouse position
        const pos = lastMouseRef.current;
        if (pos) {
          useDesignerStore.getState().startPanning(pos.x, pos.y);
        }
        // Also trigger React re-render for cursor style etc.
        setSpacePressed(true);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditable) {
        if (state.selectedElementIds.length > 0) {
          e.preventDefault();
          // Remove all selected elements
          for (const id of [...state.selectedElementIds]) {
            state.removeElement(id);
          }
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC' && !isEditable) {
        if (state.selectedElementId) {
          e.preventDefault();
          state.copyElement();
        }
      }
      // Cut with Ctrl+X
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyX' && !e.shiftKey && !isEditable) {
        if (state.selectedElementIds.length > 0) {
          e.preventDefault();
          state.cutElement();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV' && !e.shiftKey && !isEditable) {
        e.preventDefault();
        state.pasteElement();
      }
      // Paste in Place with Ctrl+Shift+V
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyV' && !isEditable) {
        e.preventDefault();
        state.pasteElementInPlace();
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD' && !isEditable) {
        if (state.selectedElementIds.length > 0) {
          e.preventDefault();
          // Duplicate all selected elements
          for (const id of [...state.selectedElementIds]) {
            state.duplicateElement(id);
          }
        }
      }

      // Zoom In with Ctrl+= or Ctrl++
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+') && !isEditable) {
        e.preventDefault();
        state.zoomIn();
      }
      // Zoom Out with Ctrl+-
      if ((e.ctrlKey || e.metaKey) && e.key === '-' && !isEditable) {
        e.preventDefault();
        state.zoomOut();
      }
      // Reset Zoom with Ctrl+0
      if ((e.ctrlKey || e.metaKey) && e.key === '0' && !isEditable) {
        e.preventDefault();
        state.resetZoom();
      }

      // Select All with Ctrl+A
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA' && !isEditable) {
        e.preventDefault();
        state.selectAll();
      }

      // Undo with Ctrl+Z (or Ctrl+Shift+Z for redo)
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !isEditable) {
        e.preventDefault();
        if (e.shiftKey) {
          state.redo();
        } else {
          state.undo();
        }
      }

      // Redo with Ctrl+Y
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY' && !isEditable) {
        e.preventDefault();
        state.redo();
      }

      // Save with Ctrl+S
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS' && !isEditable) {
        e.preventDefault();
        if (e.shiftKey) {
          void state.saveProjectAs();
        } else {
          void state.saveProject();
        }
      }

      // Open with Ctrl+O
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyO' && !isEditable) {
        e.preventDefault();
        void state.loadProject();
      }

      // New project with Ctrl+N
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyN' && !isEditable) {
        e.preventDefault();
        state.setNewProjectOpen(true);
      }

      // Export as PDF with Shift+Ctrl+E
      // Use e.code instead of e.key so it works regardless of Caps Lock state
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyE' && !isEditable) {
        e.preventDefault();
        state.setExportPdfOpen(true);
      }

      // Shift+S to open spotlight property picker (works in ALL display modes per Recommendation 10)
      // Use e.code instead of e.key so it works regardless of Caps Lock state
      // Disabled while the welcome modal is showing — the user has no project yet.
      // Disabled when propertyDisplayMode is 'panel' only — the spotlight/cards system
      // is inactive in panel-only mode.
      if (e.shiftKey && e.code === 'KeyS' && !isEditable && !(e.ctrlKey || e.metaKey) && !state.welcomeModalOpen) {
        if (state.propertyDisplayMode === 'panel') {
          // In panel-only mode, Shift+S does nothing — the spotlight/card system is disabled.
          return;
        }
        e.preventDefault();
        const st = useDesignerStore.getState();
        // Close context menu when opening spotlight
        if (st.contextMenu) {
          st.clearContextMenu();
        }
        if (st.selectedElementIds.length > 0) {
          st.openSpotlight();
        }
        return;
      }

      // Shift+Q to open predefined blocks picker (works regardless of selection)
      // Disabled while the welcome modal is showing — the user has no project yet.
      if (e.shiftKey && e.code === 'KeyQ' && !isEditable && !(e.ctrlKey || e.metaKey) && !state.welcomeModalOpen) {
        e.preventDefault();
        const st = useDesignerStore.getState();
        if (st.contextMenu) {
          st.clearContextMenu();
        }
        if (st.predefinedBlocksOpen) {
          st.closePredefinedBlocks();
        } else {
          st.openPredefinedBlocks();
        }
        return;
      }

      // ESC to exit group edit mode or close spotlight or close predefined blocks or clear cell selection
      if (e.key === 'Escape' && !isEditable) {
        const st = useDesignerStore.getState();
        if (st.predefinedBlocksOpen) {
          e.preventDefault();
          st.closePredefinedBlocks();
          return;
        }
        if (st.spotlightOpen) {
          e.preventDefault();
          st.closeSpotlight();
          return;
        }
        if (st.editingGroupId) {
          e.preventDefault();
          st.exitGroup();
          return;
        }
        if (st.selectedTableCells.length > 0) {
          e.preventDefault();
          st.clearTableCellSelection();
          return;
        }
      }

      // Ctrl+G to group, Ctrl+Shift+G to ungroup
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyG' && !e.shiftKey && !isEditable) {
        e.preventDefault();
        const st = useDesignerStore.getState();
        if (st.canGroup()) {
          st.groupSelected();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyG' && e.shiftKey && !isEditable) {
        e.preventDefault();
        const st = useDesignerStore.getState();
        if (st.canUngroup()) {
          st.ungroupSelected();
        }
      }

      // Arrow key movement — moves all selected elements
      // Hold Alt to ignore snap settings temporarily (1px step regardless of snap)
      if (state.selectedElementIds.length > 0 && !isEditable && !state.isDragging && !state.isResizing) {
        const snapOverride = e.altKey;
        const step = snapOverride ? 1 : (e.shiftKey ? 10 : (state.snapEnabled ? state.snapUnit : 1));
        const skipSnap = snapOverride || !state.snapEnabled;
        let dx = 0;
        let dy = 0;

        if (e.key === 'ArrowLeft') { dx = -step; }
        else if (e.key === 'ArrowRight') { dx = step; }
        else if (e.key === 'ArrowUp') { dy = -step; }
        else if (e.key === 'ArrowDown') { dy = step; }

        if (dx !== 0 || dy !== 0) {
          e.preventDefault();
          state.moveElementByKeys(dx, dy, skipSnap);

          // Clear guidelines after a short delay when arrow keys stop
          if (arrowKeyTimerRef.current) {
            clearTimeout(arrowKeyTimerRef.current);
          }
          arrowKeyTimerRef.current = setTimeout(() => {
            useDesignerStore.getState().clearAlignmentGuidelines();
          }, 800);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        // Synchronously stop space-panning — don't wait for React re-render
        spacePressedRef.current = false;
        if (spacePanningRef.current) {
          // Flush any pending pan update
          if (panRafRef.current) {
            cancelAnimationFrame(panRafRef.current);
            panRafRef.current = null;
          }
          if (panCoordsRef.current) {
            useDesignerStore.getState().updatePan(panCoordsRef.current.x, panCoordsRef.current.y);
            panCoordsRef.current = null;
          }
          useDesignerStore.getState().stopPanning();
          spacePanningRef.current = false;
        }
        // Reset touch-action synchronously
        if (viewportRef.current) {
          viewportRef.current.style.touchAction = '';
        }
        // Trigger React re-render for cursor style
        setSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (arrowKeyTimerRef.current) {
        clearTimeout(arrowKeyTimerRef.current);
      }
    };
  }, []); // No deps — reads everything from getState()

  // RAF-throttled wheel zoom — coalesce rapid wheel events into one zoom per frame
  const wheelRafRef = useRef<number | null>(null);
  const wheelAccumRef = useRef<{ deltaY: number; clientX: number; clientY: number } | null>(null);

  const flushWheel = useCallback(() => {
    wheelRafRef.current = null;
    const acc = wheelAccumRef.current;
    if (!acc) return;
    wheelAccumRef.current = null;

    const state = useDesignerStore.getState();
    const step = state.zoomStep / 100;
    const delta = acc.deltaY > 0 ? -step : step;
    const newZoom = state.zoom + delta;

    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const mouseX = acc.clientX - rect.left;
    const mouseY = acc.clientY - rect.top;

    state.zoomAtPoint(newZoom, mouseX, mouseY);
  }, []);

  // Register wheel event listener with { passive: false } so that
  // e.preventDefault() actually works.  React's onWheel is treated as
  // passive by default in some browsers, which means preventDefault()
  // silently fails — allowing the browser's pinch-to-zoom (trackpad
  // gesture) to interfere with the app's own zoom handling.
  // Smooth scroll animation state for text editing (Alt+wheel)
  const textScrollRafRef = useRef<number | null>(null);
  const textScrollTargetRef = useRef<number | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    // Smooth-scroll the TipTap editor toward the accumulated target.
    // Uses exponential easing (lerp 0.25) for a buttery-smooth glide.
    const animateTextScroll = () => {
      textScrollRafRef.current = null;
      const tiptapEl = document.querySelector('.tiptap.ProseMirror') as HTMLElement | null;
      if (!tiptapEl) { textScrollTargetRef.current = null; return; }

      const current = tiptapEl.scrollTop;
      const target = textScrollTargetRef.current ?? current;
      const diff = target - current;

      if (Math.abs(diff) < 0.5) {
        // Close enough — snap to target and stop
        tiptapEl.scrollTop = target;
        textScrollTargetRef.current = null;
        return;
      }

      // Lerp: move 25% of the remaining distance each frame
      tiptapEl.scrollTop = current + diff * 0.25;
      textScrollRafRef.current = requestAnimationFrame(animateTextScroll);
    };

    const handleWheel = (e: WheelEvent) => {
      const state = useDesignerStore.getState();

      // ── Space+wheel → pan instead of zoom (touchpad fix) ───────────────
      // On touchpads, after pressing the spacebar, the browser may delay
      // dispatching mousemove/pointermove events for ~1 second while it
      // disambiguates the gesture (tap vs drag vs scroll). However, wheel
      // events (from two-finger scroll or continued touchpad movement) are
      // dispatched immediately. By converting wheel events to pan movements
      // when space is held, touchpad users get instant panning response.
      if (spacePanningRef.current) {
        e.preventDefault();
        // Normalize delta: deltaMode 1 = lines, 2 = pages
        const pixelDeltaX = e.deltaMode === 1 ? e.deltaX * 20 : e.deltaMode === 2 ? e.deltaX * 600 : e.deltaX;
        const pixelDeltaY = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaMode === 2 ? e.deltaY * 600 : e.deltaY;
        const zoom = state.zoom;
        state.setPan(state.panX - pixelDeltaX / zoom, state.panY - pixelDeltaY / zoom);
        return;
      }

      // Alt+wheel while editing text → smooth-scroll text content instead of zooming
      if (e.altKey && state.editingTextElementId) {
        e.preventDefault();
        const tiptapEl = document.querySelector('.tiptap.ProseMirror') as HTMLElement | null;
        if (tiptapEl) {
          // Normalize delta: deltaMode 1 = lines, 2 = pages
          const delta = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaMode === 2 ? e.deltaY * 600 : e.deltaY;
          const maxScroll = tiptapEl.scrollHeight - tiptapEl.clientHeight;
          const currentTarget = textScrollTargetRef.current ?? tiptapEl.scrollTop;
          textScrollTargetRef.current = Math.max(0, Math.min(maxScroll, currentTarget + delta));
          if (!textScrollRafRef.current) {
            textScrollRafRef.current = requestAnimationFrame(animateTextScroll);
          }
        }
        return;
      }

      e.preventDefault();
      // Accumulate the latest wheel event; only process one per animation frame
      wheelAccumRef.current = { deltaY: e.deltaY, clientX: e.clientX, clientY: e.clientY };
      if (!wheelRafRef.current) {
        wheelRafRef.current = requestAnimationFrame(flushWheel);
      }
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', handleWheel);
      if (textScrollRafRef.current) {
        cancelAnimationFrame(textScrollRafRef.current);
        textScrollRafRef.current = null;
      }
      textScrollTargetRef.current = null;
    };
  }, [flushWheel]);

  // Handle drop from tool palette — uses getState() for latest zoom/pan
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('element-type') as ElementType;
    if (!type) return;

    const viewport = viewportRef.current;
    if (!viewport) return;

    const state = useDesignerStore.getState();
    const rect = viewport.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) / state.zoom - state.panX;
    const canvasY = (e.clientY - rect.top) / state.zoom - state.panY;

    state.addElement(type, canvasX, canvasY);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // Handle right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const state = useDesignerStore.getState();

    // Don't show context menu while in group edit mode
    if (state.editingGroupId) return;

    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) / state.zoom - state.panX;
    const canvasY = (e.clientY - rect.top) / state.zoom - state.panY;

    // If no element is selected, try to find and select the one under the cursor
    // Convert canvasX/Y from canvas-inner coords to page-content coords for
    // comparison with element positions (see finishSelection for details).
    if (state.selectedElementIds.length === 0) {
      const pageX = canvasX - VIEWPORT_PADDING;
      const pageY = canvasY - VIEWPORT_PADDING;
      for (let i = state.elements.length - 1; i >= 0; i--) {
        const el = state.elements[i];
        if (
          el.visible &&
          !el.locked &&
          pageX >= el.x &&
          pageX <= el.x + el.width &&
          pageY >= el.y &&
          pageY <= el.y + el.height
        ) {
          state.selectElement(el.id);
          break;
        }
      }
    }

    // Show context menu when there's at least 1 selected element
    if (useDesignerStore.getState().selectedElementIds.length >= 1) {
      useDesignerStore.getState().setContextMenu({
        x: e.clientX,
        y: e.clientY,
        canvasX,
        canvasY,
      });
    }
  }, []);

  // Handle double-click to enter group edit mode
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const state = useDesignerStore.getState();
    if (state.editingGroupId) return; // Already in group edit mode

    // Check if we double-clicked on a group element
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) / state.zoom - state.panX;
    const canvasY = (e.clientY - rect.top) / state.zoom - state.panY;

    // Find the element under the cursor
    // Convert canvasX/Y from canvas-inner coords to page-content coords
    const pageX = canvasX - VIEWPORT_PADDING;
    const pageY = canvasY - VIEWPORT_PADDING;
    for (let i = state.elements.length - 1; i >= 0; i--) {
      const el = state.elements[i];
      if (
        el.visible &&
        !el.locked &&
        el.type === 'group' &&
        pageX >= el.x &&
        pageX <= el.x + el.width &&
        pageY >= el.y &&
        pageY <= el.y + el.height
      ) {
        state.enterGroup(el.id);
        return;
      }
    }
  }, []);

  // Handle viewport mouse down — start rubber band selection or pan
  // This handles clicks on the viewport background (outside the canvas) AND
  // clicks on the canvas background (inside the canvas). Canvas elements call
  // e.stopPropagation(), so clicks on actual elements never reach this handler.
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Clear context menu on any click
    const st = useDesignerStore.getState();
    if (st.contextMenu) {
      st.clearContextMenu();
    }

    // Clear table cell selection when clicking on the canvas background
    // (clicks on actual table cells are handled by TableElementRenderer)
    if (st.selectedTableCells.length > 0) {
      st.clearTableCellSelection();
    }

    // Middle mouse button → always pan
    if (e.button === 1) {
      e.preventDefault();
      useDesignerStore.getState().startPanning(e.clientX, e.clientY);
      return;
    }

    // Left click
    if (e.button === 0) {
      // Space held → already space-panning, just update panStart to prevent jump
      if (spacePressedRef.current) {
        const state = useDesignerStore.getState();
        if (state.isPanning) {
          // Reset panStart to current position to avoid a jump
          useDesignerStore.setState({ panStart: { x: e.clientX, y: e.clientY } });
        }
        return;
      }

      // If a text element is being edited, exit text edit mode first
      const state = useDesignerStore.getState();
      if (state.editingTextElementId) {
        state.setEditingTextElement(null);
      }

      // If in group edit mode and clicking on canvas background, exit group edit mode
      if (state.editingGroupId) {
        // We need to check if the click is outside the group being edited
        const group = state.elements.find((el) => el.id === state.editingGroupId);
        if (group) {
          const viewport = viewportRef.current;
          if (viewport) {
            const rect = viewport.getBoundingClientRect();
            const canvasX = (e.clientX - rect.left) / state.zoom - state.panX;
            const canvasY = (e.clientY - rect.top) / state.zoom - state.panY;
            // Check if click is outside the group bounds
            // Convert canvasX/Y from canvas-inner coords to page-content coords
            const pageX = canvasX - VIEWPORT_PADDING;
            const pageY = canvasY - VIEWPORT_PADDING;
            if (
              pageX < group.x ||
              pageX > group.x + group.width ||
              pageY < group.y ||
              pageY > group.y + group.height
            ) {
              state.exitGroup();
              return;
            }
          }
        }
      }

      // Start rubber band selection from the click position
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const canvasX = (e.clientX - rect.left) / state.zoom - state.panX;
      const canvasY = (e.clientY - rect.top) / state.zoom - state.panY;

      state.startSelection(canvasX, canvasY, e.shiftKey);

      // Capture the pointer so ALL subsequent pointermove / pointerup events are
      // delivered to the viewport element — even when the cursor moves outside the
      // viewport (over panels, menus, etc.).  Combined with cursor clamping, this
      // guarantees the selection rectangle never leaves the workspace area.
      const pointerId = lastPointerIdRef.current;
      if (pointerId !== null) {
        try { viewport.setPointerCapture(pointerId); } catch {}
      }
    }
  }, [spacePressed]);

  // Close context menu when clicking anywhere outside of it (not just on the canvas viewport)
  // This ensures the menu closes when clicking on the tool palette, properties panel, etc.
  useEffect(() => {
    const handleGlobalMouseDown = (e: MouseEvent) => {
      const state = useDesignerStore.getState();
      if (!state.contextMenu) return;

      // Check if the click is inside the context menu itself — if so, don't close it
      const target = e.target as HTMLElement;
      if (target?.closest?.('[data-context-menu]')) return;

      state.clearContextMenu();
    };

    window.addEventListener('mousedown', handleGlobalMouseDown, true);
    return () => {
      window.removeEventListener('mousedown', handleGlobalMouseDown, true);
    };
  }, []);

  // Memoized margin guideline style computations
  const marginGuidelineStyle = useMemo(() => ({
    guideStyle: marginStyle === 'dashed' ? `${marginThickness * 2}px` : 'none' as string,
    guideOpacity: marginOpacity / 100,
  }), [marginStyle, marginThickness, marginOpacity]);

  // Memoized grid pattern background style
  const gridStyle = useMemo(() => ({
    backgroundImage: 'radial-gradient(circle, #d4d4d8 1px, transparent 1px)',
    backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
    backgroundPosition: `${panX * zoom}px ${panY * zoom}px`,
    opacity: 0.4,
  }), [zoom, panX, panY]);

  // Memoized margin guidelines SVG — avoids recalculating on every render
  const marginGuidelines = useMemo(() => {
    if (!marginShow) return null;
    const { guideStyle, guideOpacity } = marginGuidelineStyle;
    const dashArray = guideStyle !== 'none' ? guideStyle : undefined;
    return (
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }}>
        <svg
          className="absolute inset-0 w-full h-full"
          style={{ opacity: guideOpacity }}
        >
          {/* Top margin line */}
          <line
            x1={0} y1={marginTop}
            x2={pageWidth} y2={marginTop}
            stroke={marginColor}
            strokeWidth={marginThickness}
            strokeDasharray={dashArray}
          />
          {/* Bottom margin line */}
          <line
            x1={0} y1={pageHeight - marginBottom}
            x2={pageWidth} y2={pageHeight - marginBottom}
            stroke={marginColor}
            strokeWidth={marginThickness}
            strokeDasharray={dashArray}
          />
          {/* Left margin line */}
          <line
            x1={marginLeft} y1={0}
            x2={marginLeft} y2={pageHeight}
            stroke={marginColor}
            strokeWidth={marginThickness}
            strokeDasharray={dashArray}
          />
          {/* Right margin line */}
          <line
            x1={pageWidth - marginRight} y1={0}
            x2={pageWidth - marginRight} y2={pageHeight}
            stroke={marginColor}
            strokeWidth={marginThickness}
            strokeDasharray={dashArray}
          />
        </svg>
      </div>
    );
  }, [marginShow, marginGuidelineStyle, marginTop, marginBottom, marginLeft, marginRight, marginColor, marginThickness, pageWidth, pageHeight]);

  // Compute normalized selection rect for rendering (handles negative width/height)
  const normalizedSelectionRect = useMemo(() =>
    selectionRect
      ? {
          x: Math.min(selectionRect.x, selectionRect.x + selectionRect.width),
          y: Math.min(selectionRect.y, selectionRect.y + selectionRect.height),
          width: Math.abs(selectionRect.width),
          height: Math.abs(selectionRect.height),
        }
      : null
  , [selectionRect]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-muted/30">
      {/* Top toolbar */}
      <div className="h-11 border-b border-border flex items-center px-3 gap-2 bg-card">
        <button
          onClick={undo}
          disabled={!canUndo}
          className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 className="h-4 w-4" />
        </button>
        <div className="w-px h-5 bg-border" />
        <ZoomControls viewportRef={viewportRef} />
        <div className="w-px h-5 bg-border" />
        <SnapControls />
        <div className="flex-1" />
        <div className="text-xs text-muted-foreground">
          {pageWidth} × {pageHeight}px
        </div>
      </div>

      {/* Canvas viewport */}
      <div
        ref={viewportRef}
        className="canvas-viewport flex-1 overflow-hidden relative select-none"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
        style={{
          // During an active resize / corner-drag, the cursor is locked to the
          // resize arrow (computed in activeResizeCursor) for the entire drag —
          // overriding the default/grabbing cursors so the resize arrow stays
          // even when the mouse drifts off the handle onto the canvas.
          cursor: activeResizeCursor ?? (isPanning || isDragging || isGroupChildDragging ? 'grabbing' : spacePressed ? 'grab' : isSelecting ? 'crosshair' : 'default'),
          // touch-action is now set synchronously via DOM manipulation in the
          // keydown/keyup handlers (see spacePressedRef) for zero-delay response.
          // Setting it here via React state would add a re-render delay.
        }}
      >
        {/* Grid background pattern */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={gridStyle}
        />

        {/* Alt-key cell selection mode indicator */}
        {altHeld && (() => {
          const selEl = elements.find((el: CanvasElement) => selectedElementIds.includes(el.id) && el.type === 'table');
          if (!selEl) return null;
          return (
            <div
              className="absolute top-2 left-1/2 -translate-x-1/2 z-[100001] pointer-events-none"
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.75)',
                color: 'white',
                padding: '3px 10px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 500,
                letterSpacing: '0.02em',
                boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                whiteSpace: 'nowrap',
              }}
            >
              {selectedTableCells.length > 0
                ? `${selectedTableCells.length} cell${selectedTableCells.length > 1 ? 's' : ''} selected — Click to toggle · Drag to toggle range`
                : 'Click to select cells · Drag to multi-select · Click again to deselect'}
            </div>
          );
        })()}

        {/* Canvas container with pan/zoom.
            ── Why `zoom` instead of `transform: scale()` ──
            `transform: scale(zoom)` promotes the layer to a GPU compositing
            texture which the browser rasterizes at the SCALED (reduced)
            resolution when zooming out, then downsamples — this softens text
            and thins/aliases borders (visible quality drop). The CSS `zoom`
            property instead makes the browser re-lay-out and re-rasterize every
            descendant (text, SVG, borders) at the actual target resolution, so
            rendering stays pixel-perfect at every zoom level (zero quality
            drop). Panning is kept as a `transform: translate` on the outer
            wrapper (in screen px) so the existing pan math is unchanged; the
            `zoom` lives on the inner wrapper so the two don't interfere. */}
        <div
          className="canvas-inner absolute"
          style={{
            transform: `translate(${panX * zoom}px, ${panY * zoom}px)`,
            transformOrigin: '0 0',
            width: '1px',
            height: '1px',
            transition: isAutoPanning ? 'transform 450ms cubic-bezier(0.25, 1, 0.5, 1)' : undefined,
          }}
        >
          <div
            className="canvas-zoom"
            style={{
              zoom: zoom,
              width: '1px',
              height: '1px',
            }}
          >
          {/* A4-like page background */}
          <div
            className="a4-page relative shadow-lg select-none"
            style={{
              width: pageWidth,
              height: pageHeight,
              margin: `${VIEWPORT_PADDING}px`,
              border: '1px solid #e5e7eb',
              borderRadius: '2px',
              backgroundColor: pageBackgroundColor,
            }}
          >
            {/* Margin guidelines — rendered below elements but above page background */}
            {marginGuidelines}

            {/* Group edit mode indicator — dashed border around the group being edited */}
            {editingGroupId && (() => {
              const group = elements.find((el) => el.id === editingGroupId);
              if (!group) return null;
              return (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: group.x - 4,
                    top: group.y - 4,
                    width: group.width + 8,
                    height: group.height + 8,
                    border: '2px dashed #ec4899',
                    borderRadius: 4,
                    zIndex: 9998,
                    opacity: 0.6,
                  }}
                />
              );
            })()}

            {/* Render elements — DOM order determines z-order (later = on top) */}
            <div style={{ position: 'relative', zIndex: 2 }}>
              {elements.map((element) => (
                <CanvasElementComponent key={element.id} element={element} />
              ))}
            </div>

            {/* Alignment guidelines — rendered above all elements */}
            {alignmentGuidelines.length > 0 && (
              <div className="alignment-guide-layer absolute inset-0 pointer-events-none" style={{ zIndex: 9999 }}>
                <svg className="absolute inset-0 w-full h-full" style={{ overflow: 'visible' }}>
                  {alignmentGuidelines.map((guide: AlignmentGuide, i: number) => {
                    if (guide.orientation === 'vertical') {
                      return (
                        <line
                          key={`v-${i}`}
                          x1={guide.position}
                          y1={guide.start}
                          x2={guide.position}
                          y2={guide.end}
                          stroke="#f43f5e"
                          strokeWidth={1}
                          strokeDasharray="4,3"
                          shapeRendering="crispEdges"
                        />
                      );
                    } else {
                      return (
                        <line
                          key={`h-${i}`}
                          x1={guide.start}
                          y1={guide.position}
                          x2={guide.end}
                          y2={guide.position}
                          stroke="#f43f5e"
                          strokeWidth={1}
                          strokeDasharray="4,3"
                          shapeRendering="crispEdges"
                        />
                      );
                    }
                  })}
                </svg>
              </div>
            )}

            {/* Angle snap indicator — shown near the dragged endpoint when angle snapping is active */}
            {angleSnapInfo && (() => {
              const selectedEl = elements.find((el) => el.id === selectedElementId);
              if (!selectedEl || selectedEl.type !== 'line') return null;
              const draggingEndpoint = useDesignerStore.getState().draggingEndpoint;
              const tipX = draggingEndpoint === 'start'
                ? (selectedEl.lineStartX ?? selectedEl.x)
                : (selectedEl.lineEndX ?? (selectedEl.x + selectedEl.width));
              const tipY = draggingEndpoint === 'start'
                ? (selectedEl.lineStartY ?? selectedEl.y)
                : (selectedEl.lineEndY ?? selectedEl.y);
              return (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: tipX + 14,
                    top: tipY - 24,
                    zIndex: 10000,
                  }}
                >
                  <div className="bg-primary text-primary-foreground text-[11px] font-mono px-2 py-1 rounded-md shadow-lg whitespace-nowrap">
                    {angleSnapInfo.label}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Rubber band selection rectangle — rendered at canvas-inner level so
              coordinates match the canvas coordinate system. Cursor is clamped to
              viewport boundaries during drag, so the rect never leaves the workspace. */}
          {isSelecting && normalizedSelectionRect && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: normalizedSelectionRect.x,
                top: normalizedSelectionRect.y,
                width: normalizedSelectionRect.width,
                height: normalizedSelectionRect.height,
                border: '1.5px dashed #ec4899',
                backgroundColor: 'rgba(236, 72, 153, 0.1)',
                zIndex: 99998,
              }}
            />
          )}

          {/* On-canvas shortcuts — written on the workspace in canvas-world
              coordinates (INSIDE the pan/zoom transform), to the right of the
              page. So it pans and zooms WITH the canvas, behaving like canvas
              content. pointer-events-none. */}
          <ShortcutsOverlay
            pageWidth={pageWidth}
            pageHeight={pageHeight}
          />
          </div>
        </div>
      </div>

      {/* Right-click context menu — rendered at viewport level */}
      {contextMenu && (() => {
        const state = useDesignerStore.getState();
        const hasSelection = state.selectedElementIds.length >= 1;
        const hasClipboard = state.clipboardElement !== null || state.clipboardElements.length > 0;
        const showGroup = state.selectedElementIds.length >= 2 && state.canGroup();
        const showUngroup = state.selectedElementIds.length === 1 && state.canUngroup();
        if (!hasSelection) return null;
        return (
          <div
            data-context-menu
            className="fixed bg-popover border border-border rounded-md shadow-lg py-1 z-[100000] min-w-[160px]"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors text-left"
              onClick={() => {
                useDesignerStore.getState().cutElement();
                useDesignerStore.getState().clearContextMenu();
              }}
            >
              <Scissors className="h-3.5 w-3.5" />
              Cut
              <span className="ml-auto text-xs text-muted-foreground">Ctrl+X</span>
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors text-left"
              onClick={() => {
                useDesignerStore.getState().copyElement();
                useDesignerStore.getState().clearContextMenu();
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
              <span className="ml-auto text-xs text-muted-foreground">Ctrl+C</span>
            </button>
            <button
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors text-left ${!hasClipboard ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                useDesignerStore.getState().pasteElement();
                useDesignerStore.getState().clearContextMenu();
              }}
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
              Paste
              <span className="ml-auto text-xs text-muted-foreground">Ctrl+V</span>
            </button>
            <button
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors text-left ${!hasClipboard ? 'opacity-40 pointer-events-none' : ''}`}
              onClick={() => {
                useDesignerStore.getState().pasteElementInPlace();
                useDesignerStore.getState().clearContextMenu();
              }}
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              Paste in Place
              <span className="ml-auto text-xs text-muted-foreground">Ctrl+⇧+V</span>
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors text-left"
              onClick={() => {
                const st = useDesignerStore.getState();
                if (st.selectedElementId) st.duplicateElement(st.selectedElementId);
                st.clearContextMenu();
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              Duplicate
              <span className="ml-auto text-xs text-muted-foreground">Ctrl+D</span>
            </button>
            <div className="my-1 border-t border-border" />
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors text-left text-destructive"
              onClick={() => {
                const st = useDesignerStore.getState();
                for (const id of [...st.selectedElementIds]) {
                  st.removeElement(id);
                }
                st.clearContextMenu();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
              <span className="ml-auto text-xs text-muted-foreground">Del</span>
            </button>
            {(showGroup || showUngroup) && <div className="my-1 border-t border-border" />}
            {showGroup && (
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors text-left"
                onClick={() => {
                  useDesignerStore.getState().groupSelected();
                  useDesignerStore.getState().clearContextMenu();
                }}
              >
                <Group className="h-3.5 w-3.5" />
                Group
                <span className="ml-auto text-xs text-muted-foreground">Ctrl+G</span>
              </button>
            )}
            {showUngroup && (
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors text-left"
                onClick={() => {
                  useDesignerStore.getState().ungroupSelected();
                  useDesignerStore.getState().clearContextMenu();
                }}
              >
                <Ungroup className="h-3.5 w-3.5" />
                Ungroup
                <span className="ml-auto text-xs text-muted-foreground">Ctrl+Shift+G</span>
              </button>
            )}
          </div>
        );
      })()}

      {/* Spotlight Property Picker Overlay */}
      {selectedElementIds.length > 0 && (() => {
        const el = findElementById(selectedElementIds[0]);
        return el ? <SpotlightOverlay element={el} multiSelectIds={selectedElementIds} /> : null;
      })()}

      {/* Predefined Blocks Picker Overlay */}
      <PredefinedBlocksOverlay />

      {/* Floating Property Cards */}
      <FloatingCardsManager boundsRef={viewportRef} />
    </div>
  );
}
