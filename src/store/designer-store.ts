import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import {
  CanvasElement,
  ElementType,
  getDefaultProperties,
  getDefaultSize,
  getDefaultName,
  ElementProperties,
  computeLineBounds,
  TableProperties,
  RectangleProperties,
  getRectRotation,
  normalizeAngle,
} from '@/lib/element-types';
import { ensureColWidths, ensureRowHeights } from '@/lib/table-helpers';
import {
  hasCustomCorners,
  getRectCornerPoints,
  initRectCornerPointsFromBBox,
  bboxOfPoints,
  scaleCornerPoints,
  resizeCornerPointsByEdges,
  resizeRotatedCornerPoints,
  translateCornerPoints,
  CORNER_HANDLE_MAP,
  horizontalAlignPartnerIndex,
  verticalAlignPartnerIndex,
  type Point,
} from '@/lib/rectangle-corners';
import { PREDEFINED_BLOCKS } from '@/lib/predefined-blocks';
import { AlignmentGuide, calculateSnapForPosition, calculateSnapForResize, calculateSnapForEndpointDrag, flattenElementsForSnap, invalidateSnapCache, getElementBorderWidth } from '@/lib/snapping';
import {
  serializeProject,
  deserializeProject,
  saveProjectToFile,
  saveProjectAsWithDialog,
  saveProjectToHandle,
  openProjectWithDialog,
  loadProjectFromFile,
  ProjectFile,
  APP_VERSION,
} from '@/lib/project-file';
import { clearAutosave } from '@/lib/autosave';
import { toast } from '@/hooks/use-toast';

const VIEWPORT_PADDING = 40;

// Module-level timers for the store's fire-and-forget UI animations (auto-pan
// flag clear, alignment-guideline clear). Tracked so a new invocation cancels
// any pending one from the previous invocation — prevents timer accumulation
// when actions are triggered rapidly (e.g. repeated alignment clicks).
let autoPanTimer: ReturnType<typeof setTimeout> | null = null;
let alignmentGuidelineTimer: ReturnType<typeof setTimeout> | null = null;

// Horizontal centering ratio for fit-to-page. Instead of dead-center (0.5), the
// page is centered at 45% of the viewport width so it nudges slightly toward
// the left tool panel — leaving a little more room on the right for the
// shortcuts overlay. Vertical centering stays at 0.5.
const HORIZONTAL_CENTER_RATIO = 0.45;

// ── Re-ID element helper ────────────────────────────────────────────────────
// When duplicating/pasting an element (especially a group), we must assign new
// UUIDs to the element AND all of its children to avoid duplicate IDs in the
// element tree.  Duplicate IDs cause lookups (findElementById, findParentGroup)
// to return the wrong element.
function reIdElement(element: CanvasElement): CanvasElement {
  const result: CanvasElement = {
    ...element,
    id: uuidv4(),
    // Deep-copy cornerPoints so duplicates/pastes have independent corners
    // (a shallow copy would share the array reference with the source).
    ...(element.cornerPoints
      ? { cornerPoints: element.cornerPoints.map((p) => ({ x: p.x, y: p.y })) }
      : {}),
  };
  if (result.type === 'group' && result.children) {
    result.children = result.children.map((c) => reIdElement(c));
  }
  return result;
}

// ── Line–Rectangle intersection ────────────────────────────────────────────
// Used by marquee selection to accurately test whether a line element
// intersects the selection rectangle, rather than relying on the line's
// bounding box which can be much larger than the visible line itself.

/** Check if point (px, py) lies inside the axis-aligned rect [l,t,r,b]. */
function pointInRect(px: number, py: number, l: number, t: number, r: number, b: number): boolean {
  return px >= l && px <= r && py >= t && py <= b;
}

/** Return the cross product of vectors (p1→p2) × (p1→p3). */
function cross(p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number): number {
  return (p2x - p1x) * (p3y - p1y) - (p2y - p1y) * (p3x - p1x);
}

/**
 * Check whether the line segment (x1,y1)→(x2,y2) intersects the
 * axis-aligned rectangle [left, top, right, bottom].
 *
 * Algorithm:
 *  1. If either endpoint is inside the rect → intersect.
 *  2. Test intersection of the segment against each of the 4 rectangle
 *     edges using the separating-axis (cross-product) test.
 */
function lineIntersectsRect(
  x1: number, y1: number, x2: number, y2: number,
  left: number, top: number, right: number, bottom: number,
): boolean {
  // Quick check: either endpoint inside the rect
  if (pointInRect(x1, y1, left, top, right, bottom)) return true;
  if (pointInRect(x2, y2, left, top, right, bottom)) return true;

  // Check intersection with each of the 4 edges of the rectangle
  // Top edge: (left,top)→(right,top)
  if (segmentsIntersect(x1, y1, x2, y2, left, top, right, top)) return true;
  // Bottom edge: (left,bottom)→(right,bottom)
  if (segmentsIntersect(x1, y1, x2, y2, left, bottom, right, bottom)) return true;
  // Left edge: (left,top)→(left,bottom)
  if (segmentsIntersect(x1, y1, x2, y2, left, top, left, bottom)) return true;
  // Right edge: (right,top)→(right,bottom)
  if (segmentsIntersect(x1, y1, x2, y2, right, top, right, bottom)) return true;

  return false;
}

/**
 * Check whether two line segments (ax1,ay1)→(ax2,ay2) and
 * (bx1,by1)→(bx2,by2) properly intersect (crossing each other,
 * not just touching at endpoints).
 */
function segmentsIntersect(
  ax1: number, ay1: number, ax2: number, ay2: number,
  bx1: number, by1: number, bx2: number, by2: number,
): boolean {
  const d1 = cross(bx1, by1, bx2, by2, ax1, ay1);
  const d2 = cross(bx1, by1, bx2, by2, ax2, ay2);
  const d3 = cross(ax1, ay1, ax2, ay2, bx1, by1);
  const d4 = cross(ax1, ay1, ax2, ay2, bx2, by2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  // Collinear / endpoint-touching cases — treat as non-intersecting for
  // marquee selection purposes (the endpoint-inside-rect check above
  // already handles the case where a line endpoint is inside the rect).
  return false;
}

// ── Undo / Redo ────────────────────────────────────────────────────────────
const MAX_UNDO_HISTORY = 50;

/** Subset of store state that represents a "document" snapshot for undo/redo. */
interface HistorySnapshot {
  elements: CanvasElement[];
  elementCounter: Record<ElementType, number>;
  canvasSettings: CanvasSettings;
}

function takeSnapshot(state: {
  elements: CanvasElement[];
  elementCounter: Record<ElementType, number>;
  canvasSettings: CanvasSettings;
}): HistorySnapshot {
  return {
    elements: structuredClone(state.elements),
    elementCounter: { ...state.elementCounter },
    canvasSettings: structuredClone(state.canvasSettings),
  };
}

// Debounce state for property update undo pushes.
// Prevents flooding the undo stack when sliders or text inputs fire many rapid changes.
let propertyUndoTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPropertySnapshot: HistorySnapshot | null = null;
const PROPERTY_UNDO_DEBOUNCE_MS = 400;

/** Internal helper: push a snapshot onto the undo stack and clear redo. */
function commitSnapshotToUndo(snapshot: HistorySnapshot) {
  const current = useDesignerStore.getState();
  const newUndoStack = [...current.undoStack, snapshot];
  if (newUndoStack.length > MAX_UNDO_HISTORY) newUndoStack.shift();
  useDesignerStore.setState({
    undoStack: newUndoStack,
    redoStack: [],
    canUndo: true,
    canRedo: false,
  });
}

/** Push a debounced undo snapshot for property changes.
 *  The first call captures the "before" state, immediately clears the redo
 *  stack and updates canUndo/canRedo so the UI stays consistent. Subsequent
 *  calls within the debounce window are absorbed. When the timer fires, the
 *  snapshot is pushed onto the undo stack. */
function debouncedPropertyPushUndo(
  state: { elements: CanvasElement[]; elementCounter: Record<ElementType, number>; canvasSettings: CanvasSettings },
) {
  if (propertyUndoTimer === null) {
    // First call in a new interaction — capture the BEFORE state immediately
    pendingPropertySnapshot = takeSnapshot(state);
    // Immediately clear redo stack & update flags so the UI is consistent
    // from the moment the first property change happens.
    useDesignerStore.setState({
      redoStack: [],
      canRedo: false,
      canUndo: true, // the pending snapshot guarantees at least one undo step
    });
  }
  // Reset the debounce timer
  if (propertyUndoTimer) clearTimeout(propertyUndoTimer);
  propertyUndoTimer = setTimeout(() => {
    if (pendingPropertySnapshot !== null) {
      // Push the captured "before" snapshot
      commitSnapshotToUndo(pendingPropertySnapshot);
      pendingPropertySnapshot = null;
    }
    propertyUndoTimer = null;
  }, PROPERTY_UNDO_DEBOUNCE_MS);
}

/** Immediately flush any pending debounced undo entry (call before non-debounced actions).
 *  Returns true if a pending snapshot was committed. */
function flushPropertyUndo(): boolean {
  if (propertyUndoTimer !== null) {
    clearTimeout(propertyUndoTimer);
    if (pendingPropertySnapshot !== null) {
      commitSnapshotToUndo(pendingPropertySnapshot);
      pendingPropertySnapshot = null;
    }
    propertyUndoTimer = null;
    return true;
  }
  return false;
}

/** Cancel any pending debounced undo entry WITHOUT committing it.
 *  Used when undo/redo is invoked — the pending "before" state is already
 *  what the user wants to go back to, so we don't need to push it. */
function cancelPropertyUndo() {
  if (propertyUndoTimer !== null) {
    clearTimeout(propertyUndoTimer);
    pendingPropertySnapshot = null;
    propertyUndoTimer = null;
  }
}

/**
 * Pure recursive helper: returns a NEW elements tree with the properties of the
 * element identified by `id` replaced. Searches both top-level elements and the
 * `children` arrays of groups (arbitrarily deep, matching `findElementById`).
 *
 * Unlike the `updateElementProperties` store action, this is side-effect-free —
 * no undo snapshot is captured — so it is safe to call on every mousemove of a
 * drag whose undo entry was already pushed at drag start (e.g. table resize).
 */
function setElementPropertiesInTree(
  elements: CanvasElement[],
  id: string,
  properties: ElementProperties,
): CanvasElement[] {
  const updateChildren = (children: CanvasElement[]): CanvasElement[] => {
    const idx = children.findIndex((c) => c.id === id);
    if (idx !== -1) {
      const next = [...children];
      next[idx] = { ...next[idx], properties };
      return next;
    }
    // Recurse into nested groups (groups are normally single-level here, but
    // recurse anyway to stay consistent with findElementById).
    let changed = false;
    const maybeDeeper = children.map((c) => {
      if (c.type === 'group' && c.children) {
        const newGrand = updateChildren(c.children);
        if (newGrand !== c.children) {
          changed = true;
          return { ...c, children: newGrand };
        }
      }
      return c;
    });
    return changed ? maybeDeeper : children;
  };

  let changed = false;
  const result = elements.map((el) => {
    if (el.id === id) {
      changed = true;
      return { ...el, properties };
    }
    if (el.type === 'group' && el.children) {
      const newChildren = updateChildren(el.children);
      if (newChildren !== el.children) {
        changed = true;
        return { ...el, children: newChildren };
      }
    }
    return el;
  });
  return changed ? result : elements;
}
// ────────────────────────────────────────────────────────────────────────────

// Page size presets
export interface PageSizePreset {
  label: string;
  width: number;
  height: number;
}

export const PAGE_SIZE_PRESETS: PageSizePreset[] = [
  { label: 'A4 (210 × 297 mm)', width: 794, height: 1123 },
  { label: 'A5 (148 × 210 mm)', width: 559, height: 794 },
  { label: 'Letter (8.5 × 11 in)', width: 816, height: 1056 },
  { label: 'Legal (8.5 × 14 in)', width: 816, height: 1344 },
  { label: 'Custom', width: 794, height: 1123 },
];

// Margin presets
export type MarginPreset = 'none' | 'narrow' | 'normal' | 'wide' | 'custom';

export const MARGIN_PRESETS: Record<Exclude<MarginPreset, 'custom'>, { top: number; bottom: number; left: number; right: number }> = {
  none: { top: 0, bottom: 0, left: 0, right: 0 },
  narrow: { top: 25, bottom: 25, left: 25, right: 25 },
  normal: { top: 50, bottom: 50, left: 50, right: 50 },
  wide: { top: 80, bottom: 80, left: 80, right: 80 },
};

export interface MarginGuidelineSettings {
  show: boolean;
  color: string;
  thickness: number;
  style: 'solid' | 'dashed';
  opacity: number;
}

export interface CanvasSettings {
  pageWidth: number;
  pageHeight: number;
  pageBackgroundColor: string;
  marginPreset: MarginPreset;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  marginGuideline: MarginGuidelineSettings;
}

// Zoom step presets (in percentage points)
export const ZOOM_STEP_PRESETS = [
  { label: '1%', value: 1 },
  { label: '5%', value: 5 },
  { label: '10%', value: 10 },
  { label: '20%', value: 20 },
  { label: '50%', value: 50 },
];

// Multi-drag start info — stores initial positions of elements for multi-element drag
export interface DragStartInfo {
  x: number;
  y: number;
  lineStartX?: number;
  lineStartY?: number;
  lineEndX?: number;
  lineEndY?: number;
  // Snapshot of rectangle corner points (absolute) at drag start, so the
  // whole deformed shape translates together with the element during drag.
  cornerPoints?: { x: number; y: number }[];
}

interface DesignerState {
  elements: CanvasElement[];
  selectedElementIds: string[];
  /** @deprecated Backward-compatible getter — returns selectedElementIds[0] or null */
  selectedElementId: string | null;
  zoom: number;
  panX: number;
  panY: number;
  isPanning: boolean;
  isAutoPanning: boolean;
  panStart: { x: number; y: number } | null;
  isDragging: boolean;
  dragStart: { x: number; y: number; elementX: number; elementY: number } | null;
  dragMoved: boolean; // tracks whether mouse actually moved during drag (vs. click)
  dragClickedElementId: string | null; // the element clicked to start the drag (for click-to-deselect)
  isResizing: boolean;
  resizeHandle: string | null;
  resizeStart: { x: number; y: number; elementX: number; elementY: number; elementW: number; elementH: number; originalChildren?: CanvasElement[]; origCornerPoints?: { x: number; y: number }[] } | null;
  // Multi-element resize state — stores the unified bounding box and per-element
  // offset ratios so that resizing proportionally scales all selected elements.
  multiResizeData: {
    bbox: { x: number; y: number; width: number; height: number }; // original unified bbox
    elements: Array<{
      id: string;
      origX: number; origY: number; origW: number; origH: number;
      // Ratio of element's position relative to bbox (0 = left/top edge, 1 = right/bottom edge)
      rx: number; ry: number; rw: number; rh: number;
      // Line endpoint offsets (for line elements)
      lineStartX?: number; lineStartY?: number; lineEndX?: number; lineEndY?: number;
      // Original corner points (absolute) for deformed rectangles
      origCornerPoints?: { x: number; y: number }[];
      // Original children for group elements
      originalChildren?: CanvasElement[];
    }>;
  } | null;

  // Endpoint dragging (for line elements)
  isEndpointDragging: boolean;
  draggingEndpoint: 'start' | 'end' | null;
  endpointDragStart: { x: number; y: number; startX: number; startY: number; endX: number; endY: number } | null;

  // ── Rectangle corner dragging (independent corner manipulation) ────────────
  // When the user Alt-drags a corner handle of a selected rectangle, that
  // corner moves independently while the other three stay fixed, producing a
  // custom quadrilateral. Alt+Shift constrains movement to horizontal/vertical.
  isCornerDragging: boolean;
  draggingCornerIndex: number | null; // 0=TL, 1=TR, 2=BR, 3=BL
  cornerDragStart: {
    x: number; // mouse start (client)
    y: number;
    elementId: string;
    // Snapshot of all 4 corner points (absolute) at drag start
    origCorners: { x: number; y: number }[];
    // The original bbox at drag start (element.x/y/w/h) — used to recompute bbox
    origBbox: { x: number; y: number; width: number; height: number };
    // The rectangle's rotation in degrees at drag start. The corner points are
    // stored in UNROTATED (local) space and the renderer applies rotate(θ) on
    // top — so a screen-space mouse delta must be transformed by R(-θ) before
    // being added to a corner point, otherwise the visual corner moves at the
    // wrong angle (e.g. a horizontal drag moves the corner at 45° when θ=45°).
    rotation: number;
  } | null;
  // Live preview of corner points during an active corner drag — updated on
  // every mousemove WITHOUT mutating the elements array. This lets the dragged
  // rectangle's renderer subscribe to just this field (via a selector) so only
  // THAT rectangle re-renders, instead of the whole canvas re-rendering on
  // every elements-array change. The final position is committed to elements[]
  // in stopCornerDrag.
  cornerDragPreview: { elementId: string; corners: { x: number; y: number }[] } | null;

  // Table column/row resize dragging
  isTableColResizing: boolean;
  isTableRowResizing: boolean;
  tableResizeData: {
    elementId: string;
    type: 'col' | 'row';
    index: number;  // the index of the col/row BEFORE the border
    initialMousePos: number;  // clientX for col, clientY for row
    initialSizes: number[];  // initial colWidths or rowHeights
    initialTotalSize: number;  // element.width for col, element.height for row
  } | null;

  // Shift-held state for angle snapping during endpoint drag
  shiftHeld: boolean;

  // Ctrl-held state for vertical corner alignment during Alt+Ctrl corner drag.
  // Mirrors shiftHeld (which drives Alt+Shift horizontal alignment). Set by a
  // window-level keydown/keyup listener in canvas.tsx.
  ctrlHeld: boolean;

  // ── Alt-held state for table cell multi-selection ──────────────────────────
  // When Alt is held and the selected element is a table, the user can
  // right-click to select individual cells or click-drag to select a
  // rectangular range of cells on the canvas.
  altHeld: boolean;
  selectedTableCells: { row: number; col: number }[];
  hoveredTableCell: { row: number; col: number; tableId: string } | null;
  isTableCellSelecting: boolean; // true while Alt+dragging on a table
  tableCellSelectStart: { row: number; col: number } | null; // drag start cell
  tableCellSelectEnd: { row: number; col: number } | null; // current drag end cell
  tableCellSelectTableId: string | null; // which table is being selected on
  tableCellSelectBaseline: { row: number; col: number }[]; // snapshot of selection before drag started (for toggle-in-drag)

  // Angle snap visual feedback (null when not snapping)
  angleSnapInfo: { angle: number; label: string } | null;

  // Multi-element selection state
  isSelecting: boolean;
  selectionRect: { x: number; y: number; width: number; height: number } | null;
  selectionAdditive: boolean; // true when Shift was held when rubber-band selection started
  multiDragStart: Record<string, DragStartInfo>;

  elementCounter: Record<ElementType, number>;
  clipboardElement: CanvasElement | null; // single-element clipboard (deprecated — kept for backward compat)
  clipboardElements: CanvasElement[]; // multi-element clipboard

  // ── Group Edit Mode ──────────────────────────────────────────────────────
  // When a group is being edited (double-clicked into), this stores the
  // group element's ID. Null means we are at root level.
  editingGroupId: string | null;

  // ── Text Editing ──────────────────────────────────────────────────────
  // When a text element is being edited (double-clicked), this stores the
  // element's ID. Null means no text element is being edited.
  // The TipTap editor renders inline on the canvas when editing.
  // Formatting controls live in the properties panel / floating card.
  editingTextElementId: string | null;
  setEditingTextElement: (id: string | null) => void;
  // Reference to the active TipTap Editor instance on the canvas.
  // This allows the panel/floating-card formatting toolbar to control
  // the canvas editor (apply bold, italic, etc. to selected text).
  // Use `any` to avoid importing TipTap types in the store.
  activeTextEditor: any; // TipTap Editor instance or null
  setActiveTextEditor: (editor: any) => void;

  // Group child drag state
  isGroupChildDragging: boolean;
  groupChildDragStart: { x: number; y: number; originalGroupX: number; originalGroupY: number } | null;
  groupChildMultiDragStart: Record<string, DragStartInfo>;

  // Group child resize state
  isGroupChildResizing: boolean;
  groupChildResizeStart: { x: number; y: number; childX: number; childY: number; childW: number; childH: number; groupX: number; groupY: number; originalChildren: CanvasElement[] } | null;

  // ── Spotlight Property Picker (Shift+S) ────────────────────────────────────
  spotlightOpen: boolean;
  floatingCards: FloatingCardData[];
  propertyDisplayMode: PropertyDisplayMode;
  spotlightHintShown: number; // counts how many times the Shift+S hint has been shown

  // ── Panel collapse state (responsive — desktop collapsible panels) ──────
  // When collapsed, a side panel animates to width 0 (still mounted) so the
  // canvas reclaims the space. Toggled from header buttons.
  toolPaletteCollapsed: boolean;
  propsPanelCollapsed: boolean;

  // ── Predefined Blocks Picker (Shift+Q) ────────────────────────────────────
  predefinedBlocksOpen: boolean;

  // ── Context Menu ────────────────────────────────────────────────────────
  contextMenu: { x: number; y: number; canvasX: number; canvasY: number } | null;

  canvasSettings: CanvasSettings;
  settingsOpen: boolean;
  newProjectOpen: boolean;
  registerIconOpen: boolean;
  exportPdfOpen: boolean;
  // Whether the welcome (create/open project) modal is currently showing.
  // Feature shortcuts (Shift+S spotlight, Shift+Q predefined blocks) are
  // disabled while this is true — the user has no project yet, so opening
  // those overlays over the modal would be confusing.
  welcomeModalOpen: boolean;

  // PDF preview modal
  largePreviewOpen: boolean;

  // Zoom step (in percent: 1, 5, 10, 20, 50, or custom)
  zoomStep: number;

  // Snapping settings
  snapEnabled: boolean;
  snapToGrid: boolean;
  snapToElements: boolean;
  snapUnit: number; // grid unit in px

  // Alignment guidelines (rendered on canvas during drag/arrow move)
  alignmentGuidelines: AlignmentGuide[];

  // Undo / Redo
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
  canUndo: boolean;
  canRedo: boolean;

  // Last added element ID (for drop animation)
  lastAddedElementId: string | null;
  clearLastAddedElementId: () => void;

  // Actions
  addElement: (type: ElementType, x: number, y: number) => void;
  removeElement: (id: string) => void;
  updateElement: (id: string, updates: Partial<CanvasElement>) => void;
  updateElementProperties: (id: string, properties: ElementProperties) => void;
  selectElement: (id: string | null) => void;
  addToSelection: (id: string) => void;
  toggleInSelection: (id: string) => void;
  clearSelection: () => void;
  selectAll: () => void;
  startSelection: (x: number, y: number, additive?: boolean) => void;
  updateSelection: (x: number, y: number) => void;
  finishSelection: () => void;
  getSelectedElement: () => CanvasElement | null;
  duplicateElement: (id: string) => void;
  moveElement: (id: string, x: number, y: number) => void;
  resizeElement: (id: string, width: number, height: number) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  panToElement: (elementId: string) => void;
  startPanning: (x: number, y: number) => void;
  stopPanning: () => void;
  updatePan: (x: number, y: number) => void;
  startDragging: (id: string, x: number, y: number) => void;
  stopDragging: () => void;
  updateDrag: (x: number, y: number) => void;
  startResizing: (id: string, handle: string, x: number, y: number) => void;
  stopResizing: () => void;
  updateResize: (x: number, y: number) => void;
  startEndpointDrag: (id: string, endpoint: 'start' | 'end', x: number, y: number) => void;
  updateEndpointDrag: (x: number, y: number, shiftHeld: boolean) => void;
  stopEndpointDrag: () => void;
  setShiftHeld: (held: boolean) => void;
  setCtrlHeld: (held: boolean) => void;

  // Rectangle corner manipulation (independent corner deformation)
  startCornerDrag: (id: string, cornerIndex: number, x: number, y: number) => void;
  updateCornerDrag: (x: number, y: number, shiftHeld: boolean, ctrlHeld?: boolean) => void;
  stopCornerDrag: () => void;
  /** Reset a deformed rectangle back to its axis-aligned bounding box. */
  resetRectCorners: (id: string) => void;

  // ── Rectangle rotation ─────────────────────────────────────────────────
  // Only rectangles support rotation (per spec). Rotation is set directly
  // from the properties panel / floating card (slider + numeric input) via
  // setRectRotation — there is no canvas rotation handle. The angle is
  // normalized to [-180, 180] on write so the displayed value stays bounded.
  /** Set a rectangle's rotation directly (used by the properties panel). */
  setRectRotation: (id: string, angle: number) => void;

  // Alt-held & table cell selection actions
  setAltHeld: (held: boolean) => void;
  setHoveredTableCell: (cell: { row: number; col: number; tableId: string } | null) => void;
  selectTableCell: (tableId: string, row: number, col: number, toggle?: boolean) => void;
  selectTableCellsRange: (tableId: string, startRow: number, startCol: number, endRow: number, endCol: number) => void;
  startTableCellSelecting: (tableId: string, row: number, col: number, baseline?: { row: number; col: number }[]) => void;
  updateTableCellSelecting: (row: number, col: number) => void;
  finishTableCellSelecting: () => void;
  clearTableCellSelection: () => void;

  // Table column/row resize actions
  startTableColResize: (elementId: string, colIndex: number, clientX: number) => void;
  startTableRowResize: (elementId: string, rowIndex: number, clientY: number) => void;
  updateTableResize: (clientX: number, clientY: number) => void;
  stopTableResize: () => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  copyElement: () => void;
  pasteElement: () => void;
  cutElement: () => void;
  pasteElementInPlace: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  zoomAtPoint: (newZoom: number, pivotX: number, pivotY: number) => void;
  toggleLock: (id: string) => void;
  toggleVisibility: (id: string) => void;
  updateCanvasSettings: (settings: Partial<CanvasSettings>) => void;
  setSettingsOpen: (open: boolean) => void;
  setZoomStep: (step: number) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setSnapToGrid: (enabled: boolean) => void;
  setSnapToElements: (enabled: boolean) => void;
  setSnapUnit: (unit: number) => void;
  setAlignmentGuidelines: (guides: AlignmentGuide[]) => void;
  clearAlignmentGuidelines: () => void;
  moveElementByKeys: (dx: number, dy: number, skipSnap?: boolean) => void;
  alignElementHorizontalCenter: (id: string) => void;
  alignElementVerticalCenter: (id: string) => void;
  /**
   * Align a GROUP of elements to the page center as a block — preserves the
   * relative positions of all selected elements (shifts them all by the same
   * delta) rather than collapsing each element's center to the page center.
   * Mirrors how a grouped element aligns.
   */
  alignElementsHorizontalCenter: (ids: string[]) => void;
  alignElementsVerticalCenter: (ids: string[]) => void;
  /** Set the top-level opacity on multiple elements at once (multi-select & groups). */
  setElementsOpacity: (ids: string[], opacity: number) => void;
  reorderElement: (fromIndex: number, toIndex: number) => void;
  undo: () => void;
  redo: () => void;
  /** Push current state onto undo stack (call before mutating document state). */
  pushUndo: () => void;
  /** Flush any pending debounced property undo entry immediately. */
  flushPropertyUndo: () => void;

  // Multi-select alignment actions
  alignElementsLeft: () => void;
  alignElementsRight: () => void;
  alignElementsTop: () => void;
  alignElementsBottom: () => void;
  alignElementsCenterH: () => void;
  alignElementsCenterV: () => void;
  distributeElementsH: () => void;
  distributeElementsV: () => void;

  // View
  showMiniPreview: boolean;
  setShowMiniPreview: (show: boolean) => void;
  // On-canvas shortcuts overlay (the muted instruction text on the right side
  // of the workspace). Toggled from the footer.
  shortcutsOverlayVisible: boolean;
  setShortcutsOverlayVisible: (visible: boolean) => void;
  // Per-element "ⓘ" info icons shown above dropped tools on the canvas.
  // Toggled from the footer. Clicking an icon opens ToolInfoDialog.
  toolInfoIconsVisible: boolean;
  setToolInfoIconsVisible: (visible: boolean) => void;
  // Which tool type's info dialog is currently open (null = closed).
  toolInfoElementType: ElementType | null;
  setToolInfoElementType: (type: ElementType | null) => void;
  fitToPage: (viewportWidth: number, viewportHeight: number) => void;

  // Project save/load
  projectName: string;
  lastSaveFilename: string | null;
  fileHandle: FileSystemFileHandle | null;
  isDirty: boolean;
  saveProject: () => Promise<void>;
  saveProjectAs: () => Promise<void>;
  loadProject: () => Promise<boolean>;
  newProject: (options?: { projectName?: string; canvasSettings?: CanvasSettings }) => void;
  setNewProjectOpen: (open: boolean) => void;
  setRegisterIconOpen: (open: boolean) => void;
  setProjectName: (name: string) => void;
  loadProjectFromFileData: (file: ProjectFile) => boolean;
  setExportPdfOpen: (open: boolean) => void;
  setLargePreviewOpen: (open: boolean) => void;
  setWelcomeModalOpen: (open: boolean) => void;

  // ── Group Actions ─────────────────────────────────────────────────────────
  /** Group all currently selected elements into a new group container. */
  groupSelected: () => void;
  /** Ungroup the currently selected group, moving children back to root. */
  ungroupSelected: () => void;
  /** Enter group edit mode for the given group — allows selecting children. */
  enterGroup: (groupId: string) => void;
  /** Exit group edit mode — returns to root-level selection. */
  exitGroup: () => void;
  /** Show the context menu at the given screen/canvas position. */
  setContextMenu: (menu: { x: number; y: number; canvasX: number; canvasY: number } | null) => void;
  /** Clear the context menu. */
  clearContextMenu: () => void;
  /** Find the group element that contains a child with the given ID. */
  findParentGroup: (childId: string) => CanvasElement | null;
  /** Find any element by ID, including children nested inside groups. */
  findElementById: (elementId: string) => CanvasElement | null;
  /** Check whether a given element ID belongs to a group (not at root level). */
  isGroupChild: (elementId: string) => boolean;
  /** Check whether the current selection can be grouped. */
  canGroup: () => boolean;
  /** Check whether the current selection can be ungrouped. */
  canUngroup: () => boolean;

  // ── Group Child Drag Actions ─────────────────────────────────────────────
  /** Start dragging a child element within a group in edit mode. */
  startGroupChildDrag: (childId: string, x: number, y: number) => void;
  /** Update the position of a child element being dragged within a group. */
  updateGroupChildDrag: (x: number, y: number) => void;
  /** Stop dragging a child element within a group. */
  stopGroupChildDrag: () => void;
  /** Recalculate group bounds based on current children positions. */
  recalculateGroupBounds: (groupId: string) => void;

  // ── Group Child Resize Actions ─────────────────────────────────────────────
  /** Start resizing a child element within a group in edit mode. */
  startGroupChildResize: (childId: string, handle: string, x: number, y: number) => void;
  /** Update the size of a child element being resized within a group. */
  updateGroupChildResize: (x: number, y: number) => void;
  /** Stop resizing a child element within a group. */
  stopGroupChildResize: () => void;

  // ── Spotlight / Floating Cards Actions ────────────────────────────────────
  openSpotlight: () => void;
  closeSpotlight: () => void;
  addFloatingCard: (card: FloatingCardData) => void;
  removeFloatingCard: (cardId: string) => void;

  // Predefined Blocks
  openPredefinedBlocks: () => void;
  closePredefinedBlocks: () => void;
  addPredefinedBlock: (blockId: string) => void;
  clearFloatingCards: () => void;
  setPropertyDisplayMode: (mode: PropertyDisplayMode) => void;
  setToolPaletteCollapsed: (collapsed: boolean) => void;
  setPropsPanelCollapsed: (collapsed: boolean) => void;
  setSpotlightHintShown: (shown: number) => void;
  clearCardInitialPosition: (cardId: string) => void;
}

// ── Spotlight / Floating Cards Types ────────────────────────────────────────
export type PropertyDisplayMode = 'panel' | 'floating' | 'both';

export interface FloatingCardData {
  id: string;
  sectionLabel: string; // e.g. 'Position', 'Typography', 'Fill', etc.
  x: number;
  y: number;
  minimized: boolean;
  zIndex: number;
  initialX?: number; // Starting X for fly-in animation from spotlight
  initialY?: number; // Starting Y for fly-in animation from spotlight
}

export const DEFAULT_CANVAS_SETTINGS: CanvasSettings = {
  pageWidth: 794,
  pageHeight: 1123,
  pageBackgroundColor: '#ffffff',
  marginPreset: 'normal',
  marginTop: 50,
  marginBottom: 50,
  marginLeft: 50,
  marginRight: 50,
  marginGuideline: {
    show: true,
    color: '#ec4899',
    thickness: 1,
    style: 'dashed',
    opacity: 40,
  },
};

/** Build a Map from element ID to element for O(1) lookups. */
function buildElementIndex(elements: CanvasElement[]): Map<string, CanvasElement> {
  const map = new Map<string, CanvasElement>();
  for (const el of elements) map.set(el.id, el);
  return map;
}

/** Move an element, correctly adjusting line endpoint / corner-point deltas when x or y changes. */
function moveElementWithLineDelta(el: CanvasElement, updates: { x?: number; y?: number }): CanvasElement {
  if (updates.x !== undefined && el.type === 'line' && el.lineStartX !== undefined) {
    const dx = updates.x - el.x;
    return { ...el, x: updates.x, lineStartX: el.lineStartX + dx, lineEndX: el.lineEndX! + dx };
  }
  if (updates.y !== undefined && el.type === 'line' && el.lineStartY !== undefined) {
    const dy = updates.y - el.y;
    return { ...el, y: updates.y, lineStartY: el.lineStartY + dy, lineEndY: el.lineEndY! + dy };
  }
  // Translate rectangle corner points (absolute) when the element moves.
  if (el.cornerPoints && (updates.x !== undefined || updates.y !== undefined)) {
    const dx = (updates.x ?? el.x) - el.x;
    const dy = (updates.y ?? el.y) - el.y;
    if (dx !== 0 || dy !== 0) {
      return {
        ...el,
        ...updates,
        cornerPoints: el.cornerPoints.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      };
    }
  }
  return { ...el, ...updates };
}

/** Helper to compute the backward-compatible selectedElementId from selectedElementIds.
 *  @deprecated Use selectedElementIds directly instead. */
function deriveSelectedElementId(ids: string[]): string | null {
  return ids[0] ?? null;
}

export const useDesignerStore = create<DesignerState>((set, get) => {
  return {
  elements: [],
  selectedElementIds: [],
  selectedElementId: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  isPanning: false,
  isAutoPanning: false,
  panStart: null,
  isDragging: false,
  dragStart: null,
  dragMoved: false,
  dragClickedElementId: null,
  isResizing: false,
  resizeHandle: null,
  resizeStart: null,
  multiResizeData: null,
  isEndpointDragging: false,
  draggingEndpoint: null,
  endpointDragStart: null,
  // Rectangle corner drag state
  isCornerDragging: false,
  draggingCornerIndex: null,
  cornerDragStart: null,
  cornerDragPreview: null,
  isTableColResizing: false,
  isTableRowResizing: false,
  tableResizeData: null,
  shiftHeld: false,
  ctrlHeld: false,
  altHeld: false,
  selectedTableCells: [],
  hoveredTableCell: null,
  isTableCellSelecting: false,
  tableCellSelectStart: null,
  tableCellSelectEnd: null,
  tableCellSelectTableId: null,
  tableCellSelectBaseline: [],
  angleSnapInfo: null,
  isSelecting: false,
  selectionRect: null,
  selectionAdditive: false,
  multiDragStart: {},
  elementCounter: { text: 0, table: 0, image: 0, line: 0, rectangle: 0, ellipse: 0, group: 0 },
  clipboardElement: null,
  clipboardElements: [],
  editingGroupId: null,
  editingTextElementId: null,
  setEditingTextElement: (id) => set({ editingTextElementId: id, ...(id === null ? { activeTextEditor: null } : {}) }),
  activeTextEditor: null,
  setActiveTextEditor: (editor) => set({ activeTextEditor: editor }),
  isGroupChildDragging: false,
  groupChildDragStart: null,
  groupChildMultiDragStart: {},
  isGroupChildResizing: false,
  groupChildResizeStart: null,
  contextMenu: null,
  spotlightOpen: false,
  floatingCards: [],
  // Default to 'panel' so the docked properties panel is visible from the
  // start — matching the Welcome modal's default selection ("Panel"). This
  // keeps the background panel in sync with what the user sees selected in
  // the modal before they click Create.
  propertyDisplayMode: 'panel',
  spotlightHintShown: 0,
  predefinedBlocksOpen: false,
  toolPaletteCollapsed: false,
  propsPanelCollapsed: false,
  canvasSettings: DEFAULT_CANVAS_SETTINGS,
  settingsOpen: false,
  newProjectOpen: false,
  registerIconOpen: false,
  exportPdfOpen: false,
  largePreviewOpen: false,
  welcomeModalOpen: false,

  // Zoom step default
  zoomStep: 5,

  // Snap defaults
  snapEnabled: true,
  snapToGrid: false,
  snapToElements: true,
  snapUnit: 10,

  // Alignment guidelines
  alignmentGuidelines: [],

  // Undo / Redo
  undoStack: [],
  redoStack: [],
  canUndo: false,
  canRedo: false,

  // Last added element ID (for drop animation)
  lastAddedElementId: null,
  clearLastAddedElementId: () => set({ lastAddedElementId: null }),

  // View
  showMiniPreview: true,
  shortcutsOverlayVisible: true,
  toolInfoIconsVisible: true,
  toolInfoElementType: null,

  // Project save/load
  projectName: 'Untitled Project',
  lastSaveFilename: null,
  fileHandle: null,
  isDirty: false,

  addElement: (type, x, y) => {
    invalidateSnapCache();
    const state = get();
    state.pushUndo();
    const counter = { ...state.elementCounter };
    counter[type] += 1;
    const size = getDefaultSize(type);

    const elementX = x - size.width / 2;
    const elementY = y - size.height / 2;

    const element: CanvasElement = {
      id: uuidv4(),
      type,
      x: elementX,
      y: elementY,
      width: size.width,
      height: size.height,
      locked: false,
      visible: true,
      name: getDefaultName(type, counter[type]),
      properties: getDefaultProperties(type),
    };

    // For line elements, set absolute endpoint coordinates
    if (type === 'line') {
      element.lineStartX = elementX;
      element.lineStartY = y; // center vertically at drop point
      element.lineEndX = elementX + size.width;
      element.lineEndY = y;
      // Recalculate bounds from endpoints
      const bounds = computeLineBounds(element.lineStartX, element.lineStartY, element.lineEndX, element.lineEndY);
      element.x = bounds.x;
      element.y = bounds.y;
      element.width = bounds.width;
      element.height = bounds.height;
    }

    const newSelection = [element.id];
    set({
      elements: [...state.elements, element],
      selectedElementIds: newSelection,
      selectedElementId: deriveSelectedElementId(newSelection),
      // Clear floating cards — the new element is always a different element
      // from the previously selected one, so any open property cards must be
      // dismissed. Mirrors the clearCards behaviour in selectElement().
      floatingCards: [],
      elementCounter: counter,
      isDirty: true,
      lastAddedElementId: element.id,
    });
  },

  removeElement: (id) => {
    invalidateSnapCache();
    get().pushUndo();
    set((state) => {
      const newSelectedIds = state.selectedElementIds.filter((sid) => sid !== id);
      // Check if the element is a group child
      let foundInChildren = false;
      let parentGroupId: string | null = null;
      const newElements = state.elements.map((el) => {
        if (el.type === 'group' && el.children) {
          const childIndex = el.children.findIndex((c) => c.id === id);
          if (childIndex !== -1) {
            foundInChildren = true;
            parentGroupId = el.id;
            const newChildren = el.children.filter((c) => c.id !== id);
            return { ...el, children: newChildren };
          }
        }
        return el;
      });
      if (foundInChildren) {
        // Bug #4 fix: If the group now has zero children, remove the empty group
        // entirely (auto-ungroup). An empty group is a "ghost" that causes
        // confusion in the layers panel and selection logic.
        const filteredElements = newElements.filter((el) => {
          if (el.type === 'group' && el.children && el.children.length === 0) {
            // Also remove the empty group from selection
            const groupId = el.id;
            if (newSelectedIds.includes(groupId)) {
              newSelectedIds.splice(newSelectedIds.indexOf(groupId), 1);
            }
            return false;
          }
          return true;
        });

        // Bug #9 fix: Schedule a recalculation of the parent group's bounds
        // after the state update completes. This ensures the group's selection
        // outline and hit testing are accurate after child removal.
        if (parentGroupId) {
          const groupStillExists = filteredElements.some(el => el.id === parentGroupId);
          if (groupStillExists) {
            queueMicrotask(() => get().recalculateGroupBounds(parentGroupId!));
          }
        }

        // Clear editingGroupId if the removed element was the group being edited
        const shouldClearEditingGroup = state.editingGroupId === id;

        return {
          elements: filteredElements,
          selectedElementIds: newSelectedIds,
          selectedElementId: deriveSelectedElementId(newSelectedIds),
          isDirty: true,
          ...(shouldClearEditingGroup ? { editingGroupId: null } : {}),
        };
      }
      return {
        elements: state.elements.filter((el) => el.id !== id),
        selectedElementIds: newSelectedIds,
        selectedElementId: deriveSelectedElementId(newSelectedIds),
        isDirty: true,
      };
    });
  },

  updateElement: (id, updates) => {
    const state = get();
    debouncedPropertyPushUndo(state);
    set((s) => ({
      elements: s.elements.map((el) => {
        if (el.id === id) {
          // For line elements, adjust endpoints when position changes
          if (el.type === 'line' && (updates.x !== undefined || updates.y !== undefined)) {
            return moveElementWithLineDelta(el, updates as { x?: number; y?: number });
          }
          // For deformed rectangles, translate corner points when x/y changes
          // so the shape stays aligned with the element's new position.
          if (el.cornerPoints && (updates.x !== undefined || updates.y !== undefined)) {
            const dx = (updates.x ?? el.x) - el.x;
            const dy = (updates.y ?? el.y) - el.y;
            if (dx !== 0 || dy !== 0) {
              return {
                ...el,
                ...updates,
                cornerPoints: el.cornerPoints.map((p) => ({ x: p.x + dx, y: p.y + dy })),
              };
            }
          }
          return { ...el, ...updates };
        }
        // Search inside group children
        if (el.type === 'group' && el.children) {
          const childIndex = el.children.findIndex((c) => c.id === id);
          if (childIndex !== -1) {
            const child = el.children[childIndex];
            // For line children, adjust endpoints when position changes
            if (child.type === 'line' && (updates.x !== undefined || updates.y !== undefined)) {
              const updatedChild = moveElementWithLineDelta(child, updates as { x?: number; y?: number });
              const newChildren = [...el.children];
              newChildren[childIndex] = updatedChild;
              return { ...el, children: newChildren };
            }
            // For deformed rectangle children, translate corner points
            if (child.cornerPoints && (updates.x !== undefined || updates.y !== undefined)) {
              const dx = (updates.x ?? child.x) - child.x;
              const dy = (updates.y ?? child.y) - child.y;
              if (dx !== 0 || dy !== 0) {
                const newChildren = [...el.children];
                newChildren[childIndex] = {
                  ...child,
                  ...updates,
                  cornerPoints: child.cornerPoints.map((p) => ({ x: p.x + dx, y: p.y + dy })),
                };
                return { ...el, children: newChildren };
              }
            }
            const newChildren = [...el.children];
            newChildren[childIndex] = { ...newChildren[childIndex], ...updates };
            return { ...el, children: newChildren };
          }
        }
        return el;
      }),
      isDirty: true,
    }));
  },

  updateElementProperties: (id, properties) => {
    invalidateSnapCache();
    const state = get();
    debouncedPropertyPushUndo(state);
    set((s) => ({
      elements: s.elements.map((el) => {
        if (el.id === id) return { ...el, properties };
        // Search inside group children
        if (el.type === 'group' && el.children) {
          const childIndex = el.children.findIndex((c) => c.id === id);
          if (childIndex !== -1) {
            const newChildren = [...el.children];
            newChildren[childIndex] = { ...newChildren[childIndex], properties };
            return { ...el, children: newChildren };
          }
        }
        return el;
      }),
      isDirty: true,
    }));
  },

  selectElement: (id) => {
    if (id === null) {
      set({
        selectedElementIds: [],
        selectedElementId: null,
        floatingCards: [],
        editingTextElementId: null,
        selectedTableCells: [],
        hoveredTableCell: null,
        isTableCellSelecting: false,
        tableCellSelectStart: null,
        tableCellSelectEnd: null,
        tableCellSelectTableId: null,
        tableCellSelectBaseline: [],
      });
    } else {
      set((state) => {
        // Clear floating cards when selecting a different element
        const clearCards = state.selectedElementIds[0] !== id;
        // Clear text editing when selecting a different element
        const clearTextEditing = state.editingTextElementId && state.editingTextElementId !== id;
        // Clear table cell selection when selecting a different element
        const clearTableCells = state.selectedTableCells.length > 0 && state.selectedElementIds[0] !== id;
        return {
          selectedElementIds: [id],
          selectedElementId: id,
          ...(clearCards ? { floatingCards: [] } : {}),
          ...(clearTextEditing ? { editingTextElementId: null } : {}),
          ...(clearTableCells ? { selectedTableCells: [], hoveredTableCell: null, isTableCellSelecting: false, tableCellSelectStart: null, tableCellSelectEnd: null, tableCellSelectTableId: null, tableCellSelectBaseline: [] } : {}),
        };
      });
    }
  },

  addToSelection: (id) => {
    set((state) => {
      if (state.selectedElementIds.includes(id)) return state;
      const newIds = [...state.selectedElementIds, id];
      return {
        selectedElementIds: newIds,
        selectedElementId: deriveSelectedElementId(newIds),
      };
    });
  },

  toggleInSelection: (id) => {
    set((state) => {
      if (state.selectedElementIds.includes(id)) {
        const newIds = state.selectedElementIds.filter((sid) => sid !== id);
        return {
          selectedElementIds: newIds,
          selectedElementId: deriveSelectedElementId(newIds),
        };
      } else {
        const newIds = [...state.selectedElementIds, id];
        return {
          selectedElementIds: newIds,
          selectedElementId: deriveSelectedElementId(newIds),
        };
      }
    });
  },

  clearSelection: () => {
    set({
      selectedElementIds: [],
      selectedElementId: null,
      editingTextElementId: null,
    });
  },

  selectAll: () => {
    set((state) => {
      // Bug #2 fix: When in group-edit mode, select the children of the
      // currently-edited group instead of root-level elements.
      if (state.editingGroupId) {
        const group = state.elements.find((el) => el.id === state.editingGroupId);
        if (group && group.type === 'group' && group.children) {
          const newIds = group.children
            .filter((c) => !c.locked && c.visible)
            .map((c) => c.id);
          return {
            selectedElementIds: newIds,
            selectedElementId: deriveSelectedElementId(newIds),
          };
        }
      }
      const newIds = state.elements
        .filter((el) => !el.locked && el.visible)
        .map((el) => el.id);
      return {
        selectedElementIds: newIds,
        selectedElementId: deriveSelectedElementId(newIds),
      };
    });
  },

  startSelection: (x, y, additive = false) => {
    set((state) => ({
      isSelecting: true,
      selectionRect: { x, y, width: 0, height: 0 },
      selectionAdditive: additive,
      // When additive (Shift held), preserve existing selection — finishSelection will union
      // Otherwise, clear selection now so the rubber band starts fresh.
      // Also clear floating cards so dismissed cards don't reappear after a
      // fresh rubber-band selection picks up new elements.
      ...(additive ? {} : { selectedElementIds: [], selectedElementId: null, floatingCards: [] }),
    }));
  },

  updateSelection: (x, y) => {
    set((state) => {
      if (!state.selectionRect || !state.isSelecting) return state;
      const startX = state.selectionRect.x;
      const startY = state.selectionRect.y;
      const width = x - startX;
      const height = y - startY;
      return {
        selectionRect: { x: startX, y: startY, width, height },
      };
    });
  },

  finishSelection: () => {
    const state = get();
    if (!state.selectionRect || !state.isSelecting) {
      set({ isSelecting: false, selectionRect: null, selectionAdditive: false });
      return;
    }

    // Normalize the selection rect (handle negative width/height)
    const rect = state.selectionRect;
    const selLeft = Math.min(rect.x, rect.x + rect.width);
    const selTop = Math.min(rect.y, rect.y + rect.height);
    const selRight = Math.max(rect.x, rect.x + rect.width);
    const selBottom = Math.max(rect.y, rect.y + rect.height);

    // The selection rect is stored in canvas-inner coordinates (the coordinate
    // space of the transform root), but element positions (el.x, el.y,
    // lineStartX/Y, etc.) are in the page-content coordinate space — they are
    // used as CSS left/top inside the page div, which has
    // margin = VIEWPORT_PADDING.  To compare correctly we must convert the
    // selection rect into page-content coordinates by subtracting the padding.
    const vp = VIEWPORT_PADDING;
    const pSelLeft   = selLeft   - vp;
    const pSelTop    = selTop    - vp;
    const pSelRight  = selRight  - vp;
    const pSelBottom = selBottom - vp;

    // Find all visible, unlocked elements that intersect with the selection rect.
    // For line elements, we test the actual line segment against the rect
    // (bounding-box overlap would select lines that are merely *near* the rect).
    const selectedIds = state.elements
      .filter((el) => {
        if (!el.visible || el.locked) return false;
        // Line elements: test actual line-segment vs rect intersection
        if (el.type === 'line' && el.lineStartX !== undefined && el.lineEndX !== undefined &&
            el.lineStartY !== undefined && el.lineEndY !== undefined) {
          return lineIntersectsRect(
            el.lineStartX, el.lineStartY, el.lineEndX, el.lineEndY,
            pSelLeft, pSelTop, pSelRight, pSelBottom,
          );
        }
        // All other element types: bounding-box overlap
        const elRight = el.x + el.width;
        const elBottom = el.y + el.height;
        return el.x < pSelRight && elRight > pSelLeft && el.y < pSelBottom && elBottom > pSelTop;
      })
      .map((el) => el.id);

    // When additive (Shift+drag), union with existing selection instead of replacing
    const finalIds = state.selectionAdditive
      ? Array.from(new Set([...state.selectedElementIds, ...selectedIds]))
      : selectedIds;

    set({
      isSelecting: false,
      selectionRect: null,
      selectionAdditive: false,
      selectedElementIds: finalIds,
      selectedElementId: deriveSelectedElementId(finalIds),
    });
  },

  getSelectedElement: () => {
    const state = get();
    const firstId = state.selectedElementIds[0];
    if (!firstId) return null;
    return state.elements.find((el) => el.id === firstId) || null;
  },

  duplicateElement: (id) => {
    invalidateSnapCache();
    const state = get();
    state.pushUndo();
    // Bug #1 fix: Use findElementById so group children can be duplicated.
    const element = state.findElementById(id);
    if (!element) return;
    const counter = { ...state.elementCounter };
    counter[element.type] += 1;

    // Bug fix: Use reIdElement to assign new UUIDs to the duplicated element
    // and all its children (if it's a group). This prevents duplicate IDs.
    const reIded = reIdElement(element);
    const newElement: CanvasElement = {
      ...reIded,
      x: element.x + 20,
      y: element.y + 20,
      name: getDefaultName(element.type, counter[element.type]),
      // Offset rectangle corner points by the same +20,+20 duplicate offset
      ...(reIded.cornerPoints
        ? { cornerPoints: reIded.cornerPoints.map((p) => ({ x: p.x + 20, y: p.y + 20 })) }
        : {}),
    };
    const newSelection = [newElement.id];

    // If the element is a group child, insert the duplicate into the same group
    const parentGroup = state.findParentGroup(id);
    if (parentGroup) {
      set({
        elements: state.elements.map((el) => {
          if (el.id === parentGroup.id && el.type === 'group' && el.children) {
            return { ...el, children: [...el.children, newElement] };
          }
          return el;
        }),
        selectedElementIds: newSelection,
        selectedElementId: deriveSelectedElementId(newSelection),
        elementCounter: counter,
        isDirty: true,
      });
      queueMicrotask(() => get().recalculateGroupBounds(parentGroup.id));
    } else {
      set({
        elements: [...state.elements, newElement],
        selectedElementIds: newSelection,
        selectedElementId: deriveSelectedElementId(newSelection),
        elementCounter: counter,
        isDirty: true,
      });
    }
  },

  moveElement: (id, x, y) => {
    set((state) => ({
      elements: state.elements.map((el) => {
        if (el.id !== id) return el;
        if (el.type === 'line' && el.lineStartX !== undefined) {
          const dx = x - el.x;
          const dy = y - el.y;
          return { ...el, x, y, lineStartX: el.lineStartX + dx, lineStartY: el.lineStartY! + dy, lineEndX: el.lineEndX! + dx, lineEndY: el.lineEndY! + dy };
        }
        // Translate rectangle corner points (absolute) when the element is moved.
        if (el.cornerPoints) {
          const dx = x - el.x;
          const dy = y - el.y;
          return {
            ...el,
            x,
            y,
            cornerPoints: el.cornerPoints.map((p) => ({ x: p.x + dx, y: p.y + dy })),
          };
        }
        return { ...el, x, y };
      }),
    }));
  },

  resizeElement: (id, width, height) => {
    set((state) => ({
      elements: state.elements.map((el) =>
        el.id === id ? { ...el, width: Math.max(10, width), height: Math.max(10, height) } : el
      ),
    }));
  },

  setZoom: (zoom) => {
    set({ zoom: Math.min(50, Math.max(0.01, zoom)) });
  },

  setPan: (x, y) => {
    set({ panX: x, panY: y });
  },

  panToElement: (elementId) => {
    const state = get();
    // Bug #11 fix: Use findElementById to support elements inside groups
    const el = state.findElementById(elementId);
    if (!el) return;

    const VIEWPORT_PADDING = 40;
    const TOOL_PALETTE_WIDTH = 220; // approximate left sidebar width
    const PROPS_PANEL_WIDTH = 288; // w-72

    // Calculate element center in canvas coordinates
    const elCenterX = VIEWPORT_PADDING + el.x + el.width / 2;
    const elCenterY = VIEWPORT_PADDING + el.y + el.height / 2;

    // For lines, use midpoint of the line
    const isLine = el.type === 'line';
    const lineCenterX = isLine && el.lineStartX !== undefined && el.lineEndX !== undefined
      ? VIEWPORT_PADDING + (el.lineStartX + el.lineEndX) / 2
      : elCenterX;
    const lineCenterY = isLine && el.lineStartY !== undefined && el.lineEndY !== undefined
      ? VIEWPORT_PADDING + (el.lineStartY + el.lineEndY) / 2
      : elCenterY;

    const cx = isLine ? lineCenterX : elCenterX;
    const cy = isLine ? lineCenterY : elCenterY;

    const zoom = state.zoom;
    const vw = window.innerWidth - TOOL_PALETTE_WIDTH - PROPS_PANEL_WIDTH;
    const vh = window.innerHeight - 48; // subtract header height

    const targetPanX = vw / (2 * zoom) - cx;
    const targetPanY = vh / (2 * zoom) - cy;

    set({ panX: targetPanX, panY: targetPanY, isAutoPanning: true });

    // Remove auto-panning flag after transition completes. Clear any pending
    // auto-pan timer first so rapid fit-to-page calls don't accumulate.
    if (autoPanTimer) clearTimeout(autoPanTimer);
    autoPanTimer = setTimeout(() => {
      useDesignerStore.setState({ isAutoPanning: false });
      autoPanTimer = null;
    }, 500);
  },

  startPanning: (x, y) => {
    set({ isPanning: true, panStart: { x, y } });
  },

  stopPanning: () => {
    set({ isPanning: false, panStart: null });
  },

  updatePan: (x, y) => {
    const state = get();
    if (!state.panStart) return;
    const dx = x - state.panStart.x;
    const dy = y - state.panStart.y;
    set({
      panX: state.panX + dx / state.zoom,
      panY: state.panY + dy / state.zoom,
      panStart: { x, y },
    });
  },

  startDragging: (id, x, y) => {
    const state = get();
    const element = state.elements.find((el) => el.id === id);
    if (!element || element.locked) return;

    // Push undo BEFORE the drag starts so we can revert to pre-drag positions
    state.pushUndo();

    // If the clicked element is not in the current selection, make it the only selection
    let currentIds = state.selectedElementIds;
    const needsReselect = !currentIds.includes(id);
    if (needsReselect) {
      currentIds = [id];
    }

    // Build element index for O(1) lookups when computing drag start info
    const index = buildElementIndex(state.elements);

    set({
      isDragging: true,
      dragMoved: false,
      dragClickedElementId: id,
      ...(needsReselect ? { selectedElementIds: currentIds, selectedElementId: id } : {}),
      dragStart: { x, y, elementX: element.x, elementY: element.y },
      multiDragStart: Object.fromEntries(
        currentIds.map((eid) => {
          const el = index.get(eid);
          if (!el) return null;
          const info: DragStartInfo = { x: el.x, y: el.y };
          if (el.type === 'line' && el.lineStartX !== undefined) {
            info.lineStartX = el.lineStartX;
            info.lineStartY = el.lineStartY;
            info.lineEndX = el.lineEndX;
            info.lineEndY = el.lineEndY;
          }
          // Snapshot rectangle corner points (absolute) so the deformed shape
          // translates together with the element during a multi-drag.
          if (el.cornerPoints) {
            info.cornerPoints = el.cornerPoints.map((p) => ({ x: p.x, y: p.y }));
          }
          return [eid, info];
        }).filter(Boolean) as [string, DragStartInfo][]
      ),
    });
  },

  stopDragging: () => {
    const state = get();
    // If the mouse didn't actually move during the drag (it was a click, not a drag),
    // and we're in a multi-selection, reduce selection to just the clicked element
    if (!state.dragMoved && state.dragClickedElementId && state.selectedElementIds.length > 1) {
      state.selectElement(state.dragClickedElementId);
    }
    // Undo was already pushed in startDragging, so just clear drag state
    // Mark as dirty since position changed during the drag
    set({ isDragging: false, dragStart: null, dragMoved: false, dragClickedElementId: null, multiDragStart: {}, alignmentGuidelines: [], isDirty: true });
  },

  updateDrag: (x, y) => {
    const state = get();
    if (!state.dragStart || state.selectedElementIds.length === 0) return;

    // Mark that the mouse actually moved (distinguishes click from drag)
    if (!state.dragMoved) {
      set({ dragMoved: true });
    }

    const dx = (x - state.dragStart.x) / state.zoom;
    const dy = (y - state.dragStart.y) / state.zoom;

    // Calculate snap for the primary element (first in selection)
    const primaryId = state.selectedElementIds[0];
    const primaryStart = state.multiDragStart[primaryId];
    if (!primaryStart) return;

    // Use the PRIMARY element's start position (not the clicked element's)
    // so that actualDx/actualDy correctly represent just the mouse delta.
    // Using dragStart.elementX would add an offset when clicking a non-primary
    // element in a multi-selection, causing elements to "jump".
    const proposedX = primaryStart.x + dx;
    const proposedY = primaryStart.y + dy;

    const elementIndex = buildElementIndex(state.elements);
    const primaryElement = elementIndex.get(primaryId);
    if (!primaryElement) return;

    // Calculate snapping based on primary element
    let actualDx: number;
    let actualDy: number;
    let guidelines: AlignmentGuide[];

    if (state.snapEnabled) {
      const selectedIdSet = new Set(state.selectedElementIds);
      const others = state.elements.filter((e) => !selectedIdSet.has(e.id));
      // For line elements, pass endpoint coordinates so snapping uses the line's
      // visual center (midpoint of endpoints) instead of the thin bounding box
      const lineEndpoints = primaryElement.type === 'line' && primaryElement.lineStartX !== undefined
        ? {
            startX: (primaryElement.lineStartX - primaryElement.x) + proposedX,
            startY: (primaryElement.lineStartY! - primaryElement.y) + proposedY,
            endX: (primaryElement.lineEndX! - primaryElement.x) + proposedX,
            endY: (primaryElement.lineEndY! - primaryElement.y) + proposedY,
          }
        : undefined;
      // For group elements, pass children so snapping considers individual child edges
      // instead of just the group bounding box
      const groupChildren = primaryElement.type === 'group' && primaryElement.children
        ? primaryElement.children
        : undefined;
      // For deformed rectangles, pass the corner points (shifted to the proposed
      // position) so snapping considers ALL corner positions — including inner
      // (deformed-inward) corners — not just the bounding box edges.
      const cornerPoints = primaryElement.type === 'rectangle' && primaryElement.cornerPoints
        ? primaryElement.cornerPoints.map((p) => ({
            x: p.x + (proposedX - primaryElement.x),
            y: p.y + (proposedY - primaryElement.y),
          }))
        : undefined;
      const snapResult = calculateSnapForPosition(
        primaryId,
        proposedX,
        proposedY,
        primaryElement.width,
        primaryElement.height,
        others,
        state.snapToElements,
        state.snapToGrid,
        state.snapUnit,
        state.canvasSettings.pageWidth,
        state.canvasSettings.pageHeight,
        lineEndpoints,
        state.canvasSettings.marginTop,
        state.canvasSettings.marginBottom,
        state.canvasSettings.marginLeft,
        state.canvasSettings.marginRight,
        groupChildren,
        getElementBorderWidth(primaryElement),
        cornerPoints,
        primaryElement,
      );

      const snappedX = snapResult.snappedX;
      const snappedY = snapResult.snappedY;
      actualDx = snappedX - primaryStart.x;
      actualDy = snappedY - primaryStart.y;
      guidelines = snapResult.guidelines;
    } else {
      actualDx = proposedX - primaryStart.x;
      actualDy = proposedY - primaryStart.y;
      guidelines = [];
    }

    // Apply the same delta to ALL selected elements
    set({
      elements: state.elements.map((el) => {
        const startInfo = state.multiDragStart[el.id];
        if (!startInfo) return el;

        const newX = startInfo.x + actualDx;
        const newY = startInfo.y + actualDy;

        // For line elements, also move endpoints by the same delta from their start positions
        if (el.type === 'line' && startInfo.lineStartX !== undefined) {
          return {
            ...el,
            x: newX,
            y: newY,
            lineStartX: startInfo.lineStartX + actualDx,
            lineStartY: startInfo.lineStartY! + actualDy,
            lineEndX: startInfo.lineEndX! + actualDx,
            lineEndY: startInfo.lineEndY! + actualDy,
          };
        }
        // For rectangles with custom corners, translate the corner points too.
        if (el.cornerPoints && startInfo.cornerPoints) {
          return {
            ...el,
            x: newX,
            y: newY,
            cornerPoints: startInfo.cornerPoints.map((p) => ({
              x: p.x + actualDx,
              y: p.y + actualDy,
            })),
          };
        }
        return { ...el, x: newX, y: newY };
      }),
      alignmentGuidelines: guidelines,
    });
  },

  startResizing: (id, handle, x, y) => {
    const state = get();
    const element = state.elements.find((el) => el.id === id);
    if (!element || element.locked) return;
    // Push undo BEFORE the resize starts so we can revert to pre-resize state
    state.pushUndo();

    // ── Multi-element resize ──────────────────────────────────────────────
    // When multiple elements are selected, compute a unified bounding box and
    // store per-element offset ratios so updateResize can scale them all
    // proportionally from the shared bbox.
    if (state.selectedElementIds.length > 1 && state.selectedElementIds.includes(id)) {
      const selectedIds = state.selectedElementIds;
      const elementIndex = buildElementIndex(state.elements);

      // Compute the unified bounding box of all selected elements
      let bboxLeft = Infinity, bboxTop = Infinity, bboxRight = -Infinity, bboxBottom = -Infinity;
      for (const sid of selectedIds) {
        const el = elementIndex.get(sid);
        if (!el) continue;
        const elLeft = el.x;
        const elTop = el.y;
        const elRight = el.x + el.width;
        const elBottom = el.y + el.height;
        if (elLeft < bboxLeft) bboxLeft = elLeft;
        if (elTop < bboxTop) bboxTop = elTop;
        if (elRight > bboxRight) bboxRight = elRight;
        if (elBottom > bboxBottom) bboxBottom = elBottom;
      }

      const bboxW = bboxRight - bboxLeft;
      const bboxH = bboxBottom - bboxTop;

      // Store per-element ratios relative to the unified bbox
      const elementsData = selectedIds.map((sid) => {
        const el = elementIndex.get(sid);
        if (!el) return null;
        const rx = bboxW > 0 ? (el.x - bboxLeft) / bboxW : 0;
        const ry = bboxH > 0 ? (el.y - bboxTop) / bboxH : 0;
        const rw = bboxW > 0 ? el.width / bboxW : 1;
        const rh = bboxH > 0 ? el.height / bboxH : 1;
        return {
          id: sid,
          origX: el.x, origY: el.y, origW: el.width, origH: el.height,
          rx, ry, rw, rh,
          lineStartX: el.type === 'line' && el.lineStartX !== undefined ? el.lineStartX : undefined,
          lineStartY: el.type === 'line' && el.lineStartY !== undefined ? el.lineStartY : undefined,
          lineEndX: el.type === 'line' && el.lineEndX !== undefined ? el.lineEndX : undefined,
          lineEndY: el.type === 'line' && el.lineEndY !== undefined ? el.lineEndY : undefined,
          // Snapshot original corner points so deformed rectangles scale with the multi-resize
          origCornerPoints: el.cornerPoints
            ? el.cornerPoints.map((p) => ({ x: p.x, y: p.y }))
            : undefined,
          originalChildren: el.type === 'group' && el.children ? structuredClone(el.children) : undefined,
        };
      }).filter(Boolean) as NonNullable<NonNullable<DesignerState['multiResizeData']>['elements']>[number][];

      set({
        isResizing: true,
        resizeHandle: handle,
        resizeStart: {
          x, y,
          elementX: bboxLeft,
          elementY: bboxTop,
          elementW: bboxW,
          elementH: bboxH,
        },
        multiResizeData: {
          bbox: { x: bboxLeft, y: bboxTop, width: bboxW, height: bboxH },
          elements: elementsData,
        },
      });
      return;
    }

    // ── Single-element resize (original behavior) ───────────────────────
    const newSelection = [id];
    set({
      isResizing: true,
      resizeHandle: handle,
      selectedElementIds: newSelection,
      selectedElementId: id,
      resizeStart: {
        x,
        y,
        elementX: element.x,
        elementY: element.y,
        elementW: element.width,
        elementH: element.height,
        originalChildren: element.type === 'group' && element.children
          ? structuredClone(element.children)
          : undefined,
        // Snapshot original corner points so deformed rectangles scale with normal resize
        origCornerPoints: element.cornerPoints
          ? element.cornerPoints.map((p) => ({ x: p.x, y: p.y }))
          : undefined,
      },
      multiResizeData: null,
    });
  },

  stopResizing: () => {
    // Undo was already pushed in startResizing, so just clear resize state
    // Mark as dirty since size changed during the resize
    set({ isResizing: false, resizeHandle: null, resizeStart: null, multiResizeData: null, alignmentGuidelines: [], isDirty: true });
  },

  updateResize: (x, y) => {
    const state = get();
    if (!state.resizeStart || !state.resizeHandle) return;
    const screenDx = (x - state.resizeStart.x) / state.zoom;
    const screenDy = (y - state.resizeStart.y) / state.zoom;
    let handle = state.resizeHandle;
    const start = state.resizeStart;

    // ── Rotation-aware resize for rectangles ──────────────────────────────
    // A rotated rectangle is rendered with `transform: rotate(θ)` and
    // `transform-origin: center`, so it pivots around its CENTER, which lives
    // at (element.x + W/2, element.y + H/2) in screen space.
    //
    // The previous implementation only transformed the mouse delta into the
    // rectangle's local space and then ran standard axis-aligned bbox math
    // (e.g. for 'e': keep start.elementX fixed, grow width). That is WRONG for
    // a rotated rectangle: keeping the LOCAL left edge fixed moves the CENTER
    // in local space whenever the width changes, and — because the rotation
    // pivots around the center — that center shift rotates into screen space.
    // The result was that the "fixed" opposite edge drifted on screen, the
    // element's screen position jumped even though only size was meant to
    // change, the dragged handle moved at the wrong speed (factor
    // (1+cosθ)/2), and behavior varied wildly per angle with a hard
    // discontinuity at the cosθ < -0.5 remap threshold.
    //
    // The correct approach keeps the OPPOSITE edge/corner fixed in SCREEN
    // space (not local space). Algorithm:
    //   1. Project the mouse delta onto the rectangle's local east axis
    //      (cos, sin) and south axis (-sin, cos) → deltaE, deltaS.
    //   2. New size: moving edge follows its projected delta.
    //   3. The center shifts by half the size change along the moving edge's
    //      axis (toward the moving edge), so the anchor edge/corner stays
    //      fixed in screen space.
    // This yields a single unified formula valid for ALL angles (0°–360°)
    // with no remapping and no discontinuities. At θ=0 it collapses exactly
    // to the axis-aligned math (anchor = local opposite edge, center shift is
    // zero in the perpendicular direction). The dragged handle follows the
    // mouse 1:1 in screen space at every angle.
    //
    // Only rectangles support rotation. Non-rectangle elements and multi-
    // element proportional resize use the raw screen delta (no transformation).
    const primaryId = state.selectedElementIds[0];
    let dx = screenDx;
    let dy = screenDy;

    // ── Calculate raw (unsnapped) resize bounds ──
    let rawX = start.elementX;
    let rawY = start.elementY;
    let rawW = start.elementW;
    let rawH = start.elementH;

    // For rotated DEFORMED rectangles, the corner points are computed up-front
    // in screen space (see resizeRotatedCornerPoints). The bbox is then derived
    // from those corners, and this precomputed corners array is committed
    // directly (skipping the resizeCornerPointsByEdges call further below).
    // Snapping may adjust the bbox; in that case the precomputed corners are
    // proportionally rescaled to the snapped bbox (a minor adjustment).
    let precomputedCorners: { x: number; y: number }[] | null = null;

    // Whether the rotation-aware bbox math was applied (skips the axis-aligned
    // block below for rotated rectangles).
    let rotationAwareApplied = false;
    if (primaryId && !state.multiResizeData) {
      const primaryEl = state.elements.find((el) => el.id === primaryId);
      if (primaryEl && primaryEl.type === 'rectangle') {
        const rotation = getRectRotation(primaryEl);
        if (rotation !== 0) {
          // ── Rotated DEFORMED rectangle: screen-space corner resize ──
          // resizeCornerPointsByEdges keeps the opposite corner fixed in LOCAL
          // space, but for a rotated rect that corner still drifts VISUALLY
          // because the bbox center (rotation pivot) shifts. resizeRotatedCornerPoints
          // works in screen space so the opposite corner stays visually fixed,
          // and the result is self-consistent with transform-origin: center.
          if (start.origCornerPoints) {
            const result = resizeRotatedCornerPoints(
              start.origCornerPoints,
              rotation,
              handle,
              screenDx,
              screenDy,
            );
            precomputedCorners = result.corners;
            rawX = result.bbox.x;
            rawY = result.bbox.y;
            rawW = result.bbox.width;
            rawH = result.bbox.height;
            rotationAwareApplied = true;
          } else {
            // ── Rotated NON-deformed rectangle: anchor-fixed bbox math ──
            const rad = (rotation * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            // Project the screen-space mouse delta onto the rectangle's local
            // east axis (cos, sin) and south axis (-sin, cos). These are how far
            // the dragged handle moved along each local axis.
            const deltaE = screenDx * cos + screenDy * sin;
            const deltaS = -screenDx * sin + screenDy * cos;

            // New width/height: the moving edge follows its projected delta.
            // 'e' grows width (right edge moves +east), 'w' shrinks (left edge
            // moves +east). Same sign convention for 's'/'n' with the south axis.
            let newW = start.elementW;
            let newH = start.elementH;
            if (handle.includes('e')) newW = start.elementW + deltaE;
            if (handle.includes('w')) newW = start.elementW - deltaE;
            if (handle.includes('s')) newH = start.elementH + deltaS;
            if (handle.includes('n')) newH = start.elementH - deltaS;

            // Min-size clamp. When clamped, the moving edge simply stops at the
            // min distance from the anchor — the anchor stays fixed regardless.
            const MIN_W = 20;
            const MIN_H = 10;
            newW = Math.max(MIN_W, newW);
            newH = Math.max(MIN_H, newH);

            const dW = newW - start.elementW;
            const dH = newH - start.elementH;

            // Center shift: the anchor (opposite edge/corner) stays fixed in
            // screen space, so the center moves by half the size change along
            // the MOVING edge's axis (toward the moving edge).
            let hShiftX = 0, hShiftY = 0;
            if (handle.includes('e')) { hShiftX = (dW / 2) * cos; hShiftY = (dW / 2) * sin; }
            else if (handle.includes('w')) { hShiftX = -(dW / 2) * cos; hShiftY = -(dW / 2) * sin; }
            let vShiftX = 0, vShiftY = 0;
            if (handle.includes('s')) { vShiftX = -(dH / 2) * sin; vShiftY = (dH / 2) * cos; }
            else if (handle.includes('n')) { vShiftX = (dH / 2) * sin; vShiftY = -(dH / 2) * cos; }

            const oldCx = start.elementX + start.elementW / 2;
            const oldCy = start.elementY + start.elementH / 2;
            const newCx = oldCx + hShiftX + vShiftX;
            const newCy = oldCy + hShiftY + vShiftY;

            rawX = newCx - newW / 2;
            rawY = newCy - newH / 2;
            rawW = newW;
            rawH = newH;
            rotationAwareApplied = true;
          }
        }
      }
    }

    // ── Axis-aligned bbox math (non-rotated elements) ──
    // Skipped for rotated rectangles — their rawX/Y/W/H were computed above
    // using the anchor-fixed-in-screen-space formula.
    //
    // FLIP BEHAVIOR: when a handle is dragged PAST the opposite edge (so the
    // proposed width/height would go negative), the element flips — the anchor
    // swaps to the opposite edge and the width/height becomes the absolute
    // (positive) value. This mirrors standard design-app behavior (Figma,
    // Photoshop, etc.) where dragging a side handle through the other side
    // flips the element instead of clamping it to a minimum and freezing.
    // The handle variable is updated in place so snapping (which reads it
    // later) uses the post-flip handle.
    if (!rotationAwareApplied) {
      // X axis
      if (handle.includes('e') && !handle.includes('w')) {
        const proposedW = start.elementW + dx;
        if (proposedW < 0) {
          // Flipped: the right edge crossed the left edge. The right edge was
          // dragged to (start.elementX + start.elementW + dx); after the flip
          // that position becomes the new LEFT edge (x). The original left
          // edge becomes the new right edge (fixed anchor).
          rawW = -proposedW;
          rawX = start.elementX + start.elementW + dx;
          handle = handle.replace('e', 'w') as typeof handle;
        } else {
          rawW = Math.max(20, proposedW);
        }
      } else if (handle.includes('w') && !handle.includes('e')) {
        const proposedW = start.elementW - dx;
        if (proposedW < 0) {
          // Flipped: the left edge crossed the right edge. Anchor swaps to the
          // left edge (new 'e' handle), x stays at the original right edge.
          rawW = -proposedW;
          rawX = start.elementX + start.elementW;
          handle = handle.replace('w', 'e') as typeof handle;
        } else {
          rawW = Math.max(20, proposedW);
          rawX = start.elementX + dx;
        }
      }
      // Y axis
      if (handle.includes('s') && !handle.includes('n')) {
        const proposedH = start.elementH + dy;
        if (proposedH < 0) {
          // Flipped: the bottom edge crossed the top edge. The bottom edge was
          // dragged to (start.elementY + start.elementH + dy); after the flip
          // that position becomes the new TOP edge (y).
          rawH = -proposedH;
          rawY = start.elementY + start.elementH + dy;
          handle = handle.replace('s', 'n') as typeof handle;
        } else {
          rawH = Math.max(10, proposedH);
        }
      } else if (handle.includes('n') && !handle.includes('s')) {
        const proposedH = start.elementH - dy;
        if (proposedH < 0) {
          rawH = -proposedH;
          rawY = start.elementY + start.elementH;
          handle = handle.replace('n', 's') as typeof handle;
        } else {
          rawH = Math.max(10, proposedH);
          rawY = start.elementY + dy;
        }
      }
    }

    // ── Apply snapping to the raw resize bounds ──
    let finalX = rawX;
    let finalY = rawY;
    let finalW = rawW;
    let finalH = rawH;
    let guidelines: AlignmentGuide[] = [];

    // primaryId was already computed above (for rotation-aware delta).
    if (state.snapEnabled && primaryId) {
      const selectedIdSet = new Set(state.selectedElementIds);
      const others = state.elements.filter((e) => !selectedIdSet.has(e.id));
      const primaryElement = state.elements.find((el) => el.id === primaryId);
      const bw = primaryElement ? getElementBorderWidth(primaryElement) : 0;
      const snapResult = calculateSnapForResize(
        primaryId,
        rawX,
        rawY,
        rawW,
        rawH,
        handle,
        others,
        state.snapToElements,
        state.snapToGrid,
        state.snapUnit,
        state.canvasSettings.pageWidth,
        state.canvasSettings.pageHeight,
        state.canvasSettings.marginTop,
        state.canvasSettings.marginBottom,
        state.canvasSettings.marginLeft,
        state.canvasSettings.marginRight,
        bw
      );
      finalX = snapResult.snappedX;
      finalY = snapResult.snappedY;
      finalW = snapResult.snappedW;
      finalH = snapResult.snappedH;
      guidelines = snapResult.guidelines;
    }

    // If snapping adjusted the bbox AND we precomputed corners (rotated deformed
    // rect), proportionally rescale the precomputed corners to the snapped bbox.
    // The snap delta is small (a few px to grid/element edges), so proportional
    // scaling is an acceptable approximation that keeps the corners consistent
    // with the committed bbox + transform-origin: center.
    if (precomputedCorners && (finalX !== rawX || finalY !== rawY || finalW !== rawW || finalH !== rawH)) {
      precomputedCorners = scaleCornerPoints(
        precomputedCorners,
        { x: rawX, y: rawY, width: rawW, height: rawH },
        { x: finalX, y: finalY, width: finalW, height: finalH },
      );
    }

    // ── Multi-element proportional resize ──────────────────────────────────
    if (state.multiResizeData) {
      const { bbox, elements: elementsData } = state.multiResizeData;
      const scaleX = bbox.width > 0 ? finalW / bbox.width : 1;
      const scaleY = bbox.height > 0 ? finalH / bbox.height : 1;

      set({
        elements: state.elements.map((el) => {
          const data = elementsData.find((d) => d.id === el.id);
          if (!data) return el;

          // Compute new position/size from ratios relative to the new bbox
          const newX = finalX + data.rx * finalW;
          const newY = finalY + data.ry * finalH;
          const newW = Math.max(10, data.rw * finalW);
          const newH = Math.max(10, data.rh * finalH);

          // Handle group children scaling
          if (el.type === 'group' && el.children && el.children.length > 0) {
            const childScaleX = data.origW > 0 ? newW / data.origW : 1;
            const childScaleY = data.origH > 0 ? newH / data.origH : 1;
            const sourceChildren = data.originalChildren || el.children;
            const scaledChildren = sourceChildren.map(child => {
              const newChild = {
                ...child,
                x: child.x * childScaleX,
                y: child.y * childScaleY,
                width: Math.max(10, child.width * childScaleX),
                height: Math.max(10, child.height * childScaleY),
              };
              if (child.type === 'line' && child.lineStartX !== undefined) {
                newChild.lineStartX = child.lineStartX * childScaleX;
                newChild.lineStartY = child.lineStartY! * childScaleY;
                newChild.lineEndX = child.lineEndX! * childScaleX;
                newChild.lineEndY = child.lineEndY! * childScaleY;
              }
              return newChild;
            });
            return { ...el, x: newX, y: newY, width: newW, height: newH, children: scaledChildren };
          }

          // Handle line endpoints
          if (el.type === 'line' && data.lineStartX !== undefined) {
            const origBboxW = bbox.width;
            const origBboxH = bbox.height;
            const newLineStartX = data.lineStartX !== undefined && origBboxW > 0
              ? finalX + ((data.lineStartX - bbox.x) / origBboxW) * finalW : el.lineStartX;
            const newLineStartY = data.lineStartY !== undefined && origBboxH > 0
              ? finalY + ((data.lineStartY - bbox.y) / origBboxH) * finalH : el.lineStartY;
            const newLineEndX = data.lineEndX !== undefined && origBboxW > 0
              ? finalX + ((data.lineEndX - bbox.x) / origBboxW) * finalW : el.lineEndX;
            const newLineEndY = data.lineEndY !== undefined && origBboxH > 0
              ? finalY + ((data.lineEndY - bbox.y) / origBboxH) * finalH : el.lineEndY;
            return { ...el, x: newX, y: newY, width: newW, height: newH, lineStartX: newLineStartX, lineStartY: newLineStartY, lineEndX: newLineEndX, lineEndY: newLineEndY };
          }

          // Handle deformed rectangle corner points — scale them with the element
          if (data.origCornerPoints) {
            const scaledCorners = scaleCornerPoints(
              data.origCornerPoints,
              { x: data.origX, y: data.origY, width: data.origW, height: data.origH },
              { x: newX, y: newY, width: newW, height: newH },
            );
            return { ...el, x: newX, y: newY, width: newW, height: newH, cornerPoints: scaledCorners };
          }

          return { ...el, x: newX, y: newY, width: newW, height: newH };
        }),
        alignmentGuidelines: guidelines,
      });
      return;
    }

    // ── Single-element resize (original behavior) ─────────────────────────
    if (!primaryId) return;

    set({
      elements: state.elements.map((el) => {
        if (el.id !== primaryId) return el;

        // If this is a group, scale children proportionally from their ORIGINAL positions
        if (el.type === 'group' && el.children && el.children.length > 0) {
          const scaleX = start.elementW > 0 ? finalW / start.elementW : 1;
          const scaleY = start.elementH > 0 ? finalH / start.elementH : 1;

          // Always scale from ORIGINAL children (stored at resize start) to avoid
          // cumulative/exponential scaling on each mouse move
          const sourceChildren = start.originalChildren || el.children;

          const scaledChildren = sourceChildren.map(child => {
            const newChild = {
              ...child,
              x: child.x * scaleX,
              y: child.y * scaleY,
              width: Math.max(10, child.width * scaleX),
              height: Math.max(10, child.height * scaleY),
            };
            // Scale line endpoints if present
            if (child.type === 'line' && child.lineStartX !== undefined) {
              newChild.lineStartX = child.lineStartX * scaleX;
              newChild.lineStartY = child.lineStartY! * scaleY;
              newChild.lineEndX = child.lineEndX! * scaleX;
              newChild.lineEndY = child.lineEndY! * scaleY;
            }
            return newChild;
          });

          return { ...el, x: finalX, y: finalY, width: finalW, height: finalH, children: scaledChildren };
        }

        // Deformed rectangle: apply per-edge translation to the corner points
        // based on which edges of the bbox actually moved during this resize.
        // This mirrors axis-aligned resize behavior — the dragged corner's
        // edges move, corners on a moving edge shift along that edge only,
        // and the OPPOSITE corner stays completely fixed. Using proportional
        // scaling here (scaleCornerPoints) was the previous behavior: it
        // shifted the opposite corner whenever the polygon's corners were
        // not all at the bbox edges (e.g. after Alt-dragging a corner
        // outward), which is NOT what the user expects from a corner drag.
        // Multi-element proportional resize still uses scaleCornerPoints
        // because that path uniformly scales every element as part of a
        // larger selection — different intent, different geometry.
        //
        // ROTATED deformed rects: the corners were already computed up-front
        // in screen space (precomputedCorners) because resizeCornerPointsByEdges
        // keeps the opposite corner fixed in LOCAL space — which drifts
        // visually when the bbox center (rotation pivot) shifts. Use the
        // precomputed corners directly when present.
        if (start.origCornerPoints) {
          const resizedCorners = precomputedCorners ?? resizeCornerPointsByEdges(
            start.origCornerPoints,
            { x: start.elementX, y: start.elementY, width: start.elementW, height: start.elementH },
            { x: finalX, y: finalY, width: finalW, height: finalH },
            handle,
          );
          return { ...el, x: finalX, y: finalY, width: finalW, height: finalH, cornerPoints: resizedCorners };
        }

        return { ...el, x: finalX, y: finalY, width: finalW, height: finalH };
      }),
      alignmentGuidelines: guidelines,
    });
  },

  startEndpointDrag: (id, endpoint, x, y) => {
    const state = get();
    const element = state.elements.find((el) => el.id === id);
    if (!element || element.locked || element.type !== 'line') return;
    // Push undo BEFORE the endpoint drag starts so we can revert to pre-drag state
    state.pushUndo();
    const newSelection = [id];
    set({
      isEndpointDragging: true,
      draggingEndpoint: endpoint,
      selectedElementIds: newSelection,
      selectedElementId: id,
      endpointDragStart: {
        x,
        y,
        startX: element.lineStartX ?? element.x,
        startY: element.lineStartY ?? element.y,
        endX: element.lineEndX ?? (element.x + element.width),
        endY: element.lineEndY ?? (element.y + element.height),
      },
    });
  },

  updateEndpointDrag: (x, y, shiftHeld) => {
    const state = get();
    if (!state.endpointDragStart || !state.draggingEndpoint) return;
    const primaryId = state.selectedElementIds[0];
    if (!primaryId) return;
    const dx = (x - state.endpointDragStart.x) / state.zoom;
    const dy = (y - state.endpointDragStart.y) / state.zoom;
    const endpoint = state.draggingEndpoint;
    const start = state.endpointDragStart;

    // Compute the "raw" (free) endpoint position from drag delta
    let rawStartX = start.startX;
    let rawStartY = start.startY;
    let rawEndX = start.endX;
    let rawEndY = start.endY;

    if (endpoint === 'start') {
      rawStartX = start.startX + dx;
      rawStartY = start.startY + dy;
    } else {
      rawEndX = start.endX + dx;
      rawEndY = start.endY + dy;
    }

    let newStartX = rawStartX;
    let newStartY = rawStartY;
    let newEndX = rawEndX;
    let newEndY = rawEndY;
    let angleSnapInfo: { angle: number; label: string } | null = null;
    let guidelines: AlignmentGuide[] = [];

    // ── Apply snapping to the moving endpoint (before angle snap) ──
    if (state.snapEnabled && !shiftHeld) {
      const selectedIdSet = new Set(state.selectedElementIds);
      const others = state.elements.filter((e) => !selectedIdSet.has(e.id));
      const movingX = endpoint === 'start' ? rawStartX : rawEndX;
      const movingY = endpoint === 'start' ? rawStartY : rawEndY;

      const snapResult = calculateSnapForEndpointDrag(
        primaryId,
        movingX,
        movingY,
        others,
        state.snapToElements,
        state.snapToGrid,
        state.snapUnit,
        state.canvasSettings.pageWidth,
        state.canvasSettings.pageHeight,
        state.canvasSettings.marginTop,
        state.canvasSettings.marginBottom,
        state.canvasSettings.marginLeft,
        state.canvasSettings.marginRight,
      );

      if (endpoint === 'start') {
        newStartX = snapResult.snappedX;
        newStartY = snapResult.snappedY;
      } else {
        newEndX = snapResult.snappedX;
        newEndY = snapResult.snappedY;
      }
      guidelines = snapResult.guidelines;
    } else if (state.snapEnabled && shiftHeld) {
      // When shift is held, we still want alignment guidelines to appear
      // Calculate guidelines based on the raw position (angle snap will adjust position later)
      const selectedIdSet = new Set(state.selectedElementIds);
      const others = state.elements.filter((e) => !selectedIdSet.has(e.id));
      const movingX = endpoint === 'start' ? rawStartX : rawEndX;
      const movingY = endpoint === 'start' ? rawStartY : rawEndY;

      const snapResult = calculateSnapForEndpointDrag(
        primaryId,
        movingX,
        movingY,
        others,
        state.snapToElements,
        state.snapToGrid,
        state.snapUnit,
        state.canvasSettings.pageWidth,
        state.canvasSettings.pageHeight,
        state.canvasSettings.marginTop,
        state.canvasSettings.marginBottom,
        state.canvasSettings.marginLeft,
        state.canvasSettings.marginRight,
      );
      // Keep guidelines but don't apply snap position (angle snap takes priority)
      guidelines = snapResult.guidelines;
    }

    // SHIFT angle snapping
    if (shiftHeld) {
      // Determine the fixed point and the raw moving point
      const fixedX = endpoint === 'start' ? rawEndX : rawStartX;
      const fixedY = endpoint === 'start' ? rawEndY : rawStartY;
      const movingX = endpoint === 'start' ? rawStartX : rawEndX;
      const movingY = endpoint === 'start' ? rawStartY : rawEndY;

      const deltaVecX = movingX - fixedX;
      const deltaVecY = movingY - fixedY;
      const length = Math.sqrt(deltaVecX * deltaVecX + deltaVecY * deltaVecY);

      if (length > 1) {
        // Compute angle in degrees (0° = right, counter-clockwise positive)
        let angle = Math.atan2(deltaVecY, deltaVecX) * (180 / Math.PI);
        // Normalize to 0-360
        if (angle < 0) angle += 360;

        // Snap angles: 0, 45, 90, 135, 180, 225, 270, 315
        const SNAP_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
        const THRESHOLD = 10; // degrees

        let snappedAngle: number | null = null;
        for (const snapAngle of SNAP_ANGLES) {
          let diff = Math.abs(angle - snapAngle);
          // Handle wrap-around (e.g., 350° is close to 0°)
          if (diff > 180) diff = 360 - diff;
          if (diff <= THRESHOLD) {
            snappedAngle = snapAngle;
            break;
          }
        }

        if (snappedAngle !== null) {
          const snappedRad = snappedAngle * (Math.PI / 180);
          const snappedX = fixedX + length * Math.cos(snappedRad);
          const snappedY = fixedY + length * Math.sin(snappedRad);

          if (endpoint === 'start') {
            newStartX = snappedX;
            newStartY = snappedY;
          } else {
            newEndX = snappedX;
            newEndY = snappedY;
          }

          angleSnapInfo = { angle: snappedAngle, label: `${snappedAngle}°` };
        }
      }
    }

    // Recalculate bounding box from endpoints
    const bounds = computeLineBounds(newStartX, newStartY, newEndX, newEndY);

    set({
      elements: state.elements.map((el) =>
        el.id === primaryId
          ? {
              ...el,
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
              lineStartX: newStartX,
              lineStartY: newStartY,
              lineEndX: newEndX,
              lineEndY: newEndY,
            }
          : el
      ),
      angleSnapInfo,
      alignmentGuidelines: guidelines,
    });
  },

  stopEndpointDrag: () => {
    // Undo was already pushed in startEndpointDrag, so just clear drag state
    // Mark as dirty since endpoint changed during the drag
    set({ isEndpointDragging: false, draggingEndpoint: null, endpointDragStart: null, angleSnapInfo: null, alignmentGuidelines: [], isDirty: true });
  },

  // ── Rectangle corner manipulation (independent corner deformation) ──────────
  startCornerDrag: (id, cornerIndex, x, y) => {
    const state = get();
    const element = state.elements.find((el) => el.id === id);
    if (!element || element.locked || element.type !== 'rectangle') return;
    // Push undo BEFORE the corner drag starts so we can revert to pre-drag state
    state.pushUndo();

    // Lazily initialize cornerPoints from the bbox if the rectangle is still
    // a normal axis-aligned box. From this point on it is a 4-point polygon.
    const origCorners: Point[] = hasCustomCorners(element)
      ? (element.cornerPoints!.map((p) => ({ x: p.x, y: p.y })) as Point[])
      : initRectCornerPointsFromBBox(element);

    // Ensure the element stores cornerPoints immediately so the renderer
    // switches to polygon mode on the next paint (and the corner handles
    // move to the actual corner positions).
    if (!hasCustomCorners(element)) {
      set({
        elements: state.elements.map((el) =>
          el.id === id ? { ...el, cornerPoints: origCorners.map((p) => ({ x: p.x, y: p.y })) } : el,
        ),
      });
    }

    set({
      isCornerDragging: true,
      draggingCornerIndex: cornerIndex,
      selectedElementIds: [id],
      selectedElementId: id,
      cornerDragStart: {
        x,
        y,
        elementId: id,
        origCorners,
        origBbox: { x: element.x, y: element.y, width: element.width, height: element.height },
        rotation: getRectRotation(element),
      },
      // Initialize the preview with the original corners so the first frame
      // renders correctly before any mousemove arrives.
      cornerDragPreview: { elementId: id, corners: origCorners.map((p) => ({ x: p.x, y: p.y })) },
      // Corner deformation ignores element snapping (the shape is freeform);
      // guidelines from a previous operation are cleared.
      alignmentGuidelines: [],
    });
  },

  updateCornerDrag: (x, y, shiftHeld, ctrlHeld) => {
    const state = get();
    if (!state.isCornerDragging || state.draggingCornerIndex === null || !state.cornerDragStart) return;
    const { elementId, origCorners, rotation } = state.cornerDragStart;
    const cornerIndex = state.draggingCornerIndex;

    const screenDx = (x - state.cornerDragStart.x) / state.zoom;
    const screenDy = (y - state.cornerDragStart.y) / state.zoom;

    // The corner points are stored in UNROTATED (local) space and the renderer
    // applies rotate(θ) around the bbox center at draw time. A screen-space
    // mouse delta must therefore be transformed by R(-θ) before being added to
    // a corner point — otherwise the visual corner moves at the wrong angle
    // (e.g. dragging horizontally at θ=45° moves the corner diagonally).
    // With R(-θ) applied, the visual movement = R(θ)·R(-θ)·screenDelta =
    // screenDelta, so the corner follows the mouse 1:1 in screen space.
    // (The renderer additionally pins the rotation pivot to the ORIGINAL bbox
    // center during the drag, so the center-shift from moving one corner does
    // not re-rotate the other three "fixed" corners — see canvas-element.tsx.)
    let dx = screenDx;
    let dy = screenDy;
    if (rotation !== 0) {
      const rad = (rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      dx = screenDx * cos + screenDy * sin;
      dy = -screenDx * sin + screenDy * cos;
    }

    // The moving corner's new absolute position (in local/unrotated space).
    let newCornerX = origCorners[cornerIndex].x + dx;
    let newCornerY = origCorners[cornerIndex].y + dy;

    // ── Snapping + alignment guidelines for the dragged corner ──────────────
    // The dragged corner is a single point — snap it against other elements'
    // edges, page center/margins, and other deformed rectangles' corner
    // points. This reuses the same endpoint-snap logic used for line endpoints.
    // Guidelines (thin alignment lines) are shown for any snap match so the
    // user can see where the corner aligns.
    let cornerGuidelines: AlignmentGuide[] = [];
    if (state.snapEnabled) {
      const others = state.elements.filter((e) => e.id !== elementId);
      const snapResult = calculateSnapForEndpointDrag(
        elementId,
        newCornerX,
        newCornerY,
        others,
        state.snapToElements,
        state.snapToGrid,
        state.snapUnit,
        state.canvasSettings.pageWidth,
        state.canvasSettings.pageHeight,
        state.canvasSettings.marginTop,
        state.canvasSettings.marginBottom,
        state.canvasSettings.marginLeft,
        state.canvasSettings.marginRight,
      );
      newCornerX = snapResult.snappedX;
      newCornerY = snapResult.snappedY;
      cornerGuidelines = snapResult.guidelines;
    }

    // ── Alignment constraint modifiers (only meaningful during Alt corner drag) ──
    // The store-level shiftHeld/ctrlHeld flags are driven by the canvas.tsx
    // keydown/keyup listeners, and the signature falls back to undefined → false
    // for any caller that didn't pass it (back-compat). The three modes are
    // ORTHOGONAL and compose cleanly when both Shift and Ctrl are held.
    //
    // In ALL modes the DRAGGED corner is the one that moves into alignment;
    // the partner corner(s) stay fixed at their original positions. (This is
    // the inverse of the older behavior where the partner moved to meet the
    // dragged corner.)
    //
    //   Alt + Shift             → HORIZONTAL align
    //     The DRAGGED corner's Y locks to its horizontal partner's Y, so both
    //     top corners (or both bottom corners) end up on the same horizontal
    //     line. The dragged corner's X is still free (follows the mouse).
    //       - Dragging TL (0) → TL's Y snaps to TR (1)'s Y
    //       - Dragging TR (1) → TR's Y snaps to TL (0)'s Y
    //       - Dragging BR (2) → BR's Y snaps to BL (3)'s Y
    //       - Dragging BL (3) → BL's Y snaps to BR (2)'s Y
    //
    //   Alt + Ctrl              → VERTICAL align
    //     The DRAGGED corner's X locks to its vertical partner's X, so both
    //     left corners (or both right corners) end up on the same vertical
    //     line. The dragged corner's Y is still free (follows the mouse).
    //       - Dragging TL (0) → TL's X snaps to BL (3)'s X
    //       - Dragging TR (1) → TR's X snaps to BR (2)'s X
    //       - Dragging BR (2) → BR's X snaps to TR (1)'s X
    //       - Dragging BL (3) → BL's X snaps to TL (0)'s X
    //
    //   Alt + Shift + Ctrl      → BOTH (horizontal + vertical)
    //     The dragged corner snaps to (verticalPartner.X, horizontalPartner.Y).
    //     Both partner corners stay fixed. For corners 0/2 the two partners are
    //     distinct (1 and 3); for corners 1/3 they're also distinct (0 and 2).
    const alignH = !!shiftHeld;
    const alignV = !!ctrlHeld;
    const hPartner = horizontalAlignPartnerIndex(cornerIndex);
    const vPartner = verticalAlignPartnerIndex(cornerIndex);

    // When an alignment modifier is held, the DRAGGED corner snaps to its
    // partner corner's coordinate (the partner stays put). This is the inverse
    // of the older behavior where the partner moved to meet the dragged corner.
    //   Alt+Shift        → dragged corner's Y locks to the horizontal partner's Y
    //   Alt+Ctrl         → dragged corner's X locks to the vertical partner's X
    //   Alt+Shift+Ctrl   → dragged corner snaps to (vPartner.X, hPartner.Y)
    // The free (unconstrained) axis keeps its snapped value from above so the
    // corner still follows the mouse along the unconstrained direction.
    let draggedX = newCornerX;
    let draggedY = newCornerY;
    if (alignH) {
      draggedY = origCorners[hPartner].y;
    }
    if (alignV) {
      draggedX = origCorners[vPartner].x;
    }

    const newCorners: Point[] = origCorners.map((c, i) => {
      if (i === cornerIndex) {
        return { x: draggedX, y: draggedY };
      }
      return { x: c.x, y: c.y };
    });

    // Recompute the bounding box from the 4 corners so the element's
    // x/y/width/height always wraps the custom shape (keeps selection,
    // dragging, snapping, alignment and grouping working on the bbox).
    // NOTE: During the drag we do NOT mutate the elements array — that would
    // cause the entire <Canvas> (subscribed to s.elements) to re-render on
    // every mousemove, producing visible lag. Instead we write the live corner
    // points to cornerDragPreview, which only the dragged rectangle's
    // renderer subscribes to (via a targeted selector). The final position is
    // committed to elements[] once in stopCornerDrag.
    set({
      cornerDragPreview: {
        elementId,
        corners: newCorners.map((p) => ({ x: p.x, y: p.y })),
      },
      alignmentGuidelines: cornerGuidelines,
    });
  },

  stopCornerDrag: () => {
    // Commit the final preview corner points to the elements array so the
    // change persists (undo was already pushed in startCornerDrag).
    const state = get();
    if (state.cornerDragPreview && state.cornerDragStart) {
      const { elementId, corners } = state.cornerDragPreview;
      const { origBbox, rotation } = state.cornerDragStart;
      const bbox = bboxOfPoints(corners);

      // ── Re-base corner points to preserve visual position on commit ──────
      // During the drag, the renderer pins the rotation pivot (transform-origin)
      // to the ORIGINAL bbox center so the three "fixed" corners don't drift as
      // the dragged corner moves the live bbox. On commit, isCornerDragging
      // becomes false and the pivot reverts to `center` (= the NEW bbox center).
      // If we committed the preview corners as-is, every corner would visually
      // shift by (I − R(θ))·(origCenter − newCenter) — a noticeable jump in a
      // direction that varies with the rotation angle (e.g. ~11px at 45° for a
      // 40px drag, up to the full drag distance at 180°).
      //
      // To keep the on-screen position pixel-perfect across the commit, re-base
      // each corner point so that rotating it around the NEW center produces the
      // same visual as rotating the preview corner around the ORIGINAL center:
      //   visual(c') = center' + R(θ)·(c' − center')   =   visual(c)
      // where center' = bbox(c') (which shifts by the same re-base vector as c').
      // Solving yields the per-corner translation:
      //   rebase = (I − R(θ))·(origCenter − newCenter)
      //   c' = c + rebase
      // (At θ = 0, R(θ) = I so rebase = 0 — non-rotated rects are unaffected.)
      let commitCorners = corners;
      if (rotation !== 0) {
        const origCx = origBbox.x + origBbox.width / 2;
        const origCy = origBbox.y + origBbox.height / 2;
        const newCx = bbox.x + bbox.width / 2;
        const newCy = bbox.y + bbox.height / 2;
        // (origCenter − newCenter)
        const ox = origCx - newCx;
        const oy = origCy - newCy;
        if (Math.abs(ox) > 1e-9 || Math.abs(oy) > 1e-9) {
          const rad = (rotation * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          // R(θ)·(ox,oy) = (ox·cos − oy·sin, ox·sin + oy·cos)
          const rotX = ox * cos - oy * sin;
          const rotY = ox * sin + oy * cos;
          // rebase = (I − R(θ))·(ox,oy) = (ox − rotX, oy − rotY)
          const rebaseX = ox - rotX;
          const rebaseY = oy - rotY;
          commitCorners = corners.map((c) => ({ x: c.x + rebaseX, y: c.y + rebaseY }));
        }
      }

      // Recompute the bbox from the (possibly re-based) commit corners so the
      // element's x/y/width/height exactly wraps the committed cornerPoints.
      // The re-base translates every corner by the same vector, so the bbox
      // shifts by that vector too — using the pre-rebase bbox here would
      // misalign the wrapper from the polygon.
      const commitBbox = commitCorners === corners ? bbox : bboxOfPoints(commitCorners);

      set({
        elements: state.elements.map((el) =>
          el.id === elementId
            ? {
                ...el,
                x: commitBbox.x,
                y: commitBbox.y,
                width: commitBbox.width,
                height: commitBbox.height,
                cornerPoints: commitCorners.map((p) => ({ x: p.x, y: p.y })),
              }
            : el,
        ),
      });
    }
    set({
      isCornerDragging: false,
      draggingCornerIndex: null,
      cornerDragStart: null,
      cornerDragPreview: null,
      alignmentGuidelines: [],
      isDirty: true,
    });
  },

  resetRectCorners: (id) => {
    const state = get();
    const element = state.elements.find((el) => el.id === id);
    if (!element || element.type !== 'rectangle') return;
    state.pushUndo();
    set({
      elements: state.elements.map((el) => {
        if (el.id !== id) return el;
        // Remove cornerPoints — the rectangle reverts to its axis-aligned bbox.
        const { cornerPoints, ...rest } = el;
        void cornerPoints;
        return rest as CanvasElement;
      }),
      isDirty: true,
    });
  },

  // ── Rectangle rotation ─────────────────────────────────────────────────
  // Only rectangles support rotation (per spec). Rotation is set directly
  // from the properties panel / floating card (slider + numeric input) —
  // there is no canvas rotation handle. The angle is normalized to
  // [-180, 180] on write so the displayed value stays bounded even if the
  // user types something like 540° (which becomes 180°).
  setRectRotation: (id, angle) => {
    // Direct rotation set (used by the properties panel slider/input).
    // Normalize to [-180, 180] so the displayed value stays bounded.
    const normalized = normalizeAngle(angle);
    const state = get();
    const element = state.elements.find((el) => el.id === id);
    if (!element || element.type !== 'rectangle') return;
    const props = (element.properties as { type: 'rectangle'; data: RectangleProperties }).data;
    if ((props.rotation ?? 0) === normalized) return;
    state.pushUndo();
    set({
      elements: state.elements.map((el) =>
        el.id === id && el.type === 'rectangle'
          ? {
              ...el,
              properties: {
                type: 'rectangle' as const,
                data: { ...(el.properties as { type: 'rectangle'; data: RectangleProperties }).data, rotation: normalized },
              },
            }
          : el,
      ),
      isDirty: true,
    });
  },

  setShiftHeld: (held) => {
    set({ shiftHeld: held });
  },

  setCtrlHeld: (held) => {
    set({ ctrlHeld: held });
  },

  setAltHeld: (held) => {
    if (!held) {
      // When Alt is released, clear hover state and stop any ACTIVE cell
      // selection drag — but KEEP the persisted selection (selectedTableCells)
      // and its owning table id (tableCellSelectTableId) so the selected
      // cells remain highlighted after the user lets go of Alt. Releasing Alt
      // should only end the in-progress drag, not wipe the selection.
      set({
        altHeld: false,
        hoveredTableCell: null,
        isTableCellSelecting: false,
        tableCellSelectStart: null,
        tableCellSelectEnd: null,
        tableCellSelectBaseline: [],
      });
    } else {
      set({ altHeld: true });
    }
  },

  setHoveredTableCell: (cell) => {
    set({ hoveredTableCell: cell });
  },

  selectTableCell: (tableId, row, col, toggle = true) => {
    const state = get();
    // Only select cells on the currently selected table
    const selectedElement = state.elements.find(el => state.selectedElementIds.includes(el.id) && el.type === 'table');
    if (!selectedElement || selectedElement.id !== tableId) return;

    const key = `${row}-${col}`;
    const existing = state.selectedTableCells;
    const alreadySelected = existing.some(c => `${c.row}-${c.col}` === key);

    if (toggle) {
      if (alreadySelected) {
        // Deselect: remove from selection
        const newSelection = existing.filter(c => `${c.row}-${c.col}` !== key);
        set({
          selectedTableCells: newSelection,
          // If we just removed the last selected cell, clear the owning table
          // so no table highlights anything. Otherwise keep the owner so the
          // remaining selection stays scoped to this table.
          tableCellSelectTableId: newSelection.length > 0 ? tableId : null,
        });
      } else {
        // Select: add to existing selection and mark this table as the owner
        // of the selection (so other tables don't highlight the same coords).
        set({
          selectedTableCells: [...existing, { row, col }],
          tableCellSelectTableId: tableId,
        });
      }
    } else {
      if (alreadySelected && existing.length === 1) {
        // Already the only selection, deselect it (toggle off)
        set({ selectedTableCells: [], tableCellSelectTableId: null });
      } else {
        set({ selectedTableCells: [{ row, col }], tableCellSelectTableId: tableId });
      }
    }
  },

  selectTableCellsRange: (tableId, startRow, startCol, endRow, endCol) => {
    const state = get();
    const selectedElement = state.elements.find(el => state.selectedElementIds.includes(el.id) && el.type === 'table');
    if (!selectedElement || selectedElement.id !== tableId) return;

    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);

    // Build a set of cell keys in the drag range
    const rangeCells = new Set<string>();
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        rangeCells.add(`${r}-${c}`);
      }
    }

    // Toggle mode: start from the baseline snapshot, then toggle each cell in range
    const baseline = state.tableCellSelectBaseline;
    const baselineKeys = new Set(baseline.map(c => `${c.row}-${c.col}`));

    // For each cell in the drag range: if it was in the baseline, remove it; if not, add it
    const result: { row: number; col: number }[] = [];
    // First, keep all baseline cells that are NOT in the drag range
    for (const cell of baseline) {
      if (!rangeCells.has(`${cell.row}-${cell.col}`)) {
        result.push(cell);
      }
    }
    // Then, add all cells in the drag range that were NOT in the baseline
    for (const key of rangeCells) {
      if (!baselineKeys.has(key)) {
        const [r, c] = key.split('-').map(Number);
        result.push({ row: r, col: c });
      }
    }
    set({ selectedTableCells: result });
  },

  startTableCellSelecting: (tableId, row, col, baseline) => {
    const base = baseline ?? [];
    set({
      isTableCellSelecting: true,
      tableCellSelectStart: { row, col },
      tableCellSelectEnd: { row, col },
      tableCellSelectTableId: tableId,
      tableCellSelectBaseline: [...base],
    });
    // Immediately apply toggle for the start cell
    get().selectTableCellsRange(tableId, row, col, row, col);
  },

  updateTableCellSelecting: (row, col) => {
    const state = get();
    if (!state.isTableCellSelecting || !state.tableCellSelectStart || !state.tableCellSelectTableId) return;
    set({ tableCellSelectEnd: { row, col } });
    get().selectTableCellsRange(state.tableCellSelectTableId, state.tableCellSelectStart.row, state.tableCellSelectStart.col, row, col);
  },

  finishTableCellSelecting: () => {
    set({
      isTableCellSelecting: false,
      tableCellSelectStart: null,
      tableCellSelectEnd: null,
    });
    // Keep tableCellSelectTableId and selectedTableCells so the selection persists
  },

  clearTableCellSelection: () => {
    set({
      selectedTableCells: [],
      isTableCellSelecting: false,
      tableCellSelectStart: null,
      tableCellSelectEnd: null,
      tableCellSelectTableId: null,
      tableCellSelectBaseline: [],
    });
  },

  // ── Table Column/Row Resize ──────────────────────────────────────────────────
  // NOTE: Table resize must work for tables that live INSIDE a group (a group
  // child). Such elements are nested in a group's `children` array, not at the
  // top level of `state.elements`, so a plain `elements.find()` misses them.
  // We use `findElementById` (recursive) for lookups and the pure helper below
  // for writes — mirroring `updateElementProperties`' recursion but WITHOUT the
  // debounced-undo side effect, because each drag already pushes one undo
  // snapshot at drag start (`startTableColResize`/`startTableRowResize`).
  startTableColResize: (elementId, colIndex, clientX) => {
    const state = get();
    const element = state.findElementById(elementId);
    if (!element || element.type !== 'table') return;
    state.pushUndo();
    const props = (element.properties as { type: 'table'; data: TableProperties }).data;
    const colWidths = ensureColWidths(props.cols, props.colWidths);
    set({
      isTableColResizing: true,
      isTableRowResizing: false,
      tableResizeData: {
        elementId,
        type: 'col',
        index: colIndex,
        initialMousePos: clientX,
        initialSizes: [...colWidths],
        initialTotalSize: element.width,
      },
    });
  },

  startTableRowResize: (elementId, rowIndex, clientY) => {
    const state = get();
    const element = state.findElementById(elementId);
    if (!element || element.type !== 'table') return;
    state.pushUndo();
    const props = (element.properties as { type: 'table'; data: TableProperties }).data;
    const rowHeights = ensureRowHeights(props.rows, props.rowHeights);
    set({
      isTableColResizing: false,
      isTableRowResizing: true,
      tableResizeData: {
        elementId,
        type: 'row',
        index: rowIndex,
        initialMousePos: clientY,
        initialSizes: [...rowHeights],
        initialTotalSize: element.height,
      },
    });
  },

  updateTableResize: (clientX, clientY) => {
    const state = get();
    const data = state.tableResizeData;
    if (!data) return;

    const element = state.findElementById(data.elementId);
    if (!element || element.type !== 'table') return;

    const props = (element.properties as { type: 'table'; data: TableProperties }).data;
    const zoom = state.zoom;
    const currentPos = data.type === 'col' ? clientX : clientY;
    const deltaPx = (currentPos - data.initialMousePos) / zoom;
    const totalFr = data.initialSizes.reduce((a, b) => a + b, 0);
    const deltaFr = (deltaPx / data.initialTotalSize) * totalFr;

    // Minimum size per column/row, expressed as a fraction of the total. This
    // prevents columns/rows from being dragged so close to each other that they
    // collapse or overlap. ~4% of the total table dimension (e.g. ~8px on a
    // 200px-wide table) keeps a visible gap while still allowing tight layouts.
    const MIN_FR = totalFr * 0.04;

    const newSizes = [...data.initialSizes];
    const idx = data.index;
    // The drag moves the boundary between column/row `idx` and `idx+1`.
    // Enforce a minimum on BOTH so neither can collapse below MIN_FR — if the
    // drag would shrink one past its minimum, clamp the delta so it stops.
    const proposedA = data.initialSizes[idx] + deltaFr;
    const proposedB = data.initialSizes[idx + 1] - deltaFr;
    if (proposedA < MIN_FR) {
      // Dragged too far toward B — clamp A to its minimum and B takes the rest.
      newSizes[idx] = MIN_FR;
      newSizes[idx + 1] = data.initialSizes[idx] + data.initialSizes[idx + 1] - MIN_FR;
    } else if (proposedB < MIN_FR) {
      // Dragged too far toward A — clamp B to its minimum and A takes the rest.
      newSizes[idx] = data.initialSizes[idx] + data.initialSizes[idx + 1] - MIN_FR;
      newSizes[idx + 1] = MIN_FR;
    } else {
      newSizes[idx] = proposedA;
      newSizes[idx + 1] = proposedB;
    }

    const updatedProps = data.type === 'col'
      ? { ...props, colWidths: newSizes }
      : { ...props, rowHeights: newSizes };

    const newProperties: ElementProperties = { type: 'table', data: updatedProps };

    invalidateSnapCache();
    // Recursively update the table's properties whether it is a top-level
    // element OR a child nested inside a group. A plain `elements.map` only
    // touches top-level elements, so group-child tables never received the
    // resize — which is why dragging a column/row did nothing when the table
    // was part of a group.
    set((s) => ({
      elements: setElementPropertiesInTree(s.elements, data.elementId, newProperties),
      isDirty: true,
    }));
  },

  stopTableResize: () => {
    set({ isTableColResizing: false, isTableRowResizing: false, tableResizeData: null });
  },

  bringToFront: (id) => {
    get().pushUndo();
    // Bug #17 fix: Support group children by checking if the element
    // is inside a group and reordering within the group's children array.
    const state = get();
    const parentGroup = state.findParentGroup(id);
    if (parentGroup) {
      const child = parentGroup.children?.find((c) => c.id === id);
      if (!child) return;
      set({
        elements: state.elements.map((el) => {
          if (el.id === parentGroup.id && el.type === 'group' && el.children) {
            return { ...el, children: [...el.children.filter((c) => c.id !== id), child] };
          }
          return el;
        }),
        isDirty: true,
      });
    } else {
      set((state) => {
        const element = state.elements.find((el) => el.id === id);
        if (!element) return state;
        return {
          elements: [...state.elements.filter((el) => el.id !== id), element],
          isDirty: true,
        };
      });
    }
  },

  sendToBack: (id) => {
    get().pushUndo();
    // Bug #17 fix: Support group children by checking if the element
    // is inside a group and reordering within the group's children array.
    const state = get();
    const parentGroup = state.findParentGroup(id);
    if (parentGroup) {
      const child = parentGroup.children?.find((c) => c.id === id);
      if (!child) return;
      set({
        elements: state.elements.map((el) => {
          if (el.id === parentGroup.id && el.type === 'group' && el.children) {
            return { ...el, children: [child, ...el.children.filter((c) => c.id !== id)] };
          }
          return el;
        }),
        isDirty: true,
      });
    } else {
      set((state) => {
        const element = state.elements.find((el) => el.id === id);
        if (!element) return state;
        return {
          elements: [element, ...state.elements.filter((el) => el.id !== id)],
          isDirty: true,
        };
      });
    }
  },

  copyElement: () => {
    const state = get();
    if (state.selectedElementIds.length === 0) return;
    // Copy ALL selected elements to the multi-element clipboard.
    // Also maintain the legacy single-element clipboard for backward compat.
    const copiedElements = state.selectedElementIds
      .map((id) => state.findElementById(id))
      .filter((el): el is CanvasElement => el !== null);
    if (copiedElements.length === 0) return;
    set({
      clipboardElements: structuredClone(copiedElements),
      clipboardElement: structuredClone(copiedElements[0]),
    });
  },

  pasteElement: () => {
    invalidateSnapCache();
    const state = get();

    // Prefer multi-element clipboard if available
    if (state.clipboardElements.length > 0) {
      state.pushUndo();
      const counter = { ...state.elementCounter };
      const newElements: CanvasElement[] = [];
      const newSelectionIds: string[] = [];

      for (const clipEl of state.clipboardElements) {
        counter[clipEl.type] += 1;
        const reIdedClip = reIdElement(clipEl);
        const newEl: CanvasElement = {
          ...reIdedClip,
          x: clipEl.x + 20,
          y: clipEl.y + 20,
          name: getDefaultName(clipEl.type, counter[clipEl.type]),
          // Offset rectangle corner points by the same +20,+20 paste offset
          ...(reIdedClip.cornerPoints
            ? { cornerPoints: reIdedClip.cornerPoints.map((p) => ({ x: p.x + 20, y: p.y + 20 })) }
            : {}),
        };
        newElements.push(newEl);
        newSelectionIds.push(newEl.id);
      }

      if (state.editingGroupId) {
        set({
          elements: state.elements.map((el) => {
            if (el.id === state.editingGroupId && el.type === 'group' && el.children) {
              return { ...el, children: [...el.children, ...newElements] };
            }
            return el;
          }),
          selectedElementIds: newSelectionIds,
          selectedElementId: deriveSelectedElementId(newSelectionIds),
          elementCounter: counter,
          isDirty: true,
        });
        queueMicrotask(() => get().recalculateGroupBounds(state.editingGroupId!));
      } else {
        set({
          elements: [...state.elements, ...newElements],
          selectedElementIds: newSelectionIds,
          selectedElementId: deriveSelectedElementId(newSelectionIds),
          elementCounter: counter,
          isDirty: true,
        });
      }
      return;
    }

    // Fallback: legacy single-element clipboard
    if (!state.clipboardElement) return;
    state.pushUndo();
    const counter = { ...state.elementCounter };
    counter[state.clipboardElement.type] += 1;

    const reIdedClipEl = reIdElement(state.clipboardElement);
    const newElement: CanvasElement = {
      ...reIdedClipEl,
      x: state.clipboardElement.x + 20,
      y: state.clipboardElement.y + 20,
      name: getDefaultName(state.clipboardElement.type, counter[state.clipboardElement.type]),
      ...(reIdedClipEl.cornerPoints
        ? { cornerPoints: reIdedClipEl.cornerPoints.map((p) => ({ x: p.x + 20, y: p.y + 20 })) }
        : {}),
    };
    const newSelection = [newElement.id];

    if (state.editingGroupId) {
      set({
        elements: state.elements.map((el) => {
          if (el.id === state.editingGroupId && el.type === 'group' && el.children) {
            return { ...el, children: [...el.children, newElement] };
          }
          return el;
        }),
        selectedElementIds: newSelection,
        selectedElementId: deriveSelectedElementId(newSelection),
        elementCounter: counter,
        isDirty: true,
      });
      queueMicrotask(() => get().recalculateGroupBounds(state.editingGroupId!));
    } else {
      set({
        elements: [...state.elements, newElement],
        selectedElementIds: newSelection,
        selectedElementId: deriveSelectedElementId(newSelection),
        elementCounter: counter,
        isDirty: true,
      });
    }
  },

  cutElement: () => {
    invalidateSnapCache();
    const state = get();
    if (state.selectedElementIds.length === 0) return;

    // Copy ALL selected elements to clipboard, then remove them
    const copiedElements = state.selectedElementIds
      .map((id) => state.findElementById(id))
      .filter((el): el is CanvasElement => el !== null);
    if (copiedElements.length === 0) return;

    state.pushUndo();
    set({
      clipboardElements: structuredClone(copiedElements),
      clipboardElement: structuredClone(copiedElements[0]),
    });

    // Remove all selected elements (iterate a copy since removeElement mutates state)
    const idsToRemove = [...state.selectedElementIds];
    for (const id of idsToRemove) {
      get().removeElement(id);
    }
  },

  pasteElementInPlace: () => {
    invalidateSnapCache();
    const state = get();

    // Prefer multi-element clipboard if available
    if (state.clipboardElements.length > 0) {
      state.pushUndo();
      const counter = { ...state.elementCounter };
      const newElements: CanvasElement[] = [];
      const newSelectionIds: string[] = [];

      for (const clipEl of state.clipboardElements) {
        counter[clipEl.type] += 1;
        const newEl: CanvasElement = {
          ...reIdElement(clipEl),
          x: clipEl.x,
          y: clipEl.y,
          name: getDefaultName(clipEl.type, counter[clipEl.type]),
        };
        newElements.push(newEl);
        newSelectionIds.push(newEl.id);
      }

      if (state.editingGroupId) {
        set({
          elements: state.elements.map((el) => {
            if (el.id === state.editingGroupId && el.type === 'group' && el.children) {
              return { ...el, children: [...el.children, ...newElements] };
            }
            return el;
          }),
          selectedElementIds: newSelectionIds,
          selectedElementId: deriveSelectedElementId(newSelectionIds),
          elementCounter: counter,
          isDirty: true,
        });
        queueMicrotask(() => get().recalculateGroupBounds(state.editingGroupId!));
      } else {
        set({
          elements: [...state.elements, ...newElements],
          selectedElementIds: newSelectionIds,
          selectedElementId: deriveSelectedElementId(newSelectionIds),
          elementCounter: counter,
          isDirty: true,
        });
      }
      return;
    }

    // Fallback: legacy single-element clipboard
    if (!state.clipboardElement) return;
    state.pushUndo();
    const counter = { ...state.elementCounter };
    counter[state.clipboardElement.type] += 1;

    const newElement: CanvasElement = {
      ...reIdElement(state.clipboardElement),
      x: state.clipboardElement.x,
      y: state.clipboardElement.y,
      name: getDefaultName(state.clipboardElement.type, counter[state.clipboardElement.type]),
    };
    const newSelection = [newElement.id];

    if (state.editingGroupId) {
      set({
        elements: state.elements.map((el) => {
          if (el.id === state.editingGroupId && el.type === 'group' && el.children) {
            return { ...el, children: [...el.children, newElement] };
          }
          return el;
        }),
        selectedElementIds: newSelection,
        selectedElementId: deriveSelectedElementId(newSelection),
        elementCounter: counter,
        isDirty: true,
      });
      queueMicrotask(() => get().recalculateGroupBounds(state.editingGroupId!));
    } else {
      set({
        elements: [...state.elements, newElement],
        selectedElementIds: newSelection,
        selectedElementId: deriveSelectedElementId(newSelection),
        elementCounter: counter,
        isDirty: true,
      });
    }
  },

  zoomIn: () => {
    const state = get();
    const step = state.zoomStep / 100;
    set({ zoom: Math.min(50, +(state.zoom + step).toFixed(2)) });
  },

  zoomOut: () => {
    const state = get();
    const step = state.zoomStep / 100;
    set({ zoom: Math.max(0.01, +(state.zoom - step).toFixed(2)) });
  },

  resetZoom: () => {
    // "Reset Zoom" (Ctrl+0 / View menu) should behave like the "Fit to screen"
    // button — it fits the page to the viewport with proper centering (including
    // the slight leftward shift toward the tool panel). Previously this set
    // zoom=1, pan=0,0 which left the page at the top-left corner at 100% zoom.
    // Route through fitToPage using the live canvas viewport dimensions so the
    // behavior matches the Fit buttons exactly.
    const viewport = typeof document !== 'undefined'
      ? (document.querySelector('.canvas-viewport') as HTMLElement | null)
      : null;
    if (viewport) {
      get().fitToPage(viewport.clientWidth, viewport.clientHeight);
    } else {
      // Fallback (e.g. during SSR or before the canvas mounts): keep the page
      // visible at a reasonable default instead of parking at the top-left.
      set({ zoom: 1, panX: 0, panY: 0 });
    }
  },

  zoomAtPoint: (newZoom, pivotX, pivotY) => {
    const state = get();
    const oldZoom = state.zoom;
    const clampedZoom = Math.min(50, Math.max(0.01, newZoom));

    // Keep the canvas point under the pivot fixed
    const newPanX = pivotX / clampedZoom - (pivotX / oldZoom - state.panX);
    const newPanY = pivotY / clampedZoom - (pivotY / oldZoom - state.panY);

    set({ zoom: clampedZoom, panX: newPanX, panY: newPanY });
  },

  toggleLock: (id) => {
    get().pushUndo();
    set((state) => ({
      elements: state.elements.map((el) => {
        if (el.id === id) return { ...el, locked: !el.locked };
        if (el.type === 'group' && el.children) {
          const childIndex = el.children.findIndex((c) => c.id === id);
          if (childIndex !== -1) {
            const newChildren = [...el.children];
            newChildren[childIndex] = { ...newChildren[childIndex], locked: !newChildren[childIndex].locked };
            return { ...el, children: newChildren };
          }
        }
        return el;
      }),
      isDirty: true,
    }));
  },

  toggleVisibility: (id) => {
    get().pushUndo();
    set((state) => ({
      elements: state.elements.map((el) => {
        if (el.id === id) return { ...el, visible: !el.visible };
        if (el.type === 'group' && el.children) {
          const childIndex = el.children.findIndex((c) => c.id === id);
          if (childIndex !== -1) {
            const newChildren = [...el.children];
            newChildren[childIndex] = { ...newChildren[childIndex], visible: !newChildren[childIndex].visible };
            return { ...el, children: newChildren };
          }
        }
        return el;
      }),
      isDirty: true,
    }));
  },

  updateCanvasSettings: (settings) => {
    get().pushUndo();
    set((state) => ({
      canvasSettings: { ...state.canvasSettings, ...settings },
      isDirty: true,
    }));
  },

  setSettingsOpen: (open) => {
    set({ settingsOpen: open });
  },

  setZoomStep: (step) => {
    set({ zoomStep: Math.max(1, Math.min(100, step)) });
  },

  setSnapEnabled: (enabled) => {
    set({ snapEnabled: enabled, alignmentGuidelines: [] });
  },

  setSnapToGrid: (enabled) => {
    set({ snapToGrid: enabled });
  },

  setSnapToElements: (enabled) => {
    set({ snapToElements: enabled });
  },

  setSnapUnit: (unit) => {
    set({ snapUnit: Math.max(1, unit) });
  },

  setAlignmentGuidelines: (guides) => {
    set({ alignmentGuidelines: guides });
  },

  clearAlignmentGuidelines: () => {
    set({ alignmentGuidelines: [] });
  },

  moveElementByKeys: (dx, dy, skipSnap = false) => {
    const state = get();
    if (state.selectedElementIds.length === 0) return;

    const primaryId = state.selectedElementIds[0];
    // Bug fix: Use findElementById to support group children
    const primaryElement = state.findElementById(primaryId);
    if (!primaryElement || primaryElement.locked) return;

    // Bug #20 fix: Debounce undo pushes for arrow key movement so that
    // holding an arrow key creates a single undo entry instead of one per
    // keypress. Uses the same debounced undo mechanism as property changes.
    debouncedPropertyPushUndo(state);

    // For arrow key movement, we always apply the raw step — no position snapping.
    // This prevents elements from getting "stuck" at snap points when the step
    // is smaller than the snap threshold. We still compute snap guidelines so the
    // user sees alignment feedback without the position being overridden.
    // When skipSnap is true (Alt held), skip snap guideline computation entirely.
    let guidelines: AlignmentGuide[] = [];
    if (state.snapEnabled && !skipSnap) {
      const others = state.elements.filter((e) => !state.selectedElementIds.includes(e.id));
      const proposedX = primaryElement.x + dx;
      const proposedY = primaryElement.y + dy;
      // For line elements, pass endpoint coordinates so snapping uses the line's
      // visual center (midpoint of endpoints) instead of the thin bounding box
      const lineEndpoints = primaryElement.type === 'line' && primaryElement.lineStartX !== undefined
        ? {
            startX: (primaryElement.lineStartX - primaryElement.x) + proposedX,
            startY: (primaryElement.lineStartY! - primaryElement.y) + proposedY,
            endX: (primaryElement.lineEndX! - primaryElement.x) + proposedX,
            endY: (primaryElement.lineEndY! - primaryElement.y) + proposedY,
          }
        : undefined;
      // For deformed rectangles, pass the corner points (shifted to the proposed
      // position) so snapping considers ALL corner positions — including inner
      // (deformed-inward) corners — not just the bounding box edges.
      const cornerPoints = primaryElement.type === 'rectangle' && primaryElement.cornerPoints
        ? primaryElement.cornerPoints.map((p) => ({
            x: p.x + (proposedX - primaryElement.x),
            y: p.y + (proposedY - primaryElement.y),
          }))
        : undefined;
      const snapResult = calculateSnapForPosition(
        primaryId,
        proposedX,
        proposedY,
        primaryElement.width,
        primaryElement.height,
        others,
        state.snapToElements,
        state.snapToGrid,
        state.snapUnit,
        state.canvasSettings.pageWidth,
        state.canvasSettings.pageHeight,
        lineEndpoints,
        state.canvasSettings.marginTop,
        state.canvasSettings.marginBottom,
        state.canvasSettings.marginLeft,
        state.canvasSettings.marginRight,
        undefined,
        getElementBorderWidth(primaryElement),
        cornerPoints,
        primaryElement,
      );
      // Guidelines are visual-only for arrow key movement
      guidelines = snapResult.guidelines;
    }

    // Build a Set of selected IDs for O(1) lookup. This is important for
    // multi-selection performance (avoids O(n*m) with Array.includes inside
    // the map), and also makes the intent explicit: EVERY selected element
    // gets the delta applied.
    const selectedIdSet = new Set(state.selectedElementIds);

    // Apply the same delta to ALL selected elements (always raw step).
    // Also handle group children when in group-edit mode — a selected group
    // child's position is stored relative to its parent group, so we update
    // the child inside the group's children array.
    set({
      elements: state.elements.map((el) => {
        // Case 1: This top-level element IS selected → apply delta.
        if (selectedIdSet.has(el.id)) {
          if (el.locked) return el;
          if (el.type === 'line' && el.lineStartX !== undefined) {
            return {
              ...el,
              x: el.x + dx,
              y: el.y + dy,
              lineStartX: el.lineStartX + dx,
              lineStartY: el.lineStartY! + dy,
              lineEndX: el.lineEndX! + dx,
              lineEndY: el.lineEndY! + dy,
            };
          }
          // For deformed rectangles, translate the corner points by the same
          // delta so the shape moves together with the element position.
          if (el.cornerPoints) {
            return {
              ...el,
              x: el.x + dx,
              y: el.y + dy,
              cornerPoints: el.cornerPoints.map((p) => ({ x: p.x + dx, y: p.y + dy })),
            };
          }
          return { ...el, x: el.x + dx, y: el.y + dy };
        }

        // Case 2: This element is a group that's being edited, and some of
        // its children are selected → update those selected children inside
        // the group's children array.
        if (state.editingGroupId && el.id === state.editingGroupId && el.type === 'group' && el.children) {
          let childChanged = false;
          const newChildren = el.children.map((c) => {
            if (!selectedIdSet.has(c.id) || c.locked) return c;
            childChanged = true;
            if (c.type === 'line' && c.lineStartX !== undefined) {
              return {
                ...c,
                x: c.x + dx,
                y: c.y + dy,
                lineStartX: c.lineStartX + dx,
                lineStartY: c.lineStartY! + dy,
                lineEndX: c.lineEndX! + dx,
                lineEndY: c.lineEndY! + dy,
              };
            }
            // For deformed rectangles, translate corner points too
            if (c.cornerPoints) {
              return {
                ...c,
                x: c.x + dx,
                y: c.y + dy,
                cornerPoints: c.cornerPoints.map((p) => ({ x: p.x + dx, y: p.y + dy })),
              };
            }
            return { ...c, x: c.x + dx, y: c.y + dy };
          });
          return childChanged ? { ...el, children: newChildren } : el;
        }

        // Case 3: Not selected, not the editing group → unchanged.
        return el;
      }),
      alignmentGuidelines: guidelines,
      isDirty: true,
    });
  },

  alignElementHorizontalCenter: (id) => {
    const state = get();
    const element = state.elements.find((el) => el.id === id);
    if (!element || element.locked) return;

    state.pushUndo();

    const pageCenterX = state.canvasSettings.pageWidth / 2;
    const newX = pageCenterX - element.width / 2;

    set({
      elements: state.elements.map((el) => {
        if (el.id !== id) return el;
        return moveElementWithLineDelta(el, { x: newX });
      }),
      // Show a vertical guideline at the page center for visual feedback
      alignmentGuidelines: [{
        orientation: 'vertical',
        position: pageCenterX,
        start: 0,
        end: state.canvasSettings.pageHeight,
      }],
      isDirty: true,
    });

    // Clear the guideline after a short delay. Cancel any pending guideline
    // timer first so rapid alignment actions don't accumulate stale timers.
    if (alignmentGuidelineTimer) clearTimeout(alignmentGuidelineTimer);
    alignmentGuidelineTimer = setTimeout(() => {
      alignmentGuidelineTimer = null;
      const currentState = get();
      // Only clear if the guidelines haven't changed (i.e., no new drag started)
      if (currentState.alignmentGuidelines.length === 1 &&
          currentState.alignmentGuidelines[0].orientation === 'vertical' &&
          currentState.alignmentGuidelines[0].position === pageCenterX) {
        get().clearAlignmentGuidelines();
      }
    }, 800);
  },

  alignElementVerticalCenter: (id) => {
    const state = get();
    const element = state.elements.find((el) => el.id === id);
    if (!element || element.locked) return;

    state.pushUndo();

    const pageCenterY = state.canvasSettings.pageHeight / 2;
    const newY = pageCenterY - element.height / 2;

    set({
      elements: state.elements.map((el) => {
        if (el.id !== id) return el;
        return moveElementWithLineDelta(el, { y: newY });
      }),
      // Show a horizontal guideline at the page center for visual feedback
      alignmentGuidelines: [{
        orientation: 'horizontal',
        position: pageCenterY,
        start: 0,
        end: state.canvasSettings.pageWidth,
      }],
      isDirty: true,
    });

    // Clear the guideline after a short delay. Cancel any pending guideline
    // timer first so rapid alignment actions don't accumulate stale timers.
    if (alignmentGuidelineTimer) clearTimeout(alignmentGuidelineTimer);
    alignmentGuidelineTimer = setTimeout(() => {
      alignmentGuidelineTimer = null;
      const currentState = get();
      if (currentState.alignmentGuidelines.length === 1 &&
          currentState.alignmentGuidelines[0].orientation === 'horizontal' &&
          currentState.alignmentGuidelines[0].position === pageCenterY) {
        get().clearAlignmentGuidelines();
      }
    }, 800);
  },

  alignElementsHorizontalCenter: (ids) => {
    // Align a GROUP of elements to the page center as a block. Computes the
    // selection's bounding-box center, then shifts ALL elements by the same
    // horizontal delta so their relative positions are preserved (exactly like
    // aligning a grouped element). Falls back to single-element align when only
    // one id is passed.
    const state = get();
    if (ids.length === 0) return;
    if (ids.length === 1) { get().alignElementHorizontalCenter(ids[0]); return; }

    const idSet = new Set(ids);
    // Collect selected elements from both root and group children (group-edit mode)
    const selected: CanvasElement[] = [];
    for (const el of state.elements) {
      if (idSet.has(el.id)) selected.push(el);
      else if (el.type === 'group' && el.children) {
        for (const c of el.children) if (idSet.has(c.id)) selected.push(c);
      }
    }
    if (selected.length === 0) return;

    state.pushUndo();

    const pageCenterX = state.canvasSettings.pageWidth / 2;
    // Selection bbox center X
    const minX = Math.min(...selected.map(e => e.x));
    const maxX = Math.max(...selected.map(e => e.x + e.width));
    const selectionCenterX = (minX + maxX) / 2;
    const dx = pageCenterX - selectionCenterX;

    if (Math.abs(dx) < 0.01) return;

    set((s) => ({
      elements: s.elements.map((el) => {
        if (idSet.has(el.id)) {
          return moveElementWithLineDelta(el, { x: el.x + dx });
        }
        if (el.type === 'group' && el.children) {
          let childChanged = false;
          const newChildren = el.children.map((c) => {
            if (idSet.has(c.id)) {
              childChanged = true;
              return moveElementWithLineDelta(c, { x: c.x + dx });
            }
            return c;
          });
          if (childChanged) return { ...el, children: newChildren };
        }
        return el;
      }),
      alignmentGuidelines: [{
        orientation: 'vertical',
        position: pageCenterX,
        start: 0,
        end: state.canvasSettings.pageHeight,
      }],
      isDirty: true,
    }));

    if (alignmentGuidelineTimer) clearTimeout(alignmentGuidelineTimer);
    alignmentGuidelineTimer = setTimeout(() => {
      alignmentGuidelineTimer = null;
      const currentState = get();
      if (currentState.alignmentGuidelines.length === 1 &&
          currentState.alignmentGuidelines[0].orientation === 'vertical' &&
          currentState.alignmentGuidelines[0].position === pageCenterX) {
        get().clearAlignmentGuidelines();
      }
    }, 800);
  },

  alignElementsVerticalCenter: (ids) => {
    // Align a GROUP of elements to the page center as a block (vertical).
    // See alignElementsHorizontalCenter for the full rationale.
    const state = get();
    if (ids.length === 0) return;
    if (ids.length === 1) { get().alignElementVerticalCenter(ids[0]); return; }

    const idSet = new Set(ids);
    const selected: CanvasElement[] = [];
    for (const el of state.elements) {
      if (idSet.has(el.id)) selected.push(el);
      else if (el.type === 'group' && el.children) {
        for (const c of el.children) if (idSet.has(c.id)) selected.push(c);
      }
    }
    if (selected.length === 0) return;

    state.pushUndo();

    const pageCenterY = state.canvasSettings.pageHeight / 2;
    const minY = Math.min(...selected.map(e => e.y));
    const maxY = Math.max(...selected.map(e => e.y + e.height));
    const selectionCenterY = (minY + maxY) / 2;
    const dy = pageCenterY - selectionCenterY;

    if (Math.abs(dy) < 0.01) return;

    set((s) => ({
      elements: s.elements.map((el) => {
        if (idSet.has(el.id)) {
          return moveElementWithLineDelta(el, { y: el.y + dy });
        }
        if (el.type === 'group' && el.children) {
          let childChanged = false;
          const newChildren = el.children.map((c) => {
            if (idSet.has(c.id)) {
              childChanged = true;
              return moveElementWithLineDelta(c, { y: c.y + dy });
            }
            return c;
          });
          if (childChanged) return { ...el, children: newChildren };
        }
        return el;
      }),
      alignmentGuidelines: [{
        orientation: 'horizontal',
        position: pageCenterY,
        start: 0,
        end: state.canvasSettings.pageWidth,
      }],
      isDirty: true,
    }));

    if (alignmentGuidelineTimer) clearTimeout(alignmentGuidelineTimer);
    alignmentGuidelineTimer = setTimeout(() => {
      alignmentGuidelineTimer = null;
      const currentState = get();
      if (currentState.alignmentGuidelines.length === 1 &&
          currentState.alignmentGuidelines[0].orientation === 'horizontal' &&
          currentState.alignmentGuidelines[0].position === pageCenterY) {
        get().clearAlignmentGuidelines();
      }
    }, 800);
  },

  setElementsOpacity: (ids, opacity) => {
    // Set the top-level element.opacity on multiple elements at once. Used by
    // the multi-select and group Opacity floating card. Clamps to [0,1]. Uses
    // a debounced undo so dragging the slider doesn't flood the undo stack.
    const state = get();
    const clamped = Math.max(0, Math.min(1, opacity));
    const idSet = new Set(ids);
    debouncedPropertyPushUndo(state);
    set((s) => ({
      elements: s.elements.map((el) => {
        if (idSet.has(el.id)) {
          return { ...el, opacity: clamped };
        }
        // Also handle group children whose id matches (when a group child is
        // part of the multi-select via group-edit mode)
        if (el.type === 'group' && el.children) {
          let childChanged = false;
          const newChildren = el.children.map((c) => {
            if (idSet.has(c.id)) {
              childChanged = true;
              return { ...c, opacity: clamped };
            }
            return c;
          });
          if (childChanged) return { ...el, children: newChildren };
        }
        return el;
      }),
      isDirty: true,
    }));
  },

  reorderElement: (fromIndex, toIndex) => {
    invalidateSnapCache();
    get().pushUndo();
    set((state) => {
      if (fromIndex === toIndex) return state;
      if (fromIndex < 0 || fromIndex >= state.elements.length) return state;
      if (toIndex < 0 || toIndex >= state.elements.length) return state;

      const newElements = [...state.elements];
      const [moved] = newElements.splice(fromIndex, 1);
      newElements.splice(toIndex, 0, moved);

      return { elements: newElements, isDirty: true };
    });
  },

  // ── Undo / Redo implementation ──────────────────────────────────────────
  flushPropertyUndo: () => {
    flushPropertyUndo();
  },

  pushUndo: () => {
    // Flush any pending debounced property undo first to maintain correct order
    flushPropertyUndo();
    const state = get();
    const snapshot = takeSnapshot(state);
    const newUndoStack = [...state.undoStack, snapshot];
    // Trim to max size
    if (newUndoStack.length > MAX_UNDO_HISTORY) {
      newUndoStack.shift();
    }
    set({
      undoStack: newUndoStack,
      redoStack: [], // any new action clears the redo stack
      canUndo: true,
      canRedo: false,
    });
  },

  undo: () => {
    invalidateSnapCache();
    // If there's a pending debounced property snapshot, we need to handle it
    // carefully. The pending snapshot captures the "before" state of an
    // in-progress property edit. If we simply flush (commit) it, undo would
    // then pop it right back off — effectively doing nothing. Instead, we
    // cancel the pending snapshot: the user wants to undo past the property
    // change, so we just revert to the last committed undo entry.
    cancelPropertyUndo();

    const state = get();
    if (state.undoStack.length === 0) return;

    // Save current state to redo stack
    const currentSnapshot = takeSnapshot(state);
    const newRedoStack = [...state.redoStack, currentSnapshot];

    // Pop the last snapshot from undo stack
    const newUndoStack = [...state.undoStack];
    const previous = newUndoStack.pop()!;

    set({
      elements: previous.elements,
      elementCounter: previous.elementCounter,
      canvasSettings: previous.canvasSettings,
      selectedElementIds: [],
      selectedElementId: null,
      undoStack: newUndoStack,
      redoStack: newRedoStack,
      canUndo: newUndoStack.length > 0,
      canRedo: true,
      alignmentGuidelines: [],
      isDirty: true,
    });
  },

  redo: () => {
    invalidateSnapCache();
    // Cancel any pending debounced property undo — redo invalidates the
    // in-progress edit just like any other new action.
    cancelPropertyUndo();

    const state = get();
    if (state.redoStack.length === 0) return;

    // Save current state to undo stack
    const currentSnapshot = takeSnapshot(state);
    const newUndoStack = [...state.undoStack, currentSnapshot];

    // Pop the last snapshot from redo stack
    const newRedoStack = [...state.redoStack];
    const next = newRedoStack.pop()!;

    set({
      elements: next.elements,
      elementCounter: next.elementCounter,
      canvasSettings: next.canvasSettings,
      selectedElementIds: [],
      selectedElementId: null,
      undoStack: newUndoStack,
      redoStack: newRedoStack,
      canUndo: true,
      canRedo: newRedoStack.length > 0,
      alignmentGuidelines: [],
      isDirty: true,
    });
  },

  // ── Project Save / Load ────────────────────────────────────────────────────

  saveProject: async () => {
    const state = get();

    let project;
    try {
      project = serializeProject({
        elements: state.elements,
        elementCounter: state.elementCounter,
        canvasSettings: state.canvasSettings,
        snapEnabled: state.snapEnabled,
        snapToGrid: state.snapToGrid,
        snapToElements: state.snapToElements,
        snapUnit: state.snapUnit,
        zoomStep: state.zoomStep,
        projectName: state.projectName,
      });
    } catch (err) {
      console.error('[saveProject] Failed to serialize project:', err);
      toast({
        title: 'Save failed',
        description: 'The project could not be serialized. Your work is unchanged on disk.',
        variant: 'destructive',
      });
      return;
    }

    const fallbackFilename = state.lastSaveFilename || `${state.projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}.mjc`;
    let result;
    try {
      result = await saveProjectToHandle(project, state.fileHandle, fallbackFilename);
    } catch (err) {
      console.error('[saveProject] Failed to write project:', err);
      toast({
        title: 'Save failed',
        description: 'The file could not be written. Please try Save As to choose a new location.',
        variant: 'destructive',
      });
      return;
    }

    if (result.savedToHandle) {
      // File on disk was actually updated — safe to mark clean.
      set({ isDirty: false, lastSaveFilename: result.filename, fileHandle: result.fileHandle });
      // Project was explicitly saved to disk — the crash-recovery draft is now
      // redundant, clear it so it doesn't trigger a spurious recovery prompt.
      clearAutosave();
    } else {
      // Fallback download happened, but the file on disk was NOT updated.
      // Keep isDirty true and preserve the existing fileHandle so the user
      // isn't misled into thinking their disk file is current.
      set({ lastSaveFilename: result.filename });
      toast({
        title: 'Saved as download',
        description: 'Could not write to the original file. A download was started instead — your disk file is unchanged.',
        variant: 'destructive',
      });
    }
  },

  saveProjectAs: async () => {
    const state = get();

    let project;
    try {
      project = serializeProject({
        elements: state.elements,
        elementCounter: state.elementCounter,
        canvasSettings: state.canvasSettings,
        snapEnabled: state.snapEnabled,
        snapToGrid: state.snapToGrid,
        snapToElements: state.snapToElements,
        snapUnit: state.snapUnit,
        zoomStep: state.zoomStep,
        projectName: state.projectName,
      });
    } catch (err) {
      console.error('[saveProjectAs] Failed to serialize project:', err);
      toast({
        title: 'Save failed',
        description: 'The project could not be serialized.',
        variant: 'destructive',
      });
      return;
    }

    let result;
    try {
      result = await saveProjectAsWithDialog(project);
    } catch (err) {
      console.error('[saveProjectAs] Failed to write project:', err);
      toast({
        title: 'Save failed',
        description: 'The file could not be written. Please try again.',
        variant: 'destructive',
      });
      return;
    }
    if (result) {
      // For Save As, both a real file-handle write AND a fallback download
      // count as a successful save (the user explicitly chose a new name).
      // The difference is just whether future Ctrl+S can write in place.
      set({ isDirty: false, lastSaveFilename: result.filename, fileHandle: result.fileHandle });
      // Explicit save-as succeeds — clear the crash-recovery draft.
      clearAutosave();
      if (!result.savedToHandle) {
        toast({
          title: 'Saved as download',
          description: 'File System Access API unavailable — a download was started. Use Save As again for future edits.',
        });
      }
    }
  },

  loadProject: async () => {
    try {
      const result = await openProjectWithDialog();
      const { project, rawFilename, fileHandle } = result;

      // Apply the loaded state using the internal method. If deserialization
      // failed (corrupt file), bail out WITHOUT touching save state — binding
      // the new fileHandle here would make the next Ctrl+S silently write the
      // still-on-canvas project into the unrelated file on disk.
      if (!get().loadProjectFromFileData(project)) {
        return false;
      }

      // Update save-related state
      set({
        lastSaveFilename: rawFilename,
        fileHandle: fileHandle,
        isDirty: false,
      });

      // Show warnings if any
      if (result.validation.warnings.length > 0) {
        console.warn('Project load warnings:', result.validation.warnings);
      }
      return true;
    } catch (err) {
      // User cancelled or error — just log it
      if (err instanceof Error && err.message !== 'File selection cancelled') {
        console.error('Failed to load project:', err);
      }
      return false;
    }
  },

  loadProjectFromFileData: (file: ProjectFile) => {
    // deserializeProject can throw on corrupt/malformed project files (e.g.
    // structuredClone failure, bad migration). Wrap it so a single bad file
    // can't crash the whole store / white-screen the app — show a toast and
    // bail out cleanly instead.
    let deserialized;
    try {
      deserialized = deserializeProject(file);
    } catch (err) {
      console.error('[loadProjectFromFileData] Failed to deserialize project:', err);
      toast({
        title: 'Could not open project',
        description: 'The project file appears to be corrupt or is in an unsupported format.',
        variant: 'destructive',
      });
      return false;
    }

    invalidateSnapCache();

    // Cancel any pending undo operations
    cancelPropertyUndo();

    // Reset the canvas to re-center on the new page size
    set({
      elements: deserialized.elements,
      elementCounter: deserialized.elementCounter,
      canvasSettings: deserialized.canvasSettings,
      snapEnabled: deserialized.snapEnabled,
      snapToGrid: deserialized.snapToGrid,
      snapToElements: deserialized.snapToElements,
      snapUnit: deserialized.snapUnit,
      zoomStep: deserialized.zoomStep,
      projectName: deserialized.projectName,
      // Reset transient state
      selectedElementIds: [],
      selectedElementId: null,
      isDragging: false,
      dragStart: null,
      dragMoved: false,
      dragClickedElementId: null,
      multiDragStart: {},
      isResizing: false,
      resizeHandle: null,
      resizeStart: null,
      multiResizeData: null,
      isEndpointDragging: false,
      draggingEndpoint: null,
      endpointDragStart: null,
      isCornerDragging: false,
      draggingCornerIndex: null,
      cornerDragStart: null,
      cornerDragPreview: null,
      angleSnapInfo: null,
      isSelecting: false,
      selectionRect: null,
      selectionAdditive: false,
      alignmentGuidelines: [],
      editingGroupId: null,
      contextMenu: null,
      clipboardElement: null,
      clipboardElements: [],
      // Reset undo/redo for the new project
      undoStack: [],
      redoStack: [],
      canUndo: false,
      canRedo: false,
      isDirty: true,
    });
    return true;
  },

  newProject: (options?: { projectName?: string; canvasSettings?: CanvasSettings }) => {
    cancelPropertyUndo();
    const name = options?.projectName || 'Untitled Project';
    const canvas = options?.canvasSettings || DEFAULT_CANVAS_SETTINGS;
    set({
      elements: [],
      selectedElementIds: [],
      selectedElementId: null,
      elementCounter: { text: 0, table: 0, image: 0, line: 0, rectangle: 0, ellipse: 0, group: 0 },
      canvasSettings: canvas,
      clipboardElement: null,
      clipboardElements: [],
      isDragging: false,
      dragStart: null,
      dragMoved: false,
      dragClickedElementId: null,
      multiDragStart: {},
      isResizing: false,
      resizeHandle: null,
      resizeStart: null,
      multiResizeData: null,
      isEndpointDragging: false,
      draggingEndpoint: null,
      endpointDragStart: null,
      isCornerDragging: false,
      draggingCornerIndex: null,
      cornerDragStart: null,
      cornerDragPreview: null,
      angleSnapInfo: null,
      isSelecting: false,
      selectionRect: null,
      selectionAdditive: false,
      alignmentGuidelines: [],
      projectName: name,
      lastSaveFilename: null,
      fileHandle: null,
      isDirty: false,
      undoStack: [],
      redoStack: [],
      canUndo: false,
      canRedo: false,
      editingGroupId: null,
      contextMenu: null,
    });
    // Starting a fresh project — clear any stale crash-recovery draft so it
    // doesn't surface as a recovery prompt on the next session.
    clearAutosave();
  },

  setShowMiniPreview: (show: boolean) => {
    set({ showMiniPreview: show });
  },

  setShortcutsOverlayVisible: (visible: boolean) => {
    set({ shortcutsOverlayVisible: visible });
  },

  setToolInfoIconsVisible: (visible: boolean) => {
    set({ toolInfoIconsVisible: visible });
  },

  setToolInfoElementType: (type: ElementType | null) => {
    set({ toolInfoElementType: type });
  },

  fitToPage: (viewportWidth: number, viewportHeight: number) => {
    const state = get();
    const totalWidth = state.canvasSettings.pageWidth + VIEWPORT_PADDING * 2;
    const totalHeight = state.canvasSettings.pageHeight + VIEWPORT_PADDING * 2;

    const fitZoom = Math.min(
      (viewportWidth - 80) / totalWidth,
      (viewportHeight - 80) / totalHeight,
      1
    );

    // Vertically centered; horizontally centered at HORIZONTAL_CENTER_RATIO
    // (45%) so the page sits a little left of dead-center, toward the left
    // tool panel. This is the single source of truth for fit/center — the
    // Canvas component's initial-center effect also routes through here so app
    // start / create / open all shift consistently with the Fit buttons.
    const centerPanX =
      (viewportWidth * HORIZONTAL_CENTER_RATIO) / fitZoom - totalWidth / 2;
    const centerPanY = (viewportHeight / fitZoom - totalHeight) / 2;

    set({
      zoom: fitZoom,
      panX: centerPanX,
      panY: centerPanY,
    });
  },

  setNewProjectOpen: (open: boolean) => {
    set({ newProjectOpen: open });
  },
  setRegisterIconOpen: (open: boolean) => {
    set({ registerIconOpen: open });
  },

  setProjectName: (name: string) => {
    set({ projectName: name });
  },

  setExportPdfOpen: (open: boolean) => {
    set({ exportPdfOpen: open });
  },

  setLargePreviewOpen: (open: boolean) => {
    set({ largePreviewOpen: open });
  },

  setWelcomeModalOpen: (open: boolean) => {
    set({ welcomeModalOpen: open });
  },

  // ── Multi-select alignment actions ──────────────────────────────────────
  alignElementsLeft: () => {
    // Block-align: shift the whole selection so its leftmost edge meets the
    // page's left margin (x=0). Every element moves by the SAME delta, so
    // relative positions are preserved (mirrors the floating-card method).
    const state = get();
    if (state.selectedElementIds.length < 2) return;
    state.pushUndo();
    const selectedEls = state.elements.filter((el) => state.selectedElementIds.includes(el.id));
    const minX = Math.min(...selectedEls.map((el) => el.x));
    const dx = 0 - minX;
    if (Math.abs(dx) < 0.01) return;
    set({
      elements: state.elements.map((el) => {
        if (!state.selectedElementIds.includes(el.id)) return el;
        return moveElementWithLineDelta(el, { x: el.x + dx });
      }),
      isDirty: true,
    });
  },

  alignElementsRight: () => {
    // Block-align: shift the whole selection so its rightmost edge meets the
    // page's right edge (pageWidth). Relative positions preserved.
    const state = get();
    if (state.selectedElementIds.length < 2) return;
    state.pushUndo();
    const selectedEls = state.elements.filter((el) => state.selectedElementIds.includes(el.id));
    const maxRight = Math.max(...selectedEls.map((el) => el.x + el.width));
    const dx = state.canvasSettings.pageWidth - maxRight;
    if (Math.abs(dx) < 0.01) return;
    set({
      elements: state.elements.map((el) => {
        if (!state.selectedElementIds.includes(el.id)) return el;
        return moveElementWithLineDelta(el, { x: el.x + dx });
      }),
      isDirty: true,
    });
  },

  alignElementsTop: () => {
    // Block-align: shift the whole selection so its topmost edge meets the
    // page's top edge (y=0). Relative positions preserved.
    const state = get();
    if (state.selectedElementIds.length < 2) return;
    state.pushUndo();
    const selectedEls = state.elements.filter((el) => state.selectedElementIds.includes(el.id));
    const minY = Math.min(...selectedEls.map((el) => el.y));
    const dy = 0 - minY;
    if (Math.abs(dy) < 0.01) return;
    set({
      elements: state.elements.map((el) => {
        if (!state.selectedElementIds.includes(el.id)) return el;
        return moveElementWithLineDelta(el, { y: el.y + dy });
      }),
      isDirty: true,
    });
  },

  alignElementsBottom: () => {
    // Block-align: shift the whole selection so its bottommost edge meets the
    // page's bottom edge (pageHeight). Relative positions preserved.
    const state = get();
    if (state.selectedElementIds.length < 2) return;
    state.pushUndo();
    const selectedEls = state.elements.filter((el) => state.selectedElementIds.includes(el.id));
    const maxBottom = Math.max(...selectedEls.map((el) => el.y + el.height));
    const dy = state.canvasSettings.pageHeight - maxBottom;
    if (Math.abs(dy) < 0.01) return;
    set({
      elements: state.elements.map((el) => {
        if (!state.selectedElementIds.includes(el.id)) return el;
        return moveElementWithLineDelta(el, { y: el.y + dy });
      }),
      isDirty: true,
    });
  },

  alignElementsCenterH: () => {
    // Block-align to page center (kept for compatibility). Mirrors
    // alignElementsHorizontalCenter but reads selection from store state.
    const state = get();
    if (state.selectedElementIds.length < 2) return;
    get().alignElementsHorizontalCenter([...state.selectedElementIds]);
  },

  alignElementsCenterV: () => {
    // Block-align to page center (kept for compatibility). Mirrors
    // alignElementsVerticalCenter but reads selection from store state.
    const state = get();
    if (state.selectedElementIds.length < 2) return;
    get().alignElementsVerticalCenter([...state.selectedElementIds]);
  },

  distributeElementsH: () => {
    const state = get();
    if (state.selectedElementIds.length < 3) return;
    state.pushUndo();
    const selectedEls = state.elements.filter((el) => state.selectedElementIds.includes(el.id));
    const sorted = [...selectedEls].sort((a, b) => a.x - b.x);
    const leftEdge = sorted[0].x;
    const rightEdge = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width;
    const totalWidth = sorted.reduce((sum, el) => sum + el.width, 0);
    const totalGap = rightEdge - leftEdge - totalWidth;
    const gapCount = sorted.length - 1;
    const gap = totalGap / gapCount;
    let currentX = leftEdge;
    const newPositions = new Map<string, number>();
    for (const el of sorted) {
      newPositions.set(el.id, currentX);
      currentX += el.width + gap;
    }
    set({
      elements: state.elements.map((el) => {
        if (!state.selectedElementIds.includes(el.id) || !newPositions.has(el.id)) return el;
        return moveElementWithLineDelta(el, { x: newPositions.get(el.id)! });
      }),
      isDirty: true,
    });
  },

  distributeElementsV: () => {
    const state = get();
    if (state.selectedElementIds.length < 3) return;
    state.pushUndo();
    const selectedEls = state.elements.filter((el) => state.selectedElementIds.includes(el.id));
    const sorted = [...selectedEls].sort((a, b) => a.y - b.y);
    const topEdge = sorted[0].y;
    const bottomEdge = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height;
    const totalHeight = sorted.reduce((sum, el) => sum + el.height, 0);
    const totalGap = bottomEdge - topEdge - totalHeight;
    const gapCount = sorted.length - 1;
    const gap = totalGap / gapCount;
    let currentY = topEdge;
    const newPositions = new Map<string, number>();
    for (const el of sorted) {
      newPositions.set(el.id, currentY);
      currentY += el.height + gap;
    }
    set({
      elements: state.elements.map((el) => {
        if (!state.selectedElementIds.includes(el.id) || !newPositions.has(el.id)) return el;
        return moveElementWithLineDelta(el, { y: newPositions.get(el.id)! });
      }),
      isDirty: true,
    });
  },

  // ── Group Actions ─────────────────────────────────────────────────────────

  /** Compute the bounding box of a set of elements */
  // (helper, not exposed on store)

  groupSelected: () => {
    invalidateSnapCache();
    const state = get();
    if (state.selectedElementIds.length < 2) return;
    // Don't allow grouping while in group edit mode
    if (state.editingGroupId) return;

    state.pushUndo();

    // Get the selected elements (root-level only)
    const selectedEls = state.elements.filter((el) => state.selectedElementIds.includes(el.id));
    if (selectedEls.length < 2) return;

    // Compute bounding box from selected elements
    const minX = Math.min(...selectedEls.map((el) => el.x));
    const minY = Math.min(...selectedEls.map((el) => el.y));
    const maxX = Math.max(...selectedEls.map((el) => el.x + el.width));
    const maxY = Math.max(...selectedEls.map((el) => el.y + el.height));

    // Convert children to relative positions (relative to group's x, y)
    // If any selected element is a group, flatten its children out
    const childrenWithRelativePos: CanvasElement[] = [];
    for (const el of selectedEls) {
      if (el.type === 'group' && el.children) {
        // Flatten: extract all children from this group and adjust their positions
        for (const child of el.children) {
          const flattenedChild: CanvasElement = {
            ...structuredClone(child),
            // Child position is relative to its parent group, so add parent group's offset
            // then subtract the new group's origin
            x: child.x + el.x - minX,
            y: child.y + el.y - minY,
            // Also adjust line endpoints
            ...(child.type === 'line' && child.lineStartX !== undefined ? {
              lineStartX: child.lineStartX + el.x - minX,
              lineStartY: child.lineStartY! + el.y - minY,
              lineEndX: child.lineEndX! + el.x - minX,
              lineEndY: child.lineEndY! + el.y - minY,
            } : {}),
            // Adjust rectangle corner points (relative to old group → relative to new group)
            ...(child.cornerPoints ? {
              cornerPoints: child.cornerPoints.map((p) => ({ x: p.x + el.x - minX, y: p.y + el.y - minY })),
            } : {}),
          };
          // Remove the children array if the child was a group (we've flattened it)
          if (flattenedChild.type === 'group') {
            // Recursively flatten nested groups
            if (flattenedChild.children && flattenedChild.children.length > 0) {
              for (const nestedChild of flattenedChild.children) {
                childrenWithRelativePos.push({
                  ...structuredClone(nestedChild),
                  x: nestedChild.x + flattenedChild.x,
                  y: nestedChild.y + flattenedChild.y,
                  ...(nestedChild.type === 'line' && nestedChild.lineStartX !== undefined ? {
                    lineStartX: nestedChild.lineStartX + flattenedChild.x,
                    lineStartY: nestedChild.lineStartY! + flattenedChild.y,
                    lineEndX: nestedChild.lineEndX! + flattenedChild.x,
                    lineEndY: nestedChild.lineEndY! + flattenedChild.y,
                  } : {}),
                  ...(nestedChild.cornerPoints ? {
                    cornerPoints: nestedChild.cornerPoints.map((p) => ({ x: p.x + flattenedChild.x, y: p.y + flattenedChild.y })),
                  } : {}),
                });
              }
            }
          } else {
            childrenWithRelativePos.push(flattenedChild);
          }
        }
      } else {
        childrenWithRelativePos.push({
          ...structuredClone(el),
          x: el.x - minX,
          y: el.y - minY,
          // Also adjust line endpoints
          ...(el.type === 'line' && el.lineStartX !== undefined ? {
            lineStartX: el.lineStartX - minX,
            lineStartY: el.lineStartY! - minY,
            lineEndX: el.lineEndX! - minX,
            lineEndY: el.lineEndY! - minY,
          } : {}),
          // Convert rectangle corner points (absolute) to be relative to the new group
          ...(el.cornerPoints ? {
            cornerPoints: el.cornerPoints.map((p) => ({ x: p.x - minX, y: p.y - minY })),
          } : {}),
        });
      }
    }

    const counter = { ...state.elementCounter };
    counter.group += 1;

    // Create the group element
    const groupElement: CanvasElement = {
      id: uuidv4(),
      type: 'group',
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      locked: false,
      visible: true,
      name: getDefaultName('group', counter.group),
      properties: { type: 'group', data: {} },
      children: childrenWithRelativePos,
    };

    // Find the index of the first selected element to insert the group there
    const firstSelectedIndex = state.elements.findIndex((el) => state.selectedElementIds.includes(el.id));

    // Remove selected elements and insert group
    const newElements = state.elements.filter((el) => !state.selectedElementIds.includes(el.id));
    newElements.splice(firstSelectedIndex, 0, groupElement);

    const newSelection = [groupElement.id];
    set({
      elements: newElements,
      selectedElementIds: newSelection,
      selectedElementId: deriveSelectedElementId(newSelection),
      elementCounter: counter,
      isDirty: true,
    });
  },

  ungroupSelected: () => {
    invalidateSnapCache();
    const state = get();
    if (state.selectedElementIds.length !== 1) return;
    // Don't allow ungrouping while in group edit mode
    if (state.editingGroupId) return;

    const groupId = state.selectedElementIds[0];
    const groupElement = state.elements.find((el) => el.id === groupId);
    if (!groupElement || groupElement.type !== 'group' || !groupElement.children) return;

    state.pushUndo();

    // Convert children back to absolute positions
    const childrenWithAbsolutePos: CanvasElement[] = groupElement.children.map((child) => ({
      ...structuredClone(child),
      x: child.x + groupElement.x,
      y: child.y + groupElement.y,
      // Also adjust line endpoints
      ...(child.type === 'line' && child.lineStartX !== undefined ? {
        lineStartX: child.lineStartX + groupElement.x,
        lineStartY: child.lineStartY! + groupElement.y,
        lineEndX: child.lineEndX! + groupElement.x,
        lineEndY: child.lineEndY! + groupElement.y,
      } : {}),
      // Convert rectangle corner points (relative to group) back to absolute
      ...(child.cornerPoints ? {
        cornerPoints: child.cornerPoints.map((p) => ({ x: p.x + groupElement.x, y: p.y + groupElement.y })),
      } : {}),
    }));

    // Find the group's index
    const groupIndex = state.elements.findIndex((el) => el.id === groupId);

    // Remove group and insert children at its position
    const newElements = state.elements.filter((el) => el.id !== groupId);
    newElements.splice(groupIndex, 0, ...childrenWithAbsolutePos);

    // Select all previously grouped elements
    const newSelection = childrenWithAbsolutePos.map((el) => el.id);
    set({
      elements: newElements,
      selectedElementIds: newSelection,
      selectedElementId: deriveSelectedElementId(newSelection),
      isDirty: true,
    });
  },

  enterGroup: (groupId) => {
    const state = get();
    const groupElement = state.elements.find((el) => el.id === groupId);
    if (!groupElement || groupElement.type !== 'group') return;

    // Select the group itself when entering
    set({
      editingGroupId: groupId,
      selectedElementIds: [groupId],
      selectedElementId: groupId,
    });
  },

  exitGroup: () => {
    const state = get();
    const groupId = state.editingGroupId;
    if (!groupId) return;

    // When exiting group edit mode, select the group again
    set({
      editingGroupId: null,
      selectedElementIds: [groupId],
      selectedElementId: groupId,
    });
  },

  setContextMenu: (menu) => {
    set({ contextMenu: menu });
  },

  clearContextMenu: () => {
    set({ contextMenu: null });
  },

  findParentGroup: (childId) => {
    const state = get();
    for (const el of state.elements) {
      if (el.type === 'group' && el.children) {
        if (el.children.some((child) => child.id === childId)) {
          return el;
        }
      }
    }
    return null;
  },

  findElementById: (elementId) => {
    const state = get();
    // Search top-level elements first
    const top = state.elements.find((el) => el.id === elementId);
    if (top) return top;
    // Search inside groups recursively
    function searchChildren(children: CanvasElement[]): CanvasElement | null {
      for (const child of children) {
        if (child.id === elementId) return child;
        if (child.type === 'group' && child.children) {
          const found = searchChildren(child.children);
          if (found) return found;
        }
      }
      return null;
    }
    for (const el of state.elements) {
      if (el.type === 'group' && el.children) {
        const found = searchChildren(el.children);
        if (found) return found;
      }
    }
    return null;
  },

  isGroupChild: (elementId) => {
    return get().findParentGroup(elementId) !== null;
  },

  canGroup: () => {
    const state = get();
    // Can group if at least 2 elements are selected, not in group edit mode,
    // and not all selected elements are already in the same group
    if (state.selectedElementIds.length < 2) return false;
    if (state.editingGroupId) return false;
    // All selected elements must be root-level (not children of groups)
    // Since groups contain their children, root elements are always in state.elements
    return true;
  },

  canUngroup: () => {
    const state = get();
    if (state.editingGroupId) return false;
    if (state.selectedElementIds.length !== 1) return false;
    const el = state.elements.find((e) => e.id === state.selectedElementIds[0]);
    return el?.type === 'group' && !!el.children;
  },

  startGroupChildDrag: (childId, x, y) => {
    const state = get();
    if (!state.editingGroupId) return;
    const group = state.elements.find((el) => el.id === state.editingGroupId);
    if (!group || group.type !== 'group' || !group.children) return;

    const child = group.children.find((c) => c.id === childId);
    if (!child || child.locked) return;

    state.pushUndo();

    // If childId is not in current selection, make it the only selection
    let currentIds = state.selectedElementIds;
    if (!currentIds.includes(childId)) {
      currentIds = [childId];
    }

    // Store original positions for ALL children (not just selected ones)
    // so that non-dragged children maintain correct positions during re-normalization
    const dragStartInfo: Record<string, DragStartInfo> = {};
    for (const c of group.children) {
      const info: DragStartInfo = { x: c.x, y: c.y };
      if (c.type === 'line' && c.lineStartX !== undefined) {
        info.lineStartX = c.lineStartX;
        info.lineStartY = c.lineStartY;
        info.lineEndX = c.lineEndX;
        info.lineEndY = c.lineEndY;
      }
      // Snapshot rectangle corner points so deformed children translate with the drag
      if (c.cornerPoints) {
        info.cornerPoints = c.cornerPoints.map((p) => ({ x: p.x, y: p.y }));
      }
      dragStartInfo[c.id] = info;
    }

    set({
      isGroupChildDragging: true,
      dragMoved: false,
      dragClickedElementId: childId,
      selectedElementIds: currentIds,
      selectedElementId: currentIds[0],
      groupChildDragStart: { x, y, originalGroupX: group.x, originalGroupY: group.y },
      groupChildMultiDragStart: dragStartInfo,
    });
  },

  updateGroupChildDrag: (x, y) => {
    const state = get();
    if (!state.groupChildDragStart || !state.editingGroupId) return;

    // Mark that the mouse actually moved (distinguishes click from drag)
    if (!state.dragMoved) {
      set({ dragMoved: true });
    }

    const group = state.elements.find((el) => el.id === state.editingGroupId);
    if (!group || group.type !== 'group' || !group.children) return;

    const dx = (x - state.groupChildDragStart.x) / state.zoom;
    const dy = (y - state.groupChildDragStart.y) / state.zoom;

    // Use ORIGINAL group position (stored at drag start) to avoid accumulation
    // when re-normalizing children positions on each update
    const origGroupX = state.groupChildDragStart.originalGroupX;
    const origGroupY = state.groupChildDragStart.originalGroupY;

    const selectedIds = new Set(state.selectedElementIds);

    // ── Snapping support for group child drag ──
    // Compute absolute positions for the primary selected child, then snap
    let actualDx = dx;
    let actualDy = dy;
    let guidelines: AlignmentGuide[] = [];

    if (state.snapEnabled && state.selectedElementIds.length > 0) {
      const primaryChildId = state.selectedElementIds[0];
      const primaryStartInfo = state.groupChildMultiDragStart[primaryChildId];
      if (primaryStartInfo) {
        // Proposed absolute position of the primary child
        const proposedAbsX = origGroupX + primaryStartInfo.x + dx;
        const proposedAbsY = origGroupY + primaryStartInfo.y + dy;

        // Build the "other elements" list for snapping:
        // 1. All root elements except the group being edited (flattened to expand groups)
        // 2. Non-selected children of the current group (in absolute coords)
        const rootOthers = state.elements
          .filter((e) => e.id !== state.editingGroupId && e.visible)
          .flatMap((e) => flattenElementsForSnap([e]));

        const nonSelectedChildren = group.children
          .filter((c) => !selectedIds.has(c.id) && c.visible)
          .map((c) => {
            // Use ORIGINAL positions (from startInfo) to get absolute coords,
            // since the current group.children may have been re-normalized
            const startInfo = state.groupChildMultiDragStart[c.id];
            const absX = origGroupX + (startInfo ? startInfo.x : c.x);
            const absY = origGroupY + (startInfo ? startInfo.y : c.y);
            return {
              ...c,
              x: absX,
              y: absY,
              // Adjust line endpoints to absolute coordinates
              ...(c.type === 'line' && startInfo?.lineStartX !== undefined ? {
                lineStartX: origGroupX + startInfo.lineStartX,
                lineStartY: origGroupY + startInfo.lineStartY!,
                lineEndX: origGroupX + startInfo.lineEndX!,
                lineEndY: origGroupY + startInfo.lineEndY!,
              } : {}),
            };
          });

        const allOthers = [...rootOthers, ...nonSelectedChildren];

        // Get the primary child's dimensions (use original dimensions since only position changes)
        const primaryChild = group.children.find((c) => c.id === primaryChildId);
        if (primaryChild) {
          // For line elements, compute absolute endpoint positions
          const lineEndpoints = primaryChild.type === 'line' && primaryStartInfo.lineStartX !== undefined
            ? {
                startX: origGroupX + primaryStartInfo.lineStartX + dx,
                startY: origGroupY + primaryStartInfo.lineStartY! + dy,
                endX: origGroupX + primaryStartInfo.lineEndX! + dx,
                endY: origGroupY + primaryStartInfo.lineEndY! + dy,
              }
            : undefined;

          // Build a source element for rotation-aware snapping, preserving the
          // child's type + properties (incl. rectangle rotation) but STRIPPING
          // its cornerPoints — those are stored group-relative and would be stale
          // at the absolute proposed position. The bbox corners (used by
          // getRotatedScreenExtents when cornerPoints is absent) are correct here
          // because the tempElement's x/y/width/height are overridden to the
          // absolute proposed position below.
          const { cornerPoints: _strippedChildCorners, ...childSource } = primaryChild;
          void _strippedChildCorners;

          const snapResult = calculateSnapForPosition(
            primaryChildId,
            proposedAbsX,
            proposedAbsY,
            primaryChild.width,
            primaryChild.height,
            allOthers,
            state.snapToElements,
            state.snapToGrid,
            state.snapUnit,
            state.canvasSettings.pageWidth,
            state.canvasSettings.pageHeight,
            lineEndpoints,
            state.canvasSettings.marginTop,
            state.canvasSettings.marginBottom,
            state.canvasSettings.marginLeft,
            state.canvasSettings.marginRight,
            undefined,
            getElementBorderWidth(primaryChild),
            undefined,
            childSource as CanvasElement,
          );

          // Convert snapped absolute position back to delta
          const snappedAbsX = snapResult.snappedX;
          const snappedAbsY = snapResult.snappedY;
          actualDx = (snappedAbsX - origGroupX - primaryStartInfo.x);
          actualDy = (snappedAbsY - origGroupY - primaryStartInfo.y);
          guidelines = snapResult.guidelines;
        }
      }
    }

    // Compute positions for ALL children from their original start positions.
    // Selected children get the snapped delta applied; non-selected children stay at original positions.
    // This ensures re-normalization works correctly even for non-dragged children.
    const updatedChildren = group.children.map((child) => {
      const startInfo = state.groupChildMultiDragStart[child.id];
      if (!startInfo) return child;

      const isDragged = selectedIds.has(child.id);
      const childDx = isDragged ? actualDx : 0;
      const childDy = isDragged ? actualDy : 0;

      const newX = startInfo.x + childDx;
      const newY = startInfo.y + childDy;

      if (child.type === 'line' && startInfo.lineStartX !== undefined) {
        return {
          ...child,
          x: newX,
          y: newY,
          lineStartX: startInfo.lineStartX + childDx,
          lineStartY: startInfo.lineStartY! + childDy,
          lineEndX: startInfo.lineEndX! + childDx,
          lineEndY: startInfo.lineEndY! + childDy,
        };
      }
      // Translate deformed rectangle corner points with the child
      if (child.cornerPoints && startInfo.cornerPoints) {
        return {
          ...child,
          x: newX,
          y: newY,
          cornerPoints: startInfo.cornerPoints.map((p) => ({ x: p.x + childDx, y: p.y + childDy })),
        };
      }
      return { ...child, x: newX, y: newY };
    });

    // Recalculate group bounds from children using the ORIGINAL group position
    const visibleChildren = updatedChildren.filter(c => c.visible);

    if (visibleChildren.length > 0) {
      const relMinX = Math.min(...visibleChildren.map(c => c.x));
      const relMinY = Math.min(...visibleChildren.map(c => c.y));
      const relMaxX = Math.max(...visibleChildren.map(c => c.x + c.width));
      const relMaxY = Math.max(...visibleChildren.map(c => c.y + c.height));

      // Use the ORIGINAL group position as the base, not the current (potentially already-shifted) one
      const newGroupX = origGroupX + relMinX;
      const newGroupY = origGroupY + relMinY;
      const newGroupW = relMaxX - relMinX;
      const newGroupH = relMaxY - relMinY;

      // Re-normalize children to be relative to the new group origin
      const normalizedChildren = updatedChildren.map(c => {
        const nc: any = {
          ...c,
          x: c.x - relMinX,
          y: c.y - relMinY,
        };
        // Also adjust line endpoints
        if (c.type === 'line' && c.lineStartX !== undefined) {
          nc.lineStartX = c.lineStartX - relMinX;
          nc.lineStartY = c.lineStartY! - relMinY;
          nc.lineEndX = c.lineEndX! - relMinX;
          nc.lineEndY = c.lineEndY! - relMinY;
        }
        return nc as CanvasElement;
      });

      set({
        elements: state.elements.map((el) =>
          el.id === state.editingGroupId
            ? { ...el, x: newGroupX, y: newGroupY, width: Math.max(20, newGroupW), height: Math.max(10, newGroupH), children: normalizedChildren }
            : el
        ),
        alignmentGuidelines: guidelines,
      });
    } else {
      set({
        elements: state.elements.map((el) =>
          el.id === state.editingGroupId
            ? { ...el, children: updatedChildren }
            : el
        ),
        alignmentGuidelines: guidelines,
      });
    }
  },

  stopGroupChildDrag: () => {
    const state = get();
    // If the mouse didn't actually move during the drag (it was a click, not a drag),
    // and we're in a multi-selection, reduce selection to just the clicked element
    if (!state.dragMoved && state.dragClickedElementId && state.selectedElementIds.length > 1) {
      state.selectElement(state.dragClickedElementId);
    }
    set({
      isGroupChildDragging: false,
      dragMoved: false,
      dragClickedElementId: null,
      groupChildDragStart: null,
      groupChildMultiDragStart: {},
      alignmentGuidelines: [],
      isDirty: true,
    });
  },

  recalculateGroupBounds: (groupId) => {
    const state = get();
    const group = state.elements.find((el) => el.id === groupId);
    if (!group || group.type !== 'group' || !group.children || group.children.length === 0) return;

    const visibleChildren = group.children.filter(c => c.visible);
    if (visibleChildren.length === 0) return;

    const relMinX = Math.min(...visibleChildren.map(c => c.x));
    const relMinY = Math.min(...visibleChildren.map(c => c.y));
    const relMaxX = Math.max(...visibleChildren.map(c => c.x + c.width));
    const relMaxY = Math.max(...visibleChildren.map(c => c.y + c.height));

    // Re-normalize children positions and update group bounds
    const normalizedChildren = group.children.map(c => {
      const nc: any = {
        ...c,
        x: c.x - relMinX,
        y: c.y - relMinY,
      };
      if (c.type === 'line' && c.lineStartX !== undefined) {
        nc.lineStartX = c.lineStartX - relMinX;
        nc.lineStartY = c.lineStartY! - relMinY;
        nc.lineEndX = c.lineEndX! - relMinX;
        nc.lineEndY = c.lineEndY! - relMinY;
      }
      // Shift rectangle corner points by the same re-normalization delta
      if (c.cornerPoints) {
        nc.cornerPoints = c.cornerPoints.map((p: { x: number; y: number }) => ({ x: p.x - relMinX, y: p.y - relMinY }));
      }
      return nc as CanvasElement;
    });

    set({
      elements: state.elements.map((el) =>
        el.id === groupId
          ? { ...el, x: el.x + relMinX, y: el.y + relMinY, width: Math.max(20, relMaxX - relMinX), height: Math.max(10, relMaxY - relMinY), children: normalizedChildren }
          : el
      ),
      isDirty: true,
    });
  },

  startGroupChildResize: (childId, handle, x, y) => {
    const state = get();
    if (!state.editingGroupId) return;
    const group = state.elements.find((el) => el.id === state.editingGroupId);
    if (!group || group.type !== 'group' || !group.children) return;

    const child = group.children.find((c) => c.id === childId);
    if (!child || child.locked) return;

    state.pushUndo();

    set({
      isGroupChildResizing: true,
      resizeHandle: handle,
      selectedElementIds: [childId],
      selectedElementId: childId,
      groupChildResizeStart: {
        x,
        y,
        childX: child.x,
        childY: child.y,
        childW: child.width,
        childH: child.height,
        groupX: group.x,
        groupY: group.y,
        originalChildren: structuredClone(group.children),
      },
    });
  },

  updateGroupChildResize: (x, y) => {
    const state = get();
    if (!state.groupChildResizeStart || !state.resizeHandle || !state.editingGroupId) return;

    const childId = state.selectedElementIds[0];
    if (!childId) return;

    const dx = (x - state.groupChildResizeStart.x) / state.zoom;
    const dy = (y - state.groupChildResizeStart.y) / state.zoom;
    const handle = state.resizeHandle;
    const start = state.groupChildResizeStart;

    const group = state.elements.find((el) => el.id === state.editingGroupId);
    if (!group || group.type !== 'group' || !group.children) return;

    // Calculate new child bounds from resize delta — always from the ORIGINAL
    // child position/size to avoid cumulative effects during drag
    let rawChildX = start.childX;
    let rawChildY = start.childY;
    let rawChildW = start.childW;
    let rawChildH = start.childH;

    if (handle.includes('e')) {
      rawChildW = Math.max(20, start.childW + dx);
    }
    if (handle.includes('w')) {
      const proposedW = start.childW - dx;
      if (proposedW >= 20) {
        rawChildW = proposedW;
        rawChildX = start.childX + dx;
      }
    }
    if (handle.includes('s')) {
      rawChildH = Math.max(10, start.childH + dy);
    }
    if (handle.includes('n')) {
      const proposedH = start.childH - dy;
      if (proposedH >= 10) {
        rawChildH = proposedH;
        rawChildY = start.childY + dy;
      }
    }

    // ── Apply snapping to the resize bounds ──
    // Convert child bounds to absolute canvas coordinates for snap calculation
    let newChildX = rawChildX;
    let newChildY = rawChildY;
    let newChildW = rawChildW;
    let newChildH = rawChildH;
    let guidelines: AlignmentGuide[] = [];

    if (state.snapEnabled) {
      const absRawX = start.groupX + rawChildX;
      const absRawY = start.groupY + rawChildY;

      // Build the "other elements" list for snapping:
      // 1. All root elements except the group being edited (flattened to expand groups)
      // 2. Non-selected children of the current group (in absolute coords, using original positions)
      const rootOthers = state.elements
        .filter((e) => e.id !== state.editingGroupId && e.visible)
        .flatMap((e) => flattenElementsForSnap([e]));

      const nonSelectedChildren = start.originalChildren
        .filter((c) => c.id !== childId && c.visible)
        .map((c) => {
          const absX = start.groupX + c.x;
          const absY = start.groupY + c.y;
          return {
            ...c,
            x: absX,
            y: absY,
            // Adjust line endpoints to absolute coordinates
            ...(c.type === 'line' && c.lineStartX !== undefined ? {
              lineStartX: start.groupX + c.lineStartX,
              lineStartY: start.groupY + c.lineStartY!,
              lineEndX: start.groupX + c.lineEndX!,
              lineEndY: start.groupY + c.lineEndY!,
            } : {}),
          };
        });

      const allOthers = [...rootOthers, ...nonSelectedChildren];

      // Look up the original child from the snapshot (the `child` variable is not
      // in scope inside updateGroupChildResize — this was a latent bug that would
      // throw a ReferenceError whenever snapping was enabled during a group-child
      // resize. Use the snapshotted original children instead.)
      const originalChild = start.originalChildren.find((c) => c.id === childId);
      const childBw = originalChild ? getElementBorderWidth(originalChild) : 0;
      const snapResult = calculateSnapForResize(
        childId,
        absRawX,
        absRawY,
        rawChildW,
        rawChildH,
        handle,
        allOthers,
        state.snapToElements,
        state.snapToGrid,
        state.snapUnit,
        state.canvasSettings.pageWidth,
        state.canvasSettings.pageHeight,
        state.canvasSettings.marginTop,
        state.canvasSettings.marginBottom,
        state.canvasSettings.marginLeft,
        state.canvasSettings.marginRight,
        childBw
      );

      // Convert snapped absolute positions back to relative child coordinates
      newChildX = snapResult.snappedX - start.groupX;
      newChildY = snapResult.snappedY - start.groupY;
      newChildW = snapResult.snappedW;
      newChildH = snapResult.snappedH;
      guidelines = snapResult.guidelines;
    }

    // Update ONLY the resized child within the original children array.
    // Do NOT re-normalize positions during the resize — that causes the group
    // position to shift on every mouse move, leading to aggressive/jumping behavior.
    const updatedChildren = start.originalChildren.map((c) => {
      if (c.id !== childId) return c;
      // Deformed rectangle: apply per-edge translation to the corner points
      // based on which edges of the bbox actually moved during this resize
      // (mirrors axis-aligned resize — the opposite corner stays fixed).
      // See updateResize for the full rationale on why scaleCornerPoints is
      // wrong here.
      if (c.cornerPoints) {
        const resizedCorners = resizeCornerPointsByEdges(
          c.cornerPoints,
          { x: c.x, y: c.y, width: c.width, height: c.height },
          { x: newChildX, y: newChildY, width: newChildW, height: newChildH },
          handle,
        );
        return { ...c, x: newChildX, y: newChildY, width: newChildW, height: newChildH, cornerPoints: resizedCorners };
      }
      return { ...c, x: newChildX, y: newChildY, width: newChildW, height: newChildH };
    });

    // Keep the group at its ORIGINAL position during resize
    set({
      elements: state.elements.map((el) =>
        el.id === state.editingGroupId
          ? { ...el, x: start.groupX, y: start.groupY, children: updatedChildren }
          : el
      ),
      alignmentGuidelines: guidelines,
    });
  },

  stopGroupChildResize: () => {
    // Now that the resize is done, recalculate the group bounds and normalize
    // children positions so the group bounding box tightly wraps all children
    const state = get();
    if (state.editingGroupId) {
      state.recalculateGroupBounds(state.editingGroupId);
    }
    set({
      isGroupChildResizing: false,
      resizeHandle: null,
      groupChildResizeStart: null,
      alignmentGuidelines: [],
      isDirty: true,
    });
  },

  // ── Spotlight / Floating Cards Action Implementations ──────────────────────
  openSpotlight: () => {
    const state = get();
    if (!state.selectedElementIds.length) return;
    set({ spotlightOpen: true });
  },
  closeSpotlight: () => {
    set({ spotlightOpen: false });
  },
  addFloatingCard: (card) => {
    set((state) => {
      const existing = state.floatingCards.find(c => c.id === card.id);
      if (existing) return state;
      return { floatingCards: [...state.floatingCards, card] };
    });
  },
  removeFloatingCard: (cardId) => {
    set((state) => ({
      floatingCards: state.floatingCards.filter(c => c.id !== cardId),
    }));
  },
  clearFloatingCards: () => {
    set({ floatingCards: [] });
  },
  setPropertyDisplayMode: (mode) => {
    // When switching to 'panel' only, clear any floating cards and close the
    // spotlight — the card/spotlight system is disabled in panel-only mode.
    if (mode === 'panel') {
      set({
        propertyDisplayMode: mode,
        floatingCards: [],
        spotlightOpen: false,
      });
    } else {
      set({ propertyDisplayMode: mode });
    }
  },
  setToolPaletteCollapsed: (collapsed) => {
    set({ toolPaletteCollapsed: collapsed });
  },
  setPropsPanelCollapsed: (collapsed) => {
    set({ propsPanelCollapsed: collapsed });
  },
  setSpotlightHintShown: (shown) => {
    set({ spotlightHintShown: shown });
  },
  clearCardInitialPosition: (cardId) => {
    set((state) => ({
      floatingCards: state.floatingCards.map(c =>
        c.id === cardId ? { ...c, initialX: undefined, initialY: undefined } : c
      ),
    }));
  },

  // ── Predefined Blocks Actions ──────────────────────────────────────────────
  openPredefinedBlocks: () => {
    const state = get();
    // Close spotlight if open
    if (state.spotlightOpen) set({ spotlightOpen: false });
    set({ predefinedBlocksOpen: true });
  },
  closePredefinedBlocks: () => {
    set({ predefinedBlocksOpen: false });
  },
  addPredefinedBlock: (blockId) => {
    const block = PREDEFINED_BLOCKS.find((b) => b.id === blockId);
    if (!block) return;

    invalidateSnapCache();
    const state = get();
    state.pushUndo();

    const counter = { ...state.elementCounter };
    counter.text += 1;

    // Place at the center of the page
    const pageCenterX = state.canvasSettings.pageWidth / 2;
    const pageCenterY = state.canvasSettings.pageHeight / 2;
    const elementX = pageCenterX - block.width / 2;
    const elementY = pageCenterY - block.height / 2;

    // Build default text properties, then override with block-specific ones
    const defaultProps = getDefaultProperties('text');
    const textData = (defaultProps as { type: 'text'; data: Record<string, any> }).data;
    const mergedData = {
      ...textData,
      content: block.content,
      contentJson: null,
      ...block.properties,
    };

    const element: CanvasElement = {
      id: uuidv4(),
      type: 'text',
      x: elementX,
      y: elementY,
      width: block.width,
      height: block.height,
      locked: false,
      visible: true,
      name: getDefaultName('text', counter.text),
      properties: { type: 'text', data: mergedData } as ElementProperties,
    };

    const newSelection = [element.id];
    set({
      elements: [...state.elements, element],
      selectedElementIds: newSelection,
      selectedElementId: deriveSelectedElementId(newSelection),
      // Clear floating cards — the new block is a different element from the
      // previously selected one, so any open property cards must be dismissed.
      // Mirrors the clearCards behaviour in selectElement().
      floatingCards: [],
      elementCounter: counter,
      isDirty: true,
      lastAddedElementId: element.id,
      predefinedBlocksOpen: false,
    });
  },
  };
});
