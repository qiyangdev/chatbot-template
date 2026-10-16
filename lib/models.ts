// See https://vercel.com/ai-gateway/models.
export type ThinkingLevel =
  "provider-default" | "low" | "medium" | "high" | "xhigh" | "max"

export const THINKING_LABELS: Record<ThinkingLevel, string> = {
  "provider-default": "Default",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
}

export const MODELS: GatewayModel[] = [
  // context_window and reasoning_options from https://ai-gateway.vercel.sh/v1/models (2026-10-16).
  {
    id: "anthropic/claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    contextWindow: 1_000_000,
    thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    contextWindow: 1_050_000,
    thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
  },
]

export const DEFAULT_MODEL = MODELS[0].id

export interface GatewayModel {
  id: string
  name: string
  thinkingLevels?: Exclude<ThinkingLevel, "provider-default">[]
  contextWindow: number
}

export const MAX_OUTPUT_TOKENS = 8192
export const TOOL_TOKEN_RESERVE = 4096

export function getModelInputBudget(id: string) {
  const model = MODELS.find((model) => model.id === id)
  if (!model) throw new Error("Unknown model")
  // Leave output, tool definitions and estimation headroom outside history.
  return Math.max(
    1,
    Math.floor(model.contextWindow * 0.9) -
      MAX_OUTPUT_TOKENS -
      TOOL_TOKEN_RESERVE
  )
}

export function isModelAllowed(id: string) {
  return MODELS.some((model) => model.id === id)
}

export function isThinkingLevelAllowed(
  model: GatewayModel | undefined,
  level: unknown
): level is ThinkingLevel {
  return (
    level === "provider-default" ||
    (typeof level === "string" &&
      Boolean(model?.thinkingLevels?.some((item) => item === level)))
  )
}

export function getReasoningOptions(
  modelId: string,
  level: ThinkingLevel
): {
  reasoning?: Exclude<ThinkingLevel, "max">
  providerOptions?: Record<
    string,
    { effort: string } | { reasoningEffort: string }
  >
} {
  // SDK 7's shared reasoning enum does not include the native "max" level.
  if (level === "max") {
    return {
      providerOptions: modelId.startsWith("anthropic/")
        ? { anthropic: { effort: "max" } }
        : { openai: { reasoningEffort: "max" } },
    }
  }
  return { reasoning: level }
}
