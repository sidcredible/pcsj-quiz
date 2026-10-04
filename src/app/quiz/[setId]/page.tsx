/**
 * The quiz screen. The payload is fetched on the server and passed to the
 * client flow already redacted, so the answer key is never in the HTML the
 * browser receives either.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { QuizRunner } from "@/components/QuizRunner";
import { Notice } from "@/components/primitives";
import { ConfigError } from "@/lib/config";
import { suggestedMinutes, toCandidateQuiz } from "@/lib/quiz/redact";
import { loadQuiz, NotConfiguredError, requireConfig } from "@/lib/server/quiz-service";

export const dynamic = "force-dynamic";

export default async function QuizPage({
  params,
}: {
  params: Promise<{ setId: string }>;
}) {
  const { setId } = await params;

  let config;
  try {
    config = requireConfig();
  } catch (error) {
    if (error instanceof NotConfiguredError || error instanceof ConfigError) {
      return (
        <div>
          <Notice tone="error">{error.message}</Notice>
          <Link href="/" className="text-sm underline underline-offset-2">
            ← All quizzes
          </Link>
        </div>
      );
    }
    throw error;
  }

  const quiz = await loadQuiz(decodeURIComponent(setId));
  if (!quiz) notFound();

  const candidateQuiz = toCandidateQuiz(quiz.set);
  return (
    <QuizRunner
      quiz={candidateQuiz}
      suggestedMinutes={suggestedMinutes(candidateQuiz.questions)}
      defaultNegativeMarking={config.defaultNegativeMarking}
    />
  );
}
