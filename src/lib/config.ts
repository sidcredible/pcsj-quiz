/**
 * Server-side configuration. Read at request time, never bundled for the
 * browser: the service-account key in particular must stay on the server.
 */

export interface AppConfig {
  driveFolderId: string;
  sheetId: string;
  refreshMinutes: number;
  defaultNegativeMarking: number;
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

export function appConfig(): AppConfig {
  return {
    driveFolderId: required("DRIVE_FOLDER_ID"),
    sheetId: required("SHEET_ID"),
    refreshMinutes: numberFromEnv("QUIZ_REFRESH_MINUTES", 10),
    defaultNegativeMarking: numberFromEnv("DEFAULT_NEGATIVE_MARKING", 0),
  };
}

/** True when Google credentials are present, so routes can fail politely. */
export function hasGoogleCredentials(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim() ||
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.trim(),
  );
}
