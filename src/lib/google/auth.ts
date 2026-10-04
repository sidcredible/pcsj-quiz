/**
 * Service-account auth for Drive (read-only) and Sheets (read/write).
 *
 * The key comes from GOOGLE_SERVICE_ACCOUNT_KEY as inline JSON (the shape
 * Vercel env vars want) or from a file path for local development. Scopes are
 * deliberately minimal: the Drive folder is input only, so the app has no
 * ability to write to it even if asked.
 */

import { readFileSync } from "node:fs";
import { GoogleAuth, type JWT } from "google-auth-library";
import { ConfigError } from "../config";
import { describePem, repairPem, type PemShape } from "./pem";

export const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
];

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id?: string;
  /** What repairPem had to do to make the key usable; empty when intact. */
  repairs: string[];
}

function parseKey(raw: string, origin: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(
      `${origin} is not valid JSON. Paste the whole service-account key object.`,
    );
  }
  const key = parsed as Partial<ServiceAccountKey>;
  if (!key.client_email || !key.private_key) {
    throw new ConfigError(
      `${origin} is missing client_email or private_key.`,
    );
  }
  // A key that has been through an environment variable arrives with its
  // newlines escaped, flattened or stripped; all of those are repairable, and
  // all of them otherwise fail as "DECODER routines::unsupported" much later.
  const { key: privateKey, repairs } = repairPem(key.private_key);

  // A truncated paste parses as JSON and carries the right client_email, so
  // the PEM envelope is the only thing that catches it here rather than as an
  // opaque DECODER error at the first API call.
  const shape = describePem(privateKey);
  if (!shape.looksLikePem) {
    throw new ConfigError(
      `${origin} has a private_key with no complete PEM envelope ` +
        `(${shape.length} characters); it was probably truncated when pasted.`,
    );
  }

  return {
    client_email: key.client_email,
    private_key: privateKey,
    repairs,
    ...(key.project_id ? { project_id: key.project_id } : {}),
  };
}

/**
 * Describes the configured key without revealing it: whether it parses, what
 * shape its PEM is in and what had to be repaired. For the health endpoint.
 */
export function describeCredentials(): {
  ok: boolean;
  client_email?: string;
  pem?: PemShape;
  repairs?: string[];
  error?: string;
} {
  try {
    const key = loadKey();
    return {
      ok: true,
      client_email: key.client_email,
      pem: describePem(key.private_key),
      repairs: key.repairs,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not read the key.",
    };
  }
}

/** A place a key might come from, in the order they are tried. */
interface KeySource {
  name: string;
  read(): string | undefined;
}

function keySources(): KeySource[] {
  return [
    {
      name: "GOOGLE_SERVICE_ACCOUNT_KEY",
      read: () => process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim() || undefined,
    },
    {
      // Base64 carries no quotes, newlines or backslashes, so it survives a
      // dashboard form that would otherwise escape or truncate the raw JSON.
      name: "GOOGLE_SERVICE_ACCOUNT_KEY_BASE64",
      read: () => {
        const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64?.trim();
        if (!raw) return undefined;
        try {
          return Buffer.from(raw, "base64").toString("utf8");
        } catch {
          throw new ConfigError(
            "GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 is not valid base64.",
          );
        }
      },
    },
    {
      name: "GOOGLE_SERVICE_ACCOUNT_KEY_FILE",
      read: () => {
        const path = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.trim();
        if (!path) return undefined;
        try {
          return readFileSync(path, "utf8");
        } catch {
          throw new ConfigError(`Could not read the key file at ${path}.`);
        }
      },
    },
  ];
}

/**
 * The first credential source that yields a usable key.
 *
 * Deliberately "first that works" rather than "first that is set": a half-
 * pasted value left in one variable should not veto a good key in another, and
 * that is not a hypothetical — a truncated paste is how this failed in
 * production. When every source fails, the error names each one and its own
 * reason, so the broken one is identifiable rather than merely implicated.
 */
function loadKey(): ServiceAccountKey {
  const failures: string[] = [];

  for (const source of keySources()) {
    let raw: string | undefined;
    try {
      raw = source.read();
    } catch (error) {
      failures.push(
        `${source.name}: ${error instanceof Error ? error.message : "unreadable"}`,
      );
      continue;
    }
    if (!raw) continue;

    try {
      return parseKey(raw, source.name);
    } catch (error) {
      failures.push(
        `${source.name}: ${error instanceof Error ? error.message : "invalid"}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new ConfigError(
      `No usable Google credentials. ${failures.join(" ")}`,
    );
  }

  throw new ConfigError(
    "No Google credentials. Set GOOGLE_SERVICE_ACCOUNT_KEY (the key JSON), " +
      "GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 (that JSON base64-encoded, which " +
      "survives a dashboard form unchanged), or GOOGLE_SERVICE_ACCOUNT_KEY_FILE " +
      "(a path, for local development).",
  );
}

let cached: GoogleAuth<JWT> | undefined;

/** A process-wide auth client; token refresh is handled by the library. */
export function googleAuth(): GoogleAuth<JWT> {
  if (!cached) {
    const key = loadKey();
    cached = new GoogleAuth({
      credentials: {
        client_email: key.client_email,
        private_key: key.private_key,
      },
      scopes: SCOPES,
    }) as GoogleAuth<JWT>;
  }
  return cached;
}

/** The address Sid must share the Drive folder and the Sheet with. */
export function serviceAccountEmail(): string {
  return loadKey().client_email;
}
