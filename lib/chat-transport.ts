import { DefaultChatTransport } from "ai"

import type { ChatUIMessage } from "@/tools"
import { DEFAULT_MODEL, getModelInputBudget } from "./models"
import { normalizeTextAttachments } from "./text-attachments"
import {
  ChatLimitError,
  compactConversation,
  jsonBytes,
  MAX_REQUEST_BYTES,
} from "./chat-limits"

export function createChatTransport() {
  let contextStartId: string | undefined
  const transport = new DefaultChatTransport<ChatUIMessage>({
    prepareSendMessagesRequest: ({ messages, body }) => {
      // Once forgotten, old rounds must not reappear if a later reply is shorter.
      const start = messages.findIndex(
        (message) => message.id === contextStartId
      )
      const activeMessages = start >= 0 ? messages.slice(start) : messages
      const modelId =
        typeof body?.model === "string" ? body.model : DEFAULT_MODEL
      const compacted = compactConversation(
        normalizeTextAttachments(activeMessages),
        {
          maxTokens: getModelInputBudget(modelId),
        }
      )
      const requestBody = {
        ...body,
        messages: activeMessages.slice(compacted.removedMessages),
        contextCompacted: start > 0 || compacted.removedMessages > 0,
      }
      if (jsonBytes(requestBody) > MAX_REQUEST_BYTES) {
        throw new ChatLimitError(
          "The chat request is too large. Start a new chat."
        )
      }
      return { body: requestBody }
    },
  })

  return {
    transport,
    setContextStartId(id: string) {
      contextStartId = id
    },
  }
}
