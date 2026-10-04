/**
 * GET /api/attempts/:attemptId
 *
 * A past attempt, rebuilt from the log into the same review the candidate saw
 * when they submitted it.
 */

import { NextResponse } from "next/server";
import { loadAttemptReview } from "@/lib/sheets/log";
import { handle, jsonError } from "@/lib/server/http";
import { requireConfig, syncQuizzes } from "@/lib/server/quiz-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  try {
    const config = requireConfig();
    const { attemptId } = await params;

    // Prefer the cached quiz file over rebuilding from the log, so an attempt
    // on a quiz still in Drive reviews against the file itself.
    await syncQuizzes().catch(() => undefined);

    const found = await loadAttemptReview(
      config.sheetId,
      decodeURIComponent(attemptId),
    );
    if (!found) {
      return jsonError(
        "Attempt not found",
        404,
        `No attempt ${attemptId} in the log, or its questions are no longer stored.`,
      );
    }

    return NextResponse.json(found);
  } catch (error) {
    return handle(error);
  }
}
