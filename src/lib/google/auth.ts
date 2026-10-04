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

function loadKey(): ServiceAccountKey {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
  if (inline) return parseKey(inline, "GOOGLE_SERVICE_ACCOUNT_KEY");

  const path = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.trim();
  if (path) {
    try {
      return parseKey(readFileSync(path, "utf8"), path);
    } catch (error) {
      if (error instanceof ConfigError) throw error;
      throw new ConfigError(`Could not read the key file at ${path}.`);
    }
  }

  throw new ConfigError(
    "No Google credentials. Set GOOGLE_SERVICE_ACCOUNT_KEY (inline JSON) or " +
      "GOOGLE_SERVICE_ACCOUNT_KEY_FILE (a path).",
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
