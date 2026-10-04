/** Small helpers so every route fails in the same shape. */

import { NextResponse } from "next/server";
import { ConfigError } from "../config";
import { NotConfiguredError } from "./quiz-service";

export interface ApiError {
  error: string;
  detail?: string;
}

export function jsonError(
  message: string,
  status: number,
  detail?: string,
): NextResponse<ApiError> {
  return NextResponse.json(
    { error: message, ...(detail ? { detail } : {}) },
    { status },
  );
}

/**
 * Maps a thrown error to a response. Configuration problems are the operator's
 * to fix and say so plainly; anything else is logged server-side and reported
 * without leaking internals to the candidate.
 */
export function errorResponse(error: unknown): NextResponse<ApiError> {
  if (error instanceof NotConfiguredError || error instanceof ConfigError) {
    return jsonError("Not configured", 503, error.message);
  }
  console.error("Request failed:", error);
  const detail = error instanceof Error ? error.message : undefined;
  return jsonError("Something went wrong", 500, detail);
}

/** Parses a JSON body, rejecting anything that is not an object. */
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new BadRequestError("Body is not valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("Body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

export function handle(error: unknown): NextResponse<ApiError> {
  if (error instanceof BadRequestError) {
    return jsonError("Bad request", 400, error.message);
  }
  return errorResponse(error);
}
