"use client"

import * as React from "react"
import { jsonBytes, MAX_TOOL_OUTPUT_BYTES } from "@/lib/chat-limits"
import { type AskUserToolPart } from "@/tools"
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire"

export function QuestionCard({
  part,
  onAnswer,
}: {
  part: AskUserToolPart
  onAnswer: (
    toolCallId: string,
    answers: { question: string; answer: string }[]
  ) => void
}) {
  const [answerError, setAnswerError] = React.useState<string>()
  const questions = part.state === "input-available" ? part.input.questions : []

  return (
    <div className="sticky bottom-2 isolate z-50 mx-auto w-full max-w-2xl px-6 pt-2">
      <div className="w-full rounded-3xl bg-popover p-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10">
        {questions.length === 0 ? (
          <div className="flex shimmer items-center gap-2 py-2 text-muted-foreground">
            Preparing a question…
          </div>
        ) : (
          <Questionnaire
            key={part.toolCallId}
            defaultItem="q0"
            items={questions.map((question, index) => ({
              choices: question.choices.map((choice) => ({ value: choice })),
              name: `q${index}`,
              required: true,
            }))}
            onSubmit={(event) => {
              event.preventDefault()
              const formData = new FormData(event.currentTarget)
              const answers = questions.map((question, index) => ({
                question: question.question,
                answer: String(formData.get(`q${index}`) ?? ""),
              }))
              if (jsonBytes(answers) > MAX_TOOL_OUTPUT_BYTES) {
                setAnswerError(
                  "The answers are too large. Shorten your answers."
                )
                return
              }
              setAnswerError(undefined)
              onAnswer(part.toolCallId, answers)
            }}
          >
            {questions.length > 1 && (
              <QuestionnaireProgress className="-mb-4" />
            )}
            {questions.map((question, index) => (
              <QuestionnaireItem key={index} name={`q${index}`} required>
                <QuestionnaireTitle>{question.question}</QuestionnaireTitle>
                <QuestionnaireChoices>
                  {question.choices.map((choice) => (
                    <QuestionnaireChoice key={choice} value={choice}>
                      {choice}
                    </QuestionnaireChoice>
                  ))}
                  <QuestionnaireInput
                    maxLength={2000}
                    aria-label="Another answer"
                    placeholder="Type another answer…"
                  />
                </QuestionnaireChoices>
                <QuestionnaireError />
              </QuestionnaireItem>
            ))}
            <QuestionnaireActions>
              <QuestionnairePrevious />
              <QuestionnaireNext>Next</QuestionnaireNext>
              <QuestionnaireSubmit>Answer</QuestionnaireSubmit>
            </QuestionnaireActions>
            {answerError && (
              <p role="alert" className="text-destructive">
                {answerError}
              </p>
            )}
          </Questionnaire>
        )}
      </div>
    </div>
  )
}
