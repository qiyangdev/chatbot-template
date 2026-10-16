# chatbot-template

A minimal chatbot template built with Next.js, the [AI SDK](https://ai-sdk.dev), [shadcn/ui](https://ui.shadcn.com), [shadcn/react](https://ui.shadcn.com/docs/react/message-scroller), [shadcn/typeset](https://ui.shadcn.com/docs/typeset) and the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway).

<p>
  <a href="https://github.com/shadcn-ui/chatbot-template/stargazers"><img src="https://shieldcn.dev/github/stars/shadcn-ui/chatbot-template.svg?variant=secondary&size=xs" alt="GitHub stars" /></a>
  <a href="https://github.com/shadcn-ui/chatbot-template/forks"><img src="https://shieldcn.dev/github/forks/shadcn-ui/chatbot-template.svg?variant=secondary&size=xs" alt="GitHub forks" /></a>
  <a href="https://github.com/shadcn-ui/chatbot-template/blob/main/LICENSE"><img src="https://shieldcn.dev/github/license/shadcn-ui/chatbot-template.svg?variant=secondary&size=xs" alt="License" /></a>
</p>

## Features

- Streaming chat with markdown rendering and shadcn/typeset
- Tool calling example
- Web search via each provider's built-in search tool
- Human-in-the-loop questionnaire. The model can ask clarifying questions, answered with the shadcn questionnaire component

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fshadcn-ui%2Fchatbot-template&project-name=chatbot-template&repository-name=chatbot-template)

That's it — no configuration needed. Vercel deployments authenticate to the AI Gateway automatically via OIDC, and usage runs on your team's [AI Gateway credits](https://vercel.com/docs/ai-gateway/pricing).

## Local development

```bash
pnpm install
```

Then give the app a gateway credential, either by pulling an OIDC token from your linked Vercel project:

```bash
vercel link
vercel env pull
```

or by creating an API key in the Vercel dashboard (**AI Gateway → API Keys**) and adding it to `.env.local`:

```bash
cp .env.example .env.local
# then set AI_GATEWAY_API_KEY=...
```

Start the dev server:

```bash
pnpm dev
```

## Configuration

| Env var              | Required       | Description                                                  |
| -------------------- | -------------- | ------------------------------------------------------------ |
| `AI_GATEWAY_API_KEY` | Local dev only | AI Gateway API key. Not needed on Vercel deployments (OIDC). |

The model list lives in [lib/models.ts](lib/models.ts) — the first entry is the default model.

## Security

The `/api/chat` route is **public and unauthenticated** — every request spends your AI Gateway credits. That's fine for a personal demo, but before putting it in front of real traffic you should:

- **Rate limit it.** Add [Vercel Firewall / WAF](https://vercel.com/docs/security/vercel-waf) rules or [`@upstash/ratelimit`](https://github.com/upstash/ratelimit-js) so a single client can't drain your credits (denial-of-wallet).
- **Cap spend.** Set an [AI Gateway spend limit](https://vercel.com/docs/ai-gateway/observability-and-spend/budgets) as a backstop.
- **Add auth** if the chatbot isn't meant to be public.

The route already validates the request body, restricts models to [lib/models.ts](lib/models.ts), caps output tokens and step count, and aborts generation on client disconnect — but those bound a single request, not overall volume.

## How it works

### Input and context limits

- Pasted or typed text reaching 12,000 Unicode code points becomes a `pasted-text.txt` attachment. Cards support preview and removal; short instructions can accompany files, and file-only messages are supported.
- The attachment button to the left of the model selector opens an upload menu for TXT, Markdown, CSV, JSON and LOG files. Each message can contain up to four pasted or uploaded text attachments, each at most 512 KiB of UTF-8 text. Uploads preserve their filenames; duplicate names receive numbered suffixes. The server accepts only validated inline text attachments, decodes their full contents into model text, and never fetches client-supplied file URLs. Attachments remain file cards in chat history and count toward the model context budget.
- The chat route reads at most 8 MiB of request data, including requests without a `Content-Length` header. Oversized requests return HTTP 413. This transport limit is independent of the model's context window.
- Context is budgeted against each model's actual token window in `lib/models.ts`, verified against the Gateway model catalog. There is no fixed 64 KiB or 20-round history cutoff. The server checks the converted model messages before each tool-loop step, reserving 8,192 output tokens, 4,096 tool tokens and 10% estimation headroom.
- Older rounds leave the model context as a whole; tool calls, results, and questionnaire continuations stay together. A current round that cannot fit is rejected instead of being truncated.
- All messages remain visible. A shadcn Marker labeled `Conversation compacted` marks the start of the retained context after the server accepts compaction. Forgotten rounds are not sent again on subsequent requests.
- Custom tool results are limited to 16 KiB. Questionnaires contain at most three questions, with answers limited to 2,000 characters each.

The ring uses the selected model's full token window as its denominator. On completion, the latest model call's reported input plus output tokens calibrate its usage; cumulative billed tokens across tool steps are not added together. Drafts, ongoing streams and model switches use a local estimate. Local estimates are not provider tokenization; provider-internal tool context can differ, so the tooltip remains labeled estimated. Compaction removes old rounds; it does not generate a summary.

Run `pnpm test` to check request limits, complete-round compaction, and tool continuation boundaries.

- [app/api/chat/route.ts](app/api/chat/route.ts) streams responses with `streamText`
- [components/chat.tsx](components/chat.tsx) renders the conversation with `useChat` and shadcn chat primitives.
- [tools/](tools) defines the tools — one file per tool (the filename is the model-facing tool name), composed in [tools/index.ts](tools/index.ts): a server-executed GitHub repo lookup, the interactive `ask_user` questionnaire, and provider-native web search.

## Tool parts

Assistant messages are a list of typed parts. [components/chat-message.tsx](components/chat-message.tsx) switches on `part.type` and delegates each one to a component in [components/parts/](components/parts):

| Part type          | Component                                                          | Renders                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`             | [text-part.tsx](components/parts/text-part.tsx)                   | Markdown via react-markdown and shadcn/typeset.                                                                                                |
| `tool-github_repo` | [github-repo-part.tsx](components/parts/github-repo-part.tsx)     | A spinner while the lookup runs, then a linked stat line (stars, forks, language).                                                             |
| `tool-web_search`  | [web-search-part.tsx](components/parts/web-search-part.tsx)       | A "Searching the web…" status while the search runs, then a persistent "Searched the web" line per search.                                     |
| `tool-ask_user`    | [ask-user-part.tsx](components/parts/ask-user-part.tsx)           | The answered questions inline. Pending questions render in [question-card.tsx](components/question-card.tsx), pinned to the scroller bottom.   |
| `source-url`       | [sources-part.tsx](components/parts/sources-part.tsx)             | Web search citations, deduped into a "Searched N websites" drawer once the message finishes streaming.                                         |

Tool parts move through states as the stream progresses — `input-streaming` → `input-available` → `output-available` (or `output-error`) — and each component switches on `part.state` to show progress, results, and failures.

### Adding your own tool

1. Create `tools/<name>.ts` (the filename is the model-facing tool name) exporting a `tool()` with a `description`, an `inputSchema`, and an `execute` function (omit `execute` for tools the user answers in the UI, like `ask_user`), then register it in [tools/index.ts](tools/index.ts).
2. Add a part component in [components/parts/](components/parts) and a `case "tool-<name>"` in [chat-message.tsx](components/chat-message.tsx).

Message types are inferred from the tool definitions via `InferUITools`, so `part.input` and `part.output` are fully typed in your part component — renaming a tool field is a build error, not a silent `undefined`.

## Adding components

```bash
npx shadcn@latest add button
```

## License

MIT — see [LICENSE](LICENSE).
