import assert from "node:assert/strict"
import { test } from "node:test"

import type { ChatUIMessage } from "@/tools"
import { prepareChatContext } from "./chat-context"
import {
  calibrateContextUsage,
  estimateConversationTokens,
  getContextUsage,
} from "./context-usage"
import { DEFAULT_MODEL, getModelInputBudget, MODELS } from "./models"

test("a single 73.4 KiB reply fits the actual model window", async () => {
  const messages: ChatUIMessage[] = [
    {
      id: "u",
      role: "user",
      parts: [{ type: "text", text: "Search the web" }],
    },
    {
      id: "a",
      role: "assistant",
      parts: [{ type: "text", text: "x".repeat(Math.ceil(73.4 * 1024)) }],
    },
  ]
  const context = await prepareChatContext(
    messages,
    getModelInputBudget(DEFAULT_MODEL)
  )
  assert.equal(context.removedMessages, 0)
  assert.ok(
    getContextUsage(messages, DEFAULT_MODEL) / MODELS[0].contextWindow < 0.05
  )
})

test("reported usage calibrates completed replies and drafts add estimated tokens", () => {
  const messages: ChatUIMessage[] = [
    { id: "u", role: "user", parts: [{ type: "text", text: "Search" }] },
    {
      id: "a",
      role: "assistant",
      parts: [{ type: "text", text: "Answer" }],
      metadata: {
        contextUsage: {
          modelId: DEFAULT_MODEL,
          usedTokens: 22_000,
          firstMessageId: "u",
        },
      },
    },
  ]
  const calibrated = calibrateContextUsage(messages, messages[1])
  assert.equal(getContextUsage(calibrated, DEFAULT_MODEL), 22_000)
  assert.ok(
    getContextUsage(calibrated, DEFAULT_MODEL, undefined, "中文 draft") > 22_000
  )
  assert.equal(
    getContextUsage(calibrated, MODELS[1].id),
    estimateConversationTokens(messages)
  )
})

test("compaction invalidates old usage anchors and source URLs do not consume message tokens", () => {
  const messages: ChatUIMessage[] = [
    { id: "old", role: "user", parts: [{ type: "text", text: "Old" }] },
    {
      id: "a",
      role: "assistant",
      parts: [],
      metadata: {
        contextUsage: {
          modelId: DEFAULT_MODEL,
          usedTokens: 900_000,
          estimatedTokens: 10,
          firstMessageId: "old",
        },
      },
    },
    { id: "new", role: "user", parts: [{ type: "text", text: "New" }] },
  ]
  assert.equal(
    getContextUsage(messages, DEFAULT_MODEL, "new"),
    estimateConversationTokens(messages.slice(2))
  )
  const before = estimateConversationTokens(messages)
  messages[1].parts.push({
    type: "source-url",
    sourceId: "source",
    url: `https://example.com/${"x".repeat(100_000)}`,
  })
  assert.equal(estimateConversationTokens(messages), before)
})
