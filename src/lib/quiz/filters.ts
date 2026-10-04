/**
 * Filtering and navigating the review screen.
 *
 * Kept out of the component so the counts a candidate relies on ("12 wrong")
 * are testable, and so "which questions still need a self-score" has exactly
 * one definition — the result screen is gated on it, so a wrong answer there
 * either blocks a finished candidate or shows them a total that is a lie.
 */

import type { AttemptReview, ReviewItem } from "./review";

export type ReviewFilter =
  | "all"
  | "correct"
  | "wrong"
  | "skipped"
  | "written"
  | "flagged";

export const REVIEW_FILTERS: ReviewFilter[] = [
  "all",
  "correct",
  "wrong",
  "skipped",
  "written",
  "flagged",
];

export const FILTER_LABELS: Record<ReviewFilter, string> = {
  all: "All",
  correct: "Correct",
  wrong: "Wrong",
  skipped: "Not attempted",
  written: "Written",
  flagged: "Flagged",
};

/** What each filter is for, in the candidate's terms. */
export const FILTER_HINTS: Record<ReviewFilter, string> = {
  all: "Every question in order",
  correct: "The ones you got right",
  wrong: "The ones to revise first",
  skipped: "Questions you did not answer",
  written: "Your subjective answers and their model answers",
  flagged: "Questions you marked for review during the attempt",
};

export function matchesFilter(item: ReviewItem, filter: ReviewFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "correct":
      // A self-scored written answer counts as correct only if it earned full
      // marks; a partial score is neither right nor wrong, so it shows under
      // "Written" instead of being miscounted here.
      return item.response.result === "correct" ||
        (item.response.result === "self_scored" &&
          item.response.score >= item.response.max_marks &&
          item.response.max_marks > 0);
    case "wrong":
      return item.response.result === "wrong";
    case "skipped":
      return item.response.result === "skipped";
    case "written":
      return item.question.type === "subjective";
    case "flagged":
      return item.response.marked_for_review;
  }
}

export function filterItems(
  items: readonly ReviewItem[],
  filter: ReviewFilter,
): ReviewItem[] {
  return items.filter((item) => matchesFilter(item, filter));
}

export function filterCounts(
  items: readonly ReviewItem[],
): Record<ReviewFilter, number> {
  const counts = {} as Record<ReviewFilter, number>;
  for (const filter of REVIEW_FILTERS) {
    counts[filter] = items.filter((item) => matchesFilter(item, filter)).length;
  }
  return counts;
}

/**
 * The written answers the candidate must score before a total means anything.
 *
 * An unanswered subjective question is already a definite zero and needs no
 * judgement, so it is not included: gating on it would ask someone to "score"
 * a blank page before they could see their result.
 */
export function itemsNeedingSelfScore(
  items: readonly ReviewItem[],
): ReviewItem[] {
  return items.filter(
    (item) =>
      item.question.type === "subjective" && item.response.text.trim().length > 0,
  );
}

export function needsSelfScore(review: AttemptReview): boolean {
  return itemsNeedingSelfScore(review.items).length > 0;
}

/** The colour band a result belongs to, for the palette and the chips. */
export type ResultTone = "correct" | "wrong" | "partial" | "skipped";

export function resultTone(item: ReviewItem): ResultTone {
  const { result, score, max_marks } = item.response;
  if (result === "correct") return "correct";
  if (result === "wrong") return "wrong";
  if (result === "skipped") return "skipped";
  // Self-scored: full marks reads as correct, nothing as wrong, between as
  // partial — a 3/5 answer is genuinely neither.
  if (result === "self_scored") {
    if (max_marks > 0 && score >= max_marks) return "correct";
    if (score <= 0) return "wrong";
    return "partial";
  }
  return "skipped";
}
