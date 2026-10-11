import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { REMOTION_FRAME_DRIVER } from "../programmatic/engines/remotion-driver";
import { REMOTION_READINESS_OBSERVATION_SOURCE } from "../programmatic/remotion-readiness-observation";

interface Model {
	window: {
		remotion_delayRenderHandles: number[];
		remotion_renderReady: boolean;
		rocutMedia: { check(): void };
	};
	turns: number;
	committed: boolean;
}

async function settle({
	handles = [1],
	onTurn,
}: {
	handles?: number[];
	onTurn(model: Model): void;
}) {
	const model: Model = {
		window: {
			remotion_delayRenderHandles: handles,
			remotion_renderReady: handles.length === 0,
			rocutMedia: { check() {} },
		},
		turns: 0,
		committed: false,
	};
	const start = REMOTION_FRAME_DRIVER.indexOf("  const settle = async () => {");
	const end = REMOTION_FRAME_DRIVER.indexOf("  await settle();", start);
	expect(start).toBeGreaterThan(0);
	const execute = new Function(
		"window",
		"lifetime",
		"paint",
		"observeReadiness",
		`${REMOTION_FRAME_DRIVER.slice(start, end)} return settle();`,
	);
	await execute(
		model.window,
		{ check() {}, wait: (value: unknown) => value },
		async () => {
			model.turns++;
			expect(model.turns).toBeLessThan(20);
			onTurn(model);
		},
		() => {},
	);
	return model;
}

test("native idle is not a React commit acknowledgement in the actual settle predicate", async () => {
	const model = await settle({
		onTurn(model) {
			model.window.remotion_delayRenderHandles = [];
			model.window.remotion_renderReady = true;
		},
	});
	expect(model.turns).toBe(2);
	expect(model.committed).toBe(false);
});

test("an outstanding handle blocks; release and commit before second idle turn passes", async () => {
	const model = await settle({
		onTurn(model) {
			if (model.turns === 3) {
				model.window.remotion_delayRenderHandles = [];
				model.window.remotion_renderReady = true;
			}
			if (model.turns === 4) model.committed = true;
		},
	});
	expect(model.turns).toBe(4);
	expect(model.committed).toBe(true);
});

test("observer is bounded and cannot mutate native readiness", () => {
	const scope = {
		remotion_renderReady: true,
		remotion_delayRenderHandles: [],
	};
	const context = { window: scope, performance: { now: () => 1 } };
	runInNewContext(REMOTION_READINESS_OBSERVATION_SOURCE, context);
	const result = runInNewContext(
		`for(let i=0;i<140;i++)window.__rocutRemotionReadinessObserve({kind:'test'});
JSON.stringify(window.__rocutRemotionReadinessTrace)`,
		context,
	);
	const observed = JSON.parse(result);
	expect(observed.events.length).toBe(128);
	expect(observed.dropped).toBe(12);
	expect(scope.remotion_renderReady).toBe(true);
	expect(scope.remotion_delayRenderHandles.length).toBe(0);
});

test("diagnostics remain after screenshot; original timers and native idle predicate stay unchanged", async () => {
	const capture = await readFile(
		new URL("../programmatic/particle-capture-frame.ts", import.meta.url),
		"utf8",
	);
	expect(
		capture.indexOf("printRemotionReadinessObservation({"),
	).toBeGreaterThan(capture.indexOf('options.send("Page.captureScreenshot"'));
	expect(REMOTION_FRAME_DRIVER).toContain("stable < 2");
	expect(REMOTION_FRAME_DRIVER).toContain(
		"window.remotion_delayRenderHandles.length === 0",
	);
	expect(REMOTION_FRAME_DRIVER).toContain("timeoutMs:8000");
});
