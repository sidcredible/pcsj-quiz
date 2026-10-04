"use client";

/**
 * The start, attempt and review screens for one quiz, as a single client flow
 * so a candidate never loses answers to a navigation.
 *
 * Nothing here knows an answer key: the quiz arrives redacted, the submit
 * response brings back the review, and self-scores go to the server. Progress
 * is kept in localStorage, so a dropped connection or a closed tab mid-attempt
 * costs nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CandidateQuiz } from "@/lib/quiz/redact";
import { compositionLine } from "@/lib/quiz/redact";
import type { AttemptReview } from "@/lib/quiz/review";
import {
  detectDevice,
  dequeue,
  enqueue,
  flushQueue,
  newAttemptId,
  readQueue,
  type QueuedSubmission,
} from "@/lib/client/queue";
import { Palette, paletteState, type PaletteState } from "./Palette";
import { OptionList, SubjectiveAnswer } from "./AnswerControls";
import { QuestionBody, QuestionMeta } from "./QuestionBody";
import { ReviewList } from "./ReviewList";
import { Badge, Muted, Notice, PageTitle, QuizText, Spinner } from "./primitives";

interface AnswerState {
  chosen: string[];
  text: string;
  markedForReview: boolean;
  timeSpentSec: number;
  changedAnswer: boolean;
}

type Phase = "start" | "attempt" | "review";

const CANDIDATE_KEY = "pcsj-quiz.candidate";
const progressKey = (setId: string) => `pcsj-quiz.progress.${setId}`;

function emptyAnswer(): AnswerState {
  return {
    chosen: [],
    text: "",
    markedForReview: false,
    timeSpentSec: 0,
    changedAnswer: false,
  };
}

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or a full quota: progress simply is not remembered.
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function QuizRunner({
  quiz,
  suggestedMinutes,
  defaultNegativeMarking,
}: {
  quiz: CandidateQuiz;
  suggestedMinutes: number;
  defaultNegativeMarking: number;
}) {
  const [phase, setPhase] = useState<Phase>("start");
  const [candidate, setCandidate] = useState("");
  const [mode, setMode] = useState<"practice" | "timed">("practice");
  const [negativeMarking, setNegativeMarking] = useState(defaultNegativeMarking);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [index, setIndex] = useState(0);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [review, setReview] = useState<AttemptReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null);
  const [ticks, setTicks] = useState<Record<string, number[]>>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [selfScoreError, setSelfScoreError] = useState<string | null>(null);

  const attemptIdRef = useRef<string>("");
  const questionStartRef = useRef<number>(Date.now());

  const questions = quiz.questions;
  const current = questions[index];

  // Remembering the name is the whole of "login" here.
  useEffect(() => {
    setCandidate(readLocal(CANDIDATE_KEY) ?? "");
  }, []);

  // Anything left in the queue from an earlier visit goes out now.
  useEffect(() => {
    if (readQueue().length === 0) return;
    void flushQueue((submission) =>
      fetch("/api/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submission),
      }),
    ).then((result) => {
      if (result.sent.length > 0) {
        setQueuedNotice(
          `${result.sent.length} attempt${result.sent.length === 1 ? "" : "s"} ` +
            `saved from an earlier session.`,
        );
      }
    });
  }, []);

  // Restore an interrupted attempt.
  useEffect(() => {
    const saved = readLocal(progressKey(quiz.set_id));
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as {
        attemptId: string;
        startedAt: string;
        answers: Record<string, AnswerState>;
        index: number;
        mode: "practice" | "timed";
        negativeMarking: number;
      };
      if (!parsed.attemptId || !parsed.startedAt) return;
      attemptIdRef.current = parsed.attemptId;
      setAnswers(parsed.answers ?? {});
      setIndex(Math.min(parsed.index ?? 0, questions.length - 1));
      setStartedAt(parsed.startedAt);
      setMode(parsed.mode ?? "practice");
      setNegativeMarking(parsed.negativeMarking ?? defaultNegativeMarking);
      setPhase("attempt");
    } catch {
      // Unreadable progress is simply ignored.
    }
  }, [quiz.set_id, questions.length, defaultNegativeMarking]);

  // Persist progress on every change, so nothing depends on a clean exit.
  useEffect(() => {
    if (phase !== "attempt" || !startedAt) return;
    writeLocal(
      progressKey(quiz.set_id),
      JSON.stringify({
        attemptId: attemptIdRef.current,
        startedAt,
        answers,
        index,
        mode,
        negativeMarking,
      }),
    );
  }, [phase, startedAt, answers, index, mode, negativeMarking, quiz.set_id]);

  // The clock runs in both modes; only the display differs.
  useEffect(() => {
    if (phase !== "attempt" || !startedAt) return;
    const started = Date.parse(startedAt);
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - started) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [phase, startedAt]);

  const answerFor = useCallback(
    (questionId: string) => answers[questionId] ?? emptyAnswer(),
    [answers],
  );

  /** Banks the time spent on the question being left. */
  const bankTime = useCallback((questionId: string) => {
    const spent = Math.max(0, Math.round((Date.now() - questionStartRef.current) / 1000));
    questionStartRef.current = Date.now();
    if (spent === 0) return;
    setAnswers((previous) => {
      const existing = previous[questionId] ?? emptyAnswer();
      return {
        ...previous,
        [questionId]: { ...existing, timeSpentSec: existing.timeSpentSec + spent },
      };
    });
  }, []);

  const goTo = useCallback(
    (next: number) => {
      if (!current) return;
      bankTime(current.id);
      setIndex(Math.max(0, Math.min(next, questions.length - 1)));
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [bankTime, current, questions.length],
  );

  function updateAnswer(questionId: string, patch: Partial<AnswerState>) {
    setAnswers((previous) => {
      const existing = previous[questionId] ?? emptyAnswer();
      const hadAnswer =
        existing.chosen.length > 0 || existing.text.trim().length > 0;
      const next = { ...existing, ...patch };
      const changesAnswer =
        patch.chosen !== undefined || patch.text !== undefined;
      return {
        ...previous,
        [questionId]: {
          ...next,
          // "Did I change a right answer to a wrong one?" is one of the
          // questions the Sheet is meant to answer, so the flag is sticky.
          changedAnswer:
            existing.changedAnswer || (hadAnswer && changesAnswer),
        },
      };
    });
  }

  function start() {
    const name = candidate.trim();
    if (!name) {
      setError("Enter your name to start.");
      return;
    }
    writeLocal(CANDIDATE_KEY, name);
    attemptIdRef.current = newAttemptId();
    questionStartRef.current = Date.now();
    setStartedAt(new Date().toISOString());
    setError(null);
    setPhase("attempt");
  }

  const payload = useCallback(
    (): QueuedSubmission => ({
      attempt_id: attemptIdRef.current,
      set_id: quiz.set_id,
      candidate: candidate.trim(),
      started_at: startedAt ?? new Date().toISOString(),
      mode,
      device: detectDevice(),
      negative_marking: negativeMarking,
      answers: questions.map((question) => {
        const answer = answerFor(question.id);
        return {
          question_id: question.id,
          ...(answer.chosen.length > 0 ? { chosen: answer.chosen } : {}),
          ...(answer.text.trim() ? { text: answer.text } : {}),
          ...(answer.timeSpentSec > 0
            ? { time_spent_sec: answer.timeSpentSec }
            : {}),
          ...(answer.changedAnswer ? { changed_answer: true } : {}),
          ...(answer.markedForReview ? { marked_for_review: true } : {}),
        };
      }),
      queued_at: new Date().toISOString(),
      attempts_to_send: 0,
    }),
    [quiz.set_id, candidate, startedAt, mode, negativeMarking, questions, answerFor],
  );

  async function submit() {
    if (!current) return;
    bankTime(current.id);
    setSubmitting(true);
    setError(null);

    // Queued before sending: from here on the attempt cannot be lost, whatever
    // happens to the network, the tab or Google.
    const submission = payload();
    enqueue(submission);

    try {
      const response = await fetch("/api/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submission),
      });

      if (response.ok) {
        const body = (await response.json()) as { review: AttemptReview };
        dequeue(submission.attempt_id);
        writeLocal(progressKey(quiz.set_id), "");
        setReview(body.review);
        setTicks(
          Object.fromEntries(
            body.review.items
              .filter((item) => item.question.type === "subjective")
              .map((item) => [item.question.id, item.response.points_ticked]),
          ),
        );
        setPhase("review");
        window.scrollTo({ top: 0 });
        return;
      }

      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        error?: string;
      };
      const retryable =
        response.status >= 500 || response.status === 408 || response.status === 429;
      if (retryable) {
        setError(
          "Your answers are saved on this device and will be sent as soon as " +
            "the connection is back. You can close this page.",
        );
      } else {
        dequeue(submission.attempt_id);
        setError(body.detail ?? body.error ?? "The attempt could not be submitted.");
      }
    } catch {
      setError(
        "No connection. Your answers are saved on this device and will be " +
          "sent automatically when you are back online.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function saveSelfScore(questionId: string, indexes: number[]) {
    if (!review) return;
    setTicks((previous) => ({ ...previous, [questionId]: indexes }));
    setSaving((previous) => new Set(previous).add(questionId));
    setSelfScoreError(null);

    try {
      const response = await fetch(
        `/api/attempts/${encodeURIComponent(review.attempt_id)}/self-score`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            updates: [{ question_id: questionId, points_ticked: indexes }],
          }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { detail?: string };
        setSelfScoreError(
          body.detail ?? "Could not save that self-score. It is not recorded yet.",
        );
        return;
      }
      const body = (await response.json()) as { totals: AttemptReview["totals"] };
      setReview((previous) => (previous ? { ...previous, totals: body.totals } : previous));
    } catch {
      setSelfScoreError(
        "Could not reach the server, so that self-score is not saved yet.",
      );
    } finally {
      setSaving((previous) => {
        const next = new Set(previous);
        next.delete(questionId);
        return next;
      });
    }
  }

  const paletteStates: PaletteState[] = useMemo(
    () =>
      questions.map((question, position) =>
        paletteState(question, answers[question.id], position === index),
      ),
    [questions, answers, index],
  );

  const answeredCount = useMemo(
    () =>
      questions.filter((question) => {
        const answer = answers[question.id];
        return question.type === "mcq"
          ? (answer?.chosen.length ?? 0) > 0
          : (answer?.text.trim().length ?? 0) > 0;
      }).length,
    [questions, answers],
  );

  if (phase === "start") {
    return (
      <div>
        <p className="mb-4">
          <Link href="/" className="text-sm underline underline-offset-2">
            ← All quizzes
          </Link>
        </p>

        <PageTitle sub={`${quiz.topic} · ${quiz.created}`}>{quiz.heading}</PageTitle>

        {queuedNotice ? <Notice>{queuedNotice}</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}

        <div className="card mb-4 px-4 py-4">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              { label: "Questions", value: String(quiz.question_count) },
              { label: "Maximum marks", value: String(quiz.max_marks) },
              { label: "Suggested time", value: `${suggestedMinutes} min` },
              {
                label: "Types",
                value: quiz.question_types
                  .map((type) => (type === "mcq" ? "MCQ" : "Subjective"))
                  .join(" + "),
              },
            ].map((stat) => (
              <div key={stat.label}>
                <dt className="text-xs uppercase tracking-wide">
                  <Muted>{stat.label}</Muted>
                </dt>
                <dd className="mt-0.5 font-semibold">{stat.value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 text-sm">
            <Muted>{compositionLine(quiz.composition, quiz.question_count)}</Muted>
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {quiz.exam_focus.map((exam) => (
              <Badge key={exam}>{exam}</Badge>
            ))}
          </div>
        </div>

        <section className="card mb-4 px-4 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide">
            <Muted>Law as on</Muted>
          </h2>
          <QuizText className="mt-1 text-sm">{quiz.law_basis}</QuizText>

          {quiz.pattern_notes ? (
            <>
              <h2 className="mt-4 text-xs font-semibold uppercase tracking-wide">
                <Muted>How this topic is examined</Muted>
              </h2>
              <QuizText className="mt-1 text-sm">{quiz.pattern_notes}</QuizText>
            </>
          ) : null}
        </section>

        <section className="card mb-5 px-4 py-4">
          <label className="block text-sm font-semibold" htmlFor="candidate">
            Your name
          </label>
          <input
            id="candidate"
            className="field mt-1.5"
            value={candidate}
            onChange={(event) => setCandidate(event.target.value)}
            placeholder="Name or email"
            autoComplete="name"
          />

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-semibold" htmlFor="mode">
                Mode
              </label>
              <select
                id="mode"
                className="field mt-1.5"
                value={mode}
                onChange={(event) =>
                  setMode(event.target.value === "timed" ? "timed" : "practice")
                }
              >
                <option value="practice">Practice (no time limit)</option>
                <option value="timed">Timed ({suggestedMinutes} min)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold" htmlFor="negative">
                Negative marking
              </label>
              <select
                id="negative"
                className="field mt-1.5"
                value={String(negativeMarking)}
                onChange={(event) => setNegativeMarking(Number(event.target.value))}
              >
                <option value="0">None</option>
                <option value="0.25">0.25 per wrong MCQ</option>
                <option value="0.33">0.33 per wrong MCQ</option>
              </select>
            </div>
          </div>
        </section>

        <button type="button" className="btn btn-primary w-full" onClick={start}>
          Start quiz
        </button>
      </div>
    );
  }

  if (phase === "attempt") {
    if (!current) return <Spinner label="Loading question…" />;
    const answer = answerFor(current.id);
    const timeLimit = mode === "timed" ? suggestedMinutes * 60 : null;
    const remaining = timeLimit === null ? null : timeLimit - elapsed;

    return (
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            <Muted>
              {index + 1} of {questions.length} · {answeredCount} answered
            </Muted>
          </span>
          <span
            className="tabular-nums"
            style={{
              color:
                remaining !== null && remaining <= 60 ? "var(--wrong)" : "var(--muted)",
            }}
          >
            {remaining === null
              ? formatDuration(elapsed)
              : remaining >= 0
                ? `${formatDuration(remaining)} left`
                : `${formatDuration(-remaining)} over`}
          </span>
        </div>

        {error ? <Notice tone="warn">{error}</Notice> : null}

        <article className="card px-3 py-4 sm:px-4">
          <QuestionMeta question={current} />
          <QuestionBody question={current} />

          {current.type === "mcq" ? (
            <OptionList
              question={current}
              chosen={answer.chosen}
              onChange={(chosen) => updateAnswer(current.id, { chosen })}
            />
          ) : (
            <SubjectiveAnswer
              question={current}
              text={answer.text}
              onChange={(text) => updateAnswer(current.id, { text })}
            />
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3"
            style={{ borderColor: "var(--border)" }}
          >
            <button
              type="button"
              className="btn"
              onClick={() =>
                updateAnswer(current.id, { markedForReview: !answer.markedForReview })
              }
              aria-pressed={answer.markedForReview}
              style={
                answer.markedForReview
                  ? { borderColor: "var(--flag)", background: "var(--flag-soft)" }
                  : undefined
              }
            >
              {answer.markedForReview ? "Marked for review" : "Mark for review"}
            </button>

            {current.type === "mcq" && answer.chosen.length > 0 ? (
              <button
                type="button"
                className="btn"
                onClick={() => updateAnswer(current.id, { chosen: [] })}
              >
                Clear answer
              </button>
            ) : null}
          </div>
        </article>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="btn flex-1"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
          >
            Previous
          </button>
          {index < questions.length - 1 ? (
            <button
              type="button"
              className="btn btn-primary flex-1"
              onClick={() => goTo(index + 1)}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary flex-1"
              onClick={() => void submit()}
              disabled={submitting}
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
          )}
        </div>

        {index < questions.length - 1 ? (
          <button
            type="button"
            className="btn mt-2 w-full"
            onClick={() => void submit()}
            disabled={submitting}
          >
            {submitting ? "Submitting…" : "Submit quiz"}
          </button>
        ) : null}

        <Palette questions={questions} states={paletteStates} onJump={goTo} />
      </div>
    );
  }

  if (!review) return <Spinner label="Loading your result…" />;

  const totals = review.totals;
  return (
    <div>
      <p className="mb-4">
        <Link href="/" className="text-sm underline underline-offset-2">
          ← All quizzes
        </Link>
      </p>

      <PageTitle sub={`${review.candidate} · ${quiz.heading}`}>Your result</PageTitle>

      <div className="card mb-4 px-4 py-4">
        <p className="prose-legal text-3xl font-semibold tabular-nums">
          {totals.total_score} <Muted>/ {totals.max_score}</Muted>
          <span className="ml-2 text-lg">
            <Muted>({totals.percent}%)</Muted>
          </span>
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[
            {
              label: "MCQ",
              value: `${totals.mcq_score} / ${totals.mcq_max}`,
            },
            {
              label: "Subjective",
              value: `${totals.subjective_score} / ${totals.subjective_max}`,
            },
            { label: "Correct", value: String(totals.correct) },
            { label: "Wrong", value: String(totals.wrong) },
          ].map((stat) => (
            <div key={stat.label}>
              <dt className="text-xs uppercase tracking-wide">
                <Muted>{stat.label}</Muted>
              </dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-3 text-sm">
          <Muted>
            {totals.skipped} skipped · negative marking {review.negative_marking}
          </Muted>
        </p>

        {totals.pending_self_score > 0 ? (
          <p className="mt-3 text-sm" style={{ color: "var(--flag)" }}>
            {totals.pending_self_score} written answer
            {totals.pending_self_score === 1 ? "" : "s"} still to self-score. Tick
            the marking points below; your total updates as you go.
          </p>
        ) : null}
      </div>

      {selfScoreError ? <Notice tone="error">{selfScoreError}</Notice> : null}

      <ReviewList
        review={review}
        ticks={ticks}
        onTick={(questionId, indexes) => void saveSelfScore(questionId, indexes)}
        savingQuestionIds={saving}
      />
    </div>
  );
}
