/**
 * Reads the PCSJ Quizzes Drive folder. Input only: no method here writes.
 *
 * Ordering and de-duplication follow handbook section 2. File names start with
 * the quiz date, so sorting by name descending is newest-first; ties break on
 * modifiedTime, and two files sharing a name means a correction, where the
 * later modifiedTime wins.
 */

import { drive_v3, google } from "googleapis";
import { googleAuth } from "../google/auth";

export interface DriveQuizFile {
  id: string;
  name: string;
  modifiedTime: string;
  size?: number;
}

let client: drive_v3.Drive | undefined;

function driveClient(): drive_v3.Drive {
  if (!client) {
    client = google.drive({ version: "v3", auth: googleAuth() });
  }
  return client;
}

/**
 * A quiz file name decomposed for ordering: `2026-10-04_pocso-2.json` is the
 * second POCSO set generated on 4 Oct 2026.
 */
interface ParsedName {
  date: string;
  slug: string;
  sequence: number;
}

export function parseQuizFileName(name: string): ParsedName {
  const base = name.replace(/\.json$/i, "");
  const match = /^(\d{4}-\d{2}-\d{2})_(.*?)(?:-(\d+))?$/.exec(base);
  if (!match) return { date: "", slug: base, sequence: 1 };
  const [, date, slug, sequence] = match;
  return {
    date: date ?? "",
    slug: slug ?? "",
    // An unsuffixed file is the first set of that day; `-2` is the second.
    sequence: sequence ? Number(sequence) : 1,
  };
}

/**
 * Newest first, one file per name.
 *
 * The handbook says "sort by name descending", which works because the name
 * starts with the date — but only until a same-day set appears. A raw string
 * compare puts `_pocso.json` above `_pocso-2.json`, because "." sorts above
 * "-" in ASCII, which is backwards: the `-2` set is the later one. So the
 * comparator sorts on the parts that carry the meaning instead: date, then
 * same-day sequence, then modifiedTime, each descending.
 */
export function orderAndDeduplicate(
  files: readonly DriveQuizFile[],
): DriveQuizFile[] {
  const newestByName = new Map<string, DriveQuizFile>();
  for (const file of files) {
    const existing = newestByName.get(file.name);
    if (!existing || file.modifiedTime > existing.modifiedTime) {
      newestByName.set(file.name, file);
    }
  }

  return [...newestByName.values()].sort((a, b) => {
    const left = parseQuizFileName(a.name);
    const right = parseQuizFileName(b.name);
    if (left.date !== right.date) return left.date < right.date ? 1 : -1;
    if (left.sequence !== right.sequence) return right.sequence - left.sequence;
    if (a.modifiedTime !== b.modifiedTime) {
      return a.modifiedTime < b.modifiedTime ? 1 : -1;
    }
    return left.slug.localeCompare(right.slug);
  });
}

export async function listQuizFiles(
  folderId: string,
): Promise<DriveQuizFile[]> {
  const drive = driveClient();
  const found: DriveQuizFile[] = [];
  let pageToken: string | undefined;

  do {
    const response = await drive.files.list({
      q:
        `'${folderId}' in parents and name contains '.json' and ` +
        `trashed = false`,
      fields: "nextPageToken, files(id, name, modifiedTime, size)",
      pageSize: 1000,
      orderBy: "name desc",
      ...(pageToken ? { pageToken } : {}),
    });

    for (const file of response.data.files ?? []) {
      // A folder could in principle hold a name like "notes.json.txt"; only
      // real .json files are quizzes.
      if (!file.id || !file.name || !file.name.endsWith(".json")) continue;
      found.push({
        id: file.id,
        name: file.name,
        modifiedTime: file.modifiedTime ?? "",
        ...(file.size ? { size: Number(file.size) } : {}),
      });
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return orderAndDeduplicate(found);
}

/** Downloads one quiz file and parses it. Throws on unparseable JSON. */
export async function downloadQuizFile(fileId: string): Promise<unknown> {
  const drive = driveClient();
  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "text" },
  );
  const body = response.data;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("File is not valid JSON.");
  }
}

/** `2026-10-04_pocso.json` -> `2026-10-04_pocso` */
export function setIdFromFileName(name: string): string {
  return name.replace(/\.json$/i, "");
}
