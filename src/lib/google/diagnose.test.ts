import { describe, expect, it } from "vitest";
import { diagnoseGoogleError } from "./diagnose";

const folder = { target: "folder" as const, serviceAccountEmail: "pcsj@x.iam.gserviceaccount.com" };
const sheet = { target: "sheet" as const, serviceAccountEmail: "pcsj@x.iam.gserviceaccount.com" };

describe("diagnoseGoogleError", () => {
  it("recognises a mangled private key, the hand-inlining failure", () => {
    // What OpenSSL says when private_key newlines were altered.
    const f = diagnoseGoogleError("error:1E08010C:DECODER routines::unsupported", folder);
    expect(f.kind).toBe("bad_private_key");
    expect(f.hint).toContain("verbatim");
    // Crucially it must NOT send the user off to re-share the folder.
    expect(f.hint).toContain("Sharing and APIs are not the problem");
  });

  it("recognises other PEM-level damage", () => {
    expect(diagnoseGoogleError("Failed to parse PEM block", folder).kind).toBe("bad_private_key");
    expect(diagnoseGoogleError("asn1 encoding routines", folder).kind).toBe("bad_private_key");
  });

  it("recognises a key Google refuses to sign for", () => {
    const f = diagnoseGoogleError("invalid_grant: Invalid JWT Signature.", sheet);
    expect(f.kind).toBe("clock_or_key_rejected");
    expect(f.hint).toContain("fresh JSON key");
  });

  it("recognises a disabled API, and names the right one", () => {
    const drive = diagnoseGoogleError(
      "Google Drive API has not been used in project 123 before or it is disabled",
      folder,
    );
    expect(drive.kind).toBe("api_disabled");
    expect(drive.hint).toContain("Google Drive API");

    const sheets = diagnoseGoogleError(
      "Google Sheets API has not been used in project 123 before or it is disabled",
      sheet,
    );
    expect(sheets.hint).toContain("Google Sheets API");
    expect(sheets.hint).toContain("Nothing is wrong with the key");
  });

  it("recognises a permission failure and names the role needed", () => {
    expect(diagnoseGoogleError("The caller does not have permission", folder).hint).toContain("Viewer");
    expect(diagnoseGoogleError("The caller does not have permission", sheet).hint).toContain("Editor");
  });

  it("explains that a 404 may really mean not shared", () => {
    const f = diagnoseGoogleError("Requested entity was not found.", sheet);
    expect(f.kind).toBe("not_found");
    // The non-obvious part: to a service account, unshared looks like missing.
    expect(f.hint).toContain("indistinguishable");
  });

  it("falls back to something useful for an unrecognised error", () => {
    const f = diagnoseGoogleError("socket hang up", folder);
    expect(f.kind).toBe("unknown");
    expect(f.hint).toContain("PCSJ Quizzes");
  });

  it("works without a service account email to name", () => {
    const f = diagnoseGoogleError("The caller does not have permission", { target: "folder" });
    expect(f.hint).toContain("the service account");
  });
});
