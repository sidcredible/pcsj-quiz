/**
 * Validates a downloaded quiz file against the generator's contract.
 *
 * Two gates, in order:
 *   1. `schema_version` must be exactly "1.1" — anything else is skipped and
 *      flagged rather than guessed at (handbook section 2).
 *   2. The full JSON Schema, via Ajv.
 *
 * Failures come back as readable, de-duplicated messages so the admin screen
 * can show what is wrong with a file without anyone reading Ajv internals.
 */

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../../../schema/set.schema.json";
import { SCHEMA_VERSION, type QuizSet } from "./types";

export interface ValidationFailure {
  ok: false;
  errors: string[];
}

export interface ValidationSuccess {
  ok: true;
  set: QuizSet;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      // The generator may add fields ahead of a schema bump; surface them as
      // errors here only because the schema itself says additionalProperties
      // is false. See `extraFieldErrors` in the import pipeline for how a
      // stray field is downgraded to a warning.
      verbose: false,
    });
    addFormats(ajv);
    compiled = ajv.compile(schema);
  }
  return compiled;
}

/** "questions/12/options/0/text: must NOT have fewer than 1 characters" */
function describe(err: ErrorObject): string {
  const path = err.instancePath.replace(/^\//, "") || "(root)";
  const extra =
    err.keyword === "additionalProperties" &&
    typeof err.params.additionalProperty === "string"
      ? ` ("${err.params.additionalProperty}")`
      : "";
  return `${path}: ${err.message ?? "is invalid"}${extra}`;
}

export function validateQuizSet(data: unknown): ValidationResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, errors: ["File is not a JSON object."] };
  }

  const version = (data as { schema_version?: unknown }).schema_version;
  if (version !== SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        `schema_version is ${JSON.stringify(version)}, expected "${SCHEMA_VERSION}". ` +
          `This app understands version ${SCHEMA_VERSION} only.`,
      ],
    };
  }

  const validate = validator();
  if (validate(data)) {
    return { ok: true, set: data as QuizSet };
  }

  const messages = (validate.errors ?? []).map(describe);
  // Ajv emits one error per failing branch of an if/then; collapsing keeps the
  // admin list short without hiding distinct problems.
  const unique = [...new Set(messages)];
  return {
    ok: false,
    errors: unique.length > 0 ? unique : ["Did not match set.schema.json."],
  };
}

/**
 * Checks the file is internally consistent in ways the schema cannot express.
 * These are warnings, not rejections: a quiz with a stale composition count is
 * still perfectly attemptable, and the app always trusts `questions.length`
 * over `composition.total` anyway.
 */
export function consistencyWarnings(set: QuizSet): string[] {
  const warnings: string[] = [];

  if (set.composition.total !== set.questions.length) {
    warnings.push(
      `composition.total is ${set.composition.total} but the file has ` +
        `${set.questions.length} questions; using the real count.`,
    );
  }

  const numbers = set.questions.map((q) => q.number);
  const expected = Array.from({ length: numbers.length }, (_, i) => i + 1);
  if (numbers.join(",") !== expected.join(",")) {
    warnings.push(
      "questions[].number is not a contiguous 1..N sequence in file order.",
    );
  }

  const ids = new Set<string>();
  for (const q of set.questions) {
    if (ids.has(q.id)) warnings.push(`Duplicate question id ${q.id}.`);
    ids.add(q.id);
    if (!q.id.startsWith(`${set.set_id}_`)) {
      warnings.push(`Question id ${q.id} does not belong to set ${set.set_id}.`);
    }
    warnings.push(...questionWarnings(q));
  }

  return warnings;
}

function questionWarnings(q: QuizSet["questions"][number]): string[] {
  const warnings: string[] = [];

  if (q.type === "mcq") {
    const keys = (q.options ?? []).map((o) => o.key);
    const consecutive = keys.every(
      (k, i) => k === String.fromCharCode("a".charCodeAt(0) + i),
    );
    if (!consecutive) {
      warnings.push(`${q.id}: option keys are not consecutive from "a".`);
    }
    for (const key of q.answer ?? []) {
      if (!keys.includes(key)) {
        warnings.push(`${q.id}: answer "${key}" is not one of its options.`);
      }
    }
  }

  if (q.type === "subjective") {
    const points = q.marking_points ?? [];
    const sum = points.reduce((s, p) => s + p.marks, 0);
    const marks = q.marks ?? 0;
    // Tolerance covers float addition of 0.5/1.5 style rubric marks.
    if (points.length > 0 && Math.abs(sum - marks) > 0.01) {
      warnings.push(
        `${q.id}: marking_points sum to ${sum} but marks is ${marks}.`,
      );
    }
  }

  return warnings;
}
