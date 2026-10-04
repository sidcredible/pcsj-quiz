/**
 * Turns a Google API failure into the thing that actually needs fixing.
 *
 * These fail in ways that look alike from the outside but need opposite
 * remedies: a mangled private key, a folder that was never shared, and an API
 * that was never enabled all surface as "the request failed". Guessing wrong
 * sends someone to re-share a folder that was always shared, or to re-paste a
 * key that was always fine.
 *
 * A hand-inlined service-account key is the common case here: it parses as
 * JSON, carries the right client_email, and still cannot sign a token, because
 * the newlines inside private_key were altered. OpenSSL reports that as a
 * DECODER error, which says nothing about keys to anyone who has not seen it
 * before.
 */

export type GoogleFailureKind =
  | "bad_private_key"
  | "clock_or_key_rejected"
  | "api_disabled"
  | "not_shared"
  | "not_found"
  | "unknown";

export interface GoogleFailure {
  kind: GoogleFailureKind;
  hint: string;
}

export interface DiagnoseOptions {
  /** "folder" or "sheet": what was being reached, for a precise hint. */
  target: "folder" | "sheet";
  serviceAccountEmail?: string;
}

export function diagnoseGoogleError(
  message: string,
  options: DiagnoseOptions,
): GoogleFailure {
  const text = message.toLowerCase();
  const who = options.serviceAccountEmail ?? "the service account";
  const what =
    options.target === "folder"
      ? "the PCSJ Quizzes Drive folder"
      : "the PCSJ Quiz Log sheet";
  const role = options.target === "folder" ? "Viewer" : "Editor";

  // OpenSSL cannot read the key at all: the PEM body was altered.
  if (
    text.includes("decoder routines") ||
    text.includes("unsupported") ||
    text.includes("bad decrypt") ||
    text.includes("asn1") ||
    text.includes("pem")
  ) {
    return {
      kind: "bad_private_key",
      hint:
        "The private key could not be read, which means GOOGLE_SERVICE_ACCOUNT_KEY " +
        "is valid JSON but its private_key value was altered — almost always by " +
        "reformatting or re-escaping the newlines when the file was put on one " +
        "line. Do not hand-edit it: copy the original downloaded .json file " +
        "verbatim, outer braces included, and paste that. Sharing and APIs are " +
        "not the problem here.",
    };
  }

  // The key is readable but Google will not issue a token for it.
  if (
    text.includes("invalid_grant") ||
    text.includes("invalid jwt") ||
    text.includes("invalid signature") ||
    text.includes("account not found")
  ) {
    return {
      kind: "clock_or_key_rejected",
      hint:
        "Google refused to issue a token for this key. Either the key has been " +
        "deleted or disabled in Google Cloud, or the pasted key does not match " +
        "the service account it claims to be. Create a fresh JSON key for " +
        `${who} and paste that file verbatim.`,
    };
  }

  if (text.includes("has not been used in project") || text.includes("is disabled")) {
    const api = options.target === "folder" ? "Google Drive API" : "Google Sheets API";
    return {
      kind: "api_disabled",
      hint:
        `The ${api} is not enabled on this service account's Google Cloud ` +
        "project. Enable it under APIs & Services > Library, then try again. " +
        "Nothing is wrong with the key or the sharing.",
    };
  }

  if (
    text.includes("permission") ||
    text.includes("forbidden") ||
    text.includes("403")
  ) {
    return {
      kind: "not_shared",
      hint:
        `The credentials work, but ${who} cannot open ${what}. Share it with ` +
        `that exact email address as ${role}.`,
    };
  }

  if (
    text.includes("not found") ||
    text.includes("notfound") ||
    text.includes("404")
  ) {
    return {
      kind: "not_found",
      hint:
        options.target === "folder"
          ? "No such folder. Either DRIVE_FOLDER_ID is wrong, or the folder has " +
            `not been shared with ${who} — an unshared folder is indistinguishable ` +
            "from a missing one to a service account."
          : "No such spreadsheet. Either SHEET_ID is wrong, or the sheet has not " +
            `been shared with ${who} — an unshared sheet is indistinguishable ` +
            "from a missing one to a service account.",
    };
  }

  return {
    kind: "unknown",
    hint:
      `Could not reach ${what}. Check that ${who} has access to it and that the ` +
      "Drive and Sheets APIs are enabled on its Google Cloud project.",
  };
}
