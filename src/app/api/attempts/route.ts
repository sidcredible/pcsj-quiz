/**
 * POST /api/attempts
 *
 * Scores an attempt and logs it. The body carries only what the candidate did;
 * the answer key, the scoring and every total stay here, which is what makes
 * the attempt screen's redacted payload sufficient.
 *
 * The response is the review payload, so the review screen needs no second
 * request and the client can keep it for an offline review.
 */

import { NextResponse } from "next/server";
import { scoreAttempt } from "@/lib/quiz/score";
import { buildReview } from "@/lib/quiz/review";
import { logAttempt } from "@/lib/sheets/log";
import { handle, jsonError, readJsonObject } from "@/lib/server/http";
import { loadQuiz, requireConfig } from "@/lib/server/quiz-service";
import { parseSubmission } from "@/lib/server/submission";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const config = requireConfig();
    const body = await readJsonObject(request);
    const submission = parseSubmission(body, config.defaultNegativeMarking);

    const quiz = await loadQuiz(submission.setId);
    if (!quiz) {
      return jsonError(
        "Quiz not found",
        404,
        `No quiz with set_id ${submission.setId}; it may have left the Drive folder.`,
      );
    }

    const submittedAt = new Date().toISOString();
    const startedAt = submission.startedAt;
    const durationMs = Date.parse(submittedAt) - Date.parse(startedAt);
    // A clock-skewed or malformed started_at must not produce a negative
    // duration in the Sheet.
    const durationSec = Number.isFinite(durationMs)
      ? Math.max(0, Math.round(durationMs / 1000))
      : 0;

    const scored = scoreAttempt(
      quiz.set,
      submission.answers,
      submission.negativeMarking,
    );

    const record = {
      attemptId: submission.attemptId,
      setId: quiz.set.set_id,
      candidate: submission.candidate,
      startedAt,
      submittedAt,
      durationSec,
      mode: submission.mode,
      negativeMarking: submission.negativeMarking,
      device: submission.device,
    };

    // The write is awaited: the client queue needs a definite answer about
    // whether this attempt is safely logged, and retries if it is not.
    await logAttempt(config.sheetId, record, quiz.set.questions, scored);

    return NextResponse.json(
      {
        review: buildReview(quiz.set, scored, {
          attemptId: submission.attemptId,
          candidate: submission.candidate,
          submittedAt,
          mode: submission.mode,
          negativeMarking: submission.negativeMarking,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return handle(error);
  }
}
