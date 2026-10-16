"use client"

import * as React from "react"
import { ArrowUpIcon, SquareIcon } from "lucide-react"
import type { FileUIPart } from "ai"

import { type ThinkingLevel, type GatewayModel } from "@/lib/models"
import { characterCount, MAX_INPUT_CHARACTERS } from "@/lib/chat-limits"
import type { ChatUIMessage } from "@/tools"
import { getContextUsage } from "@/lib/context-usage"
import {
  addTextAttachment,
  MAX_TEXT_ATTACHMENTS,
  prepareTextPrompt,
  type TextPrompt,
} from "@/lib/text-attachments"
import { TextAttachment } from "@/components/text-attachment"
import { AttachmentMenu } from "@/components/attachment-menu"
import { ContextWindowIndicator } from "@/components/context-window-indicator"
import { ModelSelect } from "@/components/model-select"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"

export function PromptForm({
  models,
  model,
  onModelChange,
  thinkingLevel,
  onThinkingLevelChange,
  isBusy,
  messages,
  contextStartId,
  onSubmit,
  onStop,
}: {
  models: GatewayModel[]
  thinkingLevel: ThinkingLevel
  onThinkingLevelChange: (level: ThinkingLevel) => void
  model: string
  onModelChange: (model: string) => void
  isBusy: boolean
  messages: ChatUIMessage[]
  contextStartId?: string
  onSubmit: (prompt: TextPrompt) => void
  onStop: () => void
}) {
  const [input, setInput] = React.useState("")
  const [attachmentDraft, setAttachmentDraft] = React.useState<{
    files: FileUIPart[]
    error?: string
  }>({ files: [] })
  const { files, error: attachmentError } = attachmentDraft
  const [isReadingAttachments, setIsReadingAttachments] = React.useState(false)
  const inputLength = characterCount(input)
  const showLengthHint = inputLength >= MAX_INPUT_CHARACTERS * 0.9
  const lengthHintId = React.useId()
  const contextTokens = React.useMemo(
    () => getContextUsage(messages, model, contextStartId, input.trim(), files),
    [messages, model, contextStartId, input, files]
  )
  const contextWindow = models.find((item) => item.id === model)?.contextWindow

  function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault()
    if ((!input.trim() && !files.length) || isBusy || isReadingAttachments)
      return
    try {
      const prompt = prepareTextPrompt(input, files)
      onSubmit(prompt)
      setInput("")
      setAttachmentDraft({ files: [] })
    } catch (error) {
      setAttachmentDraft((current) => ({
        ...current,
        error:
          error instanceof Error
            ? error.message
            : "Could not prepare the attachment.",
      }))
    }
  }

  function attachText(text: string) {
    try {
      setAttachmentDraft({ files: addTextAttachment(text, files) })
      return true
    } catch (error) {
      setAttachmentDraft((current) => ({
        ...current,
        error:
          error instanceof Error
            ? error.message
            : "Could not prepare the attachment.",
      }))
      return false
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <InputGroup>
        {files.length > 0 && (
          <InputGroupAddon
            align="block-start"
            className="flex-wrap select-text"
          >
            {files.map((file) => (
              <TextAttachment
                key={file.filename}
                file={file}
                onRemove={() => {
                  setAttachmentDraft((current) => ({
                    files: current.files.filter((item) => item !== file),
                  }))
                }}
              />
            ))}
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          placeholder="Send a message…"
          className="max-h-64 p-3.5"
          value={input}
          aria-label="Message"
          aria-invalid={attachmentError ? true : undefined}
          aria-describedby={showLengthHint ? lengthHintId : undefined}
          onChange={(event) => {
            const text = event.target.value
            setInput(text)
            if ((event.nativeEvent as InputEvent).isComposing) return
            if (
              characterCount(text) >= MAX_INPUT_CHARACTERS &&
              attachText(text)
            )
              setInput("")
          }}
          onCompositionEnd={(event) => {
            const text = event.currentTarget.value
            if (
              characterCount(text) >= MAX_INPUT_CHARACTERS &&
              attachText(text)
            )
              setInput("")
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text/plain")
            if (characterCount(text) < MAX_INPUT_CHARACTERS) return
            event.preventDefault()
            if (!attachText(text)) {
              const target = event.currentTarget
              setInput(
                target.value.slice(0, target.selectionStart) +
                  text +
                  target.value.slice(target.selectionEnd)
              )
            }
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              handleSubmit()
            }
          }}
        />
        <InputGroupAddon align="block-end">
          <AttachmentMenu
            isLoading={isReadingAttachments}
            atLimit={files.length >= MAX_TEXT_ATTACHMENTS}
            onLoadingChange={setIsReadingAttachments}
            onError={(error) =>
              setAttachmentDraft((current) => ({ ...current, error }))
            }
            onFiles={(uploaded) =>
              setAttachmentDraft((current) => {
                try {
                  return {
                    files: uploaded.reduce(
                      (next, file) =>
                        addTextAttachment(file.text, next, file.name),
                      current.files
                    ),
                  }
                } catch (error) {
                  return {
                    ...current,
                    error:
                      error instanceof Error
                        ? error.message
                        : "Could not add the selected files.",
                  }
                }
              })
            }
          />
          <ModelSelect
            models={models}
            thinkingLevel={thinkingLevel}
            onThinkingLevelChange={onThinkingLevelChange}
            value={model}
            onValueChange={onModelChange}
          />
          {contextWindow && (
            <ContextWindowIndicator
              usedTokens={contextTokens}
              contextWindow={contextWindow}
            />
          )}
          <div className="ml-auto flex shrink-0 items-center">
            {isBusy ? (
              <InputGroupButton
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label="Stop generating"
                onClick={onStop}
              >
                <SquareIcon />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                size="icon-sm"
                variant="default"
                aria-label="Send message"
                disabled={
                  isReadingAttachments || (!input.trim() && !files.length)
                }
              >
                <ArrowUpIcon />
              </InputGroupButton>
            )}
          </div>
        </InputGroupAddon>
      </InputGroup>
      {showLengthHint && (
        <p
          id={lengthHintId}
          aria-live="polite"
          className="mt-2 text-right text-xs text-muted-foreground"
        >
          {inputLength.toLocaleString("en-US")} /{" "}
          {MAX_INPUT_CHARACTERS.toLocaleString("en-US")}
          {inputLength >= MAX_INPUT_CHARACTERS &&
            " — Will be sent as a text attachment."}
        </p>
      )}
      {attachmentError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {attachmentError}
        </p>
      )}
    </form>
  )
}
