'use client';

import { useRef, useCallback, useEffect, memo } from 'react';
import { Input } from '@/components/ui/input';

// ─── Optimized ColorInput ─────────────────────────────────────────────────────
// Key optimization: uses a DOM ref to update the swatch visually WITHOUT React
// state during drag. The store is ONLY updated when the color picker closes
// (onChange event), so the entire component tree doesn't re-render 60×/sec.
//
// During drag (onInput):  Updates swatch/text visuals via DOM only — zero React
//                         re-renders, perfectly smooth dragging.
// On close   (onChange):  Commits the final value to the parent store — one clean
//                         re-render, canvas updates immediately.
// ──────────────────────────────────────────────────────────────────────────────

interface ColorInputProps {
  value: string;
  onChange: (v: string) => void;
  /** Extra class names for the wrapper */
  className?: string;
  /** If true, add data-no-drag to prevent drag interference (for floating cards) */
  noDrag?: boolean;
  /** If true, render as compact (no hex text field, just the swatch) */
  compact?: boolean;
  /** ID for the input element */
  id?: string;
}

export const ColorInput = memo(function ColorInput({
  value,
  onChange,
  className,
  noDrag = false,
  compact = false,
  id,
}: ColorInputProps) {
  const swatchRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const draggingRef = useRef(false);

  // Keep onChange ref current (avoids stale closures)
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Sync visual elements when external value changes (e.g., undo/redo, programmatic change)
  // Skip during drag to avoid fighting with the native picker
  useEffect(() => {
    if (draggingRef.current) return;
    valueRef.current = value;
    if (swatchRef.current && swatchRef.current.value !== value) {
      swatchRef.current.value = value;
    }
    if (textRef.current && !textRef.current.matches(':focus') && textRef.current.value !== value) {
      textRef.current.value = value;
    }
  }, [value]);

  // Update visuals instantly via DOM (no React re-render during drag)
  const updateVisuals = useCallback((newVal: string) => {
    valueRef.current = newVal;
    // Swatch auto-updates via native input binding
    if (textRef.current && !textRef.current.matches(':focus')) {
      textRef.current.value = newVal;
    }
  }, []);

  // Called on every input event from the color picker (during drag)
  // ONLY updates visuals via DOM — does NOT commit to the store.
  // This prevents expensive re-renders while the user is dragging.
  const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    draggingRef.current = true;
    const v = e.target.value;
    updateVisuals(v);
  }, [updateVisuals]);

  // Called when the color picker is closed / pointer released
  // Commits the final value to the store — one clean re-render
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    draggingRef.current = false;
    const v = e.target.value;
    updateVisuals(v);
    onChangeRef.current(v);
  }, [updateVisuals]);

  // Text field: commit on blur or Enter (not on every keystroke)
  const handleTextBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      valueRef.current = v;
      if (swatchRef.current) swatchRef.current.value = v;
      onChangeRef.current(v);
    } else {
      // Reset to last valid value
      e.target.value = valueRef.current;
    }
  }, []);

  const handleTextKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  }, []);

  // Cleanup: commit any pending value on unmount
  useEffect(() => {
    return () => {
      if (draggingRef.current) {
        // Component unmounted while dragging — commit the current value
        onChangeRef.current(valueRef.current);
      }
    };
  }, []);

  const noDragProps = noDrag ? { 'data-no-drag': true } : {};

  if (compact) {
    return (
      <input
        ref={swatchRef}
        id={id}
        type="color"
        defaultValue={value}
        onInput={handleInput}
        onChange={handleChange}
        className={`w-7 h-7 rounded border border-border cursor-pointer p-0 shrink-0 ${className ?? ''}`}
        {...noDragProps}
      />
    );
  }

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ''}`} {...noDragProps}>
      <input
        ref={swatchRef}
        id={id}
        type="color"
        defaultValue={value}
        onInput={handleInput}
        onChange={handleChange}
        className="w-7 h-7 rounded border border-border cursor-pointer p-0 shrink-0"
      />
      <Input
        ref={textRef}
        defaultValue={value}
        onBlur={handleTextBlur}
        onKeyDown={handleTextKeyDown}
        className="h-7 text-xs font-mono"
      />
    </div>
  );
});
