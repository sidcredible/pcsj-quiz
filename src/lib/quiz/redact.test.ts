import { describe, expect, it } from "vitest";
import { SAMPLE_SET } from "./__fixtures__/sample-set";
import {
  compositionLine,
  suggestedMinutes,
  toCandidateQuiz,
  toSummary,
} from "./redact";

const FORBIDDEN = [
  "answer",
  "explanation",
  "why_correct",
  "why_others_wrong",
  "model_answer",
  "marking_points",
  "marks_awarded",
  "pyq_original",
  "answer_provenance",
  "verification",
  "excluded_pyqs",
  "source_answer",
  "exam_tip",
  "provisions",
];

describe("toCandidateQuiz", () => {
  const candidate = toCandidateQuiz(SAMPLE_SET);
  const serialised = JSON.stringify(candidate);

  it("carries no answer key or feedback anywhere in the payload", () => {
    // Key-level check: no forbidden key survives at any depth.
    const keys = new Set<string>();
    JSON.parse(serialised, function collect(this: unknown, key: string, value: unknown) {
      if (key) keys.add(key);
      return value;
    });
    for (const forbidden of FORBIDDEN) {
      expect(keys.has(forbidden), `payload leaked "${forbidden}"`).toBe(false);
    }
  });

  it("does not leak the text of a model answer or explanation", () => {
    // Value-level check, in case a field is ever renamed rather than removed.
    expect(serialised).not.toContain("Aggravated sexual assault under s.9");
    expect(serialised).not.toContain("Section 2(1)(d) defines a child");
    expect(serialised).not.toContain("Quote the five-to-seven-year range");
  });

  it("keeps every question and its presentation fields", () => {
    expect(candidate.questions).toHaveLength(SAMPLE_SET.questions.length);
    const statementQ = candidate.questions.find(
      (q) => q.mcq_style === "statement_based",
    )!;
    expect(statementQ.statements).toHaveLength(2);
    const matchQ = candidate.questions.find((q) => q.mcq_style === "match_list")!;
    expect(matchQ.match?.list_i).toHaveLength(3);
    const arQ = candidate.questions.find((q) => q.mcq_style === "assertion_reason")!;
    expect(arQ.assertion).toBeTruthy();
    expect(arQ.reason).toBeTruthy();
  });

  it("flags a multi-correct MCQ so the UI can use checkboxes", () => {
    const multi = candidate.questions.find((q) => q.id.endsWith("Q08"))!;
    expect(multi.multi_select).toBe(true);
    const single = candidate.questions.find((q) => q.id.endsWith("Q01"))!;
    expect(single.multi_select).toBe(false);
  });

  it("applies the MCQ default of 1 mark and keeps explicit marks", () => {
    const def = candidate.questions.find((q) => q.id.endsWith("Q01"))!;
    expect(def.marks).toBe(1);
    const explicit = candidate.questions.find((q) => q.id.endsWith("Q02"))!;
    expect(explicit.marks).toBe(2);
  });

  it("exposes PYQ badges only for real previous-year questions", () => {
    const pyq = candidate.questions.find((q) => q.id.endsWith("Q09"))!;
    expect(pyq.pyq_badges).toEqual([
      { exam: "DJS", stage: "prelims", year: 2019 },
    ]);
    const notPyq = candidate.questions.find((q) => q.id.endsWith("Q01"))!;
    expect(notPyq.pyq_badges).toBeUndefined();
  });

  it("computes counts and maxima from the file, not from request", () => {
    expect(candidate.question_count).toBe(SAMPLE_SET.questions.length);
    expect(candidate.question_count).toBeGreaterThan(
      SAMPLE_SET.request.question_count,
    );
    // 8 MCQ at 1 mark + one at 2 marks = 10; subjective 3 + 10 = 13.
    expect(candidate.mcq_max_marks).toBe(10);
    expect(candidate.subjective_max_marks).toBe(13);
    expect(candidate.max_marks).toBe(23);
  });

  it("keeps the start-screen notes a candidate is allowed to see", () => {
    expect(candidate.law_basis).toContain("Protection of Children");
    expect(candidate.pattern_notes).toContain("prelims");
  });
});

describe("toSummary", () => {
  it("includes no question content at all", () => {
    const serialised = JSON.stringify(toSummary(SAMPLE_SET));
    expect(serialised).not.toContain("a 'child' means");
  });

  it("lists the types and subjects present for the list filters", () => {
    const summary = toSummary(SAMPLE_SET);
    expect(summary.question_types).toEqual(["mcq", "subjective"]);
    expect(summary.subject_codes).toEqual(["DRAFTING", "SPECIAL"]);
    expect(summary.heading).toBe(SAMPLE_SET.title);
  });

  it("falls back to the topic when the file has no title", () => {
    const untitled = { ...SAMPLE_SET };
    delete untitled.title;
    expect(toSummary(untitled).heading).toBe("POCSO");
  });
});

describe("compositionLine", () => {
  it("reads as the handbook's example", () => {
    expect(
      compositionLine(
        { requested: 50, pyq: 16, judgment: 14, generated: 20, total: 50 },
        50,
      ),
    ).toBe("50 questions: 16 previous-year, 14 from judgments, 20 new");
  });

  it("omits the buckets that are empty", () => {
    expect(
      compositionLine(
        { requested: 5, pyq: 0, judgment: 0, generated: 5, total: 5 },
        5,
      ),
    ).toBe("5 questions: 5 new");
  });

  it("uses the real count even when composition.total disagrees", () => {
    expect(
      compositionLine(
        { requested: 10, pyq: 1, judgment: 1, generated: 9, total: 99 },
        11,
      ),
    ).toContain("11 questions");
  });
});

describe("suggestedMinutes", () => {
  it("gives a minute per MCQ and a minute per 10 words", () => {
    expect(
      suggestedMinutes([
        { type: "mcq", marks: 1 },
        { type: "mcq", marks: 1 },
        { type: "subjective", marks: 3, word_limit: 30 },
      ]),
    ).toBe(5);
  });

  it("budgets a subjective item that carries no word limit", () => {
    expect(suggestedMinutes([{ type: "subjective", marks: 10 }])).toBe(10);
  });

  it("never suggests zero minutes", () => {
    expect(suggestedMinutes([])).toBe(1);
  });
});
