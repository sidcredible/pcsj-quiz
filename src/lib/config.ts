/**
 * Server-side configuration. Read at request time, never bundled for the
 * browser: the service-account key in particular must stay on the server.
 */

export interface AppConfig {
  driveFolderId: string;
  sheetId: string;
  refreshMinutes: number;
  defaultNegativeMarking: number;
  /** True when quizzes come from a local directory instead of Drive. */
  usingFixtures: boolean;
  /** True when attempts are logged to a local file instead of the Sheet. */
  dryRunSheets: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ConfigError(
      `${name} is not set. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Local mode: QUIZ_FIXTURE_DIR reads quizzes from a directory and
 * SHEETS_DRY_RUN writes the log to a local JSONL file, so the whole flow runs
 * before the service account and the Sheet exist.
 */
export function usingFixtures(): boolean {
  return Boolean(process.env.QUIZ_FIXTURE_DIR?.trim());
}

export function dryRunSheets(): boolean {
  return process.env.SHEETS_DRY_RUN?.trim() === "1";
}

export function appConfig(): AppConfig {
  const fixtures = usingFixtures();
  const dryRun = dryRunSheets();
  return {
    // With a fixture directory there is no folder to list, so the id is
    // irrelevant rather than missing.
    driveFolderId: fixtures
      ? (process.env.DRIVE_FOLDER_ID?.trim() ?? "fixtures")
      : required("DRIVE_FOLDER_ID"),
    sheetId: dryRun
      ? (process.env.SHEET_ID?.trim() ?? "dry-run")
      : required("SHEET_ID"),
    refreshMinutes: numberFromEnv("QUIZ_REFRESH_MINUTES", 10),
    defaultNegativeMarking: numberFromEnv("DEFAULT_NEGATIVE_MARKING", 0),
    usingFixtures: fixtures,
    dryRunSheets: dryRun,
  };
}

/**
 * True when the app has what it needs to read quizzes and log attempts, so a
 * route can say "not configured" instead of failing mid-request.
 */
export function hasGoogleCredentials(): boolean {
  // Local mode needs no credentials at all.
  if (usingFixtures() && dryRunSheets()) return true;
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim() ||
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.trim(),
  );
}

/** How a single environment variable looks, with no value ever revealed. */
export interface EnvVarStatus {
  name: string;
  present: boolean;
  /** Character length, which distinguishes a truncated paste from a whole one. */
  length: number;
  note?: string;
}

export interface ConfigDiagnosis {
  ok: boolean;
  /** The variables that must be set for the app to work, and whether they are. */
  variables: EnvVarStatus[];
  /** What to do next, in the order worth trying. */
  problems: string[];
  mode: "google" | "local";
}

function statusOf(name: string, note?: string): EnvVarStatus {
  const raw = process.env[name];
  const value = raw?.trim() ?? "";
  return {
    name,
    present: value.length > 0,
    length: value.length,
    ...(note ? { note } : {}),
  };
}

/**
 * Explains exactly which piece of configuration is missing or malformed.
 *
 * Deliberately reports only presence, length and parse status — never a value,
 * and never any part of the private key — so it is safe to expose on a
 * deployment that is failing and safe to paste into a bug report.
 */
export function diagnoseConfig(): ConfigDiagnosis {
  const local = usingFixtures() && dryRunSheets();
  const variables = [
    statusOf("GOOGLE_SERVICE_ACCOUNT_KEY", "the whole key JSON, on one line"),
    statusOf("GOOGLE_SERVICE_ACCOUNT_KEY_FILE", "local development only"),
    statusOf("DRIVE_FOLDER_ID"),
    statusOf("SHEET_ID"),
  ];
  const problems: string[] = [];

  const inlineKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.trim();

  if (!local && !inlineKey && !keyFile) {
    problems.push(
      "GOOGLE_SERVICE_ACCOUNT_KEY is not set on this deployment. Add it in " +
        "Vercel under Settings > Environment Variables, tick every " +
        "environment (Production, Preview and Development), then redeploy — " +
        "a variable added after a build does not reach the already-deployed " +
        "functions.",
    );
  }

  if (inlineKey) {
    // The most common paste mistakes, each with a distinct symptom.
    try {
      const parsed = JSON.parse(inlineKey) as Record<string, unknown>;
      if (typeof parsed.client_email !== "string") {
        problems.push("GOOGLE_SERVICE_ACCOUNT_KEY parses but has no client_email.");
      }
      const privateKey = parsed.private_key;
      if (typeof privateKey !== "string") {
        problems.push("GOOGLE_SERVICE_ACCOUNT_KEY parses but has no private_key.");
      } else if (!privateKey.includes("BEGIN PRIVATE KEY")) {
        problems.push(
          "GOOGLE_SERVICE_ACCOUNT_KEY has a private_key that does not look " +
            "like a PEM key; it may have been truncated when pasted.",
        );
      }
    } catch {
      problems.push(
        "GOOGLE_SERVICE_ACCOUNT_KEY is set but is not valid JSON. Paste the " +
          "whole file contents including the outer { }, with the private_key " +
          "newlines left as the literal \\n they are in the file.",
      );
    }
  }

  if (!local && !process.env.DRIVE_FOLDER_ID?.trim()) {
    problems.push("DRIVE_FOLDER_ID is not set.");
  }
  if (!local && !process.env.SHEET_ID?.trim()) {
    problems.push("SHEET_ID is not set.");
  }

  return {
    ok: problems.length === 0,
    variables,
    problems,
    mode: local ? "local" : "google",
  };
}
