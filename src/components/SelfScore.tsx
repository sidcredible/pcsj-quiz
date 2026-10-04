"use client";

/**
 * Scoring your own written answers, before any total is shown.
 *
 * A quiz with subjective questions has no meaningful score until the candidate
 * has judged those answers against the marking points, so the result screen is
 * gated on this rather than opening with a total that counts every written
 * answer as zero.
 *
 * Scoring is explicit per question: ticking nothing is a real verdict ("my
 * answer earned none of these points"), so it cannot be distinguished from
 * "not yet scored" by the ticks alone. Each question is confirmed by hand.
 */

import { useMemo, useState } from "react";
import type { ReviewItem } from "@/lib/quiz/review";
import { QuestionBody, QuestionMeta } from "./QuestionBody";
import { Muted, Notice, PageTitle, QuizText } from "./primitives";

export interface SelfScoreDraft {
  /** Rubric indexes ticked, by question id. */
  ticks: Record<string, number[]>;
  /** Questions the candidate has explicitly finished scoring. */
  scored: string[];
}

export function SelfScore({
  items,
  draft,
  onChange,
  onFinish,
  submitting,
  error,
}: {
  items: ReviewItem[];
  draft: SelfScoreDraft;
  onChange: (draft: SelfScoreDraft) => void;
  onFinish: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const [index, setIndex] = useState(0);
  const item = items[index];

  const scored = useMemo(() => new Set(draft.scored), [draft.scored]);
  const remaining = items.filter((i) => !scored.has(i.question.id)).length;

  if (!item) return null;

  const ticks = draft.ticks[item.question.id] ?? [];
  const tickedSet = new Set(ticks);
  const points = item.feedback.marking_points;
  const earned = points.reduce(
    (sum, point, i) => (tickedSet.has(i) ? sum + point.marks : sum),
    0,
  );
  const rounded = Math.round(earned * 100) / 100;

  function toggle(pointIndex: number) {
    const next = tickedSet.has(pointIndex)
      ? ticks.filter((i) => i !== pointIndex)
      : [...ticks, pointIndex].sort((a, b) => a - b);
    onChange({
      ...draft,
      ticks: { ...draft.ticks, [item!.question.id]: next },
    });
  }

  function confirm() {
    const id = item!.question.id;
    const nextScored = scored.has(id) ? draft.scored : [...draft.scored, id];
    onChange({
      ticks: { ...draft.ticks, [id]: ticks },
      scored: nextScored,
    });

    // Move to the next unscored question, so confirming always advances the
    // candidate towards being done rather than stopping on the last one.
    const nextUnscored = items.findIndex(
      (candidate, i) =>
        i > index && !new Set(nextScored).has(candidate.question.id),
    );
    const fallback = items.findIndex(
      (candidate) => !new Set(nextScored).has(candidate.question.id),
    );
    const target = nextUnscored >= 0 ? nextUnscored : fallback;
    if (target >= 0) setIndex(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const allScored = remaining === 0;

  return (
    <div>
      <PageTitle
        sub={`Your written answers are not scored automatically. Judge each one against its marking points — your total is shown once all ${items.length} are done.`}
      >
        Score your written answers
      </PageTitle>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          <Muted>
            Answer {index + 1} of {items.length}
          </Muted>
        </span>
        <span style={{ color: allScored ? "var(--correct)" : "var(--flag)" }}>
          {allScored ? "All scored" : `${remaining} still to score`}
        </span>
      </div>

      {/* Which answers are done, and a way back to any of them. */}
      <nav aria-label="Written answers" className="mb-4 flex flex-wrap gap-1.5">
        {items.map((candidate, i) => {
          const done = scored.has(candidate.question.id);
          const current = i === index;
          return (
            <button
              key={candidate.question.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-current={current ? "true" : undefined}
              aria-label={`Question ${candidate.question.number}, ${done ? "scored" : "not scored"}`}
              className="h-9 min-w-9 rounded-md border px-2 text-sm font-semibold tabular-nums"
              style={{
                background: current
                  ? "var(--accent)"
                  : done
                    ? "var(--correct-soft)"
                    : "var(--surface)",
                color: current
                  ? "#fff"
                  : done
                    ? "var(--correct)"
                    : "var(--muted)",
                borderColor: current
                  ? "var(--accent)"
                  : done
                    ? "var(--correct)"
                    : "var(--border)",
              }}
            >
              {candidate.question.number}
              {done && !current ? " ✓" : ""}
            </button>
          );
        })}
      </nav>

      <article className="card px-3 py-4 sm:px-4">
        <QuestionMeta question={item.question} />
        <QuestionBody question={item.question} />

        <section className="mt-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide">
            <Muted>What you wrote</Muted>
          </h2>
          <QuizText className="mt-1 card px-3 py-2 text-sm">
            {item.response.text}
          </QuizText>
        </section>

        {item.feedback.model_answer ? (
          <section className="mt-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide">
              <Muted>Model answer</Muted>
            </h2>
            <QuizText className="prose-legal mt-1 text-sm">
              {item.feedback.model_answer}
            </QuizText>
          </section>
        ) : null}

        <section className="mt-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide">
              <Muted>Tick each point your answer made</Muted>
            </h2>
            <span className="text-sm font-semibold tabular-nums">
              {rounded} / {item.question.marks}
            </span>
          </div>

          <ul className="space-y-1.5">
            {points.map((point, i) => (
              <li key={i}>
                <label className="option" data-selected={tickedSet.has(i)}>
                  <input
                    type="checkbox"
                    checked={tickedSet.has(i)}
                    onChange={() => toggle(i)}
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

          <p className="mt-2 text-xs">
            <Muted>
              Ticking nothing is a valid score of zero — confirm it either way.
            </Muted>
          </p>
        </section>

        <div className="mt-4 flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <button type="button" className="btn btn-primary flex-1" onClick={confirm}>
            {scored.has(item.question.id)
              ? `Update score (${rounded})`
              : `Confirm ${rounded} of ${item.question.marks}`}
          </button>
        </div>
      </article>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className="btn flex-1"
          onClick={() => setIndex(Math.max(0, index - 1))}
          disabled={index === 0}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn flex-1"
          onClick={() => setIndex(Math.min(items.length - 1, index + 1))}
          disabled={index === items.length - 1}
        >
          Next
        </button>
      </div>

      <button
        type="button"
        className="btn btn-primary mt-3 w-full"
        onClick={onFinish}
        disabled={!allScored || submitting}
      >
        {submitting
          ? "Saving your scores…"
          : allScored
            ? "See my result"
            : `Score ${remaining} more to see your result`}
      </button>
    </div>
  );
}
