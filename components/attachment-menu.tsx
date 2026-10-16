"use client"

import * as React from "react"
import { FileUpIcon, PlusIcon } from "lucide-react"

import {
  readUploadedTextFiles,
  TEXT_FILE_ACCEPT,
  type UploadedText,
} from "@/lib/text-attachments"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function AttachmentMenu({
  onFiles,
  onError,
  onLoadingChange,
  isLoading,
  atLimit,
}: {
  onFiles: (files: UploadedText[]) => void
  onError: (message: string) => void
  onLoadingChange: (loading: boolean) => void
  isLoading: boolean
  atLimit: boolean
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={TEXT_FILE_ACCEPT}
        className="hidden"
        aria-label="Choose text attachments"
        onChange={async (event) => {
          const selected = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ""
          if (!selected.length) return
          onLoadingChange(true)
          try {
            onFiles(await readUploadedTextFiles(selected))
          } catch (error) {
            onError(
              error instanceof Error
                ? error.message
                : "Could not read the selected files."
            )
          } finally {
            onLoadingChange(false)
          }
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-2xl bg-background text-muted-foreground"
              aria-label="Add attachment"
              aria-busy={isLoading}
              disabled={isLoading}
            />
          }
        >
          <PlusIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-60">
          <DropdownMenuItem
            disabled={atLimit}
            onClick={() => inputRef.current?.click()}
          >
            <FileUpIcon />
            Upload text files
          </DropdownMenuItem>
          <p className="px-2 pt-1 pb-2 text-xs text-muted-foreground">
            {atLimit
              ? "4 attachments added. Remove one to add more."
              : "TXT, MD, CSV, JSON, LOG · Up to 512 KiB each"}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
