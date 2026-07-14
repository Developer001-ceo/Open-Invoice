'use client';

import { useState, useRef, useCallback, useEffect, memo } from 'react';
import { GradientFill, GradientStop, buildGradientCSS, GRADIENT_PRESETS } from '@/lib/element-types';
import { ColorInput } from '@/components/ui/color-input';

// ─── Types ────────────────────────────────────────────────────────────

interface GradientStopBarProps {
  gradient: GradientFill;
  onGradientChange: (updates: Partial<GradientFill>) => void;
  compact?: boolean; // smaller version for floating cards
}

// ─── Triangle Stop Marker ─────────────────────────────────────────────

function StopMarker({
  position,
  color,
  isSelected,
  isHovered,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
  onDoubleClick,
  onContextMenu,
}: {
  position: number; // 0-100
  color: string;
  isSelected: boolean;
  isHovered: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const size = 12;
  const highlight = isSelected || isHovered;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${position}%`,
        top: 0,
        transform: 'translateX(-50%)',
        cursor: 'grab',
        zIndex: isSelected ? 20 : 10,
        userSelect: 'none',
      }}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {/* Color preview circle at top */}
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          backgroundColor: color,
          border: highlight ? '2px solid var(--primary)' : '1.5px solid rgba(255,255,255,0.8)',
          boxShadow: isSelected
            ? '0 0 0 2px var(--primary), 0 1px 3px rgba(0,0,0,0.3)'
            : '0 1px 3px rgba(0,0,0,0.2)',
          margin: '0 auto',
          position: 'relative',
          zIndex: 2,
        }}
      />
      {/* Triangle pointer */}
      <div
        style={{
          width: 0,
          height: 0,
          borderLeft: `${size / 2}px solid transparent`,
          borderRight: `${size / 2}px solid transparent`,
          borderTop: `${size / 2}px solid ${color}`,
          margin: '-1px auto 0',
          filter: isSelected ? 'brightness(1.1)' : 'none',
        }}
      />
    </div>
  );
}

// ─── Context Menu ─────────────────────────────────────────────────────

function StopContextMenu({
  x,
  y,
  canDelete,
  onDelete,
  onDuplicate,
  onClose,
}: {
  x: number;
  y: number;
  canDelete: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 99999,
        backgroundColor: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        padding: '4px 0',
        minWidth: 140,
      }}
    >
      <button
        className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors flex items-center gap-2"
        onClick={() => { onDuplicate(); onClose(); }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        Duplicate Stop
      </button>
      <button
        className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${canDelete ? 'hover:bg-destructive/10 hover:text-destructive' : 'opacity-40 cursor-not-allowed'}`}
        onClick={() => { if (canDelete) { onDelete(); onClose(); } }}
        disabled={!canDelete}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        Delete Stop
        {!canDelete && <span className="ml-auto text-[9px] opacity-60">min 2</span>}
      </button>
    </div>
  );
}

// ─── Main GradientStopBar Component ───────────────────────────────────

export const GradientStopBar = memo(function GradientStopBar({
  gradient,
  onGradientChange,
  compact = false,
}: GradientStopBarProps) {
  const [selectedStopIndex, setSelectedStopIndex] = useState(0);
  const [hoveredStopIndex, setHoveredStopIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; stopIndex: number } | null>(null);
  const [colorPickerIndex, setColorPickerIndex] = useState<number | null>(null);

  const barRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{
    stopIndex: number;
    startX: number;
    startPosition: number;
  } | null>(null);
  // Track the active document-level drag listeners so they can be removed if
  // the component unmounts mid-drag (otherwise they leak on `document` and
  // reference stale closures).
  const dragListenersRef = useRef<{
    move: ((e: MouseEvent) => void) | null;
    up: ((e: MouseEvent) => void) | null;
  }>({ move: null, up: null });

  const stops = gradient.stops;

  // ── Helpers ────────────────────────────────────────────────────────

  const updateStops = useCallback((newStops: GradientStop[]) => {
    onGradientChange({ stops: newStops });
  }, [onGradientChange]);

  const updateStop = useCallback((index: number, updates: Partial<GradientStop>) => {
    const newStops = [...stops];
    newStops[index] = { ...newStops[index], ...updates };
    updateStops(newStops);
  }, [stops, updateStops]);

  // Find nearest stop color for a given position
  const getNearestStopColor = useCallback((pos: number): string => {
    const sorted = [...stops].sort((a, b) => a.position - b.position);
    let nearest = sorted[0];
    let minDist = Math.abs(sorted[0].position - pos);
    for (const s of sorted) {
      const d = Math.abs(s.position - pos);
      if (d < minDist) {
        minDist = d;
        nearest = s;
      }
    }
    return nearest.color;
  }, [stops]);

  // ── Bar click: add new stop ────────────────────────────────────────

  const handleBarClick = useCallback((e: React.MouseEvent) => {
    // Only handle clicks directly on the bar (not on existing stops)
    if ((e.target as HTMLElement).closest('[data-stop-marker]')) return;

    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const pos = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const clampedPos = Math.max(0, Math.min(100, pos));

    // Don't add if too close to an existing stop (within 3%)
    const tooClose = stops.some(s => Math.abs(s.position - clampedPos) < 3);
    if (tooClose) return;

    const newStop: GradientStop = {
      color: getNearestStopColor(clampedPos),
      position: clampedPos,
      opacity: 1,
    };

    const newStops = [...stops, newStop];
    // Sort by position for consistent indexing
    newStops.sort((a, b) => a.position - b.position);
    updateStops(newStops);

    // Select the new stop
    const newIndex = newStops.findIndex(s => s.position === clampedPos);
    setSelectedStopIndex(newIndex);
  }, [stops, updateStops, getNearestStopColor]);

  // ── Stop drag ──────────────────────────────────────────────────────

  const handleStopMouseDown = useCallback((e: React.MouseEvent, stopIndex: number) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedStopIndex(stopIndex);
    dragRef.current = {
      stopIndex,
      startX: e.clientX,
      startPosition: stops[stopIndex].position,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const bar = barRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      let newPos = Math.round(drag.startPosition + ((ev.clientX - drag.startX) / rect.width) * 100);
      newPos = Math.max(0, Math.min(100, newPos));

      // Snap to edges (0% and 100%)
      if (newPos < 3) newPos = 0;
      if (newPos > 97) newPos = 100;

      // Prevent overlapping: stops cannot pass through each other
      const sortedStops = [...stops].sort((a, b) => a.position - b.position);
      const currentSortedIndex = sortedStops.findIndex(s => s === stops[drag.stopIndex]);

      if (currentSortedIndex > 0) {
        const prevStop = sortedStops[currentSortedIndex - 1];
        if (newPos <= prevStop.position) {
          newPos = prevStop.position + 1;
        }
      }
      if (currentSortedIndex < sortedStops.length - 1) {
        const nextStop = sortedStops[currentSortedIndex + 1];
        if (newPos >= nextStop.position) {
          newPos = nextStop.position - 1;
        }
      }

      newPos = Math.max(0, Math.min(100, newPos));

      const newStops = [...stops];
      newStops[drag.stopIndex] = { ...newStops[drag.stopIndex], position: newPos };
      updateStops(newStops);
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      dragListenersRef.current = { move: null, up: null };
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    dragListenersRef.current = { move: handleMouseMove, up: handleMouseUp };
  }, [stops, updateStops]);

  // ── Stop double-click: open color picker ───────────────────────────

  const handleStopDoubleClick = useCallback((stopIndex: number) => {
    setColorPickerIndex(stopIndex);
  }, []);

  // Clean up any document-level drag listeners that are still attached if the
  // component unmounts mid-drag (prevents leaks + stale-closure calls).
  useEffect(() => {
    return () => {
      const h = dragListenersRef.current;
      if (h.move) document.removeEventListener('mousemove', h.move);
      if (h.up) document.removeEventListener('mouseup', h.up);
      dragListenersRef.current = { move: null, up: null };
    };
  }, []);

  // ── Context menu ───────────────────────────────────────────────────

  const handleContextMenu = useCallback((e: React.MouseEvent, stopIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, stopIndex });
  }, []);

  const handleDeleteStop = useCallback((stopIndex: number) => {
    if (stops.length <= 2) return;
    const newStops = stops.filter((_, i) => i !== stopIndex);
    updateStops(newStops);
    if (selectedStopIndex >= newStops.length) {
      setSelectedStopIndex(newStops.length - 1);
    } else if (selectedStopIndex === stopIndex) {
      setSelectedStopIndex(Math.max(0, stopIndex - 1));
    }
  }, [stops, updateStops, selectedStopIndex]);

  const handleDuplicateStop = useCallback((stopIndex: number) => {
    if (stops.length >= 8) return;
    const original = stops[stopIndex];
    const newPos = Math.min(100, original.position + 5);
    const newStop: GradientStop = {
      color: original.color,
      position: newPos,
      opacity: original.opacity,
    };
    const newStops = [...stops, newStop];
    newStops.sort((a, b) => a.position - b.position);
    updateStops(newStops);
    const newIndex = newStops.findIndex(s => s.position === newPos && s.color === original.color);
    setSelectedStopIndex(newIndex);
  }, [stops, updateStops]);

  // ── Build gradient preview CSS ─────────────────────────────────────

  const gradientCSS = buildGradientCSS(gradient, 300, 20);

  // ── Selected stop properties ───────────────────────────────────────

  const selectedStop = stops[selectedStopIndex] ?? stops[0];

  const inputCls = 'w-full h-6 text-xs px-2 border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring';
  const labelCls = 'text-[10px] text-muted-foreground uppercase tracking-wide';
  const selectCls = 'w-full h-6 text-xs px-2 border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring';

  // Whether the gradient bar/stop editor is active
  const isGradientActive = gradient.type === 'gradient';

  return (
    <div className="space-y-2">
      {/* Gradient bar with stops — only shown when gradient type is selected */}
      {isGradientActive && (
      <div className="relative" ref={barRef}>
        {/* The gradient preview bar */}
        <div
          className="w-full rounded-sm border border-border/50 cursor-crosshair"
          style={{
            height: compact ? 16 : 20,
            backgroundImage: gradientCSS || 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
          }}
          onClick={handleBarClick}
        />

        {/* Stop markers area - sits below the bar */}
        <div className="relative" style={{ height: 20, marginTop: -2 }}>
          {stops.map((stop, idx) => (
            <div key={idx} data-stop-marker>
              <StopMarker
                position={stop.position}
                color={stop.color}
                isSelected={idx === selectedStopIndex}
                isHovered={idx === hoveredStopIndex}
                onMouseDown={(e) => handleStopMouseDown(e, idx)}
                onMouseEnter={() => setHoveredStopIndex(idx)}
                onMouseLeave={() => setHoveredStopIndex(null)}
                onDoubleClick={() => handleStopDoubleClick(idx)}
                onContextMenu={(e) => handleContextMenu(e, idx)}
              />
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Selected stop properties — only when gradient is active */}
      {isGradientActive && selectedStop && (
        <div className={`space-y-1.5 ${compact ? 'p-2' : 'p-2.5'} bg-muted/30 rounded-md border border-border/40`}>
          <div className="flex items-center gap-2">
            {/* Color picker for selected stop */}
            <ColorInput
              compact
              noDrag
              value={selectedStop.color}
              onChange={(v) => updateStop(selectedStopIndex, { color: v })}
            />
            <div className="flex-1 space-y-1">
              {/* Color hex + Position row */}
              <div className="flex items-center gap-1.5">
                <input
                  data-no-drag
                  type="text"
                  value={selectedStop.color}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/^#[0-9a-fA-F]{0,6}$/.test(v)) {
                      updateStop(selectedStopIndex, { color: v });
                    }
                  }}
                  className={`${inputCls} flex-1 font-mono text-[10px]`}
                  placeholder="#RRGGBB"
                />
                <div className="flex items-center gap-0.5">
                  <input
                    data-no-drag
                    type="number"
                    value={selectedStop.position}
                    onChange={(e) => {
                      let pos = +e.target.value;
                      pos = Math.max(0, Math.min(100, pos));
                      updateStop(selectedStopIndex, { position: pos });
                    }}
                    min={0}
                    max={100}
                    className={`${inputCls} w-12 text-center`}
                  />
                  <span className="text-[9px] text-muted-foreground">%</span>
                </div>
              </div>
              {/* Opacity slider */}
              <div className="flex items-center gap-1.5">
                <span className={`${labelCls} text-[9px] w-12`}>Opacity</span>
                <input
                  data-no-drag
                  type="range"
                  value={Math.round(selectedStop.opacity * 100)}
                  onChange={(e) => updateStop(selectedStopIndex, { opacity: +e.target.value / 100 })}
                  min={0}
                  max={100}
                  className="fx-form-range flex-1"
                />
                <span className="text-[9px] text-muted-foreground w-7 text-right tabular-nums">
                  {Math.round(selectedStop.opacity * 100)}%
                </span>
              </div>
            </div>
          </div>
          {/* Stop count indicator */}
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-muted-foreground">
              Stop {selectedStopIndex + 1} of {stops.length}
            </span>
            <div className="flex gap-1">
              {stops.length < 8 && (
                <button
                  data-no-drag
                  className="text-[9px] px-1.5 py-0.5 rounded hover:bg-accent transition-colors border border-border/50"
                  onClick={() => {
                    // Add stop at midpoint of selected and next
                    const sorted = [...stops].sort((a, b) => a.position - b.position);
                    const currentSortedIdx = sorted.findIndex(s => s.position === selectedStop.position);
                    const nextPos = currentSortedIdx < sorted.length - 1
                      ? sorted[currentSortedIdx + 1].position
                      : 100;
                    const newPos = Math.round((selectedStop.position + nextPos) / 2);
                    const newStop: GradientStop = {
                      color: selectedStop.color,
                      position: newPos,
                      opacity: 1,
                    };
                    const newStops = [...stops, newStop];
                    newStops.sort((a, b) => a.position - b.position);
                    updateStops(newStops);
                    const newIdx = newStops.findIndex(s => s.position === newPos);
                    setSelectedStopIndex(newIdx);
                  }}
                >
                  + Add
                </button>
              )}
              {stops.length > 2 && (
                <button
                  data-no-drag
                  className="text-[9px] px-1.5 py-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors border border-border/50"
                  onClick={() => handleDeleteStop(selectedStopIndex)}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fill type selector */}
      <div>
        <label className={labelCls}>Type</label>
        <select
          data-no-drag
          value={gradient.type}
          onChange={(e) => {
            const newType = e.target.value as 'solid' | 'gradient' | 'picture' | 'transparent';
            const updates: Partial<GradientFill> = { type: newType };
            // Clear picture data when switching away from picture to avoid data bloat
            if (newType !== 'picture') updates.pictureSrc = '';
            onGradientChange(updates);
          }}
          className={selectCls}
        >
          <option value="solid">Solid</option>
          <option value="gradient">Gradient</option>
          <option value="picture">Picture</option>
          <option value="transparent">Transparent</option>
        </select>
      </div>

      {/* Gradient variant — only when gradient is active */}
      {isGradientActive && (
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className={labelCls}>Variant</label>
            <select
              data-no-drag
              value={gradient.gradientVariant}
              onChange={(e) => {
                const variant = e.target.value as 'linear' | 'radial';
                onGradientChange({
                  gradientVariant: variant,
                  direction: variant === 'radial' ? 'radial' : gradient.direction === 'radial' ? 'horizontal' : gradient.direction,
                });
              }}
              className={selectCls}
            >
              <option value="linear">Linear</option>
              <option value="radial">Radial</option>
            </select>
          </div>
          {gradient.gradientVariant === 'linear' && (
            <div>
              <label className={labelCls}>Direction</label>
              <select
                data-no-drag
                value={gradient.direction}
                onChange={(e) => onGradientChange({ direction: e.target.value as GradientFill['direction'] })}
                className={selectCls}
              >
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
                <option value="diagonal">Diagonal</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* Rotate with Shape — only when gradient is active */}
      {isGradientActive && (
        <div className="flex items-center justify-between">
          <span className={`${labelCls} flex items-center gap-1`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-6.219-8.56"/><path d="M21 3v9h-9"/></svg>
            Rotate with Shape
          </span>
          <input
            data-no-drag
            type="checkbox"
            checked={gradient.rotateWithShape ?? false}
            onChange={(e) => onGradientChange({ rotateWithShape: e.target.checked })}
            className="accent-primary"
          />
        </div>
      )}

      {/* Picture fill controls */}
      {gradient.type === 'picture' && (
        <div className="space-y-2">
          <div>
            <label className={labelCls}>Image</label>
            {gradient.pictureSrc ? (
              <div className="space-y-1.5">
                <div className="border border-border rounded-md overflow-hidden h-16 flex items-center justify-center bg-muted/30">
                  <img src={gradient.pictureSrc} alt="Preview" className="max-h-full max-w-full object-contain" />
                </div>
                <div className="flex gap-1.5">
                  <button
                    data-no-drag
                    className="flex-1 text-[10px] px-2 py-1 border border-border rounded hover:bg-muted transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Change
                  </button>
                  <button
                    data-no-drag
                    className="text-[10px] px-2 py-1 border border-border rounded hover:bg-destructive/10 text-destructive transition-colors"
                    onClick={() => onGradientChange({ pictureSrc: '' })}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                data-no-drag
                className="w-full text-[10px] px-2 py-2 border border-dashed border-border rounded hover:bg-muted transition-colors flex items-center justify-center gap-1"
                onClick={() => fileInputRef.current?.click()}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Upload Image
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    onGradientChange({ pictureSrc: ev.target?.result as string });
                  };
                  reader.readAsDataURL(file);
                }
              }}
            />
          </div>
          <div>
            <label className={labelCls}>Object Fit</label>
            <select
              data-no-drag
              value={gradient.pictureObjectFit ?? 'cover'}
              onChange={(e) => onGradientChange({ pictureObjectFit: e.target.value as 'contain' | 'cover' | 'fill' })}
              className={selectCls}
            >
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
              <option value="fill">Stretch</option>
            </select>
          </div>
        </div>
      )}

      {/* Preset Gradients — only when gradient is active */}
      {isGradientActive && (
        <div>
          <label className={labelCls}>Presets</label>
          <div className="grid grid-cols-5 gap-1 mt-0.5">
            {GRADIENT_PRESETS.map((preset) => (
              <button
                key={preset.name}
                data-no-drag
                className="h-5 rounded border border-border hover:ring-1 hover:ring-primary transition-all"
                style={{
                  backgroundImage: (() => {
                    const sortedStops = [...preset.stops].sort((a, b) => a.position - b.position);
                    const colorStops = sortedStops.map((s) => {
                      const r = parseInt(s.color.slice(1, 3), 16);
                      const g = parseInt(s.color.slice(3, 5), 16);
                      const b = parseInt(s.color.slice(5, 7), 16);
                      return `rgba(${r},${g},${b},${s.opacity}) ${s.position}%`;
                    }).join(', ');
                    return preset.gradientVariant === 'radial'
                      ? `radial-gradient(circle, ${colorStops})`
                      : `linear-gradient(90deg, ${colorStops})`;
                  })(),
                }}
                title={preset.name}
                onClick={() => onGradientChange({
                  stops: preset.stops.map(s => ({ ...s })),
                  direction: preset.direction,
                  gradientVariant: preset.gradientVariant,
                })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <StopContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canDelete={stops.length > 2}
          onDelete={() => handleDeleteStop(contextMenu.stopIndex)}
          onDuplicate={() => handleDuplicateStop(contextMenu.stopIndex)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
});
