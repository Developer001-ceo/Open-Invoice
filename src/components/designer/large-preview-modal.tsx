'use client';

import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo, memo } from 'react';
import { properCapitalizeHTML } from '@/lib/utils';
import { useDesignerStore, ZOOM_STEP_PRESETS } from '@/store/designer-store';
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
  buildPictureFillCSS,
  resolveCornerRadius,
  resolveRectBorderRadius,
  getRectRotation,
} from '@/lib/element-types';
import {
  hasCustomCorners,
  getRectCornerPoints,
  buildRoundedPolygonPath,
  buildSvgFillDescriptor,
  buildSvgFilterCSS,
  svgStrokeDasharray,
} from '@/lib/rectangle-corners';
import {
  getCellBg,
  getCellColor,
  getCellFontWeight,
  getCellFontSize,
  getCellPadding,
  getCellTextAlign,
  getCellVerticalAlign,
  getCellBorderTop,
  getCellBorderBottom,
  getCellBorderLeft,
  getCellBorderRight,
  normalizeTableProps,
  ensureColWidths,
  ensureRowHeights,
} from '@/lib/table-helpers';
import { X, ZoomIn, ZoomOut, Maximize, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { DarkPreviewToggle } from './dark-preview-toggle';

// Zoom constraints
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

// Zoom level presets (same as workspace)
const zoomPresets = [
  { label: '10%', value: 0.1 },
  { label: '25%', value: 0.25 },
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1 },
  { label: '150%', value: 1.5 },
  { label: '200%', value: 2 },
  { label: '300%', value: 3 },
  { label: '400%', value: 4 },
];

// ── Preview Element Renderers ──────────────────────────────────────────────
// These render elements identically to canvas-element.tsx but WITHOUT
// any interactive features (no editing, no selection, no drag handles).

// Module-level constant for reflection masks — avoids per-render allocation
const REFLECTION_MASKS: Record<string, string> = {
  soft: 'linear-gradient(to bottom, black 0%, transparent 80%)',
  tight: 'linear-gradient(to bottom, black 0%, transparent 50%)',
  fade: 'linear-gradient(to bottom, black 0%, transparent 100%)',
  mirror: 'linear-gradient(to bottom, black 0%, transparent 60%, transparent 100%)',
};

function getReflectionMask(preset: string): string {
  return REFLECTION_MASKS[preset] ?? 'linear-gradient(to bottom, black 0%, transparent 100%)';
}

function PreviewTextElement({ element }: { element: CanvasElement }) {
  const props = (element.properties as { type: 'text'; data: TextProperties }).data;

  const effectiveTextTransform = props.textTransform === 'capitalize' ? 'none' : props.textTransform;
  const displayContent = useMemo(() => {
    const raw = props.content || '<p></p>';
    if (props.textTransform === 'capitalize') {
      return properCapitalizeHTML(raw);
    }
    return raw;
  }, [props.content, props.textTransform]);

  return (
    <div
      className="rich-text-content"
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        fontSize: `${props.fontSize}px`,
        fontFamily: props.fontFamily,
        fontWeight: props.fontWeight,
        fontStyle: props.fontStyle,
        textDecoration: props.textDecoration,
        textTransform: effectiveTextTransform as 'none' | 'uppercase' | 'lowercase',
        color: props.color,
        textAlign: props.textAlign,
        ...(props.textAlign === 'justify' ? { textAlignLast: 'left' as const, textJustify: 'inter-character' as const, hyphens: 'auto' as const } : {}),
        lineHeight: props.lineHeight,
        letterSpacing: `${props.letterSpacing}px`,
        opacity: props.opacity,
        wordBreak: 'break-word',
        whiteSpace: 'pre-wrap',
      }}
      dangerouslySetInnerHTML={{ __html: displayContent }}
    />
  );
}

function PreviewTableElement({ element }: { element: CanvasElement }) {
  const rawProps = (element.properties as { type: 'table'; data: TableProperties }).data;
  const props = normalizeTableProps(rawProps);

  const bw = props.borderWidth;
  const borderStyleValue = props.borderStyle;
  const borderColorValue = props.borderColor;
  const borderStr = `${bw}px ${borderStyleValue} ${borderColorValue}`;

  const visibleRows = props.showHeader ? props.rows : Math.max(props.rows - 1, 1);
  const radii = resolveCornerRadius(props.cornerRadius);

  // Convert colWidths/rowHeights proportional fractions into EXPLICIT pixel
  // track sizes — matching the canvas rendering. We must NOT use CSS `fr`
  // units here: `fr` tracks are expanded by min-content/max-content of cell
  // content, so a wide cell would blow out the user's resized ratio and the
  // preview would show default/equal sizes instead of the adjusted ones.
  // Explicit px values (with the last track absorbing rounding) reproduce the
  // canvas layout exactly.
  const cw = ensureColWidths(props.cols, props.colWidths);
  const rh = ensureRowHeights(props.rows, props.rowHeights);
  const visibleRowHeights = props.showHeader ? rh : rh.slice(1);
  const totalColFr = cw.reduce((a, b) => a + b, 0) || 1;
  const visRh = visibleRowHeights.length > 0 ? visibleRowHeights : [1];
  const totalRowFr = visRh.reduce((a, b) => a + b, 0) || 1;
  const computeTrackSizes = (fracs: number[], total: number, totalFr: number): string[] => {
    if (fracs.length === 0) return ['100%'];
    const sizes = fracs.map((f) => (f / totalFr) * total);
    const allocated = sizes.slice(0, -1).reduce((a, b) => a + b, 0);
    sizes[sizes.length - 1] = total - allocated;
    return sizes.map((s) => `${s}px`);
  };
  const gridTemplateColumns = computeTrackSizes(cw, element.width, totalColFr).join(' ');
  const gridTemplateRows = computeTrackSizes(visRh, element.height, totalRowFr).join(' ');

  const cells: React.ReactNode[] = [];
  for (let r = 0; r < props.rows; r++) {
    if (r === 0 && !props.showHeader) continue;
    const gridRow = props.showHeader ? r + 1 : r;

    for (let c = 0; c < props.cols; c++) {
      const padding = getCellPadding(r, c, props);
      const bgColor = getCellBg(r, c, props);
      const textColor = getCellColor(r, c, props);
      const fontWeight = getCellFontWeight(r, c, props);
      const fontSize = getCellFontSize(r, c, props);
      const textAlign = getCellTextAlign(r, c, props);
      const verticalAlign = getCellVerticalAlign(r, c, props);

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

      const justifyContent = verticalAlign === 'top' ? 'flex-start' : verticalAlign === 'bottom' ? 'flex-end' : 'center';

      cells.push(
        <div
          key={`${r}-${c}`}
          style={{
            gridRow,
            gridColumn: c + 1,
            overflow: 'hidden',
            padding: `${padding}px`,
            backgroundColor: bgColor,
            color: textColor,
            fontWeight,
            fontSize: `${fontSize}px`,
            textAlign: textAlign as 'left' | 'center' | 'right' | 'justify',
            ...(textAlign === 'justify' ? { textAlignLast: 'left' as const, textJustify: 'inter-character' as const, hyphens: 'auto' as const } : {}),
            borderTop,
            borderBottom,
            borderLeft,
            borderRight,
            borderRadius: cellBorderRadius,
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: justifyContent,
            minHeight: 0,
            minWidth: 0,
          }}
        >
          <span
            style={{
              display: 'block',
              width: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.2,
            }}
          >
            {props.cellData[r]?.[c] || ''}
          </span>
        </div>
      );
    }
  }

  return (
    <div style={{
      width: '100%',
      height: '100%',
      opacity: props.opacity,
      borderRadius: `${radii.topLeft}px ${radii.topRight}px ${radii.bottomRight}px ${radii.bottomLeft}px`,
    }}>
      <div
        style={{
          display: 'grid',
          gridTemplateRows,
          gridTemplateColumns,
          width: '100%',
          height: '100%',
          fontSize: `${props.fontSize}px`,
          overflow: 'hidden',
        }}
      >
        {cells}
      </div>
    </div>
  );
}

function PreviewImageElement({ element }: { element: CanvasElement }) {
  const props = (element.properties as { type: 'image'; data: ImageProperties }).data;
  const effects: RectangleEffects = props.effects ?? { ...DEFAULT_EFFECTS };

  // Compute combined box shadow (glow + shadow)
  const combinedBoxShadow = (() => {
    const glowBoxShadow = buildGlowCSS(effects.glow).boxShadow as string | undefined;
    const shadowBoxShadow = buildShadowCSS(effects.shadow, props.borderRadius).boxShadow as string | undefined;
    if (glowBoxShadow && shadowBoxShadow) return `${glowBoxShadow}, ${shadowBoxShadow}`;
    if (glowBoxShadow) return glowBoxShadow;
    if (shadowBoxShadow) return shadowBoxShadow;
    return undefined;
  })();

  const reflectionMask = effects.reflection.enabled ? getReflectionMask(effects.reflection.preset) : undefined;

  if (!props.src) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f9fafb',
          border: '2px dashed #d1d5db',
          borderRadius: `${props.borderRadius}px`,
          opacity: props.opacity,
          boxShadow: combinedBoxShadow,
        }}
      >
        <span style={{ fontSize: '10px', color: '#9ca3af' }}>No image</span>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Main image with glow + shadow */}
      <div
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          borderRadius: `${props.borderRadius}px`,
          border: props.borderWidth > 0 ? `${props.borderWidth}px solid ${props.borderColor}` : 'none',
          opacity: props.opacity,
          boxShadow: combinedBoxShadow,
          position: 'relative',
          zIndex: 2,
        }}
      >
        <img
          src={props.src}
          alt=""
          style={{
            width: '100%',
            height: '100%',
            objectFit: props.objectFit,
            filter: `brightness(${props.brightness ?? 100}%) contrast(${props.contrast ?? 100}%) saturate(${props.saturation ?? 100}%) blur(${props.blur ?? 0}px)`,
          }}
          draggable={false}
        />
      </div>

      {/* Reflection below */}
      {effects.reflection.enabled && (
        <div
          style={{
            position: 'absolute',
            top: `calc(100% + ${effects.reflection.distance}px)`,
            left: 0,
            width: '100%',
            height: `${effects.reflection.size}%`,
            overflow: 'hidden',
            zIndex: 1,
            pointerEvents: 'none',
            maskImage: reflectionMask,
            WebkitMaskImage: reflectionMask,
            borderRadius: `${props.borderRadius}px`,
          }}
        >
          <div style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            borderRadius: `${props.borderRadius}px`,
            border: props.borderWidth > 0 ? `${props.borderWidth}px solid ${props.borderColor}` : 'none',
            transform: 'scaleY(-1)',
            opacity: effects.reflection.opacity,
          }}>
            <img
              src={props.src}
              alt=""
              style={{
                width: '100%',
                height: '100%',
                objectFit: props.objectFit,
                filter: `brightness(${props.brightness ?? 100}%) contrast(${props.contrast ?? 100}%) saturate(${props.saturation ?? 100}%) blur(${props.blur ?? 0}px)`,
              }}
              draggable={false}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewLineElement({ element }: { element: CanvasElement }) {
  const props = (element.properties as { type: 'line'; data: LineProperties }).data;

  const startX = element.lineStartX ?? element.x;
  const startY = element.lineStartY ?? (element.y + element.height / 2);
  const endX = element.lineEndX ?? (element.x + element.width);
  const endY = element.lineEndY ?? (element.y + element.height / 2);

  const relStartX = startX - element.x;
  const relStartY = startY - element.y;
  const relEndX = endX - element.x;
  const relEndY = endY - element.y;

  const dashArray = props.strokeStyle === 'dashed' ? '8,4' : props.strokeStyle === 'dotted' ? '2,4' : 'none';

  return (
    <svg style={{ width: '100%', height: '100%', opacity: props.opacity, overflow: 'visible' }}>
      <path
        d={`M ${relStartX} ${relStartY} L ${relEndX} ${relEndY}`}
        stroke={props.strokeColor}
        strokeWidth={props.strokeWidth}
        strokeDasharray={dashArray}
        strokeLinecap={props.lineCap}
        fill="none"
      />
    </svg>
  );
}

function PreviewRectangleElement({ element }: { element: CanvasElement }) {
  const props = (element.properties as { type: 'rectangle'; data: RectangleProperties }).data;
  const effects: RectangleEffects = props.effects ?? { ...DEFAULT_EFFECTS };

  // ── Custom-corner (deformed) rectangle: render as an SVG polygon ──────────
  if (hasCustomCorners(element)) {
    const corners = getRectCornerPoints(element);
    // Build a rounded path so corner radius still applies after deformation.
    // When all radii are 0 this is equivalent to the straight-edged polygon.
    const radii = resolveRectBorderRadius(props.borderRadius);
    const pathD = buildRoundedPolygonPath(corners, radii, { x: element.x, y: element.y });
    const svgIdPrefix = `prevrect-${element.id}`;
    const fillDesc = buildSvgFillDescriptor(effects.gradient, svgIdPrefix, props.fill);
    const filterCSS = buildSvgFilterCSS(effects);
    const dasharray = svgStrokeDasharray(props.borderStyle, props.borderWidth);
    const borderStyleValue =
      props.borderStyle === 'dotted' ? 'dotted' : props.borderStyle === 'dashed' ? 'dashed' : 'solid';
    const reflectionMask = effects.reflection.enabled ? getReflectionMask(effects.reflection.preset) : undefined;
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${element.width} ${element.height}`}
          overflow="visible"
          style={{ position: 'relative', zIndex: 2, display: 'block', filter: filterCSS || undefined, opacity: props.opacity }}
        >
          {fillDesc.defs ? <g dangerouslySetInnerHTML={{ __html: fillDesc.defs }} /> : null}
          <path
            d={pathD}
            fill={fillDesc.fill}
            stroke={props.borderColor}
            strokeWidth={props.borderWidth}
            strokeDasharray={dasharray}
            strokeLinejoin="round"
            strokeLinecap={borderStyleValue === 'dotted' ? 'round' : 'butt'}
          />
        </svg>
        {effects.reflection.enabled && (
          <div
            style={{
              position: 'absolute',
              top: `calc(100% + ${effects.reflection.distance}px)`,
              left: 0,
              width: '100%',
              height: `${effects.reflection.size}%`,
              overflow: 'hidden',
              zIndex: 1,
              pointerEvents: 'none',
              maskImage: reflectionMask,
              WebkitMaskImage: reflectionMask,
            }}
          >
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${element.width} ${element.height}`}
              overflow="visible"
              style={{ display: 'block', transform: 'scaleY(-1)', opacity: effects.reflection.opacity }}
            >
              {fillDesc.defs ? <g dangerouslySetInnerHTML={{ __html: fillDesc.defs }} /> : null}
              <path
                d={pathD}
                fill={fillDesc.fill}
                stroke={props.borderColor}
                strokeWidth={props.borderWidth}
                strokeDasharray={dasharray}
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}
      </div>
    );
  }

  // Build box-shadow combining glow + shadow
  const glowCSS = buildGlowCSS(effects.glow);
  const shadowCSS = buildShadowCSS(effects.shadow, typeof props.borderRadius === 'number' ? props.borderRadius : resolveRectBorderRadius(props.borderRadius).topLeft);
  let boxShadow = '';
  if (effects.glow.enabled && effects.shadow.enabled) {
    const glowShadow = glowCSS.boxShadow || '';
    const dropShadow = shadowCSS.boxShadow || '';
    boxShadow = `${dropShadow}, ${glowShadow}`;
  } else if (effects.glow.enabled) {
    boxShadow = (glowCSS.boxShadow as string) || '';
  } else if (effects.shadow.enabled) {
    boxShadow = (shadowCSS.boxShadow as string) || '';
  }

  // Build background using only longhand CSS properties to avoid
  // React warnings about mixing shorthand/longhand for same value.
  const bgStyle: React.CSSProperties = effects.gradient.type === 'transparent'
    ? {} // Transparent — no background
    : effects.gradient.type === 'gradient'
      ? { backgroundImage: buildGradientCSS(effects.gradient, element.width, element.height) }
      : effects.gradient.type === 'picture'
        ? { backgroundColor: props.fill, ...buildPictureFillCSS(effects.gradient) }
        : { backgroundColor: props.fill };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div style={{
        width: '100%',
        height: '100%',
        ...bgStyle,
        borderWidth: `${props.borderWidth}px`,
        borderColor: props.borderColor,
        borderStyle: props.borderStyle === 'dotted' ? 'dotted' : props.borderStyle === 'dashed' ? 'dashed' : 'solid',
        borderRadius: (() => { const r = resolveRectBorderRadius(props.borderRadius); return `${r.topLeft}px ${r.topRight}px ${r.bottomRight}px ${r.bottomLeft}px`; })(),
        opacity: props.opacity,
        boxSizing: 'border-box',
        ...(boxShadow ? { boxShadow } : {}),
        position: 'relative',
        zIndex: 2,
      }} />
      {effects.reflection.enabled && (() => {
        const maskGradient = REFLECTION_MASKS[effects.reflection.preset] || REFLECTION_MASKS.fade;
        const radii = resolveRectBorderRadius(props.borderRadius);
        const borderRadiusStr = `${radii.topLeft}px ${radii.topRight}px ${radii.bottomRight}px ${radii.bottomLeft}px`;
        return (
          <div style={{
            position: 'absolute',
            top: `calc(100% + ${effects.reflection.distance}px)`,
            left: 0,
            width: '100%',
            height: `${effects.reflection.size}%`,
            overflow: 'hidden',
            zIndex: 1,
            pointerEvents: 'none',
            WebkitMaskImage: maskGradient,
            maskImage: maskGradient,
          }}>
            <div style={{
              width: '100%',
              height: '100%',
              transform: 'scaleY(-1)',
              opacity: effects.reflection.opacity,
              ...bgStyle,
              borderWidth: `${props.borderWidth}px`,
              borderColor: props.borderColor,
              borderStyle: props.borderStyle === 'dotted' ? 'dotted' : props.borderStyle === 'dashed' ? 'dashed' : 'solid',
              borderRadius: borderRadiusStr,
              boxSizing: 'border-box',
            }} />
          </div>
        );
      })()}
    </div>
  );
}

function PreviewEllipseElement({ element }: { element: CanvasElement }) {
  const props = (element.properties as { type: 'ellipse'; data: EllipseProperties }).data;
  const effects: RectangleEffects = props.effects ?? { ...DEFAULT_EFFECTS };

  // Build box-shadow combining glow + shadow
  const glowCSS = buildGlowCSS(effects.glow);
  const shadowCSS = buildShadowCSS(effects.shadow, 50);
  let boxShadow = '';
  if (effects.glow.enabled && effects.shadow.enabled) {
    const glowShadow = glowCSS.boxShadow || '';
    const dropShadow = shadowCSS.boxShadow || '';
    boxShadow = `${dropShadow}, ${glowShadow}`;
  } else if (effects.glow.enabled) {
    boxShadow = (glowCSS.boxShadow as string) || '';
  } else if (effects.shadow.enabled) {
    boxShadow = (shadowCSS.boxShadow as string) || '';
  }

  // Build background using only longhand CSS properties to avoid
  // React warnings about mixing shorthand/longhand for same value.
  const bgStyle: React.CSSProperties = effects.gradient.type === 'transparent'
    ? {} // Transparent — no background
    : effects.gradient.type === 'gradient'
      ? { backgroundImage: buildGradientCSS(effects.gradient, element.width, element.height) }
      : effects.gradient.type === 'picture'
        ? { backgroundColor: props.fill, ...buildPictureFillCSS(effects.gradient) }
        : { backgroundColor: props.fill };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div style={{
        width: '100%',
        height: '100%',
        ...bgStyle,
        borderWidth: `${props.borderWidth}px`,
        borderColor: props.borderColor,
        borderStyle: props.borderStyle === 'dotted' ? 'dotted' : props.borderStyle === 'dashed' ? 'dashed' : 'solid',
        borderRadius: '50%',
        opacity: props.opacity,
        boxSizing: 'border-box',
        ...(boxShadow ? { boxShadow } : {}),
        position: 'relative',
        zIndex: 2,
      }} />
      {effects.reflection.enabled && (() => {
        const maskGradient = REFLECTION_MASKS[effects.reflection.preset] || REFLECTION_MASKS.fade;
        return (
          <div style={{
            position: 'absolute',
            top: `calc(100% + ${effects.reflection.distance}px)`,
            left: 0,
            width: '100%',
            height: `${effects.reflection.size}%`,
            overflow: 'hidden',
            zIndex: 1,
            pointerEvents: 'none',
            WebkitMaskImage: maskGradient,
            maskImage: maskGradient,
          }}>
            <div style={{
              width: '100%',
              height: '100%',
              transform: 'scaleY(-1)',
              opacity: effects.reflection.opacity,
              ...bgStyle,
              borderWidth: `${props.borderWidth}px`,
              borderColor: props.borderColor,
              borderStyle: props.borderStyle === 'dotted' ? 'dotted' : props.borderStyle === 'dashed' ? 'dashed' : 'solid',
              borderRadius: '50%',
              boxSizing: 'border-box',
            }} />
          </div>
        );
      })()}
    </div>
  );
}

// Renders the visual content of a child element inside a group (non-interactive)
function PreviewGroupChildContent({ element }: { element: CanvasElement }) {
  if (!element.visible) return null;
  switch (element.type) {
    case 'text': return <PreviewTextElement element={element} />;
    case 'table': return <PreviewTableElement element={element} />;
    case 'image': return <PreviewImageElement element={element} />;
    case 'line': return <PreviewLineElement element={element} />;
    case 'rectangle': return <PreviewRectangleElement element={element} />;
    case 'ellipse': return <PreviewEllipseElement element={element} />;
    case 'group': return <PreviewGroupElement element={element} />;
    default: return null;
  }
}

// Renders a group element by rendering its children at their relative positions
function PreviewGroupElement({ element }: { element: CanvasElement }) {
  if (!element.children || element.children.length === 0) return null;
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {element.children.map((child) => {
        if (!child.visible) return null;
        return (
          <div
            key={child.id}
            style={{
              position: 'absolute',
              left: child.x,
              top: child.y,
              width: child.width,
              height: child.height,
            }}
          >
            <PreviewGroupChildContent element={child} />
          </div>
        );
      })}
    </div>
  );
}

const PreviewElement = memo(function PreviewElement({ element }: { element: CanvasElement }) {
  if (!element.visible) return null;

  // For rectangles with rotation, wrap the shape content in a rotating div
  // (same "rotate content only" strategy as the canvas + PDF renderers — the
  // outer positioning wrapper stays axis-aligned so the absolute left/top/
  // width/height = bbox is correct; only the inner shape spins).
  const rectRotation = element.type === 'rectangle' ? getRectRotation(element) : 0;
  const rotationWrapperStyle = rectRotation
    ? { transform: `rotate(${rectRotation}deg)`, transformOrigin: 'center' as const, width: '100%' as const, height: '100%' as const }
    : { width: '100%' as const, height: '100%' as const };

  return (
    <div
      style={{
        position: 'absolute',
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
      }}
    >
      <div style={rotationWrapperStyle}>
        {element.type === 'text' && <PreviewTextElement element={element} />}
        {element.type === 'table' && <PreviewTableElement element={element} />}
        {element.type === 'image' && <PreviewImageElement element={element} />}
        {element.type === 'line' && <PreviewLineElement element={element} />}
        {element.type === 'rectangle' && <PreviewRectangleElement element={element} />}
        {element.type === 'ellipse' && <PreviewEllipseElement element={element} />}
        {element.type === 'group' && <PreviewGroupElement element={element} />}
      </div>
    </div>
  );
});

// ── Main Modal Component ──────────────────────────────────────────────────

export function LargePreviewModal() {
  const largePreviewOpen = useDesignerStore((s) => s.largePreviewOpen);
  const setLargePreviewOpen = useDesignerStore((s) => s.setLargePreviewOpen);
  const [zoom, setZoom] = useState(1);
  const [zoomStep, setZoomStep] = useState(15);
  const [customStep, setCustomStep] = useState('');
  const [showCustomStep, setShowCustomStep] = useState(false);
  // Dark preview background — toggles the preview workspace area to a dark
  // grey so the user can preview how the invoice looks on a dark backdrop.
  // Only affects the area around the page, not the page itself.
  const [darkPreview, setDarkPreview] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  // Ref to queue a scroll-adjustment that must happen after the next render
  const pendingScrollAdjust = useRef<{ contentX: number; contentY: number } | null>(null);

  const pageWidth = useDesignerStore((s) => s.canvasSettings.pageWidth);
  const pageHeight = useDesignerStore((s) => s.canvasSettings.pageHeight);
  const pageBackgroundColor = useDesignerStore((s) => s.canvasSettings.pageBackgroundColor);
  const elements = useDesignerStore((s) => s.elements);

  // Apply pending scroll adjustments synchronously before the browser paints
  // so the user never sees a frame with wrong scroll position
  useLayoutEffect(() => {
    const adj = pendingScrollAdjust.current;
    if (adj === null) return;
    pendingScrollAdjust.current = null;

    const container = containerRef.current;
    if (!container) return;

    const centerX = container.clientWidth / 2;
    const centerY = container.clientHeight / 2;
    container.scrollLeft = adj.contentX * zoom - centerX;
    container.scrollTop = adj.contentY * zoom - centerY;
  }, [zoom]);

  // Close on Escape
  useEffect(() => {
    if (!largePreviewOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLargePreviewOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [largePreviewOpen, setLargePreviewOpen]);

  // Mouse wheel zoom — RAF-throttled to coalesce rapid scroll events
  const wheelAccumRef = useRef({ delta: 0, contentX: 0, contentY: 0 });
  const wheelRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!largePreviewOpen) return;
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      const currentZoom = zoomRef.current;
      const step = (e.ctrlKey || e.metaKey ? 5 : zoomStep) / 100;
      const delta = e.deltaY > 0 ? -step : step;

      // Compute content point at viewport center BEFORE zoom changes
      const centerX = container.clientWidth / 2;
      const centerY = container.clientHeight / 2;
      const contentX = (container.scrollLeft + centerX) / currentZoom;
      const contentY = (container.scrollTop + centerY) / currentZoom;

      // Accumulate and coalesce via RAF
      wheelAccumRef.current.delta += delta;
      wheelAccumRef.current.contentX = contentX;
      wheelAccumRef.current.contentY = contentY;

      if (wheelRafRef.current === null) {
        wheelRafRef.current = requestAnimationFrame(() => {
          const accum = wheelAccumRef.current;
          const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentZoom + accum.delta));
          accum.delta = 0;

          if (newZoom !== currentZoom) {
            pendingScrollAdjust.current = { contentX: accum.contentX, contentY: accum.contentY };
            zoomRef.current = newZoom;
            setZoom(newZoom);
          }

          wheelRafRef.current = null;
        });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (wheelRafRef.current !== null) {
        cancelAnimationFrame(wheelRafRef.current);
        wheelRafRef.current = null;
      }
    };
  }, [largePreviewOpen, zoomStep]);

  // Helper: update zoom and re-center on the viewport center
  const applyZoomCentered = useCallback((newZoom: number) => {
    const container = containerRef.current;
    if (!container) return;

    const currentZoom = zoomRef.current;
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));

    // Compute content point at viewport center BEFORE updating zoom
    const centerX = container.scrollLeft + container.clientWidth / 2;
    const centerY = container.scrollTop + container.clientHeight / 2;
    const contentX = centerX / currentZoom;
    const contentY = centerY / currentZoom;

    // Queue scroll adjustment for useLayoutEffect (runs before paint)
    pendingScrollAdjust.current = { contentX, contentY };
    zoomRef.current = clamped;
    setZoom(clamped);
  }, []);

  // Fit to view
  const handleFitToView = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerW = container.clientWidth - 48;
    const containerH = container.clientHeight - 48;
    const fitZoom = Math.min(containerW / pageWidth, containerH / pageHeight, 1);

    // Center the page in the viewport via pendingScrollAdjust
    pendingScrollAdjust.current = { contentX: pageWidth / 2, contentY: pageHeight / 2 };
    zoomRef.current = fitZoom;
    setZoom(fitZoom);
  }, [pageWidth, pageHeight]);

  // Fit to view when modal opens
  useEffect(() => {
    if (!largePreviewOpen) return;
    // Wait for the container to mount and layout before calculating fit zoom
    const raf = requestAnimationFrame(() => {
      handleFitToView();
    });
    return () => cancelAnimationFrame(raf);
  }, [largePreviewOpen, handleFitToView]);

  // Zoom step handlers
  const handleStepSelect = (value: number) => {
    setZoomStep(value);
    setShowCustomStep(false);
    setCustomStep('');
  };

  const handleCustomStepSubmit = () => {
    const val = parseInt(customStep, 10);
    if (!isNaN(val) && val >= 1 && val <= 100) {
      setZoomStep(val);
      setShowCustomStep(false);
      setCustomStep('');
    }
  };

  const zoomPercent = Math.round(zoom * 100);
  const step = zoomStep / 100;

  // Memoize visible elements to avoid unnecessary re-renders
  const visibleElements = useMemo(() => elements.filter((el) => el.visible), [elements]);

  if (!largePreviewOpen) return null;

  const scaledWidth = pageWidth * zoom;
  const scaledHeight = pageHeight * zoom;

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center"
      onClick={() => setLargePreviewOpen(false)}
    >
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal content */}
      <div
        className="relative z-10 bg-card rounded-lg shadow-2xl border border-border overflow-hidden flex flex-col"
        style={{ width: '90vw', height: '90vh', maxWidth: '1400px', maxHeight: '95vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-foreground">PDF Preview</h2>
            <span className="text-xs text-muted-foreground">
              {pageWidth} × {pageHeight}px
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* Zoom controls */}
            <div className="flex items-center gap-1 bg-card border border-border rounded-lg px-1 py-0.5 shadow-sm">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => applyZoomCentered(zoom - step)}
                title="Zoom out"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-mono gap-0.5" title="Zoom level">
                    {zoomPercent}%
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="z-[100000] min-w-[120px]">
                  {zoomPresets.map((preset) => (
                    <DropdownMenuItem
                      key={preset.label}
                      onClick={() => applyZoomCentered(preset.value)}
                      className={zoomPercent === Math.round(preset.value * 100) ? 'bg-accent' : ''}
                    >
                      {preset.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => applyZoomCentered(zoom + step)}
                title="Zoom in"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
              <div className="w-px h-4 bg-border mx-0.5" />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleFitToView}
                title="Fit to view"
              >
                <Maximize className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Zoom step selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs font-mono gap-0.5" title="Zoom step size">
                  Step: {zoomStep}%
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="z-[100000] min-w-[140px]">
                {ZOOM_STEP_PRESETS.map((preset) => (
                  <DropdownMenuItem
                    key={preset.label}
                    onClick={() => handleStepSelect(preset.value)}
                    className={zoomStep === preset.value ? 'bg-accent' : ''}
                  >
                    {preset.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setShowCustomStep(true)}
                  className={
                    ![1, 5, 10, 20, 50].includes(zoomStep) ? 'bg-accent' : ''
                  }
                >
                  Custom ({zoomStep}%)
                </DropdownMenuItem>
                {showCustomStep && (
                  <div className="px-2 py-1.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={customStep}
                      onChange={(e) => setCustomStep(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCustomStepSubmit()}
                      placeholder="1-100"
                      className="h-7 w-16 text-xs"
                      autoFocus
                    />
                    <Button size="sm" className="h-7 text-xs px-2" onClick={handleCustomStepSubmit}>
                      Set
                    </Button>
                  </div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="w-px h-4 bg-border mx-1" />
            <DarkPreviewToggle checked={darkPreview} onCheckedChange={setDarkPreview} />
            <div className="w-px h-4 bg-border mx-1" />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setLargePreviewOpen(false)}
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Preview area — scrollable, wheel zoom enabled, centered */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto bg-muted/30"
          style={{
            cursor: 'default',
            // Dark preview background — dark grey workspace (not the page).
            // Only the area behind/around the page turns dark.
            backgroundColor: darkPreview ? '#313136' : undefined,
            transition: 'background-color .4s ease',
          }}
        >
          <div
            className="flex items-center justify-center min-h-full"
            style={{ padding: '24px' }}
          >
            <div
              className="shadow-lg border border-gray-200 rounded-sm shrink-0 relative overflow-hidden"
              style={{
                width: scaledWidth,
                height: scaledHeight,
                backgroundColor: pageBackgroundColor || '#ffffff',
              }}
            >
              {/* Live DOM preview zoomed via the CSS `zoom` property (the SAME
                  method the canvas now uses). `zoom` makes the browser lay out
                  + re-rasterize every descendant (text, SVG, borders) at the
                  TARGET (zoomed) resolution, so rendering stays pixel-perfect
                  at every zoom level — no compositing-layer downscale blur like
                  `transform: scale()` causes when zooming out. The parent is
                  already sized to `scaledWidth × scaledHeight` so the zoomed
                  page fills it exactly. */}
              <div
                style={{
                  width: pageWidth,
                  height: pageHeight,
                  position: 'relative',
                  overflow: 'hidden',
                  zoom: zoom,
                  // Crisp text & vector rendering at any zoom
                  textRendering: 'geometricPrecision',
                  WebkitFontSmoothing: 'antialiased',
                }}
              >
                {visibleElements.map((element) => (
                  <PreviewElement key={element.id} element={element} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
