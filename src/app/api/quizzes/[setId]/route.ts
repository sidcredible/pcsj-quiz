/**
 * GET /api/quizzes/:setId
 *
 * The attempt payload. Served through toCandidateQuiz, so the response
 * contains no answer, explanation, rubric or provenance field — the
 * acceptance checklist's "not even in the network payload" requirement.
 */

import { NextResponse } from "next/server";
import { toCandidateQuiz, suggestedMinutes } from "@/lib/quiz/redact";
import { handle, jsonError } from "@/lib/server/http";
import { loadQuiz, requireConfig } from "@/lib/server/quiz-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ setId: string }> },
) {
  try {
    const config = requireConfig();
    const { setId } = await params;
    const quiz = await loadQuiz(decodeURIComponent(setId));
    if (!quiz) {
      return jsonError("Quiz not found", 404, `No quiz with set_id ${setId}.`);
    }

    const candidateQuiz = toCandidateQuiz(quiz.set);
    return NextResponse.json({
      quiz: candidateQuiz,
      suggested_minutes: suggestedMinutes(candidateQuiz.questions),
      default_negative_marking: config.defaultNegativeMarking,
    });
  } catch (error) {
    return handle(error);
  }
}
