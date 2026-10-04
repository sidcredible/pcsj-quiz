/**
 * Strips everything a candidate must not see until they submit.
 *
 * The acceptance checklist requires that no answer, explanation or rubric is
 * visible "including in page source / network payload" before submit. The only
 * way to guarantee that is to never send those fields: the attempt screen is
 * fed `CandidateQuiz` objects built here, and the full `QuizSet` stays on the
 * server. Scoring therefore also happens on the server (see lib/quiz/score).
 *
 * Dropped before submit: answer, explanation, marking_points, pyq_original,
 * answer_provenance, verification, basis_refs, composition audit fields.
 * Kept: the stem and its presentation fields, marks, word_limit, and enough
 * provenance for the "PYQ · DJS Prelims 2019" badge the handbook asks for.
 */

import {
  hasSubjective,
  maxMarks,
  maxMarksOfType,
  questionMarks,
  quizHeading,
  type Composition,
  type ExamFocus,
  type KeyedText,
  type MatchLists,
  type McqStyle,
  type Question,
  type QuestionType,
  type QuizSet,
  type SubjectiveStyle,
} from "./types";

/** A PYQ badge: enough to render "DJS Prelims 2019", nothing more. */
export interface PyqBadge {
  exam: ExamFocus;
  stage: "prelims" | "mains";
  year: number;
}

export interface CandidateQuestion {
  id: string;
  number: number;
  type: QuestionType;
  mcq_style?: McqStyle;
  subjective_style?: SubjectiveStyle;
  subject_code: string;
  topic: string;
  tags?: string[];
  exam_focus?: ExamFocus[];
  question: string;
  statements?: KeyedText[];
  assertion?: string;
  reason?: string;
  match?: MatchLists;
  options?: KeyedText[];
  marks: number;
  word_limit?: number;
  /** True when more than one option is correct, so the UI uses checkboxes. */
  multi_select: boolean;
  /** Present only when basis = pyq. */
  pyq_badges?: PyqBadge[];
}

/** The composition summary shown to candidates: counts only, no audit trail. */
export type CandidateComposition = Pick<
  Composition,
  "requested" | "pyq" | "judgment" | "generated" | "total"
>;

export interface CandidateQuizSummary {
  set_id: string;
  heading: string;
  topic: string;
  created: string;
  exam_focus: ExamFocus[];
  question_types: QuestionType[];
  question_count: number;
  max_marks: number;
  mcq_max_marks: number;
  subjective_max_marks: number;
  has_subjective: boolean;
  subject_codes: string[];
}

export interface CandidateQuiz extends CandidateQuizSummary {
  law_basis: string;
  pattern_notes?: string;
  composition: CandidateComposition;
  questions: CandidateQuestion[];
}

function redactQuestion(q: Question): CandidateQuestion {
  const out: CandidateQuestion = {
    id: q.id,
    number: q.number,
    type: q.type,
    subject_code: q.subject_code,
    topic: q.topic,
    question: q.question,
    marks: questionMarks(q),
    multi_select: (q.answer?.length ?? 0) > 1,
  };

  // Optional presentation fields are copied only when present, so the payload
  // carries no empty keys and the renderer can test for existence.
  if (q.mcq_style) out.mcq_style = q.mcq_style;
  if (q.subjective_style) out.subjective_style = q.subjective_style;
  if (q.tags?.length) out.tags = q.tags;
  if (q.exam_focus?.length) out.exam_focus = q.exam_focus;
  if (q.statements?.length) out.statements = q.statements;
  if (q.assertion) out.assertion = q.assertion;
  if (q.reason) out.reason = q.reason;
  if (q.match) out.match = q.match;
  if (q.options?.length) out.options = q.options;
  if (typeof q.word_limit === "number") out.word_limit = q.word_limit;

  if (q.basis === "pyq" && q.source_pyqs?.length) {
    out.pyq_badges = q.source_pyqs.map((p) => ({
      exam: p.exam,
      stage: p.stage,
      year: p.year,
    }));
  }

  return out;
}

/** Everything the quiz-list card needs, with no question content at all. */
export function toSummary(set: QuizSet): CandidateQuizSummary {
  const types = [...new Set(set.questions.map((q) => q.type))].sort();
  return {
    set_id: set.set_id,
    heading: quizHeading(set),
    topic: set.request.topic,
    created: set.created,
    exam_focus: set.request.exam_focus ?? [],
    question_types: types,
    question_count: set.questions.length,
    max_marks: maxMarks(set.questions),
    mcq_max_marks: maxMarksOfType(set.questions, "mcq"),
    subjective_max_marks: maxMarksOfType(set.questions, "subjective"),
    has_subjective: hasSubjective(set.questions),
    subject_codes: [...new Set(set.questions.map((q) => q.subject_code))].sort(),
  };
}

/** The attempt payload: full stems, zero answer key. */
export function toCandidateQuiz(set: QuizSet): CandidateQuiz {
  return {
    ...toSummary(set),
    law_basis: set.law_basis,
    ...(set.pyq_analysis?.pattern_notes
      ? { pattern_notes: set.pyq_analysis.pattern_notes }
      : {}),
    composition: {
      requested: set.composition.requested,
      pyq: set.composition.pyq,
      judgment: set.composition.judgment,
      generated: set.composition.generated,
      total: set.composition.total,
    },
    questions: set.questions.map(redactQuestion),
  };
}

/** "50 questions: 16 previous-year, 14 from judgments, 20 new" */
export function compositionLine(
  composition: CandidateComposition,
  questionCount: number,
): string {
  const parts: string[] = [];
  if (composition.pyq > 0) parts.push(`${composition.pyq} previous-year`);
  if (composition.judgment > 0) {
    parts.push(`${composition.judgment} from judgments`);
  }
  if (composition.generated > 0) parts.push(`${composition.generated} new`);
  const label = `${questionCount} question${questionCount === 1 ? "" : "s"}`;
  return parts.length > 0 ? `${label}: ${parts.join(", ")}` : label;
}

/**
 * Suggested minutes for a quiz. A setting rather than a constant, per the
 * handbook: 1 minute per MCQ plus 1 minute per 10 words of `word_limit`.
 */
export interface TimingSettings {
  minutesPerMcq: number;
  minutesPerSubjectiveWords: number;
  wordsPerMinuteUnit: number;
}

export const DEFAULT_TIMING: TimingSettings = {
  minutesPerMcq: 1,
  minutesPerSubjectiveWords: 1,
  wordsPerMinuteUnit: 10,
};

export function suggestedMinutes(
  questions: Pick<CandidateQuestion, "type" | "word_limit" | "marks">[],
  settings: TimingSettings = DEFAULT_TIMING,
): number {
  let minutes = 0;
  for (const q of questions) {
    if (q.type === "mcq") {
      minutes += settings.minutesPerMcq;
    } else {
      // A subjective item with no word limit still needs time; fall back to a
      // minute per mark so a 10-mark essay is not budgeted at zero.
      const words = q.word_limit;
      minutes +=
        typeof words === "number"
          ? (words / settings.wordsPerMinuteUnit) *
            settings.minutesPerSubjectiveWords
          : Math.max(1, q.marks);
    }
  }
  return Math.max(1, Math.ceil(minutes));
}
