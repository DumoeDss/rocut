import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { createScreencastCapture } from "./probe-preview-screencast.mjs";
import { captureHeapSummary } from "./probe-heap-summary.mjs";
import { createScreenshotCapture } from "./probe-preview-screenshot.mjs";

function timecode(frame) {
	const seconds = Math.floor(frame / 30);
	return [
		Math.floor(seconds / 3600),
		Math.floor(seconds / 60) % 60,
		seconds % 60,
		frame % 30,
	]
		.map((value) => String(value).padStart(2, "0"))
		.join(":");
}

// Independently targeted Rocut iframe heap/DOM, not a GPU-memory release gate.
// Exercise visible frames, not only timecodes; do not override the decoder.
export async function probeMotionStressMemory({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	const cdp = await hostPage.context().newCDPSession(hostPage);
	let resourceCdp;
	const lifecycle = { resourceDetached: false };
	try {
		resourceCdp = await hostPage.context().newCDPSession(page);
		const { targetInfo } = await resourceCdp.send("Target.getTargetInfo");
		assert.equal(
			targetInfo.type,
			"iframe",
			"Memory must target the Rocut iframe, not Elftia",
		);
		const title = await resourceCdp.send("Runtime.evaluate", {
			expression: "document.title",
			returnByValue: true,
		});
		assert(title.result.value?.startsWith("OpenCut editor"));
		return await measureMotionStressMemory({
			page,
			hostPage,
			work,
			evidence,
			onPhase,
			cdp,
			resourceCdp,
			targetId: targetInfo.targetId,
			lifecycle,
		});
	} finally {
		try {
			if (resourceCdp && !lifecycle.resourceDetached)
				await resourceCdp.detach();
		} finally {
			await cdp.detach();
		}
	}
}

async function measureMotionStressMemory({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
	cdp,
	resourceCdp,
	targetId,
	lifecycle,
}) {
	const url = await page.evaluate(() => location.href);
	const frameObserver = process.env.ROCUT_F05_FRAME_OBSERVER ?? "screencast";
	assert(
		["screencast", "screenshot"].includes(frameObserver),
		"Unsupported F05 frame observer",
	);
	const cycles = Number(process.env.ROCUT_F05_CYCLES ?? 4);
	assert(
		Number.isInteger(cycles) && cycles >= 4 && cycles <= 24,
		"F05 cycles must be an integer from 4 to 24; do not reduce the baseline",
	);
	const dimensions = await page.evaluate(
		async () =>
			(await (await fetch(new URL("api/record", location.href))).json()).record
				.data.settings.canvasSize,
	);
	const canvas = page.locator(
		'canvas[width="' +
			dimensions.width +
			'"][height="' +
			dimensions.height +
			'"]',
	);
	await expect(canvas).toHaveCount(1);
	const displayed = await canvas.boundingBox();
	assert(displayed && displayed.width > 100 && displayed.height > 50);
	await page.evaluate(() => {
		window.__rocutVisibleSeekProbe = {
			start: null,
			startEpoch: null,
			trusted: false,
		};
	});
	let observer;
	let sampling = false;
	let sampledAllocations;
	const snapshots = [];
	const heapSummaries = [];
	const summarizeHeap = process.env.ROCUT_F05_HEAP_SUMMARY === "1";
	if (summarizeHeap) evidence.acceptanceEligible = false;
	const memory = async (label) => {
		await resourceCdp.send("HeapProfiler.collectGarbage");
		const [heap, dom] = await Promise.all([
			resourceCdp.send("Runtime.getHeapUsage"),
			resourceCdp.send("Memory.getDOMCounters"),
		]);
		snapshots.push({ label, heap, dom });
		const checkpoint = snapshots.length - 1;
		if (
			summarizeHeap &&
			[0, Math.floor(cycles / 2), cycles].includes(checkpoint)
		) {
			onPhase("F05 in-memory heap retainer summary: " + label);
			heapSummaries.push({
				label,
				summary: await captureHeapSummary(resourceCdp),
			});
		}
	};
	try {
		observer =
			frameObserver === "screenshot"
				? createScreenshotCapture({ cdp, displayed })
				: await createScreencastCapture({ page, cdp, displayed });
		const seek = async (target, expected) => {
			const before = (await observer.capture()).hash;
			await page.getByLabel("Edit playhead time", { exact: true }).click();
			const input = page.getByLabel("Playhead time", { exact: true });
			await input.fill(target);
			await input.press("Enter");
			await expect(
				page.getByLabel("Edit playhead time", { exact: true }),
			).toHaveText(target);
			let previous = null,
				stable = 0;
			const started = performance.now();
			const observations = [];
			while (performance.now() - started < 5000) {
				const current = await observer.capture();
				observations.push({
					hash: current.hash,
					light: current.light,
					sequence: current.sequence,
				});
				if (observations.length > 8) observations.shift();
				if (current.light <= 20) continue;
				if (expected && current.hash === expected)
					return { target, hash: current.hash };
				stable =
					!expected && current.hash !== before && current.hash === previous
						? stable + 1
						: 0;
				if (stable >= 2) return { target, hash: current.hash };
				previous = current.hash;
			}
			evidence.f05PictureFailure = {
				target,
				expected,
				before,
				observations,
				displayed,
				currentBounds: await canvas.boundingBox(),
			};
			throw new Error("F05 target picture did not arrive: " + target);
		};
		onPhase("F05 visible-frame memory warmup");
		const references = [];
		for (let i = 0; i < 30; i++)
			references.push(await seek(timecode(((i * 197) % 600) * 24 + 6)));
		assert.equal(new Set(references.map((row) => row.hash)).size, 30);
		await memory("warmed 30 distinct target pictures");
		if (process.env.ROCUT_F05_HEAP_SAMPLE === "1") {
			await resourceCdp.send("HeapProfiler.startSampling", {
				samplingInterval: 32768,
				stackDepth: 64,
			});
			sampling = true;
		}
		for (let cycle = 0; cycle < cycles; cycle++) {
			onPhase("F05 repeated visible seeks cycle " + (cycle + 1));
			for (let i = 0; i < 30; i++) {
				const target = references[(i * 13 + 7 + cycle) % 30];
				await seek(target.target, target.hash);
			}
			await memory("after " + (cycle + 1) * 30 + " measured seeks");
		}
		if (sampling) {
			const { profile } = await resourceCdp.send("HeapProfiler.stopSampling");
			sampling = false;
			const allocations = [];
			const walk = (node, parents, parentLocations = []) => {
				const stack = [
					...parents,
					node.callFrame.functionName || "(anonymous)",
				];
				const locations = [
					...parentLocations,
					{
						functionName: node.callFrame.functionName || "(anonymous)",
						// Retain source coordinates, never an authenticated frame URL.
						asset: node.callFrame.url.includes("/assets/")
							? new URL(node.callFrame.url).pathname.split("/").pop()
							: null,
						line: node.callFrame.lineNumber,
						column: node.callFrame.columnNumber,
					},
				];
				if (node.selfSize)
					allocations.push({
						bytes: node.selfSize,
						stack: stack.slice(-8),
						locations: locations.slice(-8),
						scriptKind: /playwright|injectedScript/.test(node.callFrame.url)
							? "driver"
							: node.callFrame.url.includes("/assets/")
								? "product-bundle"
								: "other",
					});
				for (const child of node.children) walk(child, stack, locations);
			};
			walk(profile.head, []);
			sampledAllocations = allocations
				.sort((a, b) => b.bytes - a.bytes)
				.slice(0, 30);
			const last = references[(29 * 13 + 7 + cycles - 1) % 30];
			for (let cycle = 0; cycle < 2; cycle++) {
				onPhase("F05 same-frame UI control cycle " + (cycle + 1));
				for (let i = 0; i < 30; i++) await seek(last.target, last.hash);
				await memory("after " + (cycle + 1) * 30 + " same-frame UI controls");
			}
			for (let cycle = 0; cycle < 2; cycle++) {
				onPhase("F05 observation-only control cycle " + (cycle + 1));
				for (let i = 0; i < 60; i++) await observer.capture();
				await memory(
					"after " + (cycle + 1) * 60 + " observation-only captures",
				);
			}
		}
		evidence.checks.push({
			name:
				"F05 reaches all 30 distinct visible target frames across " +
				cycles +
				" shuffled cycles",
			seeks: cycles * 30,
			pass: true,
		});
		await page.screenshot({ path: join(work, "f05-memory-seeks.png") });
	} finally {
		try {
			await observer?.close();
		} finally {
			if (sampling) await resourceCdp.send("HeapProfiler.stopSampling");
			await page
				.evaluate(() => {
					delete window.__rocutVisibleSeekProbe;
				})
				.catch(() => {});
			evidence.f05Memory = {
				scope:
					"Rocut OOP iframe renderer, target type/title verified, forced GC at each checkpoint",
				targetId,
				heapSampling: process.env.ROCUT_F05_HEAP_SAMPLE === "1",
				cycles,
				memoryGateStatus: "measured-not-asserted",
				heapSummaries,
				frameObserver,
				sampledAllocations,
				gpuMeasured: false,
				snapshots,
			};
			await resourceCdp.detach();
			lifecycle.resourceDetached = true;
		}
	}
	try {
		onPhase("F05 editor close and reopen release observation");
		await hostPage
			.locator(
				'[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
			)
			.click();
		await expect
			.poll(() => hostPage.frames().some((frame) => frame.url() === url))
			.toBe(false);
		await expect
			.poll(async () =>
				(await cdp.send("Target.getTargets")).targetInfos.some(
					(target) => target.targetId === targetId,
				),
			)
			.toBe(false);
		evidence.f05Memory.closedTargetDestroyed = true;
	} finally {
		await hostPage
			.locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]')
			.click();
		let reopened;
		await expect
			.poll(
				async () => {
					reopened = hostPage.frames().find((frame) => frame.url() === url);
					return reopened
						? await reopened
								.locator('[aria-label="Media"]')
								.isVisible()
								.catch(() => false)
						: false;
				},
				{ timeout: 30000 },
			)
			.toBe(true);
		const data = await reopened.evaluate(
			async () =>
				(await (await fetch(new URL("api/record", location.href))).json())
					.record.data,
		);
		assert.equal(data.motionTextSequences[0].cues.length, 600);
		assert.equal(data.motionTextSequences[0].duration, 480 * 120000);
		evidence.checks.push({
			name: "F05 owned iframe closes and a fresh editor reopens the intact 600-cue project",
			pass: true,
		});
	}
}
