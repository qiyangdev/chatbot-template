import assert from "node:assert/strict"
import { test } from "node:test"
import { Chat } from "@ai-sdk/react"
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai"
import { MockLanguageModelV4, MockProviderV4 } from "ai/test"

import { POST } from "@/app/api/chat/route"
import { DEFAULT_MODEL, MODELS, getModelInputBudget } from "./models"
import { createChatTransport } from "./chat-transport"
import { estimateTokens } from "./chat-limits"
import { prepareTextPrompt } from "./text-attachments"
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

const finish = {
  type: "finish" as const,
  finishReason: { unified: "stop" as const, raw: undefined },
  usage: {
    inputTokens: {
      total: 1,
      noCache: 1,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  },
}

function responseStream(
  text: string,
  tool = false
): Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "text-start", id: "text" })
      controller.enqueue({ type: "text-delta", id: "text", delta: text })
      controller.enqueue({ type: "text-end", id: "text" })
      if (tool)
        controller.enqueue({
          type: "tool-call",
          toolCallId: "lookup",
          toolName: "github_repo",
          input: JSON.stringify({ repo: "owner/repo" }),
        })
      controller.enqueue({
        ...finish,
        finishReason: { unified: tool ? "tool-calls" : "stop", raw: undefined },
      })
      controller.close()
    },
  })
}

test("text attachments reach the model in full and remain files through retry and follow-up", async (t) => {
  const model = new MockLanguageModelV4({
    doStream: async () => ({ stream: responseStream("Document received") }),
  })
  const previousProvider = globalThis.AI_SDK_DEFAULT_PROVIDER
  globalThis.AI_SDK_DEFAULT_PROVIDER = new MockProviderV4({
    languageModels: { [DEFAULT_MODEL]: model },
  })
  t.after(() => {
    globalThis.AI_SDK_DEFAULT_PROVIDER = previousProvider
  })
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) =>
    POST(new Request("http://localhost/api/chat", init))
  )
  const session = createChatTransport()
  const chat = new Chat<ChatUIMessage>({ transport: session.transport })
  const text = "Document content 中文😀\r\n".repeat(1000)
  await chat.sendMessage(prepareTextPrompt(text, []), {
    body: { model: DEFAULT_MODEL },
  })
  assert.equal(chat.error, undefined)
  assert.equal(chat.messages[0].parts[0].type, "file")
  await chat.regenerate({ body: { model: DEFAULT_MODEL } })
  assert.equal(chat.error, undefined)
  await chat.sendMessage(
    { text: "Summarize the document again" },
    { body: { model: DEFAULT_MODEL } }
  )
  assert.equal(chat.error, undefined)
  assert.equal(model.doStreamCalls.length, 3)
  for (const call of model.doStreamCalls) {
    const content = call.prompt[0].content
    assert.ok(Array.isArray(content))
    assert.ok(
      content.some((part) => part.type === "text" && part.text.endsWith(text))
    )
  }
  assert.equal(chat.messages[0].parts[0].type, "file")
})

test("send, retry, and subsequent requests respect the confirmed compaction boundary", async (t) => {
  const model = new MockLanguageModelV4({
    doStream: async () => ({ stream: responseStream("A reply") }),
  })
  const previousProvider = globalThis.AI_SDK_DEFAULT_PROVIDER
  globalThis.AI_SDK_DEFAULT_PROVIDER = new MockProviderV4({
    languageModels: { [DEFAULT_MODEL]: model },
  })
  t.after(() => {
    globalThis.AI_SDK_DEFAULT_PROVIDER = previousProvider
  })
  const uploaded: { messages: ChatUIMessage[] }[] = []
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      uploaded.push(JSON.parse(String(init.body)))
      return POST(new Request("http://localhost/api/chat", init))
    }
  )
  const session = createChatTransport()
  session.setContextStartId("u1")
  const boundaries: string[] = []
  const chat = new Chat<ChatUIMessage>({
    messages: Array.from({ length: 20 }, (_, index) => [
      user(`u${index}`),
      assistant(`a${index}`),
    ]).flat(),
    transport: session.transport,
    onData: (part) => {
      if (part.type === "data-compaction") {
        boundaries.push(part.data.firstMessageId)
        session.setContextStartId(part.data.firstMessageId)
      }
    },
  })
  await chat.sendMessage(
    { text: "New question" },
    { body: { model: DEFAULT_MODEL } }
  )
  assert.equal(chat.error, undefined)
  assert.equal(chat.messages.at(-1)?.metadata?.contextUsage?.usedTokens, 2)
  assert.equal(boundaries.at(-1), "u1")
  assert.equal(chat.messages.length, 42)
  assert.equal(uploaded[0].messages[0].id, "u1")
  await chat.regenerate({ body: { model: DEFAULT_MODEL } })
  assert.equal(chat.error, undefined)
  assert.equal(uploaded[1].messages[0].id, "u1")
  await chat.sendMessage({ text: "Next" }, { body: { model: DEFAULT_MODEL } })
  assert.equal(boundaries.at(-1), "u1")
  assert.equal(chat.messages[0].id, "u0")
  assert.equal(uploaded[2].messages[0].id, "u1")
})

test(
  "questionnaire output automatically resumes the existing assistant message after compaction",
  { timeout: 5000 },
  async (t) => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: responseStream("Thanks for answering"),
      }),
    })
    const previousProvider = globalThis.AI_SDK_DEFAULT_PROVIDER
    globalThis.AI_SDK_DEFAULT_PROVIDER = new MockProviderV4({
      languageModels: { [DEFAULT_MODEL]: model },
    })
    t.after(() => {
      globalThis.AI_SDK_DEFAULT_PROVIDER = previousProvider
    })
    t.mock.method(
      globalThis,
      "fetch",
      async (_url: unknown, init: RequestInit) =>
        POST(new Request("http://localhost/api/chat", init))
    )
    const session = createChatTransport()
    const question: ChatUIMessage = {
      id: "question",
      role: "assistant",
      parts: [
        {
          type: "tool-ask_user",
          toolCallId: "q",
          state: "input-available",
          input: {
            questions: [{ question: "Which?", choices: ["A", "B", "C"] }],
          },
        },
      ],
    }
    const chat = new Chat<ChatUIMessage>({
      messages: [
        user("old"),
        assistant("large", "x".repeat(3_000_000)),
        user("current"),
        question,
      ],
      transport: session.transport,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      onData: (part) => {
        if (part.type === "data-compaction")
          session.setContextStartId(part.data.firstMessageId)
      },
    })
    const finished = new Promise<void>((resolve, reject) => {
      const unregister = chat["~registerStatusCallback"](() => {
        if (chat.status === "ready") {
          unregister()
          resolve()
        }
        if (chat.status === "error") {
          unregister()
          reject(chat.error)
        }
      })
    })
    await chat.addToolOutput({
      tool: "ask_user",
      toolCallId: "q",
      output: [{ question: "Which?", answer: "B" }],
      options: { body: { model: DEFAULT_MODEL } },
    })
    await finished
    assert.equal(chat.messages.length, 4)
    assert.equal(chat.messages.at(-1)?.id, "question")
    assert.ok(
      chat.messages
        .at(-1)
        ?.parts.some(
          (part) => part.type === "text" && part.text === "Thanks for answering"
        )
    )
    assert.equal(model.doStreamCalls[0].prompt[0].role, "user")
  }
)

test("tool-loop growth compacts again before the second model call", async (t) => {
  const originalWindow = MODELS[0].contextWindow
  MODELS[0].contextWindow = 40_000
  t.after(() => {
    MODELS[0].contextWindow = originalWindow
  })
  let calls = 0
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: responseStream(
        ++calls === 1 ? "x".repeat(40_000) : "Done",
        calls === 1
      ),
    }),
  })
  const previousProvider = globalThis.AI_SDK_DEFAULT_PROVIDER
  globalThis.AI_SDK_DEFAULT_PROVIDER = new MockProviderV4({
    languageModels: { [DEFAULT_MODEL]: model },
  })
  t.after(() => {
    globalThis.AI_SDK_DEFAULT_PROVIDER = previousProvider
  })
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ full_name: "owner/repo" })
  )
  const response = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          user("old"),
          assistant("old-reply", "y".repeat(40_000)),
          user("current"),
        ],
      }),
    })
  )
  const stream = await response.text()
  assert.equal(model.doStreamCalls.length, 2)
  assert.match(
    stream,
    /"type":"data-compaction","data":\{"firstMessageId":"current"\}/
  )
  assert.doesNotMatch(stream, /"type":"error"/)
  const usages = stream
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)))
    .filter((chunk) => chunk.messageMetadata?.contextUsage)
    .map((chunk) => chunk.messageMetadata.contextUsage.usedTokens)
  assert.deepEqual(
    usages,
    [2, 2],
    "show the last call's window, not cumulative billed tokens"
  )
  assert.equal(
    model.doStreamCalls[1].prompt.filter((message) => message.role === "user")
      .length,
    1
  )
  assert.ok(
    estimateTokens(model.doStreamCalls[1].prompt) <=
      getModelInputBudget(DEFAULT_MODEL)
  )
})

test("thinking level is validated and forwarded to the selected model", async (t) => {
  const model = new MockLanguageModelV4({
    doStream: async () => ({ stream: responseStream("Done") }),
  })
  const previousProvider = globalThis.AI_SDK_DEFAULT_PROVIDER
  globalThis.AI_SDK_DEFAULT_PROVIDER = new MockProviderV4({
    languageModels: Object.fromEntries(MODELS.map((item) => [item.id, model])),
  })
  t.after(() => {
    globalThis.AI_SDK_DEFAULT_PROVIDER = previousProvider
  })
  for (const item of MODELS) {
    for (const thinkingLevel of [undefined, "low", "xhigh", "max"]) {
      const response = await POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({
            model: item.id,
            thinkingLevel,
            messages: [user("test")],
          }),
        })
      )
      assert.equal(response.status, 200)
      await response.text()
      const call = model.doStreamCalls.at(-1)!
      if (thinkingLevel === "max") {
        assert.deepEqual(
          call.providerOptions,
          item.id.startsWith("anthropic/")
            ? { anthropic: { effort: "max" } }
            : { openai: { reasoningEffort: "max" } }
        )
      } else {
        assert.equal(call.reasoning, thinkingLevel ?? "provider-default")
      }
    }
  }
  const before = model.doStreamCalls.length
  for (const thinkingLevel of [
    "none",
    "ultra",
    null,
    123,
    { effort: "high" },
  ]) {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          thinkingLevel,
          messages: [user("test")],
        }),
      })
    )
    assert.equal(response.status, 400)
  }
  assert.equal(model.doStreamCalls.length, before)
})
