import { describe, expect, it } from "vitest";
import { SAMPLE_SET } from "./__fixtures__/sample-set";
import { buildReview } from "./review";
import { scoreAttempt } from "./score";

const CONTEXT = {
  attemptId: "attempt-1",
  candidate: "Sid",
  submittedAt: "2026-10-04T16:42:00+05:30",
  mode: "practice" as const,
  negativeMarking: 0.25,
};

const scored = scoreAttempt(
  SAMPLE_SET,
  [
    { question_id: "2026-10-04_sample_Q01", chosen: ["a"] },
    { question_id: "2026-10-04_sample_Q10", text: "s.10" },
  ],
  0.25,
);
const review = buildReview(SAMPLE_SET, scored, CONTEXT);
const item = (id: string) => review.items.find((i) => i.question.id === id)!;

describe("buildReview", () => {
  it("covers every question in the set", () => {
    expect(review.items).toHaveLength(SAMPLE_SET.questions.length);
  });

  it("releases the answer key and explanation after submit", () => {
    const first = item("2026-10-04_sample_Q01");
    expect(first.response.correct_answer).toEqual(["b"]);
    expect(first.feedback.why_correct).toContain("Section 2(1)(d)");
    expect(first.feedback.why_others_wrong?.a).toBeTruthy();
  });

  it("gives a subjective item its model answer and rubric", () => {
    const subjective = item("2026-10-04_sample_Q10");
    expect(subjective.feedback.model_answer).toContain("five years");
    expect(subjective.feedback.marking_points).toHaveLength(3);
    expect(subjective.response.result).toBe("pending_self_score");
  });

  it("offers the original PYQ and the adaptation note", () => {
    const pyq = item("2026-10-04_sample_Q09");
    expect(pyq.feedback.pyq_original?.question).toContain(
      "Protection of Children from Sexual Offences Act extends to",
    );
    expect(pyq.feedback.pyq_original?.adaptation_note).toBe(
      "No new-law change needed.",
    );
  });

  it("omits the PYQ toggle for a generated question", () => {
    expect(item("2026-10-04_sample_Q01").feedback.pyq_original).toBeUndefined();
  });

  it("carries the style and basis for per-style review rendering", () => {
    expect(item("2026-10-04_sample_Q05").question.style).toBe("match_list");
    expect(item("2026-10-04_sample_Q10").question.style).toBe("short_answer");
    expect(item("2026-10-04_sample_Q06").question.basis).toBe("judgment_based");
  });

  it("defaults empty feedback lists rather than leaving them undefined", () => {
    const subjective = item("2026-10-04_sample_Q10");
    expect(subjective.feedback.cases).toEqual([]);
    expect(subjective.feedback.resources).toEqual([]);
  });

  it("includes the totals and the composition line for the summary", () => {
    expect(review.totals.max_score).toBe(23);
    expect(review.quiz.composition_line).toContain("11 questions");
    expect(review.negative_marking).toBe(0.25);
    expect(review.attempt_id).toBe("attempt-1");
  });

  it("keeps the audit fields out even after submit", () => {
    // excluded_pyqs and verification are "store, do not show" per section 3.
    const serialised = JSON.stringify(review);
    expect(serialised).not.toContain("excluded_pyqs");
    expect(serialised).not.toContain("partially_verified");
    expect(serialised).not.toContain("checked_against");
  });
});
