/**
 * GET /api/quizzes
 *
 * The quiz list. Returns summaries only — no stems, let alone answers — plus
 * the candidate's last score per quiz when a candidate is named, and the
 * rejected files for the admin panel.
 *
 * ?refresh=1 forces a Drive re-scan, which is what the Refresh button sends.
 */

import { NextResponse } from "next/server";
import { toSummary } from "@/lib/quiz/redact";
import { lastScoresByCandidate } from "@/lib/sheets/log";
import { handle } from "@/lib/server/http";
import { requireConfig, syncQuizzes } from "@/lib/server/quiz-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get("refresh") === "1";
    const candidate = url.searchParams.get("candidate")?.trim() ?? "";

    const config = requireConfig();
    const snapshot = await syncQuizzes(force);

    let lastScores: Record<string, { percent: number; submitted_at: string }> = {};
    if (candidate) {
      // A Sheet read failure must not empty the quiz list; the cards simply
      // show no previous score.
      try {
        const scores = await lastScoresByCandidate(config.sheetId, candidate);
        lastScores = Object.fromEntries(
          [...scores].map(([setId, value]) => [
            setId,
            { percent: value.percent, submitted_at: value.submittedAt },
          ]),
        );
      } catch (error) {
        console.error("Could not read previous scores:", error);
      }
    }

    return NextResponse.json({
      quizzes: snapshot.quizzes.map((quiz) => ({
        ...toSummary(quiz.set),
        warnings: quiz.warnings,
      })),
      rejected: snapshot.rejected,
      scanned_at: snapshot.scannedAt,
      ...(snapshot.scanError ? { scan_error: snapshot.scanError } : {}),
      last_scores: lastScores,
    });
  } catch (error) {
    return handle(error);
  }
}
