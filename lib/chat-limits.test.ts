import assert from "node:assert/strict"
import { test } from "node:test"
import { convertToModelMessages } from "ai"

import { POST } from "@/app/api/chat/route"
import { prepareChatContext, validateChatLimits } from "./chat-context"
import {
  characterCount,
  ChatLimitError,
  compactConversation,
  jsonBytes,
  MAX_INPUT_CHARACTERS,
  MAX_REQUEST_BYTES,
  MAX_TOOL_OUTPUT_BYTES,
} from "./chat-limits"
import { readLimitedJson } from "./read-limited-json"
import type { ChatUIMessage } from "@/tools"

const user = (id: string, text = "Hello"): ChatUIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
})
const assistant = (id: string, text = "Reply"): ChatUIMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text }],
})

test("character limits count Unicode code points, not UTF-16 units", () => {
  assert.equal(characterCount("中文😀"), 3)
  validateChatLimits([user("u", "😀".repeat(MAX_INPUT_CHARACTERS))])
  assert.throws(
    () =>
      validateChatLimits([user("u", "😀".repeat(MAX_INPUT_CHARACTERS + 1))]),
    ChatLimitError
  )
})

test("does not discard short conversations simply because they exceed 20 rounds", () => {
  const messages = Array.from({ length: 21 }, (_, index) => [
    user(`u${index}`),
    assistant(`a${index}`),
  ]).flat()
  const compacted = compactConversation(messages)
  assert.equal(compacted.messages[0].id, "u0")
  assert.equal(compacted.messages.length, 42)
  assert.equal(messages.length, 42)
})

test("byte budgets keep tool calls and results in the same round", () => {
  const messages = [
    { role: "user", content: "old" },
    { role: "assistant", content: "old answer" },
    { role: "user", content: "current" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "t" }] },
    {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "t", result: "中文😀" }],
    },
  ]
  const latestRound = messages.slice(2)
  const limit = jsonBytes(latestRound)
  assert.deepEqual(
    compactConversation(messages, { maxBytes: limit }).messages,
    latestRound
  )
  assert.throws(
    () => compactConversation(messages, { maxBytes: limit - 1 }),
    ChatLimitError
  )
})

test("does not skip a large intervening round to resurrect older context", () => {
  const messages = [user("old"), user("large", "x".repeat(500)), user("latest")]
  assert.deepEqual(compactConversation(messages, { maxBytes: 200 }).messages, [
    messages[2],
  ])
})

test("rejects empty conversations and orphaned assistant/tool prefixes", () => {
  assert.throws(() => compactConversation([]), ChatLimitError)
  assert.throws(
    () => compactConversation([assistant("a"), user("u")]),
    ChatLimitError
  )
})

test("questionnaire continuation keeps its initiating user and complete result", async () => {
  const question: ChatUIMessage = {
    id: "question",
    role: "assistant",
    parts: [
      {
        type: "tool-ask_user",
        toolCallId: "question-tool",
        state: "output-available",
        input: {
          questions: [{ question: "Which?", choices: ["A", "B", "C"] }],
        },
        output: [{ question: "Which?", answer: "B" }],
      },
    ],
  }
  const messages = [
    user("old"),
    assistant("old-reply", "x".repeat(64 * 1024)),
    user("current"),
    question,
  ]
  const context = await prepareChatContext(messages, 1000)
  assert.equal(context.firstMessageId, "current")
  assert.deepEqual(context.messages, messages.slice(2))
  assert.deepEqual(
    context.modelMessages.map((message) => message.role),
    ["user", "assistant", "tool"]
  )
})

test("model conversion overhead is included in the context budget", async () => {
  const current = user("current", "x".repeat(100))
  const toolMessage: ChatUIMessage = {
    id: "a",
    role: "assistant",
    parts: [
      {
        type: "tool-github_repo",
        toolCallId: "t",
        state: "output-available",
        input: { repo: "x/y" },
        output: { error: "unavailable" },
      },
    ],
  }
  const messages = [user("old", ""), toolMessage, current]
  const maxBytes = 64 * 1024
  messages[0] = user("old", "x".repeat(maxBytes - jsonBytes(messages)))
  assert.equal(compactConversation(messages).removedMessages, 0)
  assert.ok(jsonBytes(await convertToModelMessages(messages)) > maxBytes)
  const context = await prepareChatContext(messages, Math.ceil(maxBytes / 3))
  assert.ok(jsonBytes(context.modelMessages) <= maxBytes)
  assert.equal(context.firstMessageId, "current")
})

test("rejects oversized custom tool results and unsupported user attachments", () => {
  const message: ChatUIMessage = {
    id: "a",
    role: "assistant",
    parts: [
      {
        type: "tool-github_repo",
        toolCallId: "t",
        state: "output-available",
        input: { repo: "owner/repo" },
        output: { error: "x".repeat(MAX_TOOL_OUTPUT_BYTES) },
      },
    ],
  }
  assert.throws(() => validateChatLimits([user("u"), message]), ChatLimitError)
  assert.throws(
    () =>
      validateChatLimits([
        {
          id: "u",
          role: "user",
          parts: [
            {
              type: "file",
              mediaType: "text/plain",
              url: "https://example.com/file",
            },
          ],
        },
      ]),
    ChatLimitError
  )
})

function chunkedRequest(
  chunks: Uint8Array[],
  headers: HeadersInit = {},
  onCancel = () => {}
) {
  const stream = new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk))
      controller.close()
    },
    cancel: onCancel,
  })
  return new Request("http://localhost/api/chat", {
    method: "POST",
    body: stream,
    headers,
    duplex: "half",
  } as RequestInit & { duplex: "half" })
}

test("reads JSON correctly when UTF-8 characters span request chunks", async () => {
  const data = new TextEncoder().encode(JSON.stringify({ text: "中文😀" }))
  const request = chunkedRequest(
    Array.from(data, (byte) => Uint8Array.of(byte))
  )
  assert.deepEqual(await readLimitedJson(request), { text: "中文😀" })
})

test("enforces actual body size without trusting Content-Length", async () => {
  let cancelled = false
  const request = chunkedRequest(
    [new Uint8Array(10), new Uint8Array(10), new Uint8Array(10)],
    { "content-length": "1" },
    () => {
      cancelled = true
    }
  )
  await assert.rejects(readLimitedJson(request, 15), ChatLimitError)
  assert.equal(cancelled, true)
  await assert.rejects(
    readLimitedJson(chunkedRequest([new Uint8Array(20)]), 15),
    ChatLimitError
  )
})

test("accepts exactly the body limit and rejects invalid JSON", async () => {
  const body = JSON.stringify({ text: "中文" })
  assert.deepEqual(
    await readLimitedJson(
      new Request("http://localhost", { method: "POST", body }),
      new TextEncoder().encode(body).length
    ),
    { text: "中文" }
  )
  await assert.rejects(
    readLimitedJson(
      new Request("http://localhost", { method: "POST", body: "{" })
    ),
    SyntaxError
  )
})

test("route rejects oversized bodies and messages before contacting a model", async () => {
  const oversizedBody = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: "x".repeat(MAX_REQUEST_BYTES + 1),
    })
  )
  assert.equal(oversizedBody.status, 413)
  const oversizedMessage = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [user("u", "x".repeat(MAX_INPUT_CHARACTERS + 1))],
      }),
    })
  )
  assert.equal(oversizedMessage.status, 413)
  assert.match(await oversizedMessage.text(), /12,000/)
})
