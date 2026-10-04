import { describe, expect, it } from "vitest";
import { consistencyWarnings, validateQuizSet } from "./validate";
import { SAMPLE_SET } from "./__fixtures__/sample-set";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("validateQuizSet", () => {
  it("accepts the sample set against the real schema", () => {
    const result = validateQuizSet(clone(SAMPLE_SET));
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.set.set_id).toBe("2026-10-04_sample");
  });

  it("rejects a wrong schema_version with a readable message", () => {
    const set = clone(SAMPLE_SET) as unknown as { schema_version: string };
    set.schema_version = "1.0";
    const result = validateQuizSet(set);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain('expected "1.1"');
  });

  it("rejects a non-object file", () => {
    expect(validateQuizSet("[]").ok).toBe(false);
    expect(validateQuizSet([]).ok).toBe(false);
    expect(validateQuizSet(null).ok).toBe(false);
  });

  it("names the offending path when a question is malformed", () => {
    const set = clone(SAMPLE_SET);
    // @ts-expect-error deliberately breaking the contract
    delete set.questions[0].answer;
    const result = validateQuizSet(set);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("questions/0");
  });

  it("rejects a set_id that breaks the date_slug pattern", () => {
    const set = clone(SAMPLE_SET);
    set.set_id = "pocso-set";
    const result = validateQuizSet(set);
    expect(result.ok).toBe(false);
  });

  it("rejects a resource url that is not https", () => {
    const set = clone(SAMPLE_SET);
    set.questions[0]!.resources[0]!.url = "http://example.com/act";
    expect(validateQuizSet(set).ok).toBe(false);
  });

  it("requires full provenance when basis is pyq", () => {
    const set = clone(SAMPLE_SET);
    const pyq = set.questions.find((q) => q.basis === "pyq")!;
    delete pyq.source_pyqs;
    expect(validateQuizSet(set).ok).toBe(false);
  });

  it("requires marking_points on a subjective question", () => {
    const set = clone(SAMPLE_SET);
    const subjective = set.questions.find((q) => q.type === "subjective")!;
    delete subjective.marking_points;
    expect(validateQuizSet(set).ok).toBe(false);
  });
});

describe("consistencyWarnings", () => {
  it("is quiet about a composition.total that exceeds requested", () => {
    // total 11 vs requested 10 is normal and must not warn; total vs the real
    // question count is what matters.
    const warnings = consistencyWarnings(SAMPLE_SET);
    expect(warnings).toEqual([]);
  });

  it("warns when composition.total disagrees with the question count", () => {
    const set = clone(SAMPLE_SET);
    set.composition.total = 99;
    const warnings = consistencyWarnings(set);
    expect(warnings.join(" ")).toContain("using the real count");
  });

  it("warns when an answer key is not among the options", () => {
    const set = clone(SAMPLE_SET);
    set.questions[0]!.answer = ["z"];
    expect(consistencyWarnings(set).join(" ")).toContain("not one of its options");
  });

  it("warns when a rubric does not sum to the question's marks", () => {
    const set = clone(SAMPLE_SET);
    const subjective = set.questions.find((q) => q.type === "subjective")!;
    subjective.marking_points![0]!.marks = 5;
    expect(consistencyWarnings(set).join(" ")).toContain("marking_points sum");
  });

  it("warns when a question id belongs to another set", () => {
    const set = clone(SAMPLE_SET);
    set.questions[0]!.id = "2026-10-04_other_Q01";
    expect(consistencyWarnings(set).join(" ")).toContain("does not belong");
  });
});
