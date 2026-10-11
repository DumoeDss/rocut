# HTTP programmatic frame admission

The CLI `programmatic/frame` route admits two active requests and up to eight
waiting requests in FIFO order. These limits are per service instance. A short
burst waits for a slot instead of immediately receiving HTTP 429.

An active lease covers body reading, rendering and actual renderer cleanup.
Disconnecting or cancelling the caller does not release that lease early.
Cancelled waiting requests are removed without executing the renderer. Disposal
aborts both active and waiting requests, then waits for active cleanup to finish.

The original route deadline starts at request arrival and includes queue time.
Body admission remains 15 seconds. A valid, parsed Electron particle request can
receive the existing 45-second total budget; queueing does not restart either
deadline. Request size, resource admission and renderer validation are unchanged.

When all eight waiting slots are occupied, the route still returns HTTP 429 with
`HTML rasterizer busy; retry after the active frame finishes`. An unavailable or
disposed service returns HTTP 503. Cancellation and renderer failures retain their
existing HTTP 408 and 422 handling. This is bounded transport backpressure, not an
increase in rendering concurrency or a relaxation of rendering timeouts.

Relevant checks (Bun 1.2.18):

```sh
bun test apps/cli/src/__tests__/frame-service-admission.test.ts apps/cli/src/__tests__/frame-service-admission-http.test.ts apps/cli/src/__tests__/frame-service-deadline.test.ts
```

The route tests isolate the renderer with an explicitly held boundary double to
verify admission and cleanup ordering. They do not prove GPU rendering or image
quality. Real Node HTTP cancellation and shutdown evidence is separately recorded
at `C:/tmps/rocut-frame-admission-20261012/node-http-receipt.json`; the historical
Glass run and its failures remain unchanged.
