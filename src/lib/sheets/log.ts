/**
 * Writing to and reading back from "PCSJ Quiz Log".
 *
 * The Sheet is the system's only durable store, so this module is both the
 * logger and the repository: an attempt submitted this morning is self-scored
 * this evening by reading its rows back, recomputing and updating in place.
 *
 * Reconstructing a question for a later self-score prefers the in-process
 * registry and falls back to the Questions tab's `json` column, which is why
 * that lossless copy is written on import.
 */

import { cachedQuiz } from "../quiz/registry";
import type { ImportedQuiz } from "../quiz/registry";
import { totalsFor, type ScoredAttempt, type ScoredResponse } from "../quiz/score";
import { questionMarks, round2, type Question } from "../quiz/types";
import {
  ATTEMPTS_TAB,
  QUESTIONS_TAB,
  QUIZZES_TAB,
  RESPONSES_TAB,
  TABS,
  type TabSpec,
} from "./columns";
import {
  appendRows,
  ensureTabs,
  findRows,
  updateRowsAt,
  upsertRows,
} from "./client";
import {
  attemptRow,
  questionRows,
  quizRow,
  responseRow,
  type AttemptMode,
  type AttemptRecord,
  type Device,
  type SheetRow,
} from "./rows";

function tab(title: string): TabSpec {
  const found = TABS.find((spec) => spec.title === title);
  if (!found) throw new Error(`Unknown tab ${title}`);
  return found;
}

/**
 * Upserts a quiz's Quizzes and Questions rows. Idempotent by key, so
 * re-importing the same file creates no duplicate rows, and a corrected file
 * overwrites the rows of the question ids it keeps.
 */
export async function logQuizImport(
  sheetId: string,
  quiz: ImportedQuiz,
): Promise<void> {
  await ensureTabs(sheetId);
  await upsertRows(sheetId, tab(QUIZZES_TAB), [quizRow(quiz)]);
  await upsertRows(sheetId, tab(QUESTIONS_TAB), questionRows(quiz));
}

export interface AttemptSubmission {
  attemptId: string;
  setId: string;
  candidate: string;
  startedAt: string;
  submittedAt: string;
  durationSec: number;
  mode: AttemptMode;
  negativeMarking: number;
  device: Device;
}

/**
 * Writes one Attempts row and N Responses rows. Upserted rather than blindly
 * appended so a retried submission (the client queue may send the same attempt
 * twice after an outage) cannot double-log it.
 */
export async function logAttempt(
  sheetId: string,
  submission: AttemptSubmission,
  questions: readonly Question[],
  scored: ScoredAttempt,
): Promise<void> {
  await ensureTabs(sheetId);

  const record: AttemptRecord = { ...submission };
  const byId = new Map(questions.map((q) => [q.id, q]));
  const rows: SheetRow[] = [];
  for (const response of scored.responses) {
    const question = byId.get(response.question_id);
    if (question) rows.push(responseRow(record, question, response));
  }

  await upsertRows(sheetId, tab(ATTEMPTS_TAB), [attemptRow(record, scored)]);
  await upsertRows(sheetId, tab(RESPONSES_TAB), rows);
}

/** A Responses row read back, with enough to recompute a score. */
interface StoredResponse {
  rowNumber: number;
  record: Record<string, string>;
}

function parseNumberList(value: string): number[] {
  return value
    .split(/[,\s]+/)
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0);
}

function toScoredResponse(record: Record<string, string>): ScoredResponse {
  const chosen = (record.chosen_answer ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const correct = (record.correct_answer ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const base: ScoredResponse = {
    question_id: record.question_id ?? "",
    question_number: Number(record.question_number ?? 0) || 0,
    type: record.type === "subjective" ? "subjective" : "mcq",
    result: (record.result ?? "skipped") as ScoredResponse["result"],
    score: Number(record.score ?? 0) || 0,
    max_marks: Number(record.max_marks ?? 0) || 0,
    chosen,
    correct_answer: correct,
    text: record.subjective_text ?? "",
    points_ticked: parseNumberList(record.points_ticked ?? ""),
    time_spent_sec: Number(record.time_spent_sec ?? 0) || 0,
    changed_answer: (record.changed_answer ?? "").toUpperCase() === "TRUE",
    marked_for_review: (record.marked_for_review ?? "").toUpperCase() === "TRUE",
  };
  if (record.confidence === "sure" || record.confidence === "guess") {
    base.confidence = record.confidence;
  }
  return base;
}

/**
 * The question objects of a set, from the registry if it is still cached, else
 * rebuilt from the Questions tab's lossless json column.
 */
async function questionsForSet(
  sheetId: string,
  setId: string,
): Promise<Question[]> {
  const cached = cachedQuiz(setId);
  if (cached) return cached.set.questions;

  const rows = await findRows(sheetId, tab(QUESTIONS_TAB), "set_id", setId);
  const questions: Question[] = [];
  for (const { record } of rows) {
    if (!record.json) continue;
    try {
      questions.push(JSON.parse(record.json) as Question);
    } catch {
      // A hand-edited json cell should not take down a self-score; the row is
      // skipped and its stored score stands.
    }
  }
  questions.sort((a, b) => a.number - b.number);
  return questions;
}

export interface SelfScoreUpdate {
  questionId: string;
  pointsTicked: number[];
  revisitFlag?: boolean;
  notes?: string;
}

export interface SelfScoreResult {
  updatedQuestionIds: string[];
  totals: ScoredAttempt["totals"];
}

/**
 * Applies self-scores (and the candidate's revisit flag or note) to an
 * attempt's Responses rows, then recomputes the Attempts totals from every
 * stored response — not just the ones changed here, so scoring three questions
 * in three sittings still lands on the right total.
 */
export async function applySelfScores(
  sheetId: string,
  attemptId: string,
  updates: readonly SelfScoreUpdate[],
): Promise<SelfScoreResult> {
  await ensureTabs(sheetId);

  const responsesTab = tab(RESPONSES_TAB);
  const stored: StoredResponse[] = await findRows(
    sheetId,
    responsesTab,
    "attempt_id",
    attemptId,
  );
  if (stored.length === 0) {
    throw new Error(`No responses logged for attempt ${attemptId}.`);
  }

  const setId = stored[0]!.record.set_id ?? "";
  const questions = await questionsForSet(sheetId, setId);
  if (questions.length === 0) {
    // Without the question set there is no rubric to score against and no
    // max_score to recompute. Carrying on would rewrite the Attempts row with
    // a maximum of zero and destroy the candidate's totals, so stop here: the
    // stored scores stay as they are and the caller reports the problem.
    throw new Error(
      `Cannot self-score attempt ${attemptId}: no questions found for set ` +
        `${setId}. Re-import the quiz so its Questions rows are restored.`,
    );
  }
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const updateById = new Map(updates.map((u) => [u.questionId, u]));

  const attemptMeta = await findRows(
    sheetId,
    tab(ATTEMPTS_TAB),
    "attempt_id",
    attemptId,
  );
  const attemptRecord = attemptMeta[0];

  const record: AttemptRecord = {
    attemptId,
    setId,
    candidate: stored[0]!.record.candidate ?? "",
    startedAt: attemptRecord?.record.started_at ?? "",
    submittedAt: attemptRecord?.record.submitted_at ?? "",
    durationSec: Number(attemptRecord?.record.duration_sec ?? 0) || 0,
    mode: attemptRecord?.record.mode === "timed" ? "timed" : "practice",
    negativeMarking: Number(attemptRecord?.record.negative_marking ?? 0) || 0,
    device: attemptRecord?.record.device === "desktop" ? "desktop" : "mobile",
  };

  const rowUpdates: { rowNumber: number; row: SheetRow }[] = [];
  const allResponses: ScoredResponse[] = [];
  const updatedQuestionIds: string[] = [];

  for (const { rowNumber, record: stored_record } of stored) {
    const response = toScoredResponse(stored_record);
    const update = updateById.get(response.question_id);
    const question = questionById.get(response.question_id);

    if (!update || !question || question.type !== "subjective") {
      allResponses.push(response);
      continue;
    }

    const ticked = [...new Set(update.pointsTicked)].filter(
      (index) => index >= 0 && index < (question.marking_points?.length ?? 0),
    );
    const points = question.marking_points ?? [];
    const sum = ticked.reduce(
      (total, index) => total + (points[index]?.marks ?? 0),
      0,
    );
    const scored: ScoredResponse = {
      ...response,
      points_ticked: ticked,
      // An answer the candidate left blank stays skipped even if points arrive.
      result: response.text.trim().length === 0 ? "skipped" : "self_scored",
      score:
        response.text.trim().length === 0
          ? 0
          : round2(Math.min(sum, questionMarks(question))),
    };

    allResponses.push(scored);
    updatedQuestionIds.push(response.question_id);
    rowUpdates.push({
      rowNumber,
      row: responseRow(record, question, scored, {
        revisitFlag:
          update.revisitFlag ??
          (stored_record.revisit_flag ?? "").toUpperCase() === "TRUE",
        notes: update.notes ?? stored_record.notes ?? "",
      }),
    });
  }

  await updateRowsAt(sheetId, responsesTab, rowUpdates);

  const totals = totalsFor({ questions }, allResponses);
  if (attemptRecord) {
    await updateRowsAt(sheetId, tab(ATTEMPTS_TAB), [
      {
        rowNumber: attemptRecord.rowNumber,
        row: attemptRow(record, { responses: allResponses, totals }),
      },
    ]);
  }

  return { updatedQuestionIds, totals };
}

/** The candidate's most recent percent per set, for the quiz-list cards. */
export async function lastScoresByCandidate(
  sheetId: string,
  candidate: string,
): Promise<Map<string, { percent: number; submittedAt: string }>> {
  const rows = await findRows(
    sheetId,
    tab(ATTEMPTS_TAB),
    "candidate",
    candidate,
  );
  const latest = new Map<string, { percent: number; submittedAt: string }>();
  for (const { record } of rows) {
    const setId = record.set_id ?? "";
    const submittedAt = record.submitted_at ?? "";
    const existing = latest.get(setId);
    if (!existing || submittedAt > existing.submittedAt) {
      latest.set(setId, {
        percent: Number(record.percent ?? 0) || 0,
        submittedAt,
      });
    }
  }
  return latest;
}

/** Everything the review screen needs for an attempt logged earlier. */
export async function readAttempt(
  sheetId: string,
  attemptId: string,
): Promise<{
  record: Record<string, string>;
  responses: ScoredResponse[];
  stored: StoredResponse[];
} | null> {
  await ensureTabs(sheetId);
  const attempts = await findRows(
    sheetId,
    tab(ATTEMPTS_TAB),
    "attempt_id",
    attemptId,
  );
  if (attempts.length === 0) return null;
  const stored = await findRows(
    sheetId,
    tab(RESPONSES_TAB),
    "attempt_id",
    attemptId,
  );
  return {
    record: attempts[0]!.record,
    responses: stored.map(({ record }) => toScoredResponse(record)),
    stored,
  };
}

export { appendRows, ensureTabs };
