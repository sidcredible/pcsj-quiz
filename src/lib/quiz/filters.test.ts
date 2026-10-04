import { describe, expect, it } from "vitest";
import { SAMPLE_SET } from "./__fixtures__/sample-set";
import { buildReview } from "./review";
import { scoreAttempt } from "./score";
import {
  filterCounts,
  filterItems,
  itemsNeedingSelfScore,
  needsSelfScore,
  resultTone,
} from "./filters";

const CONTEXT = {
  attemptId: "a1",
  candidate: "Sid",
  submittedAt: "2026-10-04T16:42:00+05:30",
  mode: "practice" as const,
  negativeMarking: 0.25,
};

function review(answers: Parameters<typeof scoreAttempt>[1]) {
  return buildReview(SAMPLE_SET, scoreAttempt(SAMPLE_SET, answers, 0.25), CONTEXT);
}

const Q = (n: string) => `2026-10-04_sample_Q${n}`;

describe("filterCounts", () => {
  it("counts every bucket from one attempt", () => {
    const r = review([
      { question_id: Q("01"), chosen: ["b"] }, // correct
      { question_id: Q("02"), chosen: ["a"] }, // wrong
      { question_id: Q("03"), chosen: ["a"], marked_for_review: true }, // correct, flagged
      { question_id: Q("10"), text: "written" }, // subjective, pending
    ]);
    const counts = filterCounts(r.items);

    expect(counts.all).toBe(11);
    expect(counts.correct).toBe(2);
    expect(counts.wrong).toBe(1);
    expect(counts.written).toBe(2);
    expect(counts.flagged).toBe(1);
    // 11 total - 3 MCQ answered - 1 written = 7 untouched
    expect(counts.skipped).toBe(7);
  });

  it("adds up: correct + wrong + skipped covers every MCQ", () => {
    const r = review([
      { question_id: Q("01"), chosen: ["b"] },
      { question_id: Q("02"), chosen: ["a"] },
    ]);
    const counts = filterCounts(r.items);
    const mcqCount = SAMPLE_SET.questions.filter((q) => q.type === "mcq").length;
    // The two written answers are skipped here too, so subtract them.
    expect(counts.correct + counts.wrong + counts.skipped - 2).toBe(mcqCount);
  });

  it("is all-zero but for `all` on an untouched attempt", () => {
    const counts = filterCounts(review([]).items);
    expect(counts.correct).toBe(0);
    expect(counts.wrong).toBe(0);
    expect(counts.flagged).toBe(0);
    expect(counts.skipped).toBe(11);
    expect(counts.all).toBe(11);
  });
});

describe("filterItems", () => {
  it("returns only the wrong answers, in order", () => {
    const r = review([
      { question_id: Q("01"), chosen: ["a"] },
      { question_id: Q("02"), chosen: ["a"] },
      { question_id: Q("03"), chosen: ["a"] },
    ]);
    const wrong = filterItems(r.items, "wrong");
    expect(wrong.map((i) => i.question.number)).toEqual([1, 2]);
  });

  it("treats a fully self-scored answer as correct", () => {
    const r = review([{ question_id: Q("10"), text: "x", points_ticked: [0, 1, 2] }]);
    const correct = filterItems(r.items, "correct");
    expect(correct.map((i) => i.question.id)).toContain(Q("10"));
  });

  it("does not call a partially scored answer correct or wrong", () => {
    const r = review([{ question_id: Q("10"), text: "x", points_ticked: [0] }]);
    expect(filterItems(r.items, "correct").map((i) => i.question.id)).not.toContain(Q("10"));
    expect(filterItems(r.items, "wrong").map((i) => i.question.id)).not.toContain(Q("10"));
    expect(filterItems(r.items, "written").map((i) => i.question.id)).toContain(Q("10"));
  });
});

describe("self-score gating", () => {
  it("requires scoring only the written answers that were actually written", () => {
    const r = review([
      { question_id: Q("10"), text: "an answer" },
      // Q11 is subjective and left blank: already a definite zero.
    ]);
    const pending = itemsNeedingSelfScore(r.items);
    expect(pending.map((i) => i.question.id)).toEqual([Q("10")]);
    expect(needsSelfScore(r)).toBe(true);
  });

  it("does not gate an attempt with no written answers at all", () => {
    const r = review([{ question_id: Q("01"), chosen: ["b"] }]);
    expect(needsSelfScore(r)).toBe(false);
    expect(itemsNeedingSelfScore(r.items)).toEqual([]);
  });

  it("ignores a written answer that is only whitespace", () => {
    const r = review([{ question_id: Q("10"), text: "   \n  " }]);
    expect(needsSelfScore(r)).toBe(false);
  });

  it("still gates when the answer was scored zero, since zero is a judgement", () => {
    const r = review([{ question_id: Q("10"), text: "wrong answer" }]);
    expect(needsSelfScore(r)).toBe(true);
  });
});

describe("resultTone", () => {
  const toneOf = (answers: Parameters<typeof scoreAttempt>[1], id: string) =>
    resultTone(review(answers).items.find((i) => i.question.id === id)!);

  it("maps the plain MCQ results", () => {
    expect(toneOf([{ question_id: Q("01"), chosen: ["b"] }], Q("01"))).toBe("correct");
    expect(toneOf([{ question_id: Q("01"), chosen: ["a"] }], Q("01"))).toBe("wrong");
    expect(toneOf([], Q("01"))).toBe("skipped");
  });

  it("separates a partial written score from full and zero", () => {
    expect(toneOf([{ question_id: Q("10"), text: "x", points_ticked: [0, 1, 2] }], Q("10"))).toBe("correct");
    expect(toneOf([{ question_id: Q("10"), text: "x", points_ticked: [0] }], Q("10"))).toBe("partial");
    expect(toneOf([{ question_id: Q("10"), text: "x", points_ticked: [] }], Q("10"))).toBe("skipped");
  });
});
