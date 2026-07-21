import { CanvasElement, TableProperties, RectangleProperties, EllipseProperties, ImageProperties, LineProperties, getRectRotation } from '@/lib/element-types';
import { hasCustomCorners, getRectCornerPoints } from '@/lib/rectangle-corners';

export interface AlignmentGuide {
  orientation: 'horizontal' | 'vertical';
  position: number; // canvas coordinate where the guide line sits (border center)
  start: number; // extent start (perpendicular axis)
  end: number; // extent end (perpendicular axis)
}

export interface SnapResult {
  snappedX: number;
  snappedY: number;
  guidelines: AlignmentGuide[];
}

export interface ResizeSnapResult {
  snappedX: number;
  snappedY: number;
  snappedW: number;
  snappedH: number;
  guidelines: AlignmentGuide[];
}

const SNAP_THRESHOLD = 5; // pixels
const VIEWPORT_CULLING_DISTANCE = 2000;

// ── Snap cache for performance optimization ──────────────────────────────────
let snapCacheVersion = 0;
let lastProcessedVersion = -1;
let cachedFlattenedElements: CanvasElement[] = [];
let cachedOtherElementsRef: CanvasElement[] | null = null;

/** Invalidate the snap cache. Call this when elements are added, removed, or restructured. */
export function invalidateSnapCache() {
  snapCacheVersion++;
  elementPositionsCache.clear();
  tableGridCache.clear();
}

/**
 * Get flattened elements from cache if available, or compute and cache them.
 * Uses both version-based and reference-based invalidation.
 */
function getCachedFlattenedElements(otherElements: CanvasElement[]): CanvasElement[] {
  if (snapCacheVersion !== lastProcessedVersion || cachedOtherElementsRef !== otherElements) {
    cachedFlattenedElements = flattenElementsForSnap(otherElements);
    lastProcessedVersion = snapCacheVersion;
    cachedOtherElementsRef = otherElements;
  }
  return cachedFlattenedElements;
}

// ── Position caches ──────────────────────────────────────────────────────────
const MAX_POSITIONS_CACHE = 500;
const elementPositionsCache = new Map<string, { left: number; right: number; top: number; bottom: number; centerX: number; centerY: number }>();
const tableGridCache = new Map<string, { colEdges: number[]; rowEdges: number[] }>();

/**
 * Check if an element is within culling range of a reference bounding box.
 * Returns true if the element is close enough in at least one axis to potentially
 * provide snap targets.
 */
function isWithinCullingRange(
  el: CanvasElement,
  refX: number,
  refY: number,
  refW: number,
  refH: number
): boolean {
  const elRight = el.x + el.width;
  const elBottom = el.y + el.height;
  const refRight = refX + refW;
  const refBottom = refY + refH;

  const dx = Math.max(0, Math.max(el.x, refX) - Math.min(elRight, refRight));
  const dy = Math.max(0, Math.max(el.y, refY) - Math.min(elBottom, refBottom));

  // Keep if close in at least one axis (can provide snap targets in that axis)
  return dx <= VIEWPORT_CULLING_DISTANCE || dy <= VIEWPORT_CULLING_DISTANCE;
}

/**
 * Flatten a list of elements so that group containers are expanded into
 * their individual children. Children are returned with ABSOLUTE canvas
 * positions (group.x + child.x, group.y + child.y).
 * Non-group elements are returned as-is.
 *
 * This ensures snap lines align with actual element edges, not group bounding boxes.
 */
export function flattenElementsForSnap(elements: CanvasElement[]): CanvasElement[] {
  const result: CanvasElement[] = [];
  for (const el of elements) {
    if (el.type === 'group' && el.children && el.children.length > 0) {
      // Expand group into its children with absolute positions
      for (const child of el.children) {
        if (!child.visible) continue;
        const absChild: CanvasElement = {
          ...child,
          x: el.x + child.x,
          y: el.y + child.y,
          // For line elements, also adjust endpoints to absolute coordinates
          ...(child.type === 'line' && child.lineStartX !== undefined ? {
            lineStartX: el.x + child.lineStartX,
            lineStartY: el.y + child.lineStartY!,
            lineEndX: el.x + child.lineEndX!,
            lineEndY: el.y + child.lineEndY!,
          } : {}),
        };
        // Recursively flatten if a child is also a group
        if (absChild.type === 'group' && absChild.children) {
          result.push(...flattenElementsForSnap([absChild]));
        } else {
          result.push(absChild);
        }
      }
    } else {
      result.push(el);
    }
  }
  return result;
}

/**
 * Extract the internal column and row border positions of a table element.
 * These positions are in canvas coordinates and can be used as snap targets
 * so that other elements can align with table grid lines.
 */
function getTableGridPositions(el: CanvasElement): {
  colEdges: number[];  // vertical line X positions (canvas coords)
  rowEdges: number[];  // horizontal line Y positions (canvas coords)
} {
  if (el.type !== 'table') return { colEdges: [], rowEdges: [] };

  const props = (el.properties as { type: 'table'; data: TableProperties }).data;
  const cw = props.colWidths ?? Array(props.cols ?? 0).fill(1);
  const rh = props.rowHeights ?? Array(props.rows ?? 0).fill(1);

  // Check cache first — include colWidths/rowHeights in key so cache invalidates when they change
  const cacheKey = `${el.id}:${el.x},${el.y},${el.width},${el.height}:${cw.join(',')}:${rh.join(',')}`;
  const cached = tableGridCache.get(cacheKey);
  if (cached) return cached;

  if (!props.showInnerBorders) {
    const result = { colEdges: [], rowEdges: [] };
    tableGridCache.set(cacheKey, result);
    return result;
  }

  const cols = props.cols ?? 0;
  const rows = props.rows ?? 0;
  const totalW = el.width;
  const totalH = el.height;

  const colEdges: number[] = [];
  const rowEdges: number[] = [];

  // Use colWidths fractions for column edges
  if (cols > 1) {
    const totalColFr = cw.reduce((a: number, b: number) => a + b, 0);
    let cumX = 0;
    for (let c = 0; c < cols - 1; c++) {
      cumX += cw[c];
      colEdges.push(el.x + (cumX / totalColFr) * totalW);
    }
  }

  // Use rowHeights fractions for row edges
  if (rows > 1) {
    const totalRowFr = rh.reduce((a: number, b: number) => a + b, 0);
    let cumY = 0;
    for (let r = 0; r < rows - 1; r++) {
      cumY += rh[r];
      rowEdges.push(el.y + (cumY / totalRowFr) * totalH);
    }
  }

  const result = { colEdges, rowEdges };
  if (tableGridCache.size < MAX_POSITIONS_CACHE) {
    tableGridCache.set(cacheKey, result);
  }
  return result;
}

/**
 * Check if a given X position matches any edge or table column border of an element.
 * Used for determining guideline extents.
 */
function matchesXPosition(el: CanvasElement, pos: number): boolean {
  const op = getElementPositions(el);
  if (Math.abs(op.left - pos) < 0.5 ||
      Math.abs(op.right - pos) < 0.5 ||
      Math.abs(op.centerX - pos) < 0.5) {
    return true;
  }
  // Check deformed rectangle corner points (inner corners are not on the bbox)
  if (hasCustomCorners(el)) {
    const corners = getRectCornerPoints(el);
    if (corners.some(c => Math.abs(c.x - pos) < 0.5)) return true;
  }
  // Check table column borders
  const grid = getTableGridPositions(el);
  return grid.colEdges.some(edge => Math.abs(edge - pos) < 0.5);
}

/**
 * Check if a given Y position matches any edge or table row border of an element.
 * Used for determining guideline extents.
 */
function matchesYPosition(el: CanvasElement, pos: number): boolean {
  const op = getElementPositions(el);
  if (Math.abs(op.top - pos) < 0.5 ||
      Math.abs(op.bottom - pos) < 0.5 ||
      Math.abs(op.centerY - pos) < 0.5) {
    return true;
  }
  // Check deformed rectangle corner points (inner corners are not on the bbox)
  if (hasCustomCorners(el)) {
    const corners = getRectCornerPoints(el);
    if (corners.some(c => Math.abs(c.y - pos) < 0.5)) return true;
  }
  // Check table row borders
  const grid = getTableGridPositions(el);
  return grid.rowEdges.some(edge => Math.abs(edge - pos) < 0.5);
}

/**
 * Extract the effective border/stroke width from an element.
 * Elements with box-sizing: border-box render their borders INSIDE the
 * bounding box, so the visual border center is offset inward by half the
 * border width. This function returns the border width so snapping can
 * account for it.
 */
export function getElementBorderWidth(el: CanvasElement): number {
  try {
    switch (el.type) {
      case 'rectangle': {
        const props = (el.properties as { type: 'rectangle'; data: RectangleProperties }).data;
        return props.borderWidth ?? 0;
      }
      case 'ellipse': {
        const props = (el.properties as { type: 'ellipse'; data: EllipseProperties }).data;
        return props.borderWidth ?? 0;
      }
      case 'image': {
        const props = (el.properties as { type: 'image'; data: ImageProperties }).data;
        return props.borderWidth ?? 0;
      }
      case 'table': {
        const props = (el.properties as { type: 'table'; data: TableProperties }).data;
        return props.borderWidth ?? 0;
      }
      case 'line': {
        const props = (el.properties as { type: 'line'; data: LineProperties }).data;
        // For lines, the stroke is centered on the path, so the visual
        // edge aligns with the bounding box edge already when strokeWidth
        // is accounted for via endpoint-based positions.
        return 0;
      }
      default:
        return 0;
    }
  } catch {
    return 0;
  }
}

/**
 * Adjust a guide line position from bounding-box edge to the visual center
 * of the element's border. With box-sizing: border-box, the border is inside
 * the bounding box, so the border center is offset inward by half the border width.
 *
 * For left/top edges: border center = boundingBoxEdge + halfBw
 * For right/bottom edges: border center = boundingBoxEdge - halfBw
 * For center edges: no adjustment needed
 */
function adjustGuidePositionToBorderCenter(
  guidePosition: number,
  matchedEdge: string | undefined,
  targetElement: CanvasElement
): number {
  if (!matchedEdge) return guidePosition;
  const bw = getElementBorderWidth(targetElement);
  return adjustGuidePositionByBorderWidth(guidePosition, matchedEdge, bw);
}

/**
 * Adjust a guide line position by a given border width.
 * Used when the primary element's border width is known (e.g., from the borderWidth parameter)
 * rather than derived from a CanvasElement object.
 */
function adjustGuidePositionByBorderWidth(
  guidePosition: number,
  matchedEdge: string | undefined,
  borderWidth: number
): number {
  if (!matchedEdge || borderWidth === 0) return guidePosition;
  const halfBw = borderWidth / 2;

  switch (matchedEdge) {
    case 'left':
      return guidePosition + halfBw;
    case 'right':
      return guidePosition - halfBw;
    case 'top':
      return guidePosition + halfBw;
    case 'bottom':
      return guidePosition - halfBw;
    default:
      // centerX, centerY, tableColEdge, tableRowEdge — no adjustment
      return guidePosition;
  }
}

/**
 * Compute the guide line position adjusted for BOTH the primary element's and
 * the target element's border widths. The final position is the average of
 * both border center positions, so the line appears visually "between" both
 * borders — i.e., in the middle of each element's border when they have the
 * same border width, or a reasonable compromise when they differ.
 *
 * @param guidePosition  The bounding-box position where the two edges align
 * @param currentEdge    Which edge of the primary (moving/resizing) element matched
 * @param primaryBw      Border width of the primary element
 * @param matchedEdge    Which edge of the target element matched
 * @param targetElement  The target element (or undefined if none)
 */
function adjustGuidePositionForBothBorders(
  guidePosition: number,
  currentEdge: string | undefined,
  primaryBw: number,
  matchedEdge: string | undefined,
  targetElement: CanvasElement | undefined
): number {
  const primaryAdjusted = adjustGuidePositionByBorderWidth(guidePosition, currentEdge, primaryBw);
  if (!targetElement) return primaryAdjusted;
  const targetBw = getElementBorderWidth(targetElement);
  if (targetBw === 0) return primaryAdjusted;
  const targetAdjusted = adjustGuidePositionToBorderCenter(guidePosition, matchedEdge, targetElement);
  // Average both adjusted positions so the line sits between both border centers
  return (primaryAdjusted + targetAdjusted) / 2;
}

/**
 * Get the key positions of an element for alignment.
 * For line elements, uses the actual endpoint coordinates so that
 * alignment lines appear at the line's visual center (midpoint of endpoints)
 * rather than the thin bounding box center.
 *
 * All positions are in bounding-box coordinates (el.x, el.x + el.width, etc.)
 * which correspond to the outer edge of the element's border. This ensures
 * that snapping two elements to the same position makes their borders
 * overlap perfectly (pixel-perfect alignment).
 *
 * Guide lines are later adjusted to the visual border center for display
 * (see adjustGuidePositionToBorderCenter).
 */
function getElementPositions(el: CanvasElement) {
  // Build cache key from element ID + position. For rectangles, include the
  // rotation so the cache invalidates when only the rotation changes (x/y/w/h
  // can stay constant while the visual extents move with rotation).
  let cacheKey: string;
  if (el.type === 'line' && el.lineStartX !== undefined && el.lineStartY !== undefined &&
      el.lineEndX !== undefined && el.lineEndY !== undefined) {
    cacheKey = `${el.id}:l:${el.lineStartX},${el.lineStartY},${el.lineEndX},${el.lineEndY}`;
  } else {
    const rot = el.type === 'rectangle' ? getRectRotation(el) : 0;
    cacheKey = `${el.id}:${el.x},${el.y},${el.width},${el.height}:r${rot}`;
  }

  const cached = elementPositionsCache.get(cacheKey);
  if (cached) return cached;

  let result: { left: number; right: number; top: number; bottom: number; centerX: number; centerY: number };

  // For line elements, compute positions from actual endpoints
  if (el.type === 'line' && el.lineStartX !== undefined && el.lineStartY !== undefined &&
      el.lineEndX !== undefined && el.lineEndY !== undefined) {
    const left = Math.min(el.lineStartX, el.lineEndX);
    const right = Math.max(el.lineStartX, el.lineEndX);
    const top = Math.min(el.lineStartY, el.lineEndY);
    const bottom = Math.max(el.lineStartY, el.lineEndY);
    result = {
      left,
      right,
      top,
      bottom,
      centerX: (el.lineStartX + el.lineEndX) / 2,
      centerY: (el.lineStartY + el.lineEndY) / 2,
    };
  } else {
    // For rectangles, use the rotation-aware screen-space extents so the
    // axis-aligned snap engine draws guide lines at the rotated rectangle's
    // TRUE visual edges (and two rotated rectangles can align along X/Y).
    const rotated = getRotatedScreenExtents(el);
    if (rotated) {
      result = rotated;
    } else {
      result = {
        left: el.x,
        right: el.x + el.width,
        top: el.y,
        bottom: el.y + el.height,
        centerX: el.x + el.width / 2,
        centerY: el.y + el.height / 2,
      };
    }
  }

  if (elementPositionsCache.size >= MAX_POSITIONS_CACHE) {
    elementPositionsCache.clear();
  }
  elementPositionsCache.set(cacheKey, result);
  return result;
}

interface SnapMatch {
  diff: number;       // how far from snap position
  guidePosition: number; // where to draw the guide line (bounding-box position)
  matchedOtherPos: number; // the position on the other element we matched
  matchedEdge?: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY'; // which edge of the TARGET matched
  currentEdge?: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY'; // which edge of the CURRENT (primary) element matched
}

/**
 * Find the best snap for a set of current positions against a set of target positions.
 */
function findBestSnap(
  currentPositions: { value: number; name: string }[],
  targetPositions: { value: number; name: string }[]
): SnapMatch | null {
  let best: SnapMatch | null = null;

  for (const curr of currentPositions) {
    for (const target of targetPositions) {
      const diff = curr.value - target.value;
      if (Math.abs(diff) <= SNAP_THRESHOLD) {
        if (!best || Math.abs(diff) < Math.abs(best.diff)) {
          best = { diff, guidePosition: target.value, matchedOtherPos: target.value, matchedEdge: target.name as SnapMatch['matchedEdge'], currentEdge: curr.name as SnapMatch['currentEdge'] };
          // Early exit: perfect snap found (distance === 0)
          if (diff === 0) return best;
        }
      }
    }
  }

  return best;
}

/**
 * Find ALL snap matches (not just the best one) for guideline display.
 * Returns one match per unique target position that is within snap threshold.
 */
function findAllSnaps(
  currentPositions: { value: number; name: string }[],
  targetPositions: { value: number; name: string }[]
): SnapMatch[] {
  const results: SnapMatch[] = [];
  const seenTargets = new Set<number>();

  for (const curr of currentPositions) {
    for (const target of targetPositions) {
      const diff = curr.value - target.value;
      if (Math.abs(diff) <= SNAP_THRESHOLD) {
        // Round to avoid floating-point duplicate keys
        const key = Math.round(target.value * 100);
        if (!seenTargets.has(key)) {
          seenTargets.add(key);
          results.push({ diff, guidePosition: target.value, matchedOtherPos: target.value, matchedEdge: target.name as SnapMatch['matchedEdge'], currentEdge: curr.name as SnapMatch['currentEdge'] });
        }
      }
    }
  }

  return results;
}

/**
 * Get all snap-relevant positions for an element.
 * For groups, this returns the positions of each visible child (in absolute coords),
 * so that snap lines appear at the actual element edges, not the bounding box.
 * For non-group elements, returns the standard positions.
 */
function getElementSnapPositions(el: CanvasElement): { left: number; right: number; top: number; bottom: number; centerX: number; centerY: number }[] {
  if (el.type === 'group' && el.children && el.children.length > 0) {
    // Return positions for each visible child with absolute coordinates
    return el.children
      .filter(c => c.visible)
      .map(c => getElementPositions({
        ...c,
        x: el.x + c.x,
        y: el.y + c.y,
        // Adjust line endpoints to absolute
        ...(c.type === 'line' && c.lineStartX !== undefined ? {
          lineStartX: el.x + c.lineStartX,
          lineStartY: el.y + c.lineStartY!,
          lineEndX: el.x + c.lineEndX!,
          lineEndY: el.y + c.lineEndY!,
        } : {}),
      }));
  }
  const positions = [getElementPositions(el)];
  // For deformed rectangles, also include each corner point as a snap
  // position. Without this, only the bbox edges (the furthest corner points)
  // generate alignment lines — inner (deformed-inward) corners are invisible
  // to snapping. Each corner contributes its X (for vertical lines) and Y
  // (for horizontal lines) as snap positions.
  if (hasCustomCorners(el)) {
    const corners = getRectCornerPoints(el);
    for (const c of corners) {
      positions.push({
        left: c.x,
        right: c.x,
        top: c.y,
        bottom: c.y,
        centerX: c.x,
        centerY: c.y,
      });
    }
  }
  return positions;
}

// ── Rotated-rectangle alignment (vertical & horizontal only) ────────────────
//
// Alignment guide lines are ONLY ever vertical or horizontal — but for a
// ROTATED rectangle the unrotated bounding box (el.x/el.y/el.width/el.height)
// does NOT match what the user sees. The renderer rotates the rectangle around
// its center (`transform-origin: center`), so its visible left/right/top/bottom
// extremities are the min/max X/Y of the rotated corners, not the bbox edges.
//
// `getRotatedScreenExtents` computes those screen-space extents so the existing
// axis-aligned snap engine (findAllSnaps on left/right/centerX/top/bottom/
// centerY) draws guide lines at the rotated rectangle's true visual edges and
// lets two rotated rectangles align to each other along the X or Y axis. No
// angled guide lines are produced — alignment is strictly vertical/horizontal.

/**
 * Compute the screen-space (visual) extents of a rectangle element, accounting
 * for its rotation. Returns null for non-rectangles and unrotated rectangles so
 * the caller can fall back to the plain bbox.
 *
 * The 4 corners are rotated around the bbox center. left/right = min/max X of
 * the rotated corners; top/bottom = min/max Y; centerX/centerY = the bbox
 * center (which is the rotation pivot and therefore invariant under rotation).
 * For a rectangle with custom (deformed) corner points, those stored corners
 * are rotated the same way the renderer rotates them.
 */
function getRotatedScreenExtents(el: CanvasElement): {
  left: number; right: number; top: number; bottom: number; centerX: number; centerY: number;
} | null {
  if (el.type !== 'rectangle') return null;
  const rot = getRectRotation(el);
  if (rot === 0) return null; // unrotated → caller uses the plain bbox
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const theta = (rot * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // Source corners in absolute (unrotated) canvas coords.
  const src = hasCustomCorners(el)
    ? getRectCornerPoints(el)
    : [
        { x: el.x, y: el.y },                            // TL
        { x: el.x + el.width, y: el.y },                 // TR
        { x: el.x + el.width, y: el.y + el.height },     // BR
        { x: el.x, y: el.y + el.height },                // BL
      ];

  // Rotate each corner around the bbox center → screen space.
  const rotated = src.map((p) => {
    const ox = p.x - cx;
    const oy = p.y - cy;
    return { x: cx + ox * cos - oy * sin, y: cy + ox * sin + oy * cos };
  });

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of rotated) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    left: minX,
    right: maxX,
    top: minY,
    bottom: maxY,
    centerX: cx,
    centerY: cy,
  };
}

/**
 * Calculate snap position and alignment guidelines when moving an element.
 * Includes page center snapping for guideline display.
 * For group elements, considers individual child edges for snapping.
 */
export function calculateSnap(
  element: CanvasElement,
  otherElements: CanvasElement[],
  snapToElements: boolean,
  snapToGrid: boolean,
  snapUnit: number,
  pageWidth: number,
  pageHeight: number,
  marginTop: number = 0,
  marginBottom: number = 0,
  marginLeft: number = 0,
  marginRight: number = 0,
  primaryBorderWidth?: number
): SnapResult {
  // For groups, collect positions from all children; for others, use the element itself
  const allCurrentPositions = getElementSnapPositions(element);
  // Also keep the bounding box position for page center / margin snapping
  const current = getElementPositions(element);
  let snappedX = element.x;
  let snappedY = element.y;
  const guidelines: AlignmentGuide[] = [];

  // === Page center snapping (always active when snapping is enabled) ===
  const pageCenterX = pageWidth / 2;
  const pageCenterY = pageHeight / 2;

  // Check if element center aligns with page center X
  const centerXDiff = current.centerX - pageCenterX;
  if (Math.abs(centerXDiff) <= SNAP_THRESHOLD) {
    snappedX = element.x - centerXDiff;
    guidelines.push({
      orientation: 'vertical',
      position: pageCenterX,
      start: 0,
      end: pageHeight,
    });
  }

  // Check if element center aligns with page center Y
  const centerYDiff = current.centerY - pageCenterY;
  if (Math.abs(centerYDiff) <= SNAP_THRESHOLD) {
    snappedY = element.y - centerYDiff;
    guidelines.push({
      orientation: 'horizontal',
      position: pageCenterY,
      start: 0,
      end: pageWidth,
    });
  }

  // === Margin line snapping (always active when snapping is enabled) ===
  const marginPositions = {
    left: marginLeft,
    right: pageWidth - marginRight,
    top: marginTop,
    bottom: pageHeight - marginBottom,
  };

  // X-axis margin snapping: check element left, right, centerX against left/right margin lines
  const marginXTargets = [
    { value: marginPositions.left, name: 'marginLeft' },
    { value: marginPositions.right, name: 'marginRight' },
  ];
  const marginCurrentXPositions = [
    { value: current.left, name: 'left' },
    { value: current.right, name: 'right' },
    { value: current.centerX, name: 'centerX' },
  ];
  const marginXSnap = findBestSnap(marginCurrentXPositions, marginXTargets);
  if (marginXSnap) {
    // Track best X adjustment so far (page center already set snappedX)
    const currentXDiff = snappedX - element.x; // adjustment already applied
    const marginXDiff = -marginXSnap.diff;       // adjustment margin wants to apply
    if (Math.abs(marginXDiff) < Math.abs(currentXDiff) || currentXDiff === 0) {
      snappedX = element.x + marginXDiff;
      // Remove page center X guideline if margin snap is closer
      const pcIdx = guidelines.findIndex(g => g.orientation === 'vertical' && g.position === pageCenterX);
      if (pcIdx !== -1) guidelines.splice(pcIdx, 1);
    }
    guidelines.push({
      orientation: 'vertical',
      position: marginXSnap.guidePosition,
      start: 0,
      end: pageHeight,
    });
  }

  // Y-axis margin snapping: check element top, bottom, centerY against top/bottom margin lines
  const marginYTargets = [
    { value: marginPositions.top, name: 'marginTop' },
    { value: marginPositions.bottom, name: 'marginBottom' },
  ];
  const marginCurrentYPositions = [
    { value: current.top, name: 'top' },
    { value: current.bottom, name: 'bottom' },
    { value: current.centerY, name: 'centerY' },
  ];
  const marginYSnap = findBestSnap(marginCurrentYPositions, marginYTargets);
  if (marginYSnap) {
    const currentYDiff = snappedY - element.y;
    const marginYDiff = -marginYSnap.diff;
    if (Math.abs(marginYDiff) < Math.abs(currentYDiff) || currentYDiff === 0) {
      snappedY = element.y + marginYDiff;
      const pcIdx = guidelines.findIndex(g => g.orientation === 'horizontal' && g.position === pageCenterY);
      if (pcIdx !== -1) guidelines.splice(pcIdx, 1);
    }
    guidelines.push({
      orientation: 'horizontal',
      position: marginYSnap.guidePosition,
      start: 0,
      end: pageWidth,
    });
  }

  // === Element snapping ===
  if (snapToElements) {
    // Flatten groups into their children so snap lines align with actual
    // element edges, not group bounding boxes (cached for performance)
    const flatOthers = getCachedFlattenedElements(otherElements);
    const excludedIds = new Set<string>([element.id]);
    const visibleOthers = flatOthers.filter(
      (o) => o.visible && !excludedIds.has(o.id) && isWithinCullingRange(o, element.x, element.y, element.width, element.height)
    );

    if (visibleOthers.length > 0) {
      // Collect all target positions from other elements
      const targetXPositions: { value: number; name: string }[] = [];
      const targetYPositions: { value: number; name: string }[] = [];

      for (const other of visibleOthers) {
        const op = getElementPositions(other);
        targetXPositions.push(
          { value: op.left, name: 'left' },
          { value: op.right, name: 'right' },
          { value: op.centerX, name: 'centerX' }
        );
        targetYPositions.push(
          { value: op.top, name: 'top' },
          { value: op.bottom, name: 'bottom' },
          { value: op.centerY, name: 'centerY' }
        );
        // Add deformed rectangle corner points as snap targets so that a
        // dragged element can align to an inner (deformed-inward) corner of
        // another deformed rectangle, not just its bbox edges.
        if (hasCustomCorners(other)) {
          const corners = getRectCornerPoints(other);
          for (const c of corners) {
            targetXPositions.push({ value: c.x, name: 'corner' });
            targetYPositions.push({ value: c.y, name: 'corner' });
          }
        }
        // Add table internal grid line positions as snap targets
        const grid = getTableGridPositions(other);
        for (const colEdge of grid.colEdges) {
          targetXPositions.push({ value: colEdge, name: 'tableColEdge' });
        }
        for (const rowEdge of grid.rowEdges) {
          targetYPositions.push({ value: rowEdge, name: 'tableRowEdge' });
        }
      }

      // Current element's X-axis positions (use all children positions for groups)
      const currentXPositions: { value: number; name: string }[] = [];
      const currentYPositions: { value: number; name: string }[] = [];
      for (const pos of allCurrentPositions) {
        currentXPositions.push(
          { value: pos.left, name: 'left' },
          { value: pos.right, name: 'right' },
          { value: pos.centerX, name: 'centerX' }
        );
        currentYPositions.push(
          { value: pos.top, name: 'top' },
          { value: pos.bottom, name: 'bottom' },
          { value: pos.centerY, name: 'centerY' }
        );
      }

      // Find ALL X-axis alignments (not just the best one) so a guide line
      // appears for every edge that aligns — e.g. when both the left and right
      // edges of the dragged element line up with target edges simultaneously.
      const xSnaps = findAllSnaps(currentXPositions, targetXPositions);
      if (xSnaps.length > 0) {
        // The BEST snap (smallest |diff|) drives the position adjustment;
        // every matching snap still gets its own guide line below.
        const xSnap = xSnaps.reduce((a, b) => (Math.abs(a.diff) <= Math.abs(b.diff) ? a : b));
        const elemXDiff = -xSnap.diff;
        const currentXDiff = snappedX - element.x;
        // Element snap overrides if it's closer than the current best (page center or margin)
        if (Math.abs(elemXDiff) <= Math.abs(currentXDiff) || currentXDiff === 0) {
          snappedX = element.x + elemXDiff;
          // Bug #6 fix: Remove page center or margin X guideline if element snap is closer.
          // Be specific: match both orientation AND position (within 1px tolerance) to
          // avoid accidentally removing the wrong guideline when both vertical and
          // horizontal page-center/margin guidelines exist.
          const existingIdx = guidelines.findIndex(g =>
            g.orientation === 'vertical' && Math.abs(g.position - (element.x + currentXDiff)) < 1
          );
          if (existingIdx !== -1 && Math.abs(elemXDiff) < Math.abs(currentXDiff)) {
            guidelines.splice(existingIdx, 1);
          }
        }
        // Push a vertical guideline for EVERY matching X alignment (dedup by
        // position so two snaps at the same coordinate don't draw twice).
        const primaryPos = getElementPositions(element);
        const primaryBw = primaryBorderWidth ?? getElementBorderWidth(element);
        const existingVerticalPositions = new Set(
          guidelines.filter((g) => g.orientation === 'vertical').map((g) => Math.round(g.position * 100))
        );
        for (const xs of xSnaps) {
          const matchedOthers = visibleOthers.filter((o) => matchesXPosition(o, xs.matchedOtherPos));
          const guidePos = adjustGuidePositionForBothBorders(
            xs.guidePosition, xs.currentEdge, primaryBw,
            xs.matchedEdge, matchedOthers.length > 0 ? matchedOthers[0] : undefined
          );
          const posKey = Math.round(guidePos * 100);
          if (existingVerticalPositions.has(posKey)) continue;
          // Use rotation-aware extents so the guide line spans the visual
          // tops/bottoms of rotated rectangles rather than their unrotated bbox.
          const startY = Math.min(primaryPos.top, ...matchedOthers.map((o) => getElementPositions(o).top));
          const endY = Math.max(primaryPos.bottom, ...matchedOthers.map((o) => getElementPositions(o).bottom));
          guidelines.push({
            orientation: 'vertical',
            position: guidePos,
            start: startY,
            end: endY,
          });
          existingVerticalPositions.add(posKey);
        }
      }

      // Find ALL Y-axis alignments (not just the best one) so a guide line
      // appears for every edge that aligns — e.g. when both the top and bottom
      // edges of the dragged element line up with target edges simultaneously.
      const ySnaps = findAllSnaps(currentYPositions, targetYPositions);
      if (ySnaps.length > 0) {
        // The BEST snap (smallest |diff|) drives the position adjustment;
        // every matching snap still gets its own guide line below.
        const ySnap = ySnaps.reduce((a, b) => (Math.abs(a.diff) <= Math.abs(b.diff) ? a : b));
        const elemYDiff = -ySnap.diff;
        const currentYDiff = snappedY - element.y;
        // Element snap overrides if it's closer than the current best (page center or margin)
        if (Math.abs(elemYDiff) <= Math.abs(currentYDiff) || currentYDiff === 0) {
          snappedY = element.y + elemYDiff;
          // Bug #6 fix: Remove page center or margin Y guideline if element snap is closer.
          // Be specific: match both orientation AND position (within 1px tolerance) to
          // avoid accidentally removing the wrong guideline when both vertical and
          // horizontal page-center/margin guidelines exist.
          const existingIdx = guidelines.findIndex(g =>
            g.orientation === 'horizontal' && Math.abs(g.position - (element.y + currentYDiff)) < 1
          );
          if (existingIdx !== -1 && Math.abs(elemYDiff) < Math.abs(currentYDiff)) {
            guidelines.splice(existingIdx, 1);
          }
        }
        // Push a horizontal guideline for EVERY matching Y alignment (dedup by
        // position so two snaps at the same coordinate don't draw twice).
        const primaryPos = getElementPositions(element);
        const primaryBw = primaryBorderWidth ?? getElementBorderWidth(element);
        const existingHorizontalPositions = new Set(
          guidelines.filter((g) => g.orientation === 'horizontal').map((g) => Math.round(g.position * 100))
        );
        for (const ys of ySnaps) {
          const matchedOthers = visibleOthers.filter((o) => matchesYPosition(o, ys.matchedOtherPos));
          const guidePos = adjustGuidePositionForBothBorders(
            ys.guidePosition, ys.currentEdge, primaryBw,
            ys.matchedEdge, matchedOthers.length > 0 ? matchedOthers[0] : undefined
          );
          const posKey = Math.round(guidePos * 100);
          if (existingHorizontalPositions.has(posKey)) continue;
          // Use rotation-aware extents so the guide line spans the visual
          // lefts/rights of rotated rectangles rather than their unrotated bbox.
          const startX = Math.min(primaryPos.left, ...matchedOthers.map((o) => getElementPositions(o).left));
          const endX = Math.max(primaryPos.right, ...matchedOthers.map((o) => getElementPositions(o).right));
          guidelines.push({
            orientation: 'horizontal',
            position: guidePos,
            start: startX,
            end: endX,
          });
          existingHorizontalPositions.add(posKey);
        }
      }
    }
  }

  // === Grid snapping ===
  if (snapToGrid && snapUnit > 0) {
    const gridSnappedX = Math.round(snappedX / snapUnit) * snapUnit;
    const gridSnappedY = Math.round(snappedY / snapUnit) * snapUnit;

    if (Math.abs(gridSnappedX - snappedX) <= SNAP_THRESHOLD) {
      snappedX = gridSnappedX;
    }
    if (Math.abs(gridSnappedY - snappedY) <= SNAP_THRESHOLD) {
      snappedY = gridSnappedY;
    }
  }

  return { snappedX, snappedY, guidelines };
}

/**
 * Simplified snap for position-based calculations.
 * When groupChildren is provided, the element is treated as a group and
 * snap positions are computed from the children's edges (not the bounding box).
 *
 * `sourceElement` (when provided) supplies the dragged element's real type and
 * properties — critically its rectangle rotation — so the rotation-aware
 * geometry in getElementPositions()/getRotatedScreenExtents() matches what the
 * user actually sees. Without this, a rotated rectangle being dragged would be
 * treated as an unrotated box (its visual edges would be wrong) and snaps/guide
 * lines would fire at incorrect positions or fail to appear.
 */
export function calculateSnapForPosition(
  elementId: string,
  proposedX: number,
  proposedY: number,
  width: number,
  height: number,
  otherElements: CanvasElement[],
  snapToElements: boolean,
  snapToGrid: boolean,
  snapUnit: number,
  pageWidth: number = 99999,
  pageHeight: number = 99999,
  lineEndpoints?: { startX: number; startY: number; endX: number; endY: number },
  marginTop: number = 0,
  marginBottom: number = 0,
  marginLeft: number = 0,
  marginRight: number = 0,
  groupChildren?: CanvasElement[],
  primaryBorderWidth: number = 0,
  cornerPoints?: { x: number; y: number }[],
  sourceElement?: CanvasElement
): SnapResult {
  const tempElement: CanvasElement = sourceElement
    ? {
        // Preserve the real element's type + properties (incl. rectangle
        // rotation) so rotation-aware snapping matches the rendered geometry.
        ...sourceElement,
        id: elementId,
        x: proposedX,
        y: proposedY,
        width,
        height,
        locked: false,
        visible: true,
        ...(lineEndpoints ? {
          lineStartX: lineEndpoints.startX,
          lineStartY: lineEndpoints.startY,
          lineEndX: lineEndpoints.endX,
          lineEndY: lineEndpoints.endY,
        } : {}),
        ...(groupChildren ? { children: groupChildren } : {}),
        // When the element is a deformed rectangle, pass its corner points
        // (already shifted to the proposed position) so snapping considers the
        // actual corner positions — including inner (deformed-inward) corners —
        // not just the bounding box edges.
        ...(cornerPoints ? { cornerPoints } : {}),
      }
    : {
        id: elementId,
        type: groupChildren ? 'group' : (lineEndpoints ? 'line' : (cornerPoints ? 'rectangle' : 'text')),
        x: proposedX,
        y: proposedY,
        width,
        height,
        locked: false,
        visible: true,
        name: '',
        properties: { type: 'text', data: {} } as never,
        ...(lineEndpoints ? {
          lineStartX: lineEndpoints.startX,
          lineStartY: lineEndpoints.startY,
          lineEndX: lineEndpoints.endX,
          lineEndY: lineEndpoints.endY,
        } : {}),
        ...(groupChildren ? { children: groupChildren } : {}),
        ...(cornerPoints ? { cornerPoints } : {}),
      };

  // Pass otherElements directly (without pre-filtering) so the cache reference
  // remains stable across calls during a drag operation. calculateSnap uses
  // an excludedIds Set internally for O(1) exclusion.
  return calculateSnap(
    tempElement,
    otherElements,
    snapToElements,
    snapToGrid,
    snapUnit,
    pageWidth,
    pageHeight,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    primaryBorderWidth
  );
}

/**
 * Calculate snap position and alignment guidelines when RESIZING an element.
 *
 * Unlike move (where all edges shift together), resize only moves the edges
 * indicated by the handle direction.  This function:
 * 1. Snaps MOVING edges against other elements and page center (position adjustment)
 * 2. Shows alignment guidelines for ALL edges (including non-moving) that are
 *    near other elements — this provides visual feedback for stationary edges too,
 *    which is crucial when resizing one side after aligning the other.
 */
export function calculateSnapForResize(
  elementId: string,
  rawX: number,
  rawY: number,
  rawW: number,
  rawH: number,
  handle: string,
  otherElements: CanvasElement[],
  snapToElements: boolean,
  snapToGrid: boolean,
  snapUnit: number,
  pageWidth: number,
  pageHeight: number,
  marginTop: number = 0,
  marginBottom: number = 0,
  marginLeft: number = 0,
  marginRight: number = 0,
  borderWidth: number = 0
): ResizeSnapResult {
  let snappedX = rawX;
  let snappedY = rawY;
  let snappedW = rawW;
  let snappedH = rawH;
  const guidelines: AlignmentGuide[] = [];

  // Compute current edges in bounding-box coordinates (no border offset).
  // Snap matching works in bounding-box space; guide line positions are
  // later adjusted to border center for visual display.
  const left   = rawX;
  const right  = rawX + rawW;
  const top    = rawY;
  const bottom = rawY + rawH;
  const centerX = rawX + rawW / 2;
  const centerY = rawY + rawH / 2;

  const pageCenterX = pageWidth / 2;
  const pageCenterY = pageHeight / 2;

  // Determine which edges are "moving" based on the handle
  const movingLeft  = handle.includes('w');
  const movingRight = handle.includes('e');
  const movingTop    = handle.includes('n');
  const movingBottom = handle.includes('s');

  // ── Horizontal position snapping (MOVING edges only) ──────────────────────

  if (movingLeft || movingRight) {
    // Collect MOVING edge positions for snap position adjustment
    const movingXPositions: { value: number; name: string }[] = [];
    if (movingLeft)  movingXPositions.push({ value: left,  name: 'left' });
    if (movingRight) movingXPositions.push({ value: right, name: 'right' });
    movingXPositions.push({ value: centerX, name: 'centerX' });

    let bestXDiff = 0; // adjustment to apply to the moving edge

    // ── Page center X snapping ──
    const centerXDiff = centerX - pageCenterX;
    if (Math.abs(centerXDiff) <= SNAP_THRESHOLD) {
      bestXDiff = -centerXDiff;
      guidelines.push({
        orientation: 'vertical',
        position: pageCenterX,
        start: 0,
        end: pageHeight,
      });
    }

    // ── Margin X snapping (moving edges) ──
    const marginXTargets = [
      { value: marginLeft, name: 'marginLeft' },
      { value: pageWidth - marginRight, name: 'marginRight' },
    ];
    const marginXSnap = findBestSnap(movingXPositions, marginXTargets);
    if (marginXSnap) {
      const marginXDiff = -marginXSnap.diff;
      if (Math.abs(marginXDiff) < Math.abs(bestXDiff) || bestXDiff === 0) {
        bestXDiff = marginXDiff;
        // Remove page center X guideline if margin snap is closer
        const pcIdx = guidelines.findIndex(g => g.orientation === 'vertical' && g.position === pageCenterX);
        if (pcIdx !== -1) guidelines.splice(pcIdx, 1);
        guidelines.push({
          orientation: 'vertical',
          position: marginXSnap.guidePosition,
          start: 0,
          end: pageHeight,
        });
      }
    }

    // ── Element-to-element X snapping (moving edges) ──
    if (snapToElements) {
      // Flatten groups into children so snap lines align with actual element edges (cached)
      const flatOthers = getCachedFlattenedElements(otherElements);
      const excludedIds = new Set<string>([elementId]);
      const visibleOthers = flatOthers.filter(
        (o) => o.visible && !excludedIds.has(o.id) && isWithinCullingRange(o, rawX, rawY, rawW, rawH)
      );

      if (visibleOthers.length > 0) {
        const targetXPositions: { value: number; name: string }[] = [];
        for (const other of visibleOthers) {
          const op = getElementPositions(other);
          targetXPositions.push(
            { value: op.left, name: 'left' },
            { value: op.right, name: 'right' },
            { value: op.centerX, name: 'centerX' }
          );
          // Add table internal grid line positions as snap targets
          const grid = getTableGridPositions(other);
          for (const colEdge of grid.colEdges) {
            targetXPositions.push({ value: colEdge, name: 'tableColEdge' });
          }
        }

        const xSnap = findBestSnap(movingXPositions, targetXPositions);
        if (xSnap && Math.abs(xSnap.diff) > 0) {
          // Only override page-center snap if the element snap is closer
          if (guidelines.length === 0 || Math.abs(xSnap.diff) < Math.abs(bestXDiff) || bestXDiff === 0) {
            bestXDiff = -xSnap.diff;

            // Determine extent of the vertical guide line
            const matchedOthers = visibleOthers.filter((o) => matchesXPosition(o, xSnap.matchedOtherPos));
            const startY = Math.min(rawY, ...matchedOthers.map((o) => o.y));
            const endY = Math.max(rawY + rawH, ...matchedOthers.map((o) => o.y + o.height));

            // Remove any previously-added vertical page-center guideline
            const pageCenterIdx = guidelines.findIndex(
              (g) => g.orientation === 'vertical' && g.position === pageCenterX
            );
            if (pageCenterIdx !== -1) guidelines.splice(pageCenterIdx, 1);

            // Adjust guide position for both primary and target element border centers
            const guidePos = adjustGuidePositionForBothBorders(
              xSnap.guidePosition, xSnap.currentEdge, borderWidth,
              xSnap.matchedEdge, matchedOthers.length > 0 ? matchedOthers[0] : undefined
            );

            guidelines.push({
              orientation: 'vertical',
              position: guidePos,
              start: startY,
              end: endY,
            });
          }
        }
      }
    }

    // Apply the best X snap adjustment (bounding-box space)
    if (bestXDiff !== 0) {
      if (movingLeft && movingRight) {
        snappedX = rawX + bestXDiff;
      } else if (movingLeft) {
        const newLeft = left + bestXDiff;
        const newW = right - newLeft;
        if (newW >= 20) {
          snappedX = newLeft;
          snappedW = newW;
        }
      } else {
        const newRight = right + bestXDiff;
        const newW = newRight - left;
        if (newW >= 20) {
          snappedW = newW;
        }
      }
    }

    // ── Grid X snapping for moving edges ──
    if (snapToGrid && snapUnit > 0) {
      if (movingLeft) {
        const gridLeft = Math.round(snappedX / snapUnit) * snapUnit;
        const gridDiff = gridLeft - snappedX;
        if (Math.abs(gridDiff) <= SNAP_THRESHOLD) {
          const newW = (snappedX + snappedW) - gridLeft;
          if (newW >= 20) {
            snappedX = gridLeft;
            snappedW = newW;
          }
        }
      }
      if (movingRight) {
        const gridRight = Math.round((snappedX + snappedW) / snapUnit) * snapUnit;
        const gridDiff = gridRight - (snappedX + snappedW);
        if (Math.abs(gridDiff) <= SNAP_THRESHOLD) {
          const newW = snappedW + gridDiff;
          if (newW >= 20) {
            snappedW = newW;
          }
        }
      }
    }
  }

  // ── Vertical position snapping (MOVING edges only) ────────────────────────

  if (movingTop || movingBottom) {
    const movingYPositions: { value: number; name: string }[] = [];
    if (movingTop)    movingYPositions.push({ value: top,    name: 'top' });
    if (movingBottom) movingYPositions.push({ value: bottom, name: 'bottom' });
    movingYPositions.push({ value: centerY, name: 'centerY' });

    let bestYDiff = 0;

    // ── Page center Y snapping ──
    const centerYDiff = centerY - pageCenterY;
    if (Math.abs(centerYDiff) <= SNAP_THRESHOLD) {
      bestYDiff = -centerYDiff;
      guidelines.push({
        orientation: 'horizontal',
        position: pageCenterY,
        start: 0,
        end: pageWidth,
      });
    }

    // ── Margin Y snapping (moving edges) ──
    const marginYTargets = [
      { value: marginTop, name: 'marginTop' },
      { value: pageHeight - marginBottom, name: 'marginBottom' },
    ];
    const marginYSnap = findBestSnap(movingYPositions, marginYTargets);
    if (marginYSnap) {
      const marginYDiff = -marginYSnap.diff;
      if (Math.abs(marginYDiff) < Math.abs(bestYDiff) || bestYDiff === 0) {
        bestYDiff = marginYDiff;
        const pcIdx = guidelines.findIndex(g => g.orientation === 'horizontal' && g.position === pageCenterY);
        if (pcIdx !== -1) guidelines.splice(pcIdx, 1);
        guidelines.push({
          orientation: 'horizontal',
          position: marginYSnap.guidePosition,
          start: 0,
          end: pageWidth,
        });
      }
    }

    // ── Element-to-element Y snapping (moving edges) ──
    if (snapToElements) {
      // Flatten groups into children so snap lines align with actual element edges (cached)
      const flatOthers = getCachedFlattenedElements(otherElements);
      const excludedIds = new Set<string>([elementId]);
      const visibleOthers = flatOthers.filter(
        (o) => o.visible && !excludedIds.has(o.id) && isWithinCullingRange(o, rawX, rawY, rawW, rawH)
      );

      if (visibleOthers.length > 0) {
        const targetYPositions: { value: number; name: string }[] = [];
        for (const other of visibleOthers) {
          const op = getElementPositions(other);
          targetYPositions.push(
            { value: op.top, name: 'top' },
            { value: op.bottom, name: 'bottom' },
            { value: op.centerY, name: 'centerY' }
          );
          // Add table internal grid line positions as snap targets
          const grid = getTableGridPositions(other);
          for (const rowEdge of grid.rowEdges) {
            targetYPositions.push({ value: rowEdge, name: 'tableRowEdge' });
          }
        }

        const ySnap = findBestSnap(movingYPositions, targetYPositions);
        if (ySnap && Math.abs(ySnap.diff) > 0) {
          if (guidelines.length === 0 || Math.abs(ySnap.diff) < Math.abs(bestYDiff) || bestYDiff === 0) {
            bestYDiff = -ySnap.diff;

            const matchedOthers = visibleOthers.filter((o) => matchesYPosition(o, ySnap.matchedOtherPos));
            const startX = Math.min(rawX, ...matchedOthers.map((o) => o.x));
            const endX = Math.max(rawX + rawW, ...matchedOthers.map((o) => o.x + o.width));

            const pageCenterIdx = guidelines.findIndex(
              (g) => g.orientation === 'horizontal' && g.position === pageCenterY
            );
            if (pageCenterIdx !== -1) guidelines.splice(pageCenterIdx, 1);

            // Adjust guide position for both primary and target element border centers
            const guidePos = adjustGuidePositionForBothBorders(
              ySnap.guidePosition, ySnap.currentEdge, borderWidth,
              ySnap.matchedEdge, matchedOthers.length > 0 ? matchedOthers[0] : undefined
            );

            guidelines.push({
              orientation: 'horizontal',
              position: guidePos,
              start: startX,
              end: endX,
            });
          }
        }
      }
    }

    // Apply the best Y snap adjustment (bounding-box space)
    if (bestYDiff !== 0) {
      if (movingTop && movingBottom) {
        snappedY = rawY + bestYDiff;
      } else if (movingTop) {
        const newTop = top + bestYDiff;
        const newH = bottom - newTop;
        if (newH >= 10) {
          snappedY = newTop;
          snappedH = newH;
        }
      } else {
        const newBottom = bottom + bestYDiff;
        const newH = newBottom - top;
        if (newH >= 10) {
          snappedH = newH;
        }
      }
    }

    // ── Grid Y snapping for moving edges ──
    if (snapToGrid && snapUnit > 0) {
      if (movingTop) {
        const gridTop = Math.round(snappedY / snapUnit) * snapUnit;
        const gridDiff = gridTop - snappedY;
        if (Math.abs(gridDiff) <= SNAP_THRESHOLD) {
          const newH = (snappedY + snappedH) - gridTop;
          if (newH >= 10) {
            snappedY = gridTop;
            snappedH = newH;
          }
        }
      }
      if (movingBottom) {
        const gridBottom = Math.round((snappedY + snappedH) / snapUnit) * snapUnit;
        const gridDiff = gridBottom - (snappedY + snappedH);
        if (Math.abs(gridDiff) <= SNAP_THRESHOLD) {
          const newH = snappedH + gridDiff;
          if (newH >= 10) {
            snappedH = newH;
          }
        }
      }
    }
  }

  // ── Guideline display for ALL edges (including non-moving) ────────────────
  // After position adjustment, check ALL edges against other elements and
  // add guidelines for any that are near snap targets. This ensures that
  // non-moving edges that are already aligned with other elements also show
  // visual feedback — which is critical when resizing one side after aligning
  // the other. These guidelines are display-only; they don't affect position.
  if (snapToElements) {
    // Flatten groups into children so snap lines align with actual element edges (cached)
    const flatOthers = getCachedFlattenedElements(otherElements);
    const excludedIds = new Set<string>([elementId]);
    const visibleOthers = flatOthers.filter(
      (o) => o.visible && !excludedIds.has(o.id) && isWithinCullingRange(o, snappedX, snappedY, snappedW, snappedH)
    );

    if (visibleOthers.length > 0) {
      // Use the SNAPPED positions (after position adjustment) for guideline checks,
      // in bounding-box coordinates
      const snappedLeft   = snappedX;
      const snappedRight  = snappedX + snappedW;
      const snappedTop    = snappedY;
      const snappedBottom = snappedY + snappedH;
      const snappedCenterX = snappedX + snappedW / 2;
      const snappedCenterY = snappedY + snappedH / 2;

      // Collect all edge positions (both moving and non-moving)
      const allXPositions = [
        { value: snappedLeft, name: 'left' },
        { value: snappedRight, name: 'right' },
        { value: snappedCenterX, name: 'centerX' },
      ];
      const allYPositions = [
        { value: snappedTop, name: 'top' },
        { value: snappedBottom, name: 'bottom' },
        { value: snappedCenterY, name: 'centerY' },
      ];

      // Collect target positions
      const targetXPositions: { value: number; name: string }[] = [];
      const targetYPositions: { value: number; name: string }[] = [];
      for (const other of visibleOthers) {
        const op = getElementPositions(other);
        targetXPositions.push(
          { value: op.left, name: 'left' },
          { value: op.right, name: 'right' },
          { value: op.centerX, name: 'centerX' }
        );
        targetYPositions.push(
          { value: op.top, name: 'top' },
          { value: op.bottom, name: 'bottom' },
          { value: op.centerY, name: 'centerY' }
        );
        // Add table internal grid line positions as snap targets
        const grid = getTableGridPositions(other);
        for (const colEdge of grid.colEdges) {
          targetXPositions.push({ value: colEdge, name: 'tableColEdge' });
        }
        for (const rowEdge of grid.rowEdges) {
          targetYPositions.push({ value: rowEdge, name: 'tableRowEdge' });
        }
      }

      // Check which positions on our element are already in the guidelines
      // to avoid adding duplicates
      const existingVerticalPositions = new Set(
        guidelines.filter((g) => g.orientation === 'vertical').map((g) => Math.round(g.position * 100))
      );
      const existingHorizontalPositions = new Set(
        guidelines.filter((g) => g.orientation === 'horizontal').map((g) => Math.round(g.position * 100))
      );

      // Find ALL X-axis alignments (not just the best one)
      const xSnaps = findAllSnaps(allXPositions, targetXPositions);
      for (const xSnap of xSnaps) {
        // Adjust guide position for both primary and target element border centers
        const matchedOthers = visibleOthers.filter((o) => matchesXPosition(o, xSnap.matchedOtherPos));
        const guidePos = adjustGuidePositionForBothBorders(
          xSnap.guidePosition, xSnap.currentEdge, borderWidth,
          xSnap.matchedEdge, matchedOthers.length > 0 ? matchedOthers[0] : undefined
        );

        const posKey = Math.round(guidePos * 100);
        if (existingVerticalPositions.has(posKey)) continue; // already have this guideline

        // Determine extent of the vertical guide line
        const startY = Math.min(snappedY, ...matchedOthers.map((o) => o.y));
        const endY = Math.max(snappedY + snappedH, ...matchedOthers.map((o) => o.y + o.height));

        guidelines.push({
          orientation: 'vertical',
          position: guidePos,
          start: startY,
          end: endY,
        });
        existingVerticalPositions.add(posKey);
      }

      // Find ALL Y-axis alignments
      const ySnaps = findAllSnaps(allYPositions, targetYPositions);
      for (const ySnap of ySnaps) {
        // Adjust guide position for both primary and target element border centers
        const matchedOthers = visibleOthers.filter((o) => matchesYPosition(o, ySnap.matchedOtherPos));
        const guidePos = adjustGuidePositionForBothBorders(
          ySnap.guidePosition, ySnap.currentEdge, borderWidth,
          ySnap.matchedEdge, matchedOthers.length > 0 ? matchedOthers[0] : undefined
        );

        const posKey = Math.round(guidePos * 100);
        if (existingHorizontalPositions.has(posKey)) continue;

        const startX = Math.min(snappedX, ...matchedOthers.map((o) => o.x));
        const endX = Math.max(snappedX + snappedW, ...matchedOthers.map((o) => o.x + o.width));

        guidelines.push({
          orientation: 'horizontal',
          position: guidePos,
          start: startX,
          end: endX,
        });
        existingHorizontalPositions.add(posKey);
      }
    }
  }

  // ── Margin line guideline display for ALL edges (including non-moving) ────
  // After position adjustment, check ALL edges against margin lines and add
  // guidelines for any that are near margin positions. These are display-only.
  {
    const snappedLeft   = snappedX;
    const snappedRight  = snappedX + snappedW;
    const snappedTop    = snappedY;
    const snappedBottom = snappedY + snappedH;
    const snappedCenterX = snappedX + snappedW / 2;
    const snappedCenterY = snappedY + snappedH / 2;

    const allXPositions = [
      { value: snappedLeft, name: 'left' },
      { value: snappedRight, name: 'right' },
      { value: snappedCenterX, name: 'centerX' },
    ];
    const allYPositions = [
      { value: snappedTop, name: 'top' },
      { value: snappedBottom, name: 'bottom' },
      { value: snappedCenterY, name: 'centerY' },
    ];

    const marginXTargets = [
      { value: marginLeft, name: 'marginLeft' },
      { value: pageWidth - marginRight, name: 'marginRight' },
    ];
    const marginYTargets = [
      { value: marginTop, name: 'marginTop' },
      { value: pageHeight - marginBottom, name: 'marginBottom' },
    ];

    const existingVerticalPositions = new Set(
      guidelines.filter((g) => g.orientation === 'vertical').map((g) => Math.round(g.position * 100))
    );
    const existingHorizontalPositions = new Set(
      guidelines.filter((g) => g.orientation === 'horizontal').map((g) => Math.round(g.position * 100))
    );

    // Check X-axis margin alignments
    const marginXSnaps = findAllSnaps(allXPositions, marginXTargets);
    for (const mSnap of marginXSnaps) {
      const posKey = Math.round(mSnap.guidePosition * 100);
      if (existingVerticalPositions.has(posKey)) continue;
      guidelines.push({
        orientation: 'vertical',
        position: mSnap.guidePosition,
        start: 0,
        end: pageHeight,
      });
      existingVerticalPositions.add(posKey);
    }

    // Check Y-axis margin alignments
    const marginYSnaps = findAllSnaps(allYPositions, marginYTargets);
    for (const mSnap of marginYSnaps) {
      const posKey = Math.round(mSnap.guidePosition * 100);
      if (existingHorizontalPositions.has(posKey)) continue;
      guidelines.push({
        orientation: 'horizontal',
        position: mSnap.guidePosition,
        start: 0,
        end: pageWidth,
      });
      existingHorizontalPositions.add(posKey);
    }
  }

  // Enforce minimum sizes one final time
  if (snappedW < 20) snappedW = 20;
  if (snappedH < 10) snappedH = 10;

  return { snappedX, snappedY, snappedW, snappedH, guidelines };
}

/**
 * Calculate snap position and alignment guidelines when dragging a line endpoint.
 *
 * Unlike element move or resize, this snaps a single point (the moving endpoint)
 * against other elements' edges, page center, and margins.
 * Returns the snapped endpoint coordinates and alignment guidelines.
 */
export function calculateSnapForEndpointDrag(
  elementId: string,
  endpointX: number,
  endpointY: number,
  otherElements: CanvasElement[],
  snapToElements: boolean,
  snapToGrid: boolean,
  snapUnit: number,
  pageWidth: number,
  pageHeight: number,
  marginTop: number = 0,
  marginBottom: number = 0,
  marginLeft: number = 0,
  marginRight: number = 0
): { snappedX: number; snappedY: number; guidelines: AlignmentGuide[] } {
  let snappedX = endpointX;
  let snappedY = endpointY;
  const guidelines: AlignmentGuide[] = [];

  const pageCenterX = pageWidth / 2;
  const pageCenterY = pageHeight / 2;

  // The moving endpoint acts as a single point that can align with
  // other elements' left, right, centerX (for X) and top, bottom, centerY (for Y)
  const currentXPositions: { value: number; name: string }[] = [
    { value: endpointX, name: 'left' },  // treat endpoint as "left" edge
  ];
  const currentYPositions: { value: number; name: string }[] = [
    { value: endpointY, name: 'top' },   // treat endpoint as "top" edge
  ];

  // ── Horizontal snapping ──────────────────────────────────────────────────

  let bestXDiff = 0;

  // ── Page center X snapping ──
  const centerXDiff = endpointX - pageCenterX;
  if (Math.abs(centerXDiff) <= SNAP_THRESHOLD) {
    bestXDiff = -centerXDiff;
    guidelines.push({
      orientation: 'vertical',
      position: pageCenterX,
      start: 0,
      end: pageHeight,
    });
  }

  // ── Margin X snapping ──
  const marginXTargets = [
    { value: marginLeft, name: 'marginLeft' },
    { value: pageWidth - marginRight, name: 'marginRight' },
  ];
  const marginXSnap = findBestSnap(currentXPositions, marginXTargets);
  if (marginXSnap) {
    const marginXDiff = -marginXSnap.diff;
    if (Math.abs(marginXDiff) < Math.abs(bestXDiff) || bestXDiff === 0) {
      bestXDiff = marginXDiff;
      const pcIdx = guidelines.findIndex(g => g.orientation === 'vertical' && g.position === pageCenterX);
      if (pcIdx !== -1) guidelines.splice(pcIdx, 1);
      guidelines.push({
        orientation: 'vertical',
        position: marginXSnap.guidePosition,
        start: 0,
        end: pageHeight,
      });
    }
  }

  // ── Element-to-element X snapping ──
  if (snapToElements) {
    const flatOthers = getCachedFlattenedElements(otherElements);
    const excludedIds = new Set<string>([elementId]);
    // Use a small area around the endpoint for culling
    const cullX = endpointX - 100;
    const cullY = endpointY - 100;
    const visibleOthers = flatOthers.filter(
      (o) => o.visible && !excludedIds.has(o.id) && isWithinCullingRange(o, cullX, cullY, 200, 200)
    );

    if (visibleOthers.length > 0) {
      const targetXPositions: { value: number; name: string }[] = [];
      for (const other of visibleOthers) {
        const op = getElementPositions(other);
        targetXPositions.push(
          { value: op.left, name: 'left' },
          { value: op.right, name: 'right' },
          { value: op.centerX, name: 'centerX' }
        );
        // Deformed rectangle corner points as snap targets
        if (hasCustomCorners(other)) {
          const corners = getRectCornerPoints(other);
          for (const c of corners) {
            targetXPositions.push({ value: c.x, name: 'corner' });
          }
        }
        const grid = getTableGridPositions(other);
        for (const colEdge of grid.colEdges) {
          targetXPositions.push({ value: colEdge, name: 'tableColEdge' });
        }
      }

      const xSnap = findBestSnap(currentXPositions, targetXPositions);
      if (xSnap) {
        const elemXDiff = -xSnap.diff;
        if (Math.abs(elemXDiff) < Math.abs(bestXDiff) || bestXDiff === 0) {
          bestXDiff = elemXDiff;
          // Remove page-center or margin X guideline if element snap is closer
          const pcIdx = guidelines.findIndex(g => g.orientation === 'vertical' && g.position === pageCenterX);
          if (pcIdx !== -1) guidelines.splice(pcIdx, 1);
          const marginIdx = guidelines.findIndex(g =>
            g.orientation === 'vertical' && (g.position === marginLeft || g.position === pageWidth - marginRight)
          );
          if (marginIdx !== -1) guidelines.splice(marginIdx, 1);

          const matchedOthers = visibleOthers.filter((o) => matchesXPosition(o, xSnap.matchedOtherPos));
          const startY = Math.min(endpointY, ...matchedOthers.map((o) => o.y));
          const endY = Math.max(endpointY, ...matchedOthers.map((o) => o.y + o.height));

          guidelines.push({
            orientation: 'vertical',
            position: xSnap.guidePosition,
            start: startY,
            end: endY,
          });
        }
      }
    }
  }

  // Apply best X snap
  if (bestXDiff !== 0) {
    snappedX = endpointX + bestXDiff;
  }

  // ── Grid X snapping ──
  if (snapToGrid && snapUnit > 0) {
    const gridSnappedX = Math.round(snappedX / snapUnit) * snapUnit;
    if (Math.abs(gridSnappedX - snappedX) <= SNAP_THRESHOLD) {
      snappedX = gridSnappedX;
    }
  }

  // ── Vertical snapping ──────────────────────────────────────────────────

  let bestYDiff = 0;

  // ── Page center Y snapping ──
  const centerYDiff = endpointY - pageCenterY;
  if (Math.abs(centerYDiff) <= SNAP_THRESHOLD) {
    bestYDiff = -centerYDiff;
    guidelines.push({
      orientation: 'horizontal',
      position: pageCenterY,
      start: 0,
      end: pageWidth,
    });
  }

  // ── Margin Y snapping ──
  const marginYTargets = [
    { value: marginTop, name: 'marginTop' },
    { value: pageHeight - marginBottom, name: 'marginBottom' },
  ];
  const marginYSnap = findBestSnap(currentYPositions, marginYTargets);
  if (marginYSnap) {
    const marginYDiff = -marginYSnap.diff;
    if (Math.abs(marginYDiff) < Math.abs(bestYDiff) || bestYDiff === 0) {
      bestYDiff = marginYDiff;
      const pcIdx = guidelines.findIndex(g => g.orientation === 'horizontal' && g.position === pageCenterY);
      if (pcIdx !== -1) guidelines.splice(pcIdx, 1);
      guidelines.push({
        orientation: 'horizontal',
        position: marginYSnap.guidePosition,
        start: 0,
        end: pageWidth,
      });
    }
  }

  // ── Element-to-element Y snapping ──
  if (snapToElements) {
    const flatOthers = getCachedFlattenedElements(otherElements);
    const excludedIds = new Set<string>([elementId]);
    const cullX = endpointX - 100;
    const cullY = endpointY - 100;
    const visibleOthers = flatOthers.filter(
      (o) => o.visible && !excludedIds.has(o.id) && isWithinCullingRange(o, cullX, cullY, 200, 200)
    );

    if (visibleOthers.length > 0) {
      const targetYPositions: { value: number; name: string }[] = [];
      for (const other of visibleOthers) {
        const op = getElementPositions(other);
        targetYPositions.push(
          { value: op.top, name: 'top' },
          { value: op.bottom, name: 'bottom' },
          { value: op.centerY, name: 'centerY' }
        );
        // Deformed rectangle corner points as snap targets
        if (hasCustomCorners(other)) {
          const corners = getRectCornerPoints(other);
          for (const c of corners) {
            targetYPositions.push({ value: c.y, name: 'corner' });
          }
        }
        const grid = getTableGridPositions(other);
        for (const rowEdge of grid.rowEdges) {
          targetYPositions.push({ value: rowEdge, name: 'tableRowEdge' });
        }
      }

      const ySnap = findBestSnap(currentYPositions, targetYPositions);
      if (ySnap) {
        const elemYDiff = -ySnap.diff;
        if (Math.abs(elemYDiff) < Math.abs(bestYDiff) || bestYDiff === 0) {
          bestYDiff = elemYDiff;
          const pcIdx = guidelines.findIndex(g => g.orientation === 'horizontal' && g.position === pageCenterY);
          if (pcIdx !== -1) guidelines.splice(pcIdx, 1);
          const marginIdx = guidelines.findIndex(g =>
            g.orientation === 'horizontal' && (g.position === marginTop || g.position === pageHeight - marginBottom)
          );
          if (marginIdx !== -1) guidelines.splice(marginIdx, 1);

          const matchedOthers = visibleOthers.filter((o) => matchesYPosition(o, ySnap.matchedOtherPos));
          const startX = Math.min(endpointX, ...matchedOthers.map((o) => o.x));
          const endX = Math.max(endpointX, ...matchedOthers.map((o) => o.x + o.width));

          guidelines.push({
            orientation: 'horizontal',
            position: ySnap.guidePosition,
            start: startX,
            end: endX,
          });
        }
      }
    }
  }

  // Apply best Y snap
  if (bestYDiff !== 0) {
    snappedY = endpointY + bestYDiff;
  }

  // ── Grid Y snapping ──
  if (snapToGrid && snapUnit > 0) {
    const gridSnappedY = Math.round(snappedY / snapUnit) * snapUnit;
    if (Math.abs(gridSnappedY - snappedY) <= SNAP_THRESHOLD) {
      snappedY = gridSnappedY;
    }
  }

  return { snappedX, snappedY, guidelines };
}
