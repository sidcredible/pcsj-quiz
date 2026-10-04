/**
 * GET /api/health
 *
 * Says whether this deployment is configured, and if not, exactly which
 * variable is missing or malformed and what to do about it.
 *
 * It reports presence, length and JSON-parse status only — never a value and
 * never any part of the private key — so it is safe to open on a failing
 * deployment and safe to paste into a bug report. When Google credentials are
 * present it also proves they work, by listing the Drive folder and opening
 * the Sheet, because "the variable is set" and "the service account can
 * actually read the folder" are different things and fail differently.
 */

import { NextResponse } from "next/server";
import { diagnoseConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const diagnosis = diagnoseConfig();
  const url = new URL(request.url);
  const deep = url.searchParams.get("check") === "google";

  const body: Record<string, unknown> = {
    configured: diagnosis.ok,
    mode: diagnosis.mode,
    variables: diagnosis.variables,
    problems: diagnosis.problems,
  };

  // The deep check costs two Google round trips, so it is opt-in.
  if (deep && diagnosis.ok) {
    body.google = await checkGoogle();
  } else if (deep) {
    body.google = { skipped: "configuration is incomplete; fix the above first" };
  }

  return NextResponse.json(body, { status: diagnosis.ok ? 200 : 503 });
}

/** Proves the service account can actually reach the folder and the Sheet. */
async function checkGoogle(): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};

  try {
    const { serviceAccountEmail } = await import("@/lib/google/auth");
    result.service_account = serviceAccountEmail();
  } catch (error) {
    result.service_account = errorText(error);
  }

  try {
    const { appConfig } = await import("@/lib/config");
    const { listQuizFiles } = await import("@/lib/drive/client");
    const files = await listQuizFiles(appConfig().driveFolderId);
    result.drive = {
      ok: true,
      files: files.length,
      newest: files[0]?.name ?? null,
    };
  } catch (error) {
    result.drive = {
      ok: false,
      error: errorText(error),
      hint:
        "Share the PCSJ Quizzes folder with the service account email above " +
        "as Viewer, and make sure the Drive API is enabled on its project.",
    };
  }

  try {
    const { appConfig } = await import("@/lib/config");
    const { ensureTabs } = await import("@/lib/sheets/client");
    await ensureTabs(appConfig().sheetId);
    result.sheet = { ok: true };
  } catch (error) {
    result.sheet = {
      ok: false,
      error: errorText(error),
      hint:
        "Share the PCSJ Quiz Log sheet with the service account email above " +
        "as Editor, and make sure the Sheets API is enabled on its project.",
    };
  }

  return result;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Never let a stack or a credential fragment out; the first line is enough
  // to tell a permission failure from a disabled API.
  return message.split("\n")[0]!.slice(0, 300);
}
