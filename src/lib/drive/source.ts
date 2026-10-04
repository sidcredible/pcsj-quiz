/**
 * Where quiz files come from.
 *
 * Normally the PCSJ Quizzes Drive folder. When QUIZ_FIXTURE_DIR is set, a
 * local directory instead, which lets the app run with no Google credentials
 * at all — useful before the service account exists, and for checking the
 * renderers against real generator output without touching Drive.
 *
 * Both sources present the same shape, so the registry cannot tell them apart:
 * a local file's mtime stands in for modifiedTime, so editing a fixture is
 * picked up as a correction exactly as a re-upload would be.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  downloadQuizFile,
  listQuizFiles,
  orderAndDeduplicate,
  type DriveQuizFile,
} from "./client";

export interface QuizSource {
  readonly kind: "drive" | "fixtures";
  /** Human-readable, for the admin screen. */
  readonly description: string;
  list(folderId: string): Promise<DriveQuizFile[]>;
  download(fileId: string): Promise<unknown>;
}

const driveSource: QuizSource = {
  kind: "drive",
  description: "Google Drive folder",
  list: listQuizFiles,
  download: downloadQuizFile,
};

function fixtureSource(directory: string): QuizSource {
  const root = resolve(directory);
  return {
    kind: "fixtures",
    description: `local directory ${root}`,

    async list(): Promise<DriveQuizFile[]> {
      let names: string[];
      try {
        names = await readdir(root);
      } catch {
        throw new Error(
          `QUIZ_FIXTURE_DIR is set to ${root}, but that directory cannot be read.`,
        );
      }

      const files: DriveQuizFile[] = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const info = await stat(join(root, name));
        if (!info.isFile()) continue;
        files.push({
          // The path is the id, which is what download receives back.
          id: join(root, name),
          name,
          modifiedTime: info.mtime.toISOString(),
          size: info.size,
        });
      }
      return orderAndDeduplicate(files);
    },

    async download(fileId: string): Promise<unknown> {
      // fileId is a path this source produced; confine it to the fixture root
      // so nothing can walk out of the directory.
      const path = resolve(fileId);
      if (!path.startsWith(root)) {
        throw new Error("Refusing to read a file outside QUIZ_FIXTURE_DIR.");
      }
      const text = await readFile(path, "utf8");
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error("File is not valid JSON.");
      }
    },
  };
}

export function quizSource(): QuizSource {
  const fixtures = process.env.QUIZ_FIXTURE_DIR?.trim();
  return fixtures ? fixtureSource(fixtures) : driveSource;
}

export function usingFixtures(): boolean {
  return Boolean(process.env.QUIZ_FIXTURE_DIR?.trim());
}
