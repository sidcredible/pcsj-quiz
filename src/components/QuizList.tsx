"use client";

/**
 * The quiz list: one card per imported file, newest first, with the filters
 * handbook section 6 asks for (topic, exam, subject) and the candidate's last
 * score when there is one.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CandidateQuizSummary } from "@/lib/quiz/redact";
import { Badge, Muted, Notice, PageTitle, Spinner } from "./primitives";

interface QuizListEntry extends CandidateQuizSummary {
  warnings: string[];
}

interface QuizListResponse {
  quizzes: QuizListEntry[];
  rejected: { fileName: string; errors: string[] }[];
  scanned_at: string | null;
  scan_error?: string;
  last_scores: Record<string, { percent: number; submitted_at: string }>;
}

const CANDIDATE_KEY = "pcsj-quiz.candidate";
const ALL = "all";

function readCandidate(): string {
  try {
    return window.localStorage.getItem(CANDIDATE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function QuizList() {
  const [data, setData] = useState<QuizListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [topic, setTopic] = useState(ALL);
  const [exam, setExam] = useState(ALL);
  const [subject, setSubject] = useState(ALL);

  async function load(force = false) {
    setRefreshing(true);
    setError(null);
    try {
      const candidate = readCandidate();
      const params = new URLSearchParams();
      if (force) params.set("refresh", "1");
      if (candidate) params.set("candidate", candidate);
      const response = await fetch(`/api/quizzes?${params}`);
      const body = (await response.json()) as QuizListResponse & {
        error?: string;
        detail?: string;
      };
      if (!response.ok) {
        setError(body.detail ?? body.error ?? "Could not load the quizzes.");
        setNotConfigured(response.status === 503);
        return;
      }
      setNotConfigured(false);
      setData(body);
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const quizzes = data?.quizzes ?? [];

  const topics = useMemo(
    () => [...new Set(quizzes.map((quiz) => quiz.topic))].sort(),
    [quizzes],
  );
  const exams = useMemo(
    () => [...new Set(quizzes.flatMap((quiz) => quiz.exam_focus))].sort(),
    [quizzes],
  );
  const subjects = useMemo(
    () => [...new Set(quizzes.flatMap((quiz) => quiz.subject_codes))].sort(),
    [quizzes],
  );

  const visible = quizzes.filter(
    (quiz) =>
      (topic === ALL || quiz.topic === topic) &&
      (exam === ALL || quiz.exam_focus.includes(exam as "DJS" | "UP-PCSJ")) &&
      (subject === ALL || quiz.subject_codes.includes(subject)),
  );

  return (
    <div className="wide-shell">
      <PageTitle sub="Delhi Judicial Service · UP PCS(J)">Practice sets</PageTitle>

      {error ? (
        <Notice tone="error">
          <p>{error}</p>
          {notConfigured ? (
            <p className="mt-2">
              Open{" "}
              <a
                href="/api/health?check=google"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                /api/health
              </a>{" "}
              to see which setting is missing. It shows no secret values.
            </p>
          ) : null}
        </Notice>
      ) : null}
      {data?.scan_error ? (
        <Notice tone="warn">
          Could not read the Drive folder: {data.scan_error}
        </Notice>
      ) : null}
      {data && data.rejected.length > 0 ? (
        <Notice tone="warn">
          {data.rejected.length} file
          {data.rejected.length === 1 ? "" : "s"} could not be imported.{" "}
          <Link href="/admin" className="underline underline-offset-2">
            See why
          </Link>
          .
        </Notice>
      ) : null}

      {quizzes.length > 1 ? (
        <div className="mb-4 grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
          {[
            { label: "Topic", value: topic, set: setTopic, options: topics },
            { label: "Exam", value: exam, set: setExam, options: exams },
            { label: "Subject", value: subject, set: setSubject, options: subjects },
          ].map((filter) => (
            <label key={filter.label} className="text-sm">
              <span className="sr-only">{filter.label}</span>
              <select
                className="field"
                value={filter.value}
                onChange={(event) => filter.set(event.target.value)}
                aria-label={`Filter by ${filter.label.toLowerCase()}`}
              >
                <option value={ALL}>All {filter.label.toLowerCase()}s</option>
                {filter.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ) : null}

      {data === null && !error ? <Spinner label="Loading quizzes…" /> : null}

      {data !== null && visible.length === 0 ? (
        <p className="py-8 text-center text-sm">
          <Muted>
            {quizzes.length === 0
              ? "No quizzes yet. New sets appear here as soon as they are uploaded."
              : "No quiz matches these filters."}
          </Muted>
        </p>
      ) : null}

      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {visible.map((quiz) => {
          const last = data?.last_scores[quiz.set_id];
          return (
            <li key={quiz.set_id}>
              <Link
                href={`/quiz/${encodeURIComponent(quiz.set_id)}`}
                className="card block h-full px-4 py-4 transition-colors hover:border-current"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="prose-legal text-lg font-semibold leading-snug">
                    {quiz.heading}
                  </h2>
                  {last ? (
                    <span className="text-sm tabular-nums" style={{ color: "var(--muted)" }}>
                      last: {last.percent}%
                    </span>
                  ) : null}
                </div>

                <p className="mt-1 text-sm">
                  <Muted>
                    {quiz.created} · {quiz.question_count} questions ·{" "}
                    {quiz.max_marks} marks
                  </Muted>
                </p>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {quiz.exam_focus.map((focus) => (
                    <Badge key={focus}>{focus}</Badge>
                  ))}
                  {quiz.question_types.map((type) => (
                    <Badge key={type}>{type === "mcq" ? "MCQ" : "Subjective"}</Badge>
                  ))}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn"
          onClick={() => void load(true)}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
        {data?.scanned_at ? (
          <span className="text-xs">
            <Muted>
              Checked {new Date(data.scanned_at).toLocaleTimeString()}
            </Muted>
          </span>
        ) : null}
      </div>
    </div>
  );
}
