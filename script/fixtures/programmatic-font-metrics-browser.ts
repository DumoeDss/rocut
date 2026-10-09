import type {
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import { runProgrammaticSandbox } from "../../packages/editor-classic/src/services/renderer/programmatic/sandbox-runtime";
import type { ProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { runFontAdvanceBrowserOracle } from "./programmatic-font-advance-browser";
import { runFontBoundsBrowserOracle } from "./programmatic-font-bounds-browser";

function check(value: unknown, message: string): asserts value {
	if (!value) throw Error(message);
}
async function rejects(action: () => Promise<unknown>, pattern: RegExp) {
	try {
		await action();
	} catch (error) {
		check(pattern.test(String(error)), `Wrong rejection: ${String(error)}`);
		return;
	}
	throw Error(`Expected rejection: ${pattern}`);
}
async function run() {
	const bytes = await (await fetch("/metrics-font.ttf")).arrayBuffer();
	const sha256 = [
		...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
	]
		.map((v) => v.toString(16).padStart(2, "0"))
		.join("");
	const makeResource = (axis: number): ProgrammaticResource => ({
		id: "font.ttf",
		kind: "font",
		attachmentKey: "fixtures/font.ttf",
		mimeType: "font/ttf",
		byteLength: bytes.byteLength,
		sha256,
		font: {
			family: "MetricFixture",
			weight: 400,
			style: "normal",
			axes: { TEST: axis },
		},
	});
	const makeSource = (resource: ProgrammaticResource): ProgrammaticSource => ({
		version: 1,
		runtime: "canvas-worker",
		code: "throw Error('Must not execute author code while measuring')",
		width: 32,
		height: 32,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 30,
		seed: 0,
		resources: [resource],
	});
	const glyphs = ["A", "f", "静", " "];
	const makeFrame = (resource: ProgrammaticResource): ProgrammaticFrame => ({
		index: 0,
		time: 0,
		timelineTime: 0,
		sourceTime: 0,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 30,
		seed: 0,
		fontMetricRequests: [{ resource, glyphs }],
	});
	const iframeCount = document.querySelectorAll("iframe").length;
	const observations = [];
	for (const axis of [100, 900, 100]) {
		const resource = makeResource(axis);
		const measured = await runProgrammaticSandbox({
			source: makeSource(resource),
			frame: makeFrame(resource),
			resources: [{ resource, body: bytes }],
			operation: "measure-fonts",
		});
		const face = new FontFace("MetricFixture", bytes, {
			style: "normal",
			weight: "400",
			variationSettings: `"TEST" ${axis}`,
		});
		await face.load();
		document.fonts.add(face);
		try {
			const c = document.createElement("canvas"),
				ctx = c.getContext("2d")!;
			ctx.font = 'normal 400 100px "MetricFixture"';
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.letterSpacing = "0px";
			const expected = glyphs.map((text) => {
				const m = ctx.measureText(text);
				return {
					text,
					left: m.actualBoundingBoxLeft,
					right: m.actualBoundingBoxRight,
					ascent: m.actualBoundingBoxAscent,
					descent: m.actualBoundingBoxDescent,
				};
			});
			check(
				JSON.stringify(measured[0]?.glyphs) === JSON.stringify(expected),
				"Worker metrics differ from independently loaded declared font",
			);
			check(
				measured[0]?.resource.sha256 === sha256,
				"Lost complete font identity",
			);
			observations.push({ axis, glyphs: measured[0]!.glyphs });
		} finally {
			document.fonts.delete(face);
		}
	}
	check(
		JSON.stringify(observations[0]!.glyphs) !==
			JSON.stringify(observations[1]!.glyphs),
		"Custom variation axis was ignored",
	);
	check(
		JSON.stringify(observations[0]) === JSON.stringify(observations[2]),
		"Isolated repeat inherited earlier font state",
	);
	const resource = makeResource(100),
		source = makeSource(resource),
		frame = makeFrame(resource);
	const request = {
		source,
		frame,
		resources: [{ resource, body: bytes }],
		operation: "measure-fonts" as const,
	};
	const altered = bytes.slice(0);
	new Uint8Array(altered)[200] ^= 1;
	await rejects(
		() =>
			runProgrammaticSandbox({
				...request,
				resources: [{ resource, body: altered }],
			}),
		/digest mismatch/,
	);
	await rejects(
		() =>
			runProgrammaticSandbox({
				...request,
				resources: [{ resource, body: bytes.slice(1) }],
			}),
		/length mismatch/,
	);
	await rejects(
		() => runProgrammaticSandbox({ ...request, resources: [] }),
		/Missing programmatic resources/,
	);
	await rejects(
		() =>
			runProgrammaticSandbox({
				...request,
				frame: {
					...frame,
					fontMetricRequests: [
						{ resource: { ...resource, id: "missing" }, glyphs },
					],
				},
			}),
		/declared loaded font/,
	);
	const cancelled = new AbortController();
	cancelled.abort(new DOMException("metric cancelled", "AbortError"));
	await rejects(
		() => runProgrammaticSandbox({ ...request, signal: cancelled.signal }),
		/metric cancelled/,
	);
	const inFlight = new AbortController();
	const inserted = new Promise<void>((resolve, reject) => {
		const observer = new MutationObserver(() => {
			if (document.querySelectorAll("iframe").length > iframeCount) {
				clearTimeout(timer);
				observer.disconnect();
				resolve();
			}
		});
		const timer = setTimeout(() => {
			observer.disconnect();
			reject(Error("No in-flight iframe"));
		}, 2000);
		observer.observe(document.body, { childList: true });
	});
	const pending = runProgrammaticSandbox({
		...request,
		signal: inFlight.signal,
	});
	await inserted;
	inFlight.abort(new DOMException("in-flight metric cancelled", "AbortError"));
	await rejects(() => pending, /in-flight metric cancelled/);
	const mutable = bytes.slice(0);
	const snapshot = runProgrammaticSandbox({
		...request,
		resources: [{ resource, body: mutable }],
	});
	new Uint8Array(mutable).fill(0);
	check(
		JSON.stringify((await snapshot)[0]!.glyphs) ===
			JSON.stringify(observations[0]!.glyphs),
		"Caller mutated the checked font snapshot",
	);
	await rejects(
		() =>
			runProgrammaticSandbox({
				...request,
				operation: "render",
				source: { ...source, code: "for (;;) {}" },
			}),
		/timed out after 5000 ms/,
	);
	check(
		document.querySelectorAll("iframe").length === iframeCount,
		"Leaked sandbox iframe",
	);
	const bitmap = await runProgrammaticSandbox({
		...request,
		operation: "render",
		source: {
			...source,
			code: "const x=canvas.getContext('2d');x.fillStyle='red';x.fillRect(0,0,32,32)",
		},
	});
	try {
		const c = new OffscreenCanvas(32, 32),
			x = c.getContext("2d")!;
		x.drawImage(bitmap, 0, 0);
		check(
			x.getImageData(0, 0, 1, 1).data.join(",") === "255,0,0,255",
			"Renderer failed after cancellation/timeout",
		);
	} finally {
		bitmap.close();
	}
	return {
		passed: true,
		observations,
		advances: await runFontAdvanceBrowserOracle(bytes),
		bounds: await runFontBoundsBrowserOracle(bytes),
		checks: [
			"independent actual-font metrics",
			"custom axis sensitivity",
			"reverse/repeat isolation",
			"measure never executes author code",
			"SHA/length/missing-font rejection",
			"owned byte snapshot",
			"pre/in-flight cancellation",
			"watchdog and recovery",
			"no leaked iframe",
		],
	};
}
void run().then(
	(value) => Reflect.set(globalThis, "__fontMetrics", value),
	(error) =>
		Reflect.set(globalThis, "__fontMetrics", {
			passed: false,
			error: String(error?.stack ?? error),
		}),
);
