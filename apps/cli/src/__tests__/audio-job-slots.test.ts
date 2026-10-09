import { expect, test } from "bun:test";
import { createNativeAudioSlots } from "../programmatic/audio-job-slots";

test("replacement audio waits for cancelled IO cleanup without exceeding two native jobs", async () => {
  const slots = createNativeAudioSlots(), a = new AbortController(), b = new AbortController();
  const releaseA = (await slots.acquire(a.signal))!, releaseB = (await slots.acquire(b.signal))!;
  expect(await slots.acquire(new AbortController().signal)).toBeNull();
  a.abort(); b.abort();
  let started = false;
  const replacement = slots.acquire(new AbortController().signal).then(release => { started = true; return release; });
  await Promise.resolve(); expect(started).toBe(false);
  releaseA();
  const releaseC = await replacement; expect(releaseC).toBeInstanceOf(Function);
  // B still owns its native process; releasing A twice must not free C's slot.
  releaseA();
  let nextStarted = false;
  const next = slots.acquire(new AbortController().signal).then(release => { nextStarted = true; return release; });
  await Promise.resolve(); expect(nextStarted).toBe(false);
  releaseB(); const releaseD = await next;
  expect(await slots.acquire(new AbortController().signal)).toBeNull();
  releaseC!(); releaseD!();
});

test("waiting audio can cancel immediately and a replacement can reuse its bounded queue slot", async () => {
  const slots = createNativeAudioSlots(), a = new AbortController(), b = new AbortController();
  const releaseA = (await slots.acquire(a.signal))!, releaseB = (await slots.acquire(b.signal))!;
  a.abort();
  const waiting = new AbortController(), reason = Error("new seek superseded old seek");
  const cancelled = slots.acquire(waiting.signal).catch(error => error);
  const queued = slots.acquire(new AbortController().signal);
  expect(await slots.acquire(new AbortController().signal)).toBeNull();
  waiting.abort(reason); expect(await cancelled).toBe(reason);
  const replacement = slots.acquire(new AbortController().signal);
  releaseA(); const releaseQueued = await queued;
  releaseB(); const releaseReplacement = await replacement;
  expect(await slots.acquire(new AbortController().signal)).toBeNull();
  releaseQueued!(); releaseReplacement!();
  const alreadyAborted = slots.acquire(AbortSignal.abort(reason)).catch(error => error);
  expect(await alreadyAborted).toBe(reason);
});
