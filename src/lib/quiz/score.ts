/**
 * Scoring, per handbook section 7. Pure functions over the full QuizSet, run
 * on the server because the answer key never reaches the browser.
 *
 *   MCQ, chosen keys == answer (as a set) -> correct, + marks
 *   MCQ, any other non-empty choice       -> wrong,   - negativeMarking * marks
 *   MCQ, nothing chosen                   -> skipped, 0
 *   Subjective with text                  -> pending_self_score, 0 until ticked
 *   Subjective, empty                      -> skipped, 0
 */

import {
  maxMarksOfType,
  questionMarks,
  round2,
  type Question,
  type QuizSet,
} from "./types";

export type ResponseResult =
  | "correct"
  | "wrong"
  | "skipped"
  | "pending_self_score"
  | "self_scored";

/** What the client sends per question on submit. */
export interface SubmittedAnswer {
  question_id: string;
  /** MCQ: the option keys chosen. Empty or absent means skipped. */
  chosen?: string[];
  /** Subjective: the candidate's written answer. */
  text?: string;
  /** Indexes into marking_points the candidate has ticked, if self-scored. */
  points_ticked?: number[];
  time_spent_sec?: number;
  changed_answer?: boolean;
  marked_for_review?: boolean;
  confidence?: "sure" | "guess";
}

export interface ScoredResponse {
  question_id: string;
  question_number: number;
  type: Question["type"];
  result: ResponseResult;
  score: number;
  max_marks: number;
  chosen: string[];
  correct_answer: string[];
  text: string;
  points_ticked: number[];
  time_spent_sec: number;
  changed_answer: boolean;
  marked_for_review: boolean;
  confidence?: "sure" | "guess";
}

export interface AttemptTotals {
  attempted: number;
  correct: number;
  wrong: number;
  skipped: number;
  mcq_score: number;
  mcq_max: number;
  subjective_score: number;
  subjective_max: number;
  total_score: number;
  max_score: number;
  percent: number;
  pending_self_score: number;
}

export interface ScoredAttempt {
  responses: ScoredResponse[];
  totals: AttemptTotals;
}

/** Set equality: order and duplicates must not change the verdict. */
export function sameKeySet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const key of left) if (!right.has(key)) return false;
  return true;
}

function tickedScore(q: Question, ticked: readonly number[]): number {
  const points = q.marking_points ?? [];
  const unique = [...new Set(ticked)];
  const sum = unique.reduce((total, index) => {
    const point = points[index];
    return point ? total + point.marks : total;
  }, 0);
  // A rubric can only ever award up to the question's marks, even if the file's
  // points over-sum or the client sends a stale index set.
  return round2(Math.min(sum, questionMarks(q)));
}

export function scoreResponse(
  q: Question,
  submitted: SubmittedAnswer | undefined,
  negativeMarking: number,
): ScoredResponse {
  const max = questionMarks(q);
  const base: Omit<ScoredResponse, "result" | "score"> = {
    question_id: q.id,
    question_number: q.number,
    type: q.type,
    max_marks: max,
    chosen: submitted?.chosen ?? [],
    correct_answer: q.answer ?? [],
    text: submitted?.text ?? "",
    points_ticked: submitted?.points_ticked ?? [],
    time_spent_sec: submitted?.time_spent_sec ?? 0,
    changed_answer: submitted?.changed_answer ?? false,
    marked_for_review: submitted?.marked_for_review ?? false,
    ...(submitted?.confidence ? { confidence: submitted.confidence } : {}),
  };

  if (q.type === "mcq") {
    if (base.chosen.length === 0) {
      return { ...base, result: "skipped", score: 0 };
    }
    if (sameKeySet(base.chosen, base.correct_answer)) {
      return { ...base, result: "correct", score: round2(max) };
    }
    return {
      ...base,
      result: "wrong",
      score: round2(-negativeMarking * max),
    };
  }

  if (base.text.trim().length === 0) {
    return { ...base, result: "skipped", score: 0 };
  }
  // A subjective answer is unscored until the candidate ticks rubric points on
  // the review screen; an empty tick list after submit is still "pending".
  if (base.points_ticked.length === 0) {
    return { ...base, result: "pending_self_score", score: 0 };
  }
  return {
    ...base,
    result: "self_scored",
    score: tickedScore(q, base.points_ticked),
  };
}

export function scoreAttempt(
  set: QuizSet,
  submitted: readonly SubmittedAnswer[],
  negativeMarking: number,
): ScoredAttempt {
  const byId = new Map(submitted.map((s) => [s.question_id, s]));
  const responses = set.questions.map((q) =>
    scoreResponse(q, byId.get(q.id), negativeMarking),
  );
  return { responses, totals: totalsFor(set, responses) };
}

export function totalsFor(
  set: Pick<QuizSet, "questions">,
  responses: readonly ScoredResponse[],
): AttemptTotals {
  const mcq = responses.filter((r) => r.type === "mcq");
  const subjective = responses.filter((r) => r.type === "subjective");

  const mcqScore = round2(mcq.reduce((s, r) => s + r.score, 0));
  const subjectiveScore = round2(subjective.reduce((s, r) => s + r.score, 0));
  const mcqMax = maxMarksOfType(set.questions, "mcq");
  const subjectiveMax = maxMarksOfType(set.questions, "subjective");
  const maxScore = round2(mcqMax + subjectiveMax);
  const totalScore = round2(mcqScore + subjectiveScore);

  return {
    // "attempted" counts every question the candidate engaged with, MCQ picks
    // and written subjective answers alike.
    attempted: responses.filter((r) => r.result !== "skipped").length,
    correct: mcq.filter((r) => r.result === "correct").length,
    wrong: mcq.filter((r) => r.result === "wrong").length,
    skipped: responses.filter((r) => r.result === "skipped").length,
    mcq_score: mcqScore,
    mcq_max: mcqMax,
    subjective_score: subjectiveScore,
    subjective_max: subjectiveMax,
    total_score: totalScore,
    max_score: maxScore,
    percent: maxScore > 0 ? round2((totalScore / maxScore) * 100) : 0,
    pending_self_score: responses.filter(
      (r) => r.result === "pending_self_score",
    ).length,
  };
}
