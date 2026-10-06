import { expect, test } from "bun:test";
import { createEditorTaskRegistry } from "../host-editor-tasks";

const request = {
	kind: "history.status" as const,
	expectedRevision: 0,
	idempotencyKey: "status-1",
};
test("tasks target exactly one capable pane and require its claim token", () => {
	const registry = createEditorTaskRegistry();
	const frames: unknown[] = [],
		other: unknown[] = [];
	const detach = registry.attach("pane_one", {
		send: (frame) => frames.push(frame),
	});
	registry.attach("pane_two", { send: (frame) => other.push(frame) });
	try {
		expect(() => registry.start({ request }, 0)).toThrow("ambiguous");
		const job = registry.start({ surfaceId: "pane_one", request }, 0);
		expect(frames).toHaveLength(1);
		expect(other).toHaveLength(0);
		const frame = frames[0] as { token: string };
		expect(() =>
			registry.report(job.id, { token: "wrong", result: {} }),
		).toThrow("owner");
		expect(
			registry.report(job.id, { token: frame.token, result: { count: 2 } })
				.status,
		).toBe("complete");
		expect(registry.start({ surfaceId: "pane_one", request }, 999)).toEqual(
			registry.get(job.id),
		);
		expect(frames).toHaveLength(1);
		expect(() =>
			registry.start({ request: { ...request, kind: "history.undo" } }, 0),
		).toThrow("idempotency");
		detach();
		expect(registry.get(job.id)?.status).toBe("complete");
	} finally {
		registry.dispose();
	}
});

test("equivalent request key ordering replays and uncertain dispatch never reruns history", () => {
	const registry = createEditorTaskRegistry();
	let sends = 0;
	registry.attach("pane_one", {
		send: () => {
			sends += 1;
			throw new Error("transport failed after delivery");
		},
	});
	try {
		const job = registry.start(
			{ request: { ...request, kind: "history.undo" } },
			0,
		);
		expect(job.status).toBe("outcome-unknown");
		expect(job.error).toBe("task-dispatch-failed");
		const replay = registry.start(
			{
				request: {
					idempotencyKey: request.idempotencyKey,
					expectedRevision: 0,
					kind: "history.undo",
				},
			},
			1,
		);
		expect(replay).toEqual(job);
		expect(sends).toBe(1);
		expect(
			registry.start({ request: { ...request, idempotencyKey: "read" } }, 0)
				.status,
		).toBe("failed");
	} finally {
		registry.dispose();
	}
});

test("cancellation rejects late caption results; history disconnect is explicitly uncertain", () => {
	const registry = createEditorTaskRegistry();
	const frames: { token?: string }[] = [];
	const detach = registry.attach("pane_one", {
		send: (frame) => frames.push(frame as { token?: string }),
	});
	try {
		const captions = registry.start(
			{
				request: {
					kind: "captions.import",
					expectedRevision: 0,
					idempotencyKey: "captions",
					sceneId: "scene",
					trackId: "captions",
					fileName: "lyrics.srt",
					input: "",
				},
			},
			0,
		);
		expect(registry.cancel(captions.id).status).toBe("cancelled");
		expect(
			registry.report(captions.id, {
				token: frames[0].token,
				result: { late: true },
			}).result,
		).toBeUndefined();
		const history = registry.start(
			{ request: { ...request, kind: "history.undo", idempotencyKey: "undo" } },
			0,
		);
		expect(() => registry.cancel(history.id)).toThrow("not-cancellable");
		detach();
		expect(registry.get(history.id)?.status).toBe("outcome-unknown");
		expect(
			registry.start(
				{
					request: { ...request, kind: "history.undo", idempotencyKey: "undo" },
				},
				1,
			).status,
		).toBe("outcome-unknown");
	} finally {
		registry.dispose();
	}
});

test("invalid schemas, absent consent, stale revision and missing panes fail before work", () => {
	const registry = createEditorTaskRegistry();
	expect(() => registry.start({ request }, 0)).toThrow("no-task-surface");
	registry.attach("pane_one", {
		send: () => {
			throw new Error("must not dispatch");
		},
	});
	try {
		expect(() => registry.start({ request }, 1)).toThrow("revision-conflict");
		expect(() =>
			registry.start(
				{
					request: {
						...request,
						kind: "captions.transcribe",
						sceneId: "s",
						trackId: "t",
					},
				},
				0,
			),
		).toThrow("invalid-editor-task");
		expect(() =>
			registry.start({ request: { ...request, arbitrary: true } }, 0),
		).toThrow("invalid-editor-task");
	} finally {
		registry.dispose();
	}
});
