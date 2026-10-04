import { describe, expect, it } from "vitest";
import { SAMPLE_SET } from "./__fixtures__/sample-set";
import { sameKeySet, scoreAttempt, scoreResponse, totalsFor } from "./score";
import { maxMarks, maxMarksOfType } from "./types";

const q = (id: string) => SAMPLE_SET.questions.find((x) => x.id === id)!;
const Q1 = q("2026-10-04_sample_Q01"); // direct MCQ, 1 mark, answer ["b"]
const Q2 = q("2026-10-04_sample_Q02"); // MCQ with explicit marks: 2
const Q8 = q("2026-10-04_sample_Q08"); // multi-correct, answer ["a","b"]
const Q10 = q("2026-10-04_sample_Q10"); // subjective, 3 marks, 3 rubric points
const Q11 = q("2026-10-04_sample_Q11"); // subjective, 10 marks

describe("sameKeySet", () => {
  it("ignores order and duplicates", () => {
    expect(sameKeySet(["b", "a"], ["a", "b"])).toBe(true);
    expect(sameKeySet(["a", "a", "b"], ["a", "b"])).toBe(true);
  });

  it("rejects subsets and supersets", () => {
    expect(sameKeySet(["a"], ["a", "b"])).toBe(false);
    expect(sameKeySet(["a", "b", "c"], ["a", "b"])).toBe(false);
    expect(sameKeySet([], ["a"])).toBe(false);
  });
});

describe("scoreResponse: MCQ", () => {
  it("awards the question's marks for an exact match", () => {
    const r = scoreResponse(Q1, { question_id: Q1.id, chosen: ["b"] }, 0);
    expect(r.result).toBe("correct");
    expect(r.score).toBe(1);
  });

  it("uses the file's marks rather than the default of 1", () => {
    const r = scoreResponse(Q2, { question_id: Q2.id, chosen: ["b"] }, 0);
    expect(r.score).toBe(2);
    expect(r.max_marks).toBe(2);
  });

  it("marks a wrong pick wrong and applies no penalty at 0", () => {
    const r = scoreResponse(Q1, { question_id: Q1.id, chosen: ["a"] }, 0);
    expect(r.result).toBe("wrong");
    expect(r.score).toBe(0);
  });

  it("scales the penalty by the question's marks", () => {
    const r = scoreResponse(Q2, { question_id: Q2.id, chosen: ["a"] }, 0.25);
    expect(r.score).toBe(-0.5);
  });

  it("treats nothing chosen as skipped, never penalised", () => {
    const r = scoreResponse(Q1, { question_id: Q1.id, chosen: [] }, 0.25);
    expect(r.result).toBe("skipped");
    expect(r.score).toBe(0);
  });

  it("treats an absent submission as skipped", () => {
    const r = scoreResponse(Q1, undefined, 0.25);
    expect(r.result).toBe("skipped");
    expect(r.score).toBe(0);
  });

  it("requires every key of a multi-correct answer", () => {
    expect(
      scoreResponse(Q8, { question_id: Q8.id, chosen: ["a", "b"] }, 0).result,
    ).toBe("correct");
    // A partial pick is wrong, not partially credited.
    expect(scoreResponse(Q8, { question_id: Q8.id, chosen: ["a"] }, 0).result).toBe(
      "wrong",
    );
    expect(
      scoreResponse(Q8, { question_id: Q8.id, chosen: ["a", "b", "c"] }, 0).result,
    ).toBe("wrong");
  });
});

describe("scoreResponse: subjective", () => {
  it("is pending until the candidate ticks rubric points", () => {
    const r = scoreResponse(Q10, { question_id: Q10.id, text: "s.10, 5-7 yrs" }, 0);
    expect(r.result).toBe("pending_self_score");
    expect(r.score).toBe(0);
  });

  it("treats whitespace-only text as skipped", () => {
    const r = scoreResponse(Q10, { question_id: Q10.id, text: "   \n " }, 0);
    expect(r.result).toBe("skipped");
  });

  it("sums the ticked points, decimals included", () => {
    const r = scoreResponse(
      Q10,
      { question_id: Q10.id, text: "answer", points_ticked: [0, 1] },
      0,
    );
    expect(r.result).toBe("self_scored");
    expect(r.score).toBe(2.5);
  });

  it("caps the self-score at the question's marks", () => {
    const r = scoreResponse(
      Q10,
      { question_id: Q10.id, text: "answer", points_ticked: [0, 1, 2, 2, 99] },
      0,
    );
    expect(r.score).toBe(3);
  });

  it("never penalises a subjective question", () => {
    const r = scoreResponse(Q11, { question_id: Q11.id, text: "" }, 0.25);
    expect(r.score).toBe(0);
  });
});

describe("scoreAttempt", () => {
  it("scores every question in the set, submitted or not", () => {
    const { responses } = scoreAttempt(SAMPLE_SET, [], 0);
    expect(responses).toHaveLength(SAMPLE_SET.questions.length);
    expect(responses.every((r) => r.result === "skipped")).toBe(true);
  });

  it("reports MCQ, subjective and overall totals separately", () => {
    const { totals } = scoreAttempt(
      SAMPLE_SET,
      [
        { question_id: Q1.id, chosen: ["b"] }, // correct, +1
        { question_id: Q2.id, chosen: ["a"] }, // wrong, -0.5 at 0.25
        { question_id: Q8.id, chosen: ["a", "b"] }, // correct, +1
        { question_id: Q10.id, text: "x", points_ticked: [0] }, // +1
      ],
      0.25,
    );
    expect(totals.correct).toBe(2);
    expect(totals.wrong).toBe(1);
    expect(totals.mcq_score).toBe(1.5);
    expect(totals.subjective_score).toBe(1);
    expect(totals.total_score).toBe(2.5);
    expect(totals.mcq_max).toBe(maxMarksOfType(SAMPLE_SET.questions, "mcq"));
    expect(totals.subjective_max).toBe(
      maxMarksOfType(SAMPLE_SET.questions, "subjective"),
    );
    expect(totals.max_score).toBe(maxMarks(SAMPLE_SET.questions));
    expect(totals.attempted).toBe(4);
  });

  it("counts questions still awaiting a self-score", () => {
    const { totals } = scoreAttempt(
      SAMPLE_SET,
      [
        { question_id: Q10.id, text: "written" },
        { question_id: Q11.id, text: "written" },
      ],
      0,
    );
    expect(totals.pending_self_score).toBe(2);
  });

  it("keeps percent at 0 rather than dividing by zero", () => {
    const empty = { questions: [] };
    expect(totalsFor(empty, []).percent).toBe(0);
  });

  it("does not let float addition leak into a score", () => {
    const { totals } = scoreAttempt(
      SAMPLE_SET,
      [{ question_id: Q10.id, text: "x", points_ticked: [1, 2] }],
      0,
    );
    expect(totals.subjective_score).toBe(2);
  });
});
