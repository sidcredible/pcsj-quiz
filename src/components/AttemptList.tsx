"use client";

/**
 * Past attempts on the home page, newest first.
 *
 * Opening one shows the same result screen it showed on the day, so a
 * candidate can see what they got wrong last week without re-sitting the quiz.
 */

import Link from "next/link";
import type { AttemptSummary } from "@/lib/sheets/log";
import { formatWhen } from "./ResultView";
import { Badge, Muted } from "./primitives";

export interface AttemptCard extends AttemptSummary {
  heading: string;
}

export function AttemptList({
  attempts,
  showCandidate,
}: {
  attempts: AttemptCard[];
  /** Hidden when the list is already narrowed to one person. */
  showCandidate: boolean;
}) {
  return (
    <ul className="space-y-3">
      {attempts.map((attempt) => (
        <li key={attempt.attempt_id}>
          <Link
            href={`/attempt/${encodeURIComponent(attempt.attempt_id)}`}
            className="card block px-4 py-4 transition-colors hover:border-current"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="prose-legal text-base font-semibold leading-snug">
                {attempt.heading}
              </h3>
              <span className="text-sm font-semibold tabular-nums">
                {attempt.total_score}
                <Muted> / {attempt.max_score}</Muted>
              </span>
            </div>

            <p className="mt-1 text-sm">
              <Muted>
                {showCandidate ? `${attempt.candidate} · ` : ""}
                {attempt.submitted_at ? formatWhen(attempt.submitted_at) : "—"}
              </Muted>
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge>{attempt.percent}%</Badge>
              <Badge>{attempt.correct} right</Badge>
              <Badge>{attempt.wrong} wrong</Badge>
              {attempt.skipped > 0 ? (
                <Badge>{attempt.skipped} not attempted</Badge>
              ) : null}
              {attempt.mode === "timed" ? <Badge>timed</Badge> : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
