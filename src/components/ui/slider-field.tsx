"use client"
import * as React from "react"
import { cn } from "@/lib/utils"
import { useDesignerStore } from "@/store/designer-store"

/**
 * SliderField — an MS Word / PowerPoint style draggable slider with numeric input.
 *
 * Features:
 *  - Horizontal progress bar with filled portion and circular draggable handle
 *  - Unique color theme per property (blue, orange, purple, green, teal, gray, etc.)
 *  - Numeric value displayed with unit suffix
 *  - Drag handle with pointer capture using requestAnimationFrame
 *  - Click anywhere on bar to jump handle
 *  - Keyboard: Arrow Left/Right ±1, Shift+Arrow ±10
 *  - Manual numeric input with clamping
 *  - Optimistic local state during drag for zero-lag visual feedback
 *  - Smooth, no-jitter dragging
 */

// ─── Color Themes ────────────────────────────────────────────────────────
// NOTE: The slider visual is now unified (gradient track + pink-glow thumb).
// The SliderColorTheme type is retained for API compatibility — callers still
// pass colorTheme, but it no longer affects the slider's appearance.

export type SliderColorTheme =
  | "blue"    // Corner Radius
  | "orange"  // Border Width
  | "purple"  // Font Size
  | "green"   // Line Height
  | "teal"    // Letter Spacing
  | "gray"    // Opacity
  | "red"     // Stroke Width
  | "amber"   // Shadow / Glow / Reflection
  | "cyan"    // Image adjustments

// ─── Props ───────────────────────────────────────────────────────────────

interface SliderFieldProps {
  /** Current value (single-element array for API compatibility with NumericField) */
  value?: number[]
  /** Called when the value changes (single-element array) */
  onValueChange?: (vals: number[]) => void
  /** Minimum value (default 0) */
  min?: number
  /** Maximum value (default 100) */
  max?: number
  /** Step increment (default 1) */
  step?: number
  /** Display unit suffix (e.g. "px", "%") */
  unit?: string
  /** Color theme for the slider */
  colorTheme?: SliderColorTheme
  /** Additional CSS class */
  className?: string
  /** Whether the field is disabled */
  disabled?: boolean
  /**
   * Called when a drag operation starts.
   * Use this to record the initial value for undo/redo.
   */
  onDragStart?: () => void
  /**
   * Called when a drag operation ends.
   * Use this to commit the final value for undo/redo.
   */
  onDragEnd?: () => void
  /** Compact mode for floating cards (smaller height, tighter spacing) */
  compact?: boolean
}

// ─── Component ───────────────────────────────────────────────────────────

function SliderField({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  unit,
  colorTheme = "gray",
  className,
  disabled = false,
  onDragStart,
  onDragEnd,
  compact = false,
}: SliderFieldProps) {
  const resolvedValue = value?.[0] ?? min
  // NOTE: colorTheme is accepted for API compatibility but the slider now
  // uses a unified gradient track + pink-glow thumb across all properties.
  void colorTheme
  const trackRef = React.useRef<HTMLDivElement>(null)
  const isDragging = React.useRef(false)
  const dragStarted = React.useRef(false) // tracks if onDragStart was fired
  const rafId = React.useRef<number>(0)

  // ── Local drag state for instant visual feedback ──
  // During drag, we track the value locally so the handle/fill update
  // immediately without waiting for the store → parent → prop round-trip.
  const [localDragValue, setLocalDragValue] = React.useState<number | null>(null)
  const activeValue = localDragValue !== null ? localDragValue : resolvedValue

  // Use a ref for the onValueChange callback so drag handlers don't recreate
  const onValueChangeRef = React.useRef(onValueChange)
  React.useEffect(() => { onValueChangeRef.current = onValueChange }, [onValueChange])

  // Use a ref for resolvedValue so updateValue doesn't depend on it
  const resolvedValueRef = React.useRef(resolvedValue)
  React.useEffect(() => { resolvedValueRef.current = resolvedValue }, [resolvedValue])

  // Numeric input state
  const [inputValue, setInputValue] = React.useState<string>(
    formatValue(resolvedValue, step)
  )

  // Sync external value changes into input (when not dragging)
  React.useEffect(() => {
    if (!isDragging.current) {
      setInputValue(formatValue(resolvedValue, step))
    }
  }, [resolvedValue, step])

  // Compute the fill percentage from the active value (local during drag, external otherwise)
  const range = max - min
  const fillPercent = range > 0 ? ((activeValue - min) / range) * 100 : 0

  // ── Value helpers ──

  const clampToStep = React.useCallback(
    (raw: number): number => {
      let clamped = raw
      if (clamped < min) clamped = min
      if (clamped > max) clamped = max
      const precision = getStepPrecision(step)
      clamped = parseFloat(clamped.toFixed(precision))
      return clamped
    },
    [min, max, step]
  )

  const snapToStep = React.useCallback(
    (raw: number): number => {
      const stepped = Math.round((raw - min) / step) * step + min
      return clampToStep(stepped)
    },
    [min, step, clampToStep]
  )

  // Stable updateValue that doesn't depend on resolvedValue
  const updateValue = React.useCallback(
    (raw: number) => {
      const clamped = clampToStep(raw)
      const current = clampToStep(resolvedValueRef.current)
      if (clamped !== current) {
        onValueChangeRef.current?.([clamped])
      }
    },
    [clampToStep] // No resolvedValue dependency!
  )

  // ── Bar click → jump handle ──

  const handleBarClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled || !trackRef.current) return
      // Only respond to direct clicks on the track, not on the handle
      if ((e.target as HTMLElement).dataset.sliderHandle) return

      const rect = trackRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const percent = Math.max(0, Math.min(1, x / rect.width))
      const raw = min + percent * range
      const snapped = snapToStep(raw)
      updateValue(snapped)
    },
    [disabled, min, range, snapToStep, updateValue]
  )

  // ── Drag logic ──

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)

      isDragging.current = true
      dragStarted.current = false

      // Set local drag value to current for instant visual feedback
      setLocalDragValue(resolvedValueRef.current)

      // Flush any pending property undo before starting a new drag
      useDesignerStore.getState().flushPropertyUndo()
    },
    [disabled]
  )

  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return

      // Fire onDragStart lazily on first actual drag move
      if (!dragStarted.current) {
        dragStarted.current = true
        onDragStart?.()
      }

      // Use RAF for smooth updates
      if (rafId.current) cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(() => {
        if (!trackRef.current) return
        const rect = trackRef.current.getBoundingClientRect()
        const x = e.clientX - rect.left
        const percent = Math.max(0, Math.min(1, x / rect.width))
        const raw = min + percent * range
        const newVal = snapToStep(raw)

        // Update local drag state for instant visual feedback
        setLocalDragValue(newVal)
        // Also update input display during drag
        setInputValue(formatValue(newVal, step))

        // Push to store (may be async due to React batching)
        updateValue(newVal)
      })
    },
    [min, range, snapToStep, updateValue, onDragStart, step]
  )

  const handlePointerUp = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)

      isDragging.current = false

      // Clear local drag state — revert to store-driven value
      setLocalDragValue(null)

      if (dragStarted.current) {
        // Flush the debounced property undo to immediately commit the drag's final value
        useDesignerStore.getState().flushPropertyUndo()
        onDragEnd?.()
      }
      dragStarted.current = false
    },
    [onDragEnd]
  )

  // Cleanup RAF on unmount
  React.useEffect(() => {
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current)
    }
  }, [])

  // ── Keyboard ──

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault()
        const delta = e.shiftKey ? step * 10 : step
        updateValue(resolvedValueRef.current - delta)
      } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault()
        const delta = e.shiftKey ? step * 10 : step
        updateValue(resolvedValueRef.current + delta)
      }
    },
    [disabled, step, updateValue]
  )

  // ── Numeric input ──

  const commitInputValue = React.useCallback(() => {
    const parsed = parseFloat(inputValue)
    if (!isNaN(parsed)) {
      const clamped = snapToStep(parsed)
      const current = clampToStep(resolvedValueRef.current)
      if (clamped !== current) {
        onValueChangeRef.current?.([clamped])
      } else {
        setInputValue(formatValue(clamped, step))
      }
    } else {
      setInputValue(formatValue(resolvedValueRef.current, step))
    }
  }, [inputValue, snapToStep, clampToStep, step])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      commitInputValue()
      ;(e.target as HTMLInputElement).blur()
    } else if (e.key === "Escape") {
      e.preventDefault()
      setInputValue(formatValue(resolvedValueRef.current, step))
      ;(e.target as HTMLInputElement).blur()
    }
  }

  const handleInputBlur = () => {
    commitInputValue()
  }

  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? step : -step
    updateValue(resolvedValueRef.current + delta)
  }

  // ── Render ──

  const barHeight = 6
  const handleSize = compact ? 16 : 20
  const currentlyDragging = localDragValue !== null

  return (
    <div
      className={cn("flex items-center gap-2", className)}
      data-slot="slider-field"
    >
      {/* Slider bar — full gradient (purple → pink → amber) matching the
          unified range slider look. No separate fill overlay; the thumb
          position indicates the value. */}
      <div
        ref={trackRef}
        className={cn(
          "relative rounded-full cursor-pointer flex-1 select-none",
          disabled && "opacity-50 cursor-not-allowed pointer-events-none"
        )}
        style={{
          height: barHeight,
          background: "linear-gradient(90deg, #8b5cf6, #ec4899, #f59e0b)",
        }}
        onClick={handleBarClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="slider"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={activeValue}
        aria-label={`Slider: ${min} to ${max}`}
      >
        {/* Handle — white circle, pink border, soft pink glow. Scales up on
            drag for a tactile feel. No CSS transition during drag for instant
            response. */}
        <div
          data-slider-handle="true"
          className={cn(
            "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white",
            "cursor-grab active:cursor-grabbing",
            currentlyDragging ? "" : "transition-[left] duration-75",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
          style={{
            left: `${fillPercent}%`,
            width: handleSize,
            height: handleSize,
            border: "2px solid #ec4899",
            boxShadow: currentlyDragging
              ? "0 0 0 6px rgba(236, 72, 153, 0.2), 0 0 24px rgba(236, 72, 153, 0.8)"
              : "0 0 0 4px rgba(236, 72, 153, 0.15), 0 0 16px rgba(236, 72, 153, 0.6)",
            transition: currentlyDragging
              ? "box-shadow 0.15s ease"
              : "left 0.075s, box-shadow 0.15s ease, transform 0.15s ease",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          tabIndex={-1}
        />
      </div>

      {/* Numeric input + unit */}
      <div className="flex items-center gap-0.5 shrink-0">
        <input
          type="text"
          inputMode="decimal"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          onBlur={handleInputBlur}
          onWheel={handleWheel}
          disabled={disabled}
          className={cn(
            "text-center bg-background tabular-nums",
            "border border-border rounded-md px-1",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring",
            "transition-colors duration-150",
            "hover:border-muted-foreground/40",
            disabled && "opacity-50 cursor-not-allowed",
            compact ? "w-10 h-6 text-[10px]" : "w-12 h-7 text-xs"
          )}
        />
        {unit && (
          <span className={cn("text-muted-foreground shrink-0", compact ? "text-[9px]" : "text-[10px]")}>
            {unit}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatValue(value: number, step: number): string {
  const precision = getStepPrecision(step)
  return value.toFixed(precision)
}

function getStepPrecision(step: number): number {
  if (Number.isInteger(step)) return 0
  const str = String(step)
  const decimalIndex = str.indexOf(".")
  if (decimalIndex === -1) return 0
  return str.length - decimalIndex - 1
}

export { SliderField }
