import type { ChatUIMessage } from "@/tools"
import { estimateTokens } from "./chat-limits"
import type { FileUIPart } from "ai"
import { attachmentToText } from "./text-attachments"

export interface ContextUsage {
  modelId: string
  usedTokens: number
  firstMessageId: string
  // Local baseline captured once the corresponding assistant reply is complete.
  estimatedTokens?: number | null
}

export function estimateConversationTokens(messages: ChatUIMessage[]) {
  if (!messages.length) return 0
  return estimateTokens(
    messages.map((message) => ({
      role: message.role,
      parts: message.parts.flatMap<Record<string, unknown>>((part) => {
        if (part.type === "text" || part.type === "reasoning")
          return [{ type: part.type, text: part.text }]
        if (part.type === "file" && message.role === "user")
          return [attachmentToText(part)]
        if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
          const tool = part as {
            type: string
            input?: unknown
            output?: unknown
          }
          return [{ type: tool.type, input: tool.input, output: tool.output }]
        }
        return []
      }),
    }))
  )
}

export function getContextUsage(
  messages: ChatUIMessage[],
  modelId: string,
  firstMessageId?: string,
  draft = "",
  files: FileUIPart[] = []
) {
  const start = messages.findIndex((message) => message.id === firstMessageId)
  const retained = start >= 0 ? messages.slice(start) : messages
  const estimated = estimateConversationTokens(retained)
  const anchor = retained.findLast((message) => {
    const usage = message.metadata?.contextUsage
    return (
      usage?.modelId === modelId &&
      usage.firstMessageId === retained[0]?.id &&
      usage.estimatedTokens != null
    )
  })?.metadata?.contextUsage
  const draftTokens =
    draft || files.length
      ? estimateConversationTokens([
          {
            id: "draft",
            role: "user",
            parts: [...files, { type: "text", text: draft }],
          },
        ])
      : 0
  return (
    Math.max(
      0,
      anchor
        ? anchor.usedTokens + estimated - anchor.estimatedTokens!
        : estimated
    ) + draftTokens
  )
}

export function calibrateContextUsage(
  messages: ChatUIMessage[],
  message: ChatUIMessage
) {
  const usage = message.metadata?.contextUsage
  if (!usage) return messages
  const start = messages.findIndex((item) => item.id === usage.firstMessageId)
  if (start < 0) return messages
  const estimatedTokens = estimateConversationTokens(messages.slice(start))
  return messages.map((item) =>
    item.id === message.id
      ? {
          ...item,
          metadata: {
            ...item.metadata,
            contextUsage: { ...usage, estimatedTokens },
          },
        }
      : item
  )
}
