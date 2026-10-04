/**
 * Turns quizzes, questions and scored attempts into Sheet rows.
 *
 * Pure functions: no Sheets client here, so the column mapping of handbook
 * section 8 is testable without touching Google. Every row is built from the
 * tab's column list in order, via a keyed record, so a column can be added
 * without re-counting positions.
 *
 * Multi-value cells join with "\n" (or ", " for short lists) because the Sheet
 * is meant to be read and pivoted by a person, and the lossless copy of each
 * question lives in the `json` column regardless.
 */

import type { ImportedQuiz } from "../quiz/registry";
import {
  maxMarks,
  questionStyle,
  questionMarks,
  type Question,
  type QuizSet,
} from "../quiz/types";
import type { ScoredAttempt, ScoredResponse } from "../quiz/score";
import {
  ATTEMPTS_COLUMNS,
  QUESTIONS_COLUMNS,
  QUIZZES_COLUMNS,
  RESPONSES_COLUMNS,
} from "./columns";

export type CellValue = string | number | boolean;
export type SheetRow = CellValue[];

function row(
  columns: readonly string[],
  values: Record<string, CellValue | undefined>,
): SheetRow {
  return columns.map((column) => values[column] ?? "");
}

const JOIN = "\n";

function joinList(values: readonly string[] | undefined, sep = ", "): string {
  return (values ?? []).join(sep);
}

/**
 * The stem plus every presentation block, flattened to readable text, so the
 * Questions tab shows the whole question without needing the json column.
 */
export function flattenQuestionText(q: Question): string {
  const blocks: string[] = [q.question];

  if (q.statements?.length) {
    blocks.push(q.statements.map((s) => `${s.key}. ${s.text}`).join(JOIN));
  }
  if (q.assertion) blocks.push(`Assertion (A): ${q.assertion}`);
  if (q.reason) blocks.push(`Reason (R): ${q.reason}`);

  if (q.match) {
    const listI = [
      q.match.list_i_title ?? "List I",
      ...q.match.list_i.map((item) => `${item.key}. ${item.text}`),
    ].join(JOIN);
    const listII = [
      q.match.list_ii_title ?? "List II",
      ...q.match.list_ii.map((item) => `${item.key}. ${item.text}`),
    ].join(JOIN);
    blocks.push(listI, listII);
  }

  return blocks.join(JOIN + JOIN);
}

/** Looks up an option's text by key, for the option_a..option_e columns. */
function optionText(q: Question, key: string): string {
  return q.options?.find((o) => o.key === key)?.text ?? "";
}

function markingPointsText(q: Question): string {
  return (q.marking_points ?? [])
    .map((p) => `${p.point} (${p.marks})`)
    .join(JOIN);
}

function whyOthersWrongText(q: Question): string {
  const entries = Object.entries(q.explanation.why_others_wrong ?? {});
  // Sorted so the cell is stable across re-imports and diffs cleanly.
  entries.sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([key, text]) => `${key}: ${text}`).join(JOIN);
}

function provisionsText(q: Question): string {
  return q.explanation.provisions
    .map((p) => {
      const old = p.old_law_equivalent
        ? ` (old: ${p.old_law_equivalent})`
        : "";
      return `${p.act} ${p.section}${old}`;
    })
    .join(JOIN);
}

function casesText(q: Question): string {
  return (q.explanation.cases ?? [])
    .map((c) => `${c.name}, ${c.court}, ${c.decided}`)
    .join(JOIN);
}

function resourcesText(q: Question): string {
  return (q.resources ?? []).map((r) => r.url).join(JOIN);
}

/** "DJS-prelims-2019-Q12", per the handbook's pyq_sources example. */
function pyqSourcesText(q: Question): string {
  return (q.source_pyqs ?? [])
    .map((p) => {
      const parts = [p.exam, p.stage, String(p.year)];
      if (p.q_no !== undefined && p.q_no !== null) parts.push(`Q${p.q_no}`);
      return parts.join("-");
    })
    .join(JOIN);
}

function pyqYearsText(q: Question): string {
  const years = [...new Set((q.source_pyqs ?? []).map((p) => p.year))];
  years.sort((a, b) => a - b);
  return years.join(", ");
}

export function quizRow(quiz: ImportedQuiz): SheetRow {
  const { set } = quiz;
  return row(QUIZZES_COLUMNS, {
    set_id: set.set_id,
    title: set.title ?? "",
    topic: set.request.topic,
    created: set.created,
    exam_focus: joinList(set.request.exam_focus),
    requested: set.composition.requested,
    // The real count, never composition.total, per section 3.
    total: set.questions.length,
    pyq: set.composition.pyq,
    judgment: set.composition.judgment,
    generated: set.composition.generated,
    pyq_candidates_reviewed: set.composition.pyq_candidates_reviewed ?? "",
    excluded_count: set.composition.excluded_pyqs?.length ?? 0,
    max_marks: maxMarks(set.questions),
    law_basis: set.law_basis,
    imported_at: quiz.importedAt,
    file_name: quiz.fileName,
    schema_version: set.schema_version,
  });
}

export function questionRow(set: QuizSet, q: Question): SheetRow {
  return row(QUESTIONS_COLUMNS, {
    question_id: q.id,
    set_id: set.set_id,
    number: q.number,
    type: q.type,
    style: questionStyle(q),
    basis: q.basis,
    subject_code: q.subject_code,
    topic: q.topic,
    tags: joinList(q.tags),
    exam_focus: joinList(q.exam_focus),
    question_text: flattenQuestionText(q),
    option_a: optionText(q, "a"),
    option_b: optionText(q, "b"),
    option_c: optionText(q, "c"),
    option_d: optionText(q, "d"),
    option_e: optionText(q, "e"),
    correct_answer: joinList(q.answer ?? undefined),
    marks: questionMarks(q),
    word_limit: q.word_limit ?? "",
    marking_points: markingPointsText(q),
    why_correct: q.explanation.why_correct,
    model_answer: q.explanation.model_answer ?? "",
    exam_tip: q.explanation.exam_tip ?? "",
    why_others_wrong: whyOthersWrongText(q),
    provisions: provisionsText(q),
    cases: casesText(q),
    resources: resourcesText(q),
    pyq_sources: pyqSourcesText(q),
    pyq_years: pyqYearsText(q),
    adapted_from_old_law: q.adaptation?.adapted ?? "",
    answer_provenance: q.answer_provenance?.method ?? "",
    verification_status: q.verification.status,
    // Lossless backup, so an unknown future field is never lost even though
    // the app ignores it.
    json: JSON.stringify(q),
  });
}

export function questionRows(quiz: ImportedQuiz): SheetRow[] {
  return quiz.set.questions.map((q) => questionRow(quiz.set, q));
}

export type AttemptMode = "practice" | "timed";
export type Device = "mobile" | "desktop";

export interface AttemptRecord {
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

export function attemptRow(
  record: AttemptRecord,
  scored: ScoredAttempt,
): SheetRow {
  const t = scored.totals;
  return row(ATTEMPTS_COLUMNS, {
    attempt_id: record.attemptId,
    set_id: record.setId,
    candidate: record.candidate,
    started_at: record.startedAt,
    submitted_at: record.submittedAt,
    duration_sec: record.durationSec,
    mode: record.mode,
    negative_marking: record.negativeMarking,
    attempted: t.attempted,
    correct: t.correct,
    wrong: t.wrong,
    skipped: t.skipped,
    mcq_score: t.mcq_score,
    subjective_score: t.subjective_score,
    total_score: t.total_score,
    max_score: t.max_score,
    percent: t.percent,
    device: record.device,
  });
}

/** `<attempt_id>_<question_id>`, the Responses key. */
export function responseId(attemptId: string, questionId: string): string {
  return `${attemptId}_${questionId}`;
}

/** The Responses tab is filterable on its own, so question metadata is copied. */
export function responseRow(
  record: AttemptRecord,
  question: Question,
  response: ScoredResponse,
  extras: { revisitFlag?: boolean; notes?: string } = {},
): SheetRow {
  return row(RESPONSES_COLUMNS, {
    response_id: responseId(record.attemptId, question.id),
    attempt_id: record.attemptId,
    set_id: record.setId,
    question_id: question.id,
    candidate: record.candidate,
    answered_at: record.submittedAt,
    question_number: question.number,
    type: question.type,
    style: questionStyle(question),
    basis: question.basis,
    subject_code: question.subject_code,
    topic: question.topic,
    tags: joinList(question.tags),
    // A short copy for readability; the full text lives in Questions.
    question_text: question.question.slice(0, 300),
    chosen_answer: joinList(response.chosen),
    correct_answer: joinList(response.correct_answer),
    result: response.result,
    subjective_text: response.text,
    points_ticked: joinList(response.points_ticked.map(String)),
    score: response.score,
    max_marks: response.max_marks,
    time_spent_sec: response.time_spent_sec,
    changed_answer: response.changed_answer,
    marked_for_review: response.marked_for_review,
    confidence: response.confidence ?? "",
    revisit_flag: extras.revisitFlag ?? false,
    notes: extras.notes ?? "",
  });
}

export function responseRows(
  set: QuizSet,
  record: AttemptRecord,
  scored: ScoredAttempt,
): SheetRow[] {
  const byId = new Map(set.questions.map((q) => [q.id, q]));
  const rows: SheetRow[] = [];
  for (const response of scored.responses) {
    const question = byId.get(response.question_id);
    if (question) rows.push(responseRow(record, question, response));
  }
  return rows;
}
