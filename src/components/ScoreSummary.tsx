"use client";

/**
 * The result header: what the candidate scored, broken out by question type
 * and combined.
 *
 * A handful of headline numbers is a KPI row of stat tiles, not a chart — so
 * there is one hero figure for the number the screen leads with (the combined
 * total) and a meter per ratio against its maximum. The hero is sans with
 * proportional figures: a serif reads as decoration at that size, and tabular
 * figures space out badly, which is why they are kept for the aligned columns
 * inside the tiles.
 *
 * MCQ and written are shown as their own totals and then combined, because
 * they are scored by different means — one automatically, one by the candidate
 * against a rubric — and a single number hides which of the two a bad result
 * came from.
 */

import type { AttemptTotals } from "@/lib/quiz/score";
import { Muted } from "./primitives";

/** One decimal at most: "4.67%" is noise on a score, "4.7%" is not. */
function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function percentOf(score: number, max: number): number {
  if (max <= 0) return 0;
  // A negative total from negative marking should empty the meter, not invert it.
  return Math.max(0, Math.min(100, Math.round((score / max) * 100)));
}

function Meter({ score, max, label }: { score: number; max: number; label: string }) {
  const percent = percentOf(score, max);
  return (
    <div
      className="meter mt-2"
      role="meter"
      aria-valuenow={score}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <div className="meter-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

function StatTile({
  label,
  score,
  max,
  detail,
  note,
}: {
  label: string;
  score: number;
  max: number;
  detail?: string;
  note?: string;
}) {
  return (
    <div className="stat-tile">
      <p className="text-xs font-semibold uppercase tracking-wide">
        <Muted>{label}</Muted>
      </p>
      <p className="stat-value mt-1">
        {score}
        <span className="of"> / {max}</span>
      </p>
      <Meter score={score} max={max} label={`${label}: ${score} out of ${max}`} />
      {detail ? (
        <p className="mt-2 text-xs tabular-nums">
          <Muted>{detail}</Muted>
        </p>
      ) : null}
      {note ? (
        <p className="mt-1 text-xs" style={{ color: "var(--flag)" }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

export function ScoreSummary({
  totals,
  negativeMarking,
}: {
  totals: AttemptTotals;
  negativeMarking: number;
}) {
  const hasSubjective = totals.subjective_max > 0;
  const hasMcq = totals.mcq_max > 0;

  return (
    <section className="card mb-4 px-4 py-4" aria-label="Your score">
      <p className="text-xs font-semibold uppercase tracking-wide">
        <Muted>Total score</Muted>
      </p>

      <p className="hero-figure mt-1">
        {totals.total_score}
        <span className="of"> / {totals.max_score}</span>
      </p>

      <p className="mt-1 text-sm">
        <Muted>{formatPercent(totals.percent)}% overall</Muted>
      </p>

      <Meter
        score={totals.total_score}
        max={totals.max_score}
        label={`Total: ${totals.total_score} out of ${totals.max_score}`}
      />

      {/* The two components of that total, each scored a different way. */}
      {hasMcq && hasSubjective ? (
        <div className="mt-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
          <StatTile
            label="MCQ"
            score={totals.mcq_score}
            max={totals.mcq_max}
            detail={`${totals.correct} right · ${totals.wrong} wrong · ${totals.skipped} not attempted`}
            {...(negativeMarking > 0
              ? { note: `${negativeMarking} deducted per wrong answer` }
              : {})}
          />
          <StatTile
            label="Written"
            score={totals.subjective_score}
            max={totals.subjective_max}
            detail="Self-scored against the marking points"
            {...(totals.pending_self_score > 0
              ? {
                  note: `${totals.pending_self_score} still to score`,
                }
              : {})}
          />
        </div>
      ) : null}

      {/* A single-type quiz needs no breakdown: the hero already is it. */}
      {hasMcq && !hasSubjective ? (
        <p className="mt-3 text-sm tabular-nums">
          <Muted>
            {totals.correct} right · {totals.wrong} wrong · {totals.skipped} not
            attempted
          </Muted>
        </p>
      ) : null}
    </section>
  );
}
