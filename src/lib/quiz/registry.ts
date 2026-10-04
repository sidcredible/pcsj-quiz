/**
 * The in-process quiz cache: Drive in, validated quizzes out.
 *
 * Holds the full QuizSet (answer keys included) server-side so the attempt and
 * review routes can score without ever sending a key to the browser. Re-scans
 * when the configured refresh interval has elapsed, when a caller forces it,
 * or when a file's modifiedTime has changed, which is how a correction is
 * detected (handbook section 2, step 5).
 *
 * A correction re-upserts the quiz's Quizzes and Questions rows via the
 * onImported hook, which the Sheets layer supplies.
 */

import { setIdFromFileName, type DriveQuizFile } from "../drive/client";
import { quizSource, type QuizSource } from "../drive/source";
import { consistencyWarnings, validateQuizSet } from "./validate";
import type { QuizSet } from "./types";

export interface ImportedQuiz {
  setId: string;
  fileId: string;
  fileName: string;
  modifiedTime: string;
  importedAt: string;
  set: QuizSet;
  warnings: string[];
}

export interface RejectedQuiz {
  fileName: string;
  fileId: string;
  modifiedTime: string;
  errors: string[];
}

export interface RegistrySnapshot {
  quizzes: ImportedQuiz[];
  rejected: RejectedQuiz[];
  scannedAt: string | null;
  /** Set when the scan itself failed (no Drive access, folder not shared). */
  scanError?: string;
}

/** Called for each newly imported or re-imported quiz, in Drive order. */
export type ImportHook = (quiz: ImportedQuiz) => Promise<void>;

interface RegistryState {
  byFileName: Map<string, ImportedQuiz>;
  rejected: Map<string, RejectedQuiz>;
  scannedAt: number | null;
  scanError?: string;
  inFlight: Promise<RegistrySnapshot> | null;
}

const state: RegistryState = {
  byFileName: new Map(),
  rejected: new Map(),
  scannedAt: null,
  inFlight: null,
};

export interface RefreshOptions {
  folderId: string;
  refreshMinutes: number;
  /** Re-scan even if the cache is still fresh. */
  force?: boolean;
  onImported?: ImportHook;
  now?: () => number;
  /** Defaults to Drive, or the fixture directory when one is configured. */
  source?: QuizSource;
}

function isFresh(scannedAt: number | null, refreshMinutes: number, now: number) {
  if (scannedAt === null) return false;
  return now - scannedAt < refreshMinutes * 60_000;
}

function snapshot(): RegistrySnapshot {
  // Drive order is preserved by insertion order during the scan.
  return {
    quizzes: [...state.byFileName.values()],
    rejected: [...state.rejected.values()],
    scannedAt: state.scannedAt === null ? null : new Date(state.scannedAt).toISOString(),
    ...(state.scanError ? { scanError: state.scanError } : {}),
  };
}

async function importFile(
  file: DriveQuizFile,
  onImported: ImportHook | undefined,
  source: QuizSource,
): Promise<void> {
  let raw: unknown;
  try {
    raw = await source.download(file.id);
  } catch (error) {
    state.rejected.set(file.name, {
      fileName: file.name,
      fileId: file.id,
      modifiedTime: file.modifiedTime,
      errors: [error instanceof Error ? error.message : "Download failed."],
    });
    return;
  }

  const result = validateQuizSet(raw);
  if (!result.ok) {
    // An invalid file is hidden from candidates and surfaced to the admin.
    state.rejected.set(file.name, {
      fileName: file.name,
      fileId: file.id,
      modifiedTime: file.modifiedTime,
      errors: result.errors,
    });
    return;
  }

  const expectedSetId = setIdFromFileName(file.name);
  const warnings = consistencyWarnings(result.set);
  if (result.set.set_id !== expectedSetId) {
    warnings.unshift(
      `File is named ${file.name} but set_id is ${result.set.set_id}; ` +
        `using the set_id from the file.`,
    );
  }

  const quiz: ImportedQuiz = {
    setId: result.set.set_id,
    fileId: file.id,
    fileName: file.name,
    modifiedTime: file.modifiedTime,
    importedAt: new Date().toISOString(),
    set: result.set,
    warnings,
  };

  state.byFileName.set(file.name, quiz);
  state.rejected.delete(file.name);

  if (onImported) {
    // A Sheet write must not cost the candidate their quiz list, so a failure
    // here is logged and the import still stands.
    try {
      await onImported(quiz);
    } catch (error) {
      console.error(`Sheet upsert failed for ${quiz.setId}:`, error);
    }
  }
}

export async function refreshRegistry(
  options: RefreshOptions,
): Promise<RegistrySnapshot> {
  const now = (options.now ?? Date.now)();

  if (!options.force && isFresh(state.scannedAt, options.refreshMinutes, now)) {
    return snapshot();
  }
  // Concurrent requests on a cold cache must not each hit Drive.
  if (state.inFlight) return state.inFlight;

  const source = options.source ?? quizSource();

  const run = (async (): Promise<RegistrySnapshot> => {
    let files: DriveQuizFile[];
    try {
      files = await source.list(options.folderId);
      delete state.scanError;
    } catch (error) {
      state.scanError =
        error instanceof Error ? error.message : "Could not list the folder.";
      state.scannedAt = now;
      return snapshot();
    }

    const seen = new Set(files.map((f) => f.name));
    const ordered = new Map<string, ImportedQuiz>();

    for (const file of files) {
      const cached = state.byFileName.get(file.name);
      const unchanged = cached && cached.modifiedTime === file.modifiedTime;
      const previouslyRejected = state.rejected.get(file.name);
      const rejectionUnchanged =
        previouslyRejected &&
        previouslyRejected.modifiedTime === file.modifiedTime;

      if (unchanged) {
        ordered.set(file.name, cached);
        continue;
      }
      if (!cached && rejectionUnchanged) {
        // Still broken, and not re-downloaded; keep the existing error.
        continue;
      }
      await importFile(file, options.onImported, source);
      const imported = state.byFileName.get(file.name);
      if (imported) ordered.set(file.name, imported);
    }

    // Rebuild in Drive order, dropping anything no longer in the folder. Past
    // attempts keep their rows in the Sheet regardless; only the list changes.
    state.byFileName = ordered;
    for (const name of [...state.rejected.keys()]) {
      if (!seen.has(name)) state.rejected.delete(name);
    }

    state.scannedAt = now;
    return snapshot();
  })();

  state.inFlight = run;
  try {
    return await run;
  } finally {
    state.inFlight = null;
  }
}

/** The cached quiz for a set_id, with its answer key. Server-side only. */
export function cachedQuiz(setId: string): ImportedQuiz | undefined {
  for (const quiz of state.byFileName.values()) {
    if (quiz.setId === setId) return quiz;
  }
  return undefined;
}

export function currentSnapshot(): RegistrySnapshot {
  return snapshot();
}

/** Test seam: drops all cached state. */
export function resetRegistry(): void {
  state.byFileName = new Map();
  state.rejected = new Map();
  state.scannedAt = null;
  state.inFlight = null;
  delete state.scanError;
}
