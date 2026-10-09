import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { THREE_PARTICLE_FRAME_DRIVER } from "../programmatic/engines/three-particle-driver";
import { THREE_PARTICLE_ASSETS_DRIVER } from "../programmatic/engines/three-assets-driver";
import { createParticlePageRuntime } from "../programmatic/particle-browser-runtime";
import { identity, policy } from "./particle-protocol-test-support";

const flush = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

/** Execute the actual driver body. Only browser GPU/asset constructors are test
 * doubles; stage ownership, runtime cancellation and cleanup are production. */
function fixture(
	createScene: () => unknown,
	compile: () => Promise<unknown>,
	cleanupTimeoutMs = 5000,
) {
	const events: string[] = [];
	const runtime = createParticlePageRuntime(
		{
			version: 1,
			identity,
			policy: {
				...policy,
				cleanupTimeoutMs,
				process: {
					...policy.process,
					terminationTimeoutMs: Math.min(
						policy.process.terminationTimeoutMs,
						cleanupTimeoutMs,
					),
				},
			},
			requestTimeoutMs: policy.requestTimeoutMs,
		},
		{ index: 1, seed: 42 },
		() => {},
	);
	class Renderer {
		setPixelRatio() {}
		setSize() {}
		setClearColor() {}
		setAnimationLoop() {
			events.push("renderer-stop");
		}
		dispose() {
			events.push("renderer-dispose");
		}
		forceContextLoss() {
			events.push("renderer-context-loss");
		}
		compileAsync() {
			events.push("compile-start");
			return compile();
		}
		render() {
			events.push("render");
		}
		getContext() {
			return { finish() {}, isContextLost: () => false };
		}
	}
	const window: Record<string, any> = {
		__rocutThreeSpec: { width: 64, height: 64 },
		__rocutClaimParticleRuntime: () => runtime,
	};
	const source = THREE_PARTICLE_FRAME_DRIVER.replace(
		"import * as THREE from 'three';",
		"const THREE=testThree;",
	)
		.replace(
			"import {createScene} from 'rocut:entry';",
			"const createScene=testCreate;",
		)
		.replace(THREE_PARTICLE_ASSETS_DRIVER, "const createAssets=testAssets;");
	runInNewContext(source, {
		window,
		AbortController,
		testThree: { WebGLRenderer: Renderer },
		testCreate: createScene,
		testAssets: () => ({
			api: {},
			async dispose() {
				events.push("assets-dispose");
			},
		}),
		document: {
			body: { append() {} },
			createElement: () => ({
				style: {},
				remove() {
					events.push("canvas-remove");
				},
			}),
		},
	});
	const rendering: Promise<void> = window.rocut.renderFrame({
		index: 1,
		seed: 42,
	});
	void rendering.catch(() => {});
	return { runtime, events, rendering };
}
function author(events: string[]) {
	return {
		scene: {
			isScene: true,
			updateMatrixWorld() {
				events.push("scene-matrix");
			},
		},
		camera: {
			isCamera: true,
			updateMatrixWorld() {
				events.push("camera-matrix");
			},
		},
		particleFrame() {
			events.push("particle-hook");
		},
		async dispose() {
			events.push("author-dispose");
		},
	};
}

test("cancelled createScene keeps late owner and cannot acknowledge cleanup before it resolves", async () => {
	const scene = deferred<unknown>();
	const page = fixture(
		() => scene.promise,
		async () => {},
	);
	await flush();
	let cleaned = false;
	const cleanup = page.runtime.cleanup();
	void cleanup.then(() => {
		cleaned = true;
	});
	await flush();
	expect(cleaned).toBe(false);
	expect(page.events).not.toContain("renderer-dispose");
	scene.resolve(author(page.events));
	await cleanup;
	await expect(page.rendering).rejects.toThrow("disposed");
	expect(page.events).toEqual([
		"author-dispose",
		"assets-dispose",
		"renderer-stop",
		"renderer-dispose",
		"renderer-context-loss",
		"canvas-remove",
	]);
});

test("cleanup awaits in-flight compileAsync and does not render after cancellation", async () => {
	const compilation = deferred<void>();
	const events: string[] = [];
	const page = fixture(
		() => author(events),
		() => compilation.promise,
	);
	await flush();
	expect(page.events).toContain("compile-start");
	let cleaned = false;
	const cleanup = page.runtime.cleanup();
	void cleanup.then(() => {
		cleaned = true;
	});
	await flush();
	expect(cleaned).toBe(false);
	expect(events).not.toContain("author-dispose");
	compilation.resolve();
	await cleanup;
	await expect(page.rendering).rejects.toThrow("disposed");
	expect(events).toContain("author-dispose");
	expect(page.events).not.toContain("render");
	expect(page.events).toContain("renderer-dispose");
});

test("unfinished cleanup times out as failure and still reclaims a later scene owner", async () => {
	const scene = deferred<unknown>();
	const page = fixture(
		() => scene.promise,
		async () => {},
		20,
	);
	await flush();
	const cleanup = page.runtime.cleanup();
	await expect(cleanup).rejects.toThrow("unfinished ownership");
	expect(page.events).not.toContain("renderer-dispose");
	scene.resolve(author(page.events));
	await flush();
	expect(page.events).toContain("author-dispose");
	expect(page.events).toContain("renderer-dispose");
	await expect(page.rendering).rejects.toThrow("cleanup failed");
});
