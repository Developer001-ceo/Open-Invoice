/**
 * Rotation-aware resize cursor generator.
 *
 * CSS only provides 8 built-in resize cursors at fixed 0°/45°/90°/135° angles
 * (`ew-resize`, `ns-resize`, `nwse-resize`, `nesw-resize`). When a rectangle is
 * rotated to an arbitrary angle, those built-ins no longer match the handle's
 * visual direction — the cursor shows a horizontal arrow even though the handle
 * visually points diagonally.
 *
 * This module generates a custom SVG double-arrow cursor data-URI rotated to
 * the exact screen-space angle of the handle's resize axis, for EVERY angle
 * (including 0°). A built-in CSS cursor is used as the fallback (for Safari,
 * which historically doesn't render SVG data-URI cursors).
 *
 * Using a custom cursor at all angles (rather than snapping to built-ins at
 * 0°/45°/...) keeps the cursor appearance consistent across rotation changes —
 * the arrow doesn't "pop" between two visual styles as the user rotates.
 *
 * Usage: call `getResizeCursor(handle, rotation)` from a handle component's
 * render and apply the result to the `cursor` CSS property.
 */

// Base resize-direction angle (degrees from east, screen space) for each handle.
// The cursor is a double-ended arrow, so angles are modulo 180°.
//   e/w → horizontal (0°), n/s → vertical (90°),
//   nw/se → "\" diagonal (45°), ne/sw → "/" diagonal (135°)
const BASE_ANGLES: Record<string, number> = {
  e: 0, w: 0,
  n: 90, s: 90,
  nw: 45, se: 45,
  ne: 135, sw: 135,
};

// Built-in CSS cursors for the 4 standard angles, used as the FALLBACK for the
// custom SVG cursor (Safari ignores SVG data-URI cursors). These are no longer
// returned directly — a custom SVG cursor is generated at every angle so the
// cursor appearance stays visually consistent as the rectangle rotates.
const STANDARD_CURSORS: Array<[number, string]> = [
  [0, 'ew-resize'],
  [45, 'nwse-resize'],
  [90, 'ns-resize'],
  [135, 'nesw-resize'],
];

// Module-level cache: angle (rounded to nearest degree) → CSS cursor string.
// Avoids regenerating identical SVG data-URIs across handles and re-renders.
// Bounded to at most 180 entries (one per distinct degree in [0, 180)).
const cursorCache = new Map<number, string>();

/** Circular distance between two angles in degrees (modulo 180°). */
function angleDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
}

/** Find the closest built-in cursor for a given visual angle. */
function closestBuiltIn(angle: number): string {
  let best = 'ew-resize';
  let minDist = Infinity;
  for (const [std, cursor] of STANDARD_CURSORS) {
    const d = angleDistance(angle, std);
    if (d < minDist) {
      minDist = d;
      best = cursor;
    }
  }
  return best;
}

/**
 * Build a resize cursor for the given handle position and rectangle rotation.
 *
 * Generates a custom SVG double-arrow cursor rotated to the handle's visual
 * screen angle at EVERY angle (including 0° and 45° increments). The closest
 * built-in CSS cursor is appended as a fallback (for Safari, which historically
 * ignores SVG data-URI cursors).
 *
 * @param handle    Resize handle id: 'n'|'e'|'s'|'w'|'nw'|'ne'|'se'|'sw'.
 * @param rotation  The rectangle's rotation in degrees (0 for non-rectangles).
 * @returns A CSS `cursor` property value.
 */
export function getResizeCursor(handle: string, rotation: number): string {
  const base = BASE_ANGLES[handle];
  if (base === undefined) return 'default';

  // Visual angle of the resize axis on screen (modulo 180° — double-ended arrow).
  const visualAngle = ((base + rotation) % 180 + 180) % 180;

  // Generate (or fetch from cache) a custom SVG cursor at every angle. A custom
  // cursor at 0°/45° too keeps the visual style consistent across rotations —
  // the arrow no longer "pops" between the OS built-in and the SVG as the user
  // rotates the rectangle.
  const rounded = Math.round(visualAngle);
  const cached = cursorCache.get(rounded);
  if (cached) return cached;

  // 32×32 double-ended arrow, rotated to `rounded` degrees around center (16,16).
  // Black fill with a 3px white outline (stroke) for visibility on any background.
  // Arrow path: left arrowhead → shaft top → right arrowhead → shaft bottom.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    '<g transform="rotate(' + rounded + ' 16 16)" stroke="white" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">' +
    '<path d="M3 16 L10 12 L10 15 L22 15 L22 12 L29 16 L22 20 L22 17 L10 17 L10 20 Z" fill="black"/>' +
    '</g></svg>';

  const encoded = 'data:image/svg+xml,' + encodeURIComponent(svg);
  const fallback = closestBuiltIn(rounded);
  const cursor = 'url("' + encoded + '") 16 16, ' + fallback;
  cursorCache.set(rounded, cursor);
  return cursor;
}

