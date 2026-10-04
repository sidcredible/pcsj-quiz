/**
 * The column layout of "PCSJ Quiz Log", exactly as handbook section 8 lists
 * it. Order is the contract: a row is written positionally, and the header row
 * is created from these arrays, so adding a column means appending to the end
 * of the list rather than inserting into the middle.
 */

export const QUIZZES_TAB = "Quizzes";
export const QUESTIONS_TAB = "Questions";
export const ATTEMPTS_TAB = "Attempts";
export const RESPONSES_TAB = "Responses";

export const QUIZZES_COLUMNS = [
  "set_id",
  "title",
  "topic",
  "created",
  "exam_focus",
  "requested",
  "total",
  "pyq",
  "judgment",
  "generated",
  "pyq_candidates_reviewed",
  "excluded_count",
  "max_marks",
  "law_basis",
  "imported_at",
  "file_name",
  "schema_version",
] as const;

export const QUESTIONS_COLUMNS = [
  "question_id",
  "set_id",
  "number",
  "type",
  "style",
  "basis",
  "subject_code",
  "topic",
  "tags",
  "exam_focus",
  "question_text",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "option_e",
  "correct_answer",
  "marks",
  "word_limit",
  "marking_points",
  "why_correct",
  "model_answer",
  "exam_tip",
  "why_others_wrong",
  "provisions",
  "cases",
  "resources",
  "pyq_sources",
  "pyq_years",
  "adapted_from_old_law",
  "answer_provenance",
  "verification_status",
  "json",
] as const;

export const ATTEMPTS_COLUMNS = [
  "attempt_id",
  "set_id",
  "candidate",
  "started_at",
  "submitted_at",
  "duration_sec",
  "mode",
  "negative_marking",
  "attempted",
  "correct",
  "wrong",
  "skipped",
  "mcq_score",
  "subjective_score",
  "total_score",
  "max_score",
  "percent",
  "device",
] as const;

export const RESPONSES_COLUMNS = [
  "response_id",
  "attempt_id",
  "set_id",
  "question_id",
  "candidate",
  "answered_at",
  "question_number",
  "type",
  "style",
  "basis",
  "subject_code",
  "topic",
  "tags",
  "question_text",
  "chosen_answer",
  "correct_answer",
  "result",
  "subjective_text",
  "points_ticked",
  "score",
  "max_marks",
  "time_spent_sec",
  "changed_answer",
  "marked_for_review",
  "confidence",
  "revisit_flag",
  "notes",
] as const;

export interface TabSpec {
  title: string;
  columns: readonly string[];
  /** The column holding the row's primary key; always the first one. */
  keyColumn: string;
}

export const TABS: TabSpec[] = [
  { title: QUIZZES_TAB, columns: QUIZZES_COLUMNS, keyColumn: "set_id" },
  { title: QUESTIONS_TAB, columns: QUESTIONS_COLUMNS, keyColumn: "question_id" },
  { title: ATTEMPTS_TAB, columns: ATTEMPTS_COLUMNS, keyColumn: "attempt_id" },
  { title: RESPONSES_TAB, columns: RESPONSES_COLUMNS, keyColumn: "response_id" },
];

/** 0 -> A, 25 -> Z, 26 -> AA. Sheets ranges are A1-style. */
export function columnLetter(index: number): string {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

/** "Responses!A2:AA" — the data range of a tab, header row excluded. */
export function dataRange(tab: TabSpec): string {
  return `${tab.title}!A2:${columnLetter(tab.columns.length - 1)}`;
}

export function headerRange(tab: TabSpec): string {
  return `${tab.title}!A1:${columnLetter(tab.columns.length - 1)}1`;
}

/** The A1 range of a single row, 1-based including the header. */
export function rowRange(tab: TabSpec, rowNumber: number): string {
  const last = columnLetter(tab.columns.length - 1);
  return `${tab.title}!A${rowNumber}:${last}${rowNumber}`;
}
