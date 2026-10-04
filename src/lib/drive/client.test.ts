import { describe, expect, it } from "vitest";
import {
  orderAndDeduplicate,
  parseQuizFileName,
  setIdFromFileName,
} from "./client";

const file = (name: string, modifiedTime: string, id = name) => ({
  id,
  name,
  modifiedTime,
});

describe("orderAndDeduplicate", () => {
  it("puts the newest quiz first, by name", () => {
    const ordered = orderAndDeduplicate([
      file("2026-09-01_bail.json", "2026-09-01T10:00:00Z"),
      file("2026-10-04_pocso.json", "2026-10-04T15:07:58Z"),
      file("2026-09-28_evidence.json", "2026-09-28T10:00:00Z"),
    ]);
    expect(ordered.map((f) => f.name)).toEqual([
      "2026-10-04_pocso.json",
      "2026-09-28_evidence.json",
      "2026-09-01_bail.json",
    ]);
  });

  it("orders a same-day suffixed set after the unsuffixed one", () => {
    // "-2" sorts above the bare name descending, which is the intended
    // newest-first order for a second set generated the same day.
    const ordered = orderAndDeduplicate([
      file("2026-10-04_pocso.json", "2026-10-04T09:00:00Z"),
      file("2026-10-04_pocso-2.json", "2026-10-04T14:00:00Z"),
    ]);
    expect(ordered[0]!.name).toBe("2026-10-04_pocso-2.json");
  });

  it("keeps only the latest copy when a name repeats", () => {
    const ordered = orderAndDeduplicate([
      file("2026-10-04_pocso.json", "2026-10-04T09:00:00Z", "old"),
      file("2026-10-04_pocso.json", "2026-10-04T18:00:00Z", "new"),
    ]);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]!.id).toBe("new");
  });

  it("survives an empty folder", () => {
    expect(orderAndDeduplicate([])).toEqual([]);
  });
});

describe("setIdFromFileName", () => {
  it("strips the extension to give the set_id", () => {
    expect(setIdFromFileName("2026-10-04_pocso.json")).toBe("2026-10-04_pocso");
    expect(setIdFromFileName("2026-10-04_pocso-2.json")).toBe(
      "2026-10-04_pocso-2",
    );
  });
});

describe("parseQuizFileName", () => {
  it("reads the date, slug and same-day sequence", () => {
    expect(parseQuizFileName("2026-10-04_pocso.json")).toEqual({
      date: "2026-10-04",
      slug: "pocso",
      sequence: 1,
    });
    expect(parseQuizFileName("2026-10-04_pocso-3.json")).toEqual({
      date: "2026-10-04",
      slug: "pocso",
      sequence: 3,
    });
  });

  it("keeps a hyphenated topic slug intact", () => {
    expect(parseQuizFileName("2026-10-04_bail-and-remand.json")).toEqual({
      date: "2026-10-04",
      slug: "bail-and-remand",
      sequence: 1,
    });
  });

  it("does not throw on a name that breaks the convention", () => {
    expect(parseQuizFileName("notes.json").slug).toBe("notes");
  });
});

describe("orderAndDeduplicate: same-day sequences", () => {
  it("ranks -3 above -2 above the unsuffixed set", () => {
    const ordered = orderAndDeduplicate([
      file("2026-10-04_pocso-2.json", "2026-10-04T11:00:00Z"),
      file("2026-10-04_pocso.json", "2026-10-04T09:00:00Z"),
      file("2026-10-04_pocso-3.json", "2026-10-04T13:00:00Z"),
    ]);
    expect(ordered.map((f) => f.name)).toEqual([
      "2026-10-04_pocso-3.json",
      "2026-10-04_pocso-2.json",
      "2026-10-04_pocso.json",
    ]);
  });

  it("still orders by date first, across days", () => {
    const ordered = orderAndDeduplicate([
      file("2026-10-04_pocso-2.json", "2026-10-04T11:00:00Z"),
      file("2026-10-05_bail.json", "2026-10-05T09:00:00Z"),
    ]);
    expect(ordered[0]!.name).toBe("2026-10-05_bail.json");
  });

  it("uses a hyphenated slug without reading it as a sequence", () => {
    const ordered = orderAndDeduplicate([
      file("2026-10-04_bail-and-remand.json", "2026-10-04T09:00:00Z"),
      file("2026-10-04_pocso.json", "2026-10-04T10:00:00Z"),
    ]);
    // Both are sequence 1, so modifiedTime decides: POCSO was uploaded later.
    expect(ordered[0]!.name).toBe("2026-10-04_pocso.json");
  });
});
