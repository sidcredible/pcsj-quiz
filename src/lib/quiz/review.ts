/**
 * The review payload: everything hidden during the attempt, released once the
 * candidate has submitted.
 *
 * Built on the server from the full QuizSet plus the scored responses, so the
 * browser receives the answer key only after it can no longer affect the
 * result.
 */

import type { ScoredAttempt, ScoredResponse } from "./score";
import {
  questionStyle,
  type CaseRef,
  type MarkingPoint,
  type Provision,
  type Question,
  type QuizSet,
  type Resource,
} from "./types";
import { toSummary, type CandidateQuestion, type CandidateQuizSummary } from "./redact";
import { compositionLine } from "./redact";

export interface ReviewFeedback {
  why_correct: string;
  why_others_wrong?: Record<string, string>;
  model_answer?: string;
  provisions: Provision[];
  cases: CaseRef[];
  exam_tip?: string;
  resources: Resource[];
  marking_points: MarkingPoint[];
  /** The original printed form of a PYQ, for the "see original" toggle. */
  pyq_original?: { question: string; adaptation_note?: string };
}

export interface ReviewItem {
  question: CandidateQuestion & { style: string; basis: Question["basis"] };
  response: ScoredResponse;
  feedback: ReviewFeedback;
}

export interface AttemptReview {
  attempt_id: string;
  candidate: string;
  submitted_at: string;
  mode: "practice" | "timed";
  negative_marking: number;
  quiz: CandidateQuizSummary & { composition_line: string };
  totals: ScoredAttempt["totals"];
  items: ReviewItem[];
}

/** The attempt-time view of a question, plus the fields review needs. */
function reviewQuestion(q: Question): ReviewItem["question"] {
  const out: ReviewItem["question"] = {
    id: q.id,
    number: q.number,
    type: q.type,
    subject_code: q.subject_code,
    topic: q.topic,
    question: q.question,
    marks: q.marks ?? (q.type === "mcq" ? 1 : 0),
    multi_select: (q.answer?.length ?? 0) > 1,
    style: questionStyle(q),
    basis: q.basis,
  };
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

function feedbackFor(q: Question): ReviewFeedback {
  const feedback: ReviewFeedback = {
    why_correct: q.explanation.why_correct,
    provisions: q.explanation.provisions,
    cases: q.explanation.cases ?? [],
    resources: q.resources ?? [],
    marking_points: q.marking_points ?? [],
  };
  if (q.explanation.why_others_wrong) {
    feedback.why_others_wrong = q.explanation.why_others_wrong;
  }
  if (q.explanation.model_answer) {
    feedback.model_answer = q.explanation.model_answer;
  }
  if (q.explanation.exam_tip) feedback.exam_tip = q.explanation.exam_tip;
  if (q.pyq_original) {
    feedback.pyq_original = {
      question: q.pyq_original.question,
      ...(q.adaptation?.note ? { adaptation_note: q.adaptation.note } : {}),
    };
  }
  return feedback;
}

export interface ReviewContext {
  attemptId: string;
  candidate: string;
  submittedAt: string;
  mode: "practice" | "timed";
  negativeMarking: number;
}

export function buildReview(
  set: QuizSet,
  scored: ScoredAttempt,
  context: ReviewContext,
): AttemptReview {
  const byId = new Map(set.questions.map((q) => [q.id, q]));
  const items: ReviewItem[] = [];

  for (const response of scored.responses) {
    const question = byId.get(response.question_id);
    if (!question) continue;
    items.push({
      question: reviewQuestion(question),
      response,
      feedback: feedbackFor(question),
    });
  }

  const summary = toSummary(set);
  return {
    attempt_id: context.attemptId,
    candidate: context.candidate,
    submitted_at: context.submittedAt,
    mode: context.mode,
    negative_marking: context.negativeMarking,
    quiz: {
      ...summary,
      composition_line: compositionLine(
        set.composition,
        set.questions.length,
      ),
    },
    totals: scored.totals,
    items,
  };
}
