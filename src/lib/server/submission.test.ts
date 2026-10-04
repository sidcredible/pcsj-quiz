import { describe, expect, it } from "vitest";
import { parseAnswers, parseSelfScores, parseSubmission } from "./submission";

const UUID = "11111111-2222-4333-8444-555555555555";

const valid = {
  attempt_id: UUID,
  set_id: "2026-10-04_pocso",
  candidate: "Sid",
  started_at: "2026-10-04T16:00:00+05:30",
  answers: [{ question_id: "2026-10-04_pocso_Q01", chosen: ["b"] }],
};

describe("parseSubmission", () => {
  it("accepts a well-formed submission", () => {
    const parsed = parseSubmission(valid, 0);
    expect(parsed.setId).toBe("2026-10-04_pocso");
    expect(parsed.mode).toBe("practice");
    expect(parsed.device).toBe("mobile");
    expect(parsed.negativeMarking).toBe(0);
  });

  it("requires a UUID attempt_id so a retry stays idempotent", () => {
    expect(() => parseSubmission({ ...valid, attempt_id: "abc" }, 0)).toThrow(
      "must be a UUID",
    );
  });

  it("requires set_id and candidate", () => {
    expect(() => parseSubmission({ ...valid, set_id: "" }, 0)).toThrow(
      "set_id is required",
    );
    expect(() => parseSubmission({ ...valid, candidate: "  " }, 0)).toThrow(
      "candidate is required",
    );
  });

  it("falls back to the configured negative marking", () => {
    expect(parseSubmission(valid, 0.25).negativeMarking).toBe(0.25);
  });

  it("takes a per-attempt negative marking over the default", () => {
    expect(
      parseSubmission({ ...valid, negative_marking: 0.33 }, 0).negativeMarking,
    ).toBe(0.33);
  });

  it("rejects a negative or out-of-range penalty", () => {
    expect(() =>
      parseSubmission({ ...valid, negative_marking: -1 }, 0),
    ).toThrow("non-negative");
    expect(() =>
      parseSubmission({ ...valid, negative_marking: 2 }, 0),
    ).toThrow("between 0 and 1");
  });

  it("normalises mode and device to the allowed values", () => {
    const parsed = parseSubmission(
      { ...valid, mode: "nonsense", device: "desktop" },
      0,
    );
    expect(parsed.mode).toBe("practice");
    expect(parsed.device).toBe("desktop");
  });

  it("trims the candidate name", () => {
    expect(parseSubmission({ ...valid, candidate: "  Sid  " }, 0).candidate).toBe(
      "Sid",
    );
  });

  it("rejects an absurdly long candidate name", () => {
    expect(() =>
      parseSubmission({ ...valid, candidate: "x".repeat(300) }, 0),
    ).toThrow("longer than");
  });
});

describe("parseAnswers", () => {
  it("treats a missing answers list as an empty attempt", () => {
    expect(parseAnswers(undefined)).toEqual([]);
  });

  it("keeps the behavioural flags", () => {
    const [answer] = parseAnswers([
      {
        question_id: "q1",
        chosen: ["a", "c"],
        time_spent_sec: 41.6,
        changed_answer: true,
        marked_for_review: true,
        confidence: "guess",
      },
    ]);
    expect(answer).toEqual({
      question_id: "q1",
      chosen: ["a", "c"],
      time_spent_sec: 42,
      changed_answer: true,
      marked_for_review: true,
      confidence: "guess",
    });
  });

  it("omits empty optional fields rather than sending blanks", () => {
    expect(parseAnswers([{ question_id: "q1" }])).toEqual([
      { question_id: "q1" },
    ]);
  });

  it("rejects an option key outside a-e", () => {
    expect(() => parseAnswers([{ question_id: "q1", chosen: ["z"] }])).toThrow(
      "option keys a-e",
    );
    expect(() =>
      parseAnswers([{ question_id: "q1", chosen: ["a", 2] }]),
    ).toThrow("option keys a-e");
  });

  it("rejects the same question twice", () => {
    expect(() =>
      parseAnswers([{ question_id: "q1" }, { question_id: "q1" }]),
    ).toThrow("twice");
  });

  it("rejects a non-integer or negative rubric index", () => {
    expect(() =>
      parseAnswers([{ question_id: "q1", points_ticked: [1.5] }]),
    ).toThrow("non-negative integers");
    expect(() =>
      parseAnswers([{ question_id: "q1", points_ticked: [-1] }]),
    ).toThrow("non-negative integers");
  });

  it("rejects an unreasonable payload size", () => {
    const many = Array.from({ length: 501 }, (_, i) => ({
      question_id: `q${i}`,
    }));
    expect(() => parseAnswers(many)).toThrow("more entries than");
    expect(() =>
      parseAnswers([{ question_id: "q1", text: "x".repeat(50_001) }]),
    ).toThrow("too long");
  });

  it("keeps a long but plausible judgment-writing answer", () => {
    const [answer] = parseAnswers([
      { question_id: "q1", text: "x".repeat(20_000) },
    ]);
    expect(answer!.text).toHaveLength(20_000);
  });

  it("ignores a confidence value it does not recognise", () => {
    const [answer] = parseAnswers([
      { question_id: "q1", confidence: "maybe" },
    ]);
    expect(answer!.confidence).toBeUndefined();
  });

  it("rejects a non-list and non-object entries", () => {
    expect(() => parseAnswers("nope")).toThrow("must be a list");
    expect(() => parseAnswers(["nope"])).toThrow("must be an object");
  });

  it("does not accept a client-supplied score", () => {
    // Scoring is the server's job; any score field in the body is dropped.
    const [answer] = parseAnswers([
      { question_id: "q1", chosen: ["b"], score: 99, result: "correct" },
    ]);
    expect(answer).toEqual({ question_id: "q1", chosen: ["b"] });
  });
});

describe("parseSelfScores", () => {
  it("parses ticks, the revisit flag and a note", () => {
    expect(
      parseSelfScores({
        updates: [
          {
            question_id: "q1",
            points_ticked: [0, 2],
            revisit_flag: true,
            notes: "re-read s.10",
          },
        ],
      }),
    ).toEqual([
      {
        questionId: "q1",
        pointsTicked: [0, 2],
        revisitFlag: true,
        notes: "re-read s.10",
      },
    ]);
  });

  it("allows an empty tick list, which scores the question zero", () => {
    expect(
      parseSelfScores({ updates: [{ question_id: "q1", points_ticked: [] }] }),
    ).toEqual([{ questionId: "q1", pointsTicked: [] }]);
  });

  it("requires a non-empty updates list", () => {
    expect(() => parseSelfScores({})).toThrow("non-empty list");
    expect(() => parseSelfScores({ updates: [] })).toThrow("non-empty list");
  });

  it("rejects an over-long note", () => {
    expect(() =>
      parseSelfScores({
        updates: [{ question_id: "q1", notes: "x".repeat(5_001) }],
      }),
    ).toThrow("too long");
  });
});
