/**
 * PDF Export Utility — Pixel-Perfect Rendering (Optimized)
 *
 * Renders the canvas to an off-screen DOM, captures it with html2canvas,
 * then generates a PDF with jsPDF at the exact canvas dimensions.
 *
 * UI elements (selection, guidelines, handles) are never rendered.
 *
 * Optimizations:
 * - Table cell helpers extracted to shared table-helpers.ts (no duplication)
 * - Legacy prop normalization extracted to normalizeTableProps()
 * - Gradient/shadow/glow CSS cached per element to avoid redundant rebuilds
 * - DocumentFragment for batch DOM insertion (single reflow)
 * - CSS containment on every element wrapper for browser layout optimization
 * - OffscreenCanvas used for thumbnail when available
 * - Pre-computed element positions before rendering loop
 * - Batch table cell creation with CSS containment per cell
 */

import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import {
  CanvasElement,
  TextProperties,
  TableProperties,
  ImageProperties,
  LineProperties,
  RectangleProperties,
  EllipseProperties,
  RectangleEffects,
  DEFAULT_EFFECTS,
  buildGradientCSS,
  buildShadowCSS,
  buildGlowCSS,
  resolveCornerRadius,
  resolveRectBorderRadius,
  getRectRotation,
} from './element-types';
import {
  hasCustomCorners,
  getRectCornerPoints,
  buildRoundedPolygonPath,
  buildSvgFillDescriptor,
  buildSvgFilterCSS,
  svgStrokeDasharray,
} from './rectangle-corners';
import {
  getCellBg,
  getCellColor,
  getCellFontWeight,
  getCellFontSize,
  getCellPadding,
  getCellTextAlign,
  getCellVerticalAlign,
  getCellTextTransform,
  getCellRotation,
  getCellBorderTop,
  getCellBorderBottom,
  getCellBorderLeft,
  getCellBorderRight,
  normalizeTableProps,
  ensureColWidths,
  ensureRowHeights,
} from './table-helpers';
import { properCapitalize, properCapitalizeHTML } from './utils';
import { CanvasSettings } from '@/store/designer-store';

// ── Export Options ────────────────────────────────────────────────────────────

export type DpiOption = 96 | 150 | 300;
export type CompressionOption = 'none' | 'medium' | 'high';

export interface ExportPdfOptions {
  dpi: DpiOption;
  compression: CompressionOption;
}

export const DEFAULT_EXPORT_OPTIONS: ExportPdfOptions = {
  dpi: 150,
  compression: 'medium',
};

// ── Effect CSS Cache ─────────────────────────────────────────────────────────
//
// Caches the combined boxShadow, background gradient, and reflection mask
// strings so that if the same element is rendered twice (e.g. rectangle + its
// reflection) we don't rebuild these strings from scratch.

interface EffectCacheEntry {
  combinedBoxShadow: string;
  // Fill-related CSS property pairs (never mixes shorthand `background` with longhands)
  fillCSS: [string, string][];  // e.g. [['background-color', 'red'], ...] or [['background-image', 'linear-gradient(...)'], ...]
}

const effectCache = new WeakMap<RectangleEffects, EffectCacheEntry>();

function getEffectCache(
  effects: RectangleEffects,
  fill: string,
  borderRadius: number,
  width: number,
  height: number,
): EffectCacheEntry {
  const cached = effectCache.get(effects);
  if (cached) return cached;

  const glowBoxShadow = buildGlowCSS(effects.glow).boxShadow as string | undefined;
  const shadowBoxShadow = buildShadowCSS(effects.shadow, borderRadius).boxShadow as string | undefined;

  let combinedBoxShadow = '';
  if (glowBoxShadow && shadowBoxShadow) {
    combinedBoxShadow = `${glowBoxShadow}, ${shadowBoxShadow}`;
  } else if (glowBoxShadow) {
    combinedBoxShadow = glowBoxShadow;
  } else if (shadowBoxShadow) {
    combinedBoxShadow = shadowBoxShadow;
  }

  const gradientCSS = buildGradientCSS(effects.gradient, width, height);

  // Build fill CSS properties using only longhand properties to avoid
  // shorthand/longhand conflicts (e.g. `background` resets `background-image`).
  const fillCSS: [string, string][] = [];
  if (effects.gradient.type === 'gradient' && gradientCSS) {
    fillCSS.push(['background-image', gradientCSS]);
  } else if (effects.gradient.type === 'picture' && effects.gradient.pictureSrc) {
    fillCSS.push(['background-color', fill]);
    fillCSS.push(['background-image', `url(${effects.gradient.pictureSrc})`]);
    fillCSS.push(['background-size', effects.gradient.pictureObjectFit === 'contain' ? 'contain' : effects.gradient.pictureObjectFit === 'fill' ? '100% 100%' : 'cover']);
    fillCSS.push(['background-position', 'center']);
    fillCSS.push(['background-repeat', 'no-repeat']);
  } else if (effects.gradient.type === 'transparent') {
    // Transparent — no fill CSS
  } else {
    fillCSS.push(['background-color', fill]);
  }

  const entry: EffectCacheEntry = { combinedBoxShadow, fillCSS };
  effectCache.set(effects, entry);
  return entry;
}

// ── Reflection Mask Lookup ───────────────────────────────────────────────────

const REFLECTION_MASKS: Record<string, string> = {
  soft: 'linear-gradient(to bottom, black 0%, transparent 80%)',
  tight: 'linear-gradient(to bottom, black 0%, transparent 50%)',
  fade: 'linear-gradient(to bottom, black 0%, transparent 100%)',
  mirror: 'linear-gradient(to bottom, black 0%, transparent 60%, transparent 100%)',
};

function getReflectionMask(preset: string): string {
  return REFLECTION_MASKS[preset] ?? 'linear-gradient(to bottom, black 0%, transparent 100%)';
}

// ── DOM Rendering Functions ──────────────────────────────────────────────────

function renderTextElement(element: CanvasElement): HTMLElement {
  const props = (element.properties as { type: 'text'; data: TextProperties }).data;

  const effectiveTextTransform = props.textTransform === 'capitalize' ? 'none' : props.textTransform;
  const content = document.createElement('div');
  content.style.cssText = [
    'width: 100%',
    'height: 100%',
    'overflow: hidden',
    `font-size: ${props.fontSize}px`,
    `font-family: ${props.fontFamily}`,
    `font-weight: ${props.fontWeight}`,
    `font-style: ${props.fontStyle}`,
    // Ensure the browser synthesizes italic/bold when the chosen font family
    // has no italic/bold face loaded (otherwise font-style:italic has no
    // visible effect for fonts like Arial/Verdana loaded as normal-only).
    'font-synthesis: style weight',
    `text-decoration: ${props.textDecoration}`,
    `text-transform: ${effectiveTextTransform}`,
    `color: ${props.color}`,
    `text-align: ${props.textAlign}`,
    `line-height: ${props.lineHeight}`,
    `letter-spacing: ${props.letterSpacing}px`,
    `opacity: ${props.opacity}`,
    'word-break: break-word',
    'white-space: pre-wrap',
  ].join('; ');

  // Use innerHTML to preserve rich text formatting (bold, italic, lists, etc.)
  // Old elements with plain text content still work since plain text is valid HTML
  const rawContent = props.content || '<p></p>';
  content.innerHTML = props.textTransform === 'capitalize' ? properCapitalizeHTML(rawContent) : rawContent;

  // Add list styles for proper rendering in html2canvas
  const style = document.createElement('style');
  style.textContent = [
    'ul { list-style-type: disc; padding-left: 1.5em; margin: 0; }',
    'ol { list-style-type: decimal; padding-left: 1.5em; margin: 0; }',
    'li { margin: 0; }',
    'p { margin: 0; }',
    // Ensure italic/bold always render visibly — even when the chosen font
    // family has no italic/bold face loaded. html2canvas renders this off-screen
    // DOM in isolation, so it does NOT inherit the app's globals.css rules.
    // font-synthesis makes the browser synthesize a faux italic/bold; the
    // explicit em/strong rules guarantee the style applies regardless of
    // Preflight or UA defaults.
    'em, i { font-style: italic; }',
    'strong, b { font-weight: bolder; }',
  ].join(' ');
  content.prepend(style);

  return content;
}

function renderTableElement(element: CanvasElement): HTMLElement {
  const rawProps = (element.properties as { type: 'table'; data: TableProperties }).data;
  const props = normalizeTableProps(rawProps);

  const bw = props.borderWidth;
  const borderStyleValue = props.borderStyle;
  const borderColorValue = props.borderColor;
  // Collapsed border model: each shared edge is drawn only ONCE.
  const borderStr = `${bw}px ${borderStyleValue} ${borderColorValue}`;

  const visibleRows = props.showHeader ? props.rows : Math.max(props.rows - 1, 1);
  const radii = resolveCornerRadius(props.cornerRadius);

  // Convert colWidths/rowHeights proportional fractions into EXPLICIT pixel
  // track sizes — matching the canvas rendering. CSS `fr` units are NOT used
  // because `fr` tracks are expanded by cell min-content/max-content, so a
  // wide cell would blow out the user's resized ratio and the exported PDF
  // would show default/equal sizes instead of the adjusted ones. Explicit px
  // values (last track absorbs rounding) reproduce the canvas layout exactly.
  const cw = ensureColWidths(props.cols, props.colWidths);
  const rh = ensureRowHeights(props.rows, props.rowHeights);
  const visibleRowHeights = props.showHeader ? rh : rh.slice(1);
  const visRh = visibleRowHeights.length > 0 ? visibleRowHeights : [1];
  const totalColFr = cw.reduce((a, b) => a + b, 0) || 1;
  const totalRowFr = visRh.reduce((a, b) => a + b, 0) || 1;
  const computeTrackSizes = (fracs: number[], total: number, totalFr: number): string[] => {
    if (fracs.length === 0) return ['100%'];
    const sizes = fracs.map(f => (f / totalFr) * total);
    const allocated = sizes.slice(0, -1).reduce((a, b) => a + b, 0);
    sizes[sizes.length - 1] = total - allocated;
    return sizes.map(s => `${s}px`);
  };
  const gridTemplateRows = computeTrackSizes(visRh, element.height, totalRowFr).join(' ');
  const gridTemplateColumns = computeTrackSizes(cw, element.width, totalColFr).join(' ');

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `width: 100%; height: 100%; opacity: ${props.opacity}; border-radius: ${radii.topLeft}px ${radii.topRight}px ${radii.bottomRight}px ${radii.bottomLeft}px;`;

  const grid = document.createElement('div');
  grid.style.cssText = [
    'display: grid',
    `grid-template-rows: ${gridTemplateRows}`,
    `grid-template-columns: ${gridTemplateColumns}`,
    'width: 100%',
    'height: 100%',
    `font-size: ${props.fontSize}px`,
    'overflow: hidden',
  ].join('; ');

  // Batch cell creation: use DocumentFragment to avoid multiple reflows
  const fragment = document.createDocumentFragment();

  for (let r = 0; r < props.rows; r++) {
    if (r === 0 && !props.showHeader) continue;

    for (let c = 0; c < props.cols; c++) {
      const padding = getCellPadding(r, c, props);
      const bgColor = getCellBg(r, c, props);
      const textColor = getCellColor(r, c, props);
      const fontWeight = getCellFontWeight(r, c, props);
      const fontSize = getCellFontSize(r, c, props);
      const textAlign = getCellTextAlign(r, c, props);
      const verticalAlign = getCellVerticalAlign(r, c, props);
      const textTransform = getCellTextTransform(r, c, props);
      // For 'capitalize', apply proper title case via JS instead of CSS
      const effectiveTextTransform = textTransform === 'capitalize' ? 'none' : textTransform;
      const cellRawText = props.cellData[r]?.[c] || '';
      const cellDisplayText = textTransform === 'capitalize' ? properCapitalize(cellRawText) : cellRawText;
      const rotation = getCellRotation(r, c, props);

      // Collapsed border model: each shared edge drawn once
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

      const justifyContent =
        verticalAlign === 'top' ? 'flex-start' : verticalAlign === 'bottom' ? 'flex-end' : 'center';

      const cell = document.createElement('div');
      cell.style.cssText = [
        'overflow: hidden',
        `padding: ${padding}px`,
        `background-color: ${bgColor}`,
        `color: ${textColor}`,
        `font-weight: ${fontWeight}`,
        `font-size: ${fontSize}px`,
        `text-align: ${textAlign}`,
        `text-transform: ${effectiveTextTransform}`,
        `border-top: ${borderTop}`,
        `border-bottom: ${borderBottom}`,
        `border-left: ${borderLeft}`,
        `border-right: ${borderRight}`,
        `border-radius: ${cellBorderRadius}`,
        'box-sizing: border-box',
        'display: flex',
        `align-items: ${justifyContent}`,
        'min-height: 0',
        'min-width: 0',
        ...(rotation ? [`transform: rotate(${rotation}deg)`] : []),
        // CSS containment: tells the browser this cell's layout is independent
        'contain: layout style',
      ].join('; ');

      const span = document.createElement('span');
      span.style.cssText = [
        'display: block',
        'width: 100%',
        'overflow: hidden',
        'text-overflow: ellipsis',
        'white-space: nowrap',
        'line-height: 1.2',
      ].join('; ');
      span.textContent = cellDisplayText;

      cell.appendChild(span);
      fragment.appendChild(cell);
    }
  }

  // Single DOM insertion for all cells
  grid.appendChild(fragment);
  wrapper.appendChild(grid);
  return wrapper;
}

function renderImageElement(element: CanvasElement): HTMLElement {
  const props = (element.properties as { type: 'image'; data: ImageProperties }).data;
  const effects: RectangleEffects = props.effects ?? { ...DEFAULT_EFFECTS };

  const container = document.createElement('div');
  container.style.cssText = 'width: 100%; height: 100%; position: relative;';

  // Compute combined box shadow
  const boxShadowParts: string[] = [];
  const glowBoxShadow = buildGlowCSS(effects.glow).boxShadow as string | undefined;
  const shadowBoxShadow = buildShadowCSS(effects.shadow, props.borderRadius).boxShadow as string | undefined;
  if (glowBoxShadow) boxShadowParts.push(glowBoxShadow);
  if (shadowBoxShadow) boxShadowParts.push(shadowBoxShadow);

  const wrapper = document.createElement('div');
  wrapper.style.cssText = [
    'width: 100%',
    'height: 100%',
    'overflow: hidden',
    `border-radius: ${props.borderRadius}px`,
    props.borderWidth > 0 ? `border: ${props.borderWidth}px solid ${props.borderColor}` : 'border: none',
    `opacity: ${props.opacity}`,
    boxShadowParts.length > 0 ? `box-shadow: ${boxShadowParts.join(', ')}` : '',
    'position: relative',
    'z-index: 2',
  ].filter(Boolean).join('; ');

  if (props.src) {
    const img = document.createElement('img');
    img.src = props.src;
    img.style.cssText = [
      'width: 100%',
      'height: 100%',
      `object-fit: ${props.objectFit}`,
      `filter: brightness(${props.brightness ?? 100}%) contrast(${props.contrast ?? 100}%) saturate(${props.saturation ?? 100}%) blur(${props.blur ?? 0}px)`,
    ].join('; ');
    img.setAttribute('draggable', 'false');
    wrapper.appendChild(img);
  } else {
    wrapper.style.backgroundColor = '#f9fafb';
    wrapper.style.border = '2px dashed #d1d5db';
  }

  container.appendChild(wrapper);

  // Reflection
  if (effects.reflection.enabled && props.src) {
    const reflectionMask = getReflectionMask(effects.reflection.preset);
    const reflectionContainer = document.createElement('div');
    reflectionContainer.style.cssText = [
      'position: absolute',
      `top: calc(100% + ${effects.reflection.distance}px)`,
      'left: 0',
      'width: 100%',
      `height: ${effects.reflection.size}%`,
      'overflow: hidden',
      'z-index: 1',
      'pointer-events: none',
      `mask-image: ${reflectionMask}`,
      `-webkit-mask-image: ${reflectionMask}`,
      `border-radius: ${props.borderRadius}px`,
    ].join('; ');

    const reflectionWrapper = document.createElement('div');
    reflectionWrapper.style.cssText = [
      'width: 100%',
      'height: 100%',
      'overflow: hidden',
      `border-radius: ${props.borderRadius}px`,
      props.borderWidth > 0 ? `border: ${props.borderWidth}px solid ${props.borderColor}` : 'border: none',
      'transform: scaleY(-1)',
      `opacity: ${effects.reflection.opacity}`,
    ].join('; ');

    const reflectionImg = document.createElement('img');
    reflectionImg.src = props.src;
    reflectionImg.style.cssText = [
      'width: 100%',
      'height: 100%',
      `object-fit: ${props.objectFit}`,
      `filter: brightness(${props.brightness ?? 100}%) contrast(${props.contrast ?? 100}%) saturate(${props.saturation ?? 100}%) blur(${props.blur ?? 0}px)`,
    ].join('; ');
    reflectionImg.setAttribute('draggable', 'false');
    reflectionWrapper.appendChild(reflectionImg);
    reflectionContainer.appendChild(reflectionWrapper);
    container.appendChild(reflectionContainer);
  }

  return container;
}

function renderLineElement(element: CanvasElement): HTMLElement {
  const props = (element.properties as { type: 'line'; data: LineProperties }).data;

  const startX = element.lineStartX ?? element.x;
  const startY = element.lineStartY ?? (element.y + element.height / 2);
  const endX = element.lineEndX ?? (element.x + element.width);
  const endY = element.lineEndY ?? (element.y + element.height / 2);

  const relStartX = startX - element.x;
  const relStartY = startY - element.y;
  const relEndX = endX - element.x;
  const relEndY = endY - element.y;

  const dashArray =
    props.strokeStyle === 'dashed' ? '8,4' : props.strokeStyle === 'dotted' ? '2,4' : 'none';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `width: 100%; height: 100%; opacity: ${props.opacity}; overflow: visible;`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.overflow = 'visible';

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M ${relStartX} ${relStartY} L ${relEndX} ${relEndY}`);
  path.setAttribute('stroke', props.strokeColor);
  path.setAttribute('stroke-width', String(props.strokeWidth));
  if (dashArray !== 'none') path.setAttribute('stroke-dasharray', dashArray);
  path.setAttribute('stroke-linecap', props.lineCap);
  path.setAttribute('fill', 'none');

  svg.appendChild(path);
  wrapper.appendChild(svg);
  return wrapper;
}

function renderRectangleElement(element: CanvasElement): HTMLElement {
  const props = (element.properties as { type: 'rectangle'; data: RectangleProperties }).data;
  const effects: RectangleEffects = props.effects ?? { ...DEFAULT_EFFECTS };
  const borderStyleValue =
    props.borderStyle === 'dotted' ? 'dotted' : props.borderStyle === 'dashed' ? 'dashed' : 'solid';

  // ── Custom-corner (deformed) rectangle: render as an SVG polygon ──────────
  // Mirrors the canvas renderer so PDF export / thumbnails / mini-preview all
  // reflect the custom quadrilateral shape.
  if (hasCustomCorners(element)) {
    const corners = getRectCornerPoints(element);
    // Build a rounded path so corner radius still applies after deformation.
    // When all radii are 0 this is equivalent to the straight-edged polygon.
    const radii = resolveRectBorderRadius(props.borderRadius);
    const pathD = buildRoundedPolygonPath(corners, radii, { x: element.x, y: element.y });
    const svgIdPrefix = `pdfrect-${element.id}`;
    const fillDesc = buildSvgFillDescriptor(effects.gradient, svgIdPrefix, props.fill);
    const filterCSS = buildSvgFilterCSS(effects);
    const dasharray = svgStrokeDasharray(props.borderStyle, props.borderWidth);

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position: relative; width: 100%; height: 100%; contain: layout style;';

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', `0 0 ${element.width} ${element.height}`);
    svg.setAttribute('overflow', 'visible');
    const svgStyle: string[] = ['display: block', 'position: relative', 'z-index: 2', `opacity: ${props.opacity}`];
    if (filterCSS) svgStyle.push(`filter: ${filterCSS}`);
    svg.style.cssText = svgStyle.join('; ');

    if (fillDesc.defs) {
      const defs = document.createElementNS(svgNS, 'defs');
      defs.innerHTML = fillDesc.defs;
      svg.appendChild(defs);
    }

    const shape = document.createElementNS(svgNS, 'path');
    shape.setAttribute('d', pathD);
    shape.setAttribute('fill', fillDesc.fill);
    shape.setAttribute('stroke', props.borderColor);
    shape.setAttribute('stroke-width', String(props.borderWidth));
    if (dasharray) shape.setAttribute('stroke-dasharray', dasharray);
    shape.setAttribute('stroke-linejoin', 'round');
    shape.setAttribute('stroke-linecap', borderStyleValue === 'dotted' ? 'round' : 'butt');
    svg.appendChild(shape);
    wrapper.appendChild(svg);

    if (effects.reflection.enabled) {
      const maskGradient = REFLECTION_MASKS[effects.reflection.preset] || REFLECTION_MASKS.fade;
      const reflContainer = document.createElement('div');
      reflContainer.style.cssText = [
        'position: absolute',
        `top: calc(100% + ${effects.reflection.distance}px)`,
        'left: 0',
        'width: 100%',
        `height: ${effects.reflection.size}%`,
        'overflow: hidden',
        'z-index: 1',
        'pointer-events: none',
        `-webkit-mask-image: ${maskGradient}`,
        `mask-image: ${maskGradient}`,
      ].join('; ');

      const reflSvg = document.createElementNS(svgNS, 'svg');
      reflSvg.setAttribute('width', '100%');
      reflSvg.setAttribute('height', '100%');
      reflSvg.setAttribute('viewBox', `0 0 ${element.width} ${element.height}`);
      reflSvg.setAttribute('overflow', 'visible');
      reflSvg.style.cssText = `display: block; transform: scaleY(-1); opacity: ${effects.reflection.opacity}`;
      if (fillDesc.defs) {
        const defs = document.createElementNS(svgNS, 'defs');
        // Use a distinct id prefix for the reflection to avoid duplicate-id collisions
        defs.innerHTML = fillDesc.defs.replace(new RegExp(svgIdPrefix, 'g'), `${svgIdPrefix}-refl`);
        reflSvg.appendChild(defs);
      }
      const reflShape = document.createElementNS(svgNS, 'path');
      reflShape.setAttribute('d', pathD);
      // Reference the reflection gradient/pattern id
      const reflFill = fillDesc.fill.replace(new RegExp(svgIdPrefix, 'g'), `${svgIdPrefix}-refl`);
      reflShape.setAttribute('fill', reflFill);
      reflShape.setAttribute('stroke', props.borderColor);
      reflShape.setAttribute('stroke-width', String(props.borderWidth));
      if (dasharray) reflShape.setAttribute('stroke-dasharray', dasharray);
      reflShape.setAttribute('stroke-linejoin', 'round');
      reflSvg.appendChild(reflShape);
      reflContainer.appendChild(reflSvg);
      wrapper.appendChild(reflContainer);
    }

    return wrapper;
  }

  // Resolve border radius (handles both number and object formats)
  const radii = resolveRectBorderRadius(props.borderRadius);
  const borderRadiusStr = `${radii.topLeft}px ${radii.topRight}px ${radii.bottomRight}px ${radii.bottomLeft}px`;

  // Use cached effect CSS computation
  const { combinedBoxShadow, fillCSS } = getEffectCache(
    effects, props.fill, radii.topLeft, element.width, element.height,
  );

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position: relative; width: 100%; height: 100%; contain: layout style;';

  const div = document.createElement('div');
  const styles = [
    'width: 100%',
    'height: 100%',
    `border-width: ${props.borderWidth}px`,
    `border-color: ${props.borderColor}`,
    `border-style: ${borderStyleValue}`,
    `border-radius: ${borderRadiusStr}`,
    `opacity: ${props.opacity}`,
    'box-sizing: border-box',
    'position: relative',
    'z-index: 2',
  ];
  if (combinedBoxShadow) styles.push(`box-shadow: ${combinedBoxShadow}`);
  // Add fill CSS properties (longhand only)
  for (const [prop, val] of fillCSS) {
    styles.push(`${prop}: ${val}`);
  }
  div.style.cssText = styles.join('; ');
  wrapper.appendChild(div);

  if (effects.reflection.enabled) {
    const maskGradient = REFLECTION_MASKS[effects.reflection.preset] || REFLECTION_MASKS.fade;

    const reflContainer = document.createElement('div');
    reflContainer.style.cssText = [
      'position: absolute',
      `top: calc(100% + ${effects.reflection.distance}px)`,
      'left: 0',
      'width: 100%',
      `height: ${effects.reflection.size}%`,
      'overflow: hidden',
      'z-index: 1',
      'pointer-events: none',
      `-webkit-mask-image: ${maskGradient}`,
      `mask-image: ${maskGradient}`,
    ].join('; ');

    const reflDiv = document.createElement('div');
    const reflStyles = [
      'width: 100%',
      'height: 100%',
      'transform: scaleY(-1)',
      `opacity: ${effects.reflection.opacity}`,
      `border-radius: ${borderRadiusStr}`,
      'box-sizing: border-box',
    ];
    // Add fill CSS properties to reflection
    for (const [prop, val] of fillCSS) {
      reflStyles.push(`${prop}: ${val}`);
    }
    reflDiv.style.cssText = reflStyles.join('; ');
    reflContainer.appendChild(reflDiv);
    wrapper.appendChild(reflContainer);
  }

  return wrapper;
}

function renderEllipseElement(element: CanvasElement): HTMLElement {
  const props = (element.properties as { type: 'ellipse'; data: EllipseProperties }).data;
  const effects: RectangleEffects = props.effects ?? { ...DEFAULT_EFFECTS };
  const borderStyleValue =
    props.borderStyle === 'dotted' ? 'dotted' : props.borderStyle === 'dashed' ? 'dashed' : 'solid';

  // Use cached effect CSS computation (borderRadius=50 for ellipse)
  const { combinedBoxShadow, fillCSS } = getEffectCache(
    effects, props.fill, 50, element.width, element.height,
  );

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position: relative; width: 100%; height: 100%; contain: layout style;';

  const div = document.createElement('div');
  const styles = [
    'width: 100%',
    'height: 100%',
    `border-width: ${props.borderWidth}px`,
    `border-color: ${props.borderColor}`,
    `border-style: ${borderStyleValue}`,
    'border-radius: 50%',
    `opacity: ${props.opacity}`,
    'box-sizing: border-box',
    'position: relative',
    'z-index: 2',
  ];
  if (combinedBoxShadow) styles.push(`box-shadow: ${combinedBoxShadow}`);
  // Add fill CSS properties (longhand only)
  for (const [prop, val] of fillCSS) {
    styles.push(`${prop}: ${val}`);
  }
  div.style.cssText = styles.join('; ');
  wrapper.appendChild(div);

  if (effects.reflection.enabled) {
    const maskGradient = REFLECTION_MASKS[effects.reflection.preset] || REFLECTION_MASKS.fade;

    const reflContainer = document.createElement('div');
    reflContainer.style.cssText = [
      'position: absolute',
      `top: calc(100% + ${effects.reflection.distance}px)`,
      'left: 0',
      'width: 100%',
      `height: ${effects.reflection.size}%`,
      'overflow: hidden',
      'z-index: 1',
      'pointer-events: none',
      `-webkit-mask-image: ${maskGradient}`,
      `mask-image: ${maskGradient}`,
    ].join('; ');

    const reflDiv = document.createElement('div');
    const reflStyles = [
      'width: 100%',
      'height: 100%',
      'transform: scaleY(-1)',
      `opacity: ${effects.reflection.opacity}`,
      'border-radius: 50%',
      'box-sizing: border-box',
    ];
    // Add fill CSS properties to reflection
    for (const [prop, val] of fillCSS) {
      reflStyles.push(`${prop}: ${val}`);
    }
    reflDiv.style.cssText = reflStyles.join('; ');
    reflContainer.appendChild(reflDiv);
    wrapper.appendChild(reflContainer);
  }

  return wrapper;
}

// ── Pre-computed Element Positions ───────────────────────────────────────────
//
// Before rendering, compute absolute positions for all visible elements.
// This avoids recalculating parent offsets during the recursive render.

interface PositionedElement {
  element: CanvasElement;
  absX: number;
  absY: number;
}

function computePositions(
  elements: CanvasElement[],
  parentOffsetX = 0,
  parentOffsetY = 0,
): PositionedElement[] {
  const result: PositionedElement[] = [];
  for (const element of elements) {
    if (!element.visible) continue;
    const absX = parentOffsetX + element.x;
    const absY = parentOffsetY + element.y;
    result.push({ element, absX, absY });
    // Pre-compute children positions for group elements
    if (element.type === 'group' && element.children) {
      const childPositions = computePositions(element.children, absX, absY);
      result.push(...childPositions);
    }
  }
  return result;
}

function renderElement(element: CanvasElement, parentOffsetX = 0, parentOffsetY = 0): HTMLElement {
  const absX = parentOffsetX + element.x;
  const absY = parentOffsetY + element.y;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = [
    'position: absolute',
    `left: ${absX}px`,
    `top: ${absY}px`,
    `width: ${element.width}px`,
    `height: ${element.height}px`,
    // CSS containment: isolate layout to this element only
    'contain: layout style',
  ].join('; ');

  switch (element.type) {
    case 'text':
      wrapper.appendChild(renderTextElement(element));
      break;
    case 'table':
      wrapper.appendChild(renderTableElement(element));
      break;
    case 'image':
      wrapper.appendChild(renderImageElement(element));
      break;
    case 'line':
      wrapper.appendChild(renderLineElement(element));
      break;
    case 'rectangle': {
      const rectContent = renderRectangleElement(element);
      // Apply rotation to the shape CONTENT only (not the wrapper) — same
      // strategy as the canvas renderer. The wrapper stays axis-aligned so
      // the absolute positioning above (left/top/width/height = bbox) is
      // correct; the inner shape spins around its center.
      const rotation = getRectRotation(element);
      if (rotation) {
        rectContent.style.transform = `rotate(${rotation}deg)`;
        rectContent.style.transformOrigin = 'center';
      }
      wrapper.appendChild(rectContent);
      break;
    }
    case 'ellipse':
      wrapper.appendChild(renderEllipseElement(element));
      break;
    case 'group':
      if (element.children && element.children.length > 0) {
        // Use DocumentFragment for batch child insertion
        const fragment = document.createDocumentFragment();
        for (const child of element.children) {
          if (!child.visible) continue;
          const childDom = renderElement(child, absX, absY);
          fragment.appendChild(childDom);
        }
        wrapper.appendChild(fragment);
      }
      wrapper.style.backgroundColor = 'transparent';
      break;
  }

  return wrapper;
}

// ── Main Export Function ─────────────────────────────────────────────────────

/**
 * Export the canvas to a PDF file.
 *
 * Rendering pipeline:
 * 1. Build an off-screen DOM from store data (no UI elements)
 * 2. Capture at desired DPI using html2canvas
 * 3. Create a PDF page with exact canvas dimensions using jsPDF
 * 4. Insert the rendered bitmap as a full-page image
 * 5. Trigger browser download
 */
export async function exportCanvasToPdf(
  elements: CanvasElement[],
  canvasSettings: CanvasSettings,
  projectName: string,
  options: ExportPdfOptions = DEFAULT_EXPORT_OPTIONS,
): Promise<void> {
  const { pageWidth, pageHeight, pageBackgroundColor } = canvasSettings;

  // ── Step 1: Build off-screen DOM using DocumentFragment ──
  const container = document.createElement('div');
  container.style.cssText = [
    'position: absolute',
    'left: -99999px',
    'top: 0',
    `width: ${pageWidth}px`,
    `height: ${pageHeight}px`,
    `background-color: ${pageBackgroundColor || '#ffffff'}`,
    'overflow: hidden',
  ].join('; ');

  // Batch all element DOM nodes into a fragment, then single insertion
  const fragment = document.createDocumentFragment();
  for (const element of elements) {
    if (!element.visible) continue;
    const dom = renderElement(element);
    fragment.appendChild(dom);
  }
  container.appendChild(fragment);

  document.body.appendChild(container);

  try {
    // ── Step 2: Capture with html2canvas at desired DPI ──
    const scale = options.dpi / 96;

    // Pre-check the resulting canvas dimensions. Browsers cap canvas area
    // (Chrome ~268M px, Safari much lower) and html2canvas allocates a
    // width*height*4-byte ImageData buffer that can OOM-crash the tab for
    // large pages at high DPI. Fail fast with an actionable message before
    // the heavy capture work begins.
    const scaledWidth = Math.ceil(pageWidth * scale);
    const scaledHeight = Math.ceil(pageHeight * scale);
    const MAX_CANVAS_DIMENSION = 16_384; // safe per-dimension ceiling
    const MAX_CANVAS_PIXELS = 100_000_000; // ~100M px (≈400MB ImageData buffer)
    if (
      scaledWidth > MAX_CANVAS_DIMENSION ||
      scaledHeight > MAX_CANVAS_DIMENSION ||
      scaledWidth * scaledHeight > MAX_CANVAS_PIXELS
    ) {
      throw new Error(
        `Canvas too large to render at ${options.dpi} DPI (${scaledWidth}×${scaledHeight} px). ` +
          'Reduce the page size or lower the export DPI and try again.',
      );
    }

    const canvas = await html2canvas(container, {
      scale,
      width: pageWidth,
      height: pageHeight,
      useCORS: true,
      allowTaint: true,
      backgroundColor: pageBackgroundColor || '#ffffff',
      scrollX: 0,
      scrollY: 0,
      windowWidth: pageWidth,
      windowHeight: pageHeight,
    });

    // ── Step 3: Create PDF with exact canvas dimensions ──
    const pxToPt = 72 / 96;
    const pageWidthPt = pageWidth * pxToPt;
    const pageHeightPt = pageHeight * pxToPt;

    const doc = new jsPDF({
      orientation: pageWidthPt > pageHeightPt ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [pageWidthPt, pageHeightPt],
      compress: true,
    });

    // ── Step 4: Insert rendered bitmap as full-page image ──
    //
    // File-size strategy (lossless where it matters):
    //
    // • 'none'  → PNG (lossless). The PNG stream is then Deflate-compressed
    //   inside the PDF at level 9 ('SLOW') by jsPDF. PNG of a full-page
    //   screenshot is normally huge because photographs/gradients don't
    //   compress well in PNG's filter+zip pipeline, but Deflate level 9 on
    //   the encoded stream still recovers a meaningful chunk and is fully
    //   lossless — zero quality loss.
    //
    // • 'medium'/'high' → JPEG (lossy, much smaller). JPEG is already DCT-
    //   compressed, so the PDF's Deflate filter is a no-op on these streams
    //   (jsPDF passes JPEGs through as DCTDecode). The alias below is kept at
    //   'SLOW' so any non-JPEG auxiliary streams still benefit.
    //
    // Two changes vs. the previous implementation:
    //   1. The HTMLCanvasElement is passed DIRECTLY to addImage instead of a
    //      base64 dataURL. A dataURL inflates the payload ~33% in memory and
    //      forces jsPDF to parse it back into bytes; passing the canvas lets
    //      jsPDF read the raw pixel/encoded bytes directly, which is both
    //      faster and lets its PNG processor choose the best Deflate level.
    //   2. The addImage compression alias changed from 'FAST' (Deflate level
    //      1 — the WORST compression) to 'SLOW' (Deflate level 9 — the BEST).
    //      This is a pure, lossless size reduction on every stream that
    //      jsPDF actually Deflates (notably the PNG/lossless path).
    const quality =
      options.compression === 'high'
        ? 0.7
        : options.compression === 'medium'
          ? 0.85
          : 1.0;

    const format = options.compression === 'none' ? 'PNG' : 'JPEG';
    if (format === 'JPEG') {
      // Pre-encode to JPEG on the canvas — jsPDF's internal JPEG re-encoder
      // produces inconsistent results, so we hand it a finished JPEG stream
      // (it passes DCTDecode streams through untouched).
      const imgData = canvas.toDataURL('image/jpeg', quality);
      doc.addImage(imgData, 'JPEG', 0, 0, pageWidthPt, pageHeightPt, undefined, 'SLOW');
    } else {
      // Lossless path: hand jsPDF the canvas directly so it runs its PNG
      // processor + Deflate level 9 ('SLOW') on the raw image data.
      doc.addImage(canvas, 'PNG', 0, 0, pageWidthPt, pageHeightPt, undefined, 'SLOW');
    }

    // ── Step 5: Trigger download ──
    const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'Template';
    doc.save(`${safeName}.pdf`);
  } finally {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}

// ── Preview Rendering Function ──────────────────────────────────────────────

/**
 * Render the canvas to an HTMLCanvasElement (bitmap) for preview.
 *
 * Uses OffscreenCanvas when available to avoid blocking the main thread.
 * Falls back to the same html2canvas pipeline for compatibility.
 */
export async function renderCanvasPreview(
  elements: CanvasElement[],
  canvasSettings: CanvasSettings,
  scale: number = 1,
): Promise<HTMLCanvasElement> {
  const { pageWidth, pageHeight, pageBackgroundColor } = canvasSettings;

  // Build off-screen DOM using DocumentFragment
  const container = document.createElement('div');
  container.style.cssText = [
    'position: absolute',
    'left: -99999px',
    'top: 0',
    `width: ${pageWidth}px`,
    `height: ${pageHeight}px`,
    `background-color: ${pageBackgroundColor || '#ffffff'}`,
    'overflow: hidden',
  ].join('; ');

  const fragment = document.createDocumentFragment();
  for (const element of elements) {
    if (!element.visible) continue;
    const dom = renderElement(element);
    fragment.appendChild(dom);
  }
  container.appendChild(fragment);

  document.body.appendChild(container);

  try {
    const htmlCanvas = await html2canvas(container, {
      scale,
      width: pageWidth,
      height: pageHeight,
      useCORS: true,
      allowTaint: true,
      backgroundColor: pageBackgroundColor || '#ffffff',
      scrollX: 0,
      scrollY: 0,
      windowWidth: pageWidth,
      windowHeight: pageHeight,
    });

    // If OffscreenCanvas is available, transfer to it for non-blocking usage
    // This allows the caller to use the bitmap without blocking the main thread
    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        const offscreen = new OffscreenCanvas(htmlCanvas.width, htmlCanvas.height);
        const ctx = offscreen.getContext('2d');
        if (ctx) {
          ctx.drawImage(htmlCanvas, 0, 0);
          // Create a new visible canvas from the offscreen result
          const resultCanvas = document.createElement('canvas');
          resultCanvas.width = htmlCanvas.width;
          resultCanvas.height = htmlCanvas.height;
          const resultCtx = resultCanvas.getContext('2d');
          if (resultCtx) {
            resultCtx.drawImage(offscreen, 0, 0);
            return resultCanvas;
          }
        }
      } catch {
        // OffscreenCanvas not supported or failed — fall through to return htmlCanvas
      }
    }

    return htmlCanvas;
  } finally {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}
