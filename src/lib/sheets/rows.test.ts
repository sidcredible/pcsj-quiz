import { describe, expect, it } from "vitest";
import { SAMPLE_SET } from "../quiz/__fixtures__/sample-set";
import { scoreAttempt } from "../quiz/score";
import type { ImportedQuiz } from "../quiz/registry";
import {
  ATTEMPTS_COLUMNS,
  QUESTIONS_COLUMNS,
  QUIZZES_COLUMNS,
  RESPONSES_COLUMNS,
  columnLetter,
  dataRange,
  rowRange,
  TABS,
} from "./columns";
import {
  attemptRow,
  flattenQuestionText,
  questionRow,
  questionRows,
  quizRow,
  responseId,
  responseRows,
  type AttemptRecord,
} from "./rows";

const QUIZ: ImportedQuiz = {
  setId: SAMPLE_SET.set_id,
  fileId: "drive-file-id",
  fileName: "2026-10-04_sample.json",
  modifiedTime: "2026-10-04T15:07:58Z",
  importedAt: "2026-10-04T15:30:00+05:30",
  set: SAMPLE_SET,
  warnings: [],
};

const RECORD: AttemptRecord = {
  attemptId: "11111111-2222-3333-4444-555555555555",
  setId: SAMPLE_SET.set_id,
  candidate: "Siddhartha Anand",
  startedAt: "2026-10-04T16:00:00+05:30",
  submittedAt: "2026-10-04T16:42:00+05:30",
  durationSec: 2520,
  mode: "practice",
  negativeMarking: 0.25,
  device: "mobile",
};

const cell = (columns: readonly string[], row: unknown[], name: string) =>
  row[columns.indexOf(name)];

const q = (id: string) => SAMPLE_SET.questions.find((x) => x.id === id)!;

describe("columnLetter", () => {
  it("maps indexes to A1 letters past Z", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(27)).toBe("AB");
    expect(columnLetter(51)).toBe("AZ");
    expect(columnLetter(52)).toBe("BA");
  });

  it("builds ranges wide enough for the widest tab", () => {
    const questions = TABS.find((t) => t.title === "Questions")!;
    // 33 columns -> A..AG
    expect(dataRange(questions)).toBe("Questions!A2:AG");
    expect(rowRange(questions, 7)).toBe("Questions!A7:AG7");
  });
});

describe("tab specs", () => {
  it("keys every tab on its first column", () => {
    for (const tab of TABS) {
      expect(tab.columns[0]).toBe(tab.keyColumn);
    }
  });

  it("has no duplicate column names", () => {
    for (const tab of TABS) {
      expect(new Set(tab.columns).size).toBe(tab.columns.length);
    }
  });
});

describe("quizRow", () => {
  const r = quizRow(QUIZ);

  it("writes one cell per column", () => {
    expect(r).toHaveLength(QUIZZES_COLUMNS.length);
  });

  it("records the real question count, not composition.total", () => {
    // The fixture's composition.total is 11 and requested is 10; both are kept
    // honestly, but `total` is the real length.
    expect(cell(QUIZZES_COLUMNS, r, "total")).toBe(11);
    expect(cell(QUIZZES_COLUMNS, r, "requested")).toBe(10);
  });

  it("computes max_marks from the questions", () => {
    expect(cell(QUIZZES_COLUMNS, r, "max_marks")).toBe(23);
  });

  it("joins exam_focus and carries the import metadata", () => {
    expect(cell(QUIZZES_COLUMNS, r, "exam_focus")).toBe("DJS, UP-PCSJ");
    expect(cell(QUIZZES_COLUMNS, r, "file_name")).toBe("2026-10-04_sample.json");
    expect(cell(QUIZZES_COLUMNS, r, "imported_at")).toBe(QUIZ.importedAt);
    expect(cell(QUIZZES_COLUMNS, r, "schema_version")).toBe("1.1");
  });

  it("counts excluded PYQs as zero when the file lists none", () => {
    expect(cell(QUIZZES_COLUMNS, r, "excluded_count")).toBe(0);
  });
});

describe("flattenQuestionText", () => {
  it("leaves a plain stem alone", () => {
    expect(flattenQuestionText(q("2026-10-04_sample_Q01"))).toBe(
      q("2026-10-04_sample_Q01").question,
    );
  });

  it("appends numbered statements under the stem", () => {
    const text = flattenQuestionText(q("2026-10-04_sample_Q03"));
    expect(text).toContain("I. POCSO is gender-neutral");
    expect(text).toContain("II. Consent of a child");
  });

  it("labels the assertion and reason blocks", () => {
    const text = flattenQuestionText(q("2026-10-04_sample_Q04"));
    expect(text).toContain("Assertion (A): A conviction under POCSO");
    expect(text).toContain("Reason (R): Corroboration is a rule");
  });

  it("flattens both match lists with their titles", () => {
    const text = flattenQuestionText(q("2026-10-04_sample_Q05"));
    expect(text).toContain("List I (offence)");
    expect(text).toContain("I. Sexual assault (s.8)");
    expect(text).toContain("List II (minimum punishment)");
    expect(text).toContain("A. Three years");
  });
});

describe("questionRow", () => {
  it("writes one cell per column for every question", () => {
    for (const r of questionRows(QUIZ)) {
      expect(r).toHaveLength(QUESTIONS_COLUMNS.length);
    }
  });

  it("places options into their lettered columns", () => {
    const r = questionRow(SAMPLE_SET, q("2026-10-04_sample_Q01"));
    expect(cell(QUESTIONS_COLUMNS, r, "option_a")).toBe("16 years");
    expect(cell(QUESTIONS_COLUMNS, r, "option_b")).toBe("18 years");
    // Only four options, so option_e stays empty rather than undefined.
    expect(cell(QUESTIONS_COLUMNS, r, "option_e")).toBe("");
  });

  it("joins a multi-correct answer key", () => {
    const r = questionRow(SAMPLE_SET, q("2026-10-04_sample_Q08"));
    expect(cell(QUESTIONS_COLUMNS, r, "correct_answer")).toBe("a, b");
  });

  it("leaves correct_answer blank for a subjective question", () => {
    const r = questionRow(SAMPLE_SET, q("2026-10-04_sample_Q10"));
    expect(cell(QUESTIONS_COLUMNS, r, "correct_answer")).toBe("");
    expect(cell(QUESTIONS_COLUMNS, r, "style")).toBe("short_answer");
  });

  it("uses the MCQ default of 1 mark when the file omits marks", () => {
    const r = questionRow(SAMPLE_SET, q("2026-10-04_sample_Q01"));
    expect(cell(QUESTIONS_COLUMNS, r, "marks")).toBe(1);
    expect(cell(QUESTIONS_COLUMNS, r, "word_limit")).toBe("");
  });

  it("writes the rubric as point (marks) lines", () => {
    const r = questionRow(SAMPLE_SET, q("2026-10-04_sample_Q10"));
    const text = String(cell(QUESTIONS_COLUMNS, r, "marking_points"));
    expect(text.split("\n")).toHaveLength(3);
    expect(text).toContain("punished under s.10. (1)");
    expect(text).toContain("(1.5)");
  });

  it("writes why_others_wrong as key: text lines, sorted", () => {
    const r = questionRow(SAMPLE_SET, q("2026-10-04_sample_Q01"));
    const lines = String(cell(QUESTIONS_COLUMNS, r, "why_others_wrong")).split("\n");
    expect(lines[0]!.startsWith("a: ")).toBe(true);
    expect(lines[1]!.startsWith("c: ")).toBe(true);
    expect(lines[2]!.startsWith("d: ")).toBe(true);
  });

  it("notes the old-law equivalent in provisions when present", () => {
    const question = structuredClone(q("2026-10-04_sample_Q01"));
    question.explanation.provisions[0]!.old_law_equivalent = "IPC 376";
    const r = questionRow(SAMPLE_SET, question);
    expect(cell(QUESTIONS_COLUMNS, r, "provisions")).toContain("(old: IPC 376)");
  });

  it("formats pyq_sources and pyq_years for a real PYQ", () => {
    const r = questionRow(SAMPLE_SET, q("2026-10-04_sample_Q09"));
    expect(cell(QUESTIONS_COLUMNS, r, "pyq_sources")).toBe("DJS-prelims-2019-Q12");
    expect(cell(QUESTIONS_COLUMNS, r, "pyq_years")).toBe("2019");
    expect(cell(QUESTIONS_COLUMNS, r, "adapted_from_old_law")).toBe(false);
    expect(cell(QUESTIONS_COLUMNS, r, "answer_provenance")).toBe("official_key");
  });

  it("leaves provenance columns blank for a generated question", () => {
    const r = questionRow(SAMPLE_SET, q("2026-10-04_sample_Q01"));
    expect(cell(QUESTIONS_COLUMNS, r, "pyq_sources")).toBe("");
    expect(cell(QUESTIONS_COLUMNS, r, "pyq_years")).toBe("");
    expect(cell(QUESTIONS_COLUMNS, r, "adapted_from_old_law")).toBe("");
  });

  it("keeps a lossless JSON copy of the question", () => {
    const question = q("2026-10-04_sample_Q09");
    const r = questionRow(SAMPLE_SET, question);
    const parsed = JSON.parse(String(cell(QUESTIONS_COLUMNS, r, "json")));
    expect(parsed).toEqual(question);
  });

  it("preserves an unknown future field in the json column", () => {
    const question = structuredClone(
      q("2026-10-04_sample_Q01"),
    ) as unknown as Record<string, unknown>;
    question.difficulty_v2 = "hard";
    const r = questionRow(SAMPLE_SET, question as never);
    expect(String(cell(QUESTIONS_COLUMNS, r, "json"))).toContain("difficulty_v2");
  });
});

describe("attemptRow", () => {
  const scored = scoreAttempt(
    SAMPLE_SET,
    [
      { question_id: "2026-10-04_sample_Q01", chosen: ["b"] },
      { question_id: "2026-10-04_sample_Q02", chosen: ["a"] },
    ],
    0.25,
  );
  const r = attemptRow(RECORD, scored);

  it("writes one cell per column", () => {
    expect(r).toHaveLength(ATTEMPTS_COLUMNS.length);
  });

  it("records the negative marking actually used", () => {
    expect(cell(ATTEMPTS_COLUMNS, r, "negative_marking")).toBe(0.25);
  });

  it("carries the totals and the device", () => {
    expect(cell(ATTEMPTS_COLUMNS, r, "correct")).toBe(1);
    expect(cell(ATTEMPTS_COLUMNS, r, "wrong")).toBe(1);
    expect(cell(ATTEMPTS_COLUMNS, r, "mcq_score")).toBe(0.5);
    expect(cell(ATTEMPTS_COLUMNS, r, "max_score")).toBe(23);
    expect(cell(ATTEMPTS_COLUMNS, r, "device")).toBe("mobile");
    expect(cell(ATTEMPTS_COLUMNS, r, "mode")).toBe("practice");
  });
});

describe("responseRows", () => {
  const scored = scoreAttempt(
    SAMPLE_SET,
    [
      {
        question_id: "2026-10-04_sample_Q01",
        chosen: ["a"],
        time_spent_sec: 42,
        changed_answer: true,
        marked_for_review: true,
        confidence: "guess",
      },
      {
        question_id: "2026-10-04_sample_Q10",
        text: "s.10 — five to seven years and fine",
        points_ticked: [0, 2],
      },
    ],
    0.25,
  );
  const rows = responseRows(SAMPLE_SET, RECORD, scored);

  it("writes one row per question in the set", () => {
    expect(rows).toHaveLength(SAMPLE_SET.questions.length);
    for (const r of rows) expect(r).toHaveLength(RESPONSES_COLUMNS.length);
  });

  it("keys each row as attempt_id + question_id", () => {
    expect(cell(RESPONSES_COLUMNS, rows[0]!, "response_id")).toBe(
      responseId(RECORD.attemptId, "2026-10-04_sample_Q01"),
    );
  });

  it("copies the question metadata so the tab filters alone", () => {
    const r = rows[0]!;
    expect(cell(RESPONSES_COLUMNS, r, "style")).toBe("direct");
    expect(cell(RESPONSES_COLUMNS, r, "basis")).toBe("new");
    expect(cell(RESPONSES_COLUMNS, r, "subject_code")).toBe("SPECIAL");
    expect(cell(RESPONSES_COLUMNS, r, "topic")).toBe("Definitions (s.2)");
    expect(cell(RESPONSES_COLUMNS, r, "question_number")).toBe(1);
  });

  it("records the behavioural flags for pattern analysis", () => {
    const r = rows[0]!;
    expect(cell(RESPONSES_COLUMNS, r, "chosen_answer")).toBe("a");
    expect(cell(RESPONSES_COLUMNS, r, "correct_answer")).toBe("b");
    expect(cell(RESPONSES_COLUMNS, r, "result")).toBe("wrong");
    expect(cell(RESPONSES_COLUMNS, r, "score")).toBe(-0.25);
    expect(cell(RESPONSES_COLUMNS, r, "time_spent_sec")).toBe(42);
    expect(cell(RESPONSES_COLUMNS, r, "changed_answer")).toBe(true);
    expect(cell(RESPONSES_COLUMNS, r, "marked_for_review")).toBe(true);
    expect(cell(RESPONSES_COLUMNS, r, "confidence")).toBe("guess");
  });

  it("records a self-scored subjective answer with its ticked points", () => {
    const r = rows.find(
      (candidate) =>
        cell(RESPONSES_COLUMNS, candidate, "question_id") ===
        "2026-10-04_sample_Q10",
    )!;
    expect(cell(RESPONSES_COLUMNS, r, "result")).toBe("self_scored");
    expect(cell(RESPONSES_COLUMNS, r, "points_ticked")).toBe("0, 2");
    expect(cell(RESPONSES_COLUMNS, r, "score")).toBe(1.5);
    expect(cell(RESPONSES_COLUMNS, r, "subjective_text")).toContain("five to seven");
  });

  it("writes skipped rows for questions never visited", () => {
    const r = rows.find(
      (candidate) =>
        cell(RESPONSES_COLUMNS, candidate, "question_id") ===
        "2026-10-04_sample_Q07",
    )!;
    expect(cell(RESPONSES_COLUMNS, r, "result")).toBe("skipped");
    expect(cell(RESPONSES_COLUMNS, r, "chosen_answer")).toBe("");
    expect(cell(RESPONSES_COLUMNS, r, "score")).toBe(0);
  });

  it("truncates the question_text copy to 300 characters", () => {
    const long = structuredClone(SAMPLE_SET);
    long.questions[0]!.question = "x".repeat(500);
    const r = responseRows(long, RECORD, scoreAttempt(long, [], 0))[0]!;
    expect(String(cell(RESPONSES_COLUMNS, r, "question_text"))).toHaveLength(300);
  });

  it("defaults the candidate's own revisit flag and notes to empty", () => {
    const r = rows[0]!;
    expect(cell(RESPONSES_COLUMNS, r, "revisit_flag")).toBe(false);
    expect(cell(RESPONSES_COLUMNS, r, "notes")).toBe("");
  });
});
