"use client"

import { ChevronDownIcon } from "lucide-react"
import {
  type GatewayModel,
  type ThinkingLevel,
  THINKING_LABELS,
  isThinkingLevelAllowed,
} from "@/lib/models"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu"

export function ModelSelect({
  models,
  value,
  onValueChange,
  thinkingLevel,
  onThinkingLevelChange,
}: {
  models: GatewayModel[]
  value: string
  onValueChange: (value: string) => void
  thinkingLevel: ThinkingLevel
  onThinkingLevelChange: (value: ThinkingLevel) => void
}) {
  const selected = models.find((model) => model.id === value)
  const levels: ThinkingLevel[] = [
    "provider-default",
    ...(selected?.thinkingLevels ?? []),
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="bg-background"
            aria-label="Model"
          />
        }
      >
        {selected?.name}
        <ChevronDownIcon className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="min-w-56">
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {models.map((model) => (
            <DropdownMenuRadioItem closeOnClick key={model.id} value={model.id}>
              {model.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {Boolean(selected?.thinkingLevels?.length) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                Thinking level
                <span className="ml-auto text-xs text-muted-foreground">
                  {THINKING_LABELS[thinkingLevel]}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-36">
                <DropdownMenuRadioGroup
                  value={thinkingLevel}
                  onValueChange={(next) => {
                    if (isThinkingLevelAllowed(selected, next))
                      onThinkingLevelChange(next)
                  }}
                >
                  {levels.map((level) => (
                    <DropdownMenuRadioItem
                      closeOnClick
                      key={level}
                      value={level}
                    >
                      {THINKING_LABELS[level]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
