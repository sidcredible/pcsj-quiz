import { beforeEach, describe, expect, it, vi } from "vitest";

const listQuizFiles = vi.fn();
const downloadQuizFile = vi.fn();

vi.mock("../drive/client", async () => {
  const actual = await vi.importActual<typeof import("../drive/client")>(
    "../drive/client",
  );
  return { ...actual, listQuizFiles, downloadQuizFile };
});

const { cachedQuiz, refreshRegistry, resetRegistry } = await import("./registry");
const { SAMPLE_SET } = await import("./__fixtures__/sample-set");

const FOLDER = "folder-id";
const base = { folderId: FOLDER, refreshMinutes: 10 };

function driveFile(name: string, modifiedTime: string, id = name) {
  return { id, name, modifiedTime };
}

function setWithId(setId: string) {
  return { ...structuredClone(SAMPLE_SET), set_id: setId };
}

/** The fixture, renamed so its question ids match the given set_id. */
function consistentSet(setId: string) {
  const set = setWithId(setId);
  set.questions = set.questions.map((q) => ({
    ...q,
    id: q.id.replace("2026-10-04_sample", setId),
  }));
  return set;
}

beforeEach(() => {
  resetRegistry();
  listQuizFiles.mockReset();
  downloadQuizFile.mockReset();
});

describe("refreshRegistry", () => {
  it("imports a valid file and exposes it by set_id", async () => {
    listQuizFiles.mockResolvedValue([
      driveFile("2026-10-04_sample.json", "2026-10-04T15:00:00Z"),
    ]);
    downloadQuizFile.mockResolvedValue(structuredClone(SAMPLE_SET));

    const snapshot = await refreshRegistry(base);

    expect(snapshot.quizzes).toHaveLength(1);
    expect(snapshot.rejected).toHaveLength(0);
    expect(cachedQuiz("2026-10-04_sample")?.set.questions).toHaveLength(11);
  });

  it("hides an invalid file from candidates and records the error", async () => {
    listQuizFiles.mockResolvedValue([
      driveFile("2026-10-04_broken.json", "2026-10-04T15:00:00Z"),
    ]);
    downloadQuizFile.mockResolvedValue({ schema_version: "0.9" });

    const snapshot = await refreshRegistry(base);

    expect(snapshot.quizzes).toHaveLength(0);
    expect(snapshot.rejected).toHaveLength(1);
    expect(snapshot.rejected[0]!.errors[0]).toContain('expected "1.1"');
  });

  it("records unparseable JSON as a rejection, not a crash", async () => {
    listQuizFiles.mockResolvedValue([
      driveFile("2026-10-04_junk.json", "2026-10-04T15:00:00Z"),
    ]);
    downloadQuizFile.mockRejectedValue(new Error("File is not valid JSON."));

    const snapshot = await refreshRegistry(base);
    expect(snapshot.rejected[0]!.errors).toEqual(["File is not valid JSON."]);
  });

  it("serves the cache without re-downloading while it is fresh", async () => {
    listQuizFiles.mockResolvedValue([
      driveFile("2026-10-04_sample.json", "2026-10-04T15:00:00Z"),
    ]);
    downloadQuizFile.mockResolvedValue(structuredClone(SAMPLE_SET));

    let clock = 1_000_000;
    const now = () => clock;
    await refreshRegistry({ ...base, now });
    clock += 5 * 60_000; // 5 minutes, inside the 10-minute window
    await refreshRegistry({ ...base, now });

    expect(listQuizFiles).toHaveBeenCalledTimes(1);
    expect(downloadQuizFile).toHaveBeenCalledTimes(1);
  });

  it("re-scans once the refresh interval has passed", async () => {
    listQuizFiles.mockResolvedValue([
      driveFile("2026-10-04_sample.json", "2026-10-04T15:00:00Z"),
    ]);
    downloadQuizFile.mockResolvedValue(structuredClone(SAMPLE_SET));

    let clock = 1_000_000;
    const now = () => clock;
    await refreshRegistry({ ...base, now });
    clock += 11 * 60_000;
    await refreshRegistry({ ...base, now });

    expect(listQuizFiles).toHaveBeenCalledTimes(2);
    // modifiedTime is unchanged, so the file is not downloaded again.
    expect(downloadQuizFile).toHaveBeenCalledTimes(1);
  });

  it("re-downloads a file whose modifiedTime changed, and re-upserts it", async () => {
    const onImported = vi.fn().mockResolvedValue(undefined);
    listQuizFiles.mockResolvedValue([
      driveFile("2026-10-04_sample.json", "2026-10-04T15:00:00Z"),
    ]);
    downloadQuizFile.mockResolvedValue(structuredClone(SAMPLE_SET));
    await refreshRegistry({ ...base, onImported });

    // A correction: same name and ids, later modifiedTime.
    listQuizFiles.mockResolvedValue([
      driveFile("2026-10-04_sample.json", "2026-10-04T19:30:00Z"),
    ]);
    const corrected = structuredClone(SAMPLE_SET);
    corrected.title = "POCSO - corrected";
    downloadQuizFile.mockResolvedValue(corrected);

    await refreshRegistry({ ...base, onImported, force: true });

    expect(downloadQuizFile).toHaveBeenCalledTimes(2);
    expect(onImported).toHaveBeenCalledTimes(2);
    expect(cachedQuiz("2026-10-04_sample")?.set.title).toBe("POCSO - corrected");
  });

  it("keeps the quiz list usable when the Sheet upsert fails", async () => {
    listQuizFiles.mockResolvedValue([
      driveFile("2026-10-04_sample.json", "2026-10-04T15:00:00Z"),
    ]);
    downloadQuizFile.mockResolvedValue(structuredClone(SAMPLE_SET));
    const onImported = vi.fn().mockRejectedValue(new Error("Sheets down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const snapshot = await refreshRegistry({ ...base, onImported });

    expect(snapshot.quizzes).toHaveLength(1);
    spy.mockRestore();
  });

  it("reports a scan failure instead of throwing", async () => {
    listQuizFiles.mockRejectedValue(new Error("folder not shared"));
    const snapshot = await refreshRegistry(base);
    expect(snapshot.scanError).toBe("folder not shared");
    expect(snapshot.quizzes).toHaveLength(0);
  });

  it("keeps previously imported quizzes when a later scan fails", async () => {
    listQuizFiles.mockResolvedValue([
      driveFile("2026-10-04_sample.json", "2026-10-04T15:00:00Z"),
    ]);
    downloadQuizFile.mockResolvedValue(structuredClone(SAMPLE_SET));
    await refreshRegistry(base);

    listQuizFiles.mockRejectedValue(new Error("network"));
    const snapshot = await refreshRegistry({ ...base, force: true });

    expect(snapshot.scanError).toBe("network");
    expect(snapshot.quizzes).toHaveLength(1);
  });

  it("preserves Drive order in the snapshot", async () => {
    listQuizFiles.mockResolvedValue([
      driveFile("2026-10-05_bail.json", "2026-10-05T09:00:00Z"),
      driveFile("2026-10-04_sample.json", "2026-10-04T15:00:00Z"),
    ]);
    downloadQuizFile.mockImplementation(async (id: string) =>
      consistentSet(id.replace(".json", "")),
    );

    const snapshot = await refreshRegistry(base);
    expect(snapshot.quizzes.map((q) => q.setId)).toEqual([
      "2026-10-05_bail",
      "2026-10-04_sample",
    ]);
  });

  it("drops a quiz that has left the folder", async () => {
    listQuizFiles.mockResolvedValue([
      driveFile("2026-10-04_sample.json", "2026-10-04T15:00:00Z"),
    ]);
    downloadQuizFile.mockResolvedValue(structuredClone(SAMPLE_SET));
    await refreshRegistry(base);

    listQuizFiles.mockResolvedValue([]);
    const snapshot = await refreshRegistry({ ...base, force: true });

    expect(snapshot.quizzes).toHaveLength(0);
    expect(cachedQuiz("2026-10-04_sample")).toBeUndefined();
  });

  it("warns when the file name and set_id disagree", async () => {
    listQuizFiles.mockResolvedValue([
      driveFile("2026-10-04_renamed.json", "2026-10-04T15:00:00Z"),
    ]);
    downloadQuizFile.mockResolvedValue(structuredClone(SAMPLE_SET));

    const snapshot = await refreshRegistry(base);
    expect(snapshot.quizzes[0]!.warnings[0]).toContain("but set_id is");
    // The file's own set_id wins, since that is the key used everywhere else.
    expect(snapshot.quizzes[0]!.setId).toBe("2026-10-04_sample");
  });

  it("collapses concurrent cold-start scans into one Drive call", async () => {
    listQuizFiles.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return [driveFile("2026-10-04_sample.json", "2026-10-04T15:00:00Z")];
    });
    downloadQuizFile.mockResolvedValue(structuredClone(SAMPLE_SET));

    await Promise.all([
      refreshRegistry(base),
      refreshRegistry(base),
      refreshRegistry(base),
    ]);

    expect(listQuizFiles).toHaveBeenCalledTimes(1);
  });
});
