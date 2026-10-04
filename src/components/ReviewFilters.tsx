"use client";

/**
 * Filtering and jumping around the result.
 *
 * Fifty questions is too many to scroll through looking for the ones that went
 * wrong, which is the thing a candidate actually came here to do. The chips
 * narrow the list by outcome and carry their counts, so "how many did I get
 * wrong" is answered without opening anything; the grid below jumps straight
 * to a question and colours each by its outcome.
 *
 * Every colour is paired with a count and a label, never used alone.
 */

import type { ReviewItem } from "@/lib/quiz/review";
import {
  FILTER_HINTS,
  FILTER_LABELS,
  REVIEW_FILTERS,
  resultTone,
  type ResultTone,
  type ReviewFilter,
} from "@/lib/quiz/filters";
import { Muted } from "./primitives";

const TONE_STYLE: Record<ResultTone, { bg: string; fg: string; border: string }> = {
  correct: { bg: "var(--correct-soft)", fg: "var(--correct)", border: "var(--correct)" },
  wrong: { bg: "var(--wrong-soft)", fg: "var(--wrong)", border: "var(--wrong)" },
  partial: { bg: "var(--partial-soft)", fg: "var(--partial)", border: "var(--partial)" },
  skipped: { bg: "var(--surface)", fg: "var(--muted)", border: "var(--border)" },
};

const TONE_LABEL: Record<ResultTone, string> = {
  correct: "correct",
  wrong: "wrong",
  partial: "partly correct",
  skipped: "not attempted",
};

export function ReviewFilters({
  counts,
  active,
  onChange,
}: {
  counts: Record<ReviewFilter, number>;
  active: ReviewFilter;
  onChange: (filter: ReviewFilter) => void;
}) {
  return (
    <nav aria-label="Filter results" className="mb-3">
      <div className="chip-row">
        {REVIEW_FILTERS.map((filter) => {
          const count = counts[filter];
          // A bucket with nothing in it stays visible but unusable, so the row
          // does not reflow as the filter changes.
          const empty = count === 0 && filter !== "all";
          return (
            <button
              key={filter}
              type="button"
              className="chip"
              aria-pressed={active === filter}
              disabled={empty}
              title={FILTER_HINTS[filter]}
              onClick={() => onChange(filter)}
            >
              {FILTER_LABELS[filter]}
              <span className="chip-count">{count}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs">
        <Muted>{FILTER_HINTS[active]}</Muted>
      </p>
    </nav>
  );
}

export function ResultPalette({
  items,
  onJump,
}: {
  items: ReviewItem[];
  onJump: (questionId: string) => void;
}) {
  return (
    <nav aria-label="Jump to a question" className="mb-4">
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const tone = resultTone(item);
          const style = TONE_STYLE[tone];
          return (
            <button
              key={item.question.id}
              type="button"
              onClick={() => onJump(item.question.id)}
              aria-label={`Question ${item.question.number}, ${TONE_LABEL[tone]}`}
              className="h-9 w-9 rounded-md border text-sm font-semibold tabular-nums"
              style={{
                background: style.bg,
                color: style.fg,
                borderColor: style.border,
              }}
            >
              {item.question.number}
            </button>
          );
        })}
      </div>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {(["correct", "partial", "wrong", "skipped"] as ResultTone[]).map((tone) => (
          <li key={tone} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded border"
              style={{
                background: TONE_STYLE[tone].bg,
                borderColor: TONE_STYLE[tone].border,
              }}
            />
            <Muted>{TONE_LABEL[tone]}</Muted>
          </li>
        ))}
      </ul>
    </nav>
  );
}
