import type { FileUIPart } from "ai"

import type { ChatUIMessage } from "@/tools"
import {
  characterCount,
  ChatLimitError,
  MAX_INPUT_CHARACTERS,
} from "./chat-limits"

export const MAX_TEXT_ATTACHMENT_BYTES = 512 * 1024
export const MAX_TEXT_ATTACHMENTS = 4
const DATA_PREFIX = "data:text/plain;base64,"
export const TEXT_FILE_ACCEPT = ".txt,.md,.csv,.json,.log"

export interface UploadedText {
  name: string
  text: string
}

function isTextFilename(name: string) {
  return (
    characterCount(name) <= 200 &&
    !/[\x00-\x1f\x7f/\\]/.test(name) &&
    /\.(txt|md|csv|json|log)$/i.test(name)
  )
}

export async function readUploadedTextFiles(
  files: File[]
): Promise<UploadedText[]> {
  if (files.length > MAX_TEXT_ATTACHMENTS)
    throw new ChatLimitError("You can attach up to 4 text files per message.")
  return Promise.all(
    files.map(async (file) => {
      if (!isTextFilename(file.name))
        throw new ChatLimitError(
          "Choose a TXT, Markdown, CSV, JSON or LOG file.",
          400
        )
      if (file.size > MAX_TEXT_ATTACHMENT_BYTES)
        throw new ChatLimitError("Text attachments must be 512 KiB or smaller.")
      let text: string
      try {
        text = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(await file.arrayBuffer())
      } catch {
        throw new ChatLimitError(`${file.name} is not valid UTF-8 text.`, 400)
      }
      return { name: file.name, text }
    })
  )
}

export interface TextPrompt {
  text: string
  files: FileUIPart[]
}

export function readTextAttachment(file: FileUIPart) {
  if (
    file.mediaType !== "text/plain" ||
    !file.url.startsWith(DATA_PREFIX) ||
    !isTextFilename(file.filename ?? "")
  ) {
    throw new ChatLimitError(
      "Only inline UTF-8 text attachments are supported.",
      400
    )
  }
  const encoded = file.url.slice(DATA_PREFIX.length)
  if (encoded.length > Math.ceil(MAX_TEXT_ATTACHMENT_BYTES / 3) * 4) {
    throw new ChatLimitError("Text attachments must be 512 KiB or smaller.")
  }
  try {
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
      throw new Error("Invalid base64")
    const bytes = Uint8Array.from(atob(encoded), (character) =>
      character.charCodeAt(0)
    )
    if (bytes.byteLength > MAX_TEXT_ATTACHMENT_BYTES)
      throw new ChatLimitError("Text attachments must be 512 KiB or smaller.")
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes
    )
  } catch (error) {
    if (error instanceof ChatLimitError) throw error
    throw new ChatLimitError(
      "The text attachment is not valid UTF-8 text.",
      400
    )
  }
}

export function addTextAttachment(
  text: string,
  files: FileUIPart[],
  name = "pasted-text.txt"
) {
  if (files.length >= MAX_TEXT_ATTACHMENTS)
    throw new ChatLimitError("You can attach up to 4 text files per message.")
  const bytes = new TextEncoder().encode(text)
  if (!isTextFilename(name))
    throw new ChatLimitError(
      "Choose a TXT, Markdown, CSV, JSON or LOG file.",
      400
    )
  if (bytes.byteLength > MAX_TEXT_ATTACHMENT_BYTES)
    throw new ChatLimitError("Text attachments must be 512 KiB or smaller.")
  let number = 1
  let filename = name
  const dot = name.lastIndexOf(".")
  while (files.some((file) => file.filename === filename)) {
    filename = `${name.slice(0, dot)}-${++number}${name.slice(dot)}`
  }
  if (!isTextFilename(filename))
    throw new ChatLimitError("The attachment filename is too long.", 400)
  let binary = ""
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192))
  }
  const file: FileUIPart = {
    type: "file",
    mediaType: "text/plain",
    filename,
    url: DATA_PREFIX + btoa(binary),
  }
  return [...files, file]
}

export function prepareTextPrompt(
  input: string,
  files: FileUIPart[]
): TextPrompt {
  const asAttachment = characterCount(input) >= MAX_INPUT_CHARACTERS
  const prepared = asAttachment
    ? { text: "", files: addTextAttachment(input, files) }
    : { text: input.trim(), files }
  if (!prepared.text && !prepared.files.length)
    throw new ChatLimitError("Enter a message or add a text attachment.", 400)
  if (prepared.files.length > MAX_TEXT_ATTACHMENTS)
    throw new ChatLimitError("You can attach up to 4 text files per message.")
  prepared.files.forEach(readTextAttachment)
  return prepared
}

export function attachmentToText(file: FileUIPart) {
  return {
    type: "text" as const,
    text: `Attached text file: ${file.filename}\n\n${readTextAttachment(file)}`,
  }
}

/** Decode only inline text data; never fetch a client-supplied file URL. */
export function normalizeTextAttachments(
  messages: ChatUIMessage[]
): ChatUIMessage[] {
  return messages.map((message) =>
    message.role === "user"
      ? {
          ...message,
          parts: message.parts.map((part) =>
            part.type === "file" ? attachmentToText(part) : part
          ),
        }
      : message
  )
}
