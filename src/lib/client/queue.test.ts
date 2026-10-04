import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  QUEUE_KEY,
  dequeue,
  enqueue,
  flushQueue,
  newAttemptId,
  readQueue,
  type QueuedSubmission,
  type Storage,
} from "./queue";

/** A localStorage stand-in, optionally one that throws like private mode. */
function fakeStore(options: { throwOnGet?: boolean; throwOnSet?: boolean } = {}) {
  const data = new Map<string, string>();
  return {
    data,
    store: {
      getItem(key: string) {
        if (options.throwOnGet) throw new Error("blocked");
        return data.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (options.throwOnSet) throw new Error("quota");
        data.set(key, value);
      },
    } satisfies Storage,
  };
}

function submission(id: string): QueuedSubmission {
  return {
    attempt_id: id,
    set_id: "2026-10-04_pocso",
    candidate: "Sid",
    started_at: "2026-10-04T16:00:00+05:30",
    mode: "practice",
    device: "mobile",
    negative_marking: 0,
    answers: [],
    queued_at: "2026-10-04T16:42:00+05:30",
    attempts_to_send: 0,
  };
}

const ok = () => new Response(null, { status: 201 });
const serverError = () => new Response(null, { status: 503 });
const badRequest = () =>
  new Response(JSON.stringify({ detail: "set_id is required." }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });

let fake: ReturnType<typeof fakeStore>;

beforeEach(() => {
  fake = fakeStore();
});

describe("queue persistence", () => {
  it("round-trips an attempt", () => {
    enqueue(submission("a"), fake.store);
    expect(readQueue(fake.store).map((q) => q.attempt_id)).toEqual(["a"]);
  });

  it("replaces rather than duplicates the same attempt_id", () => {
    enqueue(submission("a"), fake.store);
    enqueue({ ...submission("a"), candidate: "Sid A" }, fake.store);
    const queue = readQueue(fake.store);
    expect(queue).toHaveLength(1);
    expect(queue[0]!.candidate).toBe("Sid A");
  });

  it("removes an attempt once it is confirmed", () => {
    enqueue(submission("a"), fake.store);
    enqueue(submission("b"), fake.store);
    dequeue("a", fake.store);
    expect(readQueue(fake.store).map((q) => q.attempt_id)).toEqual(["b"]);
  });

  it("returns an empty queue when storage is unavailable", () => {
    expect(readQueue(null)).toEqual([]);
    expect(() => enqueue(submission("a"), null)).not.toThrow();
  });

  it("survives storage that throws, as in private mode", () => {
    const throwing = fakeStore({ throwOnGet: true });
    expect(readQueue(throwing.store)).toEqual([]);
    const quota = fakeStore({ throwOnSet: true });
    expect(() => enqueue(submission("a"), quota.store)).not.toThrow();
  });

  it("ignores a corrupt queue instead of breaking the app", () => {
    fake.data.set(QUEUE_KEY, "{not json");
    expect(readQueue(fake.store)).toEqual([]);
    fake.data.set(QUEUE_KEY, JSON.stringify([{ nope: true }, submission("a")]));
    expect(readQueue(fake.store).map((q) => q.attempt_id)).toEqual(["a"]);
  });

  it("caps the queue so it cannot exhaust the storage quota", () => {
    for (let i = 0; i < 60; i += 1) enqueue(submission(`a${i}`), fake.store);
    const queue = readQueue(fake.store);
    expect(queue).toHaveLength(50);
    // The newest are kept.
    expect(queue.at(-1)!.attempt_id).toBe("a59");
  });
});

describe("flushQueue", () => {
  it("sends every queued attempt and empties the queue", async () => {
    enqueue(submission("a"), fake.store);
    enqueue(submission("b"), fake.store);
    const send = vi.fn(async () => ok());

    const result = await flushQueue(send, fake.store);

    expect(send).toHaveBeenCalledTimes(2);
    expect(result.sent).toEqual(["a", "b"]);
    expect(readQueue(fake.store)).toEqual([]);
  });

  it("keeps an attempt queued when the server is unreachable", async () => {
    enqueue(submission("a"), fake.store);
    const send = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    const result = await flushQueue(send, fake.store);

    expect(result.failed).toEqual(["a"]);
    expect(readQueue(fake.store)).toHaveLength(1);
  });

  it("keeps an attempt queued on a 5xx, so a Google outage loses nothing", async () => {
    enqueue(submission("a"), fake.store);
    const result = await flushQueue(async () => serverError(), fake.store);
    expect(result.failed).toEqual(["a"]);
    expect(readQueue(fake.store)).toHaveLength(1);
  });

  it("retries a 429 rather than dropping it", async () => {
    enqueue(submission("a"), fake.store);
    const result = await flushQueue(
      async () => new Response(null, { status: 429 }),
      fake.store,
    );
    expect(result.failed).toEqual(["a"]);
  });

  it("drops an attempt the server can never accept, with a reason", async () => {
    enqueue(submission("a"), fake.store);
    const result = await flushQueue(async () => badRequest(), fake.store);

    expect(result.dropped).toEqual([
      { attempt_id: "a", reason: "set_id is required." },
    ]);
    expect(readQueue(fake.store)).toEqual([]);
  });

  it("counts send attempts so the UI can report a stuck queue", async () => {
    enqueue(submission("a"), fake.store);
    await flushQueue(async () => serverError(), fake.store);
    await flushQueue(async () => serverError(), fake.store);
    expect(readQueue(fake.store)[0]!.attempts_to_send).toBe(2);
  });

  it("eventually succeeds on a later flush, with the same attempt_id", async () => {
    enqueue(submission("a"), fake.store);
    await flushQueue(async () => serverError(), fake.store);

    const sent: string[] = [];
    await flushQueue(async (entry) => {
      sent.push(entry.attempt_id);
      return ok();
    }, fake.store);

    // The id is unchanged, which is what makes the server's upsert idempotent.
    expect(sent).toEqual(["a"]);
    expect(readQueue(fake.store)).toEqual([]);
  });

  it("does nothing on an empty queue", async () => {
    const send = vi.fn(async () => ok());
    const result = await flushQueue(send, fake.store);
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: [], failed: [], dropped: [] });
  });
});

describe("newAttemptId", () => {
  it("produces a distinct v4 UUID each time", () => {
    const first = newAttemptId();
    const second = newAttemptId();
    expect(first).not.toBe(second);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
