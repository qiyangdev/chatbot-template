import { tool } from "ai"
import { z } from "zod"

import { jsonBytes, MAX_TOOL_OUTPUT_BYTES } from "@/lib/chat-limits"

export const askUser = tool({
  description:
    "Ask the user clarifying questions when their request is ambiguous. Provide one or more questions, each with exactly 3 short, distinct answer choices. The user can also answer in their own words.",
  inputSchema: z.object({
    questions: z
      .array(
        z.object({
          question: z.string().max(300).describe("The question to ask"),
          choices: z
            .array(z.string().max(200))
            .length(3)
            .describe("Exactly three short answer choices"),
        })
      )
      .min(1)
      .max(3)
      .describe("The questions to ask the user"),
  }),
  outputSchema: z
    .array(
      z.object({ question: z.string().max(300), answer: z.string().max(2000) })
    )
    .min(1)
    .max(3)
    .refine((output) => jsonBytes(output) <= MAX_TOOL_OUTPUT_BYTES, {
      message: "The answers are too large. Shorten your answers.",
    })
    .describe("The user's answer to each question"),
})
