/**
 * Parsing and validating an attempt submission.
 *
 * The client is not trusted with scoring, so it is not trusted with its own
 * score either: the body carries only what the candidate did, and every
 * number in the Sheet is derived here or in lib/quiz/score.
 */

import { BadRequestError } from "./http";
import type { SubmittedAnswer } from "../quiz/score";
import type { AttemptMode, Device } from "../sheets/rows";

export interface ParsedSubmission {
  setId: string;
  candidate: string;
  startedAt: string;
  mode: AttemptMode;
  device: Device;
  negativeMarking: number;
  answers: SubmittedAnswer[];
  /** Client-generated so a retry of the same attempt is idempotent. */
  attemptId: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function str(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadRequestError(`${field} is required.`);
  }
  if (value.length > max) {
    throw new BadRequestError(`${field} is longer than ${max} characters.`);
  }
  return value.trim();
}

function optionalKeys(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BadRequestError(`${field} must be a list.`);
  return value.map((key) => {
    if (typeof key !== "string" || !/^[a-e]$/.test(key)) {
      throw new BadRequestError(`${field} may only contain option keys a-e.`);
    }
    return key;
  });
}

function optionalIndexes(value: unknown, field: string): number[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BadRequestError(`${field} must be a list.`);
  return value.map((index) => {
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      throw new BadRequestError(`${field} must contain non-negative integers.`);
    }
    return index;
  });
}

function nonNegativeNumber(value: unknown, field: string, fallback = 0): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new BadRequestError(`${field} must be a non-negative number.`);
  }
  return value;
}

export function parseAnswers(value: unknown): SubmittedAnswer[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new BadRequestError("answers must be a list.");
  }
  if (value.length > 500) {
    throw new BadRequestError("answers has more entries than any quiz has questions.");
  }

  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new BadRequestError(`answers[${index}] must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    const questionId = str(record.question_id, `answers[${index}].question_id`);
    if (seen.has(questionId)) {
      throw new BadRequestError(`answers contains ${questionId} twice.`);
    }
    seen.add(questionId);

    const answer: SubmittedAnswer = { question_id: questionId };
    const chosen = optionalKeys(record.chosen, `answers[${index}].chosen`);
    if (chosen.length > 0) answer.chosen = chosen;

    if (record.text !== undefined && record.text !== null) {
      if (typeof record.text !== "string") {
        throw new BadRequestError(`answers[${index}].text must be a string.`);
      }
      // Generous but bounded: a judgment-writing answer is long, a 200 KB
      // paste is not an answer.
      if (record.text.length > 50_000) {
        throw new BadRequestError(`answers[${index}].text is too long.`);
      }
      answer.text = record.text;
    }

    const ticked = optionalIndexes(
      record.points_ticked,
      `answers[${index}].points_ticked`,
    );
    if (ticked.length > 0) answer.points_ticked = ticked;

    const timeSpent = nonNegativeNumber(
      record.time_spent_sec,
      `answers[${index}].time_spent_sec`,
    );
    if (timeSpent > 0) answer.time_spent_sec = Math.round(timeSpent);
    if (record.changed_answer === true) answer.changed_answer = true;
    if (record.marked_for_review === true) answer.marked_for_review = true;
    if (record.confidence === "sure" || record.confidence === "guess") {
      answer.confidence = record.confidence;
    }
    return answer;
  });
}

export function parseSubmission(
  body: Record<string, unknown>,
  defaultNegativeMarking: number,
): ParsedSubmission {
  const attemptId = str(body.attempt_id, "attempt_id", 64);
  if (!UUID_RE.test(attemptId)) {
    throw new BadRequestError("attempt_id must be a UUID.");
  }

  const mode = body.mode === "timed" ? "timed" : "practice";
  const device = body.device === "desktop" ? "desktop" : "mobile";

  const negativeMarking = nonNegativeNumber(
    body.negative_marking,
    "negative_marking",
    defaultNegativeMarking,
  );
  if (negativeMarking > 1) {
    throw new BadRequestError("negative_marking must be between 0 and 1.");
  }

  return {
    attemptId,
    setId: str(body.set_id, "set_id", 120),
    candidate: str(body.candidate, "candidate", 120),
    startedAt: str(body.started_at, "started_at", 40),
    mode,
    device,
    negativeMarking,
    answers: parseAnswers(body.answers),
  };
}

export interface ParsedSelfScore {
  questionId: string;
  pointsTicked: number[];
  revisitFlag?: boolean;
  notes?: string;
}

export function parseSelfScores(body: Record<string, unknown>): ParsedSelfScore[] {
  const raw = body.updates;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new BadRequestError("updates must be a non-empty list.");
  }
  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new BadRequestError(`updates[${index}] must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    const update: ParsedSelfScore = {
      questionId: str(record.question_id, `updates[${index}].question_id`),
      pointsTicked: optionalIndexes(
        record.points_ticked,
        `updates[${index}].points_ticked`,
      ),
    };
    if (typeof record.revisit_flag === "boolean") {
      update.revisitFlag = record.revisit_flag;
    }
    if (typeof record.notes === "string") {
      if (record.notes.length > 5_000) {
        throw new BadRequestError(`updates[${index}].notes is too long.`);
      }
      update.notes = record.notes;
    }
    return update;
  });
}
