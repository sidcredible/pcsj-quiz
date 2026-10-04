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
