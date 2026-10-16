import assert from "node:assert/strict"
import { test } from "node:test"
import type { FileUIPart } from "ai"

import type { ChatUIMessage } from "@/tools"
import { prepareChatContext, validateChatLimits } from "./chat-context"
import { ChatLimitError, MAX_INPUT_CHARACTERS } from "./chat-limits"
import { estimateConversationTokens, getContextUsage } from "./context-usage"
import { DEFAULT_MODEL, getModelInputBudget } from "./models"
import {
  addTextAttachment,
  MAX_TEXT_ATTACHMENT_BYTES,
  MAX_TEXT_ATTACHMENTS,
  prepareTextPrompt,
  readTextAttachment,
  readUploadedTextFiles,
} from "./text-attachments"

test("uploaded UTF-8 files preserve original names and resolve duplicate names", async () => {
  const text = "\ufeff# Notes\r\n中文 😀\n"
  const selected = await readUploadedTextFiles([
    new File([text], "notes.md"),
    new File(["second"], "notes.md"),
  ])
  const files = selected.reduce(
    (files, file) => addTextAttachment(file.text, files, file.name),
    [] as FileUIPart[]
  )
  assert.deepEqual(
    files.map((file) => file.filename),
    ["notes.md", "notes-2.md"]
  )
  assert.equal(readTextAttachment(files[0]), text)
  validateChatLimits([{ id: "u", role: "user", parts: files }])
})

test("uploaded files reject unsupported types, excessive size, invalid UTF-8 and excessive counts", async () => {
  await assert.rejects(
    readUploadedTextFiles([new File(["not text"], "document.pdf")]),
    ChatLimitError
  )
  await assert.rejects(
    readUploadedTextFiles([new File([new Uint8Array([255])], "binary.txt")]),
    ChatLimitError
  )
  await assert.rejects(
    readUploadedTextFiles([
      new File([new Uint8Array(MAX_TEXT_ATTACHMENT_BYTES + 1)], "large.txt"),
    ]),
    ChatLimitError
  )
  await assert.rejects(
    readUploadedTextFiles(
      Array.from(
        { length: 5 },
        (_, index) => new File(["text"], `${index}.txt`)
      )
    ),
    ChatLimitError
  )
  assert.throws(
    () => addTextAttachment("text", [], "../notes.txt"),
    ChatLimitError
  )
})

test("inline text stays inline below the threshold and becomes a file at the threshold", () => {
  assert.equal(
    prepareTextPrompt("a".repeat(MAX_INPUT_CHARACTERS - 1), []).files.length,
    0
  )
  const text = "a".repeat(MAX_INPUT_CHARACTERS)
  const prompt = prepareTextPrompt(text, [])
  assert.equal(prompt.text, "")
  assert.equal(prompt.files[0].filename, "pasted-text.txt")
  assert.equal(readTextAttachment(prompt.files[0]), text)
})

test("UTF-8 text preserves whitespace, BOM, emoji and line endings exactly", () => {
  const text = "\ufeff  中文😀\r\n\nlast line  \n"
  const files = addTextAttachment(text, [])
  assert.equal(readTextAttachment(files[0]), text)
})

test("long text prepared for sending becomes an attachment without losing edits", () => {
  const original = "中文😀".repeat(5000)
  const files = addTextAttachment(original, [])
  const edited = readTextAttachment(files[0]) + "\nEdited"
  const prompt = prepareTextPrompt(edited, [])
  assert.equal(readTextAttachment(prompt.files[0]), edited)
})

test("attachments can be sent alone or alongside a short instruction", () => {
  const files = addTextAttachment("Reference material", [])
  assert.equal(prepareTextPrompt("", files).files.length, 1)
  assert.equal(
    prepareTextPrompt("Summarize this", files).text,
    "Summarize this"
  )
  assert.throws(() => prepareTextPrompt("", []), ChatLimitError)
})

test("file limits use UTF-8 bytes and allow the exact boundary", () => {
  const files = addTextAttachment("x".repeat(MAX_TEXT_ATTACHMENT_BYTES), [])
  assert.equal(readTextAttachment(files[0]).length, MAX_TEXT_ATTACHMENT_BYTES)
  assert.throws(
    () => addTextAttachment("x".repeat(MAX_TEXT_ATTACHMENT_BYTES + 1), []),
    ChatLimitError
  )
  assert.throws(
    () =>
      addTextAttachment(
        "中".repeat(Math.ceil(MAX_TEXT_ATTACHMENT_BYTES / 3)),
        []
      ),
    ChatLimitError
  )
})

test("file names remain distinct and the count limit preserves existing files", () => {
  let files: FileUIPart[] = []
  for (let index = 0; index < MAX_TEXT_ATTACHMENTS; index++)
    files = addTextAttachment(String(index), files)
  assert.equal(
    new Set(files.map((file) => file.filename)).size,
    MAX_TEXT_ATTACHMENTS
  )
  assert.throws(() => addTextAttachment("Extra", files), ChatLimitError)
  assert.equal(files.length, MAX_TEXT_ATTACHMENTS)
})

test("rejects remote URLs, unsupported MIME types, invalid base64 and invalid UTF-8", () => {
  const file = addTextAttachment("valid", [])[0]
  for (const invalid of [
    { ...file, url: "https://example.com/private.txt" },
    { ...file, mediaType: "text/html" },
    { ...file, url: "data:text/plain;base64,!!!!" },
    { ...file, url: "data:text/plain;base64,/w==" },
  ])
    assert.throws(() => readTextAttachment(invalid), ChatLimitError)
})

test("backend converts the full attachment to model text and keeps the original UI file", async () => {
  const text = "\ufeff中文 😀\r\n".repeat(3000)
  const files = addTextAttachment(text, [])
  const messages: ChatUIMessage[] = [
    {
      id: "u",
      role: "user",
      parts: [...files, { type: "text", text: "Summarize" }],
    },
  ]
  validateChatLimits(messages)
  const context = await prepareChatContext(
    messages,
    getModelInputBudget(DEFAULT_MODEL)
  )
  assert.equal(context.messages[0].parts[0].type, "file")
  const content = context.modelMessages[0].content
  assert.ok(Array.isArray(content))
  assert.ok(
    content.some((part) => part.type === "text" && part.text.endsWith(text))
  )
  assert.ok(!content.some((part) => part.type === "file"))
  assert.ok(estimateConversationTokens(messages) > 12_000)
  assert.ok(getContextUsage([], DEFAULT_MODEL, undefined, "", files) > 12_000)
})
