/**
 * Independent Corner Manipulation helpers for the Rectangle shape tool.
 *
 * A rectangle can be stored either as a simple axis-aligned box (x/y/width/height)
 * or — once the user Alt-drags a corner — as four independent corner points
 * (`CanvasElement.cornerPoints`) stored in ABSOLUTE canvas coordinates.
 *
 * Corner order convention: [0]=TopLeft, [1]=TopRight, [2]=BottomRight, [3]=BottomLeft.
 * When `cornerPoints` is undefined the rectangle renders as a normal box; when
 * defined it renders as an SVG polygon (a custom quadrilateral). All existing
 * rectangle shapes remain backward compatible (cornerPoints is optional).
 */

import type { CanvasElement, RectangleEffects, GradientFill } from '@/lib/element-types';
import { DEFAULT_EFFECTS } from '@/lib/element-types';

export interface Point {
  x: number;
  y: number;
}

/** Corner index → corresponding axis-aligned resize handle id. */
export const CORNER_HANDLE_MAP = ['nw', 'ne', 'se', 'sw'] as const;

/**
 * For Alt+Shift horizontal alignment: returns the INDEX of the "partner" corner
 * that shares the same horizontal edge as the given corner index.
 *   0 (TL) ↔ 1 (TR)   (top edge)
 *   2 (BR) ↔ 3 (BL)   (bottom edge)
 * When Alt+Shift is held, the partner corner's Y snaps to the dragged corner's
 * Y so both top (or both bottom) corners align perfectly horizontally.
 */
export function horizontalAlignPartnerIndex(cornerIndex: number): number {
  // 0↔1, 1↔0, 2↔3, 3↔2
  return cornerIndex === 0 ? 1 : cornerIndex === 1 ? 0 : cornerIndex === 2 ? 3 : 2;
}

/**
 * For Alt+Ctrl vertical alignment: returns the INDEX of the "partner" corner
 * that shares the same vertical edge as the given corner index.
 *   0 (TL) ↔ 3 (BL)   (left edge)
 *   1 (TR) ↔ 2 (BR)   (right edge)
 * When Alt+Ctrl is held, the partner corner's X snaps to the dragged corner's
 * X so both left (or both right) corners align perfectly vertically.
 */
export function verticalAlignPartnerIndex(cornerIndex: number): number {
  // 0↔3, 1↔2, 2↔1, 3↔0
  return cornerIndex === 0 ? 3 : cornerIndex === 1 ? 2 : cornerIndex === 2 ? 1 : 0;
}

/** Returns true when the element is a rectangle with custom (deformed) corners. */
export function hasCustomCorners(el: CanvasElement): boolean {
  return (
    el.type === 'rectangle' &&
    Array.isArray((el as CanvasElement).cornerPoints) &&
    (el as CanvasElement).cornerPoints!.length === 4
  );
}

/**
 * Get the 4 absolute corner points of a rectangle element.
 * Returns the stored cornerPoints if defined, otherwise derives them from the bbox.
 */
export function getRectCornerPoints(el: CanvasElement): Point[] {
  if (hasCustomCorners(el) && (el as CanvasElement).cornerPoints) {
    const cp = (el as CanvasElement).cornerPoints!;
    return [
      { x: cp[0].x, y: cp[0].y },
      { x: cp[1].x, y: cp[1].y },
      { x: cp[2].x, y: cp[2].y },
      { x: cp[3].x, y: cp[3].y },
    ];
  }
  return [
    { x: el.x, y: el.y }, // TL
    { x: el.x + el.width, y: el.y }, // TR
    { x: el.x + el.width, y: el.y + el.height }, // BR
    { x: el.x, y: el.y + el.height }, // BL
  ];
}

/**
 * Initialize corner points (absolute) from a rectangle element's bbox.
 * Used to lazily convert a normal rectangle into 4-point mode the first time
 * the user Alt-drags a corner.
 */
export function initRectCornerPointsFromBBox(el: CanvasElement): Point[] {
  return [
    { x: el.x, y: el.y },
    { x: el.x + el.width, y: el.y },
    { x: el.x + el.width, y: el.y + el.height },
    { x: el.x, y: el.y + el.height },
  ];
}

/** Compute the bounding box of 4 points (width/height clamped to ≥1). */
export function bboxOfPoints(pts: Point[]): { x: number; y: number; width: number; height: number } {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/**
 * Scale 4 absolute corner points from an old bbox to a new bbox.
 * Used when a deformed rectangle is resized normally (edge/corner resize,
 * multi-resize, group-child resize) so the custom shape scales proportionally.
 *
 * NOTE: This performs PROPORTIONAL scaling — every corner's offset from the
 * old bbox origin is multiplied by the bbox scale factor. This is correct for
 * multi-element proportional resize (where every element is being scaled as
 * part of a larger selection), but WRONG for single-element corner/edge
 * resize of a deformed rectangle: it shifts the OPPOSITE corner whenever the
 * polygon's corners are not all at the bbox edges (e.g. after Alt-dragging a
 * corner outward). For single-element resize use `resizeCornerPointsByEdges`
 * instead, which applies per-edge translation so the opposite corner stays
 * fixed (matching the user's expectation from axis-aligned resize).
 */
export function scaleCornerPoints(
  corners: Point[],
  oldBbox: { x: number; y: number; width: number; height: number },
  newBbox: { x: number; y: number; width: number; height: number },
): Point[] {
  const sx = oldBbox.width > 0 ? newBbox.width / oldBbox.width : 1;
  const sy = oldBbox.height > 0 ? newBbox.height / oldBbox.height : 1;
  return corners.map((p) => ({
    x: newBbox.x + (p.x - oldBbox.x) * sx,
    y: newBbox.y + (p.y - oldBbox.y) * sy,
  }));
}

/**
 * Resize 4 absolute corner points by applying PER-EDGE translation based on
 * which edges of the bounding box actually moved during the resize.
 *
 * This is the deformed-rectangle analog of standard axis-aligned resize:
 *   - The dragged corner follows the mouse (both its edges move).
 *   - Corners on a moving edge shift along that edge only.
 *   - The OPPOSITE corner (not on any moving edge) stays completely fixed.
 *
 * Example: dragging the `sw` handle moves the LEFT and BOTTOM edges.
 *   - BL (dragged, left+bottom) → moves both X and Y.
 *   - TL (left+top)             → moves X only (left edge moved, top stays).
 *   - BR (right+bottom)         → moves Y only (bottom moved, right stays).
 *   - TR (right+top)            → STAYS FIXED (the opposite corner).
 *
 * Compare with `scaleCornerPoints` which proportionally scales ALL corners
 * (including the opposite one) — that's correct for multi-element proportional
 * scaling but wrong for single-element resize where the user expects the
 * opposite corner to stay put.
 *
 * Corner order convention: [0]=TopLeft, [1]=TopRight, [2]=BottomRight, [3]=BottomLeft.
 *
 * @param corners Original 4 corner points (absolute canvas coords)
 * @param oldBbox Original element bbox (start.elementX/Y/W/H)
 * @param newBbox New element bbox (finalX/Y/W/H after resize, post-min-size-clamp)
 * @param handle  Resize handle id: 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'se' | 'sw'
 */
export function resizeCornerPointsByEdges(
  corners: Point[],
  oldBbox: { x: number; y: number; width: number; height: number },
  newBbox: { x: number; y: number; width: number; height: number },
  handle: string,
): Point[] {
  // Compute the actual delta applied to each edge. An edge that isn't in the
  // handle (e.g. the right edge during a `sw` drag) has delta 0 — its corners
  // stay put. The deltas are derived from the bbox change so that min-size
  // clamping (already applied to newBbox by the caller) is respected: if the
  // user tries to shrink past the min size, the clamped edge simply doesn't
  // move, which naturally falls out as a 0 delta here.
  const leftDx = handle.includes('w') ? newBbox.x - oldBbox.x : 0;
  const rightDx = handle.includes('e')
    ? (newBbox.x + newBbox.width) - (oldBbox.x + oldBbox.width)
    : 0;
  const topDy = handle.includes('n') ? newBbox.y - oldBbox.y : 0;
  const bottomDy = handle.includes('s')
    ? (newBbox.y + newBbox.height) - (oldBbox.y + oldBbox.height)
    : 0;

  return corners.map((p, i) => {
    let nx = p.x;
    let ny = p.y;
    // i=0 TL (left + top), i=1 TR (right + top),
    // i=2 BR (right + bottom), i=3 BL (left + bottom)
    if (i === 0 || i === 3) nx += leftDx;   // left-edge corners
    if (i === 1 || i === 2) nx += rightDx;  // right-edge corners
    if (i === 0 || i === 1) ny += topDy;    // top-edge corners
    if (i === 2 || i === 3) ny += bottomDy; // bottom-edge corners
    return { x: nx, y: ny };
  });
}

/** Translate 4 corner points by (dx, dy). Returns undefined if input is undefined. */
export function translateCornerPoints(
  corners: Point[] | undefined,
  dx: number,
  dy: number,
): Point[] | undefined {
  if (!corners) return undefined;
  return corners.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Resize a ROTATED deformed rectangle's corner points in SCREEN space.
 *
 * The corner points are stored in absolute (unrotated) canvas coordinates and
 * the renderer rotates them around the bbox center (`transform-origin: center`)
 * at draw time. For a rotated rectangle, keeping the opposite corner point
 * fixed in LOCAL space (as `resizeCornerPointsByEdges` does) does NOT keep it
 * fixed VISUALLY — the bbox center shifts during resize, and since every corner
 * is rotated around that center, even "fixed" corners drift on screen.
 *
 * This function works entirely in screen space (where the user sees and drags)
 * and then converts the result back to local corner points:
 *   1. Compute the current visual position of each corner.
 *   2. Displace each corner's visual position by the sum of its moving edges'
 *      screen-space displacements (the dragged corner follows the mouse 1:1,
 *      edge-midpoint corners follow along their edge axis, the opposite corner
 *      stays fixed).
 *   3. Solve for the new rotation pivot C' self-consistently:
 *        C' = R(θ)·bboxCenter({R(−θ)·V'_i})
 *      so that the bbox center of the resulting local corners equals C'.
 *   4. Convert each new visual corner back to local space via R(−θ) around C'.
 *
 * The result is self-consistent with `transform-origin: center`: every corner,
 * when rotated around the new bbox center, lands exactly at its intended visual
 * position. No pivot-pinning or commit-time re-base is needed.
 *
 * At θ = 0 this reduces to pure axis-aligned per-edge translation (identical to
 * `resizeCornerPointsByEdges`), so non-rotated rects are unaffected.
 *
 * @param corners   Original 4 corner points (absolute, unrotated). [TL,TR,BR,BL]
 * @param rotation  Rotation in degrees.
 * @param handle    Resize handle id: 'n'|'e'|'s'|'w'|'nw'|'ne'|'se'|'sw'.
 * @param screenDx  Mouse delta in screen/canvas pixels (already divided by zoom).
 * @param screenDy  Mouse delta in screen/canvas pixels (already divided by zoom).
 * @returns The new 4 corner points and their bounding box.
 */
export function resizeRotatedCornerPoints(
  corners: Point[],
  rotation: number,
  handle: string,
  screenDx: number,
  screenDy: number,
): { corners: Point[]; bbox: { x: number; y: number; width: number; height: number } } {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const origBbox = bboxOfPoints(corners);
  const origCenter = { x: origBbox.x + origBbox.width / 2, y: origBbox.y + origBbox.height / 2 };

  // Current visual (screen-space) position of each corner.
  const visual = corners.map((c) => {
    const ox = c.x - origCenter.x;
    const oy = c.y - origCenter.y;
    return { x: origCenter.x + ox * cos - oy * sin, y: origCenter.y + ox * sin + oy * cos };
  });

  // Project the screen delta onto the rectangle's local east (cos, sin) and
  // south (-sin, cos) axes — how far the dragged handle moved along each axis.
  const deltaE = screenDx * cos + screenDy * sin;
  const deltaS = -screenDx * sin + screenDy * cos;

  // Each edge's screen-space displacement vector:
  //   top/bottom edges ('n'/'s') move along the south axis by deltaS.
  //   left/right edges ('w'/'e') move along the east axis by deltaE.
  const sDisp = { x: deltaS * -sin, y: deltaS * cos };  // deltaS · south
  const eDisp = { x: deltaE * cos, y: deltaE * sin };   // deltaE · east

  const topMove = handle.includes('n');
  const botMove = handle.includes('s');
  const leftMove = handle.includes('w');
  const rightMove = handle.includes('e');

  // Each corner sits on 2 edges; its visual displacement = sum of its moving
  // edges' displacements. The dragged corner (on 2 moving edges) gets both,
  // which sums to exactly (screenDx, screenDy). The opposite corner (on 2
  // non-moving edges) gets 0. Edge-midpoint corners get exactly 1.
  const disp = [
    { x: (topMove ? sDisp.x : 0) + (leftMove ? eDisp.x : 0), y: (topMove ? sDisp.y : 0) + (leftMove ? eDisp.y : 0) }, // TL
    { x: (topMove ? sDisp.x : 0) + (rightMove ? eDisp.x : 0), y: (topMove ? sDisp.y : 0) + (rightMove ? eDisp.y : 0) }, // TR
    { x: (botMove ? sDisp.x : 0) + (rightMove ? eDisp.x : 0), y: (botMove ? sDisp.y : 0) + (rightMove ? eDisp.y : 0) }, // BR
    { x: (botMove ? sDisp.x : 0) + (leftMove ? eDisp.x : 0), y: (botMove ? sDisp.y : 0) + (leftMove ? eDisp.y : 0) }, // BL
  ];

  const visualNew = visual.map((v, i) => ({ x: v.x + disp[i].x, y: v.y + disp[i].y }));

  // New rotation pivot = the local bbox center of the new corners, solved
  // self-consistently. The local corners are c'_i = C' + R(−θ)·(V'_i − C'),
  // and we need bboxCenter({c'_i}) = C'. Expanding:
  //   c'_i = R(−θ)·V'_i + (I − R(−θ))·C'
  //   bboxCenter({c'_i}) = bboxCenter({R(−θ)·V'_i}) + (I − R(−θ))·C'
  // Setting this = C' gives: R(−θ)·C' = bboxCenter({R(−θ)·V'_i}), i.e.
  //   C' = R(θ)·bboxCenter({R(−θ)·V'_i})
  // (All rotations here are around the canvas origin (0,0) in absolute coords —
  // the (I − R(−θ))·C' term cancels the translational component correctly.)
  const rotInvPts = visualNew.map((v) => ({ x: v.x * cos + v.y * sin, y: -v.x * sin + v.y * cos }));
  const rotInvBbox = bboxOfPoints(rotInvPts);
  const rotInvBboxCenter = { x: rotInvBbox.x + rotInvBbox.width / 2, y: rotInvBbox.y + rotInvBbox.height / 2 };
  const newCenter = {
    x: rotInvBboxCenter.x * cos - rotInvBboxCenter.y * sin,
    y: rotInvBboxCenter.x * sin + rotInvBboxCenter.y * cos,
  };

  // Convert each new visual corner back to local (unrotated) space.
  const newCorners = visualNew.map((v) => {
    const ox = v.x - newCenter.x;
    const oy = v.y - newCenter.y;
    // R(−θ)·(ox,oy) = (ox·cos + oy·sin, −ox·sin + oy·cos)
    return { x: newCenter.x + ox * cos + oy * sin, y: newCenter.y - ox * sin + oy * cos };
  });

  return { corners: newCorners, bbox: bboxOfPoints(newCorners) };
}

// ─── SVG fill / gradient helpers ────────────────────────────────────────────
// These are used by all three rectangle render sites (canvas, PDF export,
// large preview) so the custom-corner polygon renders identically everywhere.

/** Convert a hex color (#rrggbb) to an `rgba(r,g,b,a)` string. */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

export interface SvgFillDescriptor {
  /** SVG fill attribute value, e.g. "#93c5fd" or "url(#grad-id)". */
  fill: string;
  /** SVG <defs> inner content as a string (gradients/patterns). Empty if none. */
  defs: string;
}

/**
 * Build the SVG fill descriptor for a rectangle's gradient/picture/solid/transparent fill.
 * `idPrefix` must be unique per render to avoid SVG id collisions.
 * `solidColor` is the element's `props.fill` — used when gradient.type === 'solid'
 * (matching the original div renderer which uses backgroundColor: props.fill).
 */
export function buildSvgFillDescriptor(
  gradient: GradientFill,
  idPrefix: string,
  solidColor: string,
): SvgFillDescriptor {
  if (gradient.type === 'transparent') {
    return { fill: 'none', defs: '' };
  }
  if (gradient.type === 'solid') {
    return { fill: solidColor, defs: '' };
  }
  if (gradient.type === 'picture' && gradient.pictureSrc) {
    const patId = `${idPrefix}-pic`;
    const fit = gradient.pictureObjectFit ?? 'cover';
    // For SVG <pattern>, use patternContentUnits=userSpaceOnUse with a fixed
    // tile sized to the element bbox (caller passes w/h via attributes on use).
    // We use preserveAspectRatio to emulate object-fit.
    const aspectAttr =
      fit === 'contain'
        ? 'preserveAspectRatio="xMidYMid meet"'
        : fit === 'fill'
          ? 'preserveAspectRatio="none"'
          : 'preserveAspectRatio="xMidYMid slice"';
    const defs = `<pattern id="${patId}" patternUnits="userSpaceOnUse" width="100%" height="100%" ${aspectAttr}><image href="${gradient.pictureSrc}" x="0" y="0" width="1" height="1" ${aspectAttr}/></pattern>`;
    // Note: width/height 1 with patternUnits userSpaceOnUse won't tile correctly.
    // Instead we set the pattern to the element's pixel size at render time.
    // The caller will override via the returned fill ref; for simplicity we
    // render the image at the polygon's bbox using objectBoundingBox pattern.
    // Rebuild with objectBoundingBox (default):
    const defs2 = `<pattern id="${patId}" patternUnits="objectBoundingBox" width="1" height="1" ${aspectAttr}><image href="${gradient.pictureSrc}" x="0" y="0" width="1" height="1" ${aspectAttr} preserveAspectRatio="xMidYMid slice"/></pattern>`;
    return { fill: `url(#${patId})`, defs: defs2 };
  }
  if (gradient.type === 'gradient') {
    const stops = [...gradient.stops].sort((a, b) => a.position - b.position);
    const stopTags = stops
      .map(
        (s) =>
          `<stop offset="${(s.position / 100).toFixed(4)}" stop-color="${s.color}" stop-opacity="${s.opacity}"/>`,
      )
      .join('');
    if (gradient.gradientVariant === 'radial') {
      const id = `${idPrefix}-rg`;
      return {
        fill: `url(#${id})`,
        defs: `<radialGradient id="${id}" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">${stopTags}</radialGradient>`,
      };
    }
    // Linear — map direction to SVG x1/y1/x2/y2 (objectBoundingBox space).
    let coords = 'x1="0%" y1="0%" x2="100%" y2="0%"';
    switch (gradient.direction) {
      case 'horizontal':
        coords = 'x1="0%" y1="0%" x2="100%" y2="0%"';
        break;
      case 'vertical':
        coords = 'x1="0%" y1="0%" x2="0%" y2="100%"';
        break;
      case 'diagonal':
        coords = 'x1="0%" y1="0%" x2="100%" y2="100%"';
        break;
      case 'radial':
        coords = 'x1="0%" y1="0%" x2="100%" y2="0%"';
        break;
    }
    const id = `${idPrefix}-lg`;
    return {
      fill: `url(#${id})`,
      defs: `<linearGradient id="${id}" ${coords}>${stopTags}</linearGradient>`,
    };
  }
  return { fill: '#93c5fd', defs: '' };
}

/**
 * Build the SVG polygon `points` attribute (space-separated "x,y" pairs)
 * from absolute corner points, converted to the element's local coordinate
 * space (relative to element.x/y). Pass `originOverride` to use a different
 * origin (used during corner drag where element.x/y is stale — the preview
 * corners' own bbox min is used instead).
 */
export function buildPolygonPointsAttr(
  el: CanvasElement,
  corners: Point[],
  originOverride?: { x: number; y: number },
): string {
  const ox = originOverride ? originOverride.x : el.x;
  const oy = originOverride ? originOverride.y : el.y;
  return corners
    .map((p) => `${(p.x - ox).toFixed(2)},${(p.y - oy).toFixed(2)}`)
    .join(' ');
}

/**
 * Build an SVG `<path>` "d" attribute for a (possibly rounded) quadrilateral.
 *
 * When all radii are 0 this is equivalent to a `<polygon points=...>` — four
 * straight lines. When a corner has a non-zero radius, that corner is replaced
 * by a quadratic Bézier curve: the path walks `r` pixels along each adjacent
 * edge toward the corner (the start/end points of the arc), and uses the corner
 * point itself as the Bézier control point. This produces a smooth round corner
 * that follows whatever angle the two edges meet at — so it works for both
 * axis-aligned rectangles and deformed (custom-corner) quadrilaterals.
 *
 * Each radius is independently clamped to half the length of BOTH adjacent
 * edges so the arc never overshoots past the edge midpoint (which would cause
 * adjacent arcs to overlap and the path to self-intersect). This mirrors how
 * CSS `border-radius` clamps radii that are too large for the box.
 *
 * Corner order convention: [0]=TopLeft, [1]=TopRight, [2]=BottomRight, [3]=BottomLeft,
 * traversed clockwise. Radii are matched by index: radii[0] = topLeft, etc.
 *
 * @param corners  4 absolute corner points. Converted to local space via origin.
 * @param radii     Per-corner radius { topLeft, topRight, bottomRight, bottomLeft }.
 * @param origin    Origin to subtract (element.x/y, or bbox min during a corner drag).
 * @returns         An SVG path "d" string starting with "M ... Z".
 */
export function buildRoundedPolygonPath(
  corners: Point[],
  radii: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number },
  origin: { x: number; y: number },
): string {
  // Work in local coordinates (relative to the origin) so the path aligns with
  // the SVG viewBox (which is element-local).
  const pts = corners.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
  const r = [radii.topLeft, radii.topRight, radii.bottomRight, radii.bottomLeft];

  // Clamp each radius to half of both adjacent edge lengths. This prevents
  // arcs from overshooting when a corner is heavily deformed (short edges).
  for (let i = 0; i < 4; i++) {
    const prev = (i + 3) % 4; // edge: prev → i
    const next = (i + 1) % 4; // edge: i → next
    const lenPrev = Math.hypot(pts[i].x - pts[prev].x, pts[i].y - pts[prev].y);
    const lenNext = Math.hypot(pts[next].x - pts[i].x, pts[next].y - pts[i].y);
    const maxR = Math.max(0, Math.min(lenPrev, lenNext) / 2);
    r[i] = Math.max(0, Math.min(r[i], maxR));
  }

  const fmt = (n: number) => n.toFixed(2);
  const parts: string[] = [];

  for (let i = 0; i < 4; i++) {
    const cur = pts[i];
    const prev = pts[(i + 3) % 4];
    const next = pts[(i + 1) % 4];

    // Points along the two edges, `r` away from the corner toward the corner.
    const lenPrev = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const lenNext = Math.hypot(next.x - cur.x, next.y - cur.y);
    const tPrev = lenPrev > 0 ? r[i] / lenPrev : 0;
    const tNext = lenNext > 0 ? r[i] / lenNext : 0;

    // Entry point: on the edge from prev → cur, at distance r from cur.
    const entry = {
      x: cur.x + (prev.x - cur.x) * tPrev,
      y: cur.y + (prev.y - cur.y) * tPrev,
    };
    // Exit point: on the edge from cur → next, at distance r from cur.
    const exit = {
      x: cur.x + (next.x - cur.x) * tNext,
      y: cur.y + (next.y - cur.y) * tNext,
    };

    if (i === 0) {
      // Start the path at the first corner's entry point.
      parts.push(`M ${fmt(entry.x)} ${fmt(entry.y)}`);
    } else {
      // Line from the previous corner's exit to this corner's entry.
      parts.push(`L ${fmt(entry.x)} ${fmt(entry.y)}`);
    }

    // Round corner: quadratic Bézier with the corner as the control point.
    if (r[i] > 0.01) {
      parts.push(`Q ${fmt(cur.x)} ${fmt(cur.y)} ${fmt(exit.x)} ${fmt(exit.y)}`);
    } else {
      parts.push(`L ${fmt(exit.x)} ${fmt(exit.y)}`);
    }
  }

  parts.push('Z');
  return parts.join(' ');
}

/**
 * Build a CSS `filter` string for the combined drop-shadow (shadow effect)
 * and glow effect, suitable for applying to an SVG element. drop-shadow
 * follows the polygon's alpha shape, so shadows/glows conform to the custom
 * quadrilateral automatically.
 */
export function buildSvgFilterCSS(effects: RectangleEffects): string {
  const filters: string[] = [];
  if (effects.shadow.enabled) {
    const sh = effects.shadow;
    const offsetX = Math.round(sh.distance * Math.cos((sh.angle * Math.PI) / 180));
    const offsetY = Math.round(sh.distance * Math.sin((sh.angle * Math.PI) / 180));
    const color = hexToRgba(sh.color, sh.opacity);
    const prefix = sh.type === 'inner' ? '' : '';
    // CSS drop-shadow does not support inset; inner shadows are approximated
    // as a regular drop-shadow (best-effort for polygon shapes).
    filters.push(`${prefix}drop-shadow(${offsetX}px ${offsetY}px ${sh.blur}px ${color})`);
  }
  if (effects.glow.enabled) {
    const gl = effects.glow;
    const color = hexToRgba(gl.color, gl.opacity);
    // Stack a couple of drop-shadows to approximate a glow spread.
    filters.push(`drop-shadow(0 0 ${Math.max(1, gl.size / 2)}px ${color})`);
    filters.push(`drop-shadow(0 0 ${gl.size}px ${color})`);
  }
  return filters.length > 0 ? filters.join(' ') : '';
}

/** Resolve stroke-dasharray for SVG polygon border style. */
export function svgStrokeDasharray(style: 'solid' | 'dashed' | 'dotted', width: number): string | undefined {
  if (style === 'dashed') {
    const d = Math.max(4, width * 3);
    return `${d},${d / 2}`;
  }
  if (style === 'dotted') {
    const d = Math.max(1, width);
    return `${d},${d * 2}`;
  }
  return undefined;
}

export { DEFAULT_EFFECTS };
