/**
 * Exercises the log against an in-memory stand-in for the Sheets client, so
 * upsert, append and self-score semantics are verified without Google.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTEMPTS_COLUMNS,
  QUESTIONS_COLUMNS,
  RESPONSES_COLUMNS,
  TABS,
} from "./columns";
import type { SheetRow } from "./rows";

/** A tiny Sheet: tab title -> data rows (header excluded). */
const sheet = new Map<string, SheetRow[]>();

function tabByTitle(title: string) {
  return TABS.find((t) => t.title === title)!;
}

const ensureTabs = vi.fn(async () => {
  for (const tab of TABS) if (!sheet.has(tab.title)) sheet.set(tab.title, []);
});

const upsertRows = vi.fn(
  async (_id: string, tab: { title: string }, rows: readonly SheetRow[]) => {
    const existing = sheet.get(tab.title) ?? [];
    let updated = 0;
    let appended = 0;
    for (const row of rows) {
      const key = String(row[0] ?? "");
      const index = existing.findIndex((r) => String(r[0] ?? "") === key);
      if (index >= 0) {
        existing[index] = row;
        updated += 1;
      } else {
        existing.push(row);
        appended += 1;
      }
    }
    sheet.set(tab.title, existing);
    return { updated, appended };
  },
);

const findRows = vi.fn(
  async (
    _id: string,
    tab: { title: string; columns: readonly string[] },
    column: string,
    value: string,
  ) => {
    const rows = sheet.get(tab.title) ?? [];
    const columnIndex = tab.columns.indexOf(column);
    const found: { rowNumber: number; record: Record<string, string> }[] = [];
    rows.forEach((row, index) => {
      if (String(row[columnIndex] ?? "") !== value) return;
      const record: Record<string, string> = {};
      tab.columns.forEach((name, i) => {
        const cell = row[i];
        record[name] =
          cell === undefined || cell === null
            ? ""
            : typeof cell === "boolean"
              ? cell
                ? "TRUE"
                : "FALSE"
              : String(cell);
      });
      found.push({ rowNumber: index + 2, record });
    });
    return found;
  },
);

const updateRowsAt = vi.fn(
  async (
    _id: string,
    tab: { title: string },
    updates: readonly { rowNumber: number; row: SheetRow }[],
  ) => {
    const rows = sheet.get(tab.title) ?? [];
    for (const update of updates) rows[update.rowNumber - 2] = update.row;
    sheet.set(tab.title, rows);
  },
);

const appendRows = vi.fn(
  async (_id: string, tab: { title: string }, rows: readonly SheetRow[]) => {
    sheet.set(tab.title, [...(sheet.get(tab.title) ?? []), ...rows]);
  },
);

vi.mock("./client", () => ({
  ensureTabs,
  upsertRows,
  findRows,
  updateRowsAt,
  appendRows,
  keyRowNumbers: vi.fn(),
  readTab: vi.fn(),
  resetTabCache: vi.fn(),
}));

const cachedQuiz = vi.fn();
vi.mock("../quiz/registry", () => ({ cachedQuiz }));

const { applySelfScores, lastScoresByCandidate, logAttempt, logQuizImport, readAttempt } =
  await import("./log");
const { SAMPLE_SET } = await import("../quiz/__fixtures__/sample-set");
const { scoreAttempt } = await import("../quiz/score");

const SHEET = "sheet-id";
const QUIZ = {
  setId: SAMPLE_SET.set_id,
  fileId: "file-id",
  fileName: "2026-10-04_sample.json",
  modifiedTime: "2026-10-04T15:07:58Z",
  importedAt: "2026-10-04T15:30:00+05:30",
  set: SAMPLE_SET,
  warnings: [],
};

const SUBMISSION = {
  attemptId: "attempt-1",
  setId: SAMPLE_SET.set_id,
  candidate: "Sid",
  startedAt: "2026-10-04T16:00:00+05:30",
  submittedAt: "2026-10-04T16:42:00+05:30",
  durationSec: 2520,
  mode: "practice" as const,
  negativeMarking: 0.25,
  device: "mobile" as const,
};

const cell = (columns: readonly string[], row: SheetRow, name: string) =>
  row[columns.indexOf(name)];

const rowsOf = (title: string) => sheet.get(title) ?? [];

beforeEach(() => {
  sheet.clear();
  for (const tab of TABS) sheet.set(tab.title, []);
  vi.clearAllMocks();
  cachedQuiz.mockReturnValue({ set: SAMPLE_SET });
});

describe("logQuizImport", () => {
  it("writes one Quizzes row and one row per question", async () => {
    await logQuizImport(SHEET, QUIZ);
    expect(rowsOf("Quizzes")).toHaveLength(1);
    expect(rowsOf("Questions")).toHaveLength(SAMPLE_SET.questions.length);
  });

  it("creates no duplicate rows when the same file is re-imported", async () => {
    await logQuizImport(SHEET, QUIZ);
    await logQuizImport(SHEET, QUIZ);
    expect(rowsOf("Quizzes")).toHaveLength(1);
    expect(rowsOf("Questions")).toHaveLength(SAMPLE_SET.questions.length);
  });

  it("overwrites the rows of a corrected file, keeping question ids", async () => {
    await logQuizImport(SHEET, QUIZ);
    const corrected = structuredClone(SAMPLE_SET);
    corrected.questions[0]!.question = "Corrected stem";
    await logQuizImport(SHEET, {
      ...QUIZ,
      set: corrected,
      importedAt: "2026-10-05T09:00:00+05:30",
    });

    expect(rowsOf("Questions")).toHaveLength(SAMPLE_SET.questions.length);
    const first = rowsOf("Questions")[0]!;
    expect(cell(QUESTIONS_COLUMNS, first, "question_text")).toBe("Corrected stem");
    expect(cell(QUESTIONS_COLUMNS, first, "question_id")).toBe(
      "2026-10-04_sample_Q01",
    );
  });
});

describe("logAttempt", () => {
  it("writes one Attempts row and one Responses row per question", async () => {
    const scored = scoreAttempt(
      SAMPLE_SET,
      [{ question_id: "2026-10-04_sample_Q01", chosen: ["b"] }],
      0.25,
    );
    await logAttempt(SHEET, SUBMISSION, SAMPLE_SET.questions, scored);

    expect(rowsOf("Attempts")).toHaveLength(1);
    expect(rowsOf("Responses")).toHaveLength(SAMPLE_SET.questions.length);
  });

  it("does not double-log an attempt the client queue retries", async () => {
    const scored = scoreAttempt(SAMPLE_SET, [], 0);
    await logAttempt(SHEET, SUBMISSION, SAMPLE_SET.questions, scored);
    await logAttempt(SHEET, SUBMISSION, SAMPLE_SET.questions, scored);

    expect(rowsOf("Attempts")).toHaveLength(1);
    expect(rowsOf("Responses")).toHaveLength(SAMPLE_SET.questions.length);
  });
});

describe("applySelfScores", () => {
  async function submitWithWrittenSubjectives() {
    const scored = scoreAttempt(
      SAMPLE_SET,
      [
        { question_id: "2026-10-04_sample_Q01", chosen: ["b"] }, // +1
        { question_id: "2026-10-04_sample_Q10", text: "s.10, 5-7 years" },
        { question_id: "2026-10-04_sample_Q11", text: "A judgment draft" },
      ],
      0.25,
    );
    await logAttempt(SHEET, SUBMISSION, SAMPLE_SET.questions, scored);
    return scored;
  }

  it("scores a pending subjective answer and updates its row", async () => {
    await submitWithWrittenSubjectives();
    const result = await applySelfScores(SHEET, "attempt-1", [
      { questionId: "2026-10-04_sample_Q10", pointsTicked: [0, 1] },
    ]);

    expect(result.updatedQuestionIds).toEqual(["2026-10-04_sample_Q10"]);
    const row = rowsOf("Responses").find(
      (r) => cell(RESPONSES_COLUMNS, r, "question_id") === "2026-10-04_sample_Q10",
    )!;
    expect(cell(RESPONSES_COLUMNS, row, "result")).toBe("self_scored");
    expect(cell(RESPONSES_COLUMNS, row, "score")).toBe(2.5);
    expect(cell(RESPONSES_COLUMNS, row, "points_ticked")).toBe("0, 1");
  });

  it("recomputes the attempt totals, MCQ score included", async () => {
    await submitWithWrittenSubjectives();
    const result = await applySelfScores(SHEET, "attempt-1", [
      { questionId: "2026-10-04_sample_Q10", pointsTicked: [0, 1] },
    ]);

    expect(result.totals.mcq_score).toBe(1);
    expect(result.totals.subjective_score).toBe(2.5);
    expect(result.totals.total_score).toBe(3.5);
    expect(result.totals.pending_self_score).toBe(1); // Q11 still pending
  });

  it("accumulates across separate sittings", async () => {
    await submitWithWrittenSubjectives();
    await applySelfScores(SHEET, "attempt-1", [
      { questionId: "2026-10-04_sample_Q10", pointsTicked: [0, 1] },
    ]);
    const second = await applySelfScores(SHEET, "attempt-1", [
      { questionId: "2026-10-04_sample_Q11", pointsTicked: [0, 1] },
    ]);

    // Q10's 2.5 must survive the second pass, which only mentions Q11.
    expect(second.totals.subjective_score).toBe(10.5);
    expect(second.totals.pending_self_score).toBe(0);
  });

  it("caps a self-score at the question's marks", async () => {
    await submitWithWrittenSubjectives();
    const result = await applySelfScores(SHEET, "attempt-1", [
      { questionId: "2026-10-04_sample_Q10", pointsTicked: [0, 1, 2] },
    ]);
    expect(result.totals.subjective_score).toBe(3);
  });

  it("ignores rubric indexes that do not exist", async () => {
    await submitWithWrittenSubjectives();
    const result = await applySelfScores(SHEET, "attempt-1", [
      { questionId: "2026-10-04_sample_Q10", pointsTicked: [99, -1] },
    ]);
    expect(result.totals.subjective_score).toBe(0);
  });

  it("leaves a skipped subjective question skipped", async () => {
    const scored = scoreAttempt(SAMPLE_SET, [], 0);
    await logAttempt(SHEET, SUBMISSION, SAMPLE_SET.questions, scored);
    await applySelfScores(SHEET, "attempt-1", [
      { questionId: "2026-10-04_sample_Q10", pointsTicked: [0, 1, 2] },
    ]);

    const row = rowsOf("Responses").find(
      (r) => cell(RESPONSES_COLUMNS, r, "question_id") === "2026-10-04_sample_Q10",
    )!;
    expect(cell(RESPONSES_COLUMNS, row, "result")).toBe("skipped");
    expect(cell(RESPONSES_COLUMNS, row, "score")).toBe(0);
  });

  it("refuses to self-score an MCQ", async () => {
    await submitWithWrittenSubjectives();
    const result = await applySelfScores(SHEET, "attempt-1", [
      { questionId: "2026-10-04_sample_Q01", pointsTicked: [0] },
    ]);
    expect(result.updatedQuestionIds).toEqual([]);
    expect(result.totals.mcq_score).toBe(1);
  });

  it("stores the candidate's revisit flag and note", async () => {
    await submitWithWrittenSubjectives();
    await applySelfScores(SHEET, "attempt-1", [
      {
        questionId: "2026-10-04_sample_Q10",
        pointsTicked: [0],
        revisitFlag: true,
        notes: "Re-read s.10 proviso",
      },
    ]);

    const row = rowsOf("Responses").find(
      (r) => cell(RESPONSES_COLUMNS, r, "question_id") === "2026-10-04_sample_Q10",
    )!;
    expect(cell(RESPONSES_COLUMNS, row, "revisit_flag")).toBe(true);
    expect(cell(RESPONSES_COLUMNS, row, "notes")).toBe("Re-read s.10 proviso");
  });

  it("keeps an earlier note when a later update omits it", async () => {
    await submitWithWrittenSubjectives();
    await applySelfScores(SHEET, "attempt-1", [
      { questionId: "2026-10-04_sample_Q10", pointsTicked: [0], notes: "keep me" },
    ]);
    await applySelfScores(SHEET, "attempt-1", [
      { questionId: "2026-10-04_sample_Q10", pointsTicked: [0, 1] },
    ]);

    const row = rowsOf("Responses").find(
      (r) => cell(RESPONSES_COLUMNS, r, "question_id") === "2026-10-04_sample_Q10",
    )!;
    expect(cell(RESPONSES_COLUMNS, row, "notes")).toBe("keep me");
  });

  it("works from the Sheet alone once the registry cache is gone", async () => {
    await logQuizImport(SHEET, QUIZ);
    await submitWithWrittenSubjectives();
    // Serverless cold start: nothing cached, so the Questions tab's lossless
    // json column is what the rubric is rebuilt from.
    cachedQuiz.mockReturnValue(undefined);

    const result = await applySelfScores(SHEET, "attempt-1", [
      { questionId: "2026-10-04_sample_Q10", pointsTicked: [0, 1] },
    ]);
    expect(result.totals.subjective_score).toBe(2.5);
    expect(result.totals.max_score).toBe(23);
  });

  it("refuses to score when the question set cannot be reconstructed", async () => {
    await submitWithWrittenSubjectives();
    // No Questions rows and no cache: recomputing totals here would rewrite
    // max_score as 0 and lose the candidate's result.
    cachedQuiz.mockReturnValue(undefined);

    await expect(
      applySelfScores(SHEET, "attempt-1", [
        { questionId: "2026-10-04_sample_Q10", pointsTicked: [0, 1] },
      ]),
    ).rejects.toThrow("no questions found for set");

    const attempt = rowsOf("Attempts")[0]!;
    expect(cell(ATTEMPTS_COLUMNS, attempt, "max_score")).toBe(23);
  });

  it("throws for an attempt that was never logged", async () => {
    await expect(applySelfScores(SHEET, "nope", [])).rejects.toThrow(
      "No responses logged",
    );
  });
});

describe("readAttempt", () => {
  it("returns null for an unknown attempt", async () => {
    expect(await readAttempt(SHEET, "nope")).toBeNull();
  });

  it("reads back the stored responses with their flags", async () => {
    const scored = scoreAttempt(
      SAMPLE_SET,
      [
        {
          question_id: "2026-10-04_sample_Q01",
          chosen: ["a"],
          marked_for_review: true,
          changed_answer: true,
          time_spent_sec: 30,
        },
      ],
      0.25,
    );
    await logAttempt(SHEET, SUBMISSION, SAMPLE_SET.questions, scored);

    const read = await readAttempt(SHEET, "attempt-1");
    const first = read!.responses.find(
      (r) => r.question_id === "2026-10-04_sample_Q01",
    )!;
    expect(first.result).toBe("wrong");
    expect(first.chosen).toEqual(["a"]);
    expect(first.correct_answer).toEqual(["b"]);
    expect(first.score).toBe(-0.25);
    expect(first.marked_for_review).toBe(true);
    expect(first.changed_answer).toBe(true);
    expect(first.time_spent_sec).toBe(30);
  });
});

describe("lastScoresByCandidate", () => {
  it("keeps only the newest attempt per quiz", async () => {
    const scored = scoreAttempt(SAMPLE_SET, [], 0);
    await logAttempt(SHEET, SUBMISSION, SAMPLE_SET.questions, scored);
    await logAttempt(
      SHEET,
      {
        ...SUBMISSION,
        attemptId: "attempt-2",
        submittedAt: "2026-10-06T10:00:00+05:30",
      },
      SAMPLE_SET.questions,
      scoreAttempt(
        SAMPLE_SET,
        [{ question_id: "2026-10-04_sample_Q01", chosen: ["b"] }],
        0,
      ),
    );

    const latest = await lastScoresByCandidate(SHEET, "Sid");
    expect(latest.get(SAMPLE_SET.set_id)?.submittedAt).toBe(
      "2026-10-06T10:00:00+05:30",
    );
  });

  it("is empty for a candidate who has never attempted", async () => {
    expect((await lastScoresByCandidate(SHEET, "Nobody")).size).toBe(0);
  });
});
