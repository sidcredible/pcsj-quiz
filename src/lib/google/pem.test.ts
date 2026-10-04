import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { describePem, repairPem } from "./pem";

/** A real key, so "OpenSSL accepts it" is the assertion, not a regex match. */
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const GOOD = privateKey as unknown as string;

const accepts = (pem: string) => {
  createPrivateKey(pem);
  return true;
};

describe("repairPem", () => {
  it("leaves a well-formed key usable and reports no repair", () => {
    const { key, repairs } = repairPem(GOOD);
    expect(accepts(key)).toBe(true);
    expect(repairs).toEqual([]);
  });

  it("repairs a key whose newlines are the literal characters backslash-n", () => {
    const broken = GOOD.replace(/\n/g, "\\n");
    const { key, repairs } = repairPem(broken);
    expect(accepts(key)).toBe(true);
    expect(repairs).toContain("converted escaped \\n");
  });

  it("repairs a double-escaped key", () => {
    const broken = GOOD.replace(/\n/g, "\\\\n");
    expect(accepts(repairPem(broken).key)).toBe(true);
  });

  it("repairs CRLF line endings from a Windows clipboard", () => {
    const broken = GOOD.replace(/\n/g, "\r\n");
    const { key, repairs } = repairPem(broken);
    expect(accepts(key)).toBe(true);
    expect(repairs).toContain("normalised CRLF line endings");
  });

  it("repairs a key flattened onto one line with spaces", () => {
    // The form a dashboard produces when it collapses whitespace: this is the
    // one that yields DECODER routines::unsupported.
    const broken = GOOD.trim().replace(/\n/g, " ");
    const { key, repairs } = repairPem(broken);
    expect(accepts(key)).toBe(true);
    expect(repairs).toContain("restored the key's line breaks");
  });

  it("repairs a key whose newlines were deleted outright", () => {
    const header = "-----BEGIN PRIVATE KEY-----";
    const footer = "-----END PRIVATE KEY-----";
    const body = GOOD.replace(header, "").replace(footer, "").replace(/\s+/g, "");
    expect(accepts(repairPem(`${header}${body}${footer}`).key)).toBe(true);
  });

  it("strips surrounding quotes kept from a copy", () => {
    const { key, repairs } = repairPem(`"${GOOD.replace(/\n/g, "\\n")}"`);
    expect(accepts(key)).toBe(true);
    expect(repairs).toContain("removed surrounding quotes");
  });

  it("handles the worst case: quoted, escaped and CRLF at once", () => {
    const broken = `"${GOOD.trim().replace(/\n/g, "\\r\\n")}"`;
    expect(accepts(repairPem(broken).key)).toBe(true);
  });

  it("preserves an RSA PRIVATE KEY label rather than assuming PKCS#8", () => {
    const rsa = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    }).privateKey as unknown as string;
    const { key } = repairPem(rsa.replace(/\n/g, " "));
    expect(key).toContain("-----BEGIN RSA PRIVATE KEY-----");
    expect(accepts(key)).toBe(true);
  });

  it("returns input unchanged when there is no PEM envelope", () => {
    expect(repairPem("not a key at all").key).toBe("not a key at all");
  });

  it("does not rebuild a key whose header and footer disagree", () => {
    const mismatched = GOOD.replace("-----END PRIVATE KEY-----", "-----END PUBLIC KEY-----");
    // Returned as-is apart from the trim every path applies, so the caller
    // rejects it with its own message rather than this silently "fixing" it.
    expect(repairPem(mismatched).key).toBe(mismatched.trim());
    expect(repairPem(mismatched).repairs).toEqual([]);
  });
});

describe("describePem", () => {
  it("reports shape without revealing any key material", () => {
    const shape = describePem(GOOD);
    expect(shape.looksLikePem).toBe(true);
    expect(shape.label).toBe("PRIVATE KEY");
    expect(shape.bodyChars).toBeGreaterThan(1000);
    expect(shape.hadRealNewlines).toBe(true);
    // The description must not carry the base64 itself.
    expect(JSON.stringify(shape)).not.toContain(GOOD.split("\n")[1]);
  });

  it("distinguishes an escaped key from a real one", () => {
    const shape = describePem(GOOD.replace(/\n/g, "\\n"));
    expect(shape.hadEscapedNewlines).toBe(true);
    expect(shape.hadRealNewlines).toBe(false);
  });
});
