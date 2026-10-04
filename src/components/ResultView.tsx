"use client";

/**
 * The result screen: score summary, outcome filters, jump grid, full review.
 *
 * Shared by the attempt just finished and by any attempt reopened from the
 * home page, so revisiting last week's quiz shows exactly what the candidate
 * saw when they submitted it — same filters, same explanations, same numbers.
 */

import { useState } from "react";
import Link from "next/link";
import type { AttemptReview } from "@/lib/quiz/review";
import { filterCounts, filterItems, type ReviewFilter } from "@/lib/quiz/filters";
import { ResultPalette, ReviewFilters } from "./ReviewFilters";
import { ReviewList } from "./ReviewList";
import { ScoreSummary } from "./ScoreSummary";
import { Muted, Notice, PageTitle } from "./primitives";

function jumpTo(questionId: string) {
  document
    .getElementById(`q-${questionId}`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** "4 Oct 2026, 11:37 pm" in the reader's own locale. */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ResultView({
  review,
  heading,
  title = "Your result",
  backHref = "/",
  backLabel = "← All quizzes",
}: {
  review: AttemptReview;
  /** The quiz's own heading, shown under the title. */
  heading: string;
  title?: string;
  backHref?: string;
  backLabel?: string;
}) {
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const counts = filterCounts(review.items);
  const visible = filterItems(review.items, filter);

  return (
    <div>
      <p className="mb-4">
        <Link href={backHref} className="text-sm underline underline-offset-2">
          {backLabel}
        </Link>
      </p>

      <PageTitle
        sub={
          <>
            {review.candidate} · {heading}
            {review.submitted_at ? ` · ${formatWhen(review.submitted_at)}` : ""}
          </>
        }
      >
        {title}
      </PageTitle>

      {review.totals.pending_self_score > 0 ? (
        <Notice tone="warn">
          {review.totals.pending_self_score} written answer
          {review.totals.pending_self_score === 1 ? " was" : "s were"} never
          self-scored, so the total below counts{" "}
          {review.totals.pending_self_score === 1 ? "it" : "them"} as zero.
        </Notice>
      ) : null}

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
