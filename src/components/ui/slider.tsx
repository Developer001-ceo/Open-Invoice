"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Custom div-based slider using window-level pointer event listeners for reliable drag tracking.
 *
 * Previous approaches (native <input type="range">, Radix UI Slider, and
 * setPointerCapture-based custom slider) all had pointer-event conflicts
 * with the canvas's global window-level event handlers.
 *
 * IMPORTANT: We use pointermove/pointerup (NOT mousemove/mouseup) because
 * calling e.preventDefault() on pointerdown prevents the browser from
 * dispatching compatibility mouse events per the Pointer Events spec.
 * Using pointer events avoids this issue entirely.
 *
 * The canvas's handleMouseMove uses mousemove events and checks for
 * [data-ui-panel] and INPUT/SELECT/TEXTAREA targets, returning early
 * so there is no conflict with our pointermove listeners.
 *
 * Compatible API: value={[n]}  onValueChange={([v]) => ...}  min max step className disabled
 */

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  disabled,
  ..._rest
}: {
  className?: string
  defaultValue?: number[]
  value?: number[]
  min?: number
  max?: number
  step?: number
  onValueChange?: (vals: number[]) => void
  disabled?: boolean
  [key: string]: unknown
}) {
  const trackRef = React.useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = React.useState(false)

  const resolvedValue = value ?? defaultValue ?? [min]
  const pct = max > min ? ((resolvedValue[0] - min) / (max - min)) * 100 : 0

  // Always keep a ref to the latest updateValueFromPointer so the
  // window-level listeners never go stale.
  const updateValueFromPointer = React.useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) return
      const rect = track.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const rawValue = min + ratio * (max - min)
      // Snap to step
      const steppedValue = Math.round(rawValue / step) * step
      // Clamp to min/max
      const clampedValue = Math.max(min, Math.min(max, steppedValue))
      // Avoid floating point drift
      const finalValue = Math.round(clampedValue * 1e6) / 1e6
      if (onValueChange) {
        onValueChange([finalValue])
      }
    },
    [min, max, step, onValueChange]
  )

  // Keep the latest callback in a ref so window listeners always call the current version
  const updateValueRef = React.useRef(updateValueFromPointer)
  React.useEffect(() => {
    updateValueRef.current = updateValueFromPointer
  })

  // Handle pointer down on the track — start dragging
  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      // Prevent canvas's window-level handlers from interfering
      e.stopPropagation()
      e.preventDefault()
      setIsDragging(true)
      updateValueFromPointer(e.clientX)
    },
    [disabled, updateValueFromPointer]
  )

  // When dragging, attach window-level pointermove/pointerup listeners.
  // We use pointer events (not mouse events) because calling preventDefault()
  // on pointerdown prevents the browser from dispatching compatibility mouse
  // events per the Pointer Events spec. Using pointermove/pointerup ensures
  // drag tracking works reliably regardless.
  React.useEffect(() => {
    if (!isDragging) return

    const handleMove = (e: PointerEvent) => {
      e.preventDefault()
      updateValueRef.current(e.clientX)
    }

    const handleUp = () => {
      setIsDragging(false)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)

    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [isDragging])

  return (
    <div
      ref={trackRef}
      className={cn(
        "relative flex items-center select-none",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className
      )}
      style={{ height: 22, touchAction: "none" }}
      onPointerDown={handlePointerDown}
    >
      {/* Track — full gradient (purple → pink → amber) matching the unified
          range slider look. No separate fill overlay; the thumb position
          indicates the value. */}
      <div
        className="absolute left-0 right-0 rounded-full"
        style={{
          height: 6,
          background: "linear-gradient(90deg, #8b5cf6, #ec4899, #f59e0b)",
        }}
      />
      {/* Thumb — white circle, pink border, soft pink glow. Scales up on
          drag/hover for a tactile feel. */}
      <div
        className={cn(
          "absolute rounded-full bg-white transition-transform duration-150",
          !disabled && "hover:scale-[1.15]",
          isDragging && "scale-[1.15]"
        )}
        style={{
          left: `calc(${pct}% - 11px)`,
          width: 22,
          height: 22,
          border: "2px solid #ec4899",
          boxShadow: isDragging
            ? "0 0 0 6px rgba(236, 72, 153, 0.2), 0 0 24px rgba(236, 72, 153, 0.8)"
            : "0 0 0 4px rgba(236, 72, 153, 0.15), 0 0 16px rgba(236, 72, 153, 0.6)",
          transition: "transform 0.15s ease, box-shadow 0.15s ease",
          zIndex: 1,
        }}
      />
    </div>
  )
}

export { Slider }
