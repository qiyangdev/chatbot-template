"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function ContextWindowIndicator({
  usedTokens,
  contextWindow,
}: {
  usedTokens: number
  contextWindow: number
}) {
  const [open, setOpen] = React.useState(false)
  const remaining = Math.max(0, Math.min(1, 1 - usedTokens / contextWindow))
  const usedPercentage = Math.round((1 - remaining) * 1000) / 10
  const percentage = Math.round((100 - usedPercentage) * 10) / 10

  return (
    <Tooltip
      open={open}
      onOpenChange={(nextOpen, details) => {
        // A click focuses the trigger first; don't immediately close that tooltip.
        if (details.reason === "trigger-press") return
        setOpen(nextOpen)
      }}
    >
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground hover:text-muted-foreground"
            aria-label={`Context budget remaining: ${percentage}% (estimated)`}
            onClick={() => setOpen(true)}
          />
        }
      >
        <svg
          viewBox="0 0 24 24"
          className="size-5 -rotate-90"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" className="opacity-20" />
          <circle
            cx="12"
            cy="12"
            r="9"
            pathLength="100"
            strokeDasharray={`${remaining * 100} 100`}
            strokeLinecap="round"
            className="transition-[stroke-dasharray] duration-200 motion-reduce:transition-none"
            opacity={remaining === 0 ? 0 : 1}
          />
        </svg>
      </TooltipTrigger>
      <TooltipContent className="flex-col gap-1 px-4 py-2 text-center">
        <span className="font-medium opacity-60">
          Context window (estimated)
        </span>
        <span>
          {usedPercentage}% used ({percentage}% remaining)
        </span>
        <span>
          {new Intl.NumberFormat("en-US", {
            notation: "compact",
            maximumFractionDigits: 1,
          }).format(usedTokens)}{" "}
          tokens used /{" "}
          {new Intl.NumberFormat("en-US", {
            notation: "compact",
            maximumFractionDigits: 2,
          }).format(contextWindow)}{" "}
          total
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
