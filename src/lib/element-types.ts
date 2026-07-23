import type React from 'react';

export type ElementType = 'text' | 'table' | 'image' | 'line' | 'rectangle' | 'ellipse' | 'group';

export interface TextProperties {
  content: string;          // HTML string (plain text is valid HTML, so old data still works)
  contentJson: string | null; // TipTap JSON doc serialized as string (for reliable editor loading)
  fontSize: number;         // Default/base font size
  fontFamily: string;       // Default/base font family
  fontWeight: string;       // Default/base font weight
  fontStyle: string;        // Default/base font style
  textDecoration: string;   // Default/base text decoration (element-wide via CSS)
  textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize'; // Element-wide via CSS
  color: string;            // Default/base text color
  textAlign: 'left' | 'center' | 'right' | 'justify'; // Default/base alignment
  lineHeight: number;       // Element-wide
  letterSpacing: number;    // Element-wide
  opacity: number;          // Element-wide
}

export interface CellOverride {
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  padding?: number;
  bgColor?: string;
  color?: string;
  fontFamily?: string;
  fontWeight?: string;
  fontSize?: number;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  // Per-side border visibility (true = show, false = hide)
  borderTop?: boolean;
  borderRight?: boolean;
  borderBottom?: boolean;
  borderLeft?: boolean;
  // Transform: rotation in degrees
  rotation?: number;
}

export interface TableProperties {
  rows: number;
  cols: number;
  cellData: string[][];
  cellOverrides: Record<string, CellOverride>; // key: "r-c" e.g. "0-1", "2-0"
  // Header
  showHeader: boolean;
  headerBg: string;
  headerColor: string;
  headerFontWeight: string;
  // Default cell styling
  cellBg: string;
  cellColor: string;
  cellPadding: number;
  fontFamily: string;       // Default/base font family for all cells
  fontSize: number;
  // Row/col background overrides
  rowBgColors: Record<number, string>; // key: row index (0-based)
  colBgColors: Record<number, string>; // key: col index (0-based)
  // Border
  borderWidth: number;
  borderStyle: 'solid' | 'dashed' | 'dotted';
  borderColor: string;
  /** @deprecated Use showBorderTop/Right/Bottom/Left instead */
  showOuterBorder?: boolean;
  /** @deprecated Use showInnerBorders instead */
  showInnerBorder?: boolean;
  // Per-side outer border visibility
  showBorderTop: boolean;
  showBorderRight: boolean;
  showBorderBottom: boolean;
  showBorderLeft: boolean;
  // Inner border visibility (grid lines between cells)
  showInnerBorders: boolean;
  // Corner radius
  cornerRadius: {
    mode: 'linked' | 'individual';
    all: number;
    topLeft: number;
    topRight: number;
    bottomRight: number;
    bottomLeft: number;
  };
  // Column/row sizing — proportional fractions (e.g. [1, 2, 1] = 25%/50%/25%)
  colWidths: number[];
  rowHeights: number[];
  // Stable row/column names — move with data on reorder
  rowNames: string[];
  colNames: string[];
  // Global
  opacity: number;
}

export interface ImageProperties {
  src: string;
  objectFit: 'contain' | 'cover' | 'fill';
  borderRadius: number;
  opacity: number;
  borderWidth: number;
  borderColor: string;
  /** Optional border style for image borders (defaults to 'solid'). */
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  brightness: number;  // 0-200, default 100
  contrast: number;    // 0-200, default 100
  saturation: number;  // 0-200, default 100
  blur: number;        // 0-20, default 0
  effects: RectangleEffects;
}

export interface LineProperties {
  strokeWidth: number;
  strokeColor: string;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  opacity: number;
  lineCap: 'butt' | 'round' | 'square';
}

export interface RectangleProperties {
  fill: string;
  borderWidth: number;
  borderColor: string;
  borderStyle: 'solid' | 'dashed' | 'dotted';
  borderRadius: {
    mode: 'linked' | 'individual';
    all: number;
    topLeft: number;
    topRight: number;
    bottomRight: number;
    bottomLeft: number;
  } | number; // number for backward compat
  opacity: number;
  effects: RectangleEffects;
  // Rotation in degrees, applied around the rectangle's center. Stored on the
  // properties object (rather than the top-level CanvasElement.rotation field,
  // which is reserved for group rotation) so the rotation persists across
  // duplicate/paste, undo/redo, and project save/load. Default 0 means no
  // rotation. Range is unrestricted but the rotation handle and properties
  // panel normalize it to [-180, 180] for display.
  rotation?: number;
}

export interface EllipseProperties {
  fill: string;
  borderWidth: number;
  borderColor: string;
  borderStyle: 'solid' | 'dashed' | 'dotted';
  opacity: number;
  effects: RectangleEffects;
}

// ─── Rectangle Effects ───────────────────────────────────────────────

export interface GradientStop {
  color: string;
  position: number; // 0–100
  opacity: number;  // 0–1
}

export interface GradientFill {
  type: 'solid' | 'gradient' | 'picture' | 'transparent';
  gradientVariant: 'linear' | 'radial';
  direction: 'horizontal' | 'vertical' | 'diagonal' | 'radial';
  stops: GradientStop[];
  rotateWithShape: boolean;
  pictureSrc?: string;        // base64 data URL for picture fill
  pictureObjectFit?: 'contain' | 'cover' | 'fill';  // how the picture fills the shape
}

export interface ShadowEffect {
  enabled: boolean;
  type: 'outer' | 'inner' | 'drop';
  color: string;
  opacity: number;    // 0–1
  blur: number;       // px
  distance: number;   // px
  angle: number;      // degrees
}

export interface ReflectionEffect {
  enabled: boolean;
  size: number;       // 0–100%
  opacity: number;    // 0–1
  distance: number;   // px
  preset: 'soft' | 'tight' | 'fade' | 'mirror';
}

export interface GlowEffect {
  enabled: boolean;
  color: string;
  size: number;       // px
  opacity: number;    // 0–1
}

export interface RectangleEffects {
  gradient: GradientFill;
  shadow: ShadowEffect;
  reflection: ReflectionEffect;
  glow: GlowEffect;
}

// ─── Effect Defaults ─────────────────────────────────────────────────

export const DEFAULT_GRADIENT_FILL: GradientFill = {
  type: 'solid',
  gradientVariant: 'linear',
  direction: 'horizontal',
  stops: [
    { color: '#3b82f6', position: 0, opacity: 1 },
    { color: '#8b5cf6', position: 100, opacity: 1 },
  ],
  rotateWithShape: false,
  pictureSrc: '',
  pictureObjectFit: 'cover',
};

export const DEFAULT_SHADOW: ShadowEffect = {
  enabled: false,
  type: 'outer',
  color: '#000000',
  opacity: 0.3,
  blur: 10,
  distance: 5,
  angle: 45,
};

export const DEFAULT_REFLECTION: ReflectionEffect = {
  enabled: false,
  size: 50,
  opacity: 0.3,
  distance: 10,
  preset: 'fade',
};

export const DEFAULT_GLOW: GlowEffect = {
  enabled: false,
  color: '#3b82f6',
  size: 10,
  opacity: 0.5,
};

export const DEFAULT_EFFECTS: RectangleEffects = {
  gradient: { ...DEFAULT_GRADIENT_FILL },
  shadow: { ...DEFAULT_SHADOW },
  reflection: { ...DEFAULT_REFLECTION },
  glow: { ...DEFAULT_GLOW },
};

// ─── Preset Gradients ────────────────────────────────────────────────

export interface GradientPreset {
  name: string;
  stops: GradientStop[];
  direction: GradientFill['direction'];
  gradientVariant: GradientFill['gradientVariant'];
}

export const GRADIENT_PRESETS: GradientPreset[] = [
  { name: 'Sunset', stops: [{ color: '#f97316', position: 0, opacity: 1 }, { color: '#ec4899', position: 100, opacity: 1 }], direction: 'horizontal', gradientVariant: 'linear' },
  { name: 'Ocean', stops: [{ color: '#06b6d4', position: 0, opacity: 1 }, { color: '#3b82f6', position: 100, opacity: 1 }], direction: 'horizontal', gradientVariant: 'linear' },
  { name: 'Forest', stops: [{ color: '#22c55e', position: 0, opacity: 1 }, { color: '#14b8a6', position: 100, opacity: 1 }], direction: 'horizontal', gradientVariant: 'linear' },
  { name: 'Lavender', stops: [{ color: '#a78bfa', position: 0, opacity: 1 }, { color: '#f472b6', position: 100, opacity: 1 }], direction: 'horizontal', gradientVariant: 'linear' },
  { name: 'Fire', stops: [{ color: '#ef4444', position: 0, opacity: 1 }, { color: '#f59e0b', position: 100, opacity: 1 }], direction: 'horizontal', gradientVariant: 'linear' },
  { name: 'Midnight', stops: [{ color: '#1e1b4b', position: 0, opacity: 1 }, { color: '#312e81', position: 50, opacity: 1 }, { color: '#4c1d95', position: 100, opacity: 1 }], direction: 'diagonal', gradientVariant: 'linear' },
  { name: 'Sky', stops: [{ color: '#38bdf8', position: 0, opacity: 1 }, { color: '#818cf8', position: 50, opacity: 1 }, { color: '#c084fc', position: 100, opacity: 1 }], direction: 'horizontal', gradientVariant: 'linear' },
  { name: 'Rose Gold', stops: [{ color: '#fda4af', position: 0, opacity: 1 }, { color: '#fcd34d', position: 100, opacity: 1 }], direction: 'diagonal', gradientVariant: 'linear' },
  { name: 'Radial Blue', stops: [{ color: '#3b82f6', position: 0, opacity: 1 }, { color: '#1e3a5f', position: 100, opacity: 1 }], direction: 'radial', gradientVariant: 'radial' },
  { name: 'Radial Warm', stops: [{ color: '#fbbf24', position: 0, opacity: 1 }, { color: '#92400e', position: 100, opacity: 1 }], direction: 'radial', gradientVariant: 'radial' },
];

// ─── Gradient CSS Builder ────────────────────────────────────────────

export function buildGradientCSS(gradient: GradientFill, width: number, height: number): string {
  if (gradient.type === 'solid') return '';
  if (gradient.type === 'picture') return ''; // picture fill is handled separately via background-image
  if (gradient.type === 'transparent') return '';
  const sortedStops = [...gradient.stops].sort((a, b) => a.position - b.position);
  const colorStops = sortedStops.map((s) => {
    const r = parseInt(s.color.slice(1, 3), 16);
    const g = parseInt(s.color.slice(3, 5), 16);
    const b = parseInt(s.color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${s.opacity}) ${s.position}%`;
  }).join(', ');

  if (gradient.gradientVariant === 'radial') {
    return `radial-gradient(circle, ${colorStops})`;
  }

  // Linear gradient
  let angle: number;
  switch (gradient.direction) {
    case 'horizontal': angle = 90; break;
    case 'vertical': angle = 180; break;
    case 'diagonal': angle = 135; break;
    default: angle = 90;
  }
  return `linear-gradient(${angle}deg, ${colorStops})`;
}

// ─── Shadow CSS Builder ──────────────────────────────────────────────

export function buildShadowCSS(shadow: ShadowEffect, borderRadius: number): React.CSSProperties {
  if (!shadow.enabled) return {};
  const r = parseInt(shadow.color.slice(1, 3), 16);
  const g = parseInt(shadow.color.slice(3, 5), 16);
  const b = parseInt(shadow.color.slice(5, 7), 16);
  const color = `rgba(${r},${g},${b},${shadow.opacity})`;
  const offsetX = Math.round(shadow.distance * Math.cos((shadow.angle * Math.PI) / 180));
  const offsetY = Math.round(shadow.distance * Math.sin((shadow.angle * Math.PI) / 180));

  if (shadow.type === 'inner') {
    return { boxShadow: `inset ${offsetX}px ${offsetY}px ${shadow.blur}px ${color}` };
  }
  return { boxShadow: `${offsetX}px ${offsetY}px ${shadow.blur}px ${color}` };
}

// ─── Glow CSS Builder ────────────────────────────────────────────────

export function buildGlowCSS(glow: GlowEffect): React.CSSProperties {
  if (!glow.enabled) return {};
  const r = parseInt(glow.color.slice(1, 3), 16);
  const g = parseInt(glow.color.slice(3, 5), 16);
  const b = parseInt(glow.color.slice(5, 7), 16);
  const color = `rgba(${r},${g},${b},${glow.opacity})`;
  return { boxShadow: `0 0 ${glow.size}px ${glow.size / 2}px ${color}` };
}

// ─── Picture Fill CSS Builder ────────────────────────────────────────

export function buildPictureFillCSS(gradient: GradientFill): React.CSSProperties {
  if (gradient.type !== 'picture' || !gradient.pictureSrc) return {};
  return {
    backgroundImage: `url(${gradient.pictureSrc})`,
    backgroundSize: gradient.pictureObjectFit === 'contain' ? 'contain' : gradient.pictureObjectFit === 'fill' ? '100% 100%' : 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  };
}

export type ElementProperties =
  | { type: 'text'; data: TextProperties }
  | { type: 'table'; data: TableProperties }
  | { type: 'image'; data: ImageProperties }
  | { type: 'line'; data: LineProperties }
  | { type: 'rectangle'; data: RectangleProperties }
  | { type: 'ellipse'; data: EllipseProperties }
  | { type: 'group'; data: GroupProperties };

// ─── Group Properties ──────────────────────────────────────────────────

export interface GroupProperties {
  // Groups have no visual properties — they are just containers
}

export interface CanvasElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  locked: boolean;
  visible: boolean;
  name: string;
  properties: ElementProperties;
  // Line endpoint coordinates (absolute canvas position) — only used for line elements
  lineStartX?: number;
  lineStartY?: number;
  lineEndX?: number;
  lineEndY?: number;
  // Group children — only used for group elements
  // Children store positions relative to the group's (x, y)
  children?: CanvasElement[];
  // Rotation in degrees — used for groups (and future per-element rotation)
  rotation?: number;

  // ── Independent Corner Points (Rectangle tool) ────────────────────────────
  // Four corner points stored in ABSOLUTE canvas coordinates. Order:
  // [0]=TopLeft, [1]=TopRight, [2]=BottomRight, [3]=BottomLeft.
  // When undefined, the rectangle renders as a normal axis-aligned box using
  // x/y/width/height (backward compatible). When defined (created the first
  // time the user Alt-drags a corner), the rectangle renders as an SVG
  // polygon (a custom quadrilateral) and each corner can be manipulated
  // independently. The element's x/y/width/height always reflects the
  // bounding box of the four corner points.
  cornerPoints?: { x: number; y: number }[];

  // ── Top-level opacity (0–1) ──────────────────────────────────────────────
  // Applies to ALL element types including groups (which have no properties.data
  // of their own). Defaults to 1 (fully opaque) when undefined. For typed
  // elements (rectangle/ellipse/image/text) this is IN ADDITION TO the
  // per-type opacity in properties.data — the wrapper applies this top-level
  // opacity, while the type renderer applies its own. For groups and
  // multi-selection this is the single source of opacity. Using a top-level
  // field (rather than properties.data.opacity) lets groups and multi-select
  // share one opacity control without per-type branching.
  opacity?: number;
}

export function getDefaultProperties(type: ElementType): ElementProperties {
  switch (type) {
    case 'text':
      return {
        type: 'text',
        data: {
          content: 'Double-click to edit text',
          contentJson: null,
          fontSize: 16,
          fontFamily: 'Inter, sans-serif',
          fontWeight: 'normal',
          fontStyle: 'normal',
          textDecoration: 'none',
          textTransform: 'none',
          color: '#1a1a1a',
          textAlign: 'left',
          lineHeight: 1.5,
          letterSpacing: 0,
          opacity: 1,
        },
      };
    case 'group':
      return {
        type: 'group',
        data: {},
      };
    case 'table':
      return {
        type: 'table',
        data: {
          rows: 4,
          cols: 3,
          cellData: [
            ['', '', ''],
            ['', '', ''],
            ['', '', ''],
            ['', '', ''],
          ],
          cellOverrides: {},
          showHeader: true,
          headerBg: '#f3f4f6',
          headerColor: '#111827',
          headerFontWeight: 'bold',
          cellBg: '#ffffff',
          cellColor: '#374151',
          cellPadding: 8,
          fontFamily: 'Inter, sans-serif',
          fontSize: 13,
          rowBgColors: {},
          colBgColors: {},
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: '#d1d5db',
          showBorderTop: true,
          showBorderRight: true,
          showBorderBottom: true,
          showBorderLeft: true,
          showInnerBorders: true,
          cornerRadius: { mode: 'linked', all: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          colWidths: [1, 1, 1],
          rowHeights: [1, 1, 1, 1],
          rowNames: ['Row 1', 'Row 2', 'Row 3', 'Row 4'],
          colNames: ['Column 1', 'Column 2', 'Column 3'],
          opacity: 1,
        },
      };
    case 'image':
      return {
        type: 'image',
        data: {
          src: '',
          objectFit: 'contain',
          borderRadius: 0,
          opacity: 1,
          borderWidth: 0,
          borderColor: '#d1d5db',
          brightness: 100,
          contrast: 100,
          saturation: 100,
          blur: 0,
          effects: { ...DEFAULT_EFFECTS },
        },
      };
    case 'line':
      return {
        type: 'line',
        data: {
          strokeWidth: 2,
          strokeColor: '#ec4899',
          strokeStyle: 'solid',
          opacity: 1,
          lineCap: 'butt',
        },
      };
    case 'rectangle':
      return {
        type: 'rectangle',
        data: {
          fill: '#f9a8d4',
          borderWidth: 2,
          borderColor: '#1a1a1a',
          borderStyle: 'solid',
          borderRadius: { mode: 'linked', all: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          opacity: 1,
          effects: {
            gradient: { ...DEFAULT_GRADIENT_FILL },
            shadow: { ...DEFAULT_SHADOW },
            reflection: { ...DEFAULT_REFLECTION },
            glow: { ...DEFAULT_GLOW },
          },
        },
      };
    case 'ellipse':
      return {
        type: 'ellipse',
        data: {
          fill: '#f9a8d4',
          borderWidth: 2,
          borderColor: '#1a1a1a',
          borderStyle: 'solid',
          opacity: 1,
          effects: {
            gradient: { ...DEFAULT_GRADIENT_FILL },
            shadow: { ...DEFAULT_SHADOW },
            reflection: { ...DEFAULT_REFLECTION },
            glow: { ...DEFAULT_GLOW },
          },
        },
      };
  }
}

/**
 * Read a rectangle's rotation in degrees (0 if undefined).
 * Centralizes the default so all callers (renderer, export, snapping, etc.)
 * agree on the "no rotation" value.
 */
export function getRectRotation(el: CanvasElement): number {
  if (el.type !== 'rectangle') return 0;
  const data = (el.properties as { type: 'rectangle'; data: RectangleProperties }).data;
  return typeof data.rotation === 'number' && isFinite(data.rotation) ? data.rotation : 0;
}

/**
 * Normalize an angle in degrees to the range [-180, 180].
 * Used by the rotation handle and properties panel so the displayed angle
 * never grows unboundedly (e.g. 540° → 180°, 270° → -90°).
 */
export function normalizeAngle(deg: number): number {
  // ((deg + 180) mod 360) - 180, with a positive modulus
  let n = ((deg + 180) % 360 + 360) % 360 - 180;
  // Avoid -0 in display
  if (n === 0) n = 0;
  return n;
}

export function getDefaultSize(type: ElementType): { width: number; height: number } {
  switch (type) {
    case 'text':
      return { width: 200, height: 40 };
    case 'group':
      return { width: 0, height: 0 };
    case 'table':
      return { width: 360, height: 160 };
    case 'image':
      return { width: 150, height: 150 };
    case 'line':
      return { width: 200, height: 0 };
    case 'rectangle':
      return { width: 200, height: 100 };
    case 'ellipse':
      return { width: 120, height: 120 };
  }
}

// Compute bounding box from line endpoints (with padding for handles)
export function computeLineBounds(startX: number, startY: number, endX: number, endY: number) {
  const padding = 8;
  const minX = Math.min(startX, endX);
  const minY = Math.min(startY, endY);
  const maxX = Math.max(startX, endX);
  const maxY = Math.max(startY, endY);
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(maxX - minX + padding * 2, 1),
    height: Math.max(maxY - minY + padding * 2, 1),
  };
}

export function getDefaultName(type: ElementType, index: number): string {
  switch (type) {
    case 'text':
      return `Text ${index}`;
    case 'group':
      return `Group ${index}`;
    case 'table':
      return `Table ${index}`;
    case 'image':
      return `Image ${index}`;
    case 'line':
      return `Line ${index}`;
    case 'rectangle':
      return `Rectangle ${index}`;
    case 'ellipse':
      return `Ellipse ${index}`;
  }
}

/** Resolve table corner radius into individual values */
export function resolveCornerRadius(
  cr: TableProperties['cornerRadius'] | undefined
): { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number } {
  const safe = cr ?? { mode: 'linked' as const, all: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
  if (safe.mode === 'linked') {
    return { topLeft: safe.all, topRight: safe.all, bottomRight: safe.all, bottomLeft: safe.all };
  }
  return { topLeft: safe.topLeft, topRight: safe.topRight, bottomRight: safe.bottomRight, bottomLeft: safe.bottomLeft };
}

/** Resolve rectangle border radius (handles both number and object formats) */
export function resolveRectBorderRadius(
  br: RectangleProperties['borderRadius']
): { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number } {
  if (typeof br === 'number') {
    // Backward compat: old format was just a number
    return { topLeft: br, topRight: br, bottomRight: br, bottomLeft: br };
  }
  if (!br) {
    return { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
  }
  if (br.mode === 'linked') {
    return { topLeft: br.all, topRight: br.all, bottomRight: br.all, bottomLeft: br.all };
  }
  return { topLeft: br.topLeft, topRight: br.topRight, bottomRight: br.bottomRight, bottomLeft: br.bottomLeft };
}

/** Normalize rectangle borderRadius to object format (for editing) */
export function normalizeRectBorderRadius(
  br: RectangleProperties['borderRadius']
): { mode: 'linked' | 'individual'; all: number; topLeft: number; topRight: number; bottomRight: number; bottomLeft: number } {
  if (typeof br === 'number') {
    return { mode: 'linked', all: br, topLeft: br, topRight: br, bottomRight: br, bottomLeft: br };
  }
  if (!br) {
    return { mode: 'linked', all: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
  }
  return br;
}
