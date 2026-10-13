import { describe, expect, test } from "bun:test";
import {
	cancelStalePreviewRender,
	subscribePreviewRenderInvalidation,
	type PreviewRenderRequest,
} from "../preview-render-invalidation";

function createFixture() {
	const seeks = new Set<() => void>();
	const updates = new Set<() => void>();
	const publications = new Set<() => void>();
	const suspends = new Set<() => void>();
	let tree = {};
	let revision = 1;
	let request: PreviewRenderRequest<object> | null = {
		controller: new AbortController(),
		tree,
		revision,
	};
	const playback = {
		onSeek: (listener: () => void) => {
			seeks.add(listener);
			return () => {
				seeks.delete(listener);
			};
		},
		onUpdate: (listener: () => void) => {
			updates.add(listener);
			return () => {
				updates.delete(listener);
			};
		},
	};
	const rendererManager = {
		getRenderTree: () => tree,
		getPreviewRevision: () => revision,
		subscribe: (listener: () => void) => {
			publications.add(listener);
			return () => {
				publications.delete(listener);
			};
		},
	};
	const unsubscribe = subscribePreviewRenderInvalidation({
		getRequest: () => request,
		playback,
		rendererManager,
		activityLifecycle: {
			subscribeActivityLifecycle: ({ onSuspend }) => {
				const listener = () => onSuspend?.({ generation: 1 });
				suspends.add(listener);
				return () => {
					suspends.delete(listener);
				};
			},
		},
	});
	return {
		controller: request.controller,
		unsubscribe,
		seeks,
		updates,
		publications,
		suspends,
		advancePlayback: () => {
			for (const listener of updates) listener();
			// The RAF busy path uses the same content-only invalidation policy.
			cancelStalePreviewRender({ request, tree, revision });
		},
		seek: () => {
			for (const listener of seeks) listener();
		},
		publish: ({ changeTree = false, changeRevision = false } = {}) => {
			if (changeTree) tree = {};
			if (changeRevision) revision++;
			for (const listener of publications) listener();
		},
		suspend: () => {
			for (const listener of suspends) listener();
		},
		clearRequest: () => {
			request = null;
		},
	};
}

describe("preview render invalidation", () => {
	test("a slow frame finishes despite playback advancing through multiple frames", async () => {
		const fixture = createFixture();
		let finish!: () => void;
		let displayedFrames = 0;
		const slowRender = new Promise<void>((resolve) => {
			finish = resolve;
		}).then(() => {
			if (!fixture.controller.signal.aborted) displayedFrames++;
		});
		for (let frame = 0; frame < 12; frame++) fixture.advancePlayback();
		expect(fixture.controller.signal.aborted).toBe(false);
		expect(fixture.updates.size).toBe(0);
		finish();
		await slowRender;
		expect(displayedFrames).toBe(1);
		fixture.unsubscribe();
	});

	test("ordinary renderer notifications do not cancel unchanged content", () => {
		const fixture = createFixture();
		fixture.publish();
		expect(fixture.controller.signal.aborted).toBe(false);
		fixture.unsubscribe();
	});

	test.each(["tree", "revision"] as const)(
		"a changed %s cancels the in-flight frame",
		(change) => {
			const fixture = createFixture();
			fixture.publish({
				changeTree: change === "tree",
				changeRevision: change === "revision",
			});
			expect(fixture.controller.signal.aborted).toBe(true);
			fixture.unsubscribe();
		},
	);

	test("an explicit seek cancels even within the same frame and scene", () => {
		const fixture = createFixture();
		fixture.seek();
		expect(fixture.controller.signal.aborted).toBe(true);
		fixture.unsubscribe();
	});

	test("session suspension cancels the frame", () => {
		const fixture = createFixture();
		fixture.suspend();
		expect(fixture.controller.signal.aborted).toBe(true);
		fixture.unsubscribe();
	});

	test("cleanup cancels the frame and detaches all subscriptions", () => {
		const fixture = createFixture();
		fixture.unsubscribe();
		expect(fixture.controller.signal.aborted).toBe(true);
		expect([
			fixture.seeks.size,
			fixture.updates.size,
			fixture.publications.size,
			fixture.suspends.size,
		]).toEqual([0, 0, 0, 0]);
	});

	test("events with no in-flight request are harmless", () => {
		const fixture = createFixture();
		fixture.clearRequest();
		fixture.advancePlayback();
		fixture.publish({ changeRevision: true });
		fixture.seek();
		fixture.suspend();
		fixture.unsubscribe();
		expect(fixture.controller.signal.aborted).toBe(false);
	});
});
