// Transport and input limits are separate from each model's token window.
export const MAX_INPUT_CHARACTERS = 12_000
export const MAX_REQUEST_BYTES = 8 * 1024 * 1024
export const MAX_TOOL_OUTPUT_BYTES = 16 * 1024

export class ChatLimitError extends Error {
  constructor(
    message: string,
    readonly status = 413
  ) {
    super(message)
    this.name = "ChatLimitError"
  }
}

export function characterCount(text: string) {
  return Array.from(text).length
}

export function jsonBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

// A conservative local estimate, not a provider tokenizer. API usage calibrates
// the UI after a reply; generation leaves additional room for estimation error.
export function estimateTokens(value: unknown) {
  return Math.ceil(jsonBytes(value) / 3)
}

/** Keep a contiguous suffix of complete user-led rounds, including tool chains. */
export function compactConversation<T extends { role: string }>(
  messages: T[],
  { maxBytes = Infinity, maxRounds = Infinity, maxTokens = Infinity } = {}
) {
  const starts = messages.flatMap((message, index) =>
    message.role === "user" ? [index] : []
  )

  if (starts.length === 0 || starts[0] !== 0) {
    throw new ChatLimitError(
      "A conversation must start with a user message.",
      400
    )
  }

  let start = starts.at(-1)!
  // Compute suffix sizes once so long histories are scanned in linear time.
  const suffixBytes = new Array<number>(messages.length + 1)
  suffixBytes[messages.length] = 2 // JSON array brackets
  for (let index = messages.length - 1; index >= 0; index--) {
    suffixBytes[index] =
      suffixBytes[index + 1] +
      jsonBytes(messages[index]) +
      (index < messages.length - 1 ? 1 : 0)
  }
  const fits = (index: number) => {
    const bytes = suffixBytes[index]
    return bytes <= maxBytes && Math.ceil(bytes / 3) <= maxTokens
  }
  if (!fits(start)) {
    throw new ChatLimitError(
      "The current conversation turn is too large. Shorten your message or start a new chat."
    )
  }

  let rounds = 1
  for (
    let index = starts.length - 2;
    index >= 0 && rounds < maxRounds;
    index--
  ) {
    const candidate = starts[index]
    if (!fits(candidate)) break
    start = candidate
    rounds++
  }

  return { messages: messages.slice(start), removedMessages: start }
}
