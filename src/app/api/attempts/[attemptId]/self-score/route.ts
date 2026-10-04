/**
 * POST /api/attempts/:attemptId/self-score
 *
 * Applies the candidate's rubric ticks (and their revisit flag or note) to an
 * already-logged attempt, then recomputes that attempt's totals. Works on an
 * attempt from any earlier session, because the Sheet is the store.
 */

import { NextResponse } from "next/server";
import { applySelfScores } from "@/lib/sheets/log";
import { handle, jsonError, readJsonObject } from "@/lib/server/http";
import { requireConfig } from "@/lib/server/quiz-service";
import { parseSelfScores } from "@/lib/server/submission";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  try {
    const config = requireConfig();
    const { attemptId } = await params;
    const body = await readJsonObject(request);
    const updates = parseSelfScores(body);

    const result = await applySelfScores(
      config.sheetId,
      decodeURIComponent(attemptId),
      updates,
    );

    return NextResponse.json({
      updated_question_ids: result.updatedQuestionIds,
      totals: result.totals,
    });
  } catch (error) {
    // An attempt that was never logged is the caller's mistake, not a fault.
    if (
      error instanceof Error &&
      (error.message.includes("No responses logged") ||
        error.message.includes("no questions found for set"))
    ) {
      return jsonError("Cannot self-score", 409, error.message);
    }
    return handle(error);
  }
}
