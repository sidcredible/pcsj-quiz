"use client";

/**
 * The answer controls on the attempt screen: radio options for a single
 * correct answer, checkboxes when the file's answer has more than one key, and
 * a textarea with a live word count for subjective items.
 */

import type { CandidateQuestion } from "@/lib/quiz/redact";
import { Muted, QuizText } from "./primitives";

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}

export function OptionList({
  question,
  chosen,
  onChange,
}: {
  question: CandidateQuestion;
  chosen: string[];
  onChange: (keys: string[]) => void;
}) {
  const options = question.options ?? [];
  const multi = question.multi_select;

  function toggle(key: string) {
    if (!multi) {
      // Tapping the chosen option again clears it, so a candidate can un-answer
      // a question rather than being stuck with a guess.
      onChange(chosen.includes(key) ? [] : [key]);
      return;
    }
    onChange(
      chosen.includes(key)
        ? chosen.filter((existing) => existing !== key)
        : [...chosen, key].sort(),
    );
  }

  return (
    <fieldset className="mt-4">
      <legend className="sr-only">
        {multi ? "Select all that apply" : "Select one option"}
      </legend>
      {multi ? (
        <p className="mb-2 text-xs">
          <Muted>More than one option is correct.</Muted>
        </p>
      ) : null}
      <div className="space-y-2">
        {options.map((option) => {
          const selected = chosen.includes(option.key);
          return (
            <label
              key={option.key}
              className="option"
              data-selected={selected}
            >
              <input
                type={multi ? "checkbox" : "radio"}
                name={`q-${question.id}`}
                value={option.key}
                checked={selected}
                onChange={() => toggle(option.key)}
                className="sr-only"
              />
              <span className="option-key" aria-hidden>
                ({option.key})
              </span>
              <QuizText className="flex-1">{option.text}</QuizText>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Styles that need room to write; the rest get a compact box. */
const TALL_STYLES = new Set(["drafting", "judgment_writing", "essay"]);

export function SubjectiveAnswer({
  question,
  text,
  onChange,
}: {
  question: CandidateQuestion;
  text: string;
  onChange: (text: string) => void;
}) {
  const words = countWords(text);
  const limit = question.word_limit;
  const tall = TALL_STYLES.has(question.subjective_style ?? "");
  const over = typeof limit === "number" && words > limit * 1.25;

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>
          <Muted>
            [{question.marks} {question.marks === 1 ? "mark" : "marks"}
            {typeof limit === "number" ? `, about ${limit} words` : ""}]
          </Muted>
        </span>
        <span
          className="text-xs"
          style={{ color: over ? "var(--flag)" : "var(--muted)" }}
          aria-live="polite"
        >
          {words} {words === 1 ? "word" : "words"}
        </span>
      </div>
      <textarea
        className="field quiz-text"
        rows={tall ? 14 : 6}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Write your answer here."
        aria-label={`Answer to question ${question.number}`}
      />
    </div>
  );
}
