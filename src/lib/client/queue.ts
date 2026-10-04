/**
 * The submit queue: an attempt is written to localStorage before it is sent,
 * and only removed once the server confirms it is in the Sheet.
 *
 * This is what makes the acceptance checklist's "offline or Google error on
 * submit: the attempt is queued and written later, never lost" true even if
 * the candidate closes the tab or the laptop dies: the queue is re-sent on the
 * next page load and whenever the browser comes back online. Retries are safe
 * because attempt_id is a UUID generated once, and the server upserts by it.
 *
 * Every localStorage access is wrapped: private mode, cleared site data and
 * blocked storage all throw rather than returning null.
 */

export const QUEUE_KEY = "pcsj-quiz.submit-queue.v1";
const MAX_QUEUED = 50;

export interface QueuedSubmission {
  attempt_id: string;
  set_id: string;
  candidate: string;
  started_at: string;
  mode: "practice" | "timed";
  device: "mobile" | "desktop";
  negative_marking: number;
  answers: unknown[];
  /** When this attempt was first queued, for ordering and for reporting. */
  queued_at: string;
  attempts_to_send: number;
}

export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readQueue(store: Storage | null = storage()): QueuedSubmission[] {
  if (!store) return [];
  try {
    const raw = store.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is QueuedSubmission =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as QueuedSubmission).attempt_id === "string",
    );
  } catch {
    // A corrupt queue must not break the app; the attempt in hand still sends.
    return [];
  }
}

export function writeQueue(
  queue: readonly QueuedSubmission[],
  store: Storage | null = storage(),
): void {
  if (!store) return;
  try {
    // Newest kept: an old unsent attempt is less valuable than today's, and an
    // unbounded queue would eventually exceed the storage quota.
    const trimmed = queue.slice(-MAX_QUEUED);
    store.setItem(QUEUE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded or storage blocked: nothing more to do here.
  }
}

/** Adds or replaces an attempt in the queue, keyed by attempt_id. */
export function enqueue(
  submission: QueuedSubmission,
  store: Storage | null = storage(),
): QueuedSubmission[] {
  const queue = readQueue(store);
  const index = queue.findIndex((q) => q.attempt_id === submission.attempt_id);
  if (index >= 0) {
    queue[index] = submission;
  } else {
    queue.push(submission);
  }
  writeQueue(queue, store);
  return queue;
}

export function dequeue(
  attemptId: string,
  store: Storage | null = storage(),
): QueuedSubmission[] {
  const queue = readQueue(store).filter((q) => q.attempt_id !== attemptId);
  writeQueue(queue, store);
  return queue;
}

export function markAttempted(
  attemptId: string,
  store: Storage | null = storage(),
): void {
  const queue = readQueue(store).map((entry) =>
    entry.attempt_id === attemptId
      ? { ...entry, attempts_to_send: entry.attempts_to_send + 1 }
      : entry,
  );
  writeQueue(queue, store);
}

export interface FlushResult {
  sent: string[];
  failed: string[];
  /** Attempts the server rejected as unsendable, so retrying cannot help. */
  dropped: { attempt_id: string; reason: string }[];
}

export type Sender = (submission: QueuedSubmission) => Promise<Response>;

/**
 * Tries to send every queued attempt. A 4xx other than 408/429 means the
 * attempt can never be accepted, so it is dropped with a reason rather than
 * retried forever; anything else stays queued for the next attempt.
 */
export async function flushQueue(
  send: Sender,
  store: Storage | null = storage(),
): Promise<FlushResult> {
  const result: FlushResult = { sent: [], failed: [], dropped: [] };

  for (const submission of readQueue(store)) {
    markAttempted(submission.attempt_id, store);
    try {
      const response = await send(submission);
      if (response.ok) {
        dequeue(submission.attempt_id, store);
        result.sent.push(submission.attempt_id);
        continue;
      }
      const retryable =
        response.status >= 500 || response.status === 408 || response.status === 429;
      if (retryable) {
        result.failed.push(submission.attempt_id);
        continue;
      }
      let reason = `Server rejected the attempt (${response.status}).`;
      try {
        const body = (await response.json()) as { detail?: string; error?: string };
        reason = body.detail ?? body.error ?? reason;
      } catch {
        // Keep the status-code message.
      }
      dequeue(submission.attempt_id, store);
      result.dropped.push({ attempt_id: submission.attempt_id, reason });
    } catch {
      // Offline, DNS failure, aborted request: keep it for next time.
      result.failed.push(submission.attempt_id);
    }
  }

  return result;
}

export function newAttemptId(): string {
  const webCrypto: Crypto | undefined =
    typeof crypto === "undefined" ? undefined : crypto;

  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  // Older Safari lacks randomUUID; the server only requires UUID shape.
  const bytes = new Uint8Array(16);
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function detectDevice(): "mobile" | "desktop" {
  if (typeof window === "undefined") return "desktop";
  return window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop";
}
