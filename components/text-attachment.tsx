"use client"

import * as React from "react"
import type { FileUIPart } from "ai"
import { ScanTextIcon, XIcon } from "lucide-react"

import { characterCount } from "@/lib/chat-limits"
import { readTextAttachment } from "@/lib/text-attachments"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export function TextAttachment({
  file,
  onRemove,
}: {
  file: FileUIPart
  onRemove?: () => void
}) {
  const text = React.useMemo(() => readTextAttachment(file), [file])
  const title = text.trim().replace(/\s+/g, " ").slice(0, 120) || file.filename
  return (
    <Dialog>
      <div className="relative w-72 max-w-full min-w-0 rounded-2xl border bg-background text-foreground">
        <DialogTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full min-w-0 justify-start gap-2 rounded-2xl p-2 pr-9 text-left"
              aria-label={`Preview ${file.filename}`}
            />
          }
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
            <ScanTextIcon className="size-4 text-muted-foreground" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {title}
            </span>
          </span>
        </DialogTrigger>
        {onRemove && (
          <Button
            type="button"
            variant="default"
            size="icon-xs"
            className="absolute top-1/2 right-2 size-5 -translate-y-1/2 rounded-full bg-foreground text-background hover:bg-foreground/80 hover:text-background active:not-aria-[haspopup]:-translate-y-1/2"
            title="Remove attachment"
            aria-label={`Remove ${file.filename}`}
            onClick={onRemove}
          >
            <XIcon className="size-3" />
          </Button>
        )}
      </div>
      <DialogContent className="flex max-h-[80svh] min-h-0 flex-col sm:max-w-2xl">
        <DialogHeader className="pr-8">
          <DialogTitle>{file.filename}</DialogTitle>
          <DialogDescription>
            {characterCount(text).toLocaleString("en-US")} characters · UTF-8
            text
          </DialogDescription>
        </DialogHeader>
        <pre className="min-h-0 overflow-auto rounded-xl bg-muted p-4 font-mono text-xs wrap-anywhere whitespace-pre-wrap">
          {text}
        </pre>
      </DialogContent>
    </Dialog>
  )
}
