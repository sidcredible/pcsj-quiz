"use client";

/**
 * The review screen's per-question feedback.
 *
 * MCQ: options marked green for correct and red for a wrong pick, with
 * why_others_wrong shown under the option it explains, looked up by key.
 * Subjective: the candidate's own text, the model answer, and the rubric as a
 * checklist they tick to self-score.
 */

import { useState } from "react";
import type { AttemptReview, ReviewItem } from "@/lib/quiz/review";
import { QuestionBody, QuestionMeta } from "./QuestionBody";
import { Badge, Muted, QuizText, ResourceLink } from "./primitives";

const RESULT_LABEL: Record<string, string> = {
  correct: "Correct",
  wrong: "Wrong",
  skipped: "Skipped",
  pending_self_score: "Awaiting self-score",
  self_scored: "Self-scored",
};

const RESULT_COLOR: Record<string, string> = {
  correct: "var(--correct)",
  wrong: "var(--wrong)",
  skipped: "var(--muted)",
  pending_self_score: "var(--flag)",
  self_scored: "var(--correct)",
};

function McqFeedback({ item }: { item: ReviewItem }) {
  const { question, response, feedback } = item;
  const correct = new Set(response.correct_answer);
  const chosen = new Set(response.chosen);

  return (
    <div className="mt-4 space-y-2">
      {(question.options ?? []).map((option) => {
        const isCorrect = correct.has(option.key);
        const pickedWrong = chosen.has(option.key) && !isCorrect;
        const why = feedback.why_others_wrong?.[option.key];

        return (
          <div
            key={option.key}
            className="option cursor-default flex-col"
            data-verdict={isCorrect ? "correct" : pickedWrong ? "wrong" : undefined}
          >
            <div className="flex w-full gap-2">
              <span className="option-key">({option.key})</span>
              <QuizText className="flex-1">{option.text}</QuizText>
              <span className="flex-none text-xs font-semibold">
                {isCorrect ? (
                  <span style={{ color: "var(--correct)" }}>correct</span>
                ) : null}
                {pickedWrong ? (
                  <span style={{ color: "var(--wrong)" }}>your answer</span>
                ) : null}
              </span>
            </div>
            {why && !isCorrect ? (
              <QuizText className="mt-1.5 w-full pl-7 text-sm">{why}</QuizText>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SubjectiveFeedback({
  item,
  ticked,
  onTick,
  disabled,
}: {
  item: ReviewItem;
  ticked: number[];
  onTick: (indexes: number[]) => void;
  disabled: boolean;
}) {
  const { response, feedback } = item;
  const tickedSet = new Set(ticked);
  const scored = feedback.marking_points.reduce(
    (sum, point, index) => (tickedSet.has(index) ? sum + point.marks : sum),
    0,
  );

  function toggle(index: number) {
    onTick(
      tickedSet.has(index)
        ? ticked.filter((i) => i !== index)
        : [...ticked, index].sort((a, b) => a - b),
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide">
          <Muted>Your answer</Muted>
        </h4>
        {response.text.trim() ? (
          <QuizText className="mt-1 card px-3 py-2 text-sm">
            {response.text}
          </QuizText>
        ) : (
          <p className="mt-1 text-sm">
            <Muted>You did not answer this question.</Muted>
          </p>
        )}
      </section>

      {feedback.model_answer ? (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide">
            <Muted>Model answer</Muted>
          </h4>
          <QuizText className="prose-legal mt-1 text-sm">
            {feedback.model_answer}
          </QuizText>
        </section>
      ) : null}

      {feedback.marking_points.length > 0 ? (
        <section>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide">
              <Muted>Marking points — tick what your answer covered</Muted>
            </h4>
            <span className="text-xs tabular-nums">
              <Muted>
                {Math.round(scored * 100) / 100} / {item.question.marks}
              </Muted>
            </span>
          </div>
          <ul className="space-y-1.5">
            {feedback.marking_points.map((point, index) => (
              <li key={index}>
                <label
                  className="option"
                  data-selected={tickedSet.has(index)}
                >
                  <input
                    type="checkbox"
                    checked={tickedSet.has(index)}
                    onChange={() => toggle(index)}
                    disabled={disabled}
                    className="mt-1 flex-none"
                  />
                  <QuizText className="flex-1 text-sm">{point.point}</QuizText>
                  <span className="flex-none text-xs tabular-nums">
                    <Muted>{point.marks}</Muted>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Explanation({ feedback }: { feedback: ReviewItem["feedback"] }) {
  const [showOriginal, setShowOriginal] = useState(false);

  return (
    <div className="mt-4 space-y-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide">
          <Muted>Why this is right</Muted>
        </h4>
        <QuizText className="mt-1 text-sm">{feedback.why_correct}</QuizText>
      </section>

      {feedback.provisions.length > 0 ? (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide">
            <Muted>Provisions</Muted>
          </h4>
          <ul className="mt-1 space-y-0.5 text-sm">
            {feedback.provisions.map((provision, index) => (
              <li key={index}>
                {provision.act} <strong>{provision.section}</strong>
                {provision.old_law_equivalent ? (
                  <Muted> (old: {provision.old_law_equivalent})</Muted>
                ) : null}
                {provision.note ? <QuizText className="text-sm">{provision.note}</QuizText> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {feedback.cases.length > 0 ? (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide">
            <Muted>Cases</Muted>
          </h4>
          <ul className="mt-1 space-y-1 text-sm">
            {feedback.cases.map((caseRef, index) => (
              <li key={index}>
                <span className="prose-legal italic">{caseRef.name}</span>
                <Muted>
                  {" "}
                  — {caseRef.court}, {caseRef.decided}
                  {caseRef.citation ? `, ${caseRef.citation}` : ""}
                </Muted>
                <QuizText className="text-sm">{caseRef.point}</QuizText>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {feedback.exam_tip ? (
        <p
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--accent-soft)" }}
        >
          <strong>Tip. </strong>
          {feedback.exam_tip}
        </p>
      ) : null}

      {feedback.resources.length > 0 ? (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide">
            <Muted>Read more</Muted>
          </h4>
          <ul className="mt-1 space-y-0.5 text-sm">
            {feedback.resources.map((resource) => (
              <li key={resource.url}>
                <ResourceLink href={resource.url} title={resource.title} />{" "}
                <Muted>· {resource.kind.replace(/_/g, " ")}</Muted>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {feedback.pyq_original ? (
        <section>
          <button
            type="button"
            className="text-sm underline underline-offset-2"
            style={{ color: "var(--accent)" }}
            onClick={() => setShowOriginal((value) => !value)}
            aria-expanded={showOriginal}
          >
            {showOriginal ? "Hide original PYQ" : "Show original PYQ"}
          </button>
          {showOriginal ? (
            <div className="mt-2 card px-3 py-2">
              <QuizText className="text-sm">{feedback.pyq_original.question}</QuizText>
              {feedback.pyq_original.adaptation_note ? (
                <p className="mt-1.5 text-xs">
                  <Muted>Adapted: {feedback.pyq_original.adaptation_note}</Muted>
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export function ReviewList({
  review,
  ticks,
  onTick,
  savingQuestionIds,
}: {
  review: AttemptReview;
  ticks: Record<string, number[]>;
  onTick: (questionId: string, indexes: number[]) => void;
  savingQuestionIds: Set<string>;
}) {
  return (
    <ol className="space-y-4">
      {review.items.map((item) => {
        const { question, response } = item;
        return (
          <li key={question.id} className="card px-3 py-4 sm:px-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <QuestionMeta question={question} />
              <span
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: RESULT_COLOR[response.result] }}
              >
                {RESULT_LABEL[response.result] ?? response.result}
                {response.result !== "skipped" ? (
                  <span className="tabular-nums">
                    {" "}
                    · {response.score} / {response.max_marks}
                  </span>
                ) : null}
              </span>
            </div>

            <QuestionBody question={question} />

            {question.type === "mcq" ? (
              <McqFeedback item={item} />
            ) : (
              <SubjectiveFeedback
                item={item}
                ticked={ticks[question.id] ?? response.points_ticked}
                onTick={(indexes) => onTick(question.id, indexes)}
                disabled={savingQuestionIds.has(question.id)}
              />
            )}

            <Explanation feedback={item.feedback} />

            {response.marked_for_review ? (
              <p className="mt-3">
                <Badge>was marked for review</Badge>
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
