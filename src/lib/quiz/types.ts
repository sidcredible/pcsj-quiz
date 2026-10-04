/**
 * Types mirroring schema/set.schema.json (draft 2020-12, schema_version 1.1).
 *
 * The generator owns this contract; the app only reads it. Every field the
 * schema marks optional is optional here too, so rendering code must treat a
 * missing field as empty rather than assuming a shape.
 */

export const SCHEMA_VERSION = "1.1" as const;

export type ExamFocus = "DJS" | "UP-PCSJ";

export type QuestionType = "mcq" | "subjective";

export type McqStyle =
  | "direct"
  | "fact_based"
  | "statement_based"
  | "assertion_reason"
  | "match_list"
  | "case_based"
  | "numerical";

export type SubjectiveStyle =
  | "problem"
  | "short_note"
  | "essay"
  | "short_answer"
  | "one_word"
  | "judgment_writing"
  | "drafting"
  | "explain";

export type Basis =
  | "pyq"
  | "pyq_inspired"
  | "new"
  | "judgment_based"
  | "recent_development";

export type ResourceKind =
  | "bare_act"
  | "judgment"
  | "case_report"
  | "commentary"
  | "official";

export interface KeyedText {
  key: string;
  text: string;
}

export interface Provision {
  act: string;
  section: string;
  old_law_equivalent?: string | null;
  note?: string;
}

export interface CaseRef {
  name: string;
  court: string;
  decided: string;
  citation?: string | null;
  bench?: string | null;
  point: string;
}

export interface Resource {
  title: string;
  url: string;
  kind: ResourceKind;
}

export interface MarkingPoint {
  point: string;
  marks: number;
}

export interface MatchLists {
  list_i_title?: string;
  list_ii_title?: string;
  list_i: KeyedText[];
  list_ii: KeyedText[];
}

export interface Explanation {
  why_correct: string;
  why_others_wrong?: Record<string, string>;
  model_answer?: string;
  provisions: Provision[];
  cases?: CaseRef[];
  exam_tip?: string;
}

export interface PyqRef {
  pyq_id: string;
  exam: ExamFocus;
  stage: "prelims" | "mains";
  year: number;
  paper?: string;
  q_no?: number | string;
}

export interface PyqOriginal {
  question: string;
  options?: KeyedText[] | null;
  source_answer?: string[] | null;
  source_answer_status?: string;
}

export interface Adaptation {
  adapted: boolean;
  note?: string;
}

export interface AnswerProvenance {
  method:
    | "official_key"
    | "publisher_key_confirmed"
    | "publisher_key_disputed"
    | "author_verified";
  publisher_answer?: string[] | null;
  note?: string;
}

export interface Verification {
  status: "verified" | "partially_verified";
  checked_against: string[];
  note?: string;
}

/** A question exactly as it appears in the file, answer key included. */
export interface Question {
  id: string;
  number: number;
  type: QuestionType;
  mcq_style?: McqStyle;
  subjective_style?: SubjectiveStyle;
  basis: Basis;
  basis_refs?: string[];
  exam_focus?: ExamFocus[];
  subject_code: string;
  topic: string;
  tags?: string[];
  question: string;
  statements?: KeyedText[];
  assertion?: string;
  reason?: string;
  match?: MatchLists;
  options?: KeyedText[];
  answer: string[] | null;
  marks?: number;
  word_limit?: number;
  marking_points?: MarkingPoint[];
  explanation: Explanation;
  resources: Resource[];
  source_pyqs?: PyqRef[];
  pyq_original?: PyqOriginal;
  adaptation?: Adaptation;
  answer_provenance?: AnswerProvenance;
  verification: Verification;
}

export interface Composition {
  requested: number;
  pyq: number;
  judgment: number;
  generated: number;
  total: number;
  pyq_candidates_reviewed?: number;
  excluded_pyqs?: { pyq_id: string; reason: string }[];
  note?: string;
}

export interface QuizRequest {
  topic: string;
  question_count: number;
  question_types?: QuestionType[];
  exam_focus?: ExamFocus[];
  sources_requested?: string[];
}

export interface PyqAnalysis {
  related_pyqs?: string[];
  pattern_notes?: string;
}

/** A whole quiz file, answer keys included. Server-side only. */
export interface QuizSet {
  schema_version: "1.1";
  set_id: string;
  created: string;
  title?: string;
  request: QuizRequest;
  law_basis: string;
  pyq_analysis?: PyqAnalysis;
  composition: Composition;
  questions: Question[];
}

/** MCQ default when `marks` is absent, per handbook section 5. */
export const DEFAULT_MCQ_MARKS = 1;

/** The marks a question is worth, applying the MCQ default. */
export function questionMarks(q: Pick<Question, "type" | "marks">): number {
  if (typeof q.marks === "number") return q.marks;
  return q.type === "mcq" ? DEFAULT_MCQ_MARKS : 0;
}

/** Maximum score for a quiz: computed from the file, never assumed. */
export function maxMarks(questions: Pick<Question, "type" | "marks">[]): number {
  return round2(questions.reduce((sum, q) => sum + questionMarks(q), 0));
}

/** Max marks counting only questions of one type. */
export function maxMarksOfType(
  questions: Pick<Question, "type" | "marks">[],
  type: QuestionType,
): number {
  return maxMarks(questions.filter((q) => q.type === type));
}

/**
 * Rounds to 2 decimals. `marks` may be decimal (1.5, 0.25 negative marking),
 * so sums need to shed float noise before they reach a score or the Sheet.
 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function hasSubjective(questions: Pick<Question, "type">[]): boolean {
  return questions.some((q) => q.type === "subjective");
}

/** The style field that applies, whichever type this is. */
export function questionStyle(q: Question): string {
  return (q.type === "mcq" ? q.mcq_style : q.subjective_style) ?? "";
}

export function quizHeading(set: Pick<QuizSet, "title" | "request">): string {
  return set.title?.trim() || set.request.topic;
}
