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
import { ScoreSummary } from "./ScoreSummary";
import { SelfScore, type SelfScoreDraft } from "./SelfScore";
import { ResultPalette, ReviewFilters } from "./ReviewFilters";
import {
  filterCounts,
  filterItems,
  itemsNeedingSelfScore,
  type ReviewFilter,
} from "@/lib/quiz/filters";
import { Badge, Muted, Notice, PageTitle, QuizText, Spinner } from "./primitives";

interface AnswerState {
  chosen: string[];
  text: string;
  markedForReview: boolean;
  timeSpentSec: number;
  changedAnswer: boolean;
}

/**
 * A quiz with written answers passes through "selfScore" before "review": a
 * total that counts every unscored written answer as zero is not a result, it
 * is a misleading one, so it is not shown until the candidate has judged them.
 */
type Phase = "start" | "attempt" | "selfScore" | "review";

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
  const [draft, setDraft] = useState<SelfScoreDraft>({ ticks: {}, scored: [] });
  const [selfScoreError, setSelfScoreError] = useState<string | null>(null);
  const [savingScores, setSavingScores] = useState(false);
  const [filter, setFilter] = useState<ReviewFilter>("all");

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

  /**
   * A tablet with a keyboard attached, or a laptop, gets the arrow keys for
   * moving between questions. Anything typed into the answer box, a field or a
   * menu is left alone, and so is any shortcut the browser owns.
   */
  useEffect(() => {
    if (phase !== "attempt") return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
      ) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(index - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(index + 1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, index, goTo]);

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

        const toScore = itemsNeedingSelfScore(body.review.items);
        setDraft({
          ticks: Object.fromEntries(
            toScore.map((item) => [item.question.id, item.response.points_ticked]),
          ),
          scored: [],
        });
        // Only a quiz with written answers needs the scoring step; an all-MCQ
        // attempt is already fully scored and goes straight to its result.
        setPhase(toScore.length > 0 ? "selfScore" : "review");
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

  /**
   * Sends every self-score in one request, then shows the result.
   *
   * One request rather than one per question: the candidate is told their
   * scores are saved exactly once, and a half-written set of scores cannot be
   * left behind by a connection that drops midway. The server recomputes the
   * attempt totals and returns them, so the result screen shows the Sheet's
   * numbers rather than the browser's arithmetic.
   */
  async function finishSelfScoring() {
    if (!review) return;
    setSavingScores(true);
    setSelfScoreError(null);

    const updates = itemsNeedingSelfScore(review.items).map((item) => ({
      question_id: item.question.id,
      points_ticked: draft.ticks[item.question.id] ?? [],
    }));

    try {
      const response = await fetch(
        `/api/attempts/${encodeURIComponent(review.attempt_id)}/self-score`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ updates }),
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          detail?: string;
        };
        setSelfScoreError(
          body.detail ??
            "Your scores could not be saved. Check your connection and try again.",
        );
        return;
      }

      const body = (await response.json()) as { totals: AttemptReview["totals"] };
      // Fold the confirmed scores into the review so the list below shows what
      // was ticked, alongside the totals the server just recomputed.
      setReview((previous) =>
        previous
          ? {
              ...previous,
              totals: body.totals,
              items: previous.items.map((item) => {
                const ticked = draft.ticks[item.question.id];
                if (!ticked || item.question.type !== "subjective") return item;
                const earned = ticked.reduce(
                  (sum, i) => sum + (item.feedback.marking_points[i]?.marks ?? 0),
                  0,
                );
                const capped = Math.min(
                  Math.round(earned * 100) / 100,
                  item.response.max_marks,
                );
                return {
                  ...item,
                  response: {
                    ...item.response,
                    points_ticked: ticked,
                    result:
                      item.response.text.trim().length === 0
                        ? "skipped"
                        : "self_scored",
                    score: item.response.text.trim().length === 0 ? 0 : capped,
                  },
                };
              }),
            }
          : previous,
      );
      setPhase("review");
      window.scrollTo({ top: 0 });
    } catch {
      setSelfScoreError(
        "Could not reach the server, so your scores are not saved yet. " +
          "Check your connection and try again.",
      );
    } finally {
      setSavingScores(false);
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
      <div className="wide-shell lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-6">
        <div className="lg:col-start-1">
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

          {/*
            Full width under the thumb on a phone; from 768px up the pair sits
            at its own size on the right, where a hand holding a tablet is.
          */}
          <div className="mt-4 flex gap-2 md:justify-end">
            <button
              type="button"
              className="btn flex-1 md:min-w-40 md:flex-none"
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
            >
              Previous
            </button>
            {index < questions.length - 1 ? (
              <button
                type="button"
                className="btn btn-primary flex-1 md:min-w-40 md:flex-none"
                onClick={() => goTo(index + 1)}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary flex-1 md:min-w-40 md:flex-none"
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
              className="btn mt-2 w-full md:w-auto"
              onClick={() => void submit()}
              disabled={submitting}
            >
              {submitting ? "Submitting…" : "Submit quiz"}
            </button>
          ) : null}

          {/* Only worth saying where a keyboard is likely to be attached. */}
          <p className="mt-3 hidden text-xs lg:block">
            <Muted>Use ← and → to move between questions.</Muted>
          </p>

          {/* Under the question on a phone, beside it from 1024px up. */}
          <div className="lg:hidden">
            <Palette questions={questions} states={paletteStates} onJump={goTo} />
          </div>
        </div>

        <aside className="hidden lg:col-start-2 lg:block">
          <Palette
            questions={questions}
            states={paletteStates}
            onJump={goTo}
            variant="sidebar"
          />
        </aside>
      </div>
    );
  }

  if (!review) return <Spinner label="Loading your result…" />;

  if (phase === "selfScore") {
    return (
      <SelfScore
        items={itemsNeedingSelfScore(review.items)}
        draft={draft}
        onChange={setDraft}
        onFinish={() => void finishSelfScoring()}
        submitting={savingScores}
        error={selfScoreError}
      />
    );
  }

  const counts = filterCounts(review.items);
  const visible = filterItems(review.items, filter);

  function jumpTo(questionId: string) {
    const element = document.getElementById(`q-${questionId}`);
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div>
      <p className="mb-4">
        <Link href="/" className="text-sm underline underline-offset-2">
          ← All quizzes
        </Link>
      </p>

      <PageTitle sub={`${review.candidate} · ${quiz.heading}`}>Your result</PageTitle>

      <ScoreSummary totals={review.totals} negativeMarking={review.negative_marking} />

      <ReviewFilters counts={counts} active={filter} onChange={setFilter} />

      <ResultPalette items={review.items} onJump={jumpTo} />

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm">
          <Muted>No questions in this group.</Muted>
        </p>
      ) : (
        <ReviewList items={visible} />
      )}
    </div>
  );
}
