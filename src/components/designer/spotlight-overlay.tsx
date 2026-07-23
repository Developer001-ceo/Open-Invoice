'use client';

import { useDesignerStore, FloatingCardData } from '@/store/designer-store';
import { CanvasElement } from '@/lib/element-types';
import { useEffect, useState, useCallback, useRef, useMemo, useSyncExternalStore } from 'react';
import { PropertyContent } from './floating-card';
import {
  Type, Minus, Square, Circle, Move, Maximize2,
  AlignCenterVertical, AlignCenterHorizontal, Palette, Pen,
  BoxSelect, LayoutGrid, Rows3, Paintbrush, CornerDownRight, CircleDot,
  Sliders, Copy, Sparkles, ChevronUp, Trash2, Grid3x3,
  RotateCw,
  Image as ImageIcon,
} from 'lucide-react';

// ── Viewport dimensions (responsive to window resize) ───────────────────────
// Subscribes to the browser window so the spotlight card layout recomputes
// when the viewport changes size while the overlay is open. Uses
// useSyncExternalStore to read the current size synchronously during render
// (no flash on open) and re-render on resize, without calling setState inside
// an effect.
function useViewportDimensions(active: boolean): { width: number; height: number } {
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (!active) return () => {};
    window.addEventListener('resize', onStoreChange);
    return () => window.removeEventListener('resize', onStoreChange);
  }, [active]);

  const getSnapshot = useCallback(() => {
    if (!active) return '0x0';
    return `${window.innerWidth}x${window.innerHeight}`;
  }, [active]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => '0x0');
  const parts = snapshot.split('x');
  return { width: Number(parts[0]) || 0, height: Number(parts[1]) || 0 };
}

// ── Property Section Definition ─────────────────────────────────────────────

interface PropertySection {
  id: string;
  label: string;
  icon: React.ReactNode;
}

function getPropertySections(elementType: string): PropertySection[] {
  // Groups have no per-type properties — they only get the common sections
  // (Position, Size, Alignment) plus a group-level Opacity.
  if (elementType === 'group') {
    return [
      { id: 'position', label: 'Position', icon: <Move className="h-4 w-4" /> },
      { id: 'size', label: 'Size', icon: <Maximize2 className="h-4 w-4" /> },
      { id: 'alignment', label: 'Alignment', icon: <AlignCenterHorizontal className="h-4 w-4" /> },
      { id: 'opacity', label: 'Opacity', icon: <CircleDot className="h-4 w-4" /> },
    ];
  }

  const common: PropertySection[] = elementType !== 'line' ? [
    { id: 'position', label: 'Position', icon: <Move className="h-4 w-4" /> },
    { id: 'size', label: 'Size', icon: <Maximize2 className="h-4 w-4" /> },
    { id: 'alignment', label: 'Alignment', icon: <AlignCenterHorizontal className="h-4 w-4" /> },
  ] : [
    { id: 'alignment', label: 'Alignment', icon: <AlignCenterHorizontal className="h-4 w-4" /> },
  ];

  const typeSections: Record<string, PropertySection[]> = {
    text: [
      { id: 'text-content', label: 'Formatting', icon: <Type className="h-4 w-4" /> },
      { id: 'typography', label: 'Typography', icon: <Palette className="h-4 w-4" /> },
      { id: 'text-alignment', label: 'Alignment & Spacing', icon: <AlignCenterVertical className="h-4 w-4" /> },
      { id: 'color', label: 'Color', icon: <Palette className="h-4 w-4" /> },
    ],
    table: [
      { id: 'structure', label: 'Structure', icon: <LayoutGrid className="h-4 w-4" /> },
      { id: 'remove-row', label: 'Remove Row', icon: <Trash2 className="h-4 w-4" /> },
      { id: 'remove-column', label: 'Remove Column', icon: <Trash2 className="h-4 w-4" /> },
      { id: 'reorder', label: 'Reorder', icon: <Rows3 className="h-4 w-4" /> },
      { id: 'header', label: 'Header Row', icon: <Rows3 className="h-4 w-4" /> },
      { id: 'cell-defaults', label: 'Cell Defaults', icon: <Paintbrush className="h-4 w-4" /> },
      { id: 'table-border', label: 'Table Border', icon: <Minus className="h-4 w-4" /> },
      { id: 'corner-radius', label: 'Corner Radius', icon: <CornerDownRight className="h-4 w-4" /> },
      { id: 'cell-properties', label: 'Cell Properties', icon: <Grid3x3 className="h-4 w-4" /> },
      { id: 'table-appearance', label: 'Appearance', icon: <CircleDot className="h-4 w-4" /> },
    ],
    image: [
      { id: 'image-source', label: 'Image Source', icon: <ImageIcon className="h-4 w-4" /> },
      { id: 'image-fitting', label: 'Fitting', icon: <Maximize2 className="h-4 w-4" /> },
      { id: 'image-adjustments', label: 'Adjustments', icon: <Sliders className="h-4 w-4" /> },
      { id: 'image-border', label: 'Image Border', icon: <Minus className="h-4 w-4" /> },
      { id: 'image-appearance', label: 'Appearance', icon: <CircleDot className="h-4 w-4" /> },
    ],
    line: [
      { id: 'start-point', label: 'Start Point', icon: <ChevronUp className="h-4 w-4" /> },
      { id: 'end-point', label: 'End Point', icon: <ChevronUp className="h-4 w-4" /> },
      { id: 'endpoints', label: 'Endpoints', icon: <ChevronUp className="h-4 w-4" /> },
      { id: 'stroke', label: 'Stroke', icon: <Pen className="h-4 w-4" /> },
      { id: 'line-appearance', label: 'Appearance', icon: <CircleDot className="h-4 w-4" /> },
    ],
    rectangle: [
      { id: 'fill-gradient', label: 'Fill & Gradient', icon: <Square className="h-4 w-4" /> },
      { id: 'border', label: 'Border', icon: <Minus className="h-4 w-4" /> },
      { id: 'corner-radius', label: 'Corner Radius', icon: <CornerDownRight className="h-4 w-4" /> },
      { id: 'transform', label: 'Transform', icon: <RotateCw className="h-4 w-4" /> },
      { id: 'shadow', label: 'Shadow', icon: <BoxSelect className="h-4 w-4" /> },
      { id: 'reflection', label: 'Reflection', icon: <Copy className="h-4 w-4" /> },
      { id: 'glow', label: 'Glow', icon: <Sparkles className="h-4 w-4" /> },
      { id: 'opacity', label: 'Opacity', icon: <CircleDot className="h-4 w-4" /> },
      { id: 'rect-appearance', label: 'Appearance', icon: <CircleDot className="h-4 w-4" /> },
    ],
    ellipse: [
      { id: 'fill-gradient', label: 'Fill & Gradient', icon: <Circle className="h-4 w-4" /> },
      { id: 'border', label: 'Border', icon: <Minus className="h-4 w-4" /> },
      { id: 'shadow', label: 'Shadow', icon: <BoxSelect className="h-4 w-4" /> },
      { id: 'reflection', label: 'Reflection', icon: <Copy className="h-4 w-4" /> },
      { id: 'glow', label: 'Glow', icon: <Sparkles className="h-4 w-4" /> },
      { id: 'opacity', label: 'Opacity', icon: <CircleDot className="h-4 w-4" /> },
      { id: 'ellipse-appearance', label: 'Appearance', icon: <CircleDot className="h-4 w-4" /> },
    ],
  };

  return [...common, ...(typeSections[elementType] || [])];
}

// ── Map spotlight section ID to PropertyContent sectionLabel ──────────────

function sectionIdToLabel(sectionId: string): string {
  const map: Record<string, string> = {
    'position': 'Position',
    'size': 'Size',
    'alignment': 'Alignment',
    'multi-opacity': 'Multi-Selection Opacity',
    'text-content': 'Formatting',
    'typography': 'Typography',
    'text-alignment': 'Alignment & Spacing',
    'color': 'Color',
    'structure': 'Structure',
    'header': 'Header Row',
    'cell-styling': 'Cell Styling',
    'cell-defaults': 'Cell Defaults',
    'borders': 'Borders',
    'table-border': 'Table Border',
    'corner-radius': 'Corner Radius',
    'transform': 'Transform',
    'remove-row': 'Remove Row',
    'remove-column': 'Remove Column',
    'reorder': 'Reorder',

    'cell-properties': 'Cell Properties',
    'table-appearance': 'Appearance',
    'image-source': 'Image Source',
    'fit-mode': 'Fit Mode',
    'image-fitting': 'Fitting',
    'image-filters': 'Image Filters',
    'image-adjustments': 'Adjustments',
    'image-border': 'Image Border',
    'image-opacity': 'Opacity',
    'image-appearance': 'Appearance',
    'endpoints': 'Endpoints',
    'start-point': 'Start Point',
    'end-point': 'End Point',
    'stroke': 'Stroke',
    'line-appearance': 'Appearance',
    'rect-appearance': 'Appearance',
    'ellipse-appearance': 'Appearance',
    'fill-gradient': 'Gradient',
    'fill': 'Fill',
    'gradient': 'Gradient',
    'border': 'Border',
    'shadow': 'Shadow',
    'reflection': 'Reflection',
    'glow': 'Glow',
    'opacity': 'Opacity',
  };
  return map[sectionId] ?? sectionId;
}

// ── Dynamic card width based on section content ───────────────────────
function getSpotlightCardWidthClass(sectionLabel: string): string {
  const wideSections = new Set([
    'Fill & Gradient', 'Gradient',
    'Cell Properties',
    'Shadow',
    'Reflection',
  ]);
  const mediumSections = new Set([
    'Typography',
    'Borders', 'Table Border',
    'Corner Radius',
    'Header Row',
    'Cell Styling', 'Cell Defaults',
    'Image Filters', 'Adjustments',
    'Stroke',
    'Glow',
    'Reorder',
  ]);

  if (wideSections.has(sectionLabel)) return 'w-[320px]';
  if (mediumSections.has(sectionLabel)) return 'w-[280px]';
  return 'w-[260px]';
}

// ── Estimated card heights for layout calculation ────────────────────────
// Since cards show all properties without scrolling, we need realistic
// height estimates to position them correctly with masonry layout.

function estimateCardHeight(sectionId: string): number {
  const heights: Record<string, number> = {
    'position': 90,
    'size': 90,
    'alignment': 60,
    'text-content': 110,
    'typography': 180,
    'text-alignment': 140,
    'color': 100,
    'structure': 130,
    'header': 160,
    'cell-styling': 140,
    'cell-defaults': 140,
    'borders': 200,
    'table-border': 200,
    'corner-radius': 160,
    'remove-row': 80,
    'remove-column': 80,
    'reorder-row': 100,
    'reorder-column': 100,
    'cell-properties': 120,
    'table-appearance': 80,
    'image-source': 150,
    'fit-mode': 90,
    'image-fitting': 90,
    'image-filters': 120,
    'image-adjustments': 120,
    'image-border': 100,
    'image-opacity': 80,
    'image-appearance': 100,
    'endpoints': 130,
    'start-point': 80,
    'end-point': 80,
    'stroke': 100,
    'line-appearance': 80,
    'rect-appearance': 80,
    'ellipse-appearance': 80,
    'fill-gradient': 200,
    'border': 120,
    'shadow': 160,
    'reflection': 120,
    'glow': 120,
    'opacity': 80,
    'transform': 90,
  };
  // Title bar height (~32px) + content height + padding (p-3 = 12px top + 12px bottom = 24px)
  const contentHeight = heights[sectionId] ?? 150;
  return 32 + contentHeight + 24;
}

// ── Get actual pixel width for a section card ──────────────────────────────
// Maps section ID → label → pixel width, used for centering narrower cards
// within the 320px column slot.

function getCardActualWidthPx(sectionId: string): number {
  const label = sectionIdToLabel(sectionId);
  const wideSections = new Set([
    'Fill & Gradient', 'Gradient',
    'Cell Properties',
    'Shadow',
    'Reflection',
  ]);
  const mediumSections = new Set([
    'Typography',
    'Borders', 'Table Border',
    'Corner Radius',
    'Header Row',
    'Cell Styling', 'Cell Defaults',
    'Image Filters', 'Adjustments',
    'Stroke',
    'Glow',
    'Reorder',
  ]);
  if (wideSections.has(label)) return 320;
  if (mediumSections.has(label)) return 280;
  return 260;
}

// ── Masonry Card Layout Calculation ────────────────────────────────────────
// Places cards in a masonry-style layout with a fixed 20px gap between
// all cards (both horizontally and vertically). Cards in the same column
// are stacked vertically; each card goes into the shortest column.
// Each card is horizontally centered within its column slot so that
// narrower cards (260px, 280px) are visually centered rather than
// left-aligned within the 320px column width.
// Utilizes as much screen space as possible, ensures no card goes off-screen.

const COLUMN_WIDTH = 320; // Column slot width (widest card) for masonry layout
const CARD_GAP = 20; // Fixed 20px gap between all cards
const EDGE_MARGIN = 20; // minimum distance from viewport edges

interface CardPosition {
  x: number;
  y: number;
}

function getCardHeight(sectionId: string, measuredHeights?: Map<string, number>): number {
  if (measuredHeights && measuredHeights.has(sectionId)) {
    return measuredHeights.get(sectionId)!;
  }
  return estimateCardHeight(sectionId);
}

function calculateCardPositions(
  sectionIds: string[],
  containerWidth: number,
  containerHeight: number,
  measuredHeights?: Map<string, number>,
): { positions: CardPosition[]; scale: number } {
  const count = sectionIds.length;
  if (count === 0) return { positions: [], scale: 1 };

  const availableWidth = containerWidth - 2 * EDGE_MARGIN;
  const availableHeight = containerHeight - 2 * EDGE_MARGIN;

  // Determine maximum number of columns that fit
  const maxCols = Math.floor((availableWidth + CARD_GAP) / (COLUMN_WIDTH + CARD_GAP));

  // Try to find the optimal number of columns that fits all cards on screen
  // Start with fewer columns (for readability), increase if cards overflow vertically
  let bestLayout: { positions: CardPosition[]; totalHeight: number } | null = null;

  for (let tryCols = Math.max(1, Math.min(3, maxCols, count)); tryCols <= maxCols && tryCols <= count; tryCols++) {
    const totalGridWidth = tryCols * COLUMN_WIDTH + (tryCols - 1) * CARD_GAP;
    const startX = EDGE_MARGIN + (availableWidth - totalGridWidth) / 2;

    const columnY: number[] = Array(tryCols).fill(0);
    const positions: CardPosition[] = [];

    for (let i = 0; i < count; i++) {
      let shortestCol = 0;
      let shortestY = columnY[0];
      for (let c = 1; c < tryCols; c++) {
        if (columnY[c] < shortestY) {
          shortestY = columnY[c];
          shortestCol = c;
        }
      }

      // Center the card horizontally within its column slot
      const cardActualWidth = getCardActualWidthPx(sectionIds[i]);
      const centerOffset = (COLUMN_WIDTH - cardActualWidth) / 2;
      const x = startX + shortestCol * (COLUMN_WIDTH + CARD_GAP) + centerOffset;
      const y = columnY[shortestCol];

      positions.push({ x, y });

      const cardHeight = getCardHeight(sectionIds[i], measuredHeights);
      columnY[shortestCol] = y + cardHeight + CARD_GAP;
    }

    // Calculate the total height of the grid (tallest column)
    const totalHeight = Math.max(...columnY) - CARD_GAP; // subtract trailing gap

    // If this layout fits on screen, use it
    if (totalHeight <= availableHeight) {
      // Vertically center the grid within the available height
      const yOffset = EDGE_MARGIN + (availableHeight - totalHeight) / 2;
      const centeredPositions = positions.map(p => ({ x: p.x, y: p.y + yOffset }));
      bestLayout = { positions: centeredPositions, totalHeight };
      break; // Found a fitting layout with minimal columns
    }

    // Track the best layout even if it overflows (in case nothing fits)
    if (!bestLayout || totalHeight < bestLayout.totalHeight) {
      const yOffset = EDGE_MARGIN;
      const adjustedPositions = positions.map(p => ({ x: p.x, y: p.y + yOffset }));
      bestLayout = { positions: adjustedPositions, totalHeight };
    }
  }

  if (!bestLayout) {
    // Fallback: just use 1 column, cards centered within column slot
    const startX = EDGE_MARGIN;
    const columnY: number[] = [0];
    const positions: CardPosition[] = [];
    for (let i = 0; i < count; i++) {
      const cardActualWidth = getCardActualWidthPx(sectionIds[i]);
      const centerOffset = (COLUMN_WIDTH - cardActualWidth) / 2;
      positions.push({ x: startX + centerOffset, y: columnY[0] + EDGE_MARGIN });
      columnY[0] += getCardHeight(sectionIds[i], measuredHeights) + CARD_GAP;
    }
    bestLayout = { positions, totalHeight: columnY[0] };
  }

  // ── Responsive fit-to-viewport scaling ──────────────────────────────────
  // On smaller screens the natural masonry layout (fixed 320px columns + gaps)
  // can exceed the viewport, pushing cards off-screen. Rather than adding a
  // scrollbar, compute a uniform scale factor from the natural bounding box of
  // the layout vs. the available viewport space, then shrink every card (and
  // the spacing between them) by that factor so ALL cards stay fully visible
  // with no clipping. Cards only ever shrink (scale capped at 1) — large
  // screens keep the natural, readable card size.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < bestLayout.positions.length; i++) {
    const p = bestLayout.positions[i];
    const w = getCardActualWidthPx(sectionIds[i]);
    const h = getCardHeight(sectionIds[i], measuredHeights);
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + w > maxX) maxX = p.x + w;
    if (p.y + h > maxY) maxY = p.y + h;
  }
  const naturalWidth = Math.max(0, maxX - minX);
  const naturalHeight = Math.max(0, maxY - minY);
  const scaleX = naturalWidth > 0 ? availableWidth / naturalWidth : 1;
  const scaleY = naturalHeight > 0 ? availableHeight / naturalHeight : 1;
  // Guard against degenerate 0/negative scale on pathological viewports.
  const scale = Math.max(0.1, Math.min(1, scaleX, scaleY));

  const scaledPositions = bestLayout.positions.map(p => ({
    x: p.x * scale,
    y: p.y * scale,
  }));

  return { positions: scaledPositions, scale };
}

// ── Main Component ──────────────────────────────────────────────────────────

// Sections shown when MULTIPLE elements are selected. These are the properties
// that can meaningfully apply to ALL selected elements at once: alignment on
// the canvas and opacity. Per-type properties (fill, border, typography, etc.)
// are omitted because they only make sense for a single element type.
function getMultiSelectionSections(): PropertySection[] {
  return [
    { id: 'alignment', label: 'Alignment', icon: <AlignCenterHorizontal className="h-4 w-4" /> },
    { id: 'multi-opacity', label: 'Opacity', icon: <CircleDot className="h-4 w-4" /> },
  ];
}

export function SpotlightOverlay({ element, multiSelectIds }: { element: CanvasElement; multiSelectIds?: string[] }) {
  const spotlightOpen = useDesignerStore((s) => s.spotlightOpen);
  const closeSpotlight = useDesignerStore((s) => s.closeSpotlight);
  const addFloatingCard = useDesignerStore((s) => s.addFloatingCard);
  const floatingCards = useDesignerStore((s) => s.floatingCards);
  const propertyDisplayMode = useDesignerStore((s) => s.propertyDisplayMode);

  // Animation states
  const [isVisible, setIsVisible] = useState(false);
  const [cardsVisible, setCardsVisible] = useState(false);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [isDismissing, setIsDismissing] = useState(false);

  // Measured card heights — two-pass render to avoid overlap from inaccurate estimates
  const [measuredHeights, setMeasuredHeights] = useState<Map<string, number>>(new Map());

  // Timer refs for cleanup
  const cardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  const isMultiSelect = !!(multiSelectIds && multiSelectIds.length > 1);
  const sections = isMultiSelect ? getMultiSelectionSections() : getPropertySections(element.type);

  // ── Derived layout (computed, not state) ────────────────────────────────

  // Track viewport dimensions via useSyncExternalStore so the card layout
  // recomputes when the window is resized while the spotlight is open (keeps
  // the Shift+S cards responsive to screen-size changes instead of only
  // measuring once on open).
  const dimensions = useViewportDimensions(spotlightOpen);

  // Memoize card layout calculation — uses measured heights when available
  const sectionIds = useMemo(() => sections.map(s => s.id), [sections]);
  const cardLayout = useMemo(() => {
    if (!spotlightOpen || dimensions.width === 0) return { positions: [] as CardPosition[], scale: 1 };
    return calculateCardPositions(sectionIds, dimensions.width, dimensions.height, measuredHeights);
  }, [spotlightOpen, sectionIds, dimensions.width, dimensions.height, measuredHeights]);

  // ── Open / Close lifecycle ──────────────────────────────────────────────

  useEffect(() => {
    // Cancel any pending rAF from a previous run so we don't double-schedule.
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (spotlightOpen) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setIsDismissing(false);
        setSelectedCardId(null);
        setIsVisible(true);
        cardTimerRef.current = setTimeout(() => setCardsVisible(true), 150);
      });
    } else {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setIsVisible(false);
        setCardsVisible(false);
        setSelectedCardId(null);
        setIsDismissing(false);
        setMeasuredHeights(new Map());
      });
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (cardTimerRef.current) {
        clearTimeout(cardTimerRef.current);
        cardTimerRef.current = null;
      }
    };
  }, [spotlightOpen, element]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
      if (cardTimerRef.current) clearTimeout(cardTimerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ── Dismiss with exit animation ────────────────────────────────────────

  const dismissOverlay = useCallback(() => {
    if (isDismissing) return;
    setIsDismissing(true);
    setCardsVisible(false);

    dismissTimerRef.current = setTimeout(() => {
      closeSpotlight();
    }, 180);
  }, [isDismissing, closeSpotlight]);

  // ── Escape key ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!spotlightOpen || isDismissing) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        dismissOverlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [spotlightOpen, isDismissing, dismissOverlay]);

  // ── Card click handler ─────────────────────────────────────────────────

  const handleCardClick = useCallback((section: PropertySection) => {
    if (isDismissing || selectedCardId) return;

    const cardId = `${element.id}-${section.id}`;
    const alreadyFloating = floatingCards.some(c => c.id === cardId);

    // Don't allow clicking already-floating cards
    if (alreadyFloating) return;

    // Trigger selection animation
    setSelectedCardId(section.id);

    // After selection animation, create floating card and dismiss
    selectTimerRef.current = setTimeout(() => {
      const sectionIds = sections.map(s => s.id);
      const { positions: cardPositions } = calculateCardPositions(
        sectionIds,
        dimensions.width || 1200,
        dimensions.height || 800,
        measuredHeights,
      );
      const idx = sections.findIndex(s => s.id === section.id);
      const pos = cardPositions[idx] || { x: 100, y: 100 };

      // Calculate target position for the floating card
      const CARD_WIDTH = 320; // Use widest card width for consistent positioning
      const PANEL_WIDTH = 288; // w-72 = 288px (properties panel)
      const RIGHT_MARGIN = 90; // comfortable distance from right viewport edge
      const PANEL_GAP = 24; // gap between card and properties panel
      const TOP_OFFSET = 160; // comfortable distance from top (header + toolbar + breathing room)
      const CARD_STACK_GAP = 40; // vertical gap between stacked cards

      // In "both" or "panel" mode: card goes to the left of the properties panel
      // In "floating" mode: card goes to the right side with comfortable margin from edge
      const targetX = propertyDisplayMode !== 'floating'
        ? window.innerWidth - PANEL_WIDTH - CARD_WIDTH - PANEL_GAP
        : window.innerWidth - CARD_WIDTH - RIGHT_MARGIN;

      // Stack cards vertically if there are already floating cards
      const existingCards = floatingCards.length;
      const targetY = TOP_OFFSET + existingCards * CARD_STACK_GAP;

      const newCard: FloatingCardData = {
        id: cardId,
        sectionLabel: section.label,
        x: targetX,
        y: targetY,
        minimized: false,
        zIndex: Date.now(),
        initialX: pos.x, // Start from spotlight card position
        initialY: pos.y, // Start from spotlight card position
      };
      addFloatingCard(newCard);
      dismissOverlay();
    }, 280);
  }, [isDismissing, selectedCardId, element.id, floatingCards, sections, dimensions, measuredHeights, addFloatingCard, dismissOverlay, propertyDisplayMode]);

  // ── Early return if not open ───────────────────────────────────────────

  if (!spotlightOpen) return null;

  const { positions, scale } = cardLayout;

  // Effective opacity for the dim overlay — full dim, no cutout
  const dimOpacity = isVisible && !isDismissing ? 1 : 0;
  const dimTransition = isDismissing ? 'opacity 150ms ease-in' : 'opacity 200ms ease-out';

  return (
    <div
      className="fixed inset-0 z-[99999]"
      style={{ pointerEvents: isVisible ? 'auto' : 'none' }}
    >
      {/* ── Dim overlay — covers everything including the selected element ── */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        style={{
          opacity: dimOpacity,
          transition: dimTransition,
        }}
        onClick={dismissOverlay}
      />

      {/* ── Masonry property cards ───────────────────────────────────── */}
      {sections.map((section, index) => {
        const pos = positions[index];
        if (!pos) return null;

        const isHovered = hoveredCard === section.id;
        const isSelected = selectedCardId === section.id;
        const isUnselected = selectedCardId !== null && !isSelected;
        const alreadyFloating = floatingCards.some(
          c => c.id === `${element.id}-${section.id}`,
        );

        // Compute card opacity
        let cardOpacity: number;
        if (isUnselected) {
          cardOpacity = 0;
        } else if (isSelected) {
          cardOpacity = 1;
        } else if (cardsVisible && !isDismissing) {
          cardOpacity = 1;
        } else {
          cardOpacity = 0;
        }

        // Compute card transform — subtle hover effect, NO size change for already-floating
        let cardTransform: string;
        if (isSelected) {
          cardTransform = 'scale(1.02)';
        } else if (alreadyFloating) {
          cardTransform = 'scale(1)'; // Same size as normal cards
        } else if (cardsVisible && !isDismissing && !isUnselected) {
          cardTransform = isHovered ? 'translateY(-2px)' : 'translateY(0)';
        } else {
          cardTransform = 'scale(0.95)';
        }

        // Stagger delay (only for entrance, not for selection/dismiss)
        const staggerDelay = (selectedCardId || isDismissing) ? 0 : index * 40;

        // Transition timing
        const cardTransition = isSelected
          ? `all 200ms ease-in ${staggerDelay}ms`
          : isUnselected
          ? `all 180ms ease-in ${staggerDelay}ms`
          : `all 250ms cubic-bezier(0.34, 1.56, 0.64, 1) ${staggerDelay}ms`;

        // Section label for PropertyContent
        const sectionLabel = sectionIdToLabel(section.id);

        return (
          <div
            key={section.id}
            ref={(el) => {
              if (el) {
                const height = el.offsetHeight;
                if (height > 0 && measuredHeights.get(section.id) !== height) {
                  setMeasuredHeights(prev => {
                    const next = new Map(prev);
                    next.set(section.id, height);
                    return next;
                  });
                }
              }
            }}
            className="absolute"
            style={{
              left: pos.x,
              top: pos.y,
              opacity: cardOpacity,
              transform: cardTransform,
              transition: cardTransition,
              pointerEvents: isDismissing || isUnselected || alreadyFloating ? 'none' : 'auto',
            }}
            onMouseEnter={() => !isDismissing && !alreadyFloating && setHoveredCard(section.id)}
            onMouseLeave={() => setHoveredCard(null)}
            onClick={(e) => {
              e.stopPropagation();
              handleCardClick(section);
            }}
          >
            <div
              style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
            >
            <div
              className={`${getSpotlightCardWidthClass(sectionLabel)} rounded-lg border overflow-hidden transition-all duration-200 ${
                alreadyFloating
                  ? 'bg-card/60 border-border/30 cursor-default'
                  : isSelected
                  ? 'bg-card border-primary/50 shadow-xl ring-2 ring-primary/30 cursor-pointer'
                  : isHovered
                  ? 'bg-card border-primary/30 shadow-lg cursor-pointer'
                  : 'bg-card/95 border-border/50 shadow-md cursor-pointer'
              }`}
            >
              {/* Title bar */}
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border/40 ${
                  alreadyFloating
                    ? 'bg-muted/20'
                    : 'bg-muted/30'
                }`}
              >
                <div className={`p-1 rounded shrink-0 ${
                  alreadyFloating
                    ? 'bg-muted/50 text-muted-foreground/50'
                    : isSelected
                    ? 'bg-primary/15 text-primary'
                    : isHovered
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {section.icon}
                </div>
                <span className={`text-[11px] font-medium truncate flex-1 ${
                  alreadyFloating ? 'text-muted-foreground/50' : 'text-foreground'
                }`}>
                  {section.label}
                </span>
                {alreadyFloating && (
                  <span className="text-[9px] text-primary/60 font-medium bg-primary/10 px-1.5 py-0.5 rounded">open</span>
                )}
              </div>

              {/* Content — always show full content with clean padding */}
              <div className="relative pointer-events-none select-none p-3">
                <div style={{ opacity: alreadyFloating ? 0.3 : 0.5, filter: `grayscale(${alreadyFloating ? 80 : 50}%)` }}>
                  <PropertyContent sectionLabel={sectionLabel} element={element} compact multiSelectIds={isMultiSelect ? multiSelectIds : undefined} />
                </div>
                <div
                  className="absolute inset-0 pointer-events-none rounded-b-lg"
                  style={{ backgroundColor: alreadyFloating ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255, 255, 255, 0.35)' }}
                />
              </div>
            </div>
            </div>
          </div>
        );
      })}

      {/* ── Bottom hint ────────────────────────────────────────────────── */}
      <div
        className="absolute bottom-6 left-1/2 text-xs text-white/60"
        style={{
          opacity: cardsVisible && !isDismissing && !selectedCardId ? 1 : 0,
          transform: `translateX(-50%) translateY(${cardsVisible && !isDismissing && !selectedCardId ? 0 : 8}px)`,
          transition: 'opacity 250ms ease-out, transform 250ms ease-out',
        }}
      >
        Press{' '}
        <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/80 font-mono text-[10px]">
          Esc
        </kbd>{' '}
        to close · Click a card to pop it out
      </div>
    </div>
  );
}
