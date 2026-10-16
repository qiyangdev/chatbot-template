import { ChatLimitError, MAX_REQUEST_BYTES } from "./chat-limits"

/** Enforce the limit while reading, even for requests without Content-Length. */
export async function readLimitedJson(req: Request, limit = MAX_REQUEST_BYTES) {
  const tooLarge = () => new ChatLimitError("The chat request is too large.")
  if (Number(req.headers.get("content-length")) > limit) {
    await req.body?.cancel()
    throw tooLarge()
  }
  if (!req.body) throw new SyntaxError("Missing JSON body")

  const reader = req.body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  const chunks: string[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) {
        await reader.cancel()
        throw tooLarge()
      }
      chunks.push(decoder.decode(value, { stream: true }))
    }
    chunks.push(decoder.decode())
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  return JSON.parse(chunks.join("")) as unknown
}
