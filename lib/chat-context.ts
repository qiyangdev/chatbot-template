import { convertToModelMessages, type ModelMessage } from "ai"

import type { ChatUIMessage } from "@/tools"
import {
  MAX_TEXT_ATTACHMENTS,
  normalizeTextAttachments,
  readTextAttachment,
} from "./text-attachments"
import {
  characterCount,
  ChatLimitError,
  compactConversation,
  jsonBytes,
  MAX_INPUT_CHARACTERS,
  MAX_TOOL_OUTPUT_BYTES,
} from "./chat-limits"

export function validateChatLimits(messages: ChatUIMessage[]) {
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") {
      throw new ChatLimitError("Unsupported message role.", 400)
    }
    if (message.role === "user") {
      if (
        message.parts.some(
          (part) => part.type !== "text" && part.type !== "file"
        )
      ) {
        throw new ChatLimitError(
          "Only text input and pasted text attachments are supported.",
          400
        )
      }
      const files = message.parts.filter((part) => part.type === "file")
      if (files.length > MAX_TEXT_ATTACHMENTS)
        throw new ChatLimitError(
          "You can attach up to 4 text files per message."
        )
      files.forEach(readTextAttachment)
      const text = message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
      if (characterCount(text) > MAX_INPUT_CHARACTERS) {
        throw new ChatLimitError(
          `Messages over ${MAX_INPUT_CHARACTERS.toLocaleString("en-US")} characters must be sent as text attachments.`
        )
      }
    }
    for (const part of message.parts) {
      if (
        (part.type === "tool-github_repo" || part.type === "tool-ask_user") &&
        part.state === "output-available" &&
        jsonBytes(part.output) > MAX_TOOL_OUTPUT_BYTES
      ) {
        throw new ChatLimitError(
          "A tool result is too large. Start a new chat."
        )
      }
    }
  }
}

/** Measure the converted model messages, which can differ from the UI payload. */
export async function prepareChatContext(
  messages: ChatUIMessage[],
  maxTokens: number
) {
  const selected = compactConversation(normalizeTextAttachments(messages), {
    maxTokens,
  })
  let retained = messages.slice(selected.removedMessages)
  let modelMessages: ModelMessage[]

  while (true) {
    modelMessages = await convertToModelMessages(
      normalizeTextAttachments(retained)
    )
    const modelContext = compactConversation(modelMessages, { maxTokens })
    if (modelContext.removedMessages === 0) break

    // Remove one complete UI round, then convert again to preserve tool pairs.
    const nextRound = retained.findIndex(
      (message, index) => index > 0 && message.role === "user"
    )
    if (nextRound < 0) {
      throw new ChatLimitError("The current conversation turn is too large.")
    }
    retained = retained.slice(nextRound)
  }

  return {
    messages: retained,
    modelMessages,
    removedMessages: messages.length - retained.length,
    firstMessageId: retained[0].id,
  }
}
