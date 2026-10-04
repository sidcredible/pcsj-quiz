/**
 * The seam between the HTTP routes and the Drive/Sheets layers.
 *
 * Routes stay thin: they parse and validate input, call one function here, and
 * serialise the result. Everything that knows about Drive, the Sheet or the
 * answer key lives behind this module and runs server-side only.
 */

import { appConfig, diagnoseConfig, hasGoogleCredentials } from "../config";
import { logQuizImport } from "../sheets/log";
import {
  cachedQuiz,
  refreshRegistry,
  type ImportedQuiz,
  type RegistrySnapshot,
} from "../quiz/registry";

export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotConfiguredError";
  }
}

export function requireConfig() {
  if (!hasGoogleCredentials()) {
    // Say which variable is missing and why it might be missing even though it
    // was added: "credentials are not set" alone sends people hunting.
    const diagnosis = diagnoseConfig();
    throw new NotConfiguredError(
      diagnosis.problems.join(" ") ||
        "Google credentials are not set. See .env.example and README.",
    );
  }
  return appConfig();
}

/**
 * Scans Drive if the cache has gone stale and mirrors anything new into the
 * Sheet. Every read path goes through here, so opening the app is enough to
 * pick up a quiz Sid uploaded a minute ago.
 */
export async function syncQuizzes(force = false): Promise<RegistrySnapshot> {
  const config = requireConfig();
  return refreshRegistry({
    folderId: config.driveFolderId,
    refreshMinutes: config.refreshMinutes,
    force,
    onImported: async (quiz: ImportedQuiz) => {
      await logQuizImport(config.sheetId, quiz);
    },
  });
}

/** The full quiz, answer key included. Never serialise this to a client. */
export async function loadQuiz(setId: string): Promise<ImportedQuiz | undefined> {
  const existing = cachedQuiz(setId);
  if (existing) return existing;
  // A cold serverless instance has an empty cache; one scan populates it.
  await syncQuizzes();
  return cachedQuiz(setId);
}
