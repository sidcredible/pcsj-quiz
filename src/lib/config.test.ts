import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diagnoseConfig } from "./config";

const KEYS = [
  "GOOGLE_SERVICE_ACCOUNT_KEY",
  "GOOGLE_SERVICE_ACCOUNT_KEY_FILE",
  "DRIVE_FOLDER_ID",
  "SHEET_ID",
  "QUIZ_FIXTURE_DIR",
  "SHEETS_DRY_RUN",
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const validKey = JSON.stringify({
  client_email: "pcsj@example.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
});

describe("diagnoseConfig", () => {
  it("names the missing key, and says a redeploy is needed", () => {
    const d = diagnoseConfig();
    expect(d.ok).toBe(false);
    const text = d.problems.join(" ");
    expect(text).toContain("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
    // The failure mode people actually hit: added in Vercel, never redeployed.
    expect(text).toContain("redeploy");
    expect(text).toContain("Production, Preview and Development");
  });

  it("names every missing variable at once, not just the first", () => {
    const d = diagnoseConfig();
    const text = d.problems.join(" ");
    expect(text).toContain("DRIVE_FOLDER_ID");
    expect(text).toContain("SHEET_ID");
  });

  it("is satisfied by a complete Google configuration", () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = validKey;
    process.env.DRIVE_FOLDER_ID = "folder";
    process.env.SHEET_ID = "sheet";
    const d = diagnoseConfig();
    expect(d.ok).toBe(true);
    expect(d.problems).toEqual([]);
    expect(d.mode).toBe("google");
  });

  it("catches a key that is set but not valid JSON", () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = "-----BEGIN PRIVATE KEY-----";
    process.env.DRIVE_FOLDER_ID = "folder";
    process.env.SHEET_ID = "sheet";
    const d = diagnoseConfig();
    expect(d.ok).toBe(false);
    expect(d.problems.join(" ")).toContain("not valid JSON");
  });

  it("catches a key whose private_key was truncated on paste", () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify({
      client_email: "a@b.iam.gserviceaccount.com",
      private_key: "oops",
    });
    process.env.DRIVE_FOLDER_ID = "folder";
    process.env.SHEET_ID = "sheet";
    expect(diagnoseConfig().problems.join(" ")).toContain("truncated");
  });

  it("catches a key object missing client_email", () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify({
      private_key: "-----BEGIN PRIVATE KEY-----\nx\n",
    });
    process.env.DRIVE_FOLDER_ID = "folder";
    process.env.SHEET_ID = "sheet";
    expect(diagnoseConfig().problems.join(" ")).toContain("no client_email");
  });

  it("treats local mode as configured without any Google settings", () => {
    process.env.QUIZ_FIXTURE_DIR = "./fixtures";
    process.env.SHEETS_DRY_RUN = "1";
    const d = diagnoseConfig();
    expect(d.ok).toBe(true);
    expect(d.mode).toBe("local");
  });

  it("never reports a value, only presence and length", () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = validKey;
    const serialised = JSON.stringify(diagnoseConfig().variables);
    expect(serialised).not.toContain("BEGIN PRIVATE KEY");
    expect(serialised).not.toContain("pcsj@example");
    const entry = diagnoseConfig().variables.find(
      (v) => v.name === "GOOGLE_SERVICE_ACCOUNT_KEY",
    )!;
    expect(entry.present).toBe(true);
    expect(entry.length).toBe(validKey.length);
  });
});
