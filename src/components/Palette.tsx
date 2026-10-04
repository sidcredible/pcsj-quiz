"use client";

/**
 * The question palette: answered, skipped and marked-for-review at a glance,
 * and a jump to any question. Sized for a thumb and wraps freely, so 50
 * questions fit a 360px screen without sideways scrolling.
 *
 * On a tablet in landscape the same palette goes in a column beside the
 * question (`variant="sidebar"`), where it sticks to the top of the viewport
 * instead of sitting below the answer controls.
 */

import type { CandidateQuestion } from "@/lib/quiz/redact";

export type PaletteState = "answered" | "skipped" | "review" | "current";

export function paletteState(
  question: CandidateQuestion,
  answer: { chosen: string[]; text: string; markedForReview: boolean } | undefined,
  isCurrent: boolean,
): PaletteState {
  if (isCurrent) return "current";
  if (answer?.markedForReview) return "review";
  const answered =
    question.type === "mcq"
      ? (answer?.chosen.length ?? 0) > 0
      : (answer?.text.trim().length ?? 0) > 0;
  return answered ? "answered" : "skipped";
}

const STYLES: Record<PaletteState, { background: string; color: string; border: string }> =
  {
    current: {
      background: "var(--accent)",
      color: "#fff",
      border: "var(--accent)",
    },
    answered: {
      background: "var(--correct-soft)",
      color: "var(--correct)",
      border: "var(--correct)",
    },
    review: {
      background: "var(--flag-soft)",
      color: "var(--flag)",
      border: "var(--flag)",
    },
    skipped: {
      background: "var(--surface)",
      color: "var(--muted)",
      border: "var(--border)",
    },
  };

const LABELS: Record<PaletteState, string> = {
  current: "current",
  answered: "answered",
  review: "marked for review",
  skipped: "not answered",
};

export function Palette({
  questions,
  states,
  onJump,
  variant = "inline",
}: {
  questions: CandidateQuestion[];
  states: PaletteState[];
  onJump: (index: number) => void;
  variant?: "inline" | "sidebar";
}) {
  const sidebar = variant === "sidebar";

  return (
    <nav
      aria-label="Question palette"
      className={sidebar ? "palette-aside card px-3 py-3" : "mt-4"}
    >
      {sidebar ? (
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide">
          <span style={{ color: "var(--muted)" }}>Questions</span>
        </h2>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {questions.map((question, index) => {
          const state = states[index] ?? "skipped";
          const palette = STYLES[state];
          return (
            <button
              key={question.id}
              type="button"
              onClick={() => onJump(index)}
              aria-label={`Question ${question.number}, ${LABELS[state]}`}
              aria-current={state === "current" ? "true" : undefined}
              className="h-10 w-10 touch-manipulation rounded-md border text-sm font-semibold tabular-nums md:h-11 md:w-11"
              style={{
                background: palette.background,
                color: palette.color,
                borderColor: palette.border,
              }}
            >
              {question.number}
            </button>
          );
        })}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {(["answered", "skipped", "review"] as PaletteState[]).map((state) => (
          <li key={state} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded border"
              style={{
                background: STYLES[state].background,
                borderColor: STYLES[state].border,
              }}
            />
            <span style={{ color: "var(--muted)" }}>{LABELS[state]}</span>
          </li>
        ))}
      </ul>
    </nav>
  );
}
