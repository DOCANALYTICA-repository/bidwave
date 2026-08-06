"use client"

import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

/**
 * @base-ui/react ships a Slider module already (dependency already
 * installed for Dialog/Select/etc.) — this just wraps it shadcn-style,
 * same anatomy as progress.tsx (Root > Control > Track > Indicator, plus
 * Thumb here since a slider is draggable). No `asChild` — composition is
 * via `render`, per this project's Base UI convention.
 */
function Slider({ className, ...props }: SliderPrimitive.Root.Props<number>) {
  return (
    <SliderPrimitive.Root data-slot="slider" className={cn("relative flex w-full items-center", className)} {...props}>
      <SliderPrimitive.Control className="flex w-full items-center py-2">
        <SliderPrimitive.Track className="relative h-1.5 w-full grow rounded-full bg-surface-3">
          <SliderPrimitive.Indicator className="h-full rounded-full bg-gold" />
          <SliderPrimitive.Thumb className="block size-4 rounded-full border-2 border-gold bg-background shadow transition-transform focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-gold/50 data-[dragging]:scale-110" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

function SliderValue({ className, ...props }: SliderPrimitive.Value.Props) {
  return (
    <SliderPrimitive.Value
      data-slot="slider-value"
      className={cn("font-mono text-sm tabular-nums text-ink-2", className)}
      {...props}
    />
  )
}

export { Slider, SliderValue }
