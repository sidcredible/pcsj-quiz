import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeCredentials } from "./auth";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const PEM = privateKey as unknown as string;

const keyJson = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "service_account",
    client_email: "pcsj@example.iam.gserviceaccount.com",
    private_key: PEM,
    ...overrides,
  });

const VARS = [
  "GOOGLE_SERVICE_ACCOUNT_KEY",
  "GOOGLE_SERVICE_ACCOUNT_KEY_BASE64",
  "GOOGLE_SERVICE_ACCOUNT_KEY_FILE",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const v of VARS) {
    saved[v] = process.env[v];
    delete process.env[v];
  }
});
afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

describe("credential loading", () => {
  it("reads a plain inline key", () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = keyJson();
    const d = describeCredentials();
    expect(d.ok).toBe(true);
    expect(d.client_email).toBe("pcsj@example.iam.gserviceaccount.com");
    expect(d.pem?.looksLikePem).toBe(true);
  });

  it("reads a base64 key", () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 =
      Buffer.from(keyJson()).toString("base64");
    expect(describeCredentials().ok).toBe(true);
  });

  it("repairs a key whose newlines were flattened in transit", () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = keyJson({
      private_key: PEM.trim().replace(/\n/g, " "),
    });
    const d = describeCredentials();
    expect(d.ok).toBe(true);
    expect(d.repairs).toContain("restored the key's line breaks");
  });

  it("rejects a truncated key rather than failing later as a DECODER error", () => {
    // The production failure: valid JSON, right client_email, PEM cut short.
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = keyJson({
      private_key: PEM.slice(0, 200),
    });
    const d = describeCredentials();
    expect(d.ok).toBe(false);
    expect(d.error).toContain("truncated");
  });

  it("falls through a truncated variable to a good one", () => {
    // A half-pasted value left behind must not veto a working key.
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = keyJson({
      private_key: PEM.slice(0, 200),
    });
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 =
      Buffer.from(keyJson()).toString("base64");

    const d = describeCredentials();
    expect(d.ok).toBe(true);
    expect(d.client_email).toBe("pcsj@example.iam.gserviceaccount.com");
  });

  it("names every source and its own reason when all fail", () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = "not json";
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 =
      Buffer.from("also not json").toString("base64");

    const d = describeCredentials();
    expect(d.ok).toBe(false);
    expect(d.error).toContain("GOOGLE_SERVICE_ACCOUNT_KEY:");
    expect(d.error).toContain("GOOGLE_SERVICE_ACCOUNT_KEY_BASE64:");
  });

  it("explains what to set when nothing is configured", () => {
    const d = describeCredentials();
    expect(d.ok).toBe(false);
    expect(d.error).toContain("GOOGLE_SERVICE_ACCOUNT_KEY_BASE64");
  });

  it("never reports key material", () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = keyJson();
    const serialised = JSON.stringify(describeCredentials());
    expect(serialised).not.toContain(PEM.split("\n")[1]);
    expect(serialised).not.toContain("BEGIN PRIVATE KEY");
  });
});
