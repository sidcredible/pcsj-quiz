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
import { buildReview, type AttemptReview } from "../quiz/review";
import { questionMarks, round2, type Question, type QuizSet } from "../quiz/types";
import {
  ATTEMPTS_TAB,
  QUESTIONS_TAB,
  QUIZZES_TAB,
  RESPONSES_TAB,
  TABS,
  type TabSpec,
} from "./columns";
import { sheetSink } from "./sink";
import {
  attemptRow,
  questionRows,
  quizRow,
  responseId,
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
  const sink = sheetSink();
  await sink.ensureTabs(sheetId);
  await sink.upsertRows(sheetId, tab(QUIZZES_TAB), [quizRow(quiz)]);
  await sink.upsertRows(sheetId, tab(QUESTIONS_TAB), questionRows(quiz));
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

export interface LogAttemptResult {
  /** False when this attempt was already fully logged, so nothing was written. */
  written: boolean;
  responsesAppended: number;
}

/**
 * Writes one Attempts row and N Responses rows.
 *
 * An attempt is submitted once, but the client queue may send it more than
 * once: the same attempt_id arrives again after an outage, a double tap or a
 * reopened tab. Such a retry must change nothing that has happened since, so
 * rows already present are left strictly alone and only missing ones are
 * added.
 *
 * Overwriting instead would be actively destructive: between the first submit
 * and the retry the candidate may have self-scored a written answer, and
 * rewriting that row with the submission's own "pending_self_score" would
 * throw the self-score away and leave the attempt totals wrong.
 */
export async function logAttempt(
  sheetId: string,
  submission: AttemptSubmission,
  questions: readonly Question[],
  scored: ScoredAttempt,
): Promise<LogAttemptResult> {
  const sink = sheetSink();
  await sink.ensureTabs(sheetId);

  const record: AttemptRecord = { ...submission };
  const byId = new Map(questions.map((q) => [q.id, q]));

  const [existingAttempt, existingResponses] = await Promise.all([
    sink.findRows(sheetId, tab(ATTEMPTS_TAB), "attempt_id", record.attemptId),
    sink.findRows(sheetId, tab(RESPONSES_TAB), "attempt_id", record.attemptId),
  ]);
  const loggedResponseIds = new Set(
    existingResponses.map(({ record: row }) => row.response_id ?? ""),
  );

  // Only rows this attempt does not already have. A first submit writes all of
  // them; a retry usually writes none, and a retry after a partial failure
  // writes exactly the ones that never landed.
  const rows: SheetRow[] = [];
  for (const response of scored.responses) {
    const question = byId.get(response.question_id);
    if (!question) continue;
    if (loggedResponseIds.has(responseId(record.attemptId, question.id))) continue;
    rows.push(responseRow(record, question, response));
  }

  if (existingAttempt.length === 0) {
    await sink.upsertRows(sheetId, tab(ATTEMPTS_TAB), [attemptRow(record, scored)]);
  }
  await sink.upsertRows(sheetId, tab(RESPONSES_TAB), rows);

  return {
    written: existingAttempt.length === 0 || rows.length > 0,
    responsesAppended: rows.length,
  };
}

/** A Responses row read back, with enough to recompute a score. */
interface StoredResponse {
  rowNumber: number;
  record: Record<string, string>;
}

/**
 * Reads a "0, 2" cell back into rubric indexes.
 *
 * The empty cell is the case that matters: splitting "" yields [""], and
 * Number("") is 0, so a naive parse reports that marking point 0 was credited
 * on every question nobody scored. That is invented marks — it shows a
 * candidate a tick they never made, and any later recomputation builds on it.
 */
function parseNumberList(value: string): number[] {
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => Number(part))
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

  const rows = await sheetSink().findRows(
    sheetId,
    tab(QUESTIONS_TAB),
    "set_id",
    setId,
  );
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
  const sink = sheetSink();
  await sink.ensureTabs(sheetId);

  const responsesTab = tab(RESPONSES_TAB);
  const stored: StoredResponse[] = await sink.findRows(
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

  const attemptMeta = await sink.findRows(
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

  await sink.updateRowsAt(sheetId, responsesTab, rowUpdates);

  const totals = totalsFor({ questions }, allResponses);
  if (attemptRecord) {
    await sink.updateRowsAt(sheetId, tab(ATTEMPTS_TAB), [
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
  const rows = await sheetSink().findRows(
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
  const sink = sheetSink();
  await sink.ensureTabs(sheetId);
  const attempts = await sink.findRows(
    sheetId,
    tab(ATTEMPTS_TAB),
    "attempt_id",
    attemptId,
  );
  if (attempts.length === 0) return null;
  const stored = await sink.findRows(
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

export interface AttemptSummary {
  attempt_id: string;
  set_id: string;
  candidate: string;
  submitted_at: string;
  mode: string;
  total_score: number;
  max_score: number;
  percent: number;
  correct: number;
  wrong: number;
  skipped: number;
}

/**
 * Every logged attempt, newest first.
 *
 * Reads the Attempts tab only — one narrow request — because the home page
 * needs the headline numbers, not the fifty response rows behind each.
 */
export async function listAttempts(
  sheetId: string,
  options: { candidate?: string; limit?: number } = {},
): Promise<AttemptSummary[]> {
  const sink = sheetSink();
  await sink.ensureTabs(sheetId);
  const rows = await sink.readTab(sheetId, tab(ATTEMPTS_TAB));

  const summaries = rows
    .filter((row) => (row.attempt_id ?? "") !== "")
    .filter((row) =>
      options.candidate ? (row.candidate ?? "") === options.candidate : true,
    )
    .map((row) => ({
      attempt_id: row.attempt_id ?? "",
      set_id: row.set_id ?? "",
      candidate: row.candidate ?? "",
      submitted_at: row.submitted_at ?? "",
      mode: row.mode ?? "practice",
      total_score: Number(row.total_score ?? 0) || 0,
      max_score: Number(row.max_score ?? 0) || 0,
      percent: Number(row.percent ?? 0) || 0,
      correct: Number(row.correct ?? 0) || 0,
      wrong: Number(row.wrong ?? 0) || 0,
      skipped: Number(row.skipped ?? 0) || 0,
    }));

  // ISO-8601 timestamps sort lexically, so newest-first needs no parsing. A
  // row with no timestamp sorts last rather than scrambling the order.
  summaries.sort((a, b) => {
    if (!a.submitted_at) return 1;
    if (!b.submitted_at) return -1;
    return a.submitted_at < b.submitted_at ? 1 : -1;
  });

  return options.limit ? summaries.slice(0, options.limit) : summaries;
}

/**
 * Rebuilds a complete review of a past attempt from the log alone.
 *
 * The Questions tab's lossless `json` column is what makes this possible: the
 * quiz is reconstructed exactly as it was when the attempt happened, so an
 * attempt reopened months later shows the same explanations, rubric and
 * provenance it showed on the day — even if the quiz file has since left the
 * Drive folder.
 */
export async function loadAttemptReview(
  sheetId: string,
  attemptId: string,
): Promise<{ review: AttemptReview; heading: string } | null> {
  const stored = await readAttempt(sheetId, attemptId);
  if (!stored) return null;

  const setId = stored.record.set_id ?? "";
  const questions = await questionsForSet(sheetId, setId);
  if (questions.length === 0) return null;

  const byId = new Map(stored.responses.map((r) => [r.question_id, r]));
  const responses = questions.map(
    (q) =>
      byId.get(q.id) ?? {
        question_id: q.id,
        question_number: q.number,
        type: q.type,
        result: "skipped" as const,
        score: 0,
        max_marks: questionMarks(q),
        chosen: [],
        correct_answer: q.answer ?? [],
        text: "",
        points_ticked: [],
        time_spent_sec: 0,
        changed_answer: false,
        marked_for_review: false,
      },
  );

  const totals = totalsFor({ questions }, responses);
  const set = await quizSetFor(sheetId, setId, questions);

  return {
    review: buildReview(
      set,
      { responses, totals },
      {
        attemptId,
        candidate: stored.record.candidate ?? "",
        submittedAt: stored.record.submitted_at ?? "",
        mode: stored.record.mode === "timed" ? "timed" : "practice",
        negativeMarking: Number(stored.record.negative_marking ?? 0) || 0,
      },
    ),
    heading: set.title || set.request.topic || setId,
  };
}

/**
 * The quiz a past attempt belongs to: the cached file when it is still in
 * Drive, otherwise one assembled from the Quizzes row and the stored
 * questions, so a retired quiz still reviews correctly.
 */
async function quizSetFor(
  sheetId: string,
  setId: string,
  questions: Question[],
): Promise<QuizSet> {
  const cached = cachedQuiz(setId);
  if (cached) return cached.set;

  const rows = await sheetSink().findRows(
    sheetId,
    tab(QUIZZES_TAB),
    "set_id",
    setId,
  );
  const row = rows[0]?.record ?? {};
  return {
    schema_version: "1.1",
    set_id: setId,
    created: row.created ?? "",
    ...(row.title ? { title: row.title } : {}),
    request: {
      topic: row.topic ?? setId,
      question_count: Number(row.requested ?? questions.length) || questions.length,
    },
    law_basis: row.law_basis ?? "",
    composition: {
      requested: Number(row.requested ?? 0) || 0,
      pyq: Number(row.pyq ?? 0) || 0,
      judgment: Number(row.judgment ?? 0) || 0,
      generated: Number(row.generated ?? 0) || 0,
      total: questions.length,
    },
    questions,
  };
}
