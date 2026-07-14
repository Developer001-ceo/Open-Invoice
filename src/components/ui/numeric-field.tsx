"use client"
import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * NumericField — a clean, MS Word–style numeric input field.
 *
 * Just a simple input where the user types a value within [min, max].
 * Arrow Up/Down keys adjust by step. No sliders, no +/- buttons.
 *
 * Compatible API with StepperInput:
 *   value={[n]}  onValueChange={([v]) => ...}  min max step className disabled
 */

interface NumericFieldProps {
  value?: number[]
  min?: number
  max?: number
  step?: number
  onValueChange?: (vals: number[]) => void
  className?: string
  disabled?: boolean
  unit?: string
}

function NumericField({
  value,
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  className,
  disabled = false,
  unit,
}: NumericFieldProps) {
  const resolvedValue = value?.[0] ?? min

  const [inputValue, setInputValue] = React.useState<string>(
    formatValue(resolvedValue, step)
  )

  // Sync external value changes into the input display
  React.useEffect(() => {
    setInputValue(formatValue(resolvedValue, step))
  }, [resolvedValue, step])

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

  const commitValue = React.useCallback(
    (raw: number) => {
      const stepped = Math.round((raw - min) / step) * step + min
      const clamped = clampToStep(stepped)
      const current = clampToStep(resolvedValue)
      if (clamped !== current) {
        onValueChange?.([clamped])
      } else {
        setInputValue(formatValue(clamped, step))
      }
    },
    [min, step, clampToStep, resolvedValue, onValueChange]
  )

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      const parsed = parseFloat(inputValue)
      if (!isNaN(parsed)) {
        commitValue(parsed)
      } else {
        setInputValue(formatValue(resolvedValue, step))
      }
      ;(e.target as HTMLInputElement).blur()
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      const parsed = parseFloat(inputValue)
      if (!isNaN(parsed)) {
        const next = clampToStep(parsed + step)
        onValueChange?.([next])
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      const parsed = parseFloat(inputValue)
      if (!isNaN(parsed)) {
        const next = clampToStep(parsed - step)
        onValueChange?.([next])
      }
    } else if (e.key === "Escape") {
      e.preventDefault()
      setInputValue(formatValue(resolvedValue, step))
      ;(e.target as HTMLInputElement).blur()
    }
  }

  const handleInputBlur = () => {
    const parsed = parseFloat(inputValue)
    if (!isNaN(parsed)) {
      commitValue(parsed)
    } else {
      setInputValue(formatValue(resolvedValue, step))
    }
  }

  // Allow mouse wheel to adjust value when focused
  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? step : -step
    const next = clampToStep(resolvedValue + delta)
    if (next !== clampToStep(resolvedValue)) {
      onValueChange?.([next])
    }
  }

  return (
    <div
      className={cn("flex items-center gap-1", className)}
      data-slot="numeric-field"
    >
      <div className="relative flex-1 min-w-0">
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
            "w-full h-7 text-xs text-center bg-background",
            "border border-border rounded-md px-2",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring",
            "tabular-nums",
            "transition-colors duration-150",
            "hover:border-muted-foreground/40",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          role="spinbutton"
          step={step}
          min={min}
          max={max}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={resolvedValue}
        />
      </div>
      {unit && (
        <span className="text-[10px] text-muted-foreground shrink-0">{unit}</span>
      )}
    </div>
  )
}

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

export { NumericField }
