/**
 * Shared Table Cell Helpers
 *
 * Single source of truth for table cell styling resolution.
 * Used by both canvas-element.tsx (React rendering) and pdf-export.ts (DOM rendering).
 */

import type { TableProperties, CellOverride } from './element-types';

// ── Cell Override Lookup ────────────────────────────────────────────────────

function getOverride(props: TableProperties, r: number, c: number): CellOverride | undefined {
  return props.cellOverrides[`${r}-${c}`];
}

// ── Cell Styling Helpers ────────────────────────────────────────────────────

export function getCellBg(r: number, c: number, props: TableProperties): string {
  const override = getOverride(props, r, c);
  if (override?.bgColor) return override.bgColor;
  if (props.rowBgColors[r]) return props.rowBgColors[r];
  if (props.colBgColors[c]) return props.colBgColors[c];
  if (r === 0 && props.showHeader) return props.headerBg;
  return props.cellBg;
}

export function getCellColor(r: number, c: number, props: TableProperties): string {
  const override = getOverride(props, r, c);
  if (override?.color) return override.color;
  if (r === 0 && props.showHeader) return props.headerColor;
  return props.cellColor;
}

export function getCellFontWeight(r: number, c: number, props: TableProperties): string {
  const override = getOverride(props, r, c);
  if (override?.fontWeight) return override.fontWeight;
  if (r === 0 && props.showHeader) return props.headerFontWeight;
  return 'normal';
}

export function getCellFontSize(r: number, c: number, props: TableProperties): number {
  const override = getOverride(props, r, c);
  if (override?.fontSize) return override.fontSize;
  return props.fontSize;
}

export function getCellFontFamily(r: number, c: number, props: TableProperties): string {
  const override = getOverride(props, r, c);
  if (override?.fontFamily) return override.fontFamily;
  return props.fontFamily || 'Inter, sans-serif';
}

export function getCellPadding(r: number, c: number, props: TableProperties): number {
  const override = getOverride(props, r, c);
  if (override?.padding !== undefined) return override.padding;
  return props.cellPadding;
}

export function getCellTextAlign(r: number, c: number, props: TableProperties): string {
  const override = getOverride(props, r, c);
  return override?.textAlign || 'left';
}

export function getCellVerticalAlign(r: number, c: number, props: TableProperties): string {
  const override = getOverride(props, r, c);
  return override?.verticalAlign || 'middle';
}

export function getCellTextTransform(r: number, c: number, props: TableProperties): string {
  const override = getOverride(props, r, c);
  return override?.textTransform || 'none';
}

export function getCellRotation(r: number, c: number, props: TableProperties): number {
  const override = getOverride(props, r, c);
  return override?.rotation || 0;
}

// ── Per-Side Border Visibility ──────────────────────────────────────────────
//
// A border edge is visible ONLY if BOTH adjacent cells agree it should be shown.
// For outer edges, the table-level setting acts as the "other side".

export function getCellBorderTop(r: number, c: number, props: TableProperties): boolean {
  const override = getOverride(props, r, c);
  const thisCellTop = override?.borderTop !== undefined ? override.borderTop : true;
  // When header is hidden, row 1 is the first visible row and its top
  // border is the outer border of the table (controlled by showBorderTop).
  const firstVisibleRow = props.showHeader ? 0 : 1;
  if (r === firstVisibleRow) return thisCellTop && props.showBorderTop;
  const aboveOverride = getOverride(props, r - 1, c);
  const aboveCellBottom = aboveOverride?.borderBottom !== undefined ? aboveOverride.borderBottom : true;
  return thisCellTop && aboveCellBottom && props.showInnerBorders;
}

export function getCellBorderBottom(r: number, c: number, props: TableProperties): boolean {
  const override = getOverride(props, r, c);
  const thisCellBottom = override?.borderBottom !== undefined ? override.borderBottom : true;
  if (r === props.rows - 1) return thisCellBottom && props.showBorderBottom;
  const belowOverride = getOverride(props, r + 1, c);
  const belowCellTop = belowOverride?.borderTop !== undefined ? belowOverride.borderTop : true;
  return thisCellBottom && belowCellTop && props.showInnerBorders;
}

export function getCellBorderLeft(r: number, c: number, props: TableProperties): boolean {
  const override = getOverride(props, r, c);
  const thisCellLeft = override?.borderLeft !== undefined ? override.borderLeft : true;
  if (c === 0) return thisCellLeft && props.showBorderLeft;
  const leftOverride = getOverride(props, r, c - 1);
  const leftCellRight = leftOverride?.borderRight !== undefined ? leftOverride.borderRight : true;
  return thisCellLeft && leftCellRight && props.showInnerBorders;
}

export function getCellBorderRight(r: number, c: number, props: TableProperties): boolean {
  const override = getOverride(props, r, c);
  const thisCellRight = override?.borderRight !== undefined ? override.borderRight : true;
  if (c === props.cols - 1) return thisCellRight && props.showBorderRight;
  const rightOverride = getOverride(props, r, c + 1);
  const rightCellLeft = rightOverride?.borderLeft !== undefined ? rightOverride.borderLeft : true;
  return thisCellRight && rightCellLeft && props.showInnerBorders;
}

/**
 * Convenience: returns all four border visibilities at once.
 * Avoids 4 separate override lookups for the same cell.
 */
export function getCellBorderVisibility(
  r: number,
  c: number,
  props: TableProperties,
): { top: boolean; right: boolean; bottom: boolean; left: boolean } {
  return {
    top: getCellBorderTop(r, c, props),
    right: getCellBorderRight(r, c, props),
    bottom: getCellBorderBottom(r, c, props),
    left: getCellBorderLeft(r, c, props),
  };
}

/**
 * Resolve legacy table properties (showOuterBorder / showInnerBorder)
 * into a fully-normalized TableProperties object with per-side borders.
 */
export function normalizeTableProps(raw: TableProperties): TableProperties {
  const legacyOuter = raw.showOuterBorder;
  const legacyInner = raw.showInnerBorder;
  const cols = raw.cols ?? 3;
  const rows = raw.rows ?? 4;
  return {
    rows,
    cols,
    cellData: raw.cellData ?? [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']],
    cellOverrides: raw.cellOverrides ?? {},
    showHeader: raw.showHeader ?? true,
    headerBg: raw.headerBg ?? '#f3f4f6',
    headerColor: raw.headerColor ?? '#111827',
    headerFontWeight: raw.headerFontWeight ?? 'bold',
    cellBg: raw.cellBg ?? '#ffffff',
    cellColor: raw.cellColor ?? '#374151',
    cellPadding: raw.cellPadding ?? 8,
    fontFamily: raw.fontFamily ?? 'Inter, sans-serif',
    fontSize: raw.fontSize ?? 13,
    rowBgColors: raw.rowBgColors ?? {},
    colBgColors: raw.colBgColors ?? {},
    borderWidth: raw.borderWidth ?? 1,
    borderStyle: raw.borderStyle ?? 'solid',
    borderColor: raw.borderColor ?? '#d1d5db',
    showBorderTop: raw.showBorderTop ?? (legacyOuter !== undefined ? legacyOuter : true),
    showBorderRight: raw.showBorderRight ?? (legacyOuter !== undefined ? legacyOuter : true),
    showBorderBottom: raw.showBorderBottom ?? (legacyOuter !== undefined ? legacyOuter : true),
    showBorderLeft: raw.showBorderLeft ?? (legacyOuter !== undefined ? legacyOuter : true),
    showInnerBorders: raw.showInnerBorders ?? (legacyInner !== undefined ? legacyInner : true),
    cornerRadius: raw.cornerRadius ?? { mode: 'linked', all: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    colWidths: ensureColWidths(cols, raw.colWidths),
    rowHeights: ensureRowHeights(rows, raw.rowHeights),
    rowNames: ensureRowNames(rows, raw.rowNames),
    colNames: ensureColNames(cols, raw.colNames),
    opacity: raw.opacity ?? 1,
  };
}

/**
 * Ensure colWidths array matches the current column count.
 * If missing or wrong length, returns equal-fractions array.
 */
export function ensureColWidths(cols: number, colWidths: number[] | undefined): number[] {
  if (!colWidths || colWidths.length !== cols) return Array(cols).fill(1);
  return colWidths;
}

/**
 * Ensure rowHeights array matches the current row count.
 * If missing or wrong length, returns equal-fractions array.
 */
export function ensureRowHeights(rows: number, rowHeights: number[] | undefined): number[] {
  if (!rowHeights || rowHeights.length !== rows) return Array(rows).fill(1);
  return rowHeights;
}

/**
 * Ensure rowNames array matches the current row count.
 * If missing or wrong length, generates default names ("Row 1", "Row 2", ...).
 */
export function ensureRowNames(rows: number, rowNames: string[] | undefined): string[] {
  if (!rowNames || rowNames.length !== rows) {
    return Array.from({ length: rows }, (_, i) => `Row ${i + 1}`);
  }
  return rowNames;
}

/**
 * Ensure colNames array matches the current column count.
 * If missing or wrong length, generates default names ("Column 1", "Column 2", ...).
 */
export function ensureColNames(cols: number, colNames: string[] | undefined): string[] {
  if (!colNames || colNames.length !== cols) {
    return Array.from({ length: cols }, (_, i) => `Column ${i + 1}`);
  }
  return colNames;
}
