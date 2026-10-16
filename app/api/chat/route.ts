import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from "ai"

import {
  DEFAULT_MODEL,
  MODELS,
  isThinkingLevelAllowed,
  getReasoningOptions,
  isModelAllowed,
  getModelInputBudget,
  MAX_OUTPUT_TOKENS,
  TOOL_TOKEN_RESERVE,
} from "@/lib/models"
import { prepareChatContext, validateChatLimits } from "@/lib/chat-context"
import {
  ChatLimitError,
  compactConversation,
  estimateTokens,
} from "@/lib/chat-limits"
import { readLimitedJson } from "@/lib/read-limited-json"
import { getTools, type ChatUIMessage } from "@/tools"

export const maxDuration = 30

// This endpoint is public and spends your AI Gateway credits on every request.
// Before exposing it to real traffic, add a rate limit (e.g. Vercel Firewall /
// WAF or @upstash/ratelimit), authentication, and an AI Gateway spend limit.
// See the README "Security" section.
export async function POST(req: Request) {
  let body: unknown
  try {
    body = await readLimitedJson(req)
  } catch (error) {
    if (error instanceof ChatLimitError) {
      return new Response(error.message, { status: error.status })
    }
    return Response.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  const model = (body as { model?: unknown })?.model
  const modelId = typeof model === "string" ? model : DEFAULT_MODEL

  if (!isModelAllowed(modelId)) {
    return Response.json(
      { error: `Model ${modelId} is not available.` },
      { status: 400 }
    )
  }

  const requestedThinkingLevel = (body as { thinkingLevel?: unknown })
    ?.thinkingLevel
  const thinkingLevel =
    requestedThinkingLevel === undefined
      ? "provider-default"
      : requestedThinkingLevel
  if (
    !isThinkingLevelAllowed(
      MODELS.find((item) => item.id === modelId),
      thinkingLevel
    )
  ) {
    return Response.json(
      { error: "Thinking level is not available for this model." },
      { status: 400 }
    )
  }

  const tools = getTools(modelId)
  const inputBudget = getModelInputBudget(modelId)

  // Validate the shape of every message and tool part before trusting it.
  let messages: ChatUIMessage[]
  try {
    const validated = await validateUIMessages<ChatUIMessage>({
      messages: (body as { messages?: unknown })?.messages,
      tools: tools as Parameters<typeof validateUIMessages>[0]["tools"],
    })
    messages = validated
  } catch {
    return Response.json({ error: "Invalid messages." }, { status: 400 })
  }

  let context: Awaited<ReturnType<typeof prepareChatContext>>
  try {
    validateChatLimits(messages)
    context = await prepareChatContext(messages, inputBudget)
  } catch (error) {
    if (error instanceof ChatLimitError) {
      return new Response(error.message, { status: error.status })
    }
    return Response.json({ error: "Invalid conversation." }, { status: 400 })
  }

  // A reply after ask_user continues the last message, so count its parts.
  const lastMessage = messages.at(-1)
  let reasoningCount =
    lastMessage?.role === "assistant"
      ? lastMessage.parts.filter((part) => part.type === "reasoning").length
      : 0
  const reasoningStarts = new Map<string, { index: number; time: number }>()

  const streamError = (error: unknown) =>
    error instanceof ChatLimitError
      ? error.message
      : "Something went wrong. Please try again."

  return createUIMessageStreamResponse({
    stream: createUIMessageStream<ChatUIMessage>({
      originalMessages: context.messages,
      onError: streamError,
      execute: ({ writer }) => {
        writer.write({ type: "start" })
        const notifyCompacted = (firstMessageId: string) => {
          writer.write({
            type: "data-compaction",
            data: { firstMessageId },
            transient: true,
          })
        }

        if (
          context.removedMessages > 0 ||
          (body as { contextCompacted?: unknown })?.contextCompacted === true
        ) {
          notifyCompacted(context.firstMessageId)
        }

        let retainedUsers = context.messages.filter(
          (message) => message.role === "user"
        )
        let estimatedStepTokens = 0
        let extraInputTokens = 0
        const result = streamText({
          model: modelId,
          ...getReasoningOptions(modelId, thinkingLevel),
          messages: context.modelMessages,
          tools,
          stopWhen: isStepCount(5),
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          abortSignal: req.signal,
          prepareStep: ({ messages: stepMessages }) => {
            const compacted = compactConversation(stepMessages, {
              maxTokens: Math.max(1, inputBudget - extraInputTokens),
            })
            if (compacted.removedMessages > 0) {
              const removedRounds = stepMessages
                .slice(0, compacted.removedMessages)
                .filter((message) => message.role === "user").length
              retainedUsers = retainedUsers.slice(removedRounds)
              notifyCompacted(retainedUsers[0].id)
            }
            estimatedStepTokens = estimateTokens(compacted.messages)
            return { messages: compacted.messages }
          },
          onStepEnd: ({ usage }) => {
            if (usage.inputTokens != null && estimatedStepTokens > 0) {
              // Treat tool/provider overhead as an offset, not a multiplier:
              // fixed tool definitions must not inflate a tiny first prompt's ratio.
              extraInputTokens = Math.max(
                0,
                usage.inputTokens - estimatedStepTokens - TOOL_TOKEN_RESERVE
              )
            }
          },
        })

        writer.merge(
          toUIMessageStream({
            stream: result.stream,
            sendStart: false,
            sendSources: true,
            // The AI SDK does not time reasoning, so time each block here.
            messageMetadata: ({ part }) => {
              if (
                part.type === "finish-step" &&
                part.usage.inputTokens != null &&
                part.usage.outputTokens != null
              ) {
                return {
                  contextUsage: {
                    modelId,
                    // The most recent call's window, not accumulated billed usage.
                    usedTokens:
                      part.usage.inputTokens + part.usage.outputTokens,
                    firstMessageId: retainedUsers[0].id,
                    estimatedTokens: null,
                  },
                }
              }
              if (part.type === "reasoning-start") {
                reasoningStarts.set(part.id, {
                  index: reasoningCount++,
                  time: Date.now(),
                })
              }

              const start =
                part.type === "reasoning-end"
                  ? reasoningStarts.get(part.id)
                  : undefined

              if (!start) {
                return undefined
              }

              return {
                reasoningDurations: { [start.index]: Date.now() - start.time },
              }
            },
            onError: streamError,
          })
        )
      },
    }),
  })
}
