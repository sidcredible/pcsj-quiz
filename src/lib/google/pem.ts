/**
 * Repairs a PEM private key that has been through an environment variable.
 *
 * A service-account key is fine in the file Google gives you, but it has to
 * survive being pasted into a dashboard, stored, and handed back as
 * process.env. Along that path its newlines get mangled in several routine
 * ways, and every one of them produces the same unhelpful OpenSSL error:
 *
 *   error:1E08010C:DECODER routines::unsupported
 *
 * The forms seen in practice:
 *   - escaped: the literal two characters \n survive instead of a newline
 *   - double-escaped: \\n, when a value passes through two layers of encoding
 *   - CRLF: \r\n from a Windows clipboard
 *   - flattened: the newlines became spaces, or vanished entirely, leaving the
 *     whole key on one line
 *   - quoted: the value kept the surrounding " or ' from wherever it was copied
 *
 * All of them are recoverable without the user re-pasting anything, because
 * the base64 body is intact in each; only its line structure is damaged. This
 * rebuilds that structure rather than asking them to try again.
 *
 * Nothing here logs or returns key material.
 */

/** PEM bodies are wrapped at 64 characters by convention, and by RFC 7468. */
const LINE_WIDTH = 64;

const PEM_RE =
  /-----BEGIN ([A-Z][A-Z ]*)-----([\s\S]*?)-----END ([A-Z][A-Z ]*)-----/;

export interface PemRepair {
  key: string;
  /** What had to be done, for diagnostics. Never includes key material. */
  repairs: string[];
}

function stripWrappingQuotes(value: string): { value: string; stripped: boolean } {
  const trimmed = value.trim();
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (trimmed.length > 1 && (first === '"' || first === "'") && last === first) {
    return { value: trimmed.slice(1, -1), stripped: true };
  }
  return { value: trimmed, stripped: false };
}

/**
 * Returns a PEM OpenSSL will accept, plus the list of repairs applied. Throws
 * nothing: an input with no PEM envelope comes back unchanged for the caller
 * to reject with its own message.
 */
export function repairPem(input: string): PemRepair {
  const repairs: string[] = [];

  const quoted = stripWrappingQuotes(input);
  let value = quoted.value;
  if (quoted.stripped) repairs.push("removed surrounding quotes");

  // Order matters: the double-escaped form contains the escaped form.
  if (value.includes("\\\\n")) {
    value = value.replace(/\\\\n/g, "\n");
    repairs.push("converted double-escaped \\\\n");
  }
  if (value.includes("\\r\\n")) {
    value = value.replace(/\\r\\n/g, "\n");
    repairs.push("converted escaped \\r\\n");
  }
  if (value.includes("\\n")) {
    value = value.replace(/\\n/g, "\n");
    repairs.push("converted escaped \\n");
  }
  if (value.includes("\r")) {
    value = value.replace(/\r\n?/g, "\n");
    repairs.push("normalised CRLF line endings");
  }

  const match = PEM_RE.exec(value);
  if (!match) return { key: value, repairs };

  const [, beginLabel, body, endLabel] = match;
  const label = (beginLabel ?? "").trim();
  if (label !== (endLabel ?? "").trim()) {
    // Mismatched header and footer: leave it alone, the caller will reject it.
    return { key: value, repairs };
  }

  // The body is base64 plus whatever whitespace survived. Strip all of it and
  // re-wrap, which fixes flattened keys and leaves well-formed ones identical.
  const base64 = (body ?? "").replace(/\s+/g, "");
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += LINE_WIDTH) {
    lines.push(base64.slice(i, i + LINE_WIDTH));
  }

  const rebuilt = `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;

  // Compare trimmed, so a key that only differs by a trailing newline is not
  // reported as repaired: "no repairs" should mean the key arrived intact.
  if (rebuilt.trim() !== value.trim()) {
    const bodyHadNewlines = /\n/.test((body ?? "").trim());
    repairs.push(
      bodyHadNewlines ? "rewrapped the key body" : "restored the key's line breaks",
    );
  }

  return { key: rebuilt, repairs };
}

/** Facts about a PEM that are safe to report: no base64 body is ever included. */
export interface PemShape {
  length: number;
  looksLikePem: boolean;
  label: string | null;
  bodyChars: number;
  lineCount: number;
  hadEscapedNewlines: boolean;
  hadRealNewlines: boolean;
}

export function describePem(input: string): PemShape {
  const match = PEM_RE.exec(input);
  const body = match?.[2] ?? "";
  return {
    length: input.length,
    looksLikePem: Boolean(match),
    label: match?.[1]?.trim() ?? null,
    bodyChars: body.replace(/\s+/g, "").length,
    lineCount: input.split("\n").length,
    hadEscapedNewlines: input.includes("\\n"),
    hadRealNewlines: input.includes("\n"),
  };
}
